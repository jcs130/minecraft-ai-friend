import type { Bot } from 'mineflayer'
import type { RconService } from './mc-rcon.ts'
import type { AtomSummary, MagicService } from './mc-magic.ts'
import type { Transmigrator, TransmigratorRegistry } from './mc-transmigrator.ts'
import { createLifecycle } from './lifecycle.ts'

/**
 * mc-ritual —— 降临仪式（世界侧，程序化、零生成式 LLM）。
 *
 * 每个穿越者（AI bot 或真人玩家）首次降临此界、尚未选定「出生天赋」时，
 * 女神主持降临仪式：公屏宣读候选法术（按档案 innate.preferredAtoms 优先排序），
 * 穿越者选天赋走双通道（2026-08-22 定谳）：
 *   - 公屏喊「我选 X / 选 N」→ 公屏确认（兼容真人玩家，原文保留）；
 *   - 私语说「我选 X / 选 1」→ 私语确认（bot.whisper，AI 穿越者偏好私密表态）；
 * 两种来源都解析同一份候选、都写 magic-state 的 innateSkill，
 * 只是「确认」跟随来源通道（公屏选→公屏确认，私语选→私语确认）。
 *
 * 宣读始终公屏（所有穿越者都看得到候选清单），大字标题「降临」走 RCON
 * （视觉糖，给真人玩家的仪式感）。
 */
export interface Config {
  enabled: boolean
}

// ── 候选排序：档案偏好的技能排前（保持档案顺序），其余按法术表顺序靠后 ──
export function rankCandidates(atoms: AtomSummary[], preferred: string[]): AtomSummary[] {
  const byId = new Map(atoms.map((a) => [a.id, a]))
  const head: AtomSummary[] = []
  for (const id of preferred) {
    const a = byId.get(id)
    if (a) head.push(a)
  }
  const headIds = new Set(head.map((a) => a.id))
  const tail = atoms.filter((a) => !headIds.has(a.id))
  // 法术表扩容后（29 原子），全量宣读会刷屏——封顶 8 个候选：偏好优先，其余按表序补齐
  return [...head, ...tail].slice(0, 8)
}

function parseChineseNumber(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  return digits[s] ?? NaN
}

// ── 选择解析：把「选3 / 3 / 我要归乡 / 第2个」解析成 atom id ──────────
export function resolveChoice(input: string, candidates: AtomSummary[]): string | null {
  const text = input.trim()
  if (!text) return null
  // 编号：优先「选N / 第N / 我要选N / 要选N」，其次整串纯数字或「N号/N个/N项」
  let m = text.match(/(?:选|第|我要选|要选)\s*([一二三四五六七八九十]|\d+)/)
  if (!m) m = text.match(/^\s*([一二三四五六七八九十]|\d+)\s*(?:个|号|项)?\s*$/)
  if (m) {
    const n = parseChineseNumber(m[1])
    if (Number.isInteger(n) && n >= 1 && n <= candidates.length) return candidates[n - 1].id
  }
  // 名称 / 咒语词匹配
  for (const c of candidates) {
    if (text.includes(c.name) || c.words.some((w) => text.includes(w))) return c.id
  }
  return null
}

// ── 女神台词（模板）───────────────────────────────────────────────────
function ritualTitle(t: Transmigrator | null, username: string): { title: string; subtitle: string } {
  const name = t?.name ?? username
  const epithet = t?.epithet?.trim() || '穿越者'
  return { title: '降临', subtitle: `${epithet} · ${name}` }
}

function ritualLines(t: Transmigrator | null, username: string, candidates: AtomSummary[]): string[] {
  const name = t?.name ?? username
  // 2026-08-22 造物主谕「公屏清净」：降临仪式从「欢迎+前世+逐条候选」的冗长宣读
  // 精简为两行公屏（欢迎 + 一行候选清单），不再逐条刷屏。候选名公屏可见（AI 与真人同通道），
  // 耗魔/门槛等细节由 /help 与私聊「问：」补足；前世背景已由 initNewcomer 的私聊带到，公屏不再重报。
  const names = candidates.map((c, i) => `${i + 1}.${c.name}`).join('／')
  return [
    `[女神] ${name}，欢迎降临此界。`,
    `[女神] 我赐你一项「出生天赋」——候选：${names}。喊「我选 <法术名>」或「选 <编号>」即告选定，细节可私聊问我。`,
  ]
}

export interface RitualDeps {
  getBot: () => Bot
  rcon: RconService
  magic: MagicService
  transmigrators: TransmigratorRegistry
}

export interface RitualHandle {
  dispose: () => void
}

/** 已脱 cordis 壳（2026-08-21）：bootstrap-world.mts 显式 createRitual(config, deps) 装配。 */
export function createRitual(config: Config, deps: RitualDeps): RitualHandle {
  const log = (msg: string) => console.log(`[mc-ritual] ${msg}`)
  const getBot = deps.getBot
  const rcon = deps.rcon
  const magic = deps.magic
  const transmigrators = deps.transmigrators
  const lc = createLifecycle()

  // 正在等待选择的穿越者：username -> { candidates, lastAnnounce }
  const pending = new Map<string, { candidates: AtomSummary[]; lastAnnounce: number }>()

  /** 公屏宣读（女神化身一句句说，AI 玩家靠聊天事件听见，真人看着屏幕读）。 */
  async function announce(username: string, t: Transmigrator | null, candidates: AtomSummary[]) {
    const bot = getBot()
    const { title, subtitle } = ritualTitle(t, username)
    const lines = ritualLines(t, username, candidates)
    try {
      // 大字标题给真人玩家的仪式感（AI 玩家看不见 title，靠公屏文本）。
      await rcon.send(`title ${username} title ${JSON.stringify({ text: title, color: 'gold', bold: true })}`)
      await rcon.send(`title ${username} subtitle ${JSON.stringify({ text: subtitle, color: 'yellow' })}`)
    } catch (err) {
      log(`title failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    for (const line of lines) {
      try {
        bot.chat(line)
      } catch (err) {
        log(`announce chat failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      // 逐句缓说：聊天限速防踢（vanilla 反刷屏在 ~5行/秒即踢，2026-08-17 双仪式并行实测被踢），
      // 也给仪式一点庄重感。
      await new Promise((r) => setTimeout(r, 700))
    }
  }

  // 仪式广播全局串行：多玩家同时降临时逐场宣读，避免公屏速率叠加被踢。
  let announceChain: Promise<void> = Promise.resolve()
  function announceQueued(username: string, t: Transmigrator | null, candidates: AtomSummary[]): Promise<void> {
    const run = announceChain.then(() => announce(username, t, candidates))
    announceChain = run.catch(() => { /* 单场失败不堵后续仪式 */ })
    return run
  }

  async function startRitual(username: string) {
    if (pending.has(username)) return
    const transmigrator = transmigrators.getByUsername(username)
    const preferred = transmigrator?.innate?.preferredAtoms ?? []
    const candidates = rankCandidates(magic.listAtoms(), preferred)
    // 背景故事落库（属性面板「前世」字段），仅首次
    if (transmigrator?.backstory && !magic.getBackstory(username)) {
      magic.setBackstory(username, transmigrator.backstory)
    }
    pending.set(username, { candidates, lastAnnounce: Date.now() })
    await announceQueued(username, transmigrator, candidates)
    log(`ritual started for ${username}: ${candidates.map((c) => c.id).join(',')}`)
  }

  async function commit(username: string, atomId: string, via: 'chat' | 'whisper' = 'chat'): Promise<string> {
    const atom = magic.getAtomById(atomId)
    magic.setInnate(username, atomId)
    pending.delete(username)
    const name = atom?.name ?? atomId
    const bot = getBot()
    try {
      // 确认跟随来源通道（2026-08-22）：
      // 公屏选 → 公屏确认（原文保留，必须点名 + 含「出生天赋「X」」，穿越者进程靠这个模式找回记忆）；
      // 私语选 → 私语确认（私聊对象就是本人，无需点名，但保留同一关键句供 mc-mystic parseInnate 捕获）。
      if (via === 'whisper') {
        bot.whisper(username, `[女神] 你的出生天赋「${name}」已镌入灵魂，永世不灭。`)
      } else {
        bot.chat(`[女神] ${username}，你的出生天赋「${name}」已镌入灵魂，永世不灭。`)
      }
    } catch (err) {
      log(`confirm failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    log(`ritual committed for ${username}: innateSkill=${atomId} (via ${via})`)
    return `你选择了「${name}」作为出生天赋，已永镌于灵魂。`
  }

  // ── 选择监听：公屏（bot.on('chat')）+ 私语（bot.on('whisper')）双通道 ──
  // 私语分流与 mc_pray「祈愿：」同姿势：只认 pending 中玩家的消息，
  // 未在等待选择者的私语（如 mc-mystic 失忆找回「我的出生天赋是什么？」）
  // 归 god-inbox 的 innate-memory 快捷应答，ritual 绝不抢答。
  function tryResolve(username: string, message: string, via: 'chat' | 'whisper'): boolean {
    const entry = pending.get(username)
    if (!entry) return false
    const msg = message.trim()
    const id = resolveChoice(msg, entry.candidates)
    if (id) {
      commit(username, id, via)
        .then(() => log(`player ${username} chose innate skill ${id} (via ${via})`))
        .catch((err) => log(`player choose error: ${err instanceof Error ? err.message : String(err)}`))
      return true
    }
    // 还没选定但开口问起（「有哪些」「再说一遍」「什么意思」…）→ 30s 冷却重宣读。
    if (/天赋|候选|法术|仪式|再说|重复|什么意思/.test(msg) && Date.now() - entry.lastAnnounce > 30_000) {
      entry.lastAnnounce = Date.now()
      const t = transmigrators.getByUsername(username)
      announceQueued(username, t, entry.candidates).catch(() => {})
    }
    return false
  }

  let watchedBot: Bot | null = null
  function ensureListeners(bot: Bot) {
    if (watchedBot === bot) return
    watchedBot = bot

    bot.on('chat', (username: string, message: string) => {
      if (username === bot.username) return
      tryResolve(username, message, 'chat')
    })

    bot.on('whisper', (username: string, message: string) => {
      if (username === bot.username) return
      tryResolve(username, message, 'whisper')
    })

    bot.on('playerJoined', (player) => {
      const username = player?.username
      if (!username) return
      if (username === bot.username) return // 女神自己不参加仪式
      if (magic.getInnate(username) !== null) return
      // 稍等几秒让客户端站稳，再开仪式。
      setTimeout(() => {
        if (magic.getInnate(username) === null) {
          startRitual(username).catch((err) => log(`player ritual error: ${err instanceof Error ? err.message : String(err)}`))
        }
      }, 5000)
    })
  }

  // 轮询：确保监听挂上（bot reconnect 会换实例）+ 为已在线但未选天赋的玩家补开仪式
  // （世界进程重启时 playerJoined 已错过，靠这里兜底）。
  let disposed = false
  let stopEnsure: (() => void) | null = null
  function scheduleEnsure() {
    if (disposed) return
    stopEnsure = lc.setTimeout(() => {
      const bot = getBot()
      if (bot) {
        ensureListeners(bot)
        if (bot.entity) {
          for (const username of Object.keys(bot.players)) {
            if (username === bot.username) continue
            if (pending.has(username)) continue
            if (magic.getInnate(username) !== null) continue
            startRitual(username).catch((err) => log(`ritual error: ${err instanceof Error ? err.message : String(err)}`))
          }
        }
      }
      scheduleEnsure()
    }, 5000)
  }
  scheduleEnsure()

  lc.onDispose(() => {
    disposed = true
    if (stopEnsure) stopEnsure()
    log('ritual disposed')
  })

  if (config.enabled) {
    log('ritual service armed (world-side, public-chat + whisper dual-channel protocol)')
  }

  return { dispose: () => lc.dispose() }
}
