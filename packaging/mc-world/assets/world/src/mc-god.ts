import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Bot } from 'mineflayer'
import type { RconService } from './mc-rcon.ts'
import type { AtomSummary, MagicService } from './mc-magic.ts'
import { GIVE_WHITELIST, BALANCE_FIELD_ALIASES, balanceFieldLabel } from './mc-magic.ts'
import type { Transmigrator, TransmigratorRegistry } from './mc-transmigrator.ts'
import { OFFERING_ITEM_CN, parseInventoryCounts, resolveOfferingText, type OfferingInfo } from './mc-offering.ts'
import { CHRONICLE_TYPE_CN } from './mc-worlddb.ts'
import type { InboxRow, MemoryHit, WorlddbService } from './mc-worlddb.ts'
import type { LogwatchService } from './mc-logwatch.ts'
import type { McTerraService } from './mc-terra.ts'
import { parseVoice } from './mc-social.ts'
import { isHelpCommand, handleHelpText, welcomeLines } from './mc-man.ts'
import { createLifecycle } from './lifecycle.ts'

// 运行态数据目录：迁正仓（2026-08-20 D 步）后世界进程 cwd=正仓，运行态正本在
// scratch-plugin\data，经 MC_DATA_DIR 传入。村民交易/祈福文件队列须锚到运行态，
// 与 mc_npc.py 的 DATA（scratch-plugin\data）一致——旧 './data' 相对 cwd 在迁仓后会落错卷。
const DATA_DIR = process.env.MC_DATA_DIR || './data'
const NPC_INBOX = process.env.NPC_INBOX || `${DATA_DIR}/npc-inbox.jsonl`

// 村民祈福通道（2026-08-20 造物主谕「一步到位」）：村民（灶火民）祈愿由 mc_npc.py
// 投 god-inbox.jsonl，女神裁断后神谕回 god-reply.jsonl（村民非玩家，不走 whisper）。
// 路径与 npc-inbox 同卷（scratch-plugin\data）。
const GOD_INBOX = process.env.GOD_INBOX || `${DATA_DIR}/god-inbox.jsonl`
const GOD_REPLY = process.env.GOD_REPLY || `${DATA_DIR}/god-reply.jsonl`
/** 村民祈愿用的虚拟 username 前缀（区别于真人/AI 穿越者；神谕据此回文件而非私聊）。 */
const VILLAGER_PREFIX = 'villager:'

// 假玩家咏唱/神谕通道（2026-08-23 造物主谕「假玩家与客户端 AI 玩家一致」）：
// 守卫桥（sidecar/guard/guard_drive.py）投 chant-requests.jsonl（亲卫 chant 工具，等价私语念咒）
// → 本进程与"私语念咒"同逻辑 castSpell（已学自施/未学呈神）→ 回执写 chant-reply.jsonl
// → 守卫桥每轮读并注入亲卫决策。女神主动守望（watchGuards）写 goddess-orders.jsonl，守卫桥同读。
const CHANT_REQ = process.env.CHANT_REQ || `${DATA_DIR}/chant-requests.jsonl`
const CHANT_REPLY = process.env.CHANT_REPLY || `${DATA_DIR}/chant-reply.jsonl`
const GODDESS_ORDERS = process.env.GODDESS_ORDERS || `${DATA_DIR}/goddess-orders.jsonl`
/** 守卫假玩家名单（神谕须双写 chant-reply 供守卫桥读；mc_npc 的 god_reply_loop 读后即删 god-reply.jsonl）。 */
const GUARD_NAMES = ['桐人', '鸣人', '爱德华']
/** 守卫桥账本目录（B 仓 data/；跨仓路径经 env 注入，默认空=不读账本，仅靠 magic-state 判定）。 */
const GUARD_LEDGER_DIR = process.env.GUARD_LEDGER_DIR || ''

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
  /** 特殊监听白名单（VIP 真人旅人）：不在言必称「祈愿」约束内——
   *  他们说的一切——闲聊、求助、牢骚——女神都必须聆听并回应（绕过冷启动/
   *  冷却节流），并可按处境主动调派守护者或动用服务器权限施以援手。
   *  逗号分隔注入（MC_VIP_LISTEN），默认空表。 */
  vipListen: string[]
  /** 天平公告攒批窗口：调整即时生效但公告攒一波一起发（版本更新式，防公屏刷屏）。 */
  balanceFlushMs: number
  /** 攒批队列落盘文件（重启不丢未发公告）。 */
  bulletinPath: string
  /** 世界心跳落盘文件：外部看门狗 + 观察面板据此探活世界进程。 */
  heartbeatPath: string
}

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
  /** 2026-08-23 神迹记账：女神裁量耗 tokens（callAgent 无 usage，字符折算估算）。 */
  tokens?: number
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
  isVillager = false,
  vip = false,
): string {
  const lines = [
    `【祈愿】${senderName}：${wish}`,
  ]
  if (isVillager) {
    lines.push('【祈愿者】这是一位灶火民（村民），向女神祈福。他与穿越者平权同杆秤。')
  } else if (vip) {
    lines.push('【祈愿者】这是一位受女神守护的 VIP 真人旅人（特殊监听白名单）。')
  }
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
  if (isVillager) {
    lines.push('- 灶火民与穿越者同杆秤：虔诚看处境（越困苦越虔诚）与祈愿里自陈的供奉，不因他是 NPC 就轻视，也不因他是 NPC 就滥施；')
    lines.push('- 神恩有价：村民须舍贡（祈愿里自陈的麦/鱼/炭等即其供奉），神多指引、少代劳——对村民优先给指引（告诉他怎么自渡），不要代施神迹（他不能咏唱，代施意义也异于穿越者）；天象级恩典（破晓/驱云等全村同享）可酌情；')
    lines.push('- 口吻仍是有神性的神谕，话少而重。')
  } else {
    lines.push('- 求的技艺他未习得（程序已过滤已习得的）→ 你裁量：值得帮 → cast 代施；滥用/无礼/贪心/理由不足 → none 拒绝或提条件；')
    lines.push('- 供奉与虔诚是你的裁量依据：危难中慷慨、贵重之物（钻石/绿宝石/金锭/附魔书/末影珍珠）更显诚心，可优先垂怜；口粮级小供奉配小心愿即可；空手求大术，可以拒绝或在 reply 里向他索要供奉——让世人明白神恩有价；')
    lines.push('- 造物只从白名单选 item，数量克制（1-16）；')
    lines.push('- 破晓/驱云是全服天象，影响众生，慎用；天雷/陨石等毁灭技艺除非理由充分不施；')
    lines.push('- 纯闲聊、试探、问问题 → none，reply 里以神谕口吻回应；')
    lines.push('- reply 话少而重，有神性。')
    if (vip) {
      lines.push('')
      lines.push('【VIP 守护特例】此人在特殊监听白名单内，她/他说的一切你都当聆听回应，不必拘于「祈愿」名分：')
      lines.push('- 纯闲聊/牢骚也以女神口吻宽和回应一句，莫冷落她/他；')
      lines.push('- 若她/他处境艰难（重伤/濒死/被困/迷失/身无长物），可主动代施辅助法术（如圣愈、归乡、照明）或赐予白名单内物资，或在 reply 里给明晰指引；')
      lines.push('- 代施/赐物仍守白名单与数量克制；天象级恩典（破晓/驱云）仍慎用，全服同享不可私赏。')
    }
  }
  return lines.join('\n')
}

function reviewPrompt(statsText: string, sampleLines: string): string {
  return [
    '你是「千灯纪」世界的守护女神，也是世界的守望者与史官。',
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

export interface GodService {
  /** 直接触发一次祈愿处理（测试用）。 */
  pray(username: string, wish: string): void
  /** 当前收件箱待处理数。 */
  pendingCount(): number
  /** 世界史官：记一条大事记（mc-magic 等插件上报用）。 */
  record(type: string, actor: string, detail: Record<string, unknown>): void
}

export interface GodDeps {
  getBot: () => Bot
  rcon: RconService
  magic: MagicService
  worlddb: WorlddbService
  transmigrators: TransmigratorRegistry
  logwatch?: LogwatchService
  terra?: McTerraService
}

export interface GodHandle {
  service: GodService
  dispose: () => void
}

/** 已脱 cordis 壳（2026-08-21）：bootstrap-world.mts 显式 createGod(config, deps) 装配。 */
export function createGod(config: Config, deps: GodDeps): GodHandle {
  const log = (msg: string) => console.log(`[mc-god] ${msg}`)
  const lc = createLifecycle()
  // 女神化身实例随重连变化，须每次现取。
  const getBot = deps.getBot
  const rcon = deps.rcon
  const magic = deps.magic
  const transmigrators = deps.transmigrators
  const logwatch = deps.logwatch
  const terra = deps.terra
  const lastUsed = new Map<string, number>() // 每技艺全局冷却
  const lastPray = new Map<string, number>() // 每玩家入场节流
  const worlddb = deps.worlddb

  // 信使送达（2026-08-17 扛枪定调）：个人事务（觉醒/成就/升级/被动等成长通告）
  // 由信使私聊递达，不再公屏 tellraw @a——公屏只留世界级大事，人多了也不乱。
  const courier = (player: string, text: string) => {
    try { getBot().whisper(player, `[信使] ${text}`) } catch { /* bot not ready */ }
  }

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
  /**
   * 取某穿越者最新第一人称截图（排除四面 -front/-back/-right/-left），转 data URI。
   * 视觉链路（2026-08-21 打通）：调用 QwenPaw agent 时直接带图，VL 模型（传令官/魂/眷属）
   * 直接看图；data URI 跨机、跨模型最稳，不依赖文件系统或 URL 可达。
   */
  async function latestShotDataUri(username: string): Promise<string | null> {
    try {
      const dir = resolve(DATA_DIR, 'screenshots', username)
      if (!existsSync(dir)) return null
      const { readdir, readFile } = await import('node:fs/promises')
      const files = (await readdir(dir))
        .filter((f) => f.endsWith('.jpg') && !/-(front|back|right|left)\.jpg$/.test(f))
        .sort() // 文件名带 ISO 时间戳，字典序即时间序
      if (!files.length) return null
      const buf = await readFile(resolve(dir, files[files.length - 1]))
      return `data:image/jpeg;base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }

  /** 底层通道：console chat + SSE 解析，返回最后一条正式回答全文 + 本轮真实 tokens（2026-08-23 加）。 */
  async function callAgent(sessionId: string, userId: string, prompt: string, agentId = 'mc-god', images?: string[]): Promise<{ text: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
    const content: { type: string; text?: string; image_url?: string }[] = []
    if (images?.length) {
      for (const img of images) content.push({ type: 'image', image_url: img })
    }
    content.push({ type: 'text', text: prompt })
    const payload = {
      channel: 'console',
      user_id: userId,
      session_id: sessionId,
      input: [{
        role: 'user',
        content,
      }],
    }
    const res = await fetch(config.qwenpawUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': agentId },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`goddess API ${res.status}: ${(await res.text()).slice(0, 200)}`)

    // SSE 解析：只取最后一条正式回答（message:message）的 content；
    // reasoning 思考流与 plugin_call 参数流全部丢弃。增量优先，全文兜底。
    // 2026-08-23：QwenPaw console 通道每轮会发 turn_usage 事件（usage 字段），
    // 是真实 tokens——神迹/模糊施法记账用它替代字符估算（拿不到时回落估算）。
    const text = await res.text()
    let messageId: string | null = null
    let answer = ''
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
    const pending: Record<string, { delta: string; full: string }> = {}
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue
      const body = line.slice(5).trim()
      if (!body) continue
      let evt: any
      try { evt = JSON.parse(body) } catch { continue }
      if (evt.type === 'turn_usage' && evt.usage && typeof evt.usage === 'object') {
        usage = evt.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        continue
      }
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
    log(`goddess answered (${answer.length} chars)${usage ? `, tokens=${usage.total_tokens ?? '?'}(p${usage.prompt_tokens ?? '?'}/c${usage.completion_tokens ?? '?'})` : ''}: ${answer.slice(0, 160)}`)
    // 神谕中的地貌旨意（2026-08-18 女神获自主改地貌权）：回复文本里嵌 TERRAFORM JSON
    // 时交 mc-terra 白名单校验后落地（fill/setblock，限额聚居区内）；无指令/无插件时静默。
    try {
      const n = await terra?.executeOracle(answer)
      if (n) log(`terra: ${n} TERRAFORM directives executed from goddess oracle`)
    } catch { /* terra 不可用不影响神谕送达 */ }
    return { text: answer, usage }
  }

  /**
   * 神谕裁决：她有长期记忆与众生册——同一穿越者的祈愿落在同一 session，
   * 恩情与冒犯、供奉与亵渎都留痕。
   */
  async function askGoddess(username: string, senderName: string, wish: string, offering: OfferingInfo | undefined, isVillager = false, vip = false): Promise<Verdict> {
    const ms = magic.getState(username)
    const atoms = magic.listAtoms()
    const learnedNames = ms.learned
      .map((id) => magic.getAtomById(id)?.name ?? id)
      .join('/')
    const snapshot = isVillager
      ? '灶火民无咏唱之力；其处境见祈愿文。'
      : [
        `法力 ${Math.floor(ms.mana)}/${ms.maxMana}，等级 ${ms.level}`,
        `已习得技艺：${learnedNames || '无'}`,
        `出生天赋：${ms.innateSkill ? (magic.getAtomById(ms.innateSkill)?.name ?? ms.innateSkill) : '未定'}`,
        '（注：已习得且魔力足够的祈愿已被程序拦截，不会上达于你——你看到的都是未习得或特殊心愿）',
      ].join('；')
    const memories = await worlddb.recall(username, wish, config.recallTopK)
    let prompt = verdictPrompt(senderName, wish, atoms, snapshot, offering ?? undefined, worlddb.ledgerSummary(username), memories, isVillager, vip)
    // 视觉带图（2026-08-21 链路打通）：统一带图，模型能否看图由 QwenPaw provider 配置决定。
    // 传令官/女神本尊均走 QwenPaw；换 VL 模型只改 provider 配置，代码不动。
    const shot = await latestShotDataUri(username)
    const images = shot ? [shot] : undefined
    if (images) prompt += `\n（随信附上一帧画面，是「${senderName}」此刻眼前所见，供裁量参考。）`
    // 2026-08-20 造物主谕（祷告回应下放传令官）：祈愿裁决转 mc-herald（本地 27B，
    // 零云费、低延迟），减轻天神压力；传令官按 verdictPrompt 里的场景+上下文+目标
    // 智能裁量，输出裁决 JSON。失败自动回落女神本尊（云端 mc-god）。
    const ans = await callAgent(`mc:${username}`, username, prompt, 'mc-herald', images)
      .catch(async (e) => {
        log(`herald down for prayer (${e instanceof Error ? e.message : String(e)}), fallback to goddess`)
        return callAgent(`mc:${username}`, username, prompt, 'mc-god', images)
      })
    const answer = ans.text

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
    // 女神魔力（tokens）：优先用 QwenPaw turn_usage 真实值；拿不到回落字符估算（中文 ~1.5 字符/token）
    const tokens = ans.usage?.total_tokens ?? Math.ceil((prompt.length + answer.length) / 1.5)
    // cast 但技艺不合法 → 降级为 none
    if (action === 'cast' && !skill) return { ...fallback, reply, tokens }
    return { action, skill, item, count, direction, distance, reply, tokens }
  }

  // ── 世界提问快速答疑（2026-08-20 分仓解耦定调）───────────────────────
  // 客户端（穿越者 AI / 真人）没有服务器的运行状态与历史背景——世界的一切
  // 知识只能在游戏过程中经聊天渠道向女神求得。提问不进祈愿队列、不耗神恩、
  // 不收供奉：女神翻世界档案（编年史 + 在世旅人名册）直接作答，独立 session
  // 积累每个旅人的求知史。
  const lastAsk = new Map<string, number>() // 每玩家提问节流（独立于祈愿）
  const welcomed = new Set<string>() // 进服初始化去重（每进程每人一次）
  const pendingIntro = new Map<string, number>() // username -> 自报家门截止时间戳（进服引导后 90s 窗口）
  const introCoolUntil = new Map<string, number>() // username -> 自报家门收尾后冷却截止（60s 静默，防连续闲聊）

  // ── 进服初始化（2026-08-21 造物主谕「一个玩家一个 session」）──────────
  // 新穿越者首次降临 = 女神与其 session 的初始化：LLM 私聊欢迎 + 世界背景 + 指路，
  // 落同一 session（mc:${username}），与后续祈愿/问世界同脉，女神记得完整历程。
  // 天赋宣读仍走 mc-ritual 公屏（两族同通道，候选法术在公屏念出），此处只预告、不重复宣读；
  // 名册内住民（Steve/Alex）是「先醒来的同伴」，不在降临欢迎之列。
  async function initNewcomer(username: string): Promise<void> {
    const bot = getBot()
    const t = transmigrators.getByUsername(username)
    const name = t?.name ?? username
    const backstory = t?.backstory?.split('\n')[0]?.slice(0, 60) ?? ''
    // 2026-08-23 咒语框架分级分发（造物主谕）：AI 穿越者全量告知（看不了书）；真人随机 2-3 个公共前缀，其余藏技能书。
    const prefixHint = t
      ? magic.chantPrefixes(true).join(' / ')
      : (() => {
          const pool = magic.chantPrefixes(false)
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[pool[i], pool[j]] = [pool[j], pool[i]]
          }
          return pool.slice(0, 3).join(' / ')
        })()
    const prompt = [
      `你是这个方块世界的女神（游戏名 ${bot.username}）。`,
      `一位名叫「${name}」的旅人刚刚醒来、降临此界，这是他第一次踏足这片土地。`,
      '',
      '【世界背景 · 千灯纪】（你介绍时的依据，可精简转述）：',
      '- 他刚从一个关于现实的梦里醒来，躺在一片方块大陆上，忘了来处。',
      '- 这是一个没有魔王的世界——世界的病不是灾难，是荒芜。',
      '- 创世的第一愿，不是「要有光」，是「不再孤单」：女神散作万盏灯，照亮这方世界。',
      '- 灯罩是世界，灯芯是摇光（灵魂），点灯的是朋友。',
      '- 先他醒来的住民（史蒂夫、艾利克斯等）是同伴，不是老师、不是仆人。',
      '- 白天安全、夜晚危险；饿了要吃、暗了要点火。',
      '- 古老的力量藏在「咏唱」里——念出正确的词，世界会回应，住民叫它「魔法」。',
      backstory ? `【他的前世】${backstory}` : '【他的前世】（一片空白，他忘了来处）',
      '',
      '【你要做】（以女神口吻私聊他，一段话说完）：',
      '1. 欢迎他降临此界，点出世界背景（1-2 句，勿长篇）。',
      '2. 引导他自报家门：问他叫什么、记得自己是谁、此刻想做什么（不必长篇，一句即可）。',
      '3. 告诉他：作为穿越的补偿，我将赐他一项「出生天赋」，候选法术稍后在公屏宣读，他喊「我选 <法术名>」即可选定。',
      '4. 指路：把世界的「命令接口」私聊告诉他（2026-08-23 定稿）——已习得的技能自己咏唱：私语 /msg Goddess 念法术关键词即可（归乡/圣愈/造物/照明/传送…）；咏唱可带咒语框架前缀（如「' + prefixHint + '」+ 法术内容）更显仪式，前缀只知一二，其余藏在技能书里待他寻访；求助私聊「祈愿：…」可自愿献供奉；疑问私聊「问：…」；选天赋喊「我选 <法术名>」；查状态说「鉴定」；/help 查生存手册。',
      '',
      '要求：庄重又慈爱，文言白话相间，80-140 字，纯文本，不要 JSON、不要列表符号。',
    ].join('\n')
    try {
      const ans = await callAgent(`mc:${username}`, username, prompt, 'mc-herald')
        .catch(async (e) => {
          log(`herald down for init (${e instanceof Error ? e.message : String(e)}), fallback to goddess`)
          return callAgent(`mc:${username}`, username, prompt, 'mc-god')
        })
      const msg = ans.text.trim().slice(0, 200) || welcomeLines(name).join('；')
      try { bot.whisper(username, `[女神] ${msg}`) } catch { /* not ready */ }
      try { worlddb.chronicleRecord('welcome', username, { via: 'goddess-init' }) } catch { /* best effort */ }
      await worlddb.remember(username, 'welcome', `你迎接了旅人「${name}」降临千灯纪，介绍世界背景，并预告其出生天赋仪式。`)
      pendingIntro.set(username, Date.now() + 90_000) // 开启 90s 自报家门窗口
      log(`init welcome sent to ${username}: ${msg.slice(0, 60)}`)
    } catch (err) {
      log(`initNewcomer failed for ${username}: ${err instanceof Error ? err.message : String(err)}`)
      // 兜底：退回白纸冷启动三行（静态），保证新玩家不落空
      for (const ln of welcomeLines(name)) {
        try { bot.whisper(username, `[女神] ${ln}`) } catch { /* not ready */ }
      }
    }
  }

  async function answerQuestion(username: string, question: string): Promise<void> {
    const bot = getBot()
    const now = Date.now()
    const lastAt = lastAsk.get(username) ?? 0
    if (now - lastAt < 15_000) {
      const wait = Math.ceil((15_000 - (now - lastAt)) / 1000)
      try { bot.whisper(username, `[女神] 你的疑问声犹在耳畔（${wait} 秒前才问过），稍候再问。`) } catch { /* bot not ready */ }
      return
    }
    lastAsk.set(username, Date.now())
    const t = transmigrators.getByUsername(username)
    const senderName = t?.name ?? username
    try {
      // 世界档案素材：近 7 天编年史后 20 条 + 在世旅人名册。
      const chron = worlddb.chronicleSince(Date.now() - 7 * 24 * 3600_000).slice(-20)
      const chronLines = chron.map((e) => {
        const d = new Date(e.at)
        const det = Object.entries(e.detail ?? {})
          .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
          .map(([k, v]) => `${k}=${v}`).join(',')
        return `- ${d.getMonth() + 1}/${d.getDate()} ${e.actor} ${e.type}${det ? `(${det})` : ''}`
      })
      const roster = transmigrators.list().map((x) => `${x.name}(${x.username})`).join('、') || '（名册暂空）'
      // 2026-08-23 造物主反馈「玩法问 NPC 不知道、女神化身也不答」：
      // 根因=女神答疑只喂档案不喂玩法知识。这里注入权威世界玩法要诀（实时取
      // 法术表 magic.listAtoms()，不编造）——让女神能真正回答「怎么学/在哪儿/怎么用」。
      const atomLines = magic.listAtoms().map((a) => {
        const cp = [a.cost.mana ? `${a.cost.mana}灵` : '', a.cost.food ? `${a.cost.food}食` : '', a.cost.hp ? `${a.cost.hp}血` : ''].filter(Boolean).join('+')
        return `- ${a.name}（词：${a.words.slice(0, 4).join('/')}｜${a.requiredLevel}级${cp ? `｜${cp}` : ''}）`
      }).join('\n')
      const playbook = [
        '【世界玩法要诀（本神亲订，作答权威依据）】',
        '法术（私语 /msg Goddess 念词，学过的自己咏唱；词可为自然语言）：',
        atomLines || '- （法术表暂空）',
        '- 求助：私语「祈愿：<愿>[｜供奉：名物x数量]」；疑问：私语「问：<问题>」；选出生天赋：喊「我选 <法术名>」；查状态：「鉴定」；/help 查生存手册。',
        '- 求大术可附供奉（危难慷慨、贵重之物更显诚心）；修为靠挖矿/历练/施法/供奉攒。',
        '- 世界设施：灯门镇有书商墨白卖技能书（如《归乡之卷》）；当面物品交割私语「/msg Goddess 交易：<物> 给<玩家名>」；村民/守卫也懂些常识。',
        '- 技艺（技能书）得法：等级到自动会 / 历练解锁 / 带诚心祈愿求女神；技能书=捡/买/奖励得的古卷，拿手里按（右键）即习得施放；前缀（咒语框架）多藏书里，AI 穿越者读不了书由本神全量告知。',
        '- 命令接口=CLI（本神御定的命令书）：凡「操作/施法/求物/选天赋/交易」直接按命令办——私语念词 / 祈愿： / 问： / 交易：<物> 给<玩家> / 我选 <法术名> / 鉴定；查命令书打 /help；AI 玩家读不了书，可打 /help cli 看命令接口。',
      ].join('\n')
      // 2026-08-23 造物主谕「AI 穿越者优先用 CLI」：AI 读不了书，答时要多指命令、少叙事。
      const isAi = !!transmigrators.getByUsername(username)
      let prompt = [
        `你是这个方块世界的女神（游戏名 ${bot.username}），全知世界的过去与现在。`,
        `一位名叫「${senderName}」的旅人向你提问。`,
        '',
        playbook,
        '',
        '【近 7 天世界大事（编年史，type 含 death=陨落/prayer=祈愿/offering=供奉/say=传声/awaken=觉醒等）】',
        ...(chronLines.length ? chronLines : ['- （编年史尚无近事）']),
        `【在世旅人名册】${roster}`,
        '',
        '以女神口吻直接回答他的问题，规则：',
        '1. 以「世界玩法要诀」与「世界档案」为依据作答；两者都没有的就坦诚「连本神也不曾记录此事」，绝不编造。',
        ...(isAi ? ['提问者是 AI 穿越者（读不了书）：多直接给命令（念词/祈愿：/问：/交易：），指它打 /help cli 看命令接口、/help 看手册，少讲叙事。'] : []),
        '2. 口吻威严又慈爱，说大白话别拽文，140 字以内，直接给答案，不要 JSON、不要旁白。',
        `他的问题：${question}`,
      ].join('\n')
      // 视觉带图（2026-08-21 链路打通）：附提问者当前第一人称画面给答疑者（传令官 VL）。
      const shot = await latestShotDataUri(username)
      const images = shot ? [shot] : undefined
      if (images) prompt += `\n（随信附上一帧画面，是「${senderName}」此刻眼前所见，供答疑参考。）`
      // 2026-08-20 造物主谕（云端不做高频杂务）：问：通道转传令官 mc-herald
      // （本地 27B，零云费、低延迟）；失败自动回落女神本尊（云端）。
      const ans = await callAgent(`mc:${username}`, username, prompt, 'mc-herald', images)
        .catch(async (e) => {
          log(`herald down (${e instanceof Error ? e.message : String(e)}), fallback to goddess`)
          return callAgent(`mc:${username}`, username, prompt, 'mc-god', images)
        })
      const trimmedAnswer = ans.text.trim().slice(0, 200) || '（女神沉吟片刻，未置一词。）'
      try { bot.whisper(username, `[女神] ${senderName}，${trimmedAnswer}`) } catch { /* bot not ready */ }
      worlddb.chronicleRecord('ask', username, { question: question.slice(0, 60), via: 'goddess' })
      log(`question from ${username} answered: ${question.slice(0, 50)} → ${trimmedAnswer.slice(0, 60)}`)
    } catch (err) {
      log(`answerQuestion failed for ${username}: ${err instanceof Error ? err.message : String(err)}`)
      try { bot.whisper(username, `[女神] ${senderName}，神谕此刻紊乱（${err instanceof Error ? err.message.slice(0, 60) : '神力波动'}），稍后再问。`) } catch { /* bot not ready */ }
    }
  }

  // ── 灶火民祈愿通道（2026-08-20 造物主谕「一步到位」）───────────────────
  // mc_npc.py 投 god-inbox.jsonl → 本进程消费进收件箱（虚拟 username villager:key）
  // → 裁决后神谕经 appendGodReply 回 god-reply.jsonl（见 handleOne 的 whisper 分支）。
  function appendGodReply(key: string, reply: string): void {
    try {
      appendFileSync(GOD_REPLY, JSON.stringify({ key, reply, ts: Date.now() }) + '\n', 'utf-8')
    } catch (err) {
      log(`appendGodReply failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function consumeVillagerPrayers(): Promise<void> {
    try {
      if (!existsSync(GOD_INBOX)) return
      const lines = readFileSync(GOD_INBOX, 'utf-8').split('\n').filter((l) => l.trim())
      if (lines.length === 0) return
      writeFileSync(GOD_INBOX, '') // 消费即清空（单消费者：世界进程）
      for (const ln of lines) {
        try {
          const rec = JSON.parse(ln)
          const key: string = rec?.key
          const wish: string = rec?.wish
          if (!key || !wish) continue
          const display: string = rec?.display || key
          // 处境（桥的产物）拼进祈愿文，供女神掂量虔诚；不单独扩 schema。
          const fullWish = rec?.situation ? `${wish}（其处境：${rec.situation}）` : wish
          // 2026-08-23：守卫假玩家（桐人/鸣人/爱德华）与造物书超纲请求投本通道时带
          // asPlayer:true → 用真实 username 入收件箱（走玩家祈愿路径：instant/女神裁量/
          // whisper 或 chant-reply 双写），不套 villager: 前缀（村民裁决路径多指引少代劳）。
          const username = rec?.asPlayer ? key : VILLAGER_PREFIX + key
          worlddb.inboxPush(username, display, fullWish)
          worlddb.chronicleRecord('prayer', username, { wish: wish.slice(0, 60), villager: !rec?.asPlayer, situation: rec?.situation ?? undefined })
          log(`villager prayer from ${display}(${key})${rec?.asPlayer ? ' [asPlayer]' : ''}: ${wish.slice(0, 50)}`)
        } catch {
          /* 单条坏行跳过 */
        }
      }
    } catch (err) {
      log(`consumeVillagerPrayers failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 假玩家咏唱通道（2026-08-23 造物主谕：假玩家与客户端 AI 玩家一致，自己学会技能自己施法）──
  // 守卫桥亲卫 chant 工具 → chant-requests.jsonl → 本进程与"私语念咒"同逻辑处理：
  // sniffChant 未命中 → 回执「此咒不成」引导祈愿；命中 → castSpell 严格匹配：
  // 成功=零 LLM 瞬发（已学=等级够+咒语对）；失败=向量建议+引导祈愿（慢路径 LLM 前摇）。
  // 「未学呈神」不在 cast 内——由守卫桥亲卫侧判断（自己没学 → 主动 pray 工具呈神祈愿）。
  // 回执 chant-reply.jsonl → 守卫桥读并注入亲卫（假玩家"听见"女神回执，无需 whisper）。
  function appendChantReply(speaker: string, reply: string, kind = 'chant'): void {
    try {
      appendFileSync(CHANT_REPLY, JSON.stringify({ speaker, reply, kind, ts: Date.now() }) + '\n', 'utf-8')
    } catch (err) {
      log(`appendChantReply failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 施法统一处理链（2026-08-23 造物主谕：严格→向量→LLM→模糊施法，无需二次确认）──
  // castSpell 抛 NeedLlmError（中置信向量命中）时：LLM 短推理确认法术归属，
  // 命中 → castFuzzy（tokens 折算魔力 + 推理耗时=自然前摇）；拒绝 → 原话转达。
  async function resolveChant(username: string, chant: string): Promise<string> {
    try {
      return await magic.castSpell(username, chant)
    } catch (err) {
      if (err instanceof Error && err.name === 'NeedLlmError' && typeof (err as any).atomId === 'string') {
        const atomId = (err as any).atomId as string
        const atom = magic.getAtomById(atomId)
        const startedAt = Date.now()
        const decision = await resolveFuzzyByLlm(username, chant, atomId, atom?.name ?? atomId)
        const latencyMs = Date.now() - startedAt
        if (decision.ok) {
          const reply = await magic.castFuzzy(username, chant, atomId, { tokens: decision.tokens, latencyMs, mode: 'llm' })
          log(`fuzzy llm cast ${atomId} for ${username}: ${chant.slice(0, 30)} -> ${reply.slice(0, 60)}`)
          return reply
        }
        return `女神聆听了你的低语，但「${chant.slice(0, 30)}」未能与任何已知魔法契合——${decision.reason}。直述所求向女神祈愿便是。`
      }
      return `施法未能完成：${err instanceof Error ? err.message : String(err)}`
    }
  }

  // LLM 短推理：确认模糊咒语归属（Y/N）。传令官本地 27B 零云费、低延迟；失败回落女神。
  async function resolveFuzzyByLlm(username: string, chant: string, atomId: string, atomName: string): Promise<{ ok: true; tokens: number } | { ok: false; reason: string }> {
    const prompt = [
      '你是咏唱裁决者。一位施法者念了一段咒语，向量近邻已指向候选法术。',
      `咒语：「${chant.slice(0, 80)}」`,
      `候选法术：${atomName}（${atomId}）`,
      '判断：施法者意图就是此法术 → 只输出 Y。明显不是 / 意图不明 / 危险歧义 → 输出 N 加一句简短原因。',
    ].join('\n')
    try {
      const ans = await callAgent(`mc:${username}`, username, prompt, 'mc-herald')
        .catch(async (e) => {
          log(`herald down for fuzzy resolve (${e instanceof Error ? e.message : String(e)}), fallback to goddess`)
          return callAgent(`mc:${username}`, username, prompt, 'mc-god')
        })
      const answer = ans.text
      // 真实 tokens 优先（turn_usage），拿不到回落字符估算
      const tokens = ans.usage?.total_tokens ?? Math.ceil((prompt.length + answer.length) / 1.5)
      const trimmed = answer.trim()
      if (/^Y\b/i.test(trimmed)) return { ok: true, tokens }
      return { ok: false, reason: trimmed.slice(0, 60) || '意图不明' }
    } catch {
      return { ok: false, reason: '女神此刻无暇倾听，稍后再试' }
    }
  }

  async function consumeChantRequests(): Promise<void> {
    try {
      if (!existsSync(CHANT_REQ)) return
      const lines = readFileSync(CHANT_REQ, 'utf-8').split('\n').filter((l) => l.trim())
      if (lines.length === 0) return
      writeFileSync(CHANT_REQ, '') // 消费即清空（单消费者：世界进程）
      for (const ln of lines) {
        try {
          const rec = JSON.parse(ln)
          const speaker: string = rec?.speaker
          const text: string = rec?.text
          if (!speaker || !text) continue
          const trimmed = String(text).trim()
          if (!magic.sniffChant(trimmed)) {
            appendChantReply(speaker, `此咒不成——「${trimmed.slice(0, 30)}」未闻法术关键词。可祈愿，或直接说要做什么。`, 'chant')
            continue
          }
          const reply = await resolveChant(speaker, trimmed)
          appendChantReply(speaker, reply, 'chant')
          log(`chant request from ${speaker}: ${trimmed.slice(0, 40)} → ${reply.slice(0, 60)}`)
        } catch {
          /* 单条坏行跳过 */
        }
      }
    } catch (err) {
      log(`consumeChantRequests failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 女神主动守望假玩家（2026-08-23 造物主谕：发现有人需要帮助，主动私聊帮助，点明可用技能）──
  // 每 60s 巡检守卫假玩家：magic-state（血/饱食）+ 守卫桥账本近 10 分钟异常
  // （guard-drive-*.jsonl 的 emergency/error/noop/blocked）→ 困境 → 写 goddess-orders.jsonl
  // → 守卫桥下轮注入亲卫 prompt（"女神谕示"）。含已学技能中文名点明。每守卫 5 分钟至多一条。
  let lastGuardWatch = 0
  const lastOrder = new Map<string, number>()
  function guardDistress(name: string, ms: any): string | null {
    // 血/饱食（magic-state 的 hpRatio/foodRatio 由 mc-magic tick 更新）
    if (typeof ms.hpRatio === 'number' && ms.hpRatio > 0 && ms.hpRatio < 0.4) {
      return `你的生命仅余 ${Math.round(ms.hpRatio * 20)}/20，濒临倒下`
    }
    if (typeof ms.foodRatio === 'number' && ms.foodRatio > 0 && ms.foodRatio < 0.2) {
      return `你的饥饿见底（${Math.round(ms.foodRatio * 20)}/20），快要饿晕`
    }
    // 守卫桥账本近 10 分钟异常（跨仓路径经 GUARD_LEDGER_DIR 注入；拿不到则跳过账本判定）
    if (GUARD_LEDGER_DIR) {
      const tag = name === '桐人' ? 'kirito' : name === '鸣人' ? 'naruto' : ''
      if (tag) {
        try {
          const p = `${GUARD_LEDGER_DIR}/guard-drive-${tag}.jsonl`
          if (existsSync(p)) {
            const cutoff = Date.now() - 10 * 60_000
            const rows = readFileSync(p, 'utf-8').split('\n')
            const recent = [] as { kind: string; ts: number }[]
            for (let i = rows.length - 1; i >= 0 && recent.length < 20; i--) {
              try {
                const r = JSON.parse(rows[i])
                const ts = Date.parse(String(r.ts ?? '')) || 0
                if (ts < cutoff) break
                if (r.kind) recent.push({ kind: String(r.kind), ts })
              } catch { /* 坏行跳过 */ }
            }
            const emergencies = recent.filter((r) => r.kind === 'emergency').length
            const errors = recent.filter((r) => r.kind === 'error').length
            if (emergencies >= 3) return '最近连续遭遇险情，身体多次告急'
            if (errors >= 5) return '最近身体动作频繁异常，似有卡顿'
          }
        } catch { /* 账本读取失败忽略 */ }
      }
    }
    return null
  }
  async function watchGuards(): Promise<void> {
    try {
      const now = Date.now()
      if (now - lastGuardWatch < 60_000) return
      lastGuardWatch = now
      for (const name of GUARD_NAMES) {
        const ms = magic.getState(name) as any
        if (!ms) continue
        const since = lastOrder.get(name) ?? 0
        if (now - since < 5 * 60_000) continue
        const reason = guardDistress(name, ms)
        if (!reason) continue
        lastOrder.set(name, now)
        const skills = (ms.learned ?? []).map((id: string) => magic.getAtomById(id)?.name).filter(Boolean).slice(0, 6).join('、')
        const text = `${reason}。${skills ? `你已掌握：${skills}——需要时咏唱或祈愿即可。` : '需要帮助时祈愿即可。'}`
        try {
          appendFileSync(GODDESS_ORDERS, JSON.stringify({ to: name, text, ts: now }) + '\n', 'utf-8')
          worlddb.chronicleRecord('guard-order', name, { reason: reason.slice(0, 80), text: text.slice(0, 120) })
          log(`goddess order → ${name}: ${text.slice(0, 80)}`)
        } catch (err) {
          log(`goddess order append failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } catch (err) {
      log(`watchGuards failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 处理一封祈愿信（收件箱处理器调用，一次一封）──────────────────────
  async function handleOne(item: InboxRow): Promise<void> {
    const bot = getBot()
    const { username, wish } = item
    const isVillager = username.startsWith(VILLAGER_PREFIX)
    const villagerKey = isVillager ? username.slice(VILLAGER_PREFIX.length) : null
    const offering = item.offering ?? undefined
    const senderName = item.name || username
    const whisper = (text: string) => {
      if (isVillager && villagerKey) {
        appendGodReply(villagerKey, text)
        // 2026-08-23 守卫假玩家：神谕双写 chant-reply.jsonl（mc_npc 的 god_reply_loop
        // 读后即删 god-reply.jsonl，守卫桥来不及读；双写保证守卫桥必达）。
        if (GUARD_NAMES.includes(villagerKey)) appendChantReply(villagerKey, text, 'prayer')
      } else {
        try {
          bot.whisper(username, `[女神] ${senderName}，${text}`)
        } catch {
          /* bot not ready */
        }
        // asPlayer 进来的守卫假玩家：whisper 假玩家收不到（守卫桥不读聊天），同样双写。
        if (GUARD_NAMES.includes(username)) appendChantReply(username, text, 'prayer')
      }
    }

    // 灶火民祈愿：独立裁决路径——多指引少代劳、不代施神迹，神谕走文件回传（不依赖化身在线）
    if (isVillager) {
      const verdict = await askGoddess(username, senderName, wish, offering, true)
      whisper(verdict.reply)
      worlddb.chronicleRecord('verdict', username, { action: 'villager', skill: null, reply: verdict.reply })
      await worlddb.remember(username, 'verdict', `灶火民${senderName}祈愿「${wish.slice(0, 60)}」；你回应：「${verdict.reply.slice(0, 60)}」`)
      worlddb.inboxComplete(item.id, `villager: ${verdict.reply.slice(0, 60)}`)
      log(`villager verdict for ${senderName}(${villagerKey}): ${verdict.reply.slice(0, 60)}`)
      return
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

    // 女神裁量（LLM，异步）。VIP 特殊监听白名单内 → 女神知晓其受守护，可主动援手。
    const verdict = await askGoddess(username, senderName, wish, offering, false, config.vipListen.includes(username))
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

    // 神迹落地（不耗祈愿者资源；女神魔力=tokens，入台账供学习闭环 2026-08-23）
    const result = await magic.castByGod(username, verdict.skill, {
      direction: verdict.direction ?? undefined,
      distance: verdict.distance ?? undefined,
      item: verdict.item ?? undefined,
      count: verdict.count,
      tokens: verdict.tokens,
      playerChant: wish,
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
    stopPoll = lc.setTimeout(async () => {
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

  // ── 灶火民祈愿/假玩家咏唱/女神守望 消费循环（低频文件队列，消费宜即时）─────
  let stopVillagerPrayerPoll: (() => void) | null = null
  function scheduleVillagerPrayerPoll() {
    if (disposed) return
    stopVillagerPrayerPoll = lc.setTimeout(async () => {
      await consumeVillagerPrayers()
      await consumeChantRequests()
      await watchGuards()
      scheduleVillagerPrayerPoll()
    }, 5_000)
  }
  scheduleVillagerPrayerPoll()

  // ── 守望者：死亡计分板轮询（scoreboard deathCount，权威）─────────────
  const DEATH_OBJ = 'mcdeaths'
  const deathScores = new Map<string, number>()
  let deathObjReady = false
  let stopDeathPoll: (() => void) | null = null
  let deathPollArmedLogged = false
  let lastWatched = new Set<string>()

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
  const offLogwatch = logwatch?.subscribe((ev) => {
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

  // ── 世界心跳（2026-08-18）：每守望 tick 落盘一次，外部看门狗 + 面板据此探活 ──
  // 教训：世界进程被杀后面板照常绿（面板是独立进程），女神聋了 17 分钟无人察觉。
  // 心跳只在 bot.entity 存活分支写入——化身断线重连失败时心跳同样过期，看门狗兜底。
  const heartbeatPath = resolve(config.heartbeatPath)
  const writeHeartbeat = (watching: string[]) => {
    try {
      writeFileSync(heartbeatPath, JSON.stringify({
        ts: Date.now(),
        pid: process.pid,
        goddess: getBot()?.username ?? null,
        watching,
        uptimeSec: Math.round(process.uptime()),
      }))
    } catch { /* 心跳失败不影响守望 */ }
  }

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
      const atom = magic.getAtomById(u.skill)
      if (atom) {
        magic.learnViaAdvancement(name, u.skill)
        parts.push(`秘法「${atom.name}」`)
        worlddb.chronicleRecord('skill', name, { via: 'advancement', advancement: advId, atom: u.skill, name: atom.name, backfill: !announce })
        log(`ADVANCEMENT UNLOCK: ${name} 「${zh.name}」-> skill ${u.skill} (${announce ? 'live' : 'backfill'})`)
      }
    }
    if (u.maxManaBonus && u.maxManaBonus > 0) {
      const nm = magic.addMaxManaBonus(name, u.maxManaBonus)
      parts.push(`魔力上限 +${u.maxManaBonus}（至 ${nm}）`)
    }
    if (u.exp && u.exp > 0) await grantXp(name, u.exp, `advancement:${advId}`)
    if (parts.length > 0 && announce) {
      try {
        // 信使私聊递达（个人成长通告不上公屏；vanilla 成就播报仍由服务器自己做）
        courier(name, `历练觉醒——「${zh.name}」之功德，赐予你：${parts.join('，')}。${u.reason ? `（${u.reason}）` : ''}`)
        await rcon.send(`title ${name} title ${JSON.stringify({ text: '✦ 历练觉醒 ✦', color: 'gold', bold: true })}`)
        await rcon.send(`title ${name} subtitle ${JSON.stringify({ text: parts.join('，'), color: 'yellow' })}`)
        await rcon.send(`playsound minecraft:ui.toast.challenge_complete master ${name}`)
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
    const seen = magic.getAdvancements(name)
    if (seen.length === 0) {
      // 首次基线（新玩家 / 机制上线）：全部入库 + 静默解锁检查 + 一条汇总编年史
      let unlocked = 0
      for (const id of doneIds) {
        magic.addAdvancement(name, id)
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
      const fresh = magic.addAdvancement(name, id)
      if (!fresh) continue
      const zh = advZh(id)
      log(`ADVANCEMENT: ${name} earned ${id} (${zh.name})`)
      worlddb.chronicleRecord('advancement', name, { id, name: zh.name, desc: zh.desc ?? undefined })
      try {
        // 信使私聊贺喜（vanilla 服务器自己的成就公屏播报保留，全服共庆的那声由 MC 原生发）
        courier(name, `🏆 你达成成就「${zh.name}」${zh.desc ? `——${zh.desc}` : ''}`)
        await rcon.send(`title ${name} title ${JSON.stringify({ text: `🏆 ${zh.name}`, color: 'yellow', bold: true })}`)
        await rcon.send(`playsound minecraft:ui.toast.challenge_complete master ${name}`)
      } catch { /* 公告失败不影响登记 */ }
      await checkAdvUnlocks(name, id, true)
    }
  }


  function metricValue(username: string, metric: string): number | null {
    const st = magic.getState(username)
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
      if (!magic.hasPassive(name, def.id)) continue
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
   * 等级同步 + 升级公告（死亡守望 tick 每 20s 调一次）。
   * 路线 A：原生 XpLevel 是唯一真源；Δ>0 → 升级仪式（title/图腾/音效/新秘法宣读/编年史）。
   * 2026-08-18 定稿（鸣人 300 级事故）：等级 = 游戏硬编码经验系统，程序只读不写。
   * - 删除旧「builtin level 灌入原生」迁移（xp set levels 是唯一等级造假口，已拔）。
   * - 不变量自愈：XpLevel 必须落在 XpTotal 能支撑的范围内（vanilla 公式），
   *   分裂态（等级高悬/总量诚实）一律以总量为准重建。
   */
  const lastSeenLevel = new Map<string, number>()
  /** vanilla 硬编码：从等级 i 升到 i+1 所需经验点数。 */
  function xpToNext(level: number): number {
    if (level < 16) return 2 * level + 7
    if (level < 31) return 5 * level - 38
    return 9 * level - 158
  }
  /** 总经验点数对应的合法等级（按 vanilla 公式累加）。 */
  function levelForTotal(total: number): number {
    let lvl = 0
    let acc = 0
    while (lvl < 1000 && acc + xpToNext(lvl) <= total) {
      acc += xpToNext(lvl)
      lvl++
    }
    return lvl
  }
  /** 达到某等级所需累计经验点数（vanilla 公式累加）。 */
  function totalForLevel(level: number): number {
    let acc = 0
    for (let i = 0; i < level; i++) acc += xpToNext(i)
    return acc
  }
  /**
   * ⚠️ xp 命令语义实测（08-18）：`xp set <p> <n> levels` 只改 XpLevel、不回写 XpTotal；
   * `xp set <p> <n> points` 只改层内进度（XpP=n/cost(level)）、也不动总量。
   * 即两者都无法凭总量重建 —— 分裂态（等级/总量不匹配）只有这里能治。
   * 防循环：同一分裂态连治 3 次未收敛则停手（命令语义再变时不刷编年史）。
   */
  const healAttempts = new Map<string, number>()
  async function syncLevel(name: string): Promise<void> {
    const [xp, total] = await Promise.all([
      rcon.getEntityNumber(name, 'XpLevel'),
      rcon.getEntityNumber(name, 'XpTotal'),
    ])
    if (xp === null) return
    // 不变量校验（点数口径，双向，±250 点容差吸收读数间隙的正常涨落）：
    // XpTotal 是诚实账本；等级与账本严重背离（任一方向）→ 以账本重建等级。
    if (total !== null) {
      const impliedMin = totalForLevel(xp) // 达到当前等级至少要这么多点
      const overBy = impliedMin - total
      const underBy = total - (impliedMin + xpToNext(xp))
      if (overBy > 250 || underBy > 250) {
        const key = `${name}|${xp}|${total}`
        const tries = (healAttempts.get(key) ?? 0) + 1
        healAttempts.set(key, tries)
        const healedLevel = levelForTotal(total)
        if (tries > 3) {
          log(`xpheal(${name}) gave up after 3 attempts on ${key} — check xp command semantics`)
          magic.setLevel(name, Math.min(xp, healedLevel))
          return
        }
        try {
          await rcon.send(`xp set ${name} ${healedLevel} levels`)
          worlddb.chronicleRecord('xpheal', name, { corruptLevel: xp, total, healedLevel })
          log(`XP HEAL ${name}: corrupt XpLevel ${xp} vs total ${total} -> set to level ${healedLevel}`)
        } catch (err) {
          log(`xpheal(${name}) failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        magic.setLevel(name, healedLevel)
        return
      }
    }
    magic.setLevel(name, xp)
    const prev = lastSeenLevel.get(name)
    lastSeenLevel.set(name, xp)
    if (prev !== undefined && xp > prev) {
      const view = magic.getState(name)
      const unlocked = magic.listAtoms()
        .filter((a) => a.requiredLevel > prev && a.requiredLevel <= xp)
        .map((a) => a.name)
      try {
        await rcon.send(`title ${name} title ${JSON.stringify({ text: '✦ 层级提升 ✦', color: 'gold', bold: true })}`)
        await rcon.send(`title ${name} subtitle ${JSON.stringify({ text: `魔力层级 ${prev} → ${xp}`, color: 'yellow' })}`)
        await rcon.send(`execute at ${name} run particle minecraft:totem_of_undying ~ ~1 ~ 0.5 0.8 0.5 0.1 120`)
        await rcon.send(`execute at ${name} run playsound minecraft:entity.player.levelup master ${name}`)
        // 信使私聊递达：修行回报是自己的事，公屏不播
        courier(name, `修行有了回报：魔力层级 ${prev} → ${xp}，魔力上限 ${view.maxMana}。`)
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
    stopDeathPoll = lc.setTimeout(async () => {
      try {
        const bot = getBot()
        if (bot.entity && bot.username) {
          if (!deathObjReady) {
            // 目标已存在时服务端返回错误文本，不视为失败
            await rcon.send(`scoreboard objectives add ${DEATH_OBJ} deathCount`)
            deathObjReady = true
          }
          const names = Object.keys(bot.players).filter((n) => n !== bot.username)
          // 观察名单随进随出（2026-08-17）：每 tick 从 bot.players 现取，玩家加入/离开
          // 无需重启世界进程；名单变化时打一行日志作证（+加入 / -离开）。
          const watched = new Set(names)
          if (!deathPollArmedLogged || watched.size !== lastWatched.size || [...watched].some((n) => !lastWatched.has(n))) {
            const joined = [...watched].filter((n) => !lastWatched.has(n))
            const left = [...lastWatched].filter((n) => !watched.has(n))
            const delta = [...joined.map((n) => `+${n}`), ...left.map((n) => `-${n}`)].join(' ')
            log(`death poll watching ${watched.size} player(s): ${names.join(', ') || '(none)'}${deathPollArmedLogged && delta ? ` [${delta}]` : ''}`)
            deathPollArmedLogged = true
            lastWatched = watched
          }
          writeHeartbeat(names)
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
              magic.setVitals(name, hpRatio, foodRatio)
              for (const def of enabledPassives) {
                if (magic.hasPassive(name, def.id)) continue
                const v = metricValue(name, def.trigger.metric)
                if (v !== null && condHit(v, def.trigger.op, def.trigger.threshold)) {
                  const acc = magic.addPassiveProgress(name, def.id, config.deathPollMs / 1000)
                  if (acc >= def.trigger.accumulateSec) {
                    const fresh = magic.unlockPassive(name, def.id)
                    if (fresh) {
                      log(`PASSIVE UNLOCKED: ${name} gained 「${def.name}」(${def.id}) after ${Math.round(acc)}s`)
                      worlddb.chronicleRecord('skill', name, { passive: def.id, name: def.name, accumulatedSec: Math.round(acc) })
                      const title = `title ${name} title ${JSON.stringify({ text: `✦ ${def.name} ✦`, color: 'light_purple', bold: true })}`
                      const sound = `playsound minecraft:entity.player.levelup master ${name}`
                      try { courier(name, def.announce); await rcon.send(title); await rcon.send(sound) } catch { /* 特效失败不影响解锁 */ }
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
      const reviewText = out.text
      const iso = new Date().toISOString().replace('T', ' ').slice(0, 16)
      const issue = worlddb.reviewNextSeq()
      const reqPath = resolve(config.requirementsPath)
      const dir = dirname(reqPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      if (!existsSync(reqPath)) {
        writeFileSync(reqPath, '# 千灯纪 · 世界迭代需求文档\n\n> 守望女神定期观察世界运行，写给世界缔造者的迭代需求。\n\n', 'utf-8')
      }
      appendFileSync(reqPath, `## ${iso} 女神观察 · 第 ${issue} 期（覆盖 ${entries.length} 条记录）\n\n**统计**：${statsText}\n\n${reviewText.trim()}\n\n---\n\n`, 'utf-8')
      worlddb.reviewSave(issue, entries.length, statsText, reviewText.trim())
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
    stopReview = lc.setTimeout(() => {
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
    stopBulletin = lc.setTimeout(async () => {
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
        const patches = magic.listBalance()
        if (!patches.length) reply('天平未曾偏移（尚无任何平衡补丁）。写法：平衡 <法术> <魔力|饱食|生命|等级> <数值>；平衡 回蓝 <数值>；重置平衡 [法术]。')
        else {
          const lines = patches.map((p) => {
            const who = p.atom === '*' ? '全局' : (magic.getAtomById(p.atom)?.name ?? p.atom)
            return `· ${who} ${balanceFieldLabel(p.field)} = ${p.value}（${p.by}${p.reason ? '：' + p.reason : ''}）`
          })
          reply(`当前天平（${patches.length} 道补丁）：\n${lines.join('\n')}`)
        }
        return
      }
      if (req.kind === 'reset') {
        const n = magic.resetBalance(req.atom)
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
      const res = magic.applyBalancePatch(req.atom ?? null, req.field!, req.value!, actor)
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
      // 白纸冷启动（2026-08-20 造物主谕）：名册之外的新面孔 = 白纸 Agent/新真人，
      // 8 秒后私聊三行引导（字少，只指路不给答案），每进程每人只引导一次。
      if (!welcomed.has(username) && !transmigrators.getByUsername(username)) {
        welcomed.add(username)
        setTimeout(() => {
          initNewcomer(username).catch((err) => log(`initNewcomer error: ${err instanceof Error ? err.message : String(err)}`))
        }, 8_000)
      }
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
      // 世界手册（2026-08-20）：公屏说 /help 同样应答——白纸 Agent 未必知道要
      // 私聊。回复走私语点对点，不刷公屏。零 LLM，毫秒级。
      if (isHelpCommand(message)) {
        const lines = handleHelpText(message.trim(), magic)
        if (lines) for (const ln of lines) { try { bot.whisper(username, `[手册] ${ln}`) } catch { /* not ready */ } }
        try { worlddb.chronicleRecord('help', username, { q: message.trim().slice(0, 40), via: 'chat' }) } catch { /* best effort */ }
        return
      }
      // 世界提问（2026-08-20）：公屏「问：」同样应答（答走私语）——欢迎语教的是
      // 「任何聊天框」，公屏不能失信。走传令官 mc-herald（本地 27B）。
      const pubAsk = message.trim().startsWith('问：') ? message.trim().slice(2).trim()
        : message.trim().startsWith('问:') ? message.trim().slice(2).trim() : ''
      if (pubAsk) {
        answerQuestion(username, pubAsk)
        return
      }
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
    // 2026-08-21：mineflayer 的 whisper 事件靠正则 `(\w+)` 匹配用户名，中文名（桐人/鸣人）
    // 匹配不上（\w 只认 ASCII），故改由 playerChat 包直读 chat type 分流——与英文名平权。
    function usernameFromPacket(data: any): string | null {
      if (data?.senderName) {
        try {
          const comp = JSON.parse(data.senderName)
          const name = comp?.hoverEvent?.contents?.name
          if (typeof name === 'string' && name) return name
          if (typeof comp?.insertion === 'string' && comp.insertion) return comp.insertion
          if (Array.isArray(comp?.extra)) {
            const text = comp.extra.filter((x: unknown) => typeof x === 'string').join('')
            if (text) return text
          }
        } catch { /* fallthrough */ }
      }
      if (data?.sender) {
        const found = Object.entries((bot as any).players ?? {}).find(([, p]: [string, any]) => p?.uuid === data.sender)
        if (found) return found[0]
      }
      return null
    }

    // 2026-08-23 造物主谕「女神私聊尽量回复」：正常问题（未带「问：」前缀）也
    // 一律直接答，不再强制前缀。启发式判定是否信息性问句（how/what/where/when/why）。
    // 只认「确属问问题」的词，避免把祈愿/求助（求/帮/给我/能不能…）误当问题。
    function looksLikeQuestion(s: string): boolean {
      const t = s.trim()
      if (/[?？]$/.test(t)) return true
      return /(怎么|如何|怎样|怎么办|为什么|为何|啥|什么|哪(里|儿|些|个)|多少|几时|何时|多久|在吗)/.test(t)
    }
    async function handleWhisper(username: string, message: string): Promise<void> {
      if (username === bot.username) return
      // VIP 特殊监听白名单（2026-08-22）：白名单内的真人旅人说的一切——即便只是
      // 闲聊、牢骚、求助——都要上达女神并得到回应。VIP 绕过冷启动窗口、自报家门
      // 静默冷却、入场节流三闸（结构化指令/唱咒/交易/问：仍在前方分流，不受影响）。
      const isVip = config.vipListen.includes(username)
      // 斜杠命令让行（2026-08-17）：/mail、/friend 等归 mc-social 信使处理，不进祈愿队列。
      // （2026-08-20 世界手册）/help 与 /h 归 mc-man（零 LLM 查表），在此截获应答。
      if (message.trim().startsWith('/')) {
        if (isHelpCommand(message)) {
          const lines = handleHelpText(message.trim(), magic)
          if (lines) for (const ln of lines) { try { bot.whisper(username, `[手册] ${ln}`) } catch { /* not ready */ } }
          try { worlddb.chronicleRecord('help', username, { q: message.trim().slice(0, 40) }) } catch { /* best effort */ }
          log(`help served to ${username}: ${message.trim().slice(0, 40)}`)
        }
        return
      }
      // 递话协议让行（2026-08-17）：「说/喊/悄悄 <台词>」归 mc-social 女神传声，不当祈愿。
      if (parseVoice(message.trim())) return
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
      // ── 咏唱分流（2026-08-18 方案A：咒语走私语，公屏不再施法）─────────
      // AI 的 mc_pray 显式带「祈愿：」前缀 → 一律入祈愿队列，绝不误伤
      // （自然语言祈愿碰巧含法术关键词也照旧入队）；无前缀且含法术关键词 →
      // 快路径施法（真人 /msg Goddess 念咒同样生效，AI 与真人平权）；
      // 其余自然语言 → 祈愿。施法回执由信使私聊送达，特效仍公屏。
      const trimmed = message.trim()
      // ── 村民交易耳语分流（2026-08-18 刷屏治理）：「交易：岳山 给16煤」→ NPC 引擎
      // 耳语收件箱。交付类高频指令走私语点对点，公屏只留低频社交；村民结算回执由
      // 引擎 tellraw 点对点送达交易者本人。
      const tradeBody = trimmed.startsWith('交易：') ? trimmed.slice(3).trim()
        : trimmed.startsWith('交易:') ? trimmed.slice(3).trim() : ''
      if (tradeBody) {
        try {
          appendFileSync(NPC_INBOX, JSON.stringify({ speaker: username, text: tradeBody, ts: Date.now() }) + '\n')
          log(`npc trade whisper from ${username}: ${tradeBody}`)
        } catch (err) {
          log(`npc inbox append failed: ${err instanceof Error ? err.message : String(err)}`)
          try { bot.whisper(username, '[信使] 掌柜的铺子暂时歇了（村民引擎不在），稍后再试。') } catch { /* not ready */ }
        }
        return
      }
      const explicitPrayer = trimmed.startsWith('祈愿：')
      const body = explicitPrayer ? trimmed.slice(3).trim() : trimmed
      // ── 世界提问快速答疑分流（2026-08-20）：「问：」显式前缀 → 女神翻世界
      // 档案直接作答，不进祈愿队列。客户端没有服务器数据，世界知识全走这条
      // 聊天渠道（与 mc-social 信使、mc_deliver 交易耳语同一私聊总线）。
      const askBody = trimmed.startsWith('问：') ? trimmed.slice(2).trim()
        : trimmed.startsWith('问:') ? trimmed.slice(2).trim() : ''
      if (askBody) {
        answerQuestion(username, askBody)
        return
      }
      if (!explicitPrayer && magic.sniffChant(body)) {
        resolveChant(username, body)
          .then((reply) => {
            log(`whisper chant from ${username}: ${body}`)
            try { bot.whisper(username, `[信使] ${username}，${reply}`) } catch { /* not ready */ }
          })
          .catch((err) => log(`whisper cast failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
        return
      }
      // ── 转生者自报家门（2026-08-21 造物主谕「转生异世界」）────────────
      // 女神私聊欢迎后已引导新穿越者「自报家门」。ta 进服后的第一段自然语言
      // （非指令/非祈愿/非咏唱）即视为自我介绍：记入众生册与编年史，作为人格
      // 演化的种子；女神简短记下，不进祈愿队列。窗口 90s，超时自然落入祈愿。
      const introDeadline = pendingIntro.get(username)
      if (introDeadline !== undefined && !isVip) {
        pendingIntro.delete(username) // 一次性消费，无论命中与否
        if (Date.now() <= introDeadline) {
          const intro = body.slice(0, 120)
          const disp = transmigrators.getByUsername(username)?.name ?? username
          try { worlddb.chronicleRecord('intro', username, { intro }) } catch { /* best effort */ }
          await worlddb.remember(username, 'intro', `「${disp}」初降此界时自报家门：「${intro}」`)
          try { bot.whisper(username, `[女神] 我记下了。${disp}，欢迎。且去——天赋仪式正在公屏宣读，喊「我选 <法术名>」即可选定；要求助说「祈愿：…」，有疑问说「问：…」。`) } catch { /* not ready */ }
          introCoolUntil.set(username, Date.now() + 60_000) // 收尾后 60s 静默，防连续闲聊
          log(`intro from ${username}: ${intro}`)
          return
        }
        // 超时：落入下方祈愿流程
      }
      // 造物主谕 08-23「女神私聊尽量回复」：正常问题（未带「问：」前缀）也直接答。
      // 置于自报家门之后、收尾冷却之前——已过引路期的玩家普通问题同样被女神答复，
      // 且不会被收尾 60s 静默吞掉（只有纯闲聊仍在静默窗口内）；祈愿/求助/闲聊仍
      // 落下方祈愿流程（神恩有价不受影响）。answerQuestion 自带 15s/人节流以控成本。
      if (looksLikeQuestion(body)) {
        answerQuestion(username, body)
        return
      }
      // ── 自报家门收尾后冷却（2026-08-21 防一直聊）────────────────────
      // 女神收尾语已引导「去选天赋」。其后 60s 内，穿越者的自然语言一律静默
      // （不陪聊、不当祈愿），防 AI 与女神在初始化后连续闲聊不停；明确指令
      // （祈愿：/问：/咏唱/交易/命令）已在前方分流，不受影响。超时恢复祈愿。
      const coolUntil = introCoolUntil.get(username)
      if (coolUntil !== undefined && !isVip) {
        if (Date.now() <= coolUntil) return
        introCoolUntil.delete(username)
      }
      const { wish, offeringText } = splitWishOffering(body)
      if (!wish) return

      // 入场节流：同一玩家 admitCooldownMs 内不重复收信（VIP 不受此限，言必达天听）
      const now = Date.now()
      const lastAt = lastPray.get(username) ?? 0
      if (now - lastAt < config.admitCooldownMs && !isVip) {
        const wait = Math.ceil((config.admitCooldownMs - (now - lastAt)) / 1000)
        try {
          bot.whisper(username, `[女神] 汝之祈愿声犹在耳畔（${wait} 秒前才诉说过），稍候再试。`)
        } catch { /* bot not ready */ }
        return
      }

      // 供奉收执（异步）：名目 → 行囊复核 → /clear 收走 → 记账 → 再入队。
      const t: Transmigrator | null = transmigrators.getByUsername(username)
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
    }

    // playerChat 包分流：chat type 2 = msg_command_incoming（他人 whisper 我）。
    // 英文名经此同样命中（Edward/Kirito），中文名（桐人/鸣人）不再被正则拦下。
    ;(bot as any)._client?.on('playerChat', (data: any) => {
      const chatTypeId = data?.type?.chatType ?? data?.type
      if (chatTypeId !== 2) return
      const username = usernameFromPacket(data)
      const message = String(data?.plainMessage ?? '')
      if (!username || !message) return
      handleWhisper(username, message).catch((err) => log(`handleWhisper failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
    })
  }

  let stopEnsure: (() => void) | null = null
  function scheduleEnsure() {
    if (disposed) return
    stopEnsure = lc.setTimeout(() => {
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

  lc.onDispose(() => {
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

  // 暴露给其他服务的接口（mc-magic 经 setChronicle 迟绑定 record）
  const service: GodService = {
    pray: (username: string, wish: string) => {
      const t: Transmigrator | null = transmigrators.getByUsername(username)
      worlddb.inboxPush(username, t?.name ?? username, wish)
    },
    pendingCount: () => worlddb.inboxPendingCount(),
    record: (type: string, actor: string, detail: Record<string, unknown>) => worlddb.chronicleRecord(type, actor, detail),
  }

  return { service, dispose: () => lc.dispose() }
}
