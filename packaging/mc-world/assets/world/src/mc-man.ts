// mc-man.ts — 世界操作手册（/help CLI + 白纸冷启动引导）
// ────────────────────────────────────────────────────────────────────
// 设计铁律（2026-08-20 造物主谕）：
//   1. 零 LLM：全部纯查表（magic-atoms 经 ctx.mcMagic.listAtoms()、
//      供奉词典 OFFERING_ITEMS、造物 GIVE_WHITELIST），毫秒级回复。
//   2. 白纸假设：新入服的 Agent 一无所知。冷启动只给三行话，字要少，
//      其余一切靠 /help 自取。
//   3. CLI 风格：/help [主题]，主题支持中文与英文别名，可分页。
//   4. 回复走私语（bot.whisper），不刷公屏；每行 ≤ 60 字符。
//
// 接线：mc-god.ts 的 whisper/chat 两个入口在分流最前处调用
//   handleHelpText()；playerJoined 里对名册外新面孔调 welcomeLines()。

import { OFFERING_ITEMS } from './mc-offering.ts'
import { GIVE_WHITELIST, type MagicService } from './mc-magic.ts'

/** 单条回复行宽上限（中文计） */
const LINE_MAX = 60

const wrap = (s: string): string[] => {
  if (s.length <= LINE_MAX) return [s]
  const out: string[] = []
  let cur = ''
  for (const ch of s) {
    cur += ch
    if (cur.length >= LINE_MAX) { out.push(cur); cur = '' }
  }
  if (cur) out.push(cur)
  return out
}

/** 识别 /help 与 /h（带参或不带参）。其他斜杠命令返回 false（归信使）。 */
export function isHelpCommand(text: string): boolean {
  const t = text.trim()
  return t === '/help' || t === '/h' || t.startsWith('/help ') || t.startsWith('/h ')
}

/** 冷启动引导：三行话，白纸能照着活过第一夜。 */
export function welcomeLines(name: string): string[] {
  return [
    `旅人 ${name}，欢迎降临千灯界。你有手、有嘴、有一条命——先活下来。`,
    `对世界任何聊天框说 /help 可随时查阅生存手册（咒语/供奉/祈愿/变强）。`,
    `遇到危险就 /msg Goddess 喊「祈愿：……」；想问世界之事就说「问：……」。`,
  ]
}

/** 成本速记：魔力/饱食/生命 */
const costText = (c: { mana: number; food: number; hp: number }): string => {
  const parts: string[] = []
  if (c.mana) parts.push(`魔力${Math.abs(c.mana)}`)
  if (c.food) parts.push(`饱食${Math.abs(c.food)}`)
  if (c.hp) parts.push(`生命${Math.abs(c.hp)}`)
  return parts.join(' ') || '无消耗'
}

/** 处理一条 /help 命令，返回回复行数组；null = 不是 help 命令。
 *  已脱 cordis 壳（2026-08-21）：ctx 依赖改为显式传入 magic（仅用 listAtoms）。
 */
export function handleHelpText(text: string, magic: Pick<MagicService, 'listAtoms'>): string[] | null {
  if (!isHelpCommand(text)) return null
  const raw = text.trim().replace(/^\/(help|h)\s*/, '').trim()
  const [topicArg, ...rest] = raw ? raw.split(/\s+/) : []
  const arg2 = rest.join(' ')
  const topic = (topicArg ?? '').toLowerCase()

  // ── /help：总览 ──────────────────────────────────────────────
  if (!topic) {
    return [
      '【千灯界·生存手册】/help <主题> 查询，主题：',
      '新手 | 咒语 [页/名] | 变强 | 供奉 | 祈愿 | 问 | 造物 | 频道',
      '例：/help 咒语　/help 咒语 2　/help 咒语 回家　/help 新手',
    ]
  }

  // ── 新手（白纸三步）────────────────────────────────────────
  if (topic === '新手' || topic === 'start') {
    return [
      '第一步·活：徒手撸树→做工作台→木镐挖石→石制工具→日落前造个土屋避怪。',
      '第二步·术：/help 咒语 看你当前等级能念什么；私聊女神念咒即施法。',
      '第三步·路：危险喊「祈愿：…」、疑问说「问：…」、交易对村民说「交易：…」。',
      '记住：/help 随身携带，死了也别慌——/help 变强 会告诉你代价。',
    ]
  }

  // ── 咒语（分页目录 / 单条详情）──────────────────────────────
  if (topic === '咒语' || topic === 'spells' || topic === '法术') {
    const atoms = magic.listAtoms().slice().sort((a, b) => (a.requiredLevel - b.requiredLevel) || a.id.localeCompare(b.id))
    if (arg2 && !/^\d+$/.test(arg2)) {
      // 单条详情：中文名 / id / 咒语词 模糊匹配
      const q = arg2.toLowerCase()
      const hit = atoms.find((a) => a.name === arg2 || a.id.toLowerCase() === q)
        ?? atoms.find((a) => a.words.some((w) => w.toLowerCase() === q))
        ?? atoms.find((a) => a.name.includes(arg2) || a.words.some((w) => w.includes(arg2)))
      if (!hit) return [`没有叫「${arg2}」的技艺。/help 咒语 看全目录。`]
      return [
        `【${hit.name}】需等级 Lv${hit.requiredLevel}｜消耗：${costText(hit.cost)}`,
        `咏唱：私聊女神说「${hit.words[0]}」（${hit.words.slice(0, 3).join(' / ')}）`,
      ]
    }
    const PAGE = 10
    const page = Math.max(1, Math.min(9, arg2 ? parseInt(arg2, 10) || 1 : 1))
    const pages = Math.ceil(atoms.length / PAGE)
    const slice = atoms.slice((page - 1) * PAGE, page * PAGE)
    return [
      `【咒语目录 ${page}/${pages}】名字(Lv 魔力)｜/help 咒语 <名> 看详情`,
      ...slice.map((a) => `${a.name}(Lv${a.requiredLevel} ${a.cost.mana ? a.cost.mana + '蓝' : '无蓝'})`),
      page < pages ? `下一页：/help 咒语 ${page + 1}` : '已到底。等级不够的技艺念了也不灵。',
    ]
  }

  // ── 变强（成长路径）────────────────────────────────────────
  if (topic === '变强' || topic === '成长' || topic === 'grow') {
    return [
      '等级：吃经验（挖矿/杀怪/熔炼）升 XpLevel；魔力上限=100+12×(Lv−1)。',
      '技艺三解锁通道：①等级到了自动会（/help 咒语 看门槛）',
      '②历练成就解锁（做没做过的事）③天神恩授（祈愿求艺，看诚意）。',
      '「鉴定」可审视己身；念咒带血祭/饱食消耗会返经验，苦修亦是一条路。',
    ]
  }

  // ── 供奉 / 祈愿 / 问 / 造物 / 频道 ─────────────────────────
  if (topic === '供奉' || topic === 'offer' || topic === 'offering') {
    const names = Object.keys(OFFERING_ITEMS).join('、')
    return [
      '【供奉】求大术时附上：/msg Goddess 祈愿：<愿望>｜供奉：<名物>x<数量>',
      `天神识得的名物：${names}`,
      ...wrap('口粮（面包等）表小心愿即可；钻石/绿宝石/附魔书/末影珍珠等贵物，方配大恩。贡品一经献出不退。'),
    ]
  }
  if (topic === '祈愿' || topic === 'pray' || topic === '愿望') {
    return [
      '【祈愿】私聊女神（/msg Goddess）：祈愿：<愿望>[｜供奉：面包x3]',
      '女神按诚意与处境裁决：应允/拒绝/开条件。求而不得时，先想想自己献过什么。',
      '已习得的技艺不必求神——自己念咒即施（零消耗等待，只耗三资源）。',
    ]
  }
  if (topic === '问' || topic === 'ask') {
    return [
      '【问】任何聊天框说：问：<问题> ——女神翻世界档案作答（免费、不占祈愿）。',
      '适合问：这世界发生过什么、某人在不在、刚才谁陨落了。15 秒一问。',
    ]
  }
  if (topic === '造物' || topic === 'give') {
    const names = Object.keys(GIVE_WHITELIST).join('、')
    return [
      '【造物】祈愿求物只从白名单内取（数量 1-16）：',
      ...wrap(names),
    ]
  }
  if (topic === '频道' || topic === '聊天' || topic === 'chat') {
    return [
      '【频道规范】公屏=社交（聊天/协作，低频）；私聊女神=咒语/祈愿/问/help；',
      '对村民=「交易：…」；递话=「说/喊/悄悄 <台词>」。高频指令走私语，公屏清净。',
    ]
  }

  return [`未知主题「${topicArg}」。可用：新手/咒语/变强/供奉/祈愿/问/造物/频道`]
}
