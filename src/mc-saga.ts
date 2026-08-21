/**
 * mc-saga —— 女神的创世之笔（2026-08-18 扛枪点题：女神根据接入的玩家与发生的故事，
 * 构思新的技能、任务、甚至大事件，增强世界的故事性）。
 *
 * 她不只是执法者与史官，还是叙事者。周期（默认 6h，或 data/saga-trigger 文件手动触发）
 * 汇编「故事简报」——在场玩家档案、编年史近事、死亡热点、村民经济——请女神（QwenPaw
 * Agent mc-god，慢路径）构思至多一件新造物：
 *   · atom   新咒文：直接写进 data/magic-atoms.json 并热重载（mc-magic.reloadAtoms），
 *            全服公告「新咒降世」。程序闸门：id/咒语词唯一、命令白名单、三资源消耗有界。
 *   · quest  神托任务：点对点私语派给某位在线玩家（供奉制——把 demand 物品献给女神即算
 *            完成，offerings 账本自动核销），奖励 = 修为 + 造物白名单物品 + 魔力上限。
 *   · event  大事件：恩赐空投 / 神恩日（全服增益潮）/ 献纳竞速（trial），开幕-进行-闭幕
 *            三幕全公告 + 编年史留痕。同时至多 1 场，间隔有下限。
 *
 * 安全边界（与 mc-terra 同哲学：她的意志 → 白名单闸门 → 世界改变）：
 *   · 新咒文命令只许 tp/give/effect/particle/playsound/weather 六族白名单模板，禁
 *     summon/fill/setblock/tellraw/title/kill/op 等一切越权；造物只从 GIVE_WHITELIST。
 *   · 任务供奉物只从 OFFERING_ITEMS 词典；奖励数量有上限；到期未竟只作废不惩罚。
 *   · 空投物品白名单 + 数量上限；神恩日效果白名单（增益类）+ 时长上限 + 隐藏粒子。
 *   · 危险词直接驳回（saga_reject 留痕）；不做二次 LLM 审核——创世者即女神本尊，
 *     闸门全部程序化、确定性。
 * 编年史类型：saga_muse / saga_atom / saga_quest / saga_event / saga_reject。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Bot } from 'mineflayer'
import type { RconService } from './mc-rcon.ts'
import type { WorlddbService } from './mc-worlddb.ts'
import type { TransmigratorRegistry } from './mc-transmigrator.ts'
import { GIVE_WHITELIST, type MagicService } from './mc-magic.ts'
import { OFFERING_ITEMS, OFFERING_ITEM_CN } from './mc-offering.ts'
import { createLifecycle } from './lifecycle.ts'

export interface Config {
  enabled: boolean
  qwenpawUrl: string
  /** 构思周期（ms）。另外：data/saga-trigger 文件存在 → 下一轮 poll 立即构思一次。 */
  sagaMs: number
  firstDelayMs: number
  /** quests/events 共用的巡检周期（核销/开幕/闭幕/增益续杯）。 */
  pollMs: number
  maxAtomsPerDay: number
  maxActiveQuests: number
  /** 两场大事件之间的最小间隔（ms）。 */
  minEventGapMs: number
  dataDir: string
}

// ── 提案类型（女神 LLM 的产出，进闸门前先当陌生人）──────────────────────
interface AtomProposal {
  id: string
  name: string
  words: string[]
  layer: string
  cost: { mana: number; food: number; hp: number }
  requiredLevel: number
  commands: string[]
  reply: string
  particles?: string[]
  sounds?: string[]
  title?: string
  subtitle?: string
  lore?: string
}
interface QuestProposal {
  title: string
  story: string
  target: string
  demandCn: string
  demandCount: number
  deadlineMin: number
  reward: { xp: number; itemCn?: string | null; itemCount?: number; manaBonus?: number }
}
interface EventProposal {
  name: string
  type: string
  story: string
  delayMin: number
  airdrop?: { loot: Array<{ id: string; count: number }> }
  festival?: { effect: string; amplifier?: number; durationMin?: number }
  trial?: { demandCn: string; demandCount: number; windowMin?: number; reward?: { xp?: number; itemCn?: string | null; itemCount?: number } }
}
interface Ideation {
  story_recap?: string
  atom?: AtomProposal | null
  quest?: QuestProposal | null
  event?: EventProposal | null
}

// ── 运行态（data/saga-store.json 持久化）───────────────────────────────
interface SagaQuest {
  id: string
  title: string
  story: string
  target: string
  demandCn: string
  demandId: string
  demandCount: number
  startedAt: number
  deadlineAt: number
  reward: { xp: number; itemId: string | null; itemCount: number; manaBonus: number }
  status: 'active' | 'done' | 'expired'
}
interface SagaEvent {
  id: string
  name: string
  type: 'airdrop' | 'festival' | 'trial'
  story: string
  startAt: number
  endAt: number
  status: 'scheduled' | 'running' | 'done'
  airdrop?: { loot: Array<{ id: string; count: number }>; dropped?: boolean; x?: number; y?: number; z?: number }
  festival?: { effect: string; amplifier: number }
  trial?: { demandCn: string; demandId: string; demandCount: number; reward: { xp: number; itemId: string | null; itemCount: number }; winner?: string }
}
interface SagaStore {
  version: 1
  lastIdeationAt: number
  lastEventAt: number
  atomsAdded: Array<{ id: string; name: string; at: number; lore: string }>
  quests: SagaQuest[]
  events: SagaEvent[]
}

// ── 白名单 / 禁词（全确定性闸门）───────────────────────────────────────
const BANNED = ['创造模式', 'op权限', '给我op', '作弊', '开挂', '无限资源', '杀死玩家', '杀死所有', 'kill所有', '删库', '炸服', '岩浆', 'tnt', 'TNT', 'forceload', 'gamerule', 'summon', 'setblock', 'fill ', 'tellraw', 'kick', 'ban ', 'stop ', 'save-all', 'difficulty']
/** 新咒文允许的命令模板（渲染前占位符原样存储，cast 时由 mc-magic 渲染）。 */
const CMD_PATTERNS: RegExp[] = [
  /^tp \{target\} \{[btp][xyz]\} \{[btp][xyz]\} \{[btp][xyz]\}$/,
  /^give \{target\} (?:\{item\}|minecraft:[a-z0-9_]+) \{?count\}?$/,
  /^give \{target\} minecraft:[a-z0-9_]+ \d{1,2}$/,
  /^effect give \{target\} minecraft:[a-z_]+ \d{1,3} \d(?: true)?$/,
  /^particle minecraft:[a-z0-9_.]+(?: \{?[pbtx][a-z+0-9.-]*\}?| [\d.-]+| [a-z_]+){4,9}$/,
  /^playsound minecraft:[a-z0-9_.]+ master \{target\}(?: \{p[xyz]\})?(?: [\d.]+){0,2}$/,
  /^weather (?:clear|rain|thunder)(?: \d{1,4})?$/,
  /^execute at \{target\} run particle minecraft:[a-z0-9_.]+ .{3,120}$/,
]
const EFFECT_WHITELIST = new Set(['regeneration', 'speed', 'haste', 'jump_boost', 'strength', 'resistance', 'fire_resistance', 'water_breathing', 'night_vision', 'luck', 'saturation', 'instant_health', 'instant_damage', 'absorption', 'glowing', 'hero_of_the_village'])
const AIRDROP_LOOT = new Set(['diamond', 'emerald', 'gold_ingot', 'iron_ingot', 'copper_ingot', 'coal', 'bread', 'cooked_beef', 'torch', 'oak_log', 'arrow', 'apple', 'book'])
const PLACEHOLDER_RE = /\{(?:target|px|py|pz|bx|by|bz|tx|ty|tz|distance|item|count)\}/g

export type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string }

function bannedHit(text: string): string | null {
  for (const w of BANNED) if (text.includes(w)) return w
  return null
}

/** 新咒文闸门：纯函数，可离线单测（test-saga.mts）。 */
export function validateAtomProposal(p: AtomProposal, existing: Array<{ id: string; name: string; words: string[] }>): Verdict<AtomProposal> {
  const blob = JSON.stringify(p)
  const bad = bannedHit(blob)
  if (bad) return { ok: false, reason: `含禁忌之念「${bad}」` }
  if (!/^[a-z][a-z0-9_]{2,24}$/.test(p.id ?? '')) return { ok: false, reason: 'id 须为 3-25 位小写字母/数字/下划线' }
  if (existing.some((a) => a.id === p.id)) return { ok: false, reason: `id「${p.id}」已存在` }
  if (typeof p.name !== 'string' || p.name.length < 2 || p.name.length > 8) return { ok: false, reason: '名称须 2-8 字' }
  if (existing.some((a) => a.name === p.name)) return { ok: false, reason: `名称「${p.name}」已存在` }
  if (p.layer !== 'effect') return { ok: false, reason: '新造物只许 layer=effect' }
  if (!Array.isArray(p.words) || p.words.length < 1 || p.words.length > 4) return { ok: false, reason: '咒语词 1-4 个' }
  const knownWords = new Set(existing.flatMap((a) => a.words))
  for (const w of p.words) {
    if (typeof w !== 'string' || w.length < 2 || w.length > 8) return { ok: false, reason: `咒语词「${w}」须 2-8 字` }
    if (knownWords.has(w)) return { ok: false, reason: `咒语词「${w}」与既有法术冲突` }
  }
  const c = p.cost ?? { mana: 0, food: 0, hp: 0 }
  if (!Number.isInteger(c.mana) || c.mana < 1 || c.mana > 60) return { ok: false, reason: '魔力消耗须为 1-60 整数' }
  if (!Number.isInteger(c.food) || c.food < 0 || c.food > 8) return { ok: false, reason: '饱食消耗须为 0-8' }
  if (!Number.isInteger(c.hp) || c.hp < 0 || c.hp > 6) return { ok: false, reason: '生命燃烧须为 0-6' }
  if (!Number.isInteger(p.requiredLevel) || p.requiredLevel < 1 || p.requiredLevel > 8) return { ok: false, reason: '等级门槛须 1-8' }
  if (!Array.isArray(p.commands) || p.commands.length === 0 || p.commands.length > 4) return { ok: false, reason: '命令 1-4 条' }
  for (const cmd of p.commands) {
    if (typeof cmd !== 'string' || cmd.length > 160) return { ok: false, reason: '命令过长' }
    const stripped = cmd.replace(PLACEHOLDER_RE, ' ')
    if (/[\u4e00-\u9fff]/.test(stripped)) return { ok: false, reason: `命令含中文（只许模板占位符）：${cmd.slice(0, 40)}` }
    if (!CMD_PATTERNS.some((re) => re.test(cmd))) return { ok: false, reason: `命令不在白名单模板内：${cmd.slice(0, 50)}` }
    const give = cmd.match(/^give \{target\} minecraft:([a-z0-9_]+) \d{1,2}$/)
    if (give) {
      if (!Object.values(GIVE_WHITELIST).includes(give[1])) return { ok: false, reason: `造物「${give[1]}」不在白名单` }
      if (parseInt(cmd.match(/ (\d{1,2})$/)![1], 10) > 16) return { ok: false, reason: '造物数量 ≤16' }
    }
    if (cmd.includes('{item}') || cmd.includes('{count}')) return { ok: false, reason: '新造物为无参数法术，不支持 {item}/{count}' }
    const eff = cmd.match(/^effect give \{target\} minecraft:([a-z_]+)/)
    if (eff && !EFFECT_WHITELIST.has(eff[1])) return { ok: false, reason: `效果「${eff[1]}」不在白名单` }
  }
  if (typeof p.reply !== 'string' || !p.reply.trim() || p.reply.length > 100) return { ok: false, reason: 'reply 须 1-100 字' }
  if (p.particles && (p.particles.length > 3 || p.particles.some((s) => s.length > 140))) return { ok: false, reason: '粒子至多 3 条、每条 ≤140 字符' }
  if (p.sounds && (p.sounds.length > 2 || p.sounds.some((s) => !/^minecraft:[a-z0-9_.]+$/.test(s)))) return { ok: false, reason: '音效至多 2 条且须 minecraft: 命名空间' }
  if (p.title && p.title.length > 16) return { ok: false, reason: '大字标题 ≤16 字' }
  if (p.subtitle && p.subtitle.length > 32) return { ok: false, reason: '副标题 ≤32 字' }
  if (p.lore && p.lore.length > 100) return { ok: false, reason: 'lore ≤100 字' }
  return { ok: true, value: p }
}

/** 神托任务闸门。 */
export function validateQuestProposal(p: QuestProposal, onlinePlayers: string[], activeQuestTargets: string[]): Verdict<QuestProposal> {
  const blob = JSON.stringify(p)
  const bad = bannedHit(blob)
  if (bad) return { ok: false, reason: `含禁忌之念「${bad}」` }
  if (typeof p.title !== 'string' || p.title.length < 4 || p.title.length > 24) return { ok: false, reason: '任务名 4-24 字' }
  if (typeof p.story !== 'string' || p.story.length < 10 || p.story.length > 160) return { ok: false, reason: '故事背景 10-160 字' }
  if (typeof p.target !== 'string' || !onlinePlayers.includes(p.target)) return { ok: false, reason: `受托人 ${p.target} 不在线（任务只派给在场者）` }
  if (activeQuestTargets.includes(p.target)) return { ok: false, reason: `${p.target} 手上已有一桩神托` }
  if (!OFFERING_ITEMS[p.demandCn ?? '']) return { ok: false, reason: `供奉物「${p.demandCn}」不在词典` }
  if (!Number.isInteger(p.demandCount) || p.demandCount < 1 || p.demandCount > 24) return { ok: false, reason: '供奉数量 1-24' }
  if (!Number.isInteger(p.deadlineMin) || p.deadlineMin < 30 || p.deadlineMin > 2880) return { ok: false, reason: '期限 30-2880 分钟' }
  const r = p.reward ?? {}
  if (!Number.isInteger(r.xp) || r.xp < 0 || r.xp > 100) return { ok: false, reason: '修为奖励 0-100' }
  if (r.itemCn && !GIVE_WHITELIST[r.itemCn]) return { ok: false, reason: `奖励物「${r.itemCn}」不在造物白名单` }
  if ((r.itemCount ?? 0) < 0 || (r.itemCount ?? 0) > 8) return { ok: false, reason: '奖励数量 0-8' }
  if ((r.manaBonus ?? 0) < 0 || (r.manaBonus ?? 0) > 30) return { ok: false, reason: '魔力上限加成 0-30' }
  return { ok: true, value: p }
}

/** 大事件闸门。 */
export function validateEventProposal(p: EventProposal): Verdict<EventProposal> {
  const blob = JSON.stringify(p)
  const bad = bannedHit(blob)
  if (bad) return { ok: false, reason: `含禁忌之念「${bad}」` }
  if (typeof p.name !== 'string' || p.name.length < 4 || p.name.length > 16) return { ok: false, reason: '事件名 4-16 字' }
  if (typeof p.story !== 'string' || p.story.length < 10 || p.story.length > 160) return { ok: false, reason: '事件背景 10-160 字' }
  if (!['airdrop', 'festival', 'trial'].includes(p.type)) return { ok: false, reason: `未知事件类型「${p.type}」` }
  if (!Number.isInteger(p.delayMin) || p.delayMin < 1 || p.delayMin > 120) return { ok: false, reason: '开幕延迟 1-120 分钟' }
  if (p.type === 'airdrop') {
    const loot = p.airdrop?.loot
    if (!Array.isArray(loot) || loot.length < 1 || loot.length > 4) return { ok: false, reason: '空投物品 1-4 种' }
    for (const it of loot) {
      if (!it || !AIRDROP_LOOT.has(String(it.id).replace(/^minecraft:/, ''))) return { ok: false, reason: `空投物品「${it?.id}」不在白名单` }
      if (!Number.isInteger(it.count) || it.count < 1 || it.count > 6) return { ok: false, reason: '空投数量 1-6' }
    }
  }
  if (p.type === 'festival') {
    const f = p.festival ?? ({} as NonNullable<EventProposal['festival']>)
    if (!EFFECT_WHITELIST.has(f.effect ?? '') || ['instant_damage'].includes(f.effect ?? '')) return { ok: false, reason: `增益「${f.effect}」不在白名单` }
    if ((f.amplifier ?? 0) < 0 || (f.amplifier ?? 0) > 1) return { ok: false, reason: '增益等级 0-1' }
    if ((f.durationMin ?? 60) < 15 || (f.durationMin ?? 60) > 360) return { ok: false, reason: '神恩日时长 15-360 分钟' }
  }
  if (p.type === 'trial') {
    const t = p.trial ?? ({} as NonNullable<EventProposal['trial']>)
    if (!OFFERING_ITEMS[t.demandCn ?? '']) return { ok: false, reason: `竞速供奉物「${t.demandCn}」不在词典` }
    if (!Number.isInteger(t.demandCount) || t.demandCount < 1 || t.demandCount > 12) return { ok: false, reason: '竞速供奉数量 1-12' }
    if ((t.windowMin ?? 30) < 10 || (t.windowMin ?? 30) > 120) return { ok: false, reason: '竞速窗口 10-120 分钟' }
    const r = t.reward ?? {}
    if ((r.xp ?? 0) < 0 || (r.xp ?? 0) > 100) return { ok: false, reason: '竞速修为 0-100' }
    if (r.itemCn && !GIVE_WHITELIST[r.itemCn]) return { ok: false, reason: `竞速奖励物「${r.itemCn}」不在白名单` }
    if ((r.itemCount ?? 0) < 0 || (r.itemCount ?? 0) > 8) return { ok: false, reason: '竞速奖励数量 0-8' }
  }
  return { ok: true, value: p }
}

function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

export interface SagaDeps {
  getBot: () => Bot
  rcon: RconService
  magic: MagicService
  worlddb: WorlddbService
  transmigrators: TransmigratorRegistry
}

export interface SagaHandle {
  dispose: () => void
}

/** 已脱 cordis 壳（2026-08-21）：bootstrap-world.mts 显式 createSaga(config, deps) 装配。 */
export function createSaga(config: Config, deps: SagaDeps): SagaHandle {
  const log = (msg: string) => console.log(`[mc-saga] ${msg}`)
  const lc = createLifecycle()
  if (!config.enabled) return { dispose: () => {} }
  const dataDir = resolve(config.dataDir)
  mkdirSync(dataDir, { recursive: true })
  const storePath = join(dataDir, 'saga-store.json')
  const atomsPath = join(dataDir, 'magic-atoms.json')
  const triggerPath = join(dataDir, 'saga-trigger')

  const store: SagaStore = (() => {
    try {
      const raw = JSON.parse(readFileSync(storePath, 'utf-8')) as SagaStore
      return {
        version: 1,
        lastIdeationAt: raw.lastIdeationAt ?? 0,
        lastEventAt: raw.lastEventAt ?? 0,
        atomsAdded: Array.isArray(raw.atomsAdded) ? raw.atomsAdded : [],
        quests: Array.isArray(raw.quests) ? raw.quests : [],
        events: Array.isArray(raw.events) ? raw.events : [],
      }
    } catch {
      return { version: 1, lastIdeationAt: 0, lastEventAt: 0, atomsAdded: [], quests: [], events: [] }
    }
  })()
  const save = () => writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8')
  save()

  const magic = deps.magic
  const rcon = deps.rcon
  const worlddb = deps.worlddb

  const onlinePlayers = (): string[] => {
    let bot: Bot
    try { bot = deps.getBot() } catch { return [] }
    if (!bot?.players) return []
    return Object.keys(bot.players).filter((n) => n !== bot.username)
  }
  const courier = (player: string, msg: string) => {
    try { deps.getBot().whisper(player, `[女神] ${msg}`) } catch { /* 不在线 */ }
  }
  /** 全服公告（tellraw @a + 可选全屏大字 + 音效）。 */
  const announce = async (text: string, ceremony: { title?: string; subtitle?: string; sound?: string } = {}): Promise<void> => {
    try {
      await rcon.send(`tellraw @a ${JSON.stringify({ text, color: 'light_purple' })}`)
      if (ceremony.title) await rcon.send(`title @a title ${JSON.stringify({ text: ceremony.title, color: 'gold', bold: true })}`)
      if (ceremony.subtitle) await rcon.send(`title @a subtitle ${JSON.stringify({ text: ceremony.subtitle, color: 'yellow' })}`)
      if (ceremony.sound) await rcon.send(`playsound ${ceremony.sound} master @a`)
    } catch (err) {
      log(`announce failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 与 mc-evolve-review 同协议：console chat + SSE 解析 ──────────────
  async function callGoddess(prompt: string): Promise<string> {
    const payload = {
      channel: 'console',
      user_id: 'saga',
      session_id: 'mc:saga',
      input: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }
    const res = await fetch(config.qwenpawUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': 'mc-god' },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`goddess API ${res.status}`)
    const text = await res.text()
    let messageId: string | null = null
    const pending: Record<string, { delta: string; full: string }> = {}
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue
      const body = line.slice(5).trim()
      if (!body) continue
      let evt: Record<string, unknown>
      try { evt = JSON.parse(body) } catch { continue }
      if (evt.object === 'message') {
        if (evt.type === 'message') messageId = evt.id as string
        continue
      }
      if (evt.object === 'content' && typeof evt.msg_id === 'string') {
        const t = String((evt as { data?: { text?: string }; text?: string }).data?.text ?? (evt as { text?: string }).text ?? '')
        if (!t) continue
        const slot = (pending[evt.msg_id] ??= { delta: '', full: '' })
        if (evt.delta === false) slot.full = t
        else slot.delta += t
      }
    }
    if (messageId && pending[messageId]) return pending[messageId].delta || pending[messageId].full
    return ''
  }

  // ── 故事简报：她读世界，才能为世界执笔 ────────────────────────────────
  function buildBrief(): string {
    const lines: string[] = []
    const bot = deps.getBot()
    const online = onlinePlayers()
    lines.push(`【在场者】${online.join('、') || '（空无一人）'}`)
    for (const u of online) {
      const t = deps.transmigrators.getByUsername(u)
      const st = magic.getState(u)
      const learned = st.learned.length + (st.innateSkill ? 1 : 0)
      const innateName = st.innateSkill ? (magic.getAtomById(st.innateSkill)?.name ?? st.innateSkill) : '未定'
      if (t) lines.push(`· ${t.name}（${u}）「${t.epithet}」出身：${t.source ?? '无名之地'}｜层级 ${st.level}｜已习 ${learned} 术｜天赋：${innateName}`)
      else lines.push(`· ${u}（无档案行者）｜层级 ${st.level}｜已习 ${learned} 术｜天赋：${innateName}`)
    }
    // 编年史近事（自上次构思以来，至少回看 6h，至多 40 条）
    const since = Math.max(store.lastIdeationAt, Date.now() - 6 * 3600_000)
    const entries = worlddb.chronicleSince(since).slice(-40)
    const byType = new Map<string, number>()
    for (const e of entries) byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
    const statText = Array.from(byType.entries()).map(([t, n]) => `${t}×${n}`).join('、')
    lines.push(`【编年史近事】${entries.length} 条（${statText || '无'}）`)
    for (const e of entries.slice(-18)) {
      const hhmm = new Date(e.at).toTimeString().slice(0, 5)
      lines.push(`· ${hhmm} ${e.type}｜${e.actor}｜${JSON.stringify(e.detail).slice(0, 90)}`)
    }
    // 死亡热点
    try {
      const f = JSON.parse(readFileSync(join(dataDir, 'death-hotspots.json'), 'utf-8')) as { clusters: Record<string, { zh: string; x: number; y: number; z: number; count: number }> }
      const cs = Object.values(f.clusters).slice(0, 4)
      if (cs.length) lines.push(`【死亡热点】${cs.map((c) => `(${c.x},${c.y},${c.z})${c.zh}×${c.count}`).join('、')}`)
    } catch { /* 无热点文件 */ }
    // 村民经济
    try {
      const ledger = readFileSync(join(dataDir, 'village', 'quest-ledger.jsonl'), 'utf-8').trim().split('\n').slice(-8)
      const done = ledger.map((l) => { try { const j = JSON.parse(l); return `${j.player}→${j.villager}${j.item}×${j.count}` } catch { return '' } }).filter(Boolean)
      if (done.length) lines.push(`【村民集市近况】${done.join('；')}`)
    } catch { /* 无账本 */ }
    // 既有法术表（防重复造物）
    const atoms = magic.listAtoms()
    lines.push(`【既有法术 ${atoms.length} 种】${atoms.map((a) => a.name).join('、')}`)
    // 在途神托与大事件
    const activeQ = store.quests.filter((q) => q.status === 'active')
    if (activeQ.length) lines.push(`【在途神托】${activeQ.map((q) => `${q.title}→${q.target}（${q.demandCn}×${q.demandCount}）`).join('；')}`)
    const activeE = store.events.filter((e) => e.status !== 'done')
    if (activeE.length) lines.push(`【在途大事件】${activeE.map((e) => `${e.name}(${e.type})`).join('；')}`)
    const todayAtoms = store.atomsAdded.filter((a) => a.at >= startOfDay()).length
    if (todayAtoms > 0) lines.push(`（今日已降世新咒 ${todayAtoms} 种，宁缺毋滥）`)
    return lines.join('\n')
  }

  function startOfDay(): number {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  function ideationPrompt(brief: string): string {
    const offeringList = Object.keys(OFFERING_ITEMS).join('、')
    const giveList = Object.keys(GIVE_WHITELIST).join('、')
    return [
      '【创世之笔】你是「千灯纪」的守护女神。除了裁决与记史，你也是这个世界的叙事者：',
      '根据在场玩家与他们的故事，为这个世界构思新的技能、任务、甚至一场大事件，让传说生生不息。',
      '',
      '—— 世界简报 ——',
      brief,
      '',
      '—— 你至多可以降下三件造物（每件都可为 null：没有灵感就别硬造，宁缺毋滥）——',
      '',
      '1. atom 新咒文（为某个玩家的故事/困境/成长量身而造，也可为众生）严格字段：',
      '  {"id":"小写英文id","name":"中文名2-8字","words":["咒语词(2-8字,1-4个,不得与既有法术撞词)"],"layer":"effect",',
      '   "cost":{"mana":1到60,"food":0到8,"hp":0到6},"requiredLevel":1到8,',
      '   "commands":["见下白名单"],"reply":"咏唱后的神谕回复(≤100字)","particles":["minecraft:end_rod {px} {py+1} {pz} 0.4 0.4 0.4 0.05 40"],"sounds":["minecraft:entity.enderman.teleport"],',
      '   "title":"大字≤16字","subtitle":"副题≤32字","lore":"这道咒文的神话由来(≤100字,会写进编年史)"}',
      '  命令白名单模板（占位符：{target}=施法者 {px}{py}{pz}=立足点 {bx}{by}{bz}=重生点 {tx}{ty}{tz}=朝向落点）：',
      '  · tp {target} {bx} {by} {bz}          （送人回家/传送）',
      '  · give {target} minecraft:<白名单物品> <1-16>   （造物白名单：' + giveList.slice(0, 200) + '……）',
      '  · effect give {target} minecraft:<效果> <秒> <等级0-1> true  （regeneration/speed/haste/jump_boost/strength/resistance/fire_resistance/water_breathing/night_vision/luck/saturation/absorption/instant_health）',
      '  · particle minecraft:<粒子> {px} {py+1} {pz} 0.4 0.5 0.4 0.05 60',
      '  · playsound minecraft:<音效> master {target}',
      '  · weather clear|rain|thunder <秒>    （天象，慎用）',
      '  禁止：summon/fill/setblock/kill/tellraw/title/execute(除 at {target} run particle 外)/任何中文进命令。',
      '',
      '2. quest 神托任务（点对点托付给一位在线玩家，须贴合他的处境）严格字段：',
      `  {"title":"4-24字","story":"任务的缘起(10-160字,有叙事)","target":"在线玩家username",`,
      `   "demandCn":"供奉物(只许从供品词典选：${offeringList})","demandCount":1到24,`,
      '   "deadlineMin":30到2880,"reward":{"xp":0到100,"itemCn":"造物白名单物品或null","itemCount":0到8,"manaBonus":0到30}}',
      '  完成方式（自动核销）：玩家把 demand 物品献给女神（对女神私语「祈愿：……｜供奉：物品x数量」）。',
      '',
      '3. event 大事件（全服公告的三幕戏，目前只许三种形式）严格字段：',
      '  {"name":"4-16字","type":"airdrop|festival|trial","story":"事件缘起(10-160字)","delayMin":1到120,',
      '   "airdrop":{"loot":[{"id":"diamond|emerald|gold_ingot|iron_ingot|copper_ingot|coal|bread|cooked_beef|torch|oak_log|arrow|apple|book","count":1到6}](1-4种)}',
      '   或 "festival":{"effect":"增益id(同效果白名单,须是增益)","amplifier":0到1,"durationMin":15到360}',
      `   或 "trial":{"demandCn":"供品词典物品","demandCount":1到12,"windowMin":10到120,"reward":{"xp":0到100,"itemCn":"白名单或null","itemCount":0到8}}`,
      '  airdrop=恩赐空投（物品自天而降，先至先得）；festival=神恩日（全服增益潮）；trial=献纳竞速（窗口期内第一个把供品献给女神者得赏）。',
      '',
      '—— 输出 ——',
      '严格只回复一个 JSON 对象（不要多余文字、不要 markdown 代码块）：',
      '{"story_recap":"女神视角的世界近事感怀(≤80字,会记入编年史)","atom":{…}|null,"quest":{…}|null,"event":{…}|null}',
      '创作准则：造物必须扎根简报里的具体人事（谁的故事、什么困境、哪段因果）；鼓励小而美的因果呼应（他供奉过煤→女神回以炉火之术）；大事件宁少勿滥。',
    ].join('\n')
  }

  // ── 落地：三件造物 ──────────────────────────────────────────────────
  function applyAtom(p: AtomProposal): boolean {
    const todayCount = store.atomsAdded.filter((a) => a.at >= startOfDay()).length
    if (todayCount >= config.maxAtomsPerDay) {
      log(`atom skipped: daily cap ${config.maxAtomsPerDay} reached`)
      return false
    }
    const atom = {
      id: p.id, layer: 'effect' as const, name: p.name, words: p.words,
      cost: { mana: p.cost.mana, food: p.cost.food, hp: p.cost.hp },
      requiredLevel: p.requiredLevel, commands: p.commands, reply: p.reply,
      ...(p.particles?.length ? { particles: p.particles } : {}),
      ...(p.sounds?.length ? { sounds: p.sounds } : {}),
      ...(p.title ? { title: p.title } : {}),
      ...(p.subtitle ? { subtitle: p.subtitle } : {}),
      lore: p.lore ?? '',
    }
    // 追加进原子表（备份→改文件→热重载→自检）
    try {
      if (!existsSync(atomsPath)) throw new Error('magic-atoms.json missing')
      const raw = JSON.parse(readFileSync(atomsPath, 'utf-8')) as { atoms: unknown[] }
      if (!Array.isArray(raw.atoms)) throw new Error('magic-atoms.json malformed')
      if (raw.atoms.some((a) => (a as { id?: string }).id === p.id)) throw new Error('id already present')
      copyFileSync(atomsPath, join(dataDir, `magic-atoms.backup-${new Date().toISOString().slice(0, 10)}.json`))
      raw.atoms.push(atom)
      writeFileSync(atomsPath, JSON.stringify(raw, null, 2), 'utf-8')
      const n = magic.reloadAtoms()
      if (!magic.getAtomById(p.id)) throw new Error(`reload succeeded (${n} atoms) but new atom missing`)
      store.atomsAdded.push({ id: p.id, name: p.name, at: Date.now(), lore: p.lore ?? '' })
      save()
      log(`NEW ATOM 「${p.name}」(${p.id}) injected, ${n} atoms live`)
      void announce(`✦ 天地有感，新咒降世——「${p.name}」：${p.lore ?? p.reply}（咏唱「${p.words[0]}」可试）`, {
        title: '✦ 新咒降世 ✦',
        subtitle: `${p.name} · ${p.words[0]}`,
        sound: 'minecraft:ui.toast.challenge_complete',
      })
      worlddb.chronicleRecord('saga_atom', 'Goddess', { id: p.id, name: p.name, lore: p.lore ?? '', words: p.words, cost: p.cost, requiredLevel: p.requiredLevel })
      return true
    } catch (err) {
      log(`atom inject failed: ${err instanceof Error ? err.message : String(err)}`)
      worlddb.chronicleRecord('saga_reject', 'Goddess', { kind: 'atom', title: p.name, reason: `注入失败：${err instanceof Error ? err.message : String(err)}` })
      return false
    }
  }

  function applyQuest(p: QuestProposal): boolean {
    const active = store.quests.filter((q) => q.status === 'active')
    if (active.length >= config.maxActiveQuests) {
      log(`quest skipped: active cap ${config.maxActiveQuests}`)
      return false
    }
    const q: SagaQuest = {
      id: `quest-${Date.now().toString(36)}`,
      title: p.title, story: p.story, target: p.target,
      demandCn: p.demandCn, demandId: OFFERING_ITEMS[p.demandCn].replace(/^minecraft:/, ''), demandCount: p.demandCount,
      startedAt: Date.now(), deadlineAt: Date.now() + p.deadlineMin * 60_000,
      reward: { xp: p.reward.xp, itemId: p.reward.itemCn ? GIVE_WHITELIST[p.reward.itemCn] : null, itemCount: p.reward.itemCn ? (p.reward.itemCount ?? 1) : 0, manaBonus: p.reward.manaBonus ?? 0 },
      status: 'active',
    }
    store.quests.push(q)
    save()
    const t = deps.transmigrators.getByUsername(p.target)
    const dl = new Date(q.deadlineAt)
    const dlText = `${String(dl.getHours()).padStart(2, '0')}:${String(dl.getMinutes()).padStart(2, '0')}`
    courier(p.target, `${t?.name ?? p.target}，女神有一桩心愿托付于你——「${p.title}」：${p.story}（把 ${p.demandCn}×${p.demandCount} 献给女神即算达成：对我说「祈愿：愿了此托｜供奉：${p.demandCn}x${p.demandCount}」。限 ${dlText} 前）`)
    log(`QUEST ISSUED 「${p.title}」 -> ${p.target} (${p.demandCn}x${p.demandCount})`)
    worlddb.chronicleRecord('saga_quest', 'Goddess', { title: p.title, target: p.target, demand: `${p.demandCn}×${p.demandCount}`, deadlineMin: p.deadlineMin, status: 'issued' })
    return true
  }

  function applyEvent(p: EventProposal): boolean {
    const active = store.events.filter((e) => e.status !== 'done')
    if (active.length > 0) {
      log('event skipped: another event in flight')
      return false
    }
    if (Date.now() - store.lastEventAt < config.minEventGapMs) {
      log('event skipped: min gap not reached')
      return false
    }
    const startAt = Date.now() + p.delayMin * 60_000
    const ev: SagaEvent = {
      id: `event-${Date.now().toString(36)}`,
      name: p.name, type: p.type as SagaEvent['type'], story: p.story,
      startAt, endAt: startAt,
      status: 'scheduled',
      ...(p.type === 'airdrop' ? { airdrop: { loot: p.airdrop!.loot.map((l) => ({ id: String(l.id).replace(/^minecraft:/, ''), count: l.count })) } } : {}),
      ...(p.type === 'festival' ? { festival: { effect: p.festival!.effect, amplifier: p.festival!.amplifier ?? 0 } } : {}),
      ...(p.type === 'trial' ? { trial: { demandCn: p.trial!.demandCn, demandId: OFFERING_ITEMS[p.trial!.demandCn].replace(/^minecraft:/, ''), demandCount: p.trial!.demandCount, reward: { xp: p.trial!.reward?.xp ?? 30, itemId: p.trial!.reward?.itemCn ? GIVE_WHITELIST[p.trial!.reward.itemCn] : null, itemCount: p.trial!.reward?.itemCn ? (p.trial!.reward.itemCount ?? 1) : 0 } } } : {}),
    }
    if (p.type === 'festival') ev.endAt = startAt + (p.festival!.durationMin ?? 60) * 60_000
    if (p.type === 'trial') ev.endAt = startAt + (p.trial!.windowMin ?? 30) * 60_000
    if (p.type === 'airdrop') ev.endAt = startAt + 15 * 60_000
    store.events.push(ev)
    store.lastEventAt = startAt
    save()
    log(`EVENT SCHEDULED 「${p.name}」(${p.type}) opens in ${p.delayMin}min`)
    worlddb.chronicleRecord('saga_event', 'Goddess', { name: p.name, type: p.type, status: 'scheduled', opensInMin: p.delayMin, story: p.story })
    return true
  }

  // ── 构思主流程 ──────────────────────────────────────────────────────
  let ideating = false
  async function runIdeation(trigger: 'timer' | 'manual' | 'boot'): Promise<void> {
    if (ideating) return
    ideating = true
    try {
      const brief = buildBrief()
      const answer = await callGoddess(ideationPrompt(brief))
      const parsed = extractJson(answer) as unknown as Ideation | null
      store.lastIdeationAt = Date.now()
      if (!parsed) {
        log(`ideation (${trigger}): goddess reply not JSON, skipped (${answer.slice(0, 80)})`)
        save()
        return
      }
      if (typeof parsed.story_recap === 'string' && parsed.story_recap.trim()) {
        worlddb.chronicleRecord('saga_muse', 'Goddess', { recap: parsed.story_recap.trim().slice(0, 120) })
      }
      const online = onlinePlayers()
      const activeTargets = store.quests.filter((q) => q.status === 'active').map((q) => q.target)
      let created = 0
      if (parsed.atom) {
        const v = validateAtomProposal(parsed.atom, magic.listAtoms().map((a) => ({ id: a.id, name: a.name, words: a.words })))
        if (v.ok) { if (applyAtom(v.value)) created++ } else {
          log(`atom rejected: ${v.reason}`)
          worlddb.chronicleRecord('saga_reject', 'Goddess', { kind: 'atom', reason: v.reason })
        }
      }
      if (parsed.quest) {
        const v = validateQuestProposal(parsed.quest, online, activeTargets)
        if (v.ok) { if (applyQuest(v.value)) created++ } else {
          log(`quest rejected: ${v.reason}`)
          worlddb.chronicleRecord('saga_reject', 'Goddess', { kind: 'quest', reason: v.reason })
        }
      }
      if (parsed.event) {
        const v = validateEventProposal(parsed.event)
        if (v.ok) { if (applyEvent(v.value)) created++ } else {
          log(`event rejected: ${v.reason}`)
          worlddb.chronicleRecord('saga_reject', 'Goddess', { kind: 'event', reason: v.reason })
        }
      }
      log(`ideation (${trigger}): recap=${parsed.story_recap ? 'yes' : 'no'} atom=${parsed.atom ? 'proposed' : '-'} quest=${parsed.quest ? 'proposed' : '-'} event=${parsed.event ? 'proposed' : '-'} created=${created}`)
      save()
    } catch (err) {
      log(`ideation failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      ideating = false
    }
  }

  // ── 巡检：任务核销/作废 + 事件三幕 ───────────────────────────────────
  async function runPoll(): Promise<void> {
    // 神托任务
    for (const q of store.quests) {
      if (q.status !== 'active') continue
      const given = worlddb.ledgerCountSince(q.target, q.demandId, q.startedAt)
      if (given >= q.demandCount) {
        q.status = 'done'
        save()
        // 发奖：修为 + 物品 + 魔力上限
        try {
          if (q.reward.xp > 0) await rcon.send(`xp add ${q.target} ${q.reward.xp} points`)
          if (q.reward.itemId && q.reward.itemCount > 0) await rcon.send(`give ${q.target} minecraft:${q.reward.itemId} ${q.reward.itemCount}`)
          if (q.reward.manaBonus > 0) magic.addMaxManaBonus(q.target, q.reward.manaBonus)
        } catch (err) {
          log(`quest reward failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        courier(q.target, `「${q.title}」——心愿已了。女神铭记你的虔诚：修为 +${q.reward.xp}${q.reward.itemId ? `、${q.reward.itemId}×${q.reward.itemCount}` : ''}${q.reward.manaBonus ? `、魔力上限 +${q.reward.manaBonus}` : ''}。`)
        void announce(`✦ ${q.target} 完成了女神的神托「${q.title}」——虔诚有报。`, {
          title: '✦ 神托已了 ✦',
          subtitle: `${q.target} · ${q.title}`,
          sound: 'minecraft:ui.toast.challenge_complete',
        })
        worlddb.chronicleRecord('saga_quest', 'Goddess', { title: q.title, target: q.target, status: 'done', reward: q.reward })
        log(`QUEST DONE 「${q.title}」 by ${q.target}`)
      } else if (Date.now() > q.deadlineAt) {
        q.status = 'expired'
        save()
        courier(q.target, `「${q.title}」的期限已过，此事就此作罢——女神不怪你，来日方长。`)
        worlddb.chronicleRecord('saga_quest', 'Goddess', { title: q.title, target: q.target, status: 'expired' })
        log(`QUEST EXPIRED 「${q.title}」 (${q.target})`)
      }
    }
    // 大事件
    for (const ev of store.events) {
      if (ev.status === 'done') continue
      if (ev.status === 'scheduled' && Date.now() >= ev.startAt) {
        ev.status = 'running'
        save()
        await openEvent(ev)
      }
      if (ev.status !== 'running') continue
      if (ev.type === 'festival') {
        // 增益续杯（65s > 60s 巡检周期，无缝）
        try { await rcon.send(`effect give @a minecraft:${ev.festival!.effect} 65 ${ev.festival!.amplifier} true`) } catch { /* 无人在场也照发 */ }
      }
      if (ev.type === 'trial' && !ev.trial!.winner) {
        for (const p of onlinePlayers()) {
          const given = worlddb.ledgerCountSince(p, ev.trial!.demandId, ev.startAt)
          if (given >= ev.trial!.demandCount) {
            ev.trial!.winner = p
            save()
            const r = ev.trial!.reward
            try {
              if (r.xp > 0) await rcon.send(`xp add ${p} ${r.xp} points`)
              if (r.itemId && r.itemCount > 0) await rcon.send(`give ${p} minecraft:${r.itemId} ${r.itemCount}`)
            } catch { /* 发奖失败不挡闭幕 */ }
            void announce(`✦ 献纳竞速「${ev.name}」有主——${p} 第一个献上 ${ev.trial!.demandCn}×${ev.trial!.demandCount}，神赏已至。`, {
              title: '✦ 竞速有主 ✦',
              subtitle: `${p} · ${ev.name}`,
              sound: 'minecraft:ui.toast.challenge_complete',
            })
            worlddb.chronicleRecord('saga_event', 'Goddess', { name: ev.name, type: 'trial', status: 'won', winner: p })
            log(`TRIAL WON 「${ev.name}」 by ${p}`)
            break
          }
        }
      }
      if (ev.type === 'airdrop' && !ev.airdrop!.dropped) {
        // 开幕即空投（openEvent 里做，这里兜底防漏）
        await doAirdrop(ev)
      }
      if (Date.now() >= ev.endAt) {
        ev.status = 'done'
        save()
        await closeEvent(ev)
      }
    }
  }

  async function openEvent(ev: SagaEvent): Promise<void> {
    const delayOpenText: Record<SagaEvent['type'], string> = {
      airdrop: `天穹裂开一线——女神的恩赐即将坠落人间。`,
      festival: `今日为「${ev.name}」——女神的福泽如潮，漫过千灯纪。`,
      trial: `女神出了一道题：谁第一个献上 ${ev.trial!.demandCn}×${ev.trial!.demandCount}，赏赐便归谁。`,
    }
    await announce(`✦ 大事件「${ev.name}」——${ev.story} ${delayOpenText[ev.type]}`, {
      title: `✦ ${ev.name} ✦`,
      subtitle: ev.story.slice(0, 30),
      sound: 'minecraft:entity.end_portal.spawn',
    })
    worlddb.chronicleRecord('saga_event', 'Goddess', { name: ev.name, type: ev.type, status: 'open' })
    if (ev.type === 'airdrop') await doAirdrop(ev)
  }

  async function doAirdrop(ev: SagaEvent): Promise<void> {
    if (ev.airdrop!.dropped) return
    ev.airdrop!.dropped = true
    save()
    try {
      // 投放点：随机一位在场者附近 ±12 格、头上 12 格——恩赐落在有人处
      const online = onlinePlayers()
      const bot = deps.getBot()
      let x = -109, y = 76, z = 147
      if (online.length && bot?.players) {
        const pick = online[Math.floor(Math.random() * online.length)]
        const pos = bot.players[pick]?.entity?.position
        if (pos) {
          x = Math.round(pos.x + (Math.random() * 24 - 12))
          z = Math.round(pos.z + (Math.random() * 24 - 12))
          y = Math.round(pos.y) + 12
        }
      }
      ev.airdrop!.x = x; ev.airdrop!.y = y; ev.airdrop!.z = z
      for (const l of ev.airdrop!.loot) {
        await rcon.send(`summon minecraft:item ${x} ${y} ${z} {Item:{id:"minecraft:${l.id}",Count:${l.count}b}}`)
      }
      await rcon.send(`execute positioned ${x} ${y} ${z} run particle minecraft:end_rod ~ ~-6 ~ 1.2 6 1.2 0.02 260`)
      await rcon.send(`execute positioned ${x} ${y} ${z} run particle minecraft:firework ~ ~ ~ 1.5 1.5 1.5 0.1 80`)
      await rcon.send(`playsound minecraft:entity.lightning_bolt.thunder master @a`)
      const lootText = ev.airdrop!.loot.map((l) => `${OFFERING_ITEM_CN[l.id] ?? l.id}×${l.count}`).join('、')
      await announce(`✦ 恩赐坠落！光柱之处（${x}, ${z} 附近）——先至者得之：${lootText}`, {
        title: '✦ 恩赐坠落 ✦',
        subtitle: `光柱 · (${x}, ${z})`,
        sound: 'minecraft:block.beacon.activate',
      })
      worlddb.chronicleRecord('saga_event', 'Goddess', { name: ev.name, type: 'airdrop', status: 'dropped', at: [x, y, z], loot: lootText })
      log(`AIRDROP dropped at (${x},${y},${z}): ${lootText}`)
    } catch (err) {
      log(`airdrop failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function closeEvent(ev: SagaEvent): Promise<void> {
    let text: string
    if (ev.type === 'trial' && !ev.trial!.winner) {
      text = `「${ev.name}」落幕——无人应召，神意收回悬赏。`
    } else if (ev.type === 'festival') {
      text = `「${ev.name}」落幕——福泽退潮，愿众生记得今日的暖意。`
    } else {
      text = `「${ev.name}」落幕——恩赐已归于尘世。`
    }
    await announce(`✦ ${text}`, { sound: 'minecraft:block.beacon.deactivate' })
    worlddb.chronicleRecord('saga_event', 'Goddess', { name: ev.name, type: ev.type, status: 'closed' })
    log(`EVENT CLOSED 「${ev.name}」`)
  }

  // ── 调度 ────────────────────────────────────────────────────────────
  function scheduleIdeation(): void {
    lc.setTimeout(() => {
      if (Date.now() - store.lastIdeationAt >= config.sagaMs) void runIdeation('timer')
      scheduleIdeation()
    }, config.sagaMs)
  }
  lc.setTimeout(() => {
    void runIdeation('boot')
    scheduleIdeation()
  }, config.firstDelayMs)

  function schedulePoll(): void {
    lc.setTimeout(() => {
      void runPoll().catch((err) => log(`poll error: ${err instanceof Error ? err.message : String(err)}`))
      // 手动触发把手：往 data/saga-trigger 丢个文件即立刻构思
      if (existsSync(triggerPath)) {
        try { unlinkSync(triggerPath) } catch { /* 竞态无害 */ }
        log('manual trigger detected')
        void runIdeation('manual')
      }
      schedulePoll()
    }, config.pollMs)
  }
  schedulePoll()

  log(`saga armed (ideation every ${Math.round(config.sagaMs / 60000)}min, poll ${Math.round(config.pollMs / 1000)}s, atoms/day ${config.maxAtomsPerDay}, quests ${store.quests.filter((q) => q.status === 'active').length} active, events ${store.events.filter((e) => e.status !== 'done').length} in flight)`)

  return { dispose: () => lc.dispose() }
}
