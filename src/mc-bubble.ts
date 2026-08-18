import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Bot } from 'mineflayer'
import type { RconService } from './mc-rcon.ts'

/**
 * mc-bubble —— 世界侧 3D 气泡引擎（2026-08-18）。
 *
 * 让「说话」从聊天栏里站起来，变成头顶的文字气泡：
 *   1. 玩家公屏说话 → 头顶气泡跟随（text_display + tp 循环，玩家不可被骑）
 *   2. NPC 引擎说话 → NPC 头顶气泡（读 npc-feed.jsonl 的 say 记录，骑乘 NPC 实体）
 *   3. NPC 头顶常驻任务状态行（今日委托摘要，60s 刷新，done 变绿）
 *
 * 通道设计：
 *   - 玩家气泡：世界进程 Goddess bot 的 chat 事件（能听见所有公屏）
 *   - NPC 气泡：轮询 sidecar mc_npc.py 的 data/npc-feed.jsonl（kind=say 记录
 *     自带 npcKey/npcPos/color/text）——mc_npc.py 零改动
 *   - 气泡实体生命周期全部 tag 管理：bub_p_<player> / bub_n_<npcKey> / stat_<npcKey>
 *
 * RCON 中文铁律：命令必须纯 ASCII，中文一律 \uXXXX 转义（mc_npc.py 同款 esc）。
 */
export const name = 'mc-bubble'

export const inject = ['mcbot', 'mcRcon', 'timer']

export interface Config {
  bubbleTtlMs: number
  followIntervalMs: number
  maxTextLen: number
  statRefreshMs: number
  feedPollMs: number
  perPlayerCooldownMs: number
}

export const Config: Schema<Config> = Schema.object({
  bubbleTtlMs: Schema.number().default(6500).description('气泡存活毫秒数'),
  followIntervalMs: Schema.number().default(900).description('玩家气泡跟随刷新间隔'),
  maxTextLen: Schema.number().default(80).description('气泡文本最大长度（超出截断）'),
  statRefreshMs: Schema.number().default(60000).description('NPC 任务状态行刷新间隔'),
  feedPollMs: Schema.number().default(500).description('npc-feed 轮询间隔'),
  perPlayerCooldownMs: Schema.number().default(900).description('同玩家气泡最小间隔（刷屏保护）'),
})

/** RCON 安全转义：仅保留可见 ASCII，中文/特殊字符 → \uXXXX */
function esc(t: string): string {
  let out = ''
  for (const ch of t) {
    const o = ord(ch)
    out += o >= 32 && o < 127 && ch !== '"' && ch !== '\\' ? ch : '\\u' + o.toString(16).padStart(4, '0')
  }
  return out
}
function ord(ch: string): number {
  return ch.codePointAt(0) ?? 63
}

/** 半透明黑底 (ARGB 0x80000100) */
const BG = -2147483392

interface FeedSay {
  kind: string
  npc?: string
  npcKey?: string
  npcPos?: [number, number, number] | null
  color?: string
  to?: string
  text?: string
  t?: number
}

interface Villager {
  key: string
  tag: string
  display: string
  color?: string
  spawn?: [number, number, number]
}

interface Quest {
  id: string
  villager: string
  display?: string
  zh?: string
  count?: number
  emerald?: number
  done?: boolean
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-bubble] ${msg}`)
  const rcon: RconService = ctx.mcRcon
  const getBot = (): Bot => ctx.mcbot

  const DATA = './data'
  const feedPath = resolve(DATA, 'npc-feed.jsonl')
  const villageDir = resolve(DATA, 'village')

  // ---------- 低层召唤 ----------
  const nbtOf = (tag: string, text: string, color: string, yOff: number, extra = '') =>
    `{Tags:["${tag}"],billboard:"center",text:{text:"${esc(text)}",color:"${color}"},background:${BG},`
    + `line_width:200,see_through:0b,transformation:{translation:[0.0f,${yOff.toFixed(2)}f,0.0f],`
    + `left_rotation:[0.0f,0.0f,0.0f,1.0f],right_rotation:[0.0f,0.0f,0.0f,1.0f],scale:[1.0f,1.0f,1.0f]}${extra}}`

  async function killTag(tag: string) {
    await rcon.send(`kill @e[tag=${tag}]`).catch(() => undefined)
  }

  /** 玩家气泡：玩家不可被骑 → 召唤后 tp 循环跟随 */
  async function playerBubble(player: string, text: string) {
    const tag = `bub_p_${player}`
    const cut = text.length > config.maxTextLen ? text.slice(0, config.maxTextLen) + '…' : text
    await killTag(tag)
    const bot = getBot()
    const ep = bot.players[player]?.entity?.position
    const px = ep ? ep.x.toFixed(1) : '-109'
    const py = ep ? (ep.y + 1).toFixed(1) : '70'
    const pz = ep ? ep.z.toFixed(1) : '147'
    await rcon.send(`summon minecraft:text_display ${px} ${py} ${pz} ${nbtOf(tag, cut, 'white', 2.4)}`).catch(() => undefined)
    const deadline = Date.now() + config.bubbleTtlMs
    const timer = ctx.setInterval(() => {
      void (async () => {
        if (Date.now() > deadline) {
          timer.dispose?.()
          await killTag(tag)
          return
        }
        await rcon.send(`execute at ${player} run tp @e[tag=${tag},limit=1] ~ ~2.4 ~`).catch(() => undefined)
      })()
    }, config.followIntervalMs)
  }

  /** NPC 气泡：骑乘 NPC 实体（tag 定位），8s 消散 */
  async function npcBubble(npcKey: string, npcTag: string, text: string, color: string, npcPos?: [number, number, number] | null) {
    const tag = `bub_n_${npcKey}`
    const cut = text.length > config.maxTextLen ? text.slice(0, config.maxTextLen) + '…' : text
    await killTag(tag)
    const x = npcPos?.[0]?.toFixed(1) ?? '-109'
    const y = npcPos ? (npcPos[1] + 1).toFixed(1) : '70'
    const z = npcPos?.[2]?.toFixed(1) ?? '147'
    await rcon.send(`summon minecraft:text_display ${x} ${y} ${z} ${nbtOf(tag, cut, color || 'white', 0.9)}`).catch(() => undefined)
    await rcon.send(`ride @e[tag=${tag},limit=1] mount @e[tag=${npcTag},limit=1]`).catch(() => undefined)
    ctx.setTimeout(() => void killTag(tag), config.bubbleTtlMs + 1500)
  }

  // ---------- 玩家公屏 → 气泡 ----------
  let watchedBot: Bot | null = null
  const lastBubble = new Map<string, number>()
  function ensureChatListener(bot: Bot) {
    if (watchedBot === bot) return
    watchedBot = bot
    bot.on('chat', (username: string, message: string) => {
      if (username === bot.username) return
      const now = Date.now()
      if (now - (lastBubble.get(username) ?? 0) < config.perPlayerCooldownMs) return
      lastBubble.set(username, now)
      void playerBubble(username, message)
    })
    log('chat listener armed (player bubbles)')
  }

  // ---------- NPC feed 轮询 → NPC 气泡 ----------
  let feedOffset = 0
  let feedSize = 0
  function pollFeed() {
    try {
      const st = statSync(feedPath)
      if (st.size < feedSize) {
        feedOffset = 0 // rotation：文件被截断重写
        feedSize = st.size
        return
      }
      if (st.size <= feedOffset) return
      const fd = openSync(feedPath, 'r')
      const len = st.size - feedOffset
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, feedOffset)
      closeSync(fd)
      feedOffset = st.size
      feedSize = st.size
      for (const line of buf.toString('utf-8').split('\n')) {
        if (!line.trim()) continue
        let rec: FeedSay
        try {
          rec = JSON.parse(line)
        } catch {
          continue
        }
        if (rec.kind !== 'say' || !rec.npcKey) continue
        const v = villagers.find((x) => x.key === rec.npcKey)
        if (!v) continue
        void npcBubble(v.key, v.tag, rec.text ?? '', rec.color ?? v.color ?? 'white', rec.npcPos ?? v.spawn ?? null)
      }
    } catch {
      // feed 尚未生成等场景：静默
    }
  }

  // ---------- NPC 任务状态行（常驻，骑乘 NPC） ----------
  let villagers: Villager[] = []
  function loadVillagers() {
    try {
      const raw = JSON.parse(readFileSync(resolve(villageDir, 'villagers.json'), 'utf-8'))
      const list = Array.isArray(raw) ? raw : raw?.villagers
      villagers = Array.isArray(list) ? list : []
    } catch {
      villagers = []
    }
  }

  function questsToday(): Quest[] {
    try {
      const d = new Date()
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const raw = JSON.parse(readFileSync(resolve(villageDir, `quests-${day}.json`), 'utf-8'))
      return Array.isArray(raw?.quests) ? raw.quests : []
    } catch {
      return []
    }
  }

  async function refreshStatLines() {
    const quests = questsToday()
    for (const v of villagers) {
      const tag = `stat_${v.key}`
      const q = quests.find((x) => x.villager === v.key)
      let text: string
      let color: string
      if (!q) {
        text = '· 今日无委托 ·'
        color = 'gray'
      } else if (q.done) {
        text = `今日委托已完成（${q.done_by ?? '?'}）`
        color = 'green'
      } else {
        text = `今日委托：${q.zh ?? q.item}×${q.count} → ${q.emerald ?? 0}绿宝石`
        color = 'gold'
      }
      const want = esc(text)
      try {
        const out = await rcon.send(`data get entity @e[tag=${tag},limit=1] text`)
        if (!out || out.includes('No entity was found')) {
          await rcon.send(`summon minecraft:text_display -109 70 147 ${nbtOf(tag, text, color, 0.35, ',text_opacity:100')}`)
          await rcon.send(`ride @e[tag=${tag},limit=1] mount @e[tag=${v.tag},limit=1]`)
        } else {
          await rcon.send(`data merge entity @e[tag=${tag},limit=1] {text:{text:"${want}",color:"${color}"}}`)
        }
      } catch {
        // 单个 NPC 失败不中断其余
      }
    }
  }

  // ---------- 入服欢迎（playerEnter → 女神问候） ----------
  const welcomed = new Set<string>()
  let joinedBot: Bot | null = null
  function ensureJoinListener(bot: Bot) {
    if (joinedBot === bot) return
    joinedBot = bot
    bot.on('playerEnter', (player: { username?: string } | string) => {
      const name = typeof player === 'string' ? player : player?.username ?? ''
      if (!name || name === bot.username) return
      if (welcomed.has(name) || welcomeFailed.has(name)) return
      log(`playerEnter: ${name}`)
      welcomed.add(name)
      void goddessWelcome(name)
    })
  }
  /** 轮询兜底：不依赖 playerEnter 事件（spectator 下可能不触发），diff bot.players */
  function pollWelcome(bot: Bot) {
    try {
      for (const name of Object.keys(bot.players)) {
        if (name === bot.username || welcomed.has(name) || welcomeFailed.has(name)) continue
        log(`pollWelcome found: ${name}`)
        welcomed.add(name)
        void goddessWelcome(name)
      }
    } catch {
      // players 未就绪
    }
  }
  const welcomeFailed = new Set<string>()
  /** 带重试的 rcon 发送（世界进程起跑时 rcon 懒连接可能未就绪） */
  async function rsend(cmd: string): Promise<string> {
    let lastErr: unknown = null
    for (let i = 0; i < 3; i++) {
      try {
        return await rcon.send(cmd)
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 2500))
      }
    }
    throw lastErr
  }
  /** 女神欢迎：title 大字 + tellraw 图文介绍（点击可直接填好施法命令） */
  async function goddessWelcome(player: string) {
    try {
      const title = esc(JSON.stringify({ text: '初始之地', color: 'gold', bold: true }))
      const subtitle = esc(JSON.stringify({ text: '✦ 女神守望 · AI 穿越者小镇 ✦', color: 'yellow' }))
      await rsend(`title ${player} title ${title}`)
      await rsend(`title ${player} subtitle ${subtitle}`)
      const lines = [
        { text: '✦ 女神低语 ✦', color: 'gold', bold: true },
        { text: `欢迎来到初始之地，远方的旅人 ${player}。`, color: 'white' },
        { text: '  这是 AI 穿越者与真人共玩的小镇。', color: 'gray' },
        { text: '  · 施法：', color: 'gray',
          extra: [{ text: '/msg Goddess <咒语>', color: 'yellow', clickEvent: { action: 'suggest_command', value: '/msg Goddess ' }, hoverEvent: { action: 'show_text', contents: '点这里直接填好命令，例如：火焰箭' } }] },
        { text: '  · 祈愿：公屏说「祈愿：…」可问女神任何问题', color: 'gray' },
        { text: '  · 委托：看 NPC 头顶状态气泡，每日委托等你', color: 'gray' },
        { text: '  · 居民：桐人、鸣人是 AI 玩家，欢迎对话', color: 'gray' },
        { text: '  祝旅途愉快。 —— 女神', color: 'dark_gray' },
      ]
      for (const line of lines) {
        await rsend(`tellraw ${player} ${esc(JSON.stringify(line))}`)
        await new Promise((r) => setTimeout(r, 120))
      }
      log(`welcome -> ${player}`)
    } catch (e) {
      welcomeFailed.add(player)
      log(`welcome FAILED for ${player}: ${e}`)
    }
  }

  // ---------- 生命周期 ----------
  loadVillagers()
  ctx.setInterval(() => {
    try {
      ensureChatListener(getBot())
      ensureJoinListener(getBot())
      pollWelcome(getBot())
    } catch {
      // bot 未就绪
    }
    pollFeed()
  }, config.feedPollMs)
  ctx.setInterval(() => {
    loadVillagers()
    void refreshStatLines()
  }, config.statRefreshMs)
  // 启动后稍等 NPC 看护召唤完成再画状态行
  ctx.setTimeout(() => void refreshStatLines(), 12000)
  log(`up: ttl=${config.bubbleTtlMs}ms follow=${config.followIntervalMs}ms npcs=${villagers.length}`)
}
