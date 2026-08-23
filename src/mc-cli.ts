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
import type { AtomSummary, MagicPlayerView } from './mc-magic.ts'

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
  { id: 'commands', aliases: ['command', 'cmd'], summary: '列全部命令', usage: 'commands', json: false },
  { id: 'help', aliases: ['man', 'h', '?'], summary: '命令帮助（可跟命令名）', usage: 'help [verb]', argDesc: 'verb：要查询的命令', json: false },
  { id: 'status', aliases: ['me', 'who', 'whoami'], summary: '查自身状态', usage: 'status', json: true },
  { id: 'skills', aliases: ['known', 'learned'], summary: '列已学/可学技能', usage: 'skills', json: true },
  { id: 'spells', aliases: ['法术', '魔咒', 'magic'], summary: '列全部法术表', usage: 'spells', json: true },
  { id: 'cast', aliases: ['chant', '施', '咏唱'], summary: '咏唱/施法（已学自施，神可代施）', usage: 'cast <咒语>', argDesc: '咒语：法术关键词（如 归乡/圣愈/照明）', json: true },
  { id: 'guardian-cast', aliases: ['gcast', '代施'], summary: '守护天使代主人施放已学技能', usage: 'guardian-cast <法术id>', argDesc: '法术id：主人已学法术（cli spells 查）；仅守护天使可用', json: true },
  { id: 'pray', aliases: ['wish', '祈愿'], summary: '祈愿上达天神（可带供奉）', usage: 'pray <愿望> [| 供奉：xxx]', argDesc: '供奉：面包x3 / 铁锭x1 等', json: true },
  { id: 'ask', aliases: ['question', '问'], summary: '咨询女神 / 查规则', usage: 'ask <问题>', argDesc: '问题：任何世界向问题', json: false },
  { id: 'chat', aliases: ['talk', '说', '聊', '对话'], summary: '与女神直接对话', usage: 'chat <话>', argDesc: '话：想对女神说的（提问/闲聊/求助都行）', json: false },
  { id: 'innate', aliases: ['天赋', 'talent'], summary: '查/选出生天赋', usage: 'innate [我的 | 我选 <法术名>]', argDesc: '我选 <法术名>：选天赋；默认查', json: true },
  { id: 'appraise', aliases: ['鉴定'], summary: '鉴定自身（法力/等阶/秘法）', usage: 'appraise', json: true },
  { id: 'summon', aliases: ['召唤', '传唤'], summary: '召唤术：把现有守卫召来相助（桐人/鸣人）', usage: 'summon <守卫名> <任务>', argDesc: '守卫名：桐人/鸣人；任务：让他干什么（如 帮我挖矿）', json: true },
]

// ── 解析 ───────────────────────────────────────────────────────────────
export interface CliCommand {
  verb: string // 规范 verb id
  args: string[] // 剩余参数
  json: boolean
  wantHelp: boolean // 请求了该命令的帮助
  raw: string
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
  if (!body) return { verb: 'commands', args: [], json: false, wantHelp: false, raw }

  const toks = body.split(/\s+/)
  let json = false
  let wantHelp = false

  // 第一个 token 若已是规范命令 → verb（这样 `help`/`commands` 等命令词不会被当 flag 吃掉）。
  // 否则扫描 flags，取第一个出现的命令词作 verb（兼容 `--json status` 这类写法）；
  // 若前缀之后并非已知命令词 → 整句当作「与女神对话」（chat）直接上达，不再判「非 CLI」
  // 让用户干瞪眼——`cli 给我个火把`、`mycli 铁在哪` 都能直接跟女神说话。
  let verb: string | null = canonicalVerb(toks[0] ?? '')
  let rest = toks.slice(1)
  if (!verb) {
    const chatWords: string[] = []
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (t === '--json' || t === '-j') { json = true; continue }
      if (t === '--help' || t === '-h') { wantHelp = true; continue }
      verb = canonicalVerb(t)
      if (verb) { rest = toks.slice(i + 1); break }
      chatWords.push(t)
    }
    if (!verb) {
      if (chatWords.length) return { verb: 'chat', args: [chatWords.join(' ')], json, wantHelp, raw }
      return { verb: 'commands', args: [], json, wantHelp, raw }
    }
  }

  // 剥离剩余参数里的 flags，其余保留为 args
  const args: string[] = []
  for (const t of rest) {
    if (t === '--json' || t === '-j') { json = true; continue }
    if (t === '--help' || t === '-h' || t === 'help') { wantHelp = true; continue }
    args.push(t)
  }
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
  let json = false, wantHelp = false
  const args: string[] = []
  for (const t of toks.slice(1)) {
    if (t === '--json' || t === '-j') { json = true; continue }
    if (t === '--help' || t === '-h' || t === 'help') { wantHelp = true; continue }
    args.push(t)
  }
  return { verb, args, json, wantHelp, raw }
}

// ── 自描述帮助 ──────────────────────────────────────────────────────────
export function cliOverview(): string[] {
  return [
    '【命令书】cli <命令> [参数] [--json]（mycli 同效）',
    ...CLI_VERBS.map((v) => `  ${v.usage.padEnd(28)}${v.summary}`),
    '',
    '例：cli status --json　　cli cast 归乡　　cli help cast',
    '真人玩家：聊天框直接打 cli 或 mycli 开头（别带斜杠 /），或打 /mycli、/myhelp 真命令；私聊女神 /msg Goddess cli xxx 也行。',
    'AI 玩家（读不了书）：/cli xxx 与 cli xxx、mycli xxx 同效。',
    '每条命令都可试 cli help <命令> 看用法（--help 也行）。',
    '前缀后面若不是命令词，就是直接跟女神说话（如 cli 铁在哪）。',
  ]
}

export function cliVerbHelp(verb: string): string[] {
  const v = CLI_VERBS.find((x) => x.id === verb)
  if (!v) return [`没有「${verb}」这条命令。cli commands 看全部命令。`]
  const lines = [
    `【cli ${v.id}】${v.summary}`,
    `  用法：cli ${v.usage}`,
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
export function shapeSpells(atoms: AtomSummary[], page = 1, perPage = 12): { panel: string; json: Record<string, unknown> } {
  const sorted = atoms.slice().sort((a, b) => (a.requiredLevel - b.requiredLevel) || a.id.localeCompare(b.id))
  const total = sorted.length
  const pages = Math.max(1, Math.ceil(total / perPage))
  const p = Math.min(Math.max(1, page), pages)
  const slice = sorted.slice((p - 1) * perPage, p * perPage)
  const panel =
    `【法术表 ${p}/${pages}】id｜名称(Lv 消耗)：\n` +
    slice.map((a) => `  ${a.id}｜${a.name}(Lv${a.requiredLevel} ${a.cost.mana ? `${a.cost.mana}蓝` : '无蓝'})`).join('\n') +
    (p < pages ? `\n下一页：/cli spells ${p + 1}` : '')
  const json = {
    page: p,
    pages,
    total,
    atoms: slice.map((a) => ({ id: a.id, name: a.name, words: a.words.slice(0, 3), level: a.requiredLevel, cost: a.cost })),
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
  return '本命令由守护之眼（世界侧）代施：已学=自施（扣魔力），未学=神裁。--json 只适合 status/skills/spells/innate 这类查询。'
}
