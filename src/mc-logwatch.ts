import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * mc-logwatch —— 世界侧日志尾随服务（仅世界进程加载）。
 *
 * 原版服把死亡/加入/成就等广播实时写进 logs/latest.log：
 * tail 这个文件 = 一个零依赖、零协议开销的「服务器事件流」。
 * 死亡守望从 20s 计分板轮询升级为「log 秒级触发 + 计分板复核」，
 * 编年史因此能记下轮询拿不到的死因与击杀者。
 *
 * 铁律：log 只是触发器（可能被重放/误报），计分板才是权威——
 * 消费方（mc-god）收到 death 事件后必须 RCON 复核 mcdeaths 再入册。
 */
export const name = 'mc-logwatch'
export const inject = ['timer']

export interface Config {
  enabled: boolean
  logPath: string
  pollMs: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  logPath: Schema.string().default('C:/Users/lzl19/Documents/airi-minecraft/server/logs/latest.log'),
  pollMs: Schema.number().default(500),
})

export type LogEventKind = 'death' | 'join' | 'leave' | 'advancement' | 'chat' | 'command'

export interface LogEvent {
  kind: LogEventKind
  player: string
  /** 去掉日志前缀后的广播正文 */
  text: string
  /** 死亡：死因短语（如 "was slain by Zombie"） */
  cause?: string
  /** 死亡：击杀者（best effort；冠词/武器从句已剥） */
  killer?: string
  /** 聊天/命令：正文 */
  message?: string
  /** 成就：标题原文 */
  title?: string
  /** 观察到该行的墙钟时间 */
  at: number
}

export type ParsedLine = Omit<LogEvent, 'at'>

// ── 解析层（纯函数，供离线单测）──────────────────────────────────────

/** vanilla 服务器日志行：`[12:34:56] [Server thread/INFO]: 正文` */
const LOG_LINE = /^\[\d{2}:\d{2}:\d{2}\]\s*\[[^\]]+\]:\s?(.*)$/
const PLAYER = /^[A-Za-z0-9_]{1,16}$/

/**
 * vanilla 英文死亡消息动词表。玩家前缀的广播里非 join/leave/advancement/command
 * 的行几乎只剩死亡，但保留白名单可挡住 "Preparing spawn area" 这类假玩家名前缀；
 * 漏报只是退回 20s 轮询路径，误报由计分板复核兜底。
 */
const DEATH_VERB = new RegExp(
  [
    'was (?:slain|shot|fireballed|stung|pricked|stabbed|skewered|squashed|pummeled|killed|smashed|blown up|imploded|obliterated|impaled|squished)',
    'was doomed to fall',
    'was shot off',
    'was blown off',
    'was struck by lightning',
    'was frozen to death',
    'was squashed by a falling',
    'was poked to death',
    'was burnt to a crisp',
    'withered away',
    'starved to death',
    'suffocated in',
    'fell from a high place',
    'fell off',
    'fell into',
    'fell too far and was finished',
    'fell out of the world',
    'hit the ground too hard',
    'blew up',
    'burned to death',
    'froze to death',
    'went up in flames',
    'walked into a',
    'tried to swim in lava',
    'discovered the floor was lava',
    'discovered it was a bad idea',
    'experienced kinetic energy',
    'removed an elytra while flying',
    "didn't want to live in the same world",
    'drowned',
    'died',
  ].join('|'),
)

/** 死因文本 → 击杀者（best effort）。"by X using [武器]" / "by X whilst ..." → X。 */
export function extractKiller(rest: string): string | undefined {
  const m = rest.match(/\bby\s+(.+)$/s)
  if (!m) return undefined
  let k = m[1]
  k = k.replace(/\s+(?:using|with)\s+.*$/s, '') // 武器从句
  k = k.replace(/\s+(?:whilst|while)\s+.*$/s, '') // 状语从句（其中的名字不是击杀者）
  k = k.replace(/^(?:a|an|the)\s+/i, '') // 生物名冠词
  k = k.trim()
  if (!k || /^(?:a|an|the)$/i.test(k)) return undefined // 裸冠词/空串：没有可读的击杀者
  return k.length <= 32 ? k : undefined
}

/** 解析一行服务器日志 → 结构化事件；非玩家广播返回 null。 */
export function parseLogLine(line: string): ParsedLine | null {
  const m = line.match(LOG_LINE)
  if (!m) return null
  const text = m[1]
  if (!text) return null

  // 聊天：<Name> message（含中文正文）
  const chat = text.match(/^<([A-Za-z0-9_]{1,16})> (.*)$/s)
  if (chat) return { kind: 'chat', player: chat[1], text, message: chat[2] }

  // 技术行（玩家名开头但不是广播事件）
  if (/^[A-Za-z0-9_]{1,16}\[[^\]]*\] logged in with entity id/.test(text)) return null
  if (/^[A-Za-z0-9_]{1,16} lost connection/.test(text)) return null
  if (/^[A-Za-z0-9_]{1,16} issued server command/.test(text)) {
    const cmd = text.match(/^([A-Za-z0-9_]{1,16}) issued server command: (.*)$/)
    if (cmd) return { kind: 'command', player: cmd[1], text, message: cmd[2] }
    return null
  }

  // 进出服（史官已有 mineflayer 通道，解析出来备用，消费方自行去重）
  const join = text.match(/^([A-Za-z0-9_]{1,16}) joined the game$/)
  if (join) return { kind: 'join', player: join[1], text }
  const leave = text.match(/^([A-Za-z0-9_]{1,16}) left the game$/)
  if (leave) return { kind: 'leave', player: leave[1], text }

  // 成就（mc-god 已有 advancements/<uuid>.json diff 通道，含 id/描述更全，此处备用）
  const adv = text.match(/^([A-Za-z0-9_]{1,16}) has (?:made the advancement|reached the goal|completed the challenge) \[(.+)\]$/)
  if (adv) return { kind: 'advancement', player: adv[1], text, title: adv[2] }

  // 死亡：玩家前缀 + 死亡动词
  const death = text.match(/^([A-Za-z0-9_]{1,16}) (.+)$/s)
  if (death && PLAYER.test(death[1]) && DEATH_VERB.test(death[2])) {
    return { kind: 'death', player: death[1], text, cause: death[2], killer: extractKiller(death[2]) }
  }
  return null
}

// ── 尾随层（可注入 setTimeout，离线单测友好）────────────────────────

export interface LogTailer {
  stop(): void
}

export interface TailerOptions {
  path: string
  pollMs: number
  /** 定时器源（世界进程里传 ctx.setTimeout；测试传裸 setTimeout） */
  setTimeout: (fn: () => void, ms: number) => () => void
  onLine: (line: string) => void
  /** 状态跃迁通知：watching=开始盯 / rotated=轮转重置 / missing=文件消失 */
  onState?: (state: 'watching' | 'rotated' | 'missing') => void
}

/**
 * 轮询式文件尾随：
 *   - 启动从 EOF 开始（历史行不重放——历史死亡由计分板轮询兜底，避免重启后重复入册）
 *   - 文件变短 = 服务器重启轮转（latest.log 每次开服重建）→ 从 0 重读
 *   - 文件消失 = 服务器停机 → 回到未初始化，文件再现时重新从 EOF 进入
 *   - 残行缓冲：跨写入边界的半行攒到下一次补齐
 */
export function createLogTailer(opts: TailerOptions): LogTailer {
  let stopped = false
  let cancel: (() => void) | null = null
  let pos = -1 // -1 = 未初始化
  let partial = ''
  let wasMissing = false

  function schedule() {
    if (stopped) return
    cancel = opts.setTimeout(poll, opts.pollMs)
  }

  function poll() {
    if (stopped) return
    try {
      const st = statSync(opts.path)
      if (pos === -1) {
        pos = st.size
        partial = ''
        wasMissing = false
        opts.onState?.('watching')
      } else if (st.size < pos) {
        pos = 0
        partial = ''
        opts.onState?.('rotated')
      }
      if (wasMissing) {
        wasMissing = false
        opts.onState?.('watching')
      }
      if (st.size > pos) {
        const fd = openSync(opts.path, 'r')
        try {
          const buf = Buffer.alloc(st.size - pos)
          readSync(fd, buf, 0, buf.length, pos)
          pos = st.size
          partial += buf.toString('utf8')
          const lines = partial.split('\n')
          partial = lines.pop() ?? ''
          for (const raw of lines) {
            const line = raw.replace(/\r$/, '')
            if (line) opts.onLine(line)
          }
        } finally {
          closeSync(fd)
        }
      }
    } catch {
      // 文件不存在/被锁：服务器停机或尚未开服，静默等待
      if (!wasMissing) {
        wasMissing = true
        opts.onState?.('missing')
      }
      pos = -1
      partial = ''
    }
    schedule()
  }

  schedule()
  return {
    stop() {
      stopped = true
      cancel?.()
    },
  }
}

// ── 服务装配 ─────────────────────────────────────────────────────────

export interface LogwatchService {
  /** 订阅事件流；返回退订函数。 */
  subscribe(fn: (ev: LogEvent) => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcLogwatch: LogwatchService
  }
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-logwatch] ${msg}`)
  const listeners = new Set<(ev: LogEvent) => void>()

  if (!config.enabled) {
    ctx.provide('mcLogwatch', { subscribe: () => () => {} })
    log('disabled by config')
    return
  }

  const tail = createLogTailer({
    path: resolve(config.logPath),
    pollMs: Math.max(100, config.pollMs),
    setTimeout: (fn, ms) => ctx.setTimeout(fn, ms),
    onLine: (line) => {
      const parsed = parseLogLine(line)
      if (!parsed) return
      const ev: LogEvent = { ...parsed, at: Date.now() }
      for (const fn of listeners) {
        try {
          fn(ev)
        } catch (err) {
          log(`listener failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    },
    onState: (state) => {
      if (state === 'watching') log(`tailing ${resolve(config.logPath)}`)
      else if (state === 'rotated') log('log rotated (server restarted?) — re-reading from start')
      else log('log file missing (server offline?) — waiting')
    },
  })

  ctx.provide('mcLogwatch', {
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  })
  ctx.effect(() => () => {
    tail.stop()
    log('disposed')
  })

  log(`armed (${Math.max(100, config.pollMs)}ms poll, ${resolve(config.logPath)})`)
}
