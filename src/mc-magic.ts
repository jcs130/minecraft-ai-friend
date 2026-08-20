import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Bot } from 'mineflayer'
import type { RconService } from './mc-rcon.ts'

/**
 * mc-magic —— 快路径魔法系统（世界侧，程序化、零生成式 LLM）。
 *
 * 职责：
 *   - 监听公屏聊天（任何玩家——AI 穿越者或真人——念出含法术关键词的咒语）；
 *   - 程序化结算三资源消耗（mana 时间回蓝 / food 饱食度 / hp 血祭）；
 *   - 经共享 RCON 服务（mc-rcon，世界进程唯一）把法术效果翻译成服务器命令执行；
 *   - 回执走公屏（女神化身点名回复），让施法者的 Agent（和全世界）都能听见。
 *
 * 权限隔离：本插件只存在于世界进程。穿越者进程零 RCON、零魔法 ID——
 * 它们只是"说出咒语"（bot.chat），由这里听见并施法。真人与 AI 同通道。
 */
export const name = 'mc-magic'
export const inject = ['mcbot', 'mcRcon', 'timer']

// 归乡默认落点（2026-08-19，用户需求）：初始之地城镇中心——8 位村民锚点
// （岳山铁匠 -106.5,66,157.5 … 云笈书商 -95.5,66,176.5）的几何中心，y=67
// 与神官静水/诗人风临同层广场。玩家没睡床（实体无 SpawnX/Y/Z）时归乡不再
// 失败，天神直接送回初始城镇。城镇搬迁只需改这一处。
const TOWN_SPAWN = { x: -101, y: 67, z: 167 }

export interface Config {
  enabled: boolean
  atomsPath: string
  statePath: string
  maxManaDefault: number
  regenPerSec: number
  /** 天平覆盖层（data/balance-overrides.json）：女神动态平衡的补丁持久化。 */
  balancePath: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  atomsPath: Schema.string().default('./data/magic-atoms.json'),
  statePath: Schema.string().default('./data/magic-state.json'),
  maxManaDefault: Schema.number().default(100),
  regenPerSec: Schema.number().default(2.0),
  balancePath: Schema.string().default('./data/balance-overrides.json'),
})

// ── 原子指令（Atom）类型 ────────────────────────────────────────────────
type AtomParamType = 'number' | 'direction' | 'item'

interface AtomParam {
  type: AtomParamType
  max?: number
  default?: number | string
}

interface CostSpec {
  mana: number
  food: number
  hp: number
}

interface Atom {
  id: string
  layer: 'form' | 'effect' | 'augment'
  name: string
  words: string[]
  cost: CostSpec
  /** 等级门槛：低于此等级的玩家无法驾驭此法术（出生天赋豁免）。缺省 = 1 级。 */
  requiredLevel?: number
  paramCosts?: Partial<Record<string, Partial<CostSpec>>>
  params?: Record<string, AtomParam>
  commands: string[]
  reply: string
  // ── 视觉（纯 vanilla，零 mod）：────────────────────────────────────
  particles?: string[] // 每条是 /particle 参数模板（type x y z dx dy dz speed count），占位符同 commands
  sounds?: string[] // 声音 ID（如 minecraft:entity.enderman.teleport），相对施法者位置播放
  title?: string // 大字咏唱词（可含 {distance}/{direction} 等占位符）
  subtitle?: string // 大字副标题（中二补充，可含占位符）
  /** 通灵契约类（2026-08-18）：施法者名下已有契约兽在场则拒绝（防刷）。
   *  entity=实体类型，range=检测半径（默认96），denyReply=拒绝话术。
   *  实现：RCON NBT Owner 选择器命中（execute if entity @e[type=…,nbt={Owner:[I;…]}]）。 */
  ownLimit?: { entity: string; range?: number; denyReply?: string }
}

// ── 对外服务：把法术表与状态库的关键能力暴露给其他插件（降临仪式等）──
export interface AtomSummary {
  id: string
  name: string
  words: string[]
  cost: CostSpec
  requiredLevel: number
}

// ── 天平引擎（2026-08-17 扛枪提议：女神=世界维护者，动态平衡技能）──────
// 覆盖层设计：magic-atoms.json 是基准表（只读），balance-overrides.json 是
// 补丁层（可热更），启动时按序套用；字段白名单+数值护栏，超界拒绝。
export interface BalancePatch {
  /** atom id；'*' = 全局（如回蓝速率）。 */
  atom: string
  /** 白名单字段（点路径）：cost.mana / cost.food / cost.hp / requiredLevel / regenPerSec。 */
  field: string
  value: number
  by: string
  reason?: string
  at: number
}

export interface BalanceResult {
  ok: boolean
  error?: string
  /** 人类可读摘要，如「陨石术」魔力 120→90。 */
  summary?: string
}

/** 单法术可调字段白名单（护栏：min/max 闭区间，整数）。 */
const BALANCE_FIELDS: Record<string, { label: string; min: number; max: number; get: (a: Atom) => number; set: (a: Atom, v: number) => void }> = {
  'cost.mana': { label: '魔力', min: 0, max: 500, get: (a) => a.cost.mana, set: (a, v) => { a.cost.mana = v } },
  'cost.food': { label: '饱食', min: 0, max: 20, get: (a) => a.cost.food, set: (a, v) => { a.cost.food = v } },
  'cost.hp': { label: '生命', min: 0, max: 10, get: (a) => a.cost.hp, set: (a, v) => { a.cost.hp = v } },
  'requiredLevel': { label: '等级', min: 1, max: 50, get: (a) => a.requiredLevel ?? 1, set: (a, v) => { a.requiredLevel = v } },
}

/** 全局可调字段白名单（跨法术参数；回蓝允许 0.1 步进）。 */
const BALANCE_GLOBALS: Record<string, { label: string; min: number; max: number }> = {
  regenPerSec: { label: '回蓝', min: 0.5, max: 10 },
}

/** 字段中文别名 → 字段名（聊天命令「平衡 <法术> 魔力 90」用）。 */
export const BALANCE_FIELD_ALIASES: Record<string, string> = {
  魔力: 'cost.mana',
  饱食: 'cost.food',
  生命: 'cost.hp',
  血量: 'cost.hp',
  等级: 'requiredLevel',
  门槛: 'requiredLevel',
  回蓝: 'regenPerSec',
  回蓝速度: 'regenPerSec',
}

export function balanceFieldLabel(field: string): string {
  return BALANCE_FIELDS[field]?.label ?? BALANCE_GLOBALS[field]?.label ?? field
}

// ── 鉴定（2026-08-17）：把自身能力值与秘法掌握情况组装成女神报告 ──────────────
export interface AppraisalData {
  player: string
  level: number
  /** 升到下一层的修为进度（原生 XpP，0~1），null = 未探到。 */
  xpProgress: number | null
  mana: number
  maxMana: number
  maxManaBonus: number
  innateName: string | null
  passiveNames: string[]
  health: number | null
  food: number | null
  armor: number | null
}

/**
 * 鉴定报告 = panel（私发多行面板）+ summary（公屏/耳语一句话）。
 * 纯函数：数值全部由调用方采好传入，可离线单测。
 */
export function buildAppraisalReport(
  d: AppraisalData,
  atoms: AtomSummary[],
  innateId: string | null,
): { panel: string; summary: string } {
  const pct = d.xpProgress === null ? null : Math.round(d.xpProgress * 100)
  const progressText = pct === null ? '' : `（下一层 ${pct}%）`
  const bonusText = d.maxManaBonus > 0 ? `（含加持 +${d.maxManaBonus}）` : ''
  const fmt = (v: number | null, suffix: string) => (v === null ? '未探明' : `${Math.round(v)}${suffix}`)

  const mastered = atoms
    .filter((a) => a.requiredLevel <= d.level && a.id !== innateId)
    .map((a) => a.name)
  const innate = d.innateName ? [d.innateName] : []
  const allMastered = [...innate, ...mastered]
  const total = atoms.length

  const locked = atoms
    .filter((a) => a.requiredLevel > d.level)
    .sort((a, b) => a.requiredLevel - b.requiredLevel) // 稳定排序：同级保持 atoms 原文件序
  const nextLevels: { lv: number; names: string }[] = []
  for (const a of locked) {
    let g = nextLevels.find((x) => x.lv === a.requiredLevel)
    if (!g) {
      if (nextLevels.length >= 2) break
      g = { lv: a.requiredLevel, names: '' }
      nextLevels.push(g)
    }
    const parts = g.names ? g.names.split('、') : []
    if (parts.length < 4) parts.push(a.name)
    else if (!parts.includes('等')) parts.push('等')
    g.names = parts.join('、')
  }
  const nextText =
    nextLevels.length > 0
      ? nextLevels.map((g) => `Lv.${g.lv} ${g.names}`).join(' ｜ ')
      : '（已臻化境，万法皆通）'

  const panel =
    `✦ 鉴定 · ${d.player} ✦\n` +
    `修为层级：Lv.${d.level}${progressText}\n` +
    `魔力：${Math.floor(d.mana)}/${d.maxMana}${bonusText}\n` +
    `生命：${fmt(d.health, '/20')} ｜ 饱食：${fmt(d.food, '/20')} ｜ 护甲：${fmt(d.armor, '')}\n` +
    (d.innateName ? `出生天赋：${d.innateName}\n` : '') +
    (d.passiveNames.length > 0 ? `稀有被动：${d.passiveNames.join('、')}\n` : '') +
    `已掌握（${allMastered.length}/${total}）：${allMastered.length > 0 ? allMastered.join('、') : '尚无法术'}\n` +
    `下一批：${nextText}`

  const nextCount = locked.filter((a) => a.requiredLevel === (nextLevels[0]?.lv ?? -1)).length
  const summary =
    `✦ 鉴定：Lv.${d.level}${pct !== null ? `（${pct}%）` : ''}｜魔力 ${Math.floor(d.mana)}/${d.maxMana}${bonusText}` +
    `｜天赋${d.innateName ? `「${d.innateName}」` : '未觉醒'}｜秘法 ${allMastered.length}/${total}` +
    (nextLevels.length > 0 ? `（Lv.${nextLevels[0].lv} 解锁 ${nextCount} 项）` : '') +
    `——详录已传入你的心识。`

  return { panel, summary }
}

export interface MagicPlayerView {
  mana: number
  /** 最终魔力上限（= 基础公式 + 自有加成）。 */
  maxMana: number
  /** 体系自有魔力上限加成（与等级解耦，祝福/被动/供奉等自有机制叠加）。 */
  maxManaBonus: number
  learned: string[]
  /** 由成就解锁的法术 id（learned 子集；面板标注来源）。 */
  advancementSkills: string[]
  innateSkill: string | null
  backstory: string | null
  /** 魔力层级（= MC 原生 XpLevel，世界侧 tick 同步，cast 时直读刷新）。 */
  level: number
  /** 已解锁的稀有被动 id 列表。 */
  passives: string[]
  /** 生命体征缓存（HP/20，null = 未采到）。 */
  hpRatio: number | null
  /** 饱食度缓存（foodLevel/20，null = 未采到）。 */
  foodRatio: number | null
}

export interface MagicService {
  /** 全法术清单（候选池来源），含 id/名称/咒语词/三资源消耗。 */
  listAtoms(): AtomSummary[]
  getAtomById(id: string): AtomSummary | null
  getInnate(username: string): string | null
  setInnate(username: string, atomId: string): void
  getBackstory(username: string): string | null
  setBackstory(username: string, text: string): void
  getState(username: string): MagicPlayerView
  /**
   * 女神代施（慢路径）：以神力替祈愿者施展一项技艺。
   * 不校验等级、不扣祈愿者的魔力/饱食/生命（神力自担），也不记学习/经验。
   * 视觉特效（粒子/音效/大字）与快路径完全一致。返回执行结果描述。
   */
  castByGod(username: string, atomId: string, opts?: GodCastOpts): Promise<string>
  /**
   * 快路径施法（玩家自付三资源，含等级/魔力/参数校验）：
   * mc-god 私语分流命中关键词后调用，返回给施法者的结果描述。
   */
  castSpell(username: string, chant: string): Promise<string>
  /** 私语嗅探（分流用）：消息含任意法术关键词即真，不保证参数合法。 */
  sniffChant(message: string): boolean
  /* ── 成长体系（2026-08-17 路线 A 定稿：等级复用原生 XpLevel；魔力为体系自有属性）── */
  /** 魔力上限基础公式：100 + 12 × (XpLevel − 1)；最终 = 此值 + maxManaBonus。 */
  maxManaFor(level: number): number
  /** 体系自有加成：永久提升魔力上限（祝福/被动/供奉/仪式奖励等），返回新上限。 */
  addMaxManaBonus(username: string, amount: number): number
  /** 世界侧 tick 同步原生等级（null = 离线保留旧值）；同时校准 maxMana。 */
  setLevel(username: string, xpLevel: number | null): void
  /** 世界侧生命 tick 写入 hpRatio/foodRatio（∈[0,1]）。 */
  setVitals(username: string, hpRatio: number | null, foodRatio?: number | null): void
  /** 稀有被动解锁进度 +dtSec（只累不清零），返回累计秒数。 */
  addPassiveProgress(username: string, passiveId: string, dtSec: number): number
  getPassiveProgress(username: string, passiveId: string): number
  /** 解锁稀有被动（幂等），返回是否新解锁。 */
  unlockPassive(username: string, passiveId: string): boolean
  hasPassive(username: string, passiveId: string): boolean
  /* ── 成就解锁通道（2026-08-17 扛枪提议：MC 原生成就 = 第三条解锁通道「历练」）── */
  /** 成就已见登记（幂等），返回是否首次见到。 */
  addAdvancement(username: string, advId: string): boolean
  getAdvancements(username: string): string[]
  /** 成就通道授予法术（learn + 来源标记，绕过等级门槛）。 */
  learnViaAdvancement(username: string, atomId: string): void
  /* ── 天平引擎（2026-08-17：女神=世界维护者，动态平衡技能，热生效）── */
  /** 当前补丁列表（balance-overrides.json 的内存镜像）。 */
  listBalance(): BalancePatch[]
  /**
   * 施加一道平衡补丁：校验白名单+护栏 → 改内存 atoms/回蓝 → 持久化。
   * atomKey=null 或 '*' 表示全局字段（regenPerSec）；法术可用 id 或中文名。
   */
  applyBalancePatch(atomKey: string | null, field: string, value: number, by: string, reason?: string): BalanceResult
  /** 撤销补丁：atomKey 省略 = 清空全部；返回撤销条数。撤销后从基准表重放。 */
  resetBalance(atomKey?: string): number
  /**
   * 基准表热重载（创世之笔 2026-08-18）：从 magic-atoms.json 重新加载并重放
   * 天平补丁，返回加载后的法术总数。mc-saga 注入新咒文后调用。
   */
  reloadAtoms(): number
}

export interface GodCastOpts {
  direction?: string
  distance?: number
  item?: string
  count?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcMagic: MagicService
  }
}

// ── 数字梯度：默认原子指令表（可被 data/magic-atoms.json 覆盖）────────
// mana 上限 100 / 回蓝每秒 2.0（= Iron's 每秒 2% 上限，满蓝 50s）。
// 三资源消耗：mana=时间回蓝，food=吃回（data modify foodLevel），hp=血祭（damage magic 无视护甲）。
export const GIVE_WHITELIST: Record<string, string> = {
  '苹果': 'apple', '面包': 'bread', '熟牛肉': 'cooked_beef', '熟猪排': 'cooked_porkchop',
  '熟鸡肉': 'cooked_chicken', '熟鳕鱼': 'cooked_cod', '熟鲑鱼': 'cooked_salmon',
  '胡萝卜': 'carrot', '土豆': 'potato', '烤土豆': 'baked_potato', '西瓜': 'melon_slice',
  '橡木': 'oak_log', '木头': 'oak_log', '云杉木': 'spruce_log', '白桦木': 'birch_log',
  '木板': 'oak_planks', '木棍': 'stick', '圆石': 'cobblestone', '石头': 'stone',
  '煤': 'coal', '铁锭': 'iron_ingot', '铜锭': 'copper_ingot', '火把': 'torch',
  '木镐': 'wooden_pickaxe', '石镐': 'stone_pickaxe', '铁镐': 'iron_pickaxe',
  '木斧': 'wooden_axe', '石斧': 'stone_axe', '铁斧': 'iron_axe',
  '木剑': 'wooden_sword', '石剑': 'stone_sword', '铁剑': 'iron_sword',
  '木锹': 'wooden_shovel', '石锹': 'stone_shovel',
  // 基建/工作设施（穿越者要建家冶炼的需求）
  '熔炉': 'furnace', '高炉': 'blast_furnace', '工作台': 'crafting_table',
  '锻造台': 'smithing_table', '铁砧': 'anvil', '箱子': 'chest', '木桶': 'barrel',
  '玻璃': 'glass', '沙子': 'sand', '泥土': 'dirt', '石砖': 'stone_bricks',
  '梯子': 'ladder', '栅栏': 'oak_fence', '门': 'oak_door', '床': 'white_bed',
  '箭': 'arrow', '弓': 'bow', '盾牌': 'shield', '灯笼': 'lantern',
  '铁盔甲': 'iron_chestplate', '铁剑鞘': 'iron_helmet',
}

const DEFAULT_ATOMS: Atom[] = [
  {
    id: 'home', layer: 'effect', name: '归乡',
    words: ['归乡', '回家', '回基地', '归途', '回巢'],
    cost: { mana: 20, food: 0, hp: 0 },
    commands: ['tp {target} {bx} {by} {bz}'],
    reply: '空间之力涌动，你被送回基地。',
    particles: [
      'minecraft:portal {bx} {by+1} {bz} 0.5 0.5 0.5 0.3 80',
      'minecraft:end_rod {bx} {by+1} {bz} 0.4 0.4 0.4 0.05 50',
    ],
    sounds: ['minecraft:entity.enderman.teleport'],
    title: '归乡',
    subtitle: '空间之力，护你归途',
  },
  {
    id: 'tp', layer: 'effect', name: '空间传送',
    words: ['传送', '瞬移', '闪现', '撕裂虚空', '空间跳跃', '跃迁'],
    cost: { mana: 20, food: 0, hp: 0 },
    paramCosts: { distance: { mana: 5 } },
    params: {
      distance: { type: 'number', default: 5, max: 30 },
      direction: { type: 'direction', default: '东' },
    },
    commands: ['tp {target} {tx} {ty} {tz}'],
    reply: '虚空撕开一道裂缝，你向{direction}跃迁 {distance} 格。',
    particles: [
      'minecraft:end_rod {tx} {ty+1} {tz} 0.4 0.4 0.4 0.05 60',
      'minecraft:portal {tx} {ty+1} {tz} 0.5 0.5 0.5 0.3 50',
    ],
    sounds: ['minecraft:entity.enderman.teleport'],
    title: '撕裂虚空',
    subtitle: '向{direction}跃迁 {distance} 格',
  },
  {
    id: 'heal', layer: 'effect', name: '圣愈术',
    words: ['圣愈', '治愈', '治疗', '疗伤', '回血', '痊愈'],
    cost: { mana: 30, food: 0, hp: 0 },
    commands: [
      'effect give {target} minecraft:instant_health 1 1',
      'effect give {target} minecraft:saturation 1 20',
    ],
    reply: '柔和的光笼罩你，伤口愈合，饥饿缓解。',
    particles: [
      'minecraft:heart {px} {py+1} {pz} 0.6 0.6 0.6 0.1 25',
      'minecraft:glow {px} {py+1} {pz} 0.4 0.4 0.4 0.01 40',
    ],
    sounds: ['minecraft:block.enchantment_table.use'],
    title: '圣愈',
    subtitle: '柔和的光，抚平伤痛',
  },
  {
    id: 'feed', layer: 'effect', name: '饱食赐福',
    words: ['饱食', '充饥', '饱腹', '不饿', '充能'],
    cost: { mana: 20, food: 0, hp: 0 },
    commands: ['effect give {target} minecraft:saturation 1 99'],
    reply: '神力化作暖流，你的饥饿感消失了。',
    particles: ['minecraft:glow {px} {py+1} {pz} 0.5 0.5 0.5 0.01 30'],
    sounds: ['minecraft:block.note_block.chime'],
    title: '饱食赐福',
    subtitle: '暖流涌动，饥饿消散',
  },
  {
    id: 'give', layer: 'effect', name: '造物术',
    words: ['造物', '赐予', '给予', '赐下', '给我', '变出'],
    cost: { mana: 20, food: 0, hp: 0 },
    params: { item: { type: 'item', default: 'bread' } },
    commands: ['give {target} {item} {count}'],
    reply: '一件物资自虚空中凝聚，落入你的手中。',
    particles: ['minecraft:enchant {px} {py+1} {pz} 0.5 0.5 0.5 0.1 50'],
    sounds: ['minecraft:block.enchantment_table.use'],
    title: '造物',
    subtitle: '虚空中，物质凝成',
  },
  {
    id: 'light', layer: 'effect', name: '照明术',
    words: ['照明', '点火', '火把', '光亮', '照亮', '驱暗'],
    cost: { mana: 5, food: 0, hp: 0 },
    commands: ['give {target} minecraft:torch 4'],
    reply: '几根火把落入你的手中，照亮前路。',
    particles: ['minecraft:flame {px} {py+1} {pz} 0.3 0.3 0.3 0.02 30'],
    sounds: ['minecraft:block.fire.ambient'],
    title: '照明',
    subtitle: '火光，驱散黑暗',
  },
  {
    id: 'time_day', layer: 'effect', name: '破晓术',
    words: ['破晓', '天明', '白昼', '天亮', '日出', '驱夜'],
    cost: { mana: 60, food: 0, hp: 0 },
    commands: ['time set day'],
    reply: '太阳撕裂夜幕，世界重归白昼。',
    particles: [
      'minecraft:firework {px} {py+2} {pz} 0.5 0.5 0.5 0.01 25',
      'minecraft:glow {px} {py+2} {pz} 0.5 0.5 0.5 0.01 30',
    ],
    sounds: ['minecraft:block.beacon.activate'],
    title: '破晓',
    subtitle: '太阳，撕裂夜幕',
  },
  {
    id: 'weather_clear', layer: 'effect', name: '驱云术',
    words: ['驱云', '放晴', '晴空', '雨停', '云散'],
    cost: { mana: 35, food: 0, hp: 0 },
    commands: ['weather clear'],
    reply: '乌云散尽，天空放晴。',
    particles: ['minecraft:cloud {px} {py+2} {pz} 0.5 0.5 0.5 0.05 40'],
    sounds: ['minecraft:block.chain.break'],
    title: '驱云',
    subtitle: '乌云散尽，晴空万里',
  },
  {
    id: 'terraform', layer: 'effect', name: '大地塑形',
    words: ['塑形', '裂地', '掘土', '开辟', '平整', '挖地'],
    cost: { mana: 30, food: 6, hp: 0 },
    commands: ['fill {px} {py-1} {pz} {px} {py-1} {pz} minecraft:air'],
    reply: '你消耗体力（饱食度），重塑了脚下的大地。',
    particles: ['minecraft:poof {px} {py} {pz} 0.5 0.5 0.5 0.1 40'],
    sounds: ['minecraft:block.gravel.break'],
    title: '大地塑形',
    subtitle: '脚下大地，为你重塑',
  },
  {
    id: 'meteor', layer: 'effect', name: '陨石术',
    words: ['陨石', '天罚', '星陨', '神雷', '天雷', '雷击'],
    cost: { mana: 80, food: 0, hp: 15 },
    commands: ['summon minecraft:lightning_bolt {tx} {ty} {tz}'],
    reply: '你燃烧生命，召唤天雷轰击前方！',
    particles: [
      'minecraft:lava {tx} {ty+1} {tz} 0.3 0.3 0.3 0.05 30',
      'minecraft:flame {tx} {ty+1} {tz} 0.3 0.3 0.3 0.1 30',
    ],
    sounds: ['minecraft:entity.lightning_bolt.thunder'],
    title: '陨石',
    subtitle: '燃烧生命，天罚降临',
  },
]

// ── 中文数字 / 方向 / 物品 解析 ────────────────────────────────────────
const CN_DIGITS: Record<string, number> = {
  '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9,
}

function parseCnNumber(s: string): number {
  let total = 0
  let acc = 0
  for (const ch of s) {
    if (ch === '十') {
      total += (acc || 1) * 10
      acc = 0
    } else if (ch === '百') {
      total += (acc || 1) * 100
      acc = 0
    } else if (CN_DIGITS[ch] !== undefined) {
      acc = CN_DIGITS[ch]
    }
  }
  return total + acc
}

function extractNumber(s: string): number | null {
  const arabic = s.match(/(\d+)/)
  if (arabic) return parseInt(arabic[1], 10)
  const cn = s.match(/[零一二两三四五六七八九十百]+/)
  if (cn) return parseCnNumber(cn[0])
  return null
}

const DIR_VECTORS: Record<string, [number, number]> = {
  // 斜向组合（先于单字匹配，否则「东南」会被贪心命中「东」）；向量归一化，10 格东南=对角线共 10 格
  '东南': [Math.SQRT1_2, Math.SQRT1_2], '东北': [Math.SQRT1_2, -Math.SQRT1_2],
  '西南': [-Math.SQRT1_2, Math.SQRT1_2], '西北': [-Math.SQRT1_2, -Math.SQRT1_2],
  '东': [1, 0], '南': [0, 1], '西': [-1, 0], '北': [0, -1],
}

function extractDirection(s: string): string | null {
  for (const d of Object.keys(DIR_VECTORS)) {
    if (d.length === 2 && s.includes(d)) return d
  }
  for (const d of Object.keys(DIR_VECTORS)) {
    if (d.length === 1 && s.includes(d)) return d
  }
  return null
}

function extractItem(s: string): string | null {
  for (const [cn, en] of Object.entries(GIVE_WHITELIST)) {
    if (s.includes(cn)) return en
  }
  return null
}

// ── 匹配 / 参数 / 消耗 ─────────────────────────────────────────────────
function matchSpell(chant: string, atoms: Atom[]): { atom: Atom; params: Record<string, number | string> } | null {
  for (const atom of atoms) {
    if (atom.words.some((w) => chant.includes(w))) {
      return { atom, params: extractParams(chant, atom) }
    }
  }
  return null
}

// ── 咒语向量兜底（2026-08-20）：严格匹配失败 → bge-m3 语义建议，只荐不施 ──
const OLLAMA_EMBED_URL = process.env.OLLAMA_EMBED_URL ?? 'http://127.0.0.1:11434/api/embeddings'
const EMBED_MODEL = process.env.MC_EMBED_MODEL ?? 'bge-m3-cpu:latest'
const SUGGEST_THRESHOLD = 0.50 // PoC 定谳：低于此分的近邻不足以代言神意

let suggestCorpus: { vecs: number[][]; atoms: Atom[] } | null = null
let corpusBuilding: Promise<void> | null = null

async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(OLLAMA_EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const j = await res.json() as { embedding?: number[] }
    return Array.isArray(j.embedding) ? j.embedding : null
  } catch { return null }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d > 0 ? dot / d : 0
}

/** 预热语料库（apply 时后台跑一次；ollama 不在则静默弃用，不影响施法主路）。 */
function warmSuggestCorpus(atoms: Atom[]): void {
  if (corpusBuilding) return
  corpusBuilding = (async () => {
    const vecs: number[][] = []
    for (const a of atoms) {
      const v = await embedText(`法术：${a.name}。咒语词：${a.words.join('、')}。`)
      if (!v) return // 任一失败即弃（ollama 未起/超时），下次再试
      vecs.push(v)
    }
    suggestCorpus = { vecs, atoms }
  })().catch(() => {})
}

async function suggestSpell(chant: string, atoms: Atom[]): Promise<string | null> {
  if (!suggestCorpus) {
    warmSuggestCorpus(atoms) // 首次触发即预热，本次先走原文案
    return null
  }
  const qv = await embedText(chant)
  if (!qv) return null
  let best = { s: 0, idx: -1 }
  for (let i = 0; i < suggestCorpus.vecs.length; i++) {
    const s = cosine(qv, suggestCorpus.vecs[i])
    if (s > best.s) best = { s, idx: i }
  }
  if (best.idx < 0 || best.s < SUGGEST_THRESHOLD) return null
  const a = suggestCorpus.atoms[best.idx]
  return `你的低语隐约有法力波动——或许汝意欲【${a.name}】？直念「${a.words[0]}」即可施展（需 Lv${a.requiredLevel ?? 1}，耗魔 ${a.cost.mana}）。` +
    `若非此意，直述所求向女神祈愿便是。`
}

function extractParams(chant: string, atom: Atom): Record<string, number | string> {
  const params: Record<string, number | string> = {}
  if (!atom.params) return params
  for (const [pname, spec] of Object.entries(atom.params)) {
    if (spec.type === 'number') {
      const n = extractNumber(chant)
      const capped = n !== null ? Math.min(spec.max ?? n, n) : null
      params[pname] = capped ?? (spec.default as number)
    } else if (spec.type === 'direction') {
      params[pname] = extractDirection(chant) ?? (spec.default as string)
    } else if (spec.type === 'item') {
      params[pname] = extractItem(chant) ?? (spec.default as string)
    }
  }
  return params
}

function computeCost(atom: Atom, params: Record<string, number | string>): CostSpec {
  const cost: CostSpec = { ...atom.cost }
  if (atom.paramCosts) {
    for (const [pname, pc] of Object.entries(atom.paramCosts)) {
      if (!pc) continue
      const val = typeof params[pname] === 'number' ? (params[pname] as number) : 0
      if (pc.mana) cost.mana += pc.mana * val
      if (pc.food) cost.food += pc.food * val
      if (pc.hp) cost.hp += pc.hp * val
    }
  }
  return cost
}

// ── 命令渲染：{name} 或 {name±offset} 占位符 ───────────────────────────
function renderCommand(cmd: string, vars: Record<string, number | string>): string {
  return cmd.replace(/\{([a-z]+)([+-]\d+)?\}/g, (_m, key: string, off?: string) => {
    const base = vars[key]
    if (typeof base === 'number') {
      return String(Math.round(base + (off ? parseInt(off, 10) : 0)))
    }
    return String(base ?? '')
  })
}

// ── 状态库（属性面板 + 惰性回蓝）──────────────────────────────────────
export interface PlayerMagicState {
  mana: number
  /** 最终魔力上限 = 基础公式 maxManaFor(level) + 体系自有加成 maxManaBonus。 */
  maxMana: number
  /**
   * 魔力上限自有加成（2026-08-17 路线 A 补充：魔力是技能体系自有属性，不映射原生条）。
   * 祝福/稀有被动/供奉回报/仪式奖励等自有机制叠加；与等级解耦，独立拓展。
   */
  maxManaBonus: number
  learned: string[]
  lastUpdate: number
  /** 降临仪式自选的初始技能（atom id），出生天赋，降临即已学会。 */
  innateSkill: string | null
  /** 背景故事（前世）摘要，供天神主持降临 / 世界观参考。 */
  backstory: string | null
  /** 魔力层级（路线 A：真源 = MC 原生 XpLevel，tick/cast 同步；挖矿杀怪施法供奉皆可提升）。 */
  level: number
  /** 生命体征缓存（世界侧生命 tick 每 20s 刷新；离线为旧值）。hpRatio = Health/20。 */
  hpRatio: number | null
  /** 饱食度缓存（foodRatio = foodLevel/20，null = 未采到）。 */
  foodRatio: number | null
  /** 已解锁的稀有被动（skill-events.json 里的 id，如 fortitude）。 */
  passives: string[]
  /** 被动解锁进度（秒，只累不清零——苦难是累计的）。 */
  passiveProgress: Record<string, number>
  /** 已见的 MC 原生成就 id（advancement 轮询 diff 基线，重启不重放公告）。 */
  advancements: string[]
  /** 由成就解锁的法术 atom id（learned 的子集；面板标注来源 🏆 历练）。 */
  advancementSkills: string[]
}

interface MagicStateFile {
  version: 1
  players: Record<string, PlayerMagicState>
}

export class MagicStateStore {
  private state: MagicStateFile
  private readonly path: string
  private readonly maxManaDefault: number
  private readonly regenPerSec: number
  private regenPerSecNow: number

  constructor(path: string, maxManaDefault: number, regenPerSec: number) {
    this.path = resolve(path)
    this.maxManaDefault = maxManaDefault
    this.regenPerSec = regenPerSec
    this.regenPerSecNow = regenPerSec
    this.state = this.load()
  }

  private load(): MagicStateFile {
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, 'utf-8'))
        if (raw && typeof raw === 'object' && raw.version === 1) return raw as MagicStateFile
      }
    } catch (err) {
      console.error(`[mc-magic] failed to load state: ${err instanceof Error ? err.message : String(err)}`)
    }
    return { version: 1, players: {} }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = this.path + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8')
      renameSync(tmp, this.path)
    } catch (err) {
      console.error(`[mc-magic] failed to save state: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 惰性回蓝：结算到 now，返回该玩家状态。 */
  get(username: string, now = Date.now()): PlayerMagicState {
    let p = this.state.players[username]
    if (!p) {
      p = this.state.players[username] = {
        mana: this.maxManaDefault,
        maxMana: this.maxManaDefault,
        maxManaBonus: 0,
        learned: [],
        lastUpdate: now,
        innateSkill: null,
        backstory: null,
        level: 1,
        hpRatio: null,
        foodRatio: null,
        passives: [],
        passiveProgress: {},
        advancements: [],
        advancementSkills: [],
      }
    }
    // 兜底：旧版状态文件缺字段时补默认值（exp 字段已随路线 A 废弃，读到的旧值忽略）。
    if (p.innateSkill === undefined) p.innateSkill = null
    if (p.backstory === undefined) p.backstory = null
    if (p.level === undefined) p.level = 1
    if (p.maxManaBonus === undefined) p.maxManaBonus = 0
    // 防漂移：最终魔力上限 = 等级基础公式 + 体系自有加成（旧文件手写 maxMana 以此为准）。
    p.maxMana = this.maxManaFor(p.level) + p.maxManaBonus
    if (p.hpRatio === undefined) p.hpRatio = null
    if (p.foodRatio === undefined) p.foodRatio = null
    if (p.passives === undefined) p.passives = []
    if (p.passiveProgress === undefined) p.passiveProgress = {}
    if (p.advancements === undefined) p.advancements = []
    if (p.advancementSkills === undefined) p.advancementSkills = []
    const dt = (now - p.lastUpdate) / 1000
    if (dt > 0) {
      p.mana = Math.min(p.maxMana, p.mana + dt * this.regenRateFor(p))
    }
    p.lastUpdate = now
    return p
  }

  /** 回蓝速率（点/秒）：基础 regenPerSecNow × 稀有被动倍率（坚毅：HP<30% 时 ×2）。 */
  private regenRateFor(p: PlayerMagicState): number {
    let rate = this.regenPerSecNow
    if (p.hpRatio !== null && p.hpRatio < 0.3 && p.passives.includes('fortitude')) rate *= 2.0
    return rate
  }

  /** 天平引擎：运行时热调基础回蓝速率（点/秒），立即生效（惰性结算下次读写即用新值）。 */
  setRegenPerSec(v: number): void {
    this.regenPerSecNow = v
  }

  getRegenPerSec(): number {
    return this.regenPerSecNow
  }

  spendMana(username: string, amount: number, now = Date.now()): void {
    const p = this.get(username, now)
    // 双向钳制：正数扣魔不透支，负数（逆转化：燃血/炼食换魔）不溢出上限。
    p.mana = Math.min(p.maxMana, Math.max(0, p.mana - amount))
    p.lastUpdate = now
    this.save()
  }

  learn(username: string, atomId: string): void {
    const p = this.get(username)
    if (!p.learned.includes(atomId)) {
      p.learned.push(atomId)
      this.save()
    }
  }

  /** 成就已见登记（幂等）；返回是否首次见到（true = 需要 公告/编年史/解锁检查）。 */
  addAdvancement(username: string, advId: string): boolean {
    const p = this.get(username)
    if (p.advancements.includes(advId)) return false
    p.advancements.push(advId)
    this.save()
    return true
  }

  getAdvancements(username: string): string[] {
    return [...this.get(username).advancements]
  }

  /** 成就解锁通道授予法术（learn + advancementSkills 标记来源；绕过等级门槛）。 */
  learnViaAdvancement(username: string, atomId: string): void {
    const p = this.get(username)
    if (!p.learned.includes(atomId)) p.learned.push(atomId)
    if (!p.advancementSkills.includes(atomId)) p.advancementSkills.push(atomId)
    this.save()
  }

  /**
   * 魔力上限基础公式（2026-08-17 路线 A：等级全复用 MC 原生 XpLevel）。
   * base = 100 + 12 × (XpLevel − 1)；最终上限 = base + 体系自有加成 maxManaBonus。
   */
  maxManaFor(level: number): number {
    return this.maxManaDefault + 12 * Math.max(0, level - 1)
  }

  /**
   * 体系自有加成：永久提升魔力上限（祝福/被动/供奉回报/仪式奖励等自有机制用）。
   * 立即校准 maxMana 并落盘，返回新上限。
   */
  addMaxManaBonus(username: string, amount: number): number {
    const p = this.get(username)
    p.maxManaBonus = Math.max(0, p.maxManaBonus + Math.round(amount))
    p.maxMana = this.maxManaFor(p.level) + p.maxManaBonus
    this.save()
    return p.maxMana
  }

  /**
   * 世界侧同步原生等级（tick 读 XpLevel 后写入；施法门槛判定/属性面板用）。
   * 传入 null = 玩家离线，保留旧值。
   */
  setLevel(username: string, xpLevel: number | null): void {
    if (xpLevel === null) return
    const p = this.get(username)
    p.level = Math.max(0, xpLevel)
    p.maxMana = this.maxManaFor(p.level) + p.maxManaBonus
    // 不 save()——高频 tick 落盘交给下一次施法/解锁的 save()。
  }

  /** 世界侧生命体征 tick 写入（hpRatio/foodRatio ∈ [0,1]，离线传 null 暂存旧值亦可；foodRatio 省略则保留旧值）。 */
  setVitals(username: string, hpRatio: number | null, foodRatio?: number | null): void {
    const p = this.get(username)
    p.hpRatio = hpRatio
    if (foodRatio !== undefined) p.foodRatio = foodRatio
    // 注意：不 save()——高频 tick 只改内存，随下一次施法/解锁的 save() 一并落盘。
  }

  /** 稀有被动解锁进度 +dtSec（只累不清零）；返回该被动累计秒数。 */
  addPassiveProgress(username: string, passiveId: string, dtSec: number): number {
    const p = this.get(username)
    p.passiveProgress[passiveId] = (p.passiveProgress[passiveId] ?? 0) + dtSec
    return p.passiveProgress[passiveId]
  }

  getPassiveProgress(username: string, passiveId: string): number {
    return this.get(username).passiveProgress[passiveId] ?? 0
  }

  /** 解锁稀有被动（幂等）；返回是否新解锁。 */
  unlockPassive(username: string, passiveId: string): boolean {
    const p = this.get(username)
    if (p.passives.includes(passiveId)) return false
    p.passives.push(passiveId)
    this.save()
    return true
  }

  hasPassive(username: string, passiveId: string): boolean {
    return this.get(username).passives.includes(passiveId)
  }

  getLevel(username: string): number {
    return this.get(username).level
  }

  /** 记录降临仪式自选的初始技能，并预置为已学会（出生天赋）。 */
  setInnate(username: string, atomId: string): void {
    const p = this.get(username)
    p.innateSkill = atomId
    if (!p.learned.includes(atomId)) p.learned.push(atomId)
    this.save()
  }

  getInnate(username: string): string | null {
    return this.get(username).innateSkill
  }

  setBackstory(username: string, text: string): void {
    const p = this.get(username)
    p.backstory = text
    this.save()
  }

  getBackstory(username: string): string | null {
    return this.get(username).backstory
  }
}

// ── 插件主体 ───────────────────────────────────────────────────────────
export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-magic] ${msg}`)
  // 向量兜底语料预热（后台一次性；ollama 未起则静默弃用）
  setTimeout(() => warmSuggestCorpus(atoms), 3_000)
  // 女神化身 = 世界进程的 mineflayer bot（旁观者），是世界之眼：
  // 听公屏、看所有玩家位置、替天神开口。重连会换实例，须每次现取。
  const getBot = (): Bot => ctx.mcbot
  const rcon: RconService = ctx.mcRcon

  // ── 世界史官：把大事记写入女神的编年史（mc-god 提供，可选注入）────
  // 咏唱/升级/降临天赋都发生在 mc-magic，由这里上报；
  // 女神侧（mc-god）另记祈愿/神谕/供奉/陨落。运行时才调用（非装配期），
  // 可选链 + try/catch：mc-god 未就位时静默跳过，不阻碍施法。
  const chronicle = (type: string, actor: string, detail: Record<string, unknown>): void => {
    try {
      (ctx as any).mcGod?.record?.(type, actor, detail)
    } catch { /* 史官不在场，不阻碍世界运转 */ }
  }

  // ── 施法台账（2026-08-17）：技能使用=服务器问题信号 ──────────────
  // 每次成功施法追加一行 JSONL（data/skill-usage.jsonl）。分析口径：
  //   - 高频 tp（尤其脱困语义）→ 寻路/地形/服务器稳定性问题的定位线索；
  //   - 各原子使用频率 → 平衡性调整（天平拨正）的数据依据；
  //   - 与 bot 侧 mc-brain.log 按 ts 邻近 join，可还原"为什么施法"的 goal 上下文。
  // 台账只增不改，分析走离线脚本（analyze-skill-usage.mts）。
  interface SkillUsageEntry {
    ts: string; player: string; atom: string; chant: string
    mana: number; food: number; hp: number
    manaLeft: number; maxMana: number; level: number
  }
  const usagePath = resolve(dirname(resolve(config.statePath)), 'skill-usage.jsonl')
  const appendSkillUsage = (e: SkillUsageEntry): void => {
    try {
      mkdirSync(dirname(usagePath), { recursive: true })
      appendFileSync(usagePath, JSON.stringify(e) + '\n', 'utf8')
    } catch { /* 台账失败不影响施法 */ }
  }

  // ── 世界清扫：滞留风爆弹 ──────────────────────────────────────────
  // windburst 咒语召唤的 wind_charge 爆炸后可能残留漂浮实体；它们炸到实体时
  // 服务端击退 mineflayer 客户端无法模拟（易造成位置失同步），且污染 bot 的
  // 环境感知。每 60s 清扫一次（新鲜咒弹接触即爆，不受影响，只清哑弹）。
  const sweepWindCharges = async (): Promise<void> => {
    try {
      await rcon.send('kill @e[type=minecraft:wind_charge]')
    } catch { /* RCON 短暂不可用时跳过，下一轮再扫 */ }
    ctx.setTimeout(sweepWindCharges, 60_000)
  }
  ctx.setTimeout(sweepWindCharges, 60_000)

  // 原子指令表：外置 JSON 覆盖内嵌默认（服务器适配改数字/命令不用改代码）
  const atomsPath = resolve(config.atomsPath)
  const loadBaseAtoms = (): Atom[] => {
    if (existsSync(atomsPath)) {
      try {
        const raw = JSON.parse(readFileSync(atomsPath, 'utf-8'))
        const list = Array.isArray(raw) ? raw : raw?.atoms
        if (Array.isArray(list)) return list as Atom[]
      } catch { /* 基准表损坏 → 回落默认 */ }
    }
    return DEFAULT_ATOMS
  }
  let atoms: Atom[] = loadBaseAtoms()
  log(`loaded ${atoms.length} atoms from ${atomsPath}`)

  // ── 天平引擎（覆盖层）：基准表只读，补丁热更 ─────────────────────
  // 启动时按序套用 balance-overrides.json；运行时经 applyBalancePatch 追加；
  // resetBalance 从基准表重载再重放余下补丁。所有方法零 LLM、同步生效。
  const store = new MagicStateStore(config.statePath, config.maxManaDefault, config.regenPerSec)
  let balancePatches: BalancePatch[] = []
  const balancePath = resolve(config.balancePath)
  const applyPatchToAtoms = (p: BalancePatch): boolean => {
    if (p.field === 'regenPerSec') {
      store.setRegenPerSec(p.value)
      return true
    }
    const spec = BALANCE_FIELDS[p.field]
    if (!spec) return false
    const a = atoms.find((x) => x.id === p.atom)
    if (!a) return false
    spec.set(a, p.value)
    return true
  }
  try {
    if (existsSync(balancePath)) {
      const raw = JSON.parse(readFileSync(balancePath, 'utf-8'))
      if (Array.isArray(raw?.patches)) {
        balancePatches = raw.patches as BalancePatch[]
        let applied = 0
        for (const p of balancePatches) if (applyPatchToAtoms(p)) applied++
        if (balancePatches.length) log(`balance layer: ${applied}/${balancePatches.length} patch(es) applied from ${balancePath}`)
      }
    }
  } catch (err) {
    log(`failed to load balance overrides (ignored): ${err instanceof Error ? err.message : String(err)}`)
  }
  const saveBalanceFile = (): void => {
    writeFileSync(balancePath, JSON.stringify({ version: 1, patches: balancePatches }, null, 2), 'utf-8')
  }


  const service: MagicService = {
    listAtoms: () => atoms.map((a) => ({ id: a.id, name: a.name, words: [...a.words], cost: { ...a.cost }, requiredLevel: a.requiredLevel ?? 1 })),
    getAtomById: (id) => {
      const a = atoms.find((x) => x.id === id)
      return a ? { id: a.id, name: a.name, words: [...a.words], cost: { ...a.cost }, requiredLevel: a.requiredLevel ?? 1 } : null
    },
    getInnate: (u) => store.getInnate(u),
    setInnate: (u, id) => {
      store.setInnate(u, id)
      chronicle('innate', u, { skill: id })
    },
    addAdvancement: (u, id) => store.addAdvancement(u, id),
    getAdvancements: (u) => store.getAdvancements(u),
    learnViaAdvancement: (u, id) => store.learnViaAdvancement(u, id),
    /* 天平引擎：女神动态平衡 */
    listBalance: () => balancePatches.map((p) => ({ ...p })),
    applyBalancePatch: (atomKey, field, value, by, reason) => {
      if (field in BALANCE_GLOBALS) {
        // 全局字段（regenPerSec）：改回蓝速率，立即生效
        const g = BALANCE_GLOBALS[field]
        const v = Math.round(value * 10) / 10
        if (v < g.min || v > g.max) return { ok: false, error: `${g.label}须在 ${g.min}~${g.max} 之间` }
        const before = store.getRegenPerSec()
        store.setRegenPerSec(v)
        balancePatches = balancePatches.filter((p) => !(p.atom === '*' && p.field === field))
        balancePatches.push({ atom: '*', field, value: v, by, reason, at: Date.now() })
        saveBalanceFile()
        return { ok: true, summary: `回蓝速率 ${before} → ${v} 点/秒` }
      }
      const spec = BALANCE_FIELDS[field]
      if (!spec) {
        return { ok: false, error: `不可调字段「${field}」——可调：${Object.values(BALANCE_FIELDS).map((s) => s.label).join('、')}、回蓝` }
      }
      const key = (atomKey ?? '').trim()
      const a = atoms.find((x) => x.id === key) ?? atoms.find((x) => x.name === key)
      if (!a) return { ok: false, error: `未知法术「${atomKey}」` }
      if (!Number.isInteger(value)) return { ok: false, error: `${spec.label}须为整数` }
      if (value < spec.min || value > spec.max) return { ok: false, error: `「${a.name}」${spec.label}须在 ${spec.min}~${spec.max} 之间` }
      const before = spec.get(a)
      spec.set(a, value)
      balancePatches = balancePatches.filter((p) => !(p.atom === a.id && p.field === field))
      balancePatches.push({ atom: a.id, field, value, by, reason, at: Date.now() })
      saveBalanceFile()
      return { ok: true, summary: `「${a.name}」${spec.label} ${before} → ${value}` }
    },
    resetBalance: (atomKey) => {
      const before = balancePatches.length
      if (atomKey === undefined || atomKey === null || atomKey === '*') {
        balancePatches = []
      } else {
        const key = atomKey.trim()
        const a = atoms.find((x) => x.id === key) ?? atoms.find((x) => x.name === key)
        if (!a) return 0
        balancePatches = balancePatches.filter((p) => p.atom !== a.id)
      }
      const removed = before - balancePatches.length
      if (removed > 0) {
        // 基准表重载 + 回蓝回默认 + 余下补丁重放
        atoms = loadBaseAtoms()
        store.setRegenPerSec(config.regenPerSec)
        for (const p of balancePatches) applyPatchToAtoms(p)
        saveBalanceFile()
      }
      return removed
    },
    reloadAtoms: () => {
      // 创世之笔：基准表热重载 + 回蓝复位 + 补丁重放（与 resetBalance 同构）
      atoms = loadBaseAtoms()
      store.setRegenPerSec(config.regenPerSec)
      for (const p of balancePatches) applyPatchToAtoms(p)
      log(`reloaded ${atoms.length} atoms (saga)`)
      return atoms.length
    },
    getBackstory: (u) => store.getBackstory(u),
    setBackstory: (u, t) => store.setBackstory(u, t),
    getState: (u) => {
      const p = store.get(u)
      return {
        mana: p.mana,
        maxMana: p.maxMana,
        maxManaBonus: p.maxManaBonus,
        learned: [...p.learned],
      advancementSkills: [...p.advancementSkills],
        innateSkill: p.innateSkill,
        backstory: p.backstory,
        level: p.level,
        passives: [...p.passives],
        hpRatio: p.hpRatio,
        foodRatio: p.foodRatio,
      }
    },
    maxManaFor: (level) => store.maxManaFor(level),
    addMaxManaBonus: (u, amount) => store.addMaxManaBonus(u, amount),
    setLevel: (u, xpLevel) => store.setLevel(u, xpLevel),
    setVitals: (u, hpRatio, foodRatio) => store.setVitals(u, hpRatio, foodRatio),
    addPassiveProgress: (u, id, dtSec) => store.addPassiveProgress(u, id, dtSec),
    getPassiveProgress: (u, id) => store.getPassiveProgress(u, id),
    unlockPassive: (u, id) => store.unlockPassive(u, id),
    hasPassive: (u, id) => store.hasPassive(u, id),
    castByGod: (username, atomId, opts) => castByGod(username, atomId, opts),
    castSpell: (username, chant) => cast(username, chant),
    sniffChant: (msg) => atoms.some((a) => a.words.some((w) => msg.includes(w))),
  }
  ctx.provide('mcMagic', service)

  /** RCON 查询实体数值字段，返回数字或 null。 */
  async function getEntityNumber(target: string, path: string): Promise<number | null> {
    return rcon.getEntityNumber(target, path)
  }

  // ── 视觉渲染（纯 vanilla：粒子 / 音效 / 大字，零 mod）──────────────
  async function castVfx(atom: Atom, vars: Record<string, number | string>, target: string): Promise<void> {
    // 粒子：每条是 /particle 参数模板（type x y z dx dy dz speed count）
    for (const p of atom.particles ?? []) {
      const out = await rcon.send(`particle ${renderCommand(p, vars)}`)
      if (out) log(`vfx particle[${p}] -> ${out.trim()}`)
    }
    // 音效：相对施法者位置播放（master 频道，全图可闻）
    for (const s of atom.sounds ?? []) {
      const out = await rcon.send(`playsound ${s} master ${target} ${vars.px} ${vars.py} ${vars.pz} 1 1`)
      if (out) log(`vfx sound[${s}] -> ${out.trim()}`)
    }
    // 大字咏唱词 + 副标题（金色主标题 / 黄色副标题）
    if (atom.title) {
      const t = renderCommand(atom.title, vars)
      await rcon.send(`title ${target} title ${JSON.stringify({ text: t, color: 'gold', bold: true })}`)
    }
    if (atom.subtitle) {
      const st = renderCommand(atom.subtitle, vars)
      await rcon.send(`title ${target} subtitle ${JSON.stringify({ text: st, color: 'yellow' })}`)
    }
  }

  // ── 鉴定（2026-08-17）：零命令原子，动态报告自身能力值与秘法掌握情况 ──────
  /** 被动 id → 名（skill-events.json 与天神侧共用一份配置；读不到退回 id）。 */
  function loadPassiveNames(): (ids: string[]) => string[] {
    let map: Record<string, string> | null = null
    try {
      const p = resolve('./data/skill-events.json')
      if (existsSync(p)) {
        const raw = JSON.parse(readFileSync(p, 'utf-8')) as { passives?: { id: string; name?: string }[] }
        map = {}
        for (const d of raw.passives ?? []) map[d.id] = d.name ?? d.id
      }
    } catch { /* 名字缺失不致命 */ }
    return (ids) => ids.map((id) => map?.[id] ?? id)
  }

  async function doAppraise(username: string, manaCost: number): Promise<string> {
    const st = store.get(username) // 惰性结算回蓝
    store.spendMana(username, manaCost)

    const [xpP, health, food, armorOut] = await Promise.all([
      rcon.getEntityNumber(username, 'XpP').catch(() => null),
      rcon.getEntityNumber(username, 'Health').catch(() => null),
      rcon.getEntityNumber(username, 'foodLevel').catch(() => null),
      rcon.send(`attribute ${username} minecraft:armor get`).catch(() => ''),
    ])
    const armorM = armorOut.match(/-?\d+(\.\d+)?/)
    const armor = armorM ? parseFloat(armorM[0]) : null

    const summaries: AtomSummary[] = atoms.map((a) => ({
      id: a.id, name: a.name, words: a.words, cost: a.cost, requiredLevel: a.requiredLevel ?? 1,
    }))
    const innateName = st.innateSkill
      ? atoms.find((a) => a.id === st.innateSkill)?.name ?? st.innateSkill
      : null
    const passiveNames = loadPassiveNames()(st.passives)

    const { panel, summary } = buildAppraisalReport(
      {
        player: username,
        level: st.level,
        xpProgress: xpP,
        mana: st.mana,
        maxMana: st.maxMana,
        maxManaBonus: st.maxManaBonus,
        innateName,
        passiveNames,
        health,
        food,
        armor,
      },
      summaries,
      st.innateSkill,
    )

    // 私发面板（含换行，仅施法者可见）+ 附魔台音效；公屏只留一句摘要（由调用方转述）
    try {
      await rcon.send(`tellraw ${username} ${JSON.stringify({ text: panel, color: 'aqua' })}`)
      await rcon.send(`playsound minecraft:block.enchantment_table.use master ${username}`)
    } catch { /* 面板失败不影响摘要 */ }
    chronicle('appraise', username, { level: st.level, mana: st.mana, maxMana: st.maxMana, innate: st.innateSkill })
    log(`appraise ${username}: Lv.${st.level}, mana ${Math.floor(st.mana)}/${st.maxMana}, mastered/in total`)
    return summary
  }

  // ── 核心施法 ─────────────────────────────────────────────────────────
  async function cast(username: string, chant: string): Promise<string> {
    const match = matchSpell(chant, atoms)
    if (!match) {
      // 向量兜底（2026-08-20 造物主谕：严格匹配是铁律，但失败时给 Agent 一条明路）：
      // bge-m3 语义近邻，只建议、绝不代施（阈值 0.50，PoC 实证「石头」会撞陨石术）。
      const hint = await suggestSpell(chant, atoms).catch(() => null)
      if (hint) return hint
      return `「${chant}」并未构成任何已知魔法。也许是咒语不对，或者你尚未悟得此法。`
    }
    const { atom, params } = match
    const cost = computeCost(atom, params)

    // 结算回蓝 + 等级校验（出生天赋 = 与生俱来的能力，豁免等级门槛）
    // 路线 A：等级真源 = MC 原生 XpLevel，cast 时直读（tick 缓存最多滞后 20s，门槛判定必须准确）
    const pstate = store.get(username)
    let liveLevel = pstate.level
    try {
      const xp = await rcon.getEntityNumber(username, 'XpLevel')
      if (xp !== null) {
        store.setLevel(username, xp)
        liveLevel = xp
      }
    } catch { /* RCON 失败退回缓存 */ }
    const requiredLevel = atom.requiredLevel ?? 1
    if (requiredLevel > liveLevel && pstate.innateSkill !== atom.id) {
      return `「${atom.name}」是 ${requiredLevel} 级的秘法，你的魔力层级才 ${liveLevel} 级，强行咏唱只会反噬。挖矿、历练、施法、供奉皆可积攒修为（头顶绿条就是你的修为层级）。`
    }

    // item 参数没解析出来：不 fallback 面包，而是让女神指出不识此物
    if (atom.params?.item && !params.item) {
      return `你想以「${atom.name}」造物，但天神不识此物。已知的可造之物：${Object.keys(GIVE_WHITELIST).join('、')}。换一种说法试试（如「造物赐我熔炉」）。`
    }

    if (cost.mana > pstate.mana + 0.001) {
      return `你咏唱「${atom.name}」，但魔力不足：需要 ${cost.mana} 点，你只有 ${Math.floor(pstate.mana)} 点。静候片刻待魔力恢复。`
    }

    // 逆转化（cost.mana < 0，燃血/炼食换魔）：魔力盈满时拒绝——白白的牺牲。
    if (cost.mana < 0 && pstate.mana >= pstate.maxMana - 0.001) {
      return `你的魔力已盈满（${Math.floor(pstate.mana)}/${pstate.maxMana}），不必以身相搏，静待时机再燃。`
    }

    // 鉴定：零命令原子，不需要立足点/实体位置，早于通用结算返回
    if (atom.id === 'appraise') {
      return doAppraise(username, cost.mana)
    }

    const bot = getBot()
    if (!bot.entity) return '天神尚未注视此界（女神化身离线），无法施法。'

    // 施法主体位置：任何玩家（AI bot 或真人）念咒，取其在世界中的立足点。
    // 女神化身是旁观者，近处直接看实体；远处实体跟踪丢失时用 RCON 兜底。
    const entityPos = bot.players[username]?.entity?.position
    const pos = entityPos ? { x: entityPos.x, y: entityPos.y, z: entityPos.z } : await rcon.getPos(username)
    if (!pos) return '你尚未在此界立足（未出生/离线），无法施法。'
    const px = Math.round(pos.x)
    const py = Math.round(pos.y)
    const pz = Math.round(pos.z)

    const distance = typeof params.distance === 'number' ? (params.distance as number) : 0
    const dirVec = DIR_VECTORS[String(params.direction ?? '东')] ?? [1, 0]
    const tx = px + dirVec[0] * distance
    const ty = py
    const tz = pz + dirVec[1] * distance

    const item = String(params.item ?? 'bread')
    const count = 1

    // 归乡：家的真相 = 玩家重生点（床）。没睡过床时回落初始之地城镇中心，
    // 不再失败劝退（2026-08-19 修订）。
    let bx = 0
    let by = 0
    let bz = 0
    let homeToTown = false
    if (atom.id === 'home') {
      const spawn = await rcon.getSpawn(username)
      if (spawn) {
        bx = spawn.x
        by = spawn.y
        bz = spawn.z
      } else {
        bx = TOWN_SPAWN.x
        by = TOWN_SPAWN.y
        bz = TOWN_SPAWN.z
        homeToTown = true
      }
    }

    const vars: Record<string, number | string> = {
      target: username, bx, by, bz, px, py, pz, tx, ty, tz, item, count, distance,
    }

    // 通灵契约（2026-08-18）：命令含 {puuid} 或带 ownLimit 时，取施法者 UUID（I;a,b,c,d 格式）
    if (atom.commands.some((c) => c.includes('{puuid}')) || atom.ownLimit) {
      const raw = await rcon.send(`data get entity ${username} UUID`)
      const m = /\[I;\s*([-\d,\s]+)\]/.exec(raw || '')
      if (!m) return `无法感知你的灵魂印记（UUID），「${atom.name}」未成。`
      vars.puuid = `I;${m[1].replace(/\s+/g, '')}`
    }
    // ownLimit 防刷：名下已有同种契约兽在场则拒绝（RCON NBT Owner 选择器，实测 Count 精确）
    if (atom.ownLimit) {
      const range = atom.ownLimit.range ?? 96
      const sel = `@e[type=${atom.ownLimit.entity},distance=..${range},nbt={Owner:[${vars.puuid}]}]`
      const out = await rcon.send(`execute if entity ${sel}`)
      if (/passed/i.test(out || '')) {
        log(`ownLimit hit: ${username} already has ${atom.ownLimit.entity} within ${range}`)
        return atom.ownLimit.denyReply ?? `你的契约之兽仍守在身边（${range}格内已有一只）——通灵之门一次只为一人开。`
      }
    }

    try {
      // 校验 + 扣 hp（血祭，damage magic 无视护甲；留 1 滴血防误杀）
      if (cost.hp > 0) {
        const hp = await getEntityNumber(username, 'Health')
        if (hp !== null && hp <= cost.hp + 1) {
          return `「${atom.name}」需要燃烧 ${cost.hp} 点生命，但你只剩 ${Math.round(hp)} 点，强行施展会殒命。`
        }
      }
      // 校验 + 扣 food（data modify foodLevel）
      if (cost.food > 0) {
        const food = await getEntityNumber(username, 'foodLevel')
        if (food === null) return '无法感知你的饱食度，施法失败。'
        if (food < cost.food) {
          return `「${atom.name}」需要消耗 ${cost.food} 点饱食度，但你太饿了（只剩 ${food} 点），先吃点东西吧。`
        }
      }

      // 扣 mana（程序化状态库）
      store.spendMana(username, cost.mana)

      // 扣 hp
      if (cost.hp > 0) {
        await rcon.send(`damage ${username} ${cost.hp} minecraft:magic`)
      }
      // 扣 food
      if (cost.food > 0) {
        const food = await getEntityNumber(username, 'foodLevel')
        if (food !== null) {
          const out = await rcon.send(`data modify entity ${username} foodLevel set value ${Math.max(0, food - cost.food)}`)
          if (/unable to modify player data/i.test(out)) {
            // 1.21+ 禁止 /data modify 玩家 NBT → hunger 效果兜底：amp 39 ≈ 1 food/s（先耗饱和度再掉饱食）
            const secs = Math.min(10, Math.ceil(cost.food))
            await rcon.send(`effect give ${username} minecraft:hunger ${secs} 39 true`)
            log(`food deduction fallback (player NBT locked): hunger ${secs}s ≈ ${cost.food} food for ${username}`)
          }
        }
      }
      // 法术效果命令
      for (const cmd of atom.commands.map((c) => renderCommand(c, vars))) {
        const out = await rcon.send(cmd)
        if (out) log(`rc[${cmd}] -> ${out.trim()}`)
      }

      // 视觉：粒子 + 音效 + 大字咏唱词
      await castVfx(atom, vars, username)

      store.learn(username, atom.id)

      // 经验结算（2026-08-17 节律修订）：纯魔力施法不给修为（防止"越施法越强"的
      // 滥用循环，修为回归生存行为主导）；只有付出生命/饱食代价的施法才给修为
      // （越拼命成长越快）。升级检测与公告由世界侧 tick 的 ΔXpLevel 统一做。
      const sacrificed = cost.hp > 0 || cost.food > 0
      const expGain = sacrificed ? Math.max(1, Math.round(cost.mana / 5)) + cost.hp * 2 + cost.food : 0
      if (expGain > 0) {
        try {
          await rcon.send(`xp add ${username} ${expGain} points`)
        } catch { /* 经验注入失败不影响施法结算 */ }
      }
      const levelAfter = store.get(username).level

      const manaLeft = store.get(username).mana
      // 逆转化实际增量（被上限截断时少于理论值，如实相告）
      const manaGained = cost.mana < 0 ? Math.max(0, Math.round(manaLeft - pstate.mana)) : 0
      const reply = atom.reply
        .replace(/\{distance\}/g, String(distance))
        .replace(/\{direction\}/g, String(params.direction ?? '东'))
      const parts: string[] = []
      if (cost.mana > 0) parts.push(`魔力 ${cost.mana}`)
      if (cost.food > 0) parts.push(`饱食度 ${cost.food}`)
      if (cost.hp > 0) parts.push(`生命 ${cost.hp}`)
      // 逆转化回执形如「（生命 6 → 换取魔力 15）」，普通施法仍走「（消耗魔力 30）」
      const costDesc = cost.mana < 0
        ? `（${parts.join('、')} → 换取魔力 ${manaGained}）`
        : parts.length > 0 ? `（消耗${parts.join('、')}）` : ''
      log(`cast ${atom.id} by ${username}: ${atom.commands.join('; ')} (mana ${cost.mana}, food ${cost.food}, hp ${cost.hp}, xp +${expGain})`)
      chronicle('cast', username, { skill: atom.id, mana: cost.mana, food: cost.food, hp: cost.hp, xp: expGain, level: levelAfter })
      appendSkillUsage({ ts: new Date().toISOString(), player: username, atom: atom.id, chant, mana: cost.mana, food: cost.food, hp: cost.hp, manaLeft: Math.floor(manaLeft), maxMana: pstate.maxMana, level: levelAfter })
      return `${reply}${costDesc}，剩余魔力 ${Math.floor(manaLeft)}/${pstate.maxMana}。${expGain > 0 ? `修为 +${expGain}。` : ''}${homeToTown ? '（你尚未安家——天神将你送回初始之地城镇中心；睡一张床，归乡便会带你回床边。）' : ''}`
    } catch (err) {
      return `神力连接不上这个世界：${err instanceof Error ? err.message : String(err)}`
    }
  }

  // ── 女神代施（慢路径执行器）：与 cast() 共用渲染器/VFX，但零门槛零消耗 ──
  async function castByGod(username: string, atomId: string, opts: GodCastOpts = {}): Promise<string> {
    const atom = atoms.find((a) => a.id === atomId)
    if (!atom) return `未知技艺「${atomId}」，神迹未成。`
    const bot = getBot()
    if (!bot.entity) return '女神化身离线，神迹未成。'

    const entityPos = bot.players[username]?.entity?.position
    const pos = entityPos ? { x: entityPos.x, y: entityPos.y, z: entityPos.z } : await rcon.getPos(username)
    if (!pos) return `「${username}」不在此界（离线），神迹未成。`
    const px = Math.round(pos.x)
    const py = Math.round(pos.y)
    const pz = Math.round(pos.z)

    const distance = typeof opts.distance === 'number' && Number.isFinite(opts.distance)
      ? Math.max(0, Math.min(30, Math.floor(opts.distance)))
      : 10
    const dirName = opts.direction && DIR_VECTORS[opts.direction] ? opts.direction : '东'
    const dirVec = DIR_VECTORS[dirName] ?? [1, 0]
    const tx = Math.round(px + dirVec[0] * distance)
    const ty = py
    const tz = Math.round(pz + dirVec[1] * distance)

    const item = opts.item && Object.values(GIVE_WHITELIST).includes(opts.item) ? opts.item : 'bread'
    const count = typeof opts.count === 'number' && Number.isFinite(opts.count)
      ? Math.max(1, Math.min(16, Math.floor(opts.count)))
      : 1

    let bx = 0
    let by = 0
    let bz = 0
    if (atom.id === 'home') {
      const spawn = await rcon.getSpawn(username)
      if (spawn) {
        bx = spawn.x
        by = spawn.y
        bz = spawn.z
      } else {
        // 没睡过床：回落初始之地城镇中心（与快路径 cast() 同一常量，2026-08-19）
        bx = TOWN_SPAWN.x
        by = TOWN_SPAWN.y
        bz = TOWN_SPAWN.z
      }
    }

    const vars: Record<string, number | string> = {
      target: username, bx, by, bz, px, py, pz, tx, ty, tz, item, count, distance, direction: dirName,
    }
    // 通灵契约：神迹代施同样支持 {puuid}（契约兽归属受赐者）+ ownLimit 防重赐
    if (atom.commands.some((c) => c.includes('{puuid}')) || atom.ownLimit) {
      const raw = await rcon.send(`data get entity ${username} UUID`)
      const m = /\[I;\s*([-\d,\s]+)\]/.exec(raw || '')
      if (!m) return `无法感知「${username}」的灵魂印记（UUID），神迹未成。`
      vars.puuid = `I;${m[1].replace(/\s+/g, '')}`
    }
    if (atom.ownLimit) {
      const range = atom.ownLimit.range ?? 96
      const out = await rcon.send(`execute if entity @e[type=${atom.ownLimit.entity},distance=..${range},nbt={Owner:[${vars.puuid}]}]`)
      if (/passed/i.test(out || '')) return atom.ownLimit.denyReply ?? `契约之兽已在其身边，无需再赐。`
    }
    try {
      for (const cmd of atom.commands.map((c) => renderCommand(c, vars))) {
        const out = await rcon.send(cmd)
        if (out) log(`rc[${cmd}] -> ${out.trim()}`)
      }
      await castVfx(atom, vars, username)
      log(`godcast ${atom.id} for ${username} (divine intervention, no player cost)`)
      return `「${atom.name}」已由神力代施。`
    } catch (err) {
      return `神迹中途受阻：${err instanceof Error ? err.message : String(err)}`
    }
  }

  // ── 咏唱监听已迁至私语通道（2026-08-18 方案A：咒语走私语，公屏不再施法）──
  // 分流在 mc-god 的 whisper handler：sniffChant 命中 → castSpell → [信使] 回执。
  // 理由：公屏即输入通道会误触发（任何人的闲聊含关键词即施法、白烧魔力）+
  // 咒文当众暴露；私语通道 AI 与真人平权——真人 /msg Goddess 念咒同样施法；
  // 特效（粒子/音效/大字）仍公屏：旁人见异象而不知咒文。
  ctx.effect(() => () => {
    log('magic disposed')
  })

  if (config.enabled) {
    log(`${atoms.length} atoms loaded, world-side engine armed (rcon via mc-rcon service)`)
  }
}
