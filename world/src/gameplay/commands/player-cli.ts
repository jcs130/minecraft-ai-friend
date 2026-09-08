// mc-cli.ts —— 千灯纪「世界 CLI」：把帮助/技能/状态等做成确定性、可执行、自描述的
// 命令行面，供 Agent（mineflayer 穿越者 / 假玩家亲卫 / AI 客户端）快速调用。
//
// CLI-Anything 哲学（对齐 docs/world-cli-手册.md）：
//   1. 命令树：/cli <verb> [args] [--json]，动词精确匹配，一条命令一个动作。
//   2. 自描述：/cli help 列全树；/cli help <verb> 看单命令用法（--help 等价）。
//   3. 确定性：同一命令+同一玩家状态 → 回执结构一致；不靠 LLM 猜语义。
//   4. 机器可读：--json 返回结构化 JSON（Agent 直接 parse），文本回执供人类看。
//
// 本模块只做「纯函数」：解析、帮助文本、数据塑形。**执行**由 mc-god.ts 的分发器
// 完成（cast/pray/ask/innate/appraise 都要用世界侧的真实执行点）。
import type { AtomSummary, MagicPlayerView } from '../magic/contracts.ts'

// ── 命令树定义 ─────────────────────────────────────────────────────────
export interface CliVerbMeta {
  id: string
  aliases?: string[]
  summary: string
  usage: string
  argDesc?: string
  json: boolean // 是否支持 --json 机器可读
}

/** 命令树（顺序即 help 展示顺序）。 */
export const CLI_VERBS: CliVerbMeta[] = [
  { id: 'commands', aliases: ['command', 'cmd', '命令'], summary: '列全部命令', usage: 'commands', json: true },
  { id: 'help', aliases: ['man', 'h', '?', '帮助'], summary: '上手帮助（可跟命令名）', usage: 'help [verb]', argDesc: 'verb：要查询的命令', json: true },
  { id: 'menu', aliases: ['wheel', '界面', '轮盘'], summary: '打开技能轮盘或铁魔法法术书', usage: 'menu [irons|waypoints|archive]', json: true },
  { id: 'status', aliases: ['me', 'who', 'whoami', '状态'], summary: '查自身状态', usage: 'status', json: true },
  { id: 'skills', aliases: ['known', 'learned', '技能'], summary: '列已学/可学技能', usage: 'skills', json: true },
  { id: 'spells', aliases: ['法术', '魔咒', 'magic'], summary: '查看原生铁魔法、特色秘术或旧档案', usage: 'spells [irons|legacy|archive] [页码]', json: true },
  { id: 'cast', aliases: ['chant', '施', '施法', '咏唱'], summary: '按技能 ID、名称或槽位施法', usage: 'cast <id|名称|1-8> [参数=值]', argDesc: '例：cast fireworks；cast 1；cast tp distance=5 direction=东。名字和咒语别名须精确匹配；自然咏唱私聊女神。', json: true },
  { id: 'cancel', aliases: ['停咒', '中断'], summary: '中断正在引导的铁魔法', usage: 'cancel', json: true },
  { id: 'staff-cast', summary: '言灵杖按键快捷施法（需要举杖手势）', usage: 'staff-cast <1-8>', json: true },
  { id: 'guardian-cast', aliases: ['gcast', '代施'], summary: '守护天使代主人施放已学技能', usage: 'guardian-cast <法术id>', argDesc: '法术id：主人已学法术（cli spells 查）；仅守护天使可用', json: true },
  { id: 'pray', aliases: ['wish', '祈愿'], summary: '祈愿上达天神（可带供奉）', usage: 'pray <愿望> [| 供奉：xxx]', argDesc: '供奉：面包x3 / 铁锭x1 等', json: true },
  { id: 'ask', aliases: ['question', '问'], summary: '咨询女神 / 查规则', usage: 'ask <问题>', argDesc: '问题：任何世界向问题', json: false },
  { id: 'chat', aliases: ['talk', '说', '聊', '对话'], summary: '与女神直接对话', usage: 'chat <话>', argDesc: '话：想对女神说的（提问/闲聊/求助都行）', json: false },
  { id: 'innate', aliases: ['天赋', 'talent'], summary: '查/选出生天赋', usage: 'innate [我的 | 我选 <法术名>]', argDesc: '我选 <法术名>：选天赋；默认查', json: true },
  { id: 'appraise', aliases: ['鉴定'], summary: '鉴定自身（法力/等阶/秘法）', usage: 'appraise', json: true },
  { id: 'discoveries', aliases: ['舆图', '发现点', 'discover'], summary: '探索者舆图：发现点一览/赐名', usage: 'discoveries [改名 <id> <新地名>]', argDesc: '改名：给发现点赐名', json: true },
  { id: 'summon', aliases: ['召唤', '传唤'], summary: '召唤术：把现有守卫召来相助（桐人/鸣人）', usage: 'summon <守卫名> <任务>', argDesc: '守卫名：桐人/鸣人；任务：让他干什么（如 帮我挖矿）', json: true },
  { id: 'cultivate', aliases: ['灌顶', '修行', '传功'], summary: '修行灌顶：给自己灌技艺经验（60秒一息）', usage: 'cultivate [类别]', argDesc: '类别：combat/mining 等，缺省 combat', json: true },
  { id: 'skillbar', aliases: ['技能栏', '法术栏'], summary: '技能栏：查看/配槽（数字键直放）', usage: 'skillbar [set <1-8> <法术名> | clear <槽> | auto]', argDesc: 'set：配槽；clear：清槽；auto：重置推荐栏', json: true },
  { id: 'bookget', aliases: ['领书', '取书'], summary: '领取技能书：已学法术随时领✦书（拿手上右键施法）', usage: 'bookget <法术名>', argDesc: '法术名：已学会的（如 螺旋丸）', json: false },
  { id: 'learn', aliases: ['参悟', '学会'], summary: '持书参悟：手拿✦技能书学会该法术（入命格书）', usage: 'learn <法术名>', argDesc: '法术名：书上写的名字；书必须在手', json: false },
  { id: 'goto', aliases: ['传送去', '去', '传送'], summary: '传送：按序号/名字去传送点（书页点行=同一事）', usage: 'goto <序号|完整名字|shared:id|personal:id>', argDesc: '优先使用固定编号；重名不会自动选择。服务器检查维度和安全落点。', json: true },
  { id: 'waypoint', aliases: ['传送点', '路标', '记点'], summary: '传送点簿：查列表 / 记 <名字> / 删 <序号>', usage: 'waypoint [list | add <名字> | remove <个人序号|personal:id>]', argDesc: 'add/记：保存当前维度和位置；remove/删：删除个人点。固定编号不会随排序漂移。', json: true },
  { id: 'growth', aliases: ['进度', '修为'], summary: '查修行进度（经验/点数）', usage: 'growth [类别]', argDesc: '类别：缺省 combat', json: true },
]

// ── 解析 ───────────────────────────────────────────────────────────────
export interface CliCommand {
  verb: string // 规范 verb id
  args: string[] // 剩余参数
  json: boolean
  wantHelp: boolean // 请求了该命令的帮助
  raw: string
  error?: string
}

/** Shared gate and normalization for explicit player/voice chanting. */
export function explicitChantBody(text: string): string | null {
  let body = text.trim()
  const chant = /^(?:咏唱|chant)(?:\s*[:：]\s*|\s+)/i
  const iron = /^铁魔法\s*[:：]\s*/
  if (!chant.test(body) && !iron.test(body)) return null
  body = body.replace(chant, '').trim()
  // Keep the engine prefix attached to the name so it cannot be mistaken for
  // an extra positional argument, or intercepted by a legacy name collision.
  return body.replace(iron, '铁魔法：')
}

/** Small command tokenizer: quoted argument values remain one argument. */
export function tokenizeCli(body: string): string[] {
  const tokens: string[] = []
  let token = '', quote = '', started = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && (body[i + 1] === quote || body[i + 1] === '\\') && quote) {
      token += body[++i]; started = true; continue
    }
    if (quote) {
      if (ch === quote) quote = ''
      else token += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch; started = true
    } else if (/\s/.test(ch)) {
      if (started) { tokens.push(token); token = ''; started = false }
    } else { token += ch; started = true }
  }
  if (quote) throw new Error('参数引号未闭合。')
  if (started) tokens.push(token)
  return tokens
}

export function canonicalVerb(tok: string): string | null {
  const t = tok.toLowerCase()
  for (const v of CLI_VERBS) {
    if (v.id === t || v.aliases?.some((a) => a.toLowerCase() === t)) return v.id
  }
  return null
}

/**
 * 解析一条消息为 CLI 命令。返回 null = 不是 CLI 命令（交由自然语言框架兜底）。
 * 支持两种入口：
 *   a. 显式前缀：`/cli <verb> ...`、`cli <verb> ...`、`!cli <verb> ...`
 *   b. 裸动词（仅白名单里的低冲突词，用于公屏/私聊直接打 `status`/`skills` 等）：
 *      由调用方（mc-god）在白名单内调用 parseCli，避免误吞自然语言。
 */
export function parseCli(
  text: string,
  bareWhitelist: string[] = [],
): CliCommand | null {
  const raw = text.trim()
  if (!raw) return null

  // 显式前缀剥离（2026-08-23 造物主谕「把 mycli 也加进聊天窗」）：
  // `cli`/`mycli`/`/cli`/`/mycli`/`!cli` 一律当 CLI 入口；`/mycli` 是 numen 注册的
  // 真命令，转发成 `/cli` 私语给女神，这里把它与裸 `cli` 一视同仁。
  const prefixed = raw.match(/^(\/?(?:mycli|cli)|!cli)\b[\s:]*/i)
  let body: string
  if (prefixed) {
    body = raw.slice(prefixed[0].length).trim()
  } else {
    return null // 非前缀一律不在此解析；裸动词由调用方裁剪后传 body
  }
  if (!body) return { verb: 'help', args: [], json: false, wantHelp: false, raw }
  let toks: string[]
  try { toks = tokenizeCli(body) }
  catch (e) { return { verb: 'invalid', args: [], json: /(?:^|\s)--json(?:\s|$)/.test(body), wantHelp: false, raw, error: String((e as Error).message) } }
  let json = false
  let wantHelp = false
  // Only flags may precede the verb. Never find an action hidden inside prose.
  while (['--json', '-j', '--help', '-h'].includes(toks[0])) {
    const flag = toks.shift()
    if (flag === '--json' || flag === '-j') json = true
    else wantHelp = true
  }
  const verb = canonicalVerb(toks.shift() ?? 'help')
  const args: string[] = []
  let literal = false
  for (const t of toks) {
    if (literal) { args.push(t); continue }
    if (t === '--') { literal = true; continue }
    if (t === '--json' || t === '-j') { json = true; continue }
    if (t === '--help' || t === '-h') { wantHelp = true; continue }
    args.push(t)
  }
  if (!verb) return { verb: 'invalid', args, json, wantHelp, raw, error: '未知命令。/mycli help 查看用法；聊天请用 /mycli chat <内容>。' }
  return { verb, args, json, wantHelp, raw }
}

/** 供裸动词入口（非 /cli 前缀，如私聊直接说 status）——只认白名单动词并返回命令。 */
export function parseBareCli(
  text: string,
  bareWhitelist: string[],
): CliCommand | null {
  const raw = text.trim()
  if (!raw) return null
  const toks = raw.split(/\s+/)
  const verb = canonicalVerb(toks[0] ?? '')
  if (!verb || !bareWhitelist.includes(verb)) return null
  const command = parseCli(`/mycli ${raw}`)!
  return { ...command, raw }
}

/** Shared cast argument parser, including the existing item-picker's positional form. */
export function parseCastInput(args: string[], atoms: AtomSummary[], bar: string[]):
  { ok: true; skill: string; slot?: number; params: Record<string, string | number> } |
  { ok: false; code: string; summary: string } {
  let skill = args[0]?.trim() ?? ''
  if (!skill) return { ok: false, code: 'usage', summary: '用法：/mycli cast <id|名称|1-8> [参数=值]。' }
  let slot: number | undefined
  if (/^\d+$/.test(skill)) {
    slot = Number(skill)
    if (!Number.isInteger(slot) || slot < 1 || slot > 8) return { ok: false, code: 'invalid_slot', summary: '技能槽位是 1–8。' }
    skill = bar[slot - 1] ?? ''
    if (!skill) return { ok: false, code: 'empty_slot', summary: `第 ${slot} 槽为空。/mycli skillbar auto 可恢复推荐栏。` }
  }
  const exact = atoms.find(a => a.id.toLowerCase() === skill.toLowerCase() || a.name === skill)
  const aliases = atoms.filter(a => a.words.some(word => word.toLowerCase() === skill.toLowerCase()))
  const atom = exact ?? (aliases.length === 1 ? aliases[0] : undefined)
  if (atom) skill = atom.id
  const params: Record<string, string | number> = Object.create(null)
  const positional: string[] = []
  for (const token of args.slice(1)) {
    const match = /^([a-zA-Z][a-zA-Z0-9_]*)=(.+)$/.exec(token)
    if (!match) { positional.push(token); continue }
    const [, key, value] = match
    if (key === 'constructor' || key === 'prototype' || Object.hasOwn(params, key)) return { ok: false, code: 'invalid_params', summary: `重复或无效参数：${key}。` }
    params[key] = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : value
  }
  if (positional.length) {
    if (skill === 'give' && positional.length <= 2 && !Object.hasOwn(params, 'item') && !Object.hasOwn(params, 'count')) {
      params.item = positional[0]
      if (positional[1]) params.count = Number(positional[1])
    } else return { ok: false, code: 'invalid_params', summary: '参数请写成 名称=值，例如 distance=5 direction=东。' }
  }
  return { ok: true, skill, ...(slot ? { slot } : {}), params }
}

// ── 自描述帮助 ──────────────────────────────────────────────────────────
export function cliOverview(): string[] {
  return [
    '【千灯纪 · 技能上手】',
    '选技能：右键技能罗盘 / F6；固定入口为铁魔法、特色秘术和传送阵。',
    '咏唱：/msg Goddess 咏唱：烟花术；铁魔法用 咏唱：铁魔法：装备法术名。',
    'Agent：/mycli cast irons_spellbooks:firebolt --json；停咒：/mycli cancel。',
    '查状态：/mycli status；法术：spells；秘术：spells legacy；档案：spells archive。',
    '传送：/mycli goto shared:1；记点：waypoint add 家；配槽：skillbar auto。',
    '详细用法：/mycli help cast；全部命令：/mycli commands。',
  ]
}

export function cliAllCommands(): string[] {
  return ['【完整命令表】/mycli <命令> [参数]', ...CLI_VERBS.map(v => `${v.usage} — ${v.summary}`)]
}

export function cliVerbHelp(verb: string): string[] {
  const v = CLI_VERBS.find((x) => x.id === verb)
  if (!v) return [`没有「${verb}」这条命令。cli commands 看全部命令。`]
  const lines = [
    `【cli ${v.id}】${v.summary}`,
    `  用法：/mycli ${v.usage}`,
  ]
  if (v.argDesc) lines.push(`  说明：${v.argDesc}`)
  if (v.json) lines.push(`  --json：返回机器可读结构化数据（Agent 用）`)
  if (v.aliases?.length) lines.push(`  别名：${v.aliases.join(' / ')}`)
  return lines
}

// ── 数据塑形（纯函数，供 mc-god 分发器调用）────────────────────────────────
/** status：把 MagicPlayerView + innate 组装成面板/JSON。 */
export function shapeStatus(view: MagicPlayerView, innateName: string | null): { panel: string; json: Record<string, unknown> } {
  const hp = view.hpRatio === null ? null : Math.round(view.hpRatio * 20)
  const food = view.foodRatio === null ? null : Math.round(view.foodRatio * 20)
  const json = {
    level: view.level,
    mana: Math.floor(view.mana),
    maxMana: view.maxMana,
    maxManaBonus: view.maxManaBonus,
    manaPerSec: view.manaPerSec,
    innate: innateName,
    learned: view.learned,
    passives: view.passives,
    hp,
    food,
    backstory: view.backstory,
  }
  const panel =
    `✦ 状态 · Lv.${view.level} ✦\n` +
    `魔力：${Math.floor(view.mana)}/${view.maxMana}${view.maxManaBonus > 0 ? `（含加持 +${view.maxManaBonus}）` : ''}\n` +
    `回蓝：${view.manaPerSec}点/秒\n` +
    `生命：${hp === null ? '未探明' : `${hp}/20`} ｜ 饱食：${food === null ? '未探明' : `${food}/20`}\n` +
    (innateName ? `出生天赋：${innateName}\n` : '') +
    (view.passives.length > 0 ? `稀有被动：${view.passives.join('、')}\n` : '') +
    `已学：${view.learned.length > 0 ? view.learned.join('、') : '尚无'}` +
    `（/${view.level} 级），/cli skills 看全表；/cli appraise 做深度鉴定。`
  return { panel, json }
}

/** skills：已学 + 当前等级可学（等级已到但未学/未掌握）。 */
export function shapeSkills(view: MagicPlayerView, atoms: AtomSummary[]): { panel: string; json: Record<string, unknown> } {
  const learned = atoms.filter((a) => view.learned.includes(a.id))
  const levelGate = atoms
    .filter((a) => a.requiredLevel <= view.level && !view.learned.includes(a.id))
    .sort((a, b) => (a.requiredLevel - b.requiredLevel) || a.id.localeCompare(b.id))
  const locked = atoms
    .filter((a) => a.requiredLevel > view.level)
    .sort((a, b) => (a.requiredLevel - b.requiredLevel) || a.id.localeCompare(b.id))
  const fmt = (a: AtomSummary) => `  ${a.name}(Lv${a.requiredLevel} ${a.cost.mana ? `${a.cost.mana}蓝` : '无蓝'})`
  const panel =
    `【技能】已学 ${learned.length} 项：\n` +
    (learned.map(fmt).join('\n') || '  （尚无法术）') +
    `\n本等级可学 ${levelGate.length} 项：\n` +
    (levelGate.map(fmt).join('\n') || '  （已全部掌握）') +
    `\n后续解锁：\n` +
    (locked.slice(0, 6).map(fmt).join('\n') || '  （已臻化境）')
  const json = {
    learned: learned.map((a) => ({ id: a.id, name: a.name, level: a.requiredLevel, mana: a.cost.mana })),
    levelGate: levelGate.map((a) => ({ id: a.id, name: a.name, level: a.requiredLevel, mana: a.cost.mana })),
    locked: locked.slice(0, 20).map((a) => ({ id: a.id, name: a.name, level: a.requiredLevel, mana: a.cost.mana })),
    playerLevel: view.level,
  }
  return { panel, json }
}

/** spells：全法术表（分页）。page 从 1 起。 */
export function shapeSpells(atoms: AtomSummary[], page = 1, perPage = 12, scope = 'legacy'): { panel: string; json: Record<string, unknown> } {
  const sorted = atoms.slice().sort((a, b) => (a.requiredLevel - b.requiredLevel) || a.id.localeCompare(b.id))
  const total = sorted.length
  const pages = Math.max(1, Math.ceil(total / perPage))
  const p = Math.min(Math.max(1, page), pages)
  const slice = sorted.slice((p - 1) * perPage, p * perPage)
  const panel =
    `【${scope === 'archive' ? '旧技能档案 · 不提供主动施放' : '特色秘术'} ${p}/${pages}】\n` +
    slice.map((a) => scope === 'archive' ? `  ${a.id}｜${a.name}：${a.catalog?.reason ?? '历史记录'}${a.catalog?.nativeHints?.length ? `；原生参考 ${a.catalog.nativeHints.join('、')}` : ''}` :
      `  ${a.id}｜${a.name}(Lv${a.requiredLevel} ${a.cost.mana ? `${a.cost.mana}秘术魔力` : '无魔力消耗'})`).join('\n') +
    (p < pages ? `\n下一页：/mycli spells ${scope} ${p + 1}` : '')
  const json = {
    page: p,
    pages,
    total,
    scope,
    atoms: slice.map((a) => ({ id: a.id, name: a.name, words: a.words.slice(0, 3), level: a.requiredLevel, cost: a.cost, type: a.type, params: a.params, icon: a.icon, catalog: a.catalog })),
  }
  return { panel, json }
}

/** innate：查/选天赋的面板/JSON。 */
export function shapeInnate(innateName: string | null): { panel: string; json: Record<string, unknown> } {
  const json = { innate: innateName, selected: !!innateName }
  const panel = innateName
    ? `出生天赋：${innateName}`
    : '你尚未选定出生天赋。仪式公屏正在宣读候选，喊「我选 <法术名>」或 /cli innate 我选 <法术名> 即可选定。'
  return { panel, json }
}

/** 给 mc-god 的分发器用：鉴定报告在 mc-magic 已有 buildAppraisalReport，这里只是 CLI 包装说明。 */
export function cliCastHint(): string {
  return 'cast 按技能 ID、名称或槽位施放，自付法力并校验等级和冷却；--json 返回真实结果。自然咏唱可私聊女神，祈愿另用 pray。'
}
