import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Bot } from 'mineflayer'
import type { RconService } from './mc-rcon.ts'
import type { AtomSummary, MagicService } from './mc-magic.ts'
import { GIVE_WHITELIST, BALANCE_FIELD_ALIASES, balanceFieldLabel } from './mc-magic.ts'
import type { Transmigrator } from './mc-transmigrator.ts'
import { OFFERING_ITEM_CN, parseInventoryCounts, resolveOfferingText, type OfferingInfo } from './mc-offering.ts'
import { CHRONICLE_TYPE_CN } from './mc-worlddb.ts'
import type { InboxRow, MemoryHit, WorlddbService } from './mc-worlddb.ts'

/**
 * mc-god —— 慢路径女神（世界守护者，QwenPaw Agent mc-god）+ 女神化身管理。
 *
 * 女神三职（2026-08-16 定稿，2026-08-16 存储升格世界数据库）：
 *   1. 裁量者：祷告有价——祈愿可自愿献上供奉（贡品从行囊消失，/clear 收执），
 *      女神按供品贵贱与供奉史掂量虔诚度，再决定代施/拒绝/提条件；
 *   2. 守望者：观察穿越者的生存情况（死亡计分板轮询、在线行迹），
 *      周期汇总成世界迭代的《需求文档》（疑似 bug / 改进需求 / 穿越者困境）；
 *   3. 史官：把世界运行与穿越者历程逐条记入编年史（SQLite 真源 + 可读 md 导出），
 *      作为日后动漫/小说改编的素材底稿；咏唱/升级/降临由 mc-magic 上报。
 *
 * 持久层（mc-worlddb，正规数据库）：祈愿收件箱/供奉账本/编年史/观察期报
 * 全部落 SQLite（data/world.db）；众生册（女神与每人的互动记忆）落 Qdrant
 * 独立 collection，语义召回注入裁决 prompt——女神因此「记得」旧缘，
 * 且记忆归世界数据库所有，与家里 MemOS 记忆系统完全分开。
 *
 * 三层技能体系：
 *   1. 技能服务（mc-magic）是个纯程序：结构化状态库（等级/已学技能/魔力，惰性回蓝）
 *      记录每个穿越者的实时状态，瞬发施法全程零 LLM；
 *   2. 女神握有全部技艺（含传送/圣愈/破晓……）。玩家已学会的技能自己咏唱瞬发；
 *      没学会的可以祷告求女神代施——女神裁量，觉得不该帮就不帮；
 *   3. 祷告不是实时任务：祈愿先进收件箱（持久化队列），女神按自己的节奏
 *      一条一条处理（poll 间隔可配）。神谕异步私聊送达。
 *
 * 处理管线（每条祈愿）：
 *   a. 程序化预过滤（零 LLM，毫秒级）：祈愿命中某技艺关键词且玩家已习得
 *      → 直接点拨他自己咏唱（魔力不足则告知回蓝秒数）；
 *   b. 未习得 / 未命中 → 女神 Agent（本地 LLM，有长期记忆与众生册）裁决，
 *      输出 JSON：cast（代施哪项技艺+参数）/ none（拒绝/点拨/提条件）；
 *   c. cast 经世界侧第二道闸（每技艺全局冷却、造物白名单、数量上限）
 *      → mc-magic.castByGod 落地（不耗玩家资源）→ 私聊回传神谕。
 */
export const name = 'mc-god'
export const inject = ['mcbot', 'mcRcon', 'mcLogwatch', 'mcMagic', 'mcTransmigrators', 'mcWorlddb', 'timer']

export interface Config {
  enabled: boolean
  /** QwenPaw 本地 API（女神 Agent 挂在这里，长期记忆/众生册由世界数据库管） */
  qwenpawUrl: string
  /** 女神代施的每技艺全局冷却 */
  cooldownMs: number
  /** 收件箱轮询间隔（女神多久看一眼信箱） */
  pollMs: number
  /** 同一玩家两次祈愿的最小间隔（入场节流，防刷屏） */
  admitCooldownMs: number
  /** 死亡计分板轮询间隔（守望者） */
  deathPollMs: number
  /** 世界观察周期（需求文档多久汇总一期） */
  reviewMs: number
  /** 世界迭代需求文档（md 导出物；真源在 world.db reviews 表） */
  requirementsPath: string
  /** 众生册：裁决时召回几条前尘注入 prompt */
  recallTopK: number
  /** 稀有被动事件配置（data/skill-events.json） */
  skillEventsPath: string
  /** MC 服务器 advancements 目录（成就监听：读 <uuid>.json diff 出新成就） */
  advancementsDir: string
  /** 成就→技能/加成映射（data/advancement-unlocks.json） */
  advancementUnlocksPath: string
  /** 成就中文名表（data/advancement-names.json，公告用） */
  advancementNamesPath: string
  /** 天平引擎维护者名单（可对女神喊「平衡 …」的玩家名；其他玩家只能祈愿陈情）。 */
  maintainers: string[]
  /** 天平公告攒批窗口：调整即时生效但公告攒一波一起发（版本更新式，防公屏刷屏）。 */
  balanceFlushMs: number
  /** 攒批队列落盘文件（重启不丢未发公告）。 */
  bulletinPath: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  qwenpawUrl: Schema.string().default('http://127.0.0.1:8088/api/console/chat'),
  cooldownMs: Schema.number().default(60_000),
  pollMs: Schema.number().default(12_000),
  admitCooldownMs: Schema.number().default(30_000),
  deathPollMs: Schema.number().default(20_000),
  reviewMs: Schema.number().default(7_200_000),
  requirementsPath: Schema.string().default('./data/world-requirements.md'),
  recallTopK: Schema.number().default(5),
  skillEventsPath: Schema.string().default('./data/skill-events.json'),
  advancementsDir: Schema.string().default('C:/Users/lzl19/Documents/airi-minecraft/server/advancements'),
  advancementUnlocksPath: Schema.string().default('./data/advancement-unlocks.json'),
  advancementNamesPath: Schema.string().default('./data/advancement-names.json'),
  /** 天平引擎维护者名单（可对女神喊「平衡 …」的玩家名；其他玩家只能祈愿陈情）。 */
  maintainers: Schema.array(Schema.string()).default(['MengMeng']),
  balanceFlushMs: Schema.number().default(300_000),
  bulletinPath: Schema.string().default('./data/balance-bulletin.json'),
})

// ── 程序化预过滤（纯函数，可离线单测）─────────────────────────────────
export interface InstantPlanView {
  mana: number
  learned: string[]
  innateSkill: string | null
}

/**
 * 祈愿命中「已习得」的技艺时，不需要劳驾女神——程序直接给答案：
 *   - 魔力够 → 点拨他自己咏唱（神不代施已授之能）；
 *   - 魔力不够 → 告知回蓝还需多少秒。
 * 返回 null = 需要 LLM 裁量（未习得 / 未命中任何技艺关键词）。
 */
export function planInstantReply(
  wish: string,
  view: InstantPlanView,
  atoms: Array<{ id: string; name: string; words: string[]; cost: { mana: number } }>,
  regenPerSec: number,
): string | null {
  for (const a of atoms) {
    if (!a.words.some((w) => wish.includes(w))) continue
    const learned = view.learned.includes(a.id) || view.innateSkill === a.id
    if (!learned) return null // 未习得 → 女神裁量
    if (view.mana >= a.cost.mana) {
      return `「${a.name}」你已习得，自己咏唱即可（如「${a.words[0]}」）——神不代施已授之能。`
    }
    const waitSec = Math.ceil((a.cost.mana - view.mana) / Math.max(0.1, regenPerSec))
    return `「${a.name}」你已习得，但魔力不足（需 ${a.cost.mana}，现有 ${Math.floor(view.mana)}）——静候约 ${waitSec} 秒回蓝后自行咏唱。`
  }
  return null
}

// ── 供奉协议（私聊祈愿尾缀「｜供奉：面包x3」）─────────────────────────
// OfferingInfo 已上移至 mc-offering.ts（穿越者侧 + 世界侧 + 世界数据库共用）。

/** 把祈愿文本拆成 { 愿望, 供奉描述 }；无供奉尾缀时 offering 为 null。 */
export function splitWishOffering(message: string): { wish: string; offeringText: string | null } {
  const m = message.match(/[｜|]\s*供奉[:：]\s*(.+)$/)
  if (!m) return { wish: message.trim(), offeringText: null }
  return { wish: message.slice(0, m.index).trim(), offeringText: m[1].trim() }
}

// ── 收件箱 / 账本 / 编年史：已升格为世界数据库（mc-worlddb，SQLite + Qdrant 众生册）──

// ── 女神裁决（LLM，异步）──────────────────────────────────────────────
interface Verdict {
  action: 'cast' | 'none'
  skill: string | null
  item: string | null
  count: number
  direction: string | null
  distance: number | null
  reply: string
}

const GIVE_ITEMS_TEXT = Object.entries(GIVE_WHITELIST).map(([cn, id]) => `${cn}/${id}`).join('、')

function atomsTableText(atoms: AtomSummary[]): string {
  return atoms
    .map((a) => `${a.id}「${a.words.slice(0, 2).join('/')}」Lv${a.requiredLevel} 魔${a.cost.mana}`)
    .join('\n')
}

function fmtMemoryTime(at: number): string {
  const ts = new Date(at)
  return `${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
}

function verdictPrompt(
  senderName: string,
  wish: string,
  atoms: AtomSummary[],
  snapshot: string,
  offering: OfferingInfo | undefined,
  devotion: string,
  memories: MemoryHit[],
): string {
  const lines = [
    `【祈愿】${senderName}：${wish}`,
  ]
  if (offering) {
    lines.push(`【本次供奉】${offering.cn}×${offering.count}（已从他的行囊收执，归入神库；无论你如何裁断，供品不退还）`)
  } else {
    lines.push('【本次供奉】无（空手祈愿）')
  }
  lines.push(`【供奉史】${devotion}`)
  if (memories.length > 0) {
    lines.push('【众生册·前尘】你亲笔记下的与此人旧事（按相关度召回）：')
    lines.push(...memories.map((m) => `- [${fmtMemoryTime(m.at)}] ${m.text.slice(0, 100)}`))
  } else {
    lines.push('【众生册·前尘】你与此人尚无旧缘')
  }
  lines.push('', `【世界现状】${snapshot}`, '')
  lines.push('【法则技艺表】女神可代施的全部技艺（id「关键词」等级 魔耗）：')
  lines.push(atomsTableText(atoms))
  lines.push('', `【可赐物资】造物术仅限白名单：${GIVE_ITEMS_TEXT}`, '')
  lines.push('【神谕裁决协议】只输出一个 JSON 对象（不要多余文字、不要调用任何工具、不要检索记忆——现状已给出）：')
  lines.push('{"action":"cast或none","skill":"<技艺id，cast时必填>","item":"<物品id，仅造物>","count":1-16,"direction":"东/南/西/北/组合","distance":<格数>,"reply":"<一句中文神谕>"}', '')
  lines.push('裁决要点：')
  lines.push('- 求的技艺他未习得（程序已过滤已习得的）→ 你裁量：值得帮 → cast 代施；滥用/无礼/贪心/理由不足 → none 拒绝或提条件；')
  lines.push('- 供奉与虔诚是你的裁量依据：危难中慷慨、贵重之物（钻石/绿宝石/金锭/附魔书/末影珍珠）更显诚心，可优先垂怜；口粮级小供奉配小心愿即可；空手求大术，可以拒绝或在 reply 里向他索要供奉——让世人明白神恩有价；')
  lines.push('- 造物只从白名单选 item，数量克制（1-16）；')
  lines.push('- 破晓/驱云是全服天象，影响众生，慎用；天雷/陨石等毁灭技艺除非理由充分不施；')
  lines.push('- 纯闲聊、试探、问问题 → none，reply 里以神谕口吻回应；')
  lines.push('- reply 话少而重，有神性。')
  return lines.join('\n')
}

function reviewPrompt(statsText: string, sampleLines: string): string {
  return [
    '你是「初始之地」世界的守护女神，也是世界的守望者与史官。',
    '以下是自上次观察以来，世界运行记录的统计与摘录：',
    '',
    `【统计】${statsText}`,
    '',
    '【记录摘录】',
    sampleLines,
    '',
    '请以守望者身份输出 markdown（不要 JSON、不要调用任何工具），三节：',
    '## 异常与疑似 bug —— 世界/系统层面的问题迹象（反复失败、卡死、失效）',
    '## 改进需求 —— 让这个世界更好玩/更稳的具体建议',
    '## 穿越者困境 —— 反复死亡、卡关、求而不得的模式，以及女神可以做的事',
    '每节若无内容写「无」。话要具体、可执行，是给世界缔造者看的需求文档。',
  ].join('\n')
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

// ── 祈愿命中「已习得」的技艺时，不需要劳驾女神——程序直接给答案（见 planInstantReply）──
export interface LawRequest { rule: string; value: boolean; via: string }

// ── 天平引擎（2026-08-17 扛枪提议：女神=世界维护者，动态平衡技能）──────
// 「平衡」通道：仅维护者名单可用（config.maintainers），程序化代行、零 LLM、
// 白名单+护栏校验在 mc-magic.applyBalancePatch；每次调整入编年史 type='balance'。
// 写法（对女神说，公屏或私聊皆可）：
//   平衡                                  → 查看当前全部补丁
//   平衡 陨石术 魔力 90                    → 调某法术（魔力/饱食/生命/血量/等级/门槛）
//   平衡 回蓝 3                            → 全局回蓝速率（点/秒）
//   重置平衡 [法术]                        → 撤销补丁（省略法术 = 清空全部）
export interface BalanceRequest {
  kind: 'show' | 'patch' | 'reset'
  atom?: string
  field?: string
  value?: number
  via: string
}

// ── 天平公告（版本更新式攒批：调整即时生效、公告攒一波统一昭告，防公屏刷屏）──
export interface BulletinNote {
  /** 落笔时间（ms epoch） */
  at: number
  /** 单条摘要（如「陨石术 魔力 = 90」「回蓝速率 = 3/秒」「天平复位——撤 3 道」） */
  text: string
  /** 执秤者 */
  by: string
}

/** 把攒批的公告合成一条公屏文本（纯函数，单测覆盖）。 */
export function formatBulletin(notes: BulletinNote[]): string {
  if (!notes.length) return ''
  const lines = notes.map((n) => `· ${n.text}（${n.by}）`)
  return `本轮法度调整 ${notes.length} 条：\n${lines.join('\n')}`
}

/** 平衡命令匹配（纯函数，可离线单测）。 */
export function matchBalance(message: string): BalanceRequest | null {
  const m = message.trim()
  if (m === '平衡' || m === '天平' || m === '平衡一览' || m === '天平一览') return { kind: 'show', via: 'syntax' }
  const rst = m.match(/^重置平衡(?:\s+(.+))?$/)
  if (rst) return { kind: 'reset', atom: rst[1]?.trim(), via: 'syntax' }
  const p = m.match(/^(?:平衡|天平)\s+(.+)$/)
  if (!p) return null
  const rest = p[1].trim()
  const g = rest.match(/^(回蓝|回蓝速度)\s+([0-9]+(?:\.[0-9])?)$/)
  if (g) return { kind: 'patch', field: BALANCE_FIELD_ALIASES[g[1]], value: Number(g[2]), via: 'syntax' }
  const parts = rest.split(/\s+/)
  if (parts.length === 3) {
    const field = BALANCE_FIELD_ALIASES[parts[1]]
    const value = Number(parts[2])
    if (field && field !== 'regenPerSec' && Number.isFinite(value)) {
      return { kind: 'patch', atom: parts[0], field, value, via: 'syntax' }
    }
  }
  return null
}


/** 服主法则白名单（gamerule）：只有这些可被女神修订。 */
export const LAW_WHITELIST: Record<string, string> = {
  keep_inventory: '死亡不失行囊',
  mob_griefing: '怪物毁坏世界',
  do_daylight_cycle: '昼夜流转',
  do_weather_cycle: '天气流转',
  do_fire_tick: '火焰蔓延',
  do_mob_spawning: '怪物滋生',
  show_death_messages: '讣告广播',
  do_insomnia: '幻翼窥伺',
}

/** 法则请求匹配（纯函数，可离线单测）：精确语法 + 自然语言短语。 */
export function matchLaw(message: string): LawRequest | null {
  const exact = message.match(/^法则\s+([a-z_]+)\s+(true|false)$/i)
  if (exact) {
    const rule = exact[1].toLowerCase()
    if (!(rule in LAW_WHITELIST)) return { rule: '', value: false, via: `unknown:${rule}` } // 空规则=白名单拒绝信号
    return { rule, value: exact[2].toLowerCase() === 'true', via: 'syntax' }
  }
  const phrases: Array<[RegExp, string, boolean]> = [
    [/死亡(不|勿|不再)?失行囊|死亡不掉(落)?(装备|物品|行囊)/, 'keep_inventory', true],
    [/夺回死亡的代价|死亡(应|要|该)?掉(落)/, 'keep_inventory', false],
    [/怪物(不|勿|不得|不再)(可)?毁坏(世界|方块)/, 'mob_griefing', false],
    [/放任怪物毁坏(世界|方块)/, 'mob_griefing', true],
    [/时间(自由|重新)?(流转|流动|正常)/, 'do_daylight_cycle', true],
    [/时间(停驻|静止|停摆|冻结)/, 'do_daylight_cycle', false],
    [/让?(天空|天气)(自由|重新)?(流转|变化)/, 'do_weather_cycle', true],
    [/天气(停驻|静止|恒定)/, 'do_weather_cycle', false],
    [/火焰(不|勿|不得)(得)?蔓延/, 'do_fire_tick', false],
    [/放任火焰蔓延/, 'do_fire_tick', true],
    [/怪物(不|勿|不得)(再)?滋生|阻止(怪物|生物)生成/, 'do_mob_spawning', false],
    [/怪物(重新|恢复)?滋生/, 'do_mob_spawning', true],
  ]
  for (const [re, rule, value] of phrases) {
    if (re.test(message)) return { rule, value, via: 'phrase' }
  }
  return null
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-god] ${msg}`)
  // 女神化身实例随重连变化，须每次现取。
  const getBot = (): Bot => ctx.mcbot
  const rcon: RconService = ctx.mcRcon
  const magic: MagicService = ctx.mcMagic
  const lastUsed = new Map<string, number>() // 每技艺全局冷却
  const lastPray = new Map<string, number>() // 每玩家入场节流
  const worlddb: WorlddbService = ctx.mcWorlddb

  // ── 供奉收执（RCON 权威复核 + /clear 收走，贡品即从行囊消失）──────
  async function takeOffering(username: string, offer: OfferingInfo): Promise<{ ok: true; taken: number } | { ok: false; reason: string }> {
    try {
      const out = await rcon.send(`data get entity ${username} Inventory`)
      const counts = parseInventoryCounts(out)
      const bare = offer.id.replace(/^minecraft:/, '')
      const have = counts.get(bare) ?? 0
      if (have < offer.count) {
        return { ok: false, reason: `你的行囊里只有 ${have} 个${offer.cn}，凑不齐 ${offer.cn}×${offer.count} 的供奉。` }
      }
      const clearOut = await rcon.send(`clear ${username} minecraft:${bare} ${offer.count}`)
      const m = clearOut.match(/Removed (\d+)/i)
      const taken = m ? parseInt(m[1], 10) : offer.count
      if (taken <= 0) return { ok: false, reason: '神库收执时你的供品不见了（也许刚被你用掉）。' }
      const actual: OfferingInfo = taken < offer.count ? { ...offer, count: taken } : offer
      worlddb.ledgerRecord(username, actual)
      worlddb.chronicleRecord('offering', username, { cn: actual.cn, count: actual.count, id: actual.id })
      log(`offering taken from ${username}: ${actual.cn}x${actual.count}`)
      return { ok: true, taken: actual.count }
    } catch (err) {
      return { ok: false, reason: `神库暂不可用（${err instanceof Error ? err.message : String(err)}），供奉未收，祈愿稍后再试。` }
    }
  }

  // ── 问女神（QwenPaw Agent mc-god，本地 LLM）─────────────────────────
  /** 底层通道：console chat + SSE 解析，返回最后一条正式回答全文。 */
  async function callAgent(sessionId: string, userId: string, prompt: string): Promise<string> {
    const payload = {
      channel: 'console',
      user_id: userId,
      session_id: sessionId,
      input: [{
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      }],
    }
    const res = await fetch(config.qwenpawUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': 'mc-god' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`goddess API ${res.status}: ${(await res.text()).slice(0, 200)}`)

    // SSE 解析：只取最后一条正式回答（message:message）的 content；
    // reasoning 思考流与 plugin_call 参数流全部丢弃。增量优先，全文兜底。
    const text = await res.text()
    let messageId: string | null = null
    let answer = ''
    const pending: Record<string, { delta: string; full: string }> = {}
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue
      const body = line.slice(5).trim()
      if (!body) continue
      let evt: any
      try { evt = JSON.parse(body) } catch { continue }
      if (evt.object === 'message') {
        if (evt.type === 'message') messageId = evt.id
        continue
      }
      if (evt.object === 'content' && typeof evt.msg_id === 'string') {
        const t = evt.data?.text ?? evt.text ?? ''
        if (!t) continue
        const slot = (pending[evt.msg_id] ??= { delta: '', full: '' })
        if (evt.delta === false) slot.full = t
        else slot.delta += t
      }
    }
    if (messageId && pending[messageId]) {
      answer = pending[messageId].delta || pending[messageId].full
    }
    log(`goddess answered (${answer.length} chars): ${answer.slice(0, 160)}`)
    return answer
  }

  /**
   * 神谕裁决：她有长期记忆与众生册——同一穿越者的祈愿落在同一 session，
   * 恩情与冒犯、供奉与亵渎都留痕。
   */
  async function askGoddess(username: string, senderName: string, wish: string, offering: OfferingInfo | undefined): Promise<Verdict> {
    const ms = magic.getState(username)
    const atoms = magic.listAtoms()
    const learnedNames = ms.learned
      .map((id) => magic.getAtomById(id)?.name ?? id)
      .join('/')
    const snapshot = [
      `法力 ${Math.floor(ms.mana)}/${ms.maxMana}，等级 ${ms.level}`,
      `已习得技艺：${learnedNames || '无'}`,
      `出生天赋：${ms.innateSkill ? (magic.getAtomById(ms.innateSkill)?.name ?? ms.innateSkill) : '未定'}`,
      '（注：已习得且魔力足够的祈愿已被程序拦截，不会上达于你——你看到的都是未习得或特殊心愿）',
    ].join('；')
    const memories = await worlddb.recall(username, wish, config.recallTopK)
    const prompt = verdictPrompt(senderName, wish, atoms, snapshot, offering ?? undefined, worlddb.ledgerSummary(username), memories)
    const answer = await callAgent(`mc:${username}:prayers`, username, prompt)

    const parsed = extractJson(answer)
    const fallback: Verdict = { action: 'none', skill: null, item: null, count: 1, direction: null, distance: null, reply: '（女神沉默不语，神力似乎在波动）' }
    if (!parsed || typeof parsed.action !== 'string') return fallback
    const action = parsed.action === 'cast' ? 'cast' : 'none'
    const validIds = new Set(magic.listAtoms().map((a) => a.id))
    const skill = typeof parsed.skill === 'string' && validIds.has(parsed.skill) ? parsed.skill : null
    const item = typeof parsed.item === 'string' && Object.values(GIVE_WHITELIST).includes(parsed.item) ? parsed.item : null
    const count = typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? Math.max(1, Math.min(16, Math.floor(parsed.count))) : 1
    const direction = typeof parsed.direction === 'string' && parsed.direction.trim() ? parsed.direction.trim() : null
    const distance = typeof parsed.distance === 'number' && Number.isFinite(parsed.distance) ? parsed.distance : null
    const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : '愿神力庇佑于你。'
    // cast 但技艺不合法 → 降级为 none
    if (action === 'cast' && !skill) return { ...fallback, reply }
    return { action, skill, item, count, direction, distance, reply }
  }

  // ── 处理一封祈愿信（收件箱处理器调用，一次一封）──────────────────────
  async function handleOne(item: InboxRow): Promise<void> {
    const bot = getBot()
    const { username, wish } = item
    const offering = item.offering ?? undefined
    const senderName = item.name || username
    const whisper = (text: string) => {
      try {
        bot.whisper(username, `[女神] ${senderName}，${text}`)
      } catch {
        /* bot not ready */
      }
    }
    if (!bot.entity) throw new Error('avatar offline')

    // 快捷应答：找回出生天赋（穿越者进程重启后的记忆找回，不打扰女神）
    if (/天赋/.test(wish) && /什么|我的|哪/.test(wish)) {
      const innateId = magic.getInnate(username)
      const atom = innateId ? magic.getAtomById(innateId) : null
      whisper(atom
        ? `你的出生天赋是「${atom.name}」，自降临之日起便镌在你的灵魂里，从未改变。`
        : '你尚未在降临仪式上选定出生天赋——女神会择机为你主持仪式。')
      worlddb.inboxComplete(item.id, 'innate-memory')
      return
    }

    // 程序化预过滤：已习得的技艺，零 LLM 直接点拨（毫秒级）
    const ms = magic.getState(username)
    const instant = planInstantReply(wish, { mana: ms.mana, learned: ms.learned, innateSkill: ms.innateSkill }, magic.listAtoms(), 2.0)
    if (instant) {
      log(`instant reply for ${username}: ${instant.slice(0, 80)}`)
      whisper(instant)
      worlddb.chronicleRecord('verdict', username, { action: 'instant', reply: instant })
      await worlddb.remember(username, 'instant', `${senderName}求「${wish.slice(0, 50)}」——该技艺他已习得，被点拨自行咏唱`)
      worlddb.inboxComplete(item.id, 'instant')
      return
    }

    // 女神裁量（LLM，异步）
    const verdict = await askGoddess(username, senderName, wish, offering)
    if (verdict.action === 'none' || !verdict.skill) {
      whisper(verdict.reply)
      worlddb.chronicleRecord('verdict', username, { action: 'none', skill: null, reply: verdict.reply })
      await worlddb.remember(username, 'verdict', `${senderName}祈愿「${wish.slice(0, 60)}」${offering ? `，供奉${offering.cn}×${offering.count}` : '（空手）'}；你未应允，神谕：「${verdict.reply.slice(0, 60)}」`)
      worlddb.inboxComplete(item.id, `none: ${verdict.reply.slice(0, 60)}`)
      return
    }

    // 第二道闸：每技艺全局冷却
    const now = Date.now()
    const last = lastUsed.get(verdict.skill) ?? 0
    if (now - last < config.cooldownMs) {
      const wait = Math.ceil((config.cooldownMs - (now - last)) / 1000)
      whisper(`此术神力尚未回蓄（约 ${wait} 秒后方可再显灵）。${verdict.reply}`)
      worlddb.chronicleRecord('verdict', username, { action: 'cooldown', skill: verdict.skill, reply: verdict.reply })
      await worlddb.remember(username, 'verdict', `${senderName}祈愿「${wish.slice(0, 60)}」${offering ? `，供奉${offering.cn}×${offering.count}` : '（空手）'}；你欲应允「${verdict.skill}」但此术神力回蓄中：「${verdict.reply.slice(0, 60)}」`)
      worlddb.inboxComplete(item.id, `cooldown:${verdict.skill}`)
      return
    }

    // 神迹落地（不耗祈愿者资源）
    const result = await magic.castByGod(username, verdict.skill, {
      direction: verdict.direction ?? undefined,
      distance: verdict.distance ?? undefined,
      item: verdict.item ?? undefined,
      count: verdict.count,
    })
    lastUsed.set(verdict.skill, now)
    log(`blessing granted: ${verdict.skill} for ${username} wish "${wish}" -> ${result}`)
    worlddb.chronicleRecord('verdict', username, { action: 'cast', skill: verdict.skill, reply: verdict.reply })
    worlddb.chronicleRecord('godcast', username, { skill: verdict.skill, result })
    await worlddb.remember(username, 'verdict', `${senderName}祈愿「${wish.slice(0, 60)}」${offering ? `，供奉${offering.cn}×${offering.count}` : '（空手）'}；你应允代施「${verdict.skill}」，神迹落地：${String(result).slice(0, 60)}；神谕：「${verdict.reply.slice(0, 60)}」`)
    whisper(`${verdict.reply}（${result}）`)
    worlddb.inboxComplete(item.id, `cast:${verdict.skill}`)
  }

  // ── 收件箱处理器：女神按自己的节奏一封一封看信 ────────────────────────
  let busy = false
  let disposed = false
  let stopPoll: (() => void) | null = null
  const failCount = new Map<number, number>() // 毒信防护：同一封连续失败 3 次即归档
  function schedulePoll() {
    if (disposed) return
    stopPoll = ctx.setTimeout(async () => {
      if (!busy && worlddb.inboxPendingCount() > 0) {
        busy = true
        const item = worlddb.inboxPeek()
        if (item) {
          try {
            await handleOne(item)
            failCount.delete(item.id)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            log(`wish #${item.id} processing failed for ${item.username}: ${msg}`)
            const fails = (failCount.get(item.id) ?? 0) + 1
            if (fails >= 3) {
              // 化身长期离线等顽疾：归档并明示，不让一封坏信卡死整个信箱
              worlddb.inboxComplete(item.id, `error x${fails}: ${msg.slice(0, 80)}`)
              failCount.delete(item.id)
            } else {
              failCount.set(item.id, fails) // 瞬时故障：信仍在队首，下轮重试
            }
          }
        }
        busy = false
      }
      schedulePoll()
    }, config.pollMs)
  }
  schedulePoll()

  // ── 守望者：死亡计分板轮询（scoreboard deathCount，权威）─────────────
  const DEATH_OBJ = 'mcdeaths'
  const deathScores = new Map<string, number>()
  let deathObjReady = false
  let stopDeathPoll: (() => void) | null = null
  let deathPollArmedLogged = false

  /** "Kirito has 2 [mcdeaths]" → 2（1.21.11 无 score 字样；旧版 "has 2 score(s)"）。 */
  function parseDeathScore(out: string): number {
    const m = out.match(/has\s+(-?\d+)\s*\[/i) ?? out.match(/has (-?\d+) score/i) ?? out.match(/(-?\d+) scores?/)
    return m ? parseInt(m[1], 10) : 0
  }

  /** 死亡入册（快/慢路径共用）。prev 由调用方传入（log 路径 set 先于 record，从 map 读会拿到新值）。 */
  function recordDeath(name: string, prev: number | undefined, cur: number, evidence?: { cause?: string; killer?: string; text: string }): void {
    log(`death detected: ${name} (${prev ?? '?'} -> ${cur})${evidence ? ` [log: ${evidence.text}]` : ''}`)
    const detail: Record<string, unknown> = { total: cur, source: evidence ? 'log' : 'poll' }
    if (evidence) {
      if (evidence.cause) detail.cause = evidence.cause
      if (evidence.killer) {
        detail.killer = evidence.killer
        const bot = getBot()
        if (bot?.players?.[evidence.killer]) detail.pvp = true
      }
    }
    worlddb.chronicleRecord('death', name, detail)
  }

  // ── 守望者·快路径：log-tail 事件层（2026-08-17 扛枪拍板）───────────
  // latest.log 实时广播死亡 → 秒级触发；计分板仍是权威：
  // log 触发后立刻 RCON 复核 mcdeaths，没动 = 误报/重放丢弃。
  // 死亡延迟从 ~20s 降到 <1s，编年史还能记下轮询拿不到的死因与击杀者。
  const offLogwatch = ctx.mcLogwatch?.subscribe((ev) => {
    if (ev.kind !== 'death') return // join/leave/成就/聊天已有各自通道，此处不重复入册
    const name = ev.player
    if (name === getBot()?.username) return
    void (async () => {
      try {
        if (!deathObjReady) {
          await rcon.send(`scoreboard objectives add ${DEATH_OBJ} deathCount`)
          deathObjReady = true
        }
        const out = await rcon.send(`scoreboard players get ${name} ${DEATH_OBJ}`)
        const cur = parseDeathScore(out)
        const prev = deathScores.get(name)
        if (prev === undefined) {
          // 尚未基线：log 只尾随启动后的新写入，这行死亡必然刚发生 → 信任并基线
          deathScores.set(name, cur)
          recordDeath(name, undefined, cur, ev)
        } else if (cur > prev) {
          deathScores.set(name, cur)
          recordDeath(name, prev, cur, ev)
        } else {
          log(`log death for ${name} not confirmed by scoreboard (cur=${cur}, prev=${prev}), ignored`)
        }
      } catch (err) {
        // RCON 复核失败不抢跑入册：留给 20s 轮询路径兜底（那里 cur>prev 会补记）
        log(`log death verify failed for ${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()
  })

  // ── 稀有被动事件引擎（2026-08-17 扛枪定调：苦难即修行）──────────────
  // 生命 tick 每 deathPollMs 采集在线玩家 HP → 写入 hpRatio 缓存（回蓝倍率用）
  // → 对每个启用被动做条件累积（只累不清零）→ 达标即宣诏解锁。
  interface PassiveDef {
    id: string
    name: string
    enabled: boolean
    trigger: { metric: string; op: string; threshold: number; accumulateSec: number }
    /** 解锁后的持续效果：mc_effect = 条件成立时女神 RCON 给药水效果（如血怒→力量）。 */
    effect?: {
      kind: 'regen_multiplier' | 'mc_effect'
      when?: { metric: string; op: string; threshold: number }
      multiplier?: number
      mcId?: string
      durationSec?: number
      amplifier?: number
      sound?: string
    }
    expReward?: number
    announce: string
  }
  const DEFAULT_PASSIVES: PassiveDef[] = [{
    id: 'fortitude', name: '坚毅', enabled: true,
    trigger: { metric: 'hpRatio', op: '<=', threshold: 0.3, accumulateSec: 600 },
    expReward: 30,
    announce: '汝于濒死之境徘徊而不倒——苦难即修行。女神赐予「坚毅」：濒死之时，魔力如泉。',
  }]
  let passiveDefs: PassiveDef[] = DEFAULT_PASSIVES
  const skillEventsPath = resolve(config.skillEventsPath)
  if (existsSync(skillEventsPath)) {
    try {
      const raw = JSON.parse(readFileSync(skillEventsPath, 'utf-8'))
      const list = Array.isArray(raw) ? raw : raw?.passives
      if (Array.isArray(list) && list.length > 0) {
        passiveDefs = list as PassiveDef[]
        log(`loaded ${passiveDefs.length} passive(s) from ${skillEventsPath}`)
      }
    } catch (err) {
      log(`failed to load skill-events, using defaults: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const enabledPassives = passiveDefs.filter((p) => p.enabled !== false)

  // ── 成就监听引擎（2026-08-17 扛枪提议：MC 原生成就 = 第三条解锁通道「历练」）──
  // 每 deathPollMs 读服务器 advancements/<uuid>.json → diff 新成就 → 编年史 + 公告 + 解锁。
  // 与等级（修为）/苦难被动（苦修）互补：成就 = 用事迹提前换技能/加成。
  interface AdvUnlock {
    skill?: string
    maxManaBonus?: number
    exp?: number
    reason?: string
  }
  let advUnlocks: Record<string, AdvUnlock> = {}
  const advUnlocksPath = resolve(config.advancementUnlocksPath)
  if (existsSync(advUnlocksPath)) {
    try {
      const raw = JSON.parse(readFileSync(advUnlocksPath, 'utf-8'))
      const map = raw?.unlocks ?? raw
      if (map && typeof map === 'object') {
        advUnlocks = map
        log(`loaded ${Object.keys(advUnlocks).length} advancement unlock(s) from ${advUnlocksPath}`)
      }
    } catch (err) {
      log(`failed to load advancement-unlocks: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  let advNames: Record<string, { name: string; desc?: string }> = {}
  const advNamesPath = resolve(config.advancementNamesPath)
  if (existsSync(advNamesPath)) {
    try {
      const raw = JSON.parse(readFileSync(advNamesPath, 'utf-8'))
      const map = raw?.names ?? raw
      if (map && typeof map === 'object') advNames = map
    } catch (err) {
      log(`failed to load advancement-names: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const advZh = (id: string): { name: string; desc?: string } => advNames[id] ?? { name: id.replace(/^minecraft:/, '') }

  /** 解锁检查：成就命中映射 → 授予法术/魔力上限/经验。announce=是否公告（基线回填静默）。 */
  async function checkAdvUnlocks(name: string, advId: string, announce: boolean): Promise<void> {
    const u = advUnlocks[advId]
    if (!u) return
    const zh = advZh(advId)
    const parts: string[] = []
    if (u.skill) {
      const atom = ctx.mcMagic.getAtomById(u.skill)
      if (atom) {
        ctx.mcMagic.learnViaAdvancement(name, u.skill)
        parts.push(`秘法「${atom.name}」`)
        worlddb.chronicleRecord('skill', name, { via: 'advancement', advancement: advId, atom: u.skill, name: atom.name, backfill: !announce })
        log(`ADVANCEMENT UNLOCK: ${name} 「${zh.name}」-> skill ${u.skill} (${announce ? 'live' : 'backfill'})`)
      }
    }
    if (u.maxManaBonus && u.maxManaBonus > 0) {
      const nm = ctx.mcMagic.addMaxManaBonus(name, u.maxManaBonus)
      parts.push(`魔力上限 +${u.maxManaBonus}（至 ${nm}）`)
    }
    if (u.exp && u.exp > 0) await grantXp(name, u.exp, `advancement:${advId}`)
    if (parts.length > 0 && announce) {
      try {
        await rcon.send(`tellraw @a ${JSON.stringify({ text: `[女神] 历练觉醒——「${zh.name}」之功德，赐予 ${name}：${parts.join('，')}。${u.reason ? '（' + u.reason + '）' : ''}`, color: 'gold', bold: true })}`)
        await rcon.send(`title ${name} title ${JSON.stringify({ text: '✦ 历练觉醒 ✦', color: 'gold', bold: true })}`)
        await rcon.send(`title ${name} subtitle ${JSON.stringify({ text: parts.join('，'), color: 'yellow' })}`)
        await rcon.send(`playsound minecraft:ui.toast.challenge_complete master @a`)
      } catch { /* 特效失败不影响解锁 */ }
    }
  }

  /** 成就轮询：读 <uuid>.json diff。首次基线 = 静默入库 + 静默解锁（存量成就立即生效不刷屏）。 */
  async function pollAdvancements(name: string): Promise<void> {
    const bot = getBot()
    const uuid = bot.players?.[name]?.uuid
    if (!uuid) return
    const file = resolve(config.advancementsDir, `${uuid}.json`)
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(readFileSync(file, 'utf-8'))
    } catch {
      return // 文件不存在/损坏 = 无成就，跳过
    }
    const doneIds = Object.keys(raw).filter(
      (k) => k.startsWith('minecraft:') && !k.startsWith('minecraft:recipes/') && (raw[k] as { done?: boolean })?.done === true,
    )
    if (doneIds.length === 0) return
    const seen = ctx.mcMagic.getAdvancements(name)
    if (seen.length === 0) {
      // 首次基线（新玩家 / 机制上线）：全部入库 + 静默解锁检查 + 一条汇总编年史
      let unlocked = 0
      for (const id of doneIds) {
        ctx.mcMagic.addAdvancement(name, id)
        await checkAdvUnlocks(name, id, false)
        unlocked++
      }
      worlddb.chronicleRecord('advancement', name, { backfill: true, count: doneIds.length, ids: doneIds })
      log(`advancement baseline: ${name} ${doneIds.length} done, ${unlocked} unlock-checks applied (silent)`)
      return
    }
    const seenSet = new Set(seen)
    for (const id of doneIds) {
      if (seenSet.has(id)) continue
      const fresh = ctx.mcMagic.addAdvancement(name, id)
      if (!fresh) continue
      const zh = advZh(id)
      log(`ADVANCEMENT: ${name} earned ${id} (${zh.name})`)
      worlddb.chronicleRecord('advancement', name, { id, name: zh.name, desc: zh.desc ?? undefined })
      try {
        await rcon.send(`tellraw @a ${JSON.stringify({ text: `🏆 ${name} 达成成就「${zh.name}」${zh.desc ? '——' + zh.desc : ''}`, color: 'yellow' })}`)
        await rcon.send(`title ${name} title ${JSON.stringify({ text: `🏆 ${zh.name}`, color: 'yellow', bold: true })}`)
        await rcon.send(`playsound minecraft:ui.toast.challenge_complete master @a`)
      } catch { /* 公告失败不影响登记 */ }
      await checkAdvUnlocks(name, id, true)
    }
  }


  function metricValue(username: string, metric: string): number | null {
    const st = ctx.mcMagic.getState(username)
    if (metric === 'hpRatio') return st.hpRatio
    if (metric === 'foodRatio') return st.foodRatio
    return null
  }
  function condHit(v: number, op: string, t: number): boolean {
    if (op === '<=') return v <= t
    if (op === '<') return v < t
    if (op === '>=') return v >= t
    if (op === '>') return v > t
    return false
  }

  /**
   * 被动效果引擎（2026-08-17 扛枪定调：血线触发攻击/防御）。
   * 已解锁且 when 条件成立 → 女神 RCON 给效果（durationSec 略长于轮询间隔 = 无缝续杯）；
   * 条件退出 → 不再施加，自然过期。状态跃迁（off→on）配一声提示音 + 小字 + 编年史。
   */
  const passiveActive = new Map<string, boolean>()
  async function applyPassiveEffects(name: string): Promise<void> {
    for (const def of enabledPassives) {
      const eff = def.effect
      if (!eff || eff.kind !== 'mc_effect' || !eff.mcId) continue
      if (!ctx.mcMagic.hasPassive(name, def.id)) continue
      const key = `${name}|${def.id}`
      const when = eff.when ?? def.trigger
      const v = metricValue(name, when.metric)
      const hit = v !== null && condHit(v, when.op, when.threshold)
      const prev = passiveActive.get(key) ?? false
      if (hit) {
        const dur = Math.max(5, Math.floor(eff.durationSec ?? 25))
        const amp = Math.max(0, Math.floor(eff.amplifier ?? 0))
        try {
          // hideParticles=true：粒子每 tick 刷太吵，激活提示用声音+小字表达
          await rcon.send(`effect give ${name} ${eff.mcId} ${dur} ${amp} true`)
        } catch (err) {
          log(`passive effect ${def.id} on ${name} failed: ${err instanceof Error ? err.message : String(err)}`)
          continue
        }
      }
      if (hit !== prev) {
        passiveActive.set(key, hit)
        if (hit) {
          try {
            if (eff.sound) await rcon.send(`playsound ${eff.sound} master ${name}`)
            await rcon.send(`title ${name} actionbar ${JSON.stringify({ text: `✦ ${def.name} 发动 ✦`, color: 'red', bold: true })}`)
          } catch { /* 提示失败不影响效果 */ }
        }
        worlddb.chronicleRecord('passive_effect', name, { passive: def.id, name: def.name, state: hit ? 'on' : 'off' })
        log(`passive effect ${def.id} ${hit ? 'ON' : 'OFF'} for ${name} (when ${when.metric} ${when.op} ${when.threshold}, v=${v})`)
      }
    }
  }

  /**
   * 授修为（施法外的来源：供奉/被动觉醒）。路线 A：直接注入原生经验条（xp add points）。
   * 升级检测与公告由死亡守望 tick 的 ΔXpLevel 统一做（来源无关，挖矿升级同样触发）。
   */
  async function grantXp(username: string, amount: number, reason: string): Promise<void> {
    try {
      await rcon.send(`xp add ${username} ${amount} points`)
      worlddb.chronicleRecord('xp', username, { amount, via: reason })
    } catch (err) {
      log(`grantXp(${username}) failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 等级同步 + 升级公告 + 旧数据迁移（死亡守望 tick 每 20s 调一次）。
   * 路线 A：原生 XpLevel 是唯一真源；Δ>0 → 升级仪式（title/图腾/音效/新秘法宣读/编年史）。
   * 迁移：老玩家自建 level 高于原生（从没用过原生经验）时，xp set 一次性灌入，进度不丢。
   */
  const lastSeenLevel = new Map<string, number>()
  async function syncLevel(name: string): Promise<void> {
    const xp = await rcon.getEntityNumber(name, 'XpLevel')
    if (xp === null) return
    const st = ctx.mcMagic.getState(name)
    // 一次性迁移：自建时代等级高于原生 → 灌入原生经验条
    if (st.level > xp) {
      try {
        await rcon.send(`xp set ${name} ${st.level} levels`)
        worlddb.chronicleRecord('migration', name, { from: 'builtin-level', to: 'native-xp', level: st.level })
        log(`migrated ${name}: native XpLevel ${xp} -> ${st.level} (from builtin state)`)
      } catch (err) {
        log(`migration(${name}) failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      ctx.mcMagic.setLevel(name, st.level)
      return
    }
    ctx.mcMagic.setLevel(name, xp)
    const prev = lastSeenLevel.get(name)
    lastSeenLevel.set(name, xp)
    if (prev !== undefined && xp > prev) {
      const view = ctx.mcMagic.getState(name)
      const unlocked = ctx.mcMagic.listAtoms()
        .filter((a) => a.requiredLevel > prev && a.requiredLevel <= xp)
        .map((a) => a.name)
      try {
        await rcon.send(`title ${name} title ${JSON.stringify({ text: '✦ 层级提升 ✦', color: 'gold', bold: true })}`)
        await rcon.send(`title ${name} subtitle ${JSON.stringify({ text: `魔力层级 ${prev} → ${xp}`, color: 'yellow' })}`)
        await rcon.send(`execute at ${name} run particle minecraft:totem_of_undying ~ ~1 ~ 0.5 0.8 0.5 0.1 120`)
        await rcon.send(`execute at ${name} run playsound minecraft:entity.player.levelup master @a`)
        await rcon.send(`tellraw @a ${JSON.stringify({ text: `[女神] ${name} 的修行有了回报：魔力层级 ${prev} → ${xp}，魔力上限 ${view.maxMana}。`, color: 'gold' })}`)
      } catch { /* 特效失败不影响升级 */ }
      worlddb.chronicleRecord('levelup', name, { from: prev, to: xp, maxMana: view.maxMana })
      log(`LEVEL UP ${name}: ${prev} -> ${xp} (native XpLevel, maxMana ${view.maxMana})`)
      if (unlocked.length > 0) {
        try {
          await rcon.send(`tellraw ${name} ${JSON.stringify({ text: `[女神] 你已可驾驭新秘法：${unlocked.join('、')}。`, color: 'yellow' })}`)
        } catch { /* 提示失败无碍 */ }
      }
    }
  }

  function scheduleDeathPoll() {
    if (disposed) return
    stopDeathPoll = ctx.setTimeout(async () => {
      try {
        const bot = getBot()
        if (bot.entity && bot.username) {
          if (!deathObjReady) {
            // 目标已存在时服务端返回错误文本，不视为失败
            await rcon.send(`scoreboard objectives add ${DEATH_OBJ} deathCount`)
            deathObjReady = true
          }
          const names = Object.keys(bot.players).filter((n) => n !== bot.username)
          if (!deathPollArmedLogged) {
            log(`death poll armed: watching ${names.length} player(s): ${names.join(', ') || '(none)'}`)
            deathPollArmedLogged = true
          }
          for (const name of names) {
            const out = await rcon.send(`scoreboard players get ${name} ${DEATH_OBJ}`)
            // 兜底路径（快路径见上方 log-tail 订阅）：慢一步但能追平 log 丢行/世界进程重启间隙
            const cur = parseDeathScore(out)
            const prev = deathScores.get(name)
            if (prev !== undefined && cur > prev) {
              recordDeath(name, prev, cur)
            }
            deathScores.set(name, cur)

            // 路线 A：原生等级同步 + Δ升级公告 + 旧数据迁移
            await syncLevel(name)

            // 成就监听：advancements/<uuid>.json diff → 编年史/公告/解锁（第三条通道「历练」）
            await pollAdvancements(name)

            // 生命体征 tick：采 HP/饱食 → hpRatio/foodRatio 缓存 → 被动条件累积 → 达标宣诏
            if (enabledPassives.length > 0) {
              const hp = await rcon.getEntityNumber(name, 'Health')
              const hpRatio = hp === null ? null : Math.max(0, Math.min(1, hp / 20))
              const food = await rcon.getEntityNumber(name, 'foodLevel')
              const foodRatio = food === null ? undefined : Math.max(0, Math.min(1, food / 20))
              ctx.mcMagic.setVitals(name, hpRatio, foodRatio)
              for (const def of enabledPassives) {
                if (ctx.mcMagic.hasPassive(name, def.id)) continue
                const v = metricValue(name, def.trigger.metric)
                if (v !== null && condHit(v, def.trigger.op, def.trigger.threshold)) {
                  const acc = ctx.mcMagic.addPassiveProgress(name, def.id, config.deathPollMs / 1000)
                  if (acc >= def.trigger.accumulateSec) {
                    const fresh = ctx.mcMagic.unlockPassive(name, def.id)
                    if (fresh) {
                      log(`PASSIVE UNLOCKED: ${name} gained 「${def.name}」(${def.id}) after ${Math.round(acc)}s`)
                      worlddb.chronicleRecord('skill', name, { passive: def.id, name: def.name, accumulatedSec: Math.round(acc) })
                      const vfx = `tellraw @a ${JSON.stringify({ text: `[女神] ${def.announce}`, color: 'light_purple', bold: true })}`
                      const title = `title ${name} title ${JSON.stringify({ text: `✦ ${def.name} ✦`, color: 'light_purple', bold: true })}`
                      const sound = `playsound minecraft:entity.player.levelup master ${name}`
                      try { await rcon.send(vfx); await rcon.send(title); await rcon.send(sound) } catch { /* 特效失败不影响解锁 */ }
                      if (def.expReward && def.expReward > 0) await grantXp(name, def.expReward, `passive:${def.id}`)
                    }
                  }
                }
              }
              // 效果引擎：已解锁被动在 when 条件成立期间持续给药水效果（血怒→力量/铁壁→抗性）
              await applyPassiveEffects(name)
            }
          }
        }
      } catch (err) { log(`death poll failed: ${err instanceof Error ? err.message : String(err)}`) } // 守望轮询异常必须可见
      scheduleDeathPoll()
    }, config.deathPollMs)
  }
  scheduleDeathPoll()

  // ── 守望者 + 史官：世界观察周期（需求文档一期一期攒）────────────────
  let lastReviewAt = worlddb.reviewLastAt() || Date.now()
  let reviewBusy = false
  let stopReview: (() => void) | null = null
  async function runReview(): Promise<void> {
    if (reviewBusy) return
    reviewBusy = true
    try {
      const entries = worlddb.chronicleSince(lastReviewAt)
      if (entries.length === 0) return
      // 统计
      const byType = new Map<string, number>()
      const deaths = new Map<string, number>()
      const offerings = new Map<string, number>()
      let castN = 0
      let noneN = 0
      for (const e of entries) {
        byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
        if (e.type === 'death') deaths.set(e.actor, (deaths.get(e.actor) ?? 0) + 1)
        if (e.type === 'offering') {
          const cn = String(e.detail.cn ?? '')
          offerings.set(cn, (offerings.get(cn) ?? 0) + Number(e.detail.count ?? 0))
        }
        if (e.type === 'verdict') {
          if (e.detail.action === 'cast') castN++
          else if (e.detail.action === 'none') noneN++
        }
      }
      const deathsText = deaths.size ? Array.from(deaths.entries()).map(([n, c]) => `${n}×${c}`).join('、') : '0'
      const offeringText = offerings.size ? Array.from(offerings.entries()).map(([n, c]) => `${n}×${c}`).join('、') : '无'
      const statsText = `记录 ${entries.length} 条；死亡 ${deathsText}；祈愿 ${byType.get('prayer') ?? 0} 封（应允 ${castN} / 拒绝 ${noneN}）；供奉 ${byType.get('offering') ?? 0} 次（${offeringText}）；咏唱 ${byType.get('cast') ?? 0} 次；神迹代施 ${byType.get('godcast') ?? 0} 次；升级 ${byType.get('levelup') ?? 0} 次`
      const sampleLines = entries.slice(-20).map((e) => {
        const ts = new Date(e.at)
        const hhmm = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
        return `- [${hhmm}] ${CHRONICLE_TYPE_CN[e.type] ?? e.type}｜${e.actor}`
      }).join('\n')

      const out = await callAgent('mc:world-review', 'world', reviewPrompt(statsText, sampleLines))
      const iso = new Date().toISOString().replace('T', ' ').slice(0, 16)
      const issue = worlddb.reviewNextSeq()
      const reqPath = resolve(config.requirementsPath)
      const dir = dirname(reqPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      if (!existsSync(reqPath)) {
        writeFileSync(reqPath, '# 初始之地 · 世界迭代需求文档\n\n> 守望女神定期观察世界运行，写给世界缔造者的迭代需求。\n\n', 'utf-8')
      }
      appendFileSync(reqPath, `## ${iso} 女神观察 · 第 ${issue} 期（覆盖 ${entries.length} 条记录）\n\n**统计**：${statsText}\n\n${out.trim()}\n\n---\n\n`, 'utf-8')
      worlddb.reviewSave(issue, entries.length, statsText, out.trim())
      worlddb.chronicleRecord('world-review', 'Goddess', { entries: entries.length, issue })
      lastReviewAt = Date.now()
      log(`world review #${issue} written (${entries.length} entries) -> ${reqPath}`)
    } catch (err) {
      log(`world review failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      reviewBusy = false
    }
  }
  function scheduleReview() {
    if (disposed) return
    stopReview = ctx.setTimeout(() => {
      runReview().finally(() => scheduleReview())
    }, config.reviewMs)
  }
  scheduleReview()

  // ── 女神化身管理 + 私聊监听（bot 重连会换实例，定期确保）────────────
  let watchedBot: Bot | null = null
  let avatarSet = false

  // ── 服主法则（gamerule 白名单，程序化代行，零 LLM）─────────────────
  // 女神 = 服主：世界法则的修订权归女神，真人/穿越者只能「求法」，
  // 白名单内的法则即时生效并记入编年史（type='law'）。匹配逻辑在模块级 matchLaw。
  async function applyLaw(actor: string, law: LawRequest): Promise<void> {
    const bot = getBot()
    const reply = (text: string) => {
      try { bot?.whisper(actor, `[女神] ${text}`) } catch { /* bot not ready */ }
    }
    if (!law.rule) {
      reply(`「${law.via.slice(8)}」不在女神权柄之内。可修订的法则：${Object.keys(LAW_WHITELIST).join('、')}（写法：法则 <法则名> true/false）。`)
      return
    }
    try {
      const beforeOut = await rcon.send(`gamerule ${law.rule}`)
      await rcon.send(`gamerule ${law.rule} ${law.value}`)
      const afterOut = await rcon.send(`gamerule ${law.rule}`)
      const from = beforeOut.includes('true')
      const to = afterOut.includes('true')
      worlddb.chronicleRecord('law', actor, { rule: law.rule, from, to, via: law.via })
      const cn = LAW_WHITELIST[law.rule]
      await rcon.send(`tellraw @a ${JSON.stringify({ text: `[女神] 世界法则已修订——「${cn}」：${from ? '是' : '否'} → ${to ? '是' : '否'}（求法者：${actor}）。`, color: 'aqua' })}`)
      await rcon.send(`playsound minecraft:block.enchantment_table.use master @a`)
      log(`law changed: ${law.rule} ${from}->${to} by ${actor} (${law.via})`)
    } catch (err) {
      reply(`法则修订失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 天平引擎（服主职权：动态平衡技能，程序化代行，零 LLM）──────────
  // 仅维护者名单可用；补丁层热生效并持久化（data/balance-overrides.json）。
  // 公告策略（2026-08-17 扛枪拍板：版本更新式攒批）——调整即时生效+私密回执，
  // 公屏公告攒一波统一发，队列落盘 bulletinPath，重启不丢未发公告。
  const bulletinFile = resolve(config.bulletinPath)
  const BATCH_CAP = 10
  let stopBulletin: (() => void) | null = null

  function loadBulletin(): BulletinNote[] {
    try {
      if (!existsSync(bulletinFile)) return []
      const raw: unknown = JSON.parse(readFileSync(bulletinFile, 'utf-8'))
      if (Array.isArray(raw)) return raw as BulletinNote[]
      return ((raw as { notes?: BulletinNote[] }).notes ?? [])
    } catch { return [] }
  }
  function saveBulletin(notes: BulletinNote[]): void {
    try {
      mkdirSync(dirname(bulletinFile), { recursive: true })
      writeFileSync(bulletinFile, JSON.stringify({ notes }, null, 2), 'utf-8')
    } catch (err) { log(`bulletin save failed: ${err instanceof Error ? err.message : String(err)}`) }
  }
  async function flushBulletin(): Promise<void> {
    const notes = loadBulletin()
    if (!notes.length) return
    saveBulletin([])
    try {
      await rcon.send(`tellraw @a ${JSON.stringify({ text: `[女神] 天平昭告——${formatBulletin(notes)}`, color: 'aqua' })}`)
      await rcon.send('playsound minecraft:block.anvil.use master @a')
      log(`bulletin flushed: ${notes.length} note(s)`)
    } catch (err) {
      saveBulletin(notes) // 公告失败退回队列，下轮窗口重试
      log(`bulletin flush failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  function scheduleBulletin() {
    stopBulletin = ctx.setTimeout(async () => {
      try { await flushBulletin() } catch { /* 单轮失败不影响下轮 */ }
      scheduleBulletin()
    }, config.balanceFlushMs)
  }
  scheduleBulletin()
  function enqueueBulletin(note: Omit<BulletinNote, 'at'>): void {
    const notes = [...loadBulletin(), { ...note, at: Date.now() }]
    saveBulletin(notes)
    if (notes.length >= BATCH_CAP) flushBulletin().catch(() => { /* 已回存队列，静默 */ })
  }

  async function applyBalance(actor: string, req: BalanceRequest): Promise<void> {
    const bot = getBot()
    const reply = (text: string) => {
      try { bot?.whisper(actor, `[女神] ${text}`) } catch { /* bot not ready */ }
    }
    if (!config.maintainers.includes(actor)) {
      reply('天机不可轻授——技能之平衡乃女神职权。汝若觉法度有失，可祈愿陈情，女神自会斟酌。')
      return
    }
    try {
      if (req.kind === 'show') {
        const patches = ctx.mcMagic.listBalance()
        if (!patches.length) reply('天平未曾偏移（尚无任何平衡补丁）。写法：平衡 <法术> <魔力|饱食|生命|等级> <数值>；平衡 回蓝 <数值>；重置平衡 [法术]。')
        else {
          const lines = patches.map((p) => {
            const who = p.atom === '*' ? '全局' : (ctx.mcMagic.getAtomById(p.atom)?.name ?? p.atom)
            return `· ${who} ${balanceFieldLabel(p.field)} = ${p.value}（${p.by}${p.reason ? '：' + p.reason : ''}）`
          })
          reply(`当前天平（${patches.length} 道补丁）：\n${lines.join('\n')}`)
        }
        return
      }
      if (req.kind === 'reset') {
        const n = ctx.mcMagic.resetBalance(req.atom)
        if (n > 0) {
          worlddb.chronicleRecord('balance', actor, { reset: true, atom: req.atom ?? null, removed: n })
          const text = `天平复位——${req.atom ? `「${req.atom}」` : '全部法术'}回归基准法则（撤 ${n} 道）`
          enqueueBulletin({ text, by: actor })
          reply(`已复位：${text}。将随天平公告一并昭告（攒批发送，防刷屏）。`)
          log(`balance reset: ${req.atom ?? 'ALL'} (${n} removed) by ${actor}`)
        } else {
          reply('该法术名下没有补丁可撤销。')
        }
        return
      }
      const res = ctx.mcMagic.applyBalancePatch(req.atom ?? null, req.field!, req.value!, actor)
      if (!res.ok || !res.summary) {
        reply(`平衡未成：${res.ok ? '内部错误：无摘要' : res.error}`)
        return
      }
      const summary: string = res.summary
      worlddb.chronicleRecord('balance', actor, { atom: req.atom ?? '*', field: req.field, value: req.value, summary })
      enqueueBulletin({ text: summary, by: actor })
      reply(`已生效：${summary}。将随天平公告一并昭告（攒批发送，防刷屏）。`)
      log(`balance: ${summary} by ${actor}`)
    } catch (err) {
      reply(`天平失灵：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function ensureAvatar(bot: Bot) {
    if (watchedBot === bot) return
    watchedBot = bot
    avatarSet = false

    // 史官：玩家行迹（谁踏入此界、谁离去——穿越者与真人一律记录）
    // mineflayer 4.x 的 playerJoined/playerLeft 回调给 Player 对象（旧版给 string），两种都兼容。
    bot.on('playerJoined', (player) => {
      const username = typeof player === 'string' ? player : player.username
      if (username === bot.username) return
      worlddb.chronicleRecord('presence', username, { event: 'join' })
    })
    bot.on('playerLeft', (player) => {
      const username = typeof player === 'string' ? player : player.username
      if (username === bot.username) return
      worlddb.chronicleRecord('presence', username, { event: 'leave' })
    })

    // 公屏法则请求（服主权限）：自然语言短语（如「死亡不失行囊」）也认，
    // 让真人玩家像对服主喊话一样对女神说话。天平（平衡）命令同通道。
    bot.on('chat', (username: string, message: string) => {
      if (username === bot.username) return
      const bal = matchBalance(message.trim())
      if (bal) {
        applyBalance(username, bal).catch((err) => log(`applyBalance(chat) failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
        return
      }
      const law = matchLaw(message.trim())
      if (law) {
        applyLaw(username, law).catch((err) => log(`applyLaw(chat) failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
      }
    })

    // 私聊祈愿：任何玩家 /msg Goddess <愿望>[｜供奉：面包x3] → 收执供奉 → 入收件箱。
    bot.on('whisper', (username: string, message: string) => {
      if (username === bot.username) return
      // 天平通道（服主职权，2026-08-17）：「平衡 <法术> <字段> <数值>」等，
      // 白名单+护栏校验，程序化代行，不进祈愿队列。命中即返回。
      const bal = matchBalance(message.trim())
      if (bal) {
        applyBalance(username, bal).catch((err) => log(`applyBalance failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
        return
      }
      // 法则通道（服主权限，2026-08-17）：「法则 <rule> <true|false>」或自然语言，
      // 白名单内程序化代行，不进祈愿队列。命中即返回。
      const law = matchLaw(message.trim())
      if (law) {
        applyLaw(username, law).catch((err) => log(`applyLaw failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
        return
      }
      const { wish, offeringText } = splitWishOffering(message.trim())
      if (!wish) return

      // 入场节流：同一玩家 admitCooldownMs 内不重复收信
      const now = Date.now()
      const lastAt = lastPray.get(username) ?? 0
      if (now - lastAt < config.admitCooldownMs) {
        const wait = Math.ceil((config.admitCooldownMs - (now - lastAt)) / 1000)
        try {
          bot.whisper(username, `[女神] 汝之祈愿声犹在耳畔（${wait} 秒前才诉说过），稍候再试。`)
        } catch { /* bot not ready */ }
        return
      }

      // 供奉收执（异步）：名目 → 行囊复核 → /clear 收走 → 记账 → 再入队。
      const t: Transmigrator | null = ctx.mcTransmigrators.getByUsername(username)
      const admit = async (): Promise<void> => {
        let offer: OfferingInfo | undefined
        if (offeringText) {
          const resolved = resolveOfferingText(offeringText)
          if (!resolved) {
            try {
              bot.whisper(username, `[女神] 你想供奉「${offeringText}」，但天神不识此物。可用：面包/熟牛肉/煤/铁锭/金锭/钻石/绿宝石/附魔书…（写法如「面包x3」）。`)
            } catch { /* bot not ready */ }
            return
          }
          offer = { id: resolved.id, cn: resolved.cn, count: resolved.count }
          const taken = await takeOffering(username, offer)
          if (!taken.ok) {
            try {
              bot.whisper(username, `[女神] ${taken.reason}`)
            } catch { /* bot not ready */ }
            return
          }
          // 虔诚有回报：供奉被收执 +15 exp（2026-08-17 成长体系）
          await grantXp(username, 15, 'offering')
        }
        lastPray.set(username, Date.now())
        const { ahead } = worlddb.inboxPush(username, t?.name ?? username, wish, offer ?? undefined)
        worlddb.chronicleRecord('prayer', username, { wish, offering: offer ?? undefined })
        log(`wish received from ${username}: ${wish}${offer ? ` +offering ${offer.cn}x${offer.count}` : ''} (ahead: ${ahead})`)
        try {
          bot.whisper(username, `[女神] ${t?.name ?? username}，祈愿已上达天听${offer ? `（供奉 ${offer.cn}×${offer.count} 已归神库）` : ''}${ahead > 0 ? `，队列中还有 ${ahead} 位信士` : ''}。女神将按序聆听，神谕随后送达——在此期间照常行事，勿要枯等。`)
        } catch { /* bot not ready */ }
      }
      admit().catch((err) => log(`admit prayer failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
    })
  }

  let stopEnsure: (() => void) | null = null
  function scheduleEnsure() {
    if (disposed) return
    stopEnsure = ctx.setTimeout(() => {
      const bot = getBot()
      if (bot) {
        ensureAvatar(bot)
        // 女神化身就位后切旁观者模式（对玩家隐身、不可交互、不会挨饿挨打）。
        if (bot.entity && bot.username && !avatarSet) {
          avatarSet = true
          rcon
            .send(`gamemode spectator ${bot.username}`)
            .then(() => log(`avatar "${bot.username}" is now a spectator`))
            .catch((err) => {
              avatarSet = false
              log(`gamemode spectator failed: ${err instanceof Error ? err.message : String(err)}`)
            })
        }
      }
      scheduleEnsure()
    }, 5000)
  }
  scheduleEnsure()

  ctx.effect(() => () => {
    disposed = true
    if (offLogwatch) offLogwatch()
    if (stopPoll) stopPoll()
    if (stopDeathPoll) stopDeathPoll()
    if (stopReview) stopReview()
    if (stopEnsure) stopEnsure()
    if (stopBulletin) stopBulletin()
    log('god disposed')
  })

  if (config.enabled) {
    log(`goddess armed (三职：裁量/守望/史官, 持久层=mc-worlddb): poll ${config.pollMs}ms, admit ${config.admitCooldownMs}ms, cast-cooldown ${config.cooldownMs}ms; death-poll ${config.deathPollMs}ms; review every ${Math.round(config.reviewMs / 60000)}min; 众生册 recall top-${config.recallTopK}; 天平公告窗口 ${Math.round(config.balanceFlushMs / 1000)}s; 被动引擎 ${enabledPassives.length} 项 + 服主法则 ${Object.keys(LAW_WHITELIST).length} 项`)
  }

  // 暴露给其他插件的接口
  ctx.provide('mcGod', {
    pray: (username: string, wish: string) => {
      const t: Transmigrator | null = ctx.mcTransmigrators.getByUsername(username)
      worlddb.inboxPush(username, t?.name ?? username, wish)
    },
    pendingCount: () => worlddb.inboxPendingCount(),
    record: (type: string, actor: string, detail: Record<string, unknown>) => worlddb.chronicleRecord(type, actor, detail),
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcGod: {
      /** 直接触发一次祈愿处理（测试用） */
      pray(username: string, wish: string): void
      /** 当前收件箱待处理数 */
      pendingCount(): number
      /** 世界史官：记一条大事记（mc-magic 等插件上报用） */
      record(type: string, actor: string, detail: Record<string, unknown>): void
    }
  }
}
