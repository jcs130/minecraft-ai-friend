import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Bot } from 'mineflayer'
import type { RconService } from './mc-rcon.ts'
import type { SpawnPoint } from './mc-rcon.ts'
import type { WorlddbService } from './mc-worlddb.ts'
import type { Transmigrator } from './mc-transmigrator.ts'

/**
 * mc-social —— 女神传声 & 信使（世界侧社交层，2026-08-17）。
 *
 * 【信使】世界里的独立角色（2026-08-17 扛枪定调）：一切「明确的送信的活」
 * 归信使，私聊频道（[信使] 前缀 whisper）送达，女神不再事事公屏喊话——
 * 公屏只留给世界级大事（法则修订/天平昭告/降临仪式），人多了也不乱。
 * 信使的差事：书信投递、好友传话、说话转达、施法回执、成长通告（觉醒/
 * 成就/升级/被动）。女神专注裁决/守望/史官三职与神谕。
 *
 * 原版 MC 聊天是全服广播，没有"离得远听不见"。本插件在世界进程里
 * 模拟出空间感（对 AI 严格、对真人宽容）：
 *
 *   说话三档（AI 经 /msg Goddess 递话，真人公屏喊话同权）：
 *     说 <台词>    → 48 格内可闻（默认）
 *     喊 <台词>    → 96 格内可闻 + 消耗 1 点饱食度（费嗓子）
 *     悄悄 <台词>  → 6 格内可闻（耳语）
 *   女神按说话者位置筛选听众：附近真人 tellraw 转达、附近 AI 私聊转达；
 *   远处的人游戏内听不到。私语/神谕/公告/咏唱不受距离限制（心音通道）。
 *   所有话语进编年史——世界记录一切，凡人只听近处。
 *
 *   书信（好友制，不限距离）：
 *     /mail send <名> <正文>   仅好友可寄（防骚扰）；≤200 字；收件箱 50 封
 *     /mail read | list | clear
 *     /friend add|accept|remove|list <名>   双向确认才能结交
 *   在线即时投递（私聊），离线落库等上线提醒（60s 冷却防轰炸）。
 *   AI 穿越者经 mc_chat/mc_mail 工具走完全相同的通道——机制平权。
 *
 * 命令入口统一在女神私聊（/msg Goddess ...），以 / 开头；
 * mc-god 的祈愿处理器对 / 开头消息让行（见 mc-god.ts）。
 */
export const name = 'mc-social'
export const inject = ['mcbot', 'mcRcon', 'mcWorlddb', 'mcTransmigrators', 'timer']

export interface Config {
  enabled: boolean
  /** 数值配置文件（可选）：存在则覆盖下方默认值，方便服主不改代码调参数。 */
  socialPath: string
  /** 说：普通话语可闻半径（格） */
  sayRadius: number
  /** 喊：大声喊话可闻半径（格） */
  shoutRadius: number
  /** 悄悄话可闻半径（格） */
  whisperRadius: number
  /** 喊话消耗的饱食度（点）。0 = 免费 */
  shoutFoodCost: number
  /** 玩家位置缓存 TTL（ms）——连续转达不重复 RCON 查询 */
  posCacheMs: number
  /** 邮件正文上限（字） */
  mailMaxBody: number
  /** 每人收件箱上限（封，含已读） */
  mailInboxCap: number
  /** 每人每分钟最多寄信（封）——AI 与真人统一限频 */
  mailPerMinute: number
  /** 上线未读提醒冷却（秒），防 join 抖动刷屏 */
  remindCooldownSec: number
  /** 一次 /mail read 最多吐几封（防刷屏） */
  mailReadBatch: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  socialPath: Schema.string().default('./data/social.json'),
  sayRadius: Schema.number().default(48),
  shoutRadius: Schema.number().default(96),
  whisperRadius: Schema.number().default(6),
  shoutFoodCost: Schema.number().default(1),
  posCacheMs: Schema.number().default(5_000),
  mailMaxBody: Schema.number().default(200),
  mailInboxCap: Schema.number().default(50),
  mailPerMinute: Schema.number().default(10),
  remindCooldownSec: Schema.number().default(60),
  mailReadBatch: Schema.number().default(5),
})

// ── 纯函数（单测见 test-social.mts）────────────────────────────────────

export type VoiceMode = 'say' | 'shout' | 'whisper'

/** 解析「说/喊/悄悄/say/shout/whisper <台词>」递话协议。 */
export function parseVoice(message: string): { mode: VoiceMode; text: string } | null {
  const m = message.trim().match(/^(说|喊|悄悄|说：|喊：|悄悄：|say|shout|whisper)[\s:：]+(.+)$/i)
  if (!m) return null
  const head = m[1].toLowerCase().replace(/[：:]/g, '')
  const mode: VoiceMode = head === '喊' || head === 'shout' ? 'shout'
    : head === '悄悄' || head === 'whisper' ? 'whisper' : 'say'
  return { mode, text: m[2].trim() }
}

/** 真人公屏喊话识别：「喊：xxx」「喊 xxx」「！！！xxx」（至少两个全角/半角感叹号开头）。 */
export function matchShout(message: string): string | null {
  const t = message.trim()
  const m1 = t.match(/^喊[\s:：]+(.+)$/)
  if (m1) return m1[1].trim()
  const m2 = t.match(/^[!！]{2,}\s*(.+)$/)
  if (m2) return m2[1].trim()
  return null
}

export function dist3d(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

/** 三档可闻半径查表。 */
export function radiusFor(mode: VoiceMode, cfg: { sayRadius: number; shoutRadius: number; whisperRadius: number }): number {
  return mode === 'shout' ? cfg.shoutRadius : mode === 'whisper' ? cfg.whisperRadius : cfg.sayRadius
}

/** 滑动窗口限频器（寄信限频用）。 */
export class RateLimiter {
  private readonly hits: number[] = []
  constructor(private readonly max: number, private readonly windowMs: number) {}
  allow(now = Date.now()): boolean {
    while (this.hits.length > 0 && now - this.hits[0] > this.windowMs) this.hits.shift()
    if (this.hits.length >= this.max) return false
    this.hits.push(now)
    return true
  }
  retryInSec(now = Date.now()): number {
    if (this.hits.length === 0) return 0
    const oldest = this.hits[0]
    return Math.max(0, Math.ceil((this.windowMs - (now - oldest)) / 1000))
  }
}

export type SocialCommand =
  | { kind: 'mail-send'; to: string; body: string }
  | { kind: 'mail-read' } | { kind: 'mail-list' } | { kind: 'mail-clear' }
  | { kind: 'friend-add'; to: string }
  | { kind: 'friend-accept'; to: string }
  | { kind: 'friend-remove'; to: string }
  | { kind: 'friend-list' }

/** 解析 /mail 与 /friend 命令（女神私聊通道）。 */
export function parseSocialCommand(message: string): SocialCommand | null {
  const t = message.trim()
  const m = t.match(/^\/(mail|friend)\s*([\s\S]*)$/i)
  if (!m) return null
  const cmd = m[1].toLowerCase()
  const rest = m[2].trim()
  if (cmd === 'mail') {
    const send = rest.match(/^send\s+(\S+)\s+([\s\S]+)$/i)
    if (send) return { kind: 'mail-send', to: send[1], body: send[2].trim() }
    if (/^read$/i.test(rest)) return { kind: 'mail-read' }
    if (/^list$/i.test(rest)) return { kind: 'mail-list' }
    if (/^clear$/i.test(rest)) return { kind: 'mail-clear' }
    return null
  }
  const add = rest.match(/^(add|邀请)\s+(\S+)$/i)
  if (add) return { kind: 'friend-add', to: add[2] }
  const acc = rest.match(/^(accept|答应)\s+(\S+)$/i)
  if (acc) return { kind: 'friend-accept', to: acc[2] }
  const rm = rest.match(/^(remove|删|删除)\s+(\S+)$/i)
  if (rm) return { kind: 'friend-remove', to: rm[2] }
  if (/^list$/i.test(rest) || rest === '') return { kind: 'friend-list' }
  return null
}

/** 转达文案（tellraw / whisper 共用）：按档位配不同颜色与措辞。 */
export function voiceLine(speakerName: string, mode: VoiceMode, text: string): { text: string; color: string; italic: boolean } {
  if (mode === 'shout') return { text: `[${speakerName}] 喊道：${text}`, color: 'gold', italic: false }
  if (mode === 'whisper') return { text: `[${speakerName}] 低语：${text}`, color: 'gray', italic: true }
  return { text: `[${speakerName}] ${text}`, color: 'white', italic: false }
}

// ── 插件主体 ──────────────────────────────────────────────────────────

interface ResolvedConfig extends Config {}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-social] ${msg}`)
  // data/social.json 覆盖层：服主改数值不动代码
  const cfg: ResolvedConfig = { ...config }
  try {
    const p = resolve(config.socialPath)
    if (existsSync(p)) {
      const over = JSON.parse(readFileSync(p, 'utf-8')) as Partial<Config>
      Object.assign(cfg, over)
      log(`config overrides loaded from ${config.socialPath}`)
    }
  } catch (err) {
    log(`social.json parse failed, using defaults: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!cfg.enabled) {
    log('disabled')
    return
  }

  const worlddb = ctx.mcWorlddb
  const rcon: RconService = ctx.mcRcon
  const getBot = (): Bot | null => (ctx.mcbot as Bot | undefined) ?? null

  const displayName = (username: string): string => {
    const t: Transmigrator | null = ctx.mcTransmigrators.getByUsername(username)
    return t?.name ?? username
  }
  /** AI 穿越者名单（转达时用私聊，而不是 tellraw）。 */
  const isTransmigrator = (username: string): boolean => !!ctx.mcTransmigrators.getByUsername(username)

  // 位置缓存：speaker/听众位置统一 5s TTL，转达风暴不打爆 RCON
  const posCache = new Map<string, { at: number; pos: SpawnPoint | null }>()
  async function getPosCached(username: string): Promise<SpawnPoint | null> {
    const hit = posCache.get(username)
    if (hit && Date.now() - hit.at < cfg.posCacheMs) return hit.pos
    const pos = await rcon.getPos(username).catch(() => null)
    posCache.set(username, { at: Date.now(), pos })
    return pos
  }

  /** 在线玩家名单（mineflayer bot.players；含真人与 AI，排除女神自己）。 */
  function onlinePlayers(bot: Bot): string[] {
    return Object.keys(bot.players).filter((n) => n !== bot.username)
  }

  // ── 传声：把一句话转达给半径内的听众 ────────────────────────────────
  async function relayVoice(speaker: string, mode: VoiceMode, text: string): Promise<void> {
    const bot = getBot()
    if (!bot) return
    const speakerPos = await getPosCached(speaker)
    if (!speakerPos) {
      try { bot.whisper(speaker, `[女神] 女神看不见你的身影（服务器未上报坐标），话没能传出去。`) } catch { /* not ready */ }
      return
    }
    // 喊话费嗓子：扣饱食度（1.21+ 玩家 NBT 锁 → hunger 效果兜底，同 mc-magic 炼食）
    if (mode === 'shout' && cfg.shoutFoodCost > 0) {
      const secs = Math.max(1, Math.round(cfg.shoutFoodCost))
      await rcon.send(`effect give ${speaker} minecraft:hunger ${secs} 39 true`).catch(() => null)
    }
    const radius = radiusFor(mode, cfg)
    const heard: string[] = []
    const speakerName = displayName(speaker)
    const line = voiceLine(speakerName, mode, text)
    for (const target of onlinePlayers(bot)) {
      if (target === speaker) continue
      const tp = await getPosCached(target)
      if (!tp || dist3d(speakerPos, tp) > radius) continue
      heard.push(target)
      if (isTransmigrator(target)) {
        try { bot.whisper(target, `[转达] ${line.text}`) } catch { /* not ready */ }
      } else {
        await rcon.send(`tellraw ${target} ${JSON.stringify({ text: line.text, color: line.color, italic: line.italic })}`).catch(() => null)
      }
    }
    // 编年史：世界记录一切（面板全量可见），凡人只听近处
    worlddb.chronicleRecord('say', speaker, { mode, text: text.slice(0, 120), radius, heard })
    // 回执给说话者（AI 工具等这个判断成败）
    const via = heard.length > 0
      ? `已传出：${heard.length} 位同伴在 ${radius} 格内听见了你（${heard.map(displayName).join('、')}）`
      : `四下无人——${radius} 格内没有耳朵，你的话消散在风里`
    try { bot.whisper(speaker, `[传声] ${via}`) } catch { /* not ready */ }
    log(`voice ${mode} by ${speaker}: ${heard.length} heard`)
  }

  // ── 信使：邮件 + 好友 ────────────────────────────────────────────────
  const mailLimit = new Map<string, RateLimiter>()
  const limiterFor = (u: string): RateLimiter => {
    let l = mailLimit.get(u)
    if (!l) { l = new RateLimiter(cfg.mailPerMinute, 60_000); mailLimit.set(u, l) }
    return l
  }
  const remindAt = new Map<string, number>()

  function reply(bot: Bot, to: string, text: string) {
    try { bot.whisper(to, `[信使] ${text}`) } catch { /* not ready */ }
  }

  async function handleSocial(bot: Bot, from: string, cmd: SocialCommand): Promise<void> {
    switch (cmd.kind) {
      case 'mail-send': {
        if (cmd.to === from) return reply(bot, from, '不能给自己写信。')
        if (cmd.to === bot.username) return reply(bot, from, '女神只送信，不收信——想许愿直接对我说即可。')
        if (cmd.body.length > cfg.mailMaxBody) return reply(bot, from, `信太长了（${cmd.body.length} 字 > 上限 ${cfg.mailMaxBody} 字），长话短说。`)
        if (!ctx.mcTransmigrators.getByUsername(cmd.to) && !(cmd.to in bot.players)) {
          return reply(bot, from, `此界没有叫「${cmd.to}」的居民（名字要写游戏 ID，如 Kirito / Naruto / MengMeng）。`)
        }
        if (!worlddb.areFriends(from, cmd.to)) {
          const pending = worlddb.friendPendingFor(cmd.to)
          const asked = pending.includes(from)
          return reply(bot, from, asked
            ? `你和 ${displayName(cmd.to)} 还不是好友（请求已送达，等对方答应）。只有好友才能写信。`
            : `你和 ${displayName(cmd.to)} 还不是好友，先 /friend add ${cmd.to}，对方答应后即可写信。`)
        }
        if (!limiterFor(from).allow()) return reply(bot, from, `寄信太频繁（上限 ${cfg.mailPerMinute} 封/分钟），${limiterFor(from).retryInSec()} 秒后再试。`)
        const inboxCount = worlddb.mailInboxCount(cmd.to)
        if (inboxCount >= cfg.mailInboxCap) return reply(bot, from, `${displayName(cmd.to)} 的信箱满了（${cfg.mailInboxCap} 封），等他清一清吧。`)
        const r = worlddb.mailPush(from, cmd.to, cmd.body)
        worlddb.chronicleRecord('mail', from, { to: cmd.to, body: cmd.body.slice(0, 80), id: r.id })
        // 在线即时投递；离线等上线提醒
        if (cmd.to in bot.players) {
          const unread = worlddb.mailUnreadCount(cmd.to)
          reply(bot, cmd.to, `${displayName(from)} 来信：${cmd.body}`)
          if (unread > 1) reply(bot, cmd.to, `（你还有 ${unread} 封未读，/msg Goddess /mail read 查看）`)
        }
        reply(bot, from, `信已送入 ${displayName(cmd.to)} 的信箱（${cmd.to in bot.players ? '已当面递到' : '他现在不在此界，回来时会收到提醒'}）。`)
        log(`mail #${r.id} ${from} -> ${cmd.to}`)
        return
      }
      case 'mail-read': {
        const unread = worlddb.mailUnread(from)
        if (unread.length === 0) return reply(bot, from, '没有未读信件。')
        const batch = unread.slice(0, cfg.mailReadBatch)
        worlddb.mailMarkRead(from, batch.map((m) => m.id))
        // 逐封缓发：/msg 也计入 vanilla 反刷屏计数（2026-08-17 女神被踢教训）。
        for (const m of batch) {
          await new Promise((r) => setTimeout(r, 350))
          reply(bot, from, `${displayName(m.from)}（${new Date(m.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}）：${m.body}`)
        }
        await new Promise((r) => setTimeout(r, 350))
        const rest = unread.length - batch.length
        reply(bot, from, `已读 ${batch.length} 封${rest > 0 ? `，还有 ${rest} 封未读（再执行一次 /mail read 继续）` : '，全部读完'}。`)
        return
      }
      case 'mail-list': {
        const recent = worlddb.mailRecent(from, 10)
        if (recent.length === 0) return reply(bot, from, '信箱是空的。')
        reply(bot, from, `最近 ${recent.length} 封：` + recent.map((m) => `${m.readAt ? '' : '【未读】'}${displayName(m.from)}：${m.body.slice(0, 24)}${m.body.length > 24 ? '…' : ''}`).join('｜'))
        return
      }
      case 'mail-clear': {
        const n = worlddb.mailClear(from)
        return reply(bot, from, `信箱已清空（${n} 封）。`)
      }
      case 'friend-add': {
        if (cmd.to === from) return reply(bot, from, '和自己做朋友……虽然自恋，但不行。')
        if (cmd.to === bot.username) return reply(bot, from, '女神与众生同在，不必特意结交。')
        if (!ctx.mcTransmigrators.getByUsername(cmd.to) && !(cmd.to in bot.players)) {
          return reply(bot, from, `此界没有叫「${cmd.to}」的居民（名字要写游戏 ID）。`)
        }
        const r = worlddb.friendRequestAdd(from, cmd.to)
        if (!r.ok) return reply(bot, from, r.reason ?? '请求未能送出。')
        worlddb.chronicleRecord('friend', from, { to: cmd.to, event: 'request' })
        reply(bot, from, `好友请求已送给 ${displayName(cmd.to)}。`)
        if (cmd.to in bot.players) {
          reply(bot, cmd.to, `${displayName(from)} 想与你结为好友。答应请回：/msg Goddess /friend accept ${from}`)
        }
        log(`friend request ${from} -> ${cmd.to}`)
        return
      }
      case 'friend-accept': {
        const ok = worlddb.friendAccept(from, cmd.to)
        if (!ok) return reply(bot, from, `没有找到 ${displayName(cmd.to)} 的好友请求（可能已处理或过期）。`)
        worlddb.chronicleRecord('friend', from, { to: cmd.to, event: 'accept' })
        reply(bot, from, `你与 ${displayName(cmd.to)} 结为好友，现在可以互相写信了（/mail send ${cmd.to} 内容）。`)
        if (cmd.to in bot.players) {
          reply(bot, cmd.to, `${displayName(from)} 答应了你的好友请求，现在可以互相写信了。`)
        }
        log(`friend accepted: ${from} <-> ${cmd.to}`)
        return
      }
      case 'friend-remove': {
        const ok = worlddb.friendRemove(from, cmd.to)
        return reply(bot, from, ok ? `已与 ${displayName(cmd.to)} 解除好友（信件记录保留）。` : `你与 ${displayName(cmd.to)} 本来就不是好友。`)
      }
      case 'friend-list': {
        const friends = worlddb.friendList(from)
        const pending = worlddb.friendPendingFor(from)
        const parts: string[] = []
        parts.push(friends.length > 0 ? `好友：${friends.map((f) => `${displayName(f)}(${f})`).join('、')}` : '还没有好友（/friend add <游戏ID> 结交）')
        if (pending.length > 0) parts.push(`待你答复：${pending.map((f) => `${displayName(f)}(${f})`).join('、')} → /friend accept <游戏ID>`)
        return reply(bot, from, parts.join('；'))
      }
    }
  }

  // ── 上线提醒（未读邮件 + 好友请求）──────────────────────────────────
  function remindOnJoin(bot: Bot, username: string) {
    const now = Date.now()
    const last = remindAt.get(username) ?? 0
    if (now - last < cfg.remindCooldownSec * 1000) return
    remindAt.set(username, now)
    const unread = worlddb.mailUnreadCount(username)
    const pending = worlddb.friendPendingFor(username)
    const parts: string[] = []
    if (unread > 0) {
      const latest = worlddb.mailLatestSender(username)
      parts.push(`你有 ${unread} 封未读信件${latest ? `（最新来自 ${displayName(latest)}）` : ''}：/msg Goddess /mail read`)
    }
    if (pending.length > 0) parts.push(`${pending.map(displayName).join('、')} 请求与你结为好友：/msg Goddess /friend accept <游戏ID>`)
    if (parts.length === 0) return
    setTimeout(() => reply(bot, username, parts.join('；')), 3_000) // 等客户端 chat 就绪
  }

  // ── 事件挂载：女神化身就位后挂 whisper / chat / join ─────────────────
  let watchedBot: Bot | null = null
  function ensureAvatar(bot: Bot) {
    if (watchedBot === bot) return
    watchedBot = bot
    // 私聊命令：/mail、/friend、说/喊/悄悄递话（穿越者 mc_chat/mc_mail 走这里）
    bot.on('whisper', (username: string, message: string) => {
      if (username === bot.username) return
      const t = message.trim()
      // 1) 斜杠命令：信使事务
      const social = parseSocialCommand(t)
      if (social) {
        handleSocial(bot, username, social).catch((err) => log(`social cmd failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
        return
      }
      // 2) 递话协议：说/喊/悄悄 <台词>
      const voice = parseVoice(t)
      if (voice) {
        relayVoice(username, voice.mode, voice.text).catch((err) => log(`relay failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
        return
      }
      // 其余私聊不是本插件的事（祈愿走 mc-god）
    })
    // 公屏喊话（真人与 AI 平权）：「喊：xxx」/「!!!xxx」→ 96 格转达 + 费嗓子
    bot.on('chat', (username: string, message: string) => {
      if (username === bot.username) return
      const shout = matchShout(message)
      if (shout) {
        relayVoice(username, 'shout', shout).catch((err) => log(`shout relay failed for ${username}: ${err instanceof Error ? err.message : String(err)}`))
      }
    })
    // 上线提醒
    bot.on('playerJoined', (player) => {
      const username = typeof player === 'string' ? player : player.username
      if (username === bot.username) return
      remindOnJoin(bot, username)
    })
    log('goddess social channels armed (voice relay + mail + friends)')
  }

  let stopped = false
  const stopWatch = ctx.setInterval(() => {
    if (stopped) return
    const bot = getBot()
    if (bot) ensureAvatar(bot)
  }, 5_000)
  {
    const bot = getBot()
    if (bot) ensureAvatar(bot)
  }

  ctx.effect(() => () => {
    stopped = true
    stopWatch()
    log('social disposed')
  })
}
