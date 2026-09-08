// Gameplay contracts only; no game connection, persistence or model implementation.
import type { SkillCatalogEntry } from './catalog.ts'

// ── 原子指令（Atom）类型 ────────────────────────────────────────────────
export type AtomParamType = 'number' | 'direction' | 'item' | 'guard' | 'text'

export interface AtomParam {
  type: AtomParamType
  min?: number
  max?: number
  default?: number | string
  /** text 类型：剥掉守卫名（默认 false）。契约任务用 true，目标名用 false。 */
  stripGuard?: boolean
}

export const SKILLBAR_SLOTS = 8

export interface CastResult {
  ok: boolean
  code: 'ok' | 'unknown_skill' | 'ambiguous_skill' | 'invalid_params' | 'passive' |
    'level' | 'mana' | 'cooldown' | 'busy' | 'offline' | 'unavailable' |
    'health' | 'food' | 'already_full' | 'command_failed' | 'execution_error' | 'skill_archived' | 'outcome_unknown' | 'no_change'
  skillId?: string
  name?: string
  summary: string
  manaLeft?: number
  /** Remaining cooldown, not a new cooldown started by this rejection. */
  cooldownMs?: number
  nativeHints?: string[]
  effectReceipt?: Record<string, unknown>
}

export interface CostSpec {
  mana: number
  food: number
  hp: number
}

export interface Atom {
  id: string
  /** 被动参悟时使用；缺省仍按既有主动法术处理。 */
  type?: 'active' | 'passive'
  passiveId?: string
  layer: 'form' | 'effect' | 'augment'
  name: string
  words: string[]
  /** 法术分类（2026-08-23 造物主谕：辅助/攻击/召唤/…，技能列表持续更新）。
   *  自由字符串、不硬编码枚举（新分类随时可加）；外置 atoms JSON 可配。
   *  惯例：support=辅助（移动/恢复/造物/照明）、attack=攻击、summon=召唤（通灵契约）、
   *  world=世界天象（全服）、utility=地形改造。用于面板分组/女神裁量（attack 慎施）/书卷分类。 */
  category?: string
  /** 流派维（2026-08-23 正交分类第二维，可选）：东方/魔幻/忍术等。缺省归「通用」。 */
  school?: string
  /** 契约类法术（2026-08-23）：不走路 RCON commands，改由注入的 specialExecutor 执行。
   *  contract=缔结契约（唤守卫）、trace=寻踪（传送到对方）、recall=唤魂（拉从者）、
   *  kage_bunshin=影分身之术（按施术者数据召 2 个无魂战斗分身，跟随施术者 + 本能防御）、
   *  aura=光环系（2026-08-29）：三元素球绕体旋绕——元素由 atomId 分派（fire_aura 火焰光环
   *  等 8 元素家族，萌萌专属火焰、余七术公开）。 */
  special?: 'contract' | 'trace' | 'recall' | 'kage_bunshin' | 'fire_aura' | 'aura'
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
  /** 延迟后续命令（2026-08-30 螺旋丸根治）：弹道类沿弹伤害——弹飞出去后按
   *  delayMs 分批补发 commands（占位符同主 commands，vars 快照复用）。
   *  例：[{delayMs:150, commands:["execute as @e[tag=rasengan] at @s run damage …"]}] */
  postCast?: { delayMs: number; commands: string[] }[]
  /** 图标物品（2026-08-30）：技能在 UI（技能栏/面板/书）里的物品图标 id。 */
  icon?: string
}

// ── 对外服务：把法术表与状态库的关键能力暴露给其他插件（降临仪式等）──
export interface AtomSummary {
  id: string
  type?: 'active' | 'passive'
  passiveId?: string
  name: string
  words: string[]
  category?: string
  school?: string
  cost: CostSpec
  requiredLevel: number
  /** 图标物品（2026-08-30）：技能在 UI（技能栏/面板/书）里的物品图标。 */
  icon?: string
  params?: Record<string, AtomParam>
  catalog?: SkillCatalogEntry
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
  /** 当前回蓝速率（点/秒）：基础 regenPerSec × 稀有被动倍率（坚毅 HP<30% ×2）。 */
  manaPerSec: number
  skillbar: string[]
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
   * 守护天使代主人施法（2026-08-23 认主代执行）：主人已习得（或出生天赋）的技艺，
   * 由守护天使经 CLI 触发，按主人结算三资源（魔力/饱食/生命）与等级门槛。
   * 三闸：learned.includes||innateSkill → requiredLevel≤level（天赋豁免） → mana≥cost；
   * 复用快路径执行核（forceAtom），扣 store.spendMana(owner, cost)。
   */
  castAsOwner(owner: string, atomId: string): Promise<string>
  /**
   * 快路径施法（玩家自付三资源，含等级/魔力/参数校验）：
   * mc-god 私语分流命中关键词后调用，返回给施法者的结果描述。
   */
  castSpell(username: string, chant: string): Promise<string>
  /** ID / exact display name / unique exact alias only; no vectors or LLM.
   * Same level, resources, cooldown and learn-on-success rules as natural chanting. */
  castExact(username: string, skillKey: string, params?: Record<string, string | number>): Promise<CastResult>
  /**
   * 模糊施法（2026-08-23）：向量/LLM 已裁决的法术，tokens 折算魔力 + 自然前摇。
   * mc-god catch NeedLlmError 后 LLM 推理确认，再经此代施（扣玩家魔力，记 matchMode/tokens 台账）。
   */
  castFuzzy(username: string, chant: string, atomId: string, opts: { tokens?: number; latencyMs?: number; mode?: 'vector' | 'llm' }): Promise<string>
  /** 私语嗅探（分流用）：咒语框架命中 或 消息含任意法术关键词即真，不保证参数合法。 */
  sniffChant(message: string): boolean
  /** 咒语框架前缀分级分发（2026-08-23）：all=true（AI 玩家）全量；否则公共池（真人随机被告知 2-3 个）。 */
  chantPrefixes(all: boolean): string[]
  /* ── 技能栏（2026-08-30 造物主设计「圆盘可编辑+数字键快捷施法」）── */
  /** 读技能栏（无则自动按推荐表默认填充并持久化）。 */
  getSkillbar(username: string): string[]
  /** 整栏写入（≤8 槽、去重、只收已学/天赋），返回落定后的栏。 */
  setSkillbar(username: string, ids: string[]): string[]
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
  // 2026-08-23 模糊施法/神迹记账（造物主谕：模糊施法耗更久更多魔力；神迹=女神耗 tokens）
  consumeMana?: number   // 传入则扣玩家魔力（模糊施法）；缺省零消耗（神迹代施）
  latencyMs?: number     // 前摇延迟（粒子先行，LLM 推理耗时 = 自然前摇）
  mode?: 'vector' | 'llm' // 匹配层级（台账）
  tokens?: number        // LLM 推理 tokens（llm 模糊施法 + 神迹记账）
  playerChant?: string   // 玩家咒语原文（台账 chant 字段）
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
  /** 技能栏槽位（2026-08-30 造物主设计「圆盘可编辑+数字键快捷施法」）：atom id 数组，
   *  下标即槽位 1-8；缺省自动按推荐表从已学里填。 */
  skillbar?: string[]
}

export interface MagicStateFile {
  version: 1
  players: Record<string, PlayerMagicState>
}
