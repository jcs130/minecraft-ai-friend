/**
 * mc-diary —— 穿越者日记档案馆（世界侧，2026-08-17）。
 *
 * 设计定调（扛枪）：简单点——**降临时就给一本书，能看也能记**。
 *   1. 降临送礼：第一次出现在世界的人（AI/真人平权）收到一本
 *      「初始之地手记」= 女神欢迎信 + 使用说明 + 已有日记（新人为空白）
 *   2. 记：私聊「/msg Goddess 日记：<内容>」→ world.db diary 表落库
 *      （每人每天一篇）→ 自动重新装订递新册子
 *   3. 看：私聊「日记本」（可带游戏ID翻别人的）→ 领最近几篇的合订册
 *   4. 全量档案真源在 world.db；书只是当日快照（RCON 4KB 上限装不下全本）
 *
 * AI 穿越者的「翻书」（2026-08-17 扛枪定调：书=数据库的渲染层）：
 *   AI 没有眼睛与 GUI——它的「点击使用书」= 私聊女神「日记本」，
 *   女神不给它书（占背包无意义），直接把 diary 表内容以私聊文本回给它。
 *   同一个库，两种渲染：真人收 written_book，AI 收聊天文本。
 *
 * 穿越者侧由 mc-evolve 在入睡时以人格口吻撰写并通过同款协议递入。
 *
 * RCON 铁律：vanilla 单命令 ~4KB 上限（实测 14KB 拒收），且中文经
 * \uXXXX 转义后每字 6 字节——成书页数由 buildBook() 按字节预算自适应。
 * 给书失败仅降级（回话告知档案馆复印机故障），绝不影响日记落库。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Bot } from 'mineflayer'
import type { DiaryRow } from './mc-worlddb.ts'

export const name = 'mc-diary'
export const inject = ['mcbot', 'mcRcon', 'mcWorlddb', 'mcTransmigrators', 'timer']

export interface Config {
  enabled: boolean
  /** 合订册收录最近几篇（字节预算内自适应，可能少于该值）。 */
  bookEntries: number
  /** 单页截断长度（书页视觉友好上限）。 */
  pageChars: number
  /** 日记落库后自动把「当日册」递到作者手上。 */
  autoGive: boolean
  /** 档案馆讲台坐标 "x y z"（空 = 不建讲台）。每次新日记自动换成最新一篇。 */
  lecternPos: string
  /** 讲台朝向 north/south/east/west。 */
  lecternFacing: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  bookEntries: Schema.number().default(3),
  pageChars: Schema.number().default(200),
  autoGive: Schema.boolean().default(true),
  lecternPos: Schema.string().default(''),
  lecternFacing: Schema.string().default('north'),
})

/** SNBT 引号字符串转义（中文转义由 mcRcon.send 的 toAscii 统一做）。 */
function snbtStr(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/** toAscii 之后这条命令大约多少字节（中文按 \uXXXX 6 字节计）。 */
function asciiBytes(s: string): number {
  let n = 0
  for (const ch of s) n += ch.charCodeAt(0) > 0x7e || ch.charCodeAt(0) < 0x20 ? 6 : 1
  return n
}

/** 单篇日记 → 一页文本。 */
function entryPage(e: DiaryRow, pageChars: number): string {
  const head = `■ ${e.day}${e.gameDay != null ? `（世界第${e.gameDay}天）` : ''}`
  const body = e.content.length > pageChars ? e.content.slice(0, pageChars - 1) + '…' : e.content
  return `${head}\n${body}`
}

/** RCON 单命令安全预算（<4096 实测上限，留头部余量）。 */
const CMD_BUDGET = 3400

/** 欢迎册固定前两页（2026-08-17 扛枪定调：降临时就给一本，能看也能记）。 */
function welcomePages(owner: string): string[] {
  return [
    `《初始之地手记》\n\n致 ${owner}：\n\n欢迎来到这个世界。这本册子随你同行——往后你写下的每一篇日记，档案馆都会替你装订成册，永远不丢。`,
    `【怎么记日记】\n\n睡前或任何时刻，悄悄告诉女神：\n/msg Goddess 日记：<今天想记下的事>\n\n一天一篇；写完档案馆会递上新装订的册子。`,
  ]
}

/**
 * 组装 give 命令：欢迎页 + 各篇一页。从最新往回收，超出字节预算即止。
 * 返回 null = 一页都放不下（防兜底）。
 */
function buildBookCmd(to: string, owner: string, entries: DiaryRow[], pageChars: number): string | null {
  const pages: string[] = welcomePages(owner).map((p) => `{raw:${snbtStr(p)}}`)
  const used = entries.slice().reverse() // 旧 → 新，翻开即顺读
  const total = used.length
  pages.push(`{raw:${snbtStr(total > 0 ? `——我的日记（最近 ${total} 篇）——` : '——我的日记（还是空白的第一页）——')}}`)
  for (const e of used) {
    const p = `{raw:${snbtStr(entryPage(e, pageChars))}}`
    const cmd = `give ${to} minecraft:written_book[written_book_content={title:${snbtStr(`${owner}的手记`)},author:${snbtStr(owner)},pages:[${pages.join(',')},${p}]}] 1`
    if (asciiBytes(cmd) > CMD_BUDGET) break
    pages.push(p)
  }
  return `give ${to} minecraft:written_book[written_book_content={title:${snbtStr(`${owner}的手记`)},author:${snbtStr(owner)},pages:[${pages.join(',')}]}] 1`
}

function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-diary] ${msg}`)
  if (!config.enabled) {
    log('disabled')
    return
  }

  const getBot = (): Bot | undefined => ctx.mcbot as Bot | undefined

  /** 穿越者注册表（世界进程装配 mc-transmigrator）。 */
  const findRegistry = (): { getByUsername(u: string): unknown } | null => {
    const r = (ctx as unknown as { mcTransmigrators?: { getByUsername(u: string): unknown } }).mcTransmigrators
    return r && typeof r.getByUsername === 'function' ? r : null
  }

  const isTransmigrator = (username: string): boolean => {
    try { return findRegistry()?.getByUsername(username) != null } catch { return false }
  }

  /** AI 穿越者的「翻书」：diary 表 → 私聊文本（每条 ≤240 字符，逐篇递送）。 */
  async function reciteDiary(bot: Bot, to: string, owner: string): Promise<void> {
    const entries = ctx.mcWorlddb.diaryList(owner, config.bookEntries)
    const say = (m: string) => { try { bot.whisper(to, m) } catch { /* not ready */ } }
    if (entries.length === 0) {
      say(`[档案馆] ${owner} 还没有日记。想看谁的就「日记本 <游戏ID>」。`)
      return
    }
    say(`[档案馆] ${owner} 的手记，最近 ${entries.length} 篇（旧→新）：`)
    for (const e of entries.slice().reverse()) {
      const head = `■ ${e.day}`
      const room = 230 - head.length
      const body = e.content.length > room ? e.content.slice(0, Math.max(1, room - 1)) + '…' : e.content
      say(`${head} ${body}`)
    }
  }

  async function giveBook(bot: Bot, to: string, owner: string): Promise<string> {
    const entries = ctx.mcWorlddb.diaryList(owner, config.bookEntries)
    if (entries.length === 0) return `${owner} 还没写过日记（每晚睡前写一篇，档案馆见）。`
    const cmd = buildBookCmd(to, owner, entries, config.pageChars)
    if (!cmd) return '这一篇太长了，档案馆的装订机装不下（请联系服主）。'
    try {
      const out = await ctx.mcRcon.send(cmd)
      if (/gave|given/i.test(out)) return `ok:${entries.length}`
      log(`give book unexpected rcon reply: ${out.slice(0, 80)}`)
      return `档案馆的复印机好像坏了（${out.slice(0, 40)}），日记本身已收好，稍后再试试「日记本」。`
    } catch (err) {
      log(`give book failed: ${err instanceof Error ? err.message : String(err)}`)
      return '档案馆的复印机坏了（给书失败），日记本身已收好，稍后再试试「日记本」。'
    }
  }

  async function updateLectern(): Promise<void> {
    if (!config.lecternPos.trim()) return
    const [x, y, z] = config.lecternPos.trim().split(/[\s,]+/).map(Number)
    if (![x, y, z].every((n) => Number.isFinite(n))) {
      log(`bad lecternPos "${config.lecternPos}" — skip`)
      return
    }
    const latest = ctx.mcWorlddb.diaryList(null, 1)[0]
    if (!latest) return
    const page = `【城镇日记】\n${latest.day} · ${latest.username}\n\n${latest.content.slice(0, config.pageChars)}`
    const bookNbt = `{id:"minecraft:written_book",count:1,components:{"minecraft:written_book_content":{title:${snbtStr('城镇日记')},author:${snbtStr(latest.username)},pages:[{raw:${snbtStr(page)}}]}}}`
    try {
      await ctx.mcRcon.send(`setblock ${x} ${y} ${z} minecraft:lectern[facing=${config.lecternFacing}] replace`)
      await ctx.mcRcon.send(`data modify block ${x} ${y} ${z} Book set value ${bookNbt}`)
    } catch (err) {
      log(`lectern update failed (degraded): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleSubmit(bot: Bot, username: string, raw: string): Promise<void> {
    const content = raw.trim().slice(0, 600)
    if (!content) {
      try { bot.whisper(username, '[信使] 日记内容是空的。写法：/msg Goddess 日记：<今天想记下的事>') } catch { /* not ready */ }
      return
    }
    const day = localDay()
    const gameDay = (bot as unknown as { time?: { day?: number } }).time?.day ?? null
    const ok = ctx.mcWorlddb.diaryAdd(username, day, content, gameDay)
    if (!ok) {
      try { bot.whisper(username, `[信使] ${username}，今天这篇已经记过啦。想重读就说「日记本」。`) } catch { /* not ready */ }
      return
    }
    const no = ctx.mcWorlddb.diaryCount(username)
    ctx.mcWorlddb.chronicleRecord('diary', username, { day, no, chars: content.length })
    log(`${username} diary #${no} (${day}, ${content.length} chars) stored`)
    let tail = ''
    if (config.autoGive && !isTransmigrator(username)) {
      const r = await giveBook(bot, username, username)
      if (r.startsWith('ok:')) tail = '，日记本已递到手上'
    }
    try { bot.whisper(username, `[信使] 第 ${no} 篇日记已收入档案馆（${day}）${tail}。`) } catch { /* not ready */ }
    void updateLectern()
  }

  async function handleBook(bot: Bot, username: string, arg: string): Promise<void> {
    const owner = arg.trim() || username
    // AI 穿越者：不占背包，直接把数据库内容以文本回给它（它的感官=聊天流）
    if (isTransmigrator(username)) {
      await reciteDiary(bot, username, owner)
      log(`recited ${owner}'s diary to transmigrator ${username} (text, no book)`)
      return
    }
    const r = await giveBook(bot, username, owner)
    if (r.startsWith('ok:')) {
      log(`gave ${username} a diary book of ${owner} (${r.slice(3)} entries)`)
      return
    }
    try { bot.whisper(username, `[信使] ${r}`) } catch { /* not ready */ }
  }

  /**
   * 降临送礼：第一次出现在这个世界的人（AI 穿越者或真人，平权）。
   * 真人 → 女神递上一本「初始之地手记」（欢迎信+用法+已有日记）。
   * AI 穿越者 → 不占背包，私聊一段欢迎（它的书=数据库，用法照说）。
   * 去重靠 world.db diary_gift 表（diaryGiftMark 首次返回 true）。
   */
  async function giftWelcome(bot: Bot, username: string): Promise<void> {
    if (!ctx.mcWorlddb.diaryGiftMark(username)) return
    if (isTransmigrator(username)) {
      try {
        bot.whisper(username, `[档案馆] ${username}，欢迎来到这个世界。这里有一座日记档案馆：想记就说「日记：<内容>」，想翻看就说「日记本」（也可带别人的游戏ID）。你的每一篇都会被装订收藏，永不遗失。`)
        ctx.mcWorlddb.chronicleRecord('diary', username, { event: 'gift-text', day: localDay() })
        log(`welcome text sent to transmigrator ${username}`)
      } catch { /* not ready */ }
      return
    }
    const entries = ctx.mcWorlddb.diaryList(username, config.bookEntries)
    const cmd = buildBookCmd(username, username, entries, config.pageChars)
    if (!cmd) return
    try {
      const out = await ctx.mcRcon.send(cmd)
      if (/gave|given/i.test(out)) {
        ctx.mcWorlddb.chronicleRecord('diary', username, { event: 'gift', day: localDay() })
        log(`welcome book gifted to ${username}`)
      } else {
        log(`welcome book give unexpected reply: ${out.slice(0, 60)}`)
      }
    } catch (err) {
      log(`welcome book failed for ${username}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 女神化身就位后挂 whisper + playerJoin（同 mc-social 的轮询确保模式）──
  let watchedBot: Bot | null = null
  function ensureAvatar(bot: Bot) {
    if (watchedBot === bot) return
    watchedBot = bot
    bot.on('whisper', (username: string, message: string) => {
      if (username === bot.username) return
      const t = message.trim()
      if (t.startsWith('日记：') || t.startsWith('日记:')) {
        handleSubmit(bot, username, t.replace(/^日记[：:]/, '')).catch((err) => log(`diary submit failed: ${err instanceof Error ? err.message : String(err)}`))
      } else if (t === '日记本' || t.startsWith('日记本 ') || t.startsWith('日记本:')) {
        handleBook(bot, username, t.replace(/^日记本[\s:：]?/, '')).catch((err) => log(`diary book failed: ${err instanceof Error ? err.message : String(err)}`))
      }
    })
    // 新面孔降临 → 稍等实体稳定再送礼（give 对刚连接玩家偶发 No player was found）
    bot.on('playerJoined', (player) => {
      const name = (player as unknown as { username?: string }).username ?? String(player)
      if (!name || name === bot.username) return
      setTimeout(() => { void giftWelcome(bot, name) }, 5_000)
    })
    // 世界进程（重新）启动时已在线的玩家不会再触发 playerJoin → 补扫送礼
    for (const name of Object.keys(bot.players ?? {})) {
      if (name && name !== bot.username) void giftWelcome(bot, name)
    }
    log(`diary archive armed (bookEntries=${config.bookEntries}, lectern=${config.lecternPos || 'off'})`)
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
    log('diary disposed')
  })
}
