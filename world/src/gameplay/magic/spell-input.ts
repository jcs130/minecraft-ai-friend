// Existing exact/keyword parsing. No embeddings, network or world side effects.
import type { Atom } from './contracts.ts'
import { GIVE_WHITELIST, GIVE_DEFAULT_COUNT } from './defaults.ts'

// ── 施法框架前缀（2026-08-23 造物主谕：施法必须有固定咒语框架，正则匹配，持续扩展）──
// 前缀命中 = 明确施法意图声明 → 进匹配链；无前缀自然语言 → 聊天/祈愿通道。
// 分级分发：PUBLIC=公共池（新玩家随机被告知 2-3 个），BOOK=技能书藏宝（书商/探索掉落），
// AI 玩家全量告知（AI 看不了书）；匹配时全量认（正则 i 不敏感，英文大小写通吃）。
// 长词在前（alternation 顺序敏感：cast_spell 先于 cast）；斜杠前缀排除（/ 开头会被当命令）。
export const CHANT_PREFIXES_PUBLIC: string[] = [
  // 公共池：新玩家入世即被告知（随机 2-3 个）
  'cast_spell', '施法', '天灵灵地灵灵', '女神在上',
  // 自然语言句式（2026-08-30 造物主谕：特殊字符咒语难打，明确文字更好）：
  // 「发动技能螺旋丸」「使用技能闪电术」「我要放个火球」语音/键盘都顺口。
  // 长句式前缀，误伤率低（剥壳后照常走 words 精确匹配→向量降级）。
  '发动技能', '使用技能', '释放技能', '使用法术', '释放法术',
  '我要放', '我要用', '我要发动', '我要释放',
  '帮我放', '帮我用', '帮我发动', '帮我释放',
  '快放', '放个', '来个', '放一个', '来一个',
]

export const CHANT_PREFIXES_BOOK: string[] = [
  // 技能书藏宝：墨白/云笈技能书、探索掉落里写（每本书记几个前缀，凑齐靠收集）
  'cast', 'chant', 'spell', '咏唱',
  '急急如律令', '妈咪妈咪哄', '嘛哩嘛哩哄', '芝麻开门',
  '天地无极', '乾坤借法', '巴啦啦能量', '古娜拉黑暗之神', '阿布拉卡达布拉',
  '千灯在上', '天神在上', '灯明',
  '菠萝菠萝蜜', '噼里啪啦', '呜咪咪哄', '咻咻咻',
]

export const CHANT_PREFIXES: string[] = [...CHANT_PREFIXES_PUBLIC, ...CHANT_PREFIXES_BOOK]

export const CHANT_PREFIX_RE = new RegExp(`^(?:${CHANT_PREFIXES.join('|')})[\\s:：]*(.+)$`, 'i')

/** 剥施法框架：命中前缀则返回咒语内容（去前缀），未命中返回 null（不算施法意图）。 */
export function matchChantFrame(msg: string): string | null {
  const m = CHANT_PREFIX_RE.exec(msg.trim())
  return m ? m[1].trim() : null
}

// ── 中文数字 / 方向 / 物品 解析 ────────────────────────────────────────
export const CN_DIGITS: Record<string, number> = {
  '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9,
}

export function parseCnNumber(s: string): number {
  let total = 0
  let acc = 0
  for (const ch of s) {
    if (ch === '十') {
      total += (acc || 1) * 10
      acc = 0
    } else if (ch === '百') {
      total += (acc || 1) * 100
      acc = 0
    } else if (CN_DIGITS[ch] !== undefined) {
      acc = CN_DIGITS[ch]
    }
  }
  return total + acc
}

export function extractNumber(s: string): number | null {
  const arabic = s.match(/(\d+)/)
  if (arabic) return parseInt(arabic[1], 10)
  const cn = s.match(/[零一二两三四五六七八九十百]+/)
  if (cn) return parseCnNumber(cn[0])
  return null
}

export const DIR_VECTORS: Record<string, [number, number]> = {
  // 斜向组合（先于单字匹配，否则「东南」会被贪心命中「东」）；向量归一化，10 格东南=对角线共 10 格
  '东南': [Math.SQRT1_2, Math.SQRT1_2], '东北': [Math.SQRT1_2, -Math.SQRT1_2],
  '西南': [-Math.SQRT1_2, Math.SQRT1_2], '西北': [-Math.SQRT1_2, -Math.SQRT1_2],
  '东': [1, 0], '南': [0, 1], '西': [-1, 0], '北': [0, -1],
}

export function extractDirection(s: string): string | null {
  for (const d of Object.keys(DIR_VECTORS)) {
    if (d.length === 2 && s.includes(d)) return d
  }
  for (const d of Object.keys(DIR_VECTORS)) {
    if (d.length === 1 && s.includes(d)) return d
  }
  return null
}

export function extractItem(s: string): string | null {
  // 2026-08-30 最长匹配：短词常是长咒子串（『背包』⊂『大背包』），顺序遍历会
  // 截胡——与 matchSpell 词长优先同病同治。平词长保持表序（稳定）。
  let best: { en: string; len: number } | null = null
  for (const [cn, en] of Object.entries(GIVE_WHITELIST)) {
    if (s.includes(cn) && cn.length > (best?.len ?? 0)) best = { en, len: cn.length }
  }
  return best?.en ?? null
}

// 守卫名候选词（契约/唤魂法术参数解析用，2026-08-23）。守卫只认桐人/鸣人——
// 守卫桥 GUARDS 只驱动这两位（剑侍 mc-guard-kirito / 影侍 mc-guard-naruto），
// 爱德华不在召唤范围。归一化到权威中文名；此处仅做"咒语里点到谁"的宽松提取，
// 真正的守卫可用性由 specialExecutor（mc-god 注入）二次把关。
export const GUARD_PARAM_WORDS: Record<string, string> = {
  '桐人': '桐人', 'kirito': '桐人', 'Kirito': '桐人', '桐': '桐人',
  '鸣人': '鸣人', 'naruto': '鸣人', 'Naruto': '鸣人', '鸣': '鸣人',
}

export function extractGuard(s: string): string | null {
  for (const [alias, canonical] of Object.entries(GUARD_PARAM_WORDS)) {
    if (s.includes(alias)) return canonical
  }
  return null
}

/** 提取自由文本任务/目标名：剥掉咒语词与（可选）守卫名，剩下的就是任务/目标。 */
export function extractTaskText(s: string, stripGuard: boolean, spellWords: string[] = []): string {
  let t = s
  for (const w of spellWords) t = t.replace(w, ' ')
  if (stripGuard) {
    for (const alias of Object.keys(GUARD_PARAM_WORDS)) t = t.replace(alias, ' ')
  }
  return t.replace(/\s+/g, ' ').trim()
}

// ── 匹配 / 参数 / 消耗 ─────────────────────────────────────────────────
export function matchSpell(chant: string, atoms: Atom[]): { atom: Atom; params: Record<string, number | string> } | null {
  // Stable IDs and full display names take priority over shorter aliases. In
  // particular 羽落 and 附魔·闪电链 must not miss or become another spell.
  const body = chant.trim()
  const exact = atoms.find((a) => a.id.toLowerCase() === body.toLowerCase())
    ?? atoms.find((a) => a.name === body)
  if (exact) return { atom: exact, params: extractParams('', exact) }
  const named = atoms.flatMap((a) => [a.id, a.name].map((key) => ({ atom: a, key })))
    .filter(({ key }) => body.startsWith(key) && /^\s/.test(body.slice(key.length)))
    .sort((a, b) => b.key.length - a.key.length)[0]
  if (named) return { atom: named.atom, params: extractParams(body.slice(named.key.length), named.atom) }
  // 2026-08-30：词长优先——短词常是长咒子串（『闪电』⊂『附魔闪电链』），首中即返
  // 会截胡长咒。全量收候选，最长命中词者胜；平词长保持 atoms 文件序（稳定）。
  // 2026-08-30 之二：跳过 type:passive——被动装备系（夜视之瞳/铁躯/鱼鳃/火衣）不经
  // 咏唱匹配（参悟走 CLI learn 分支）。否则被动词撞咏唱版（『夜视』『铁肤』『鱼鳃』
  // 『防火』）时，文件序在前的被动会抢走匹配，cast 层再拦就变成「明明有咏唱版却不给放」。
  let best: { atom: Atom; params: Record<string, number | string>; len: number } | null = null
  for (const atom of atoms) {
    if ((atom as { type?: string }).type === 'passive') continue
    let hitLen = 0
    for (const w of [atom.name, ...atom.words]) if (chant.includes(w) && w.length > hitLen) hitLen = w.length
    if (hitLen === 0) continue
    if (!best || hitLen > best.len) best = { atom, params: extractParams(chant, atom), len: hitLen }
  }
  return best
}

export function extractParams(chant: string, atom: Atom): Record<string, number | string> {
  const params: Record<string, number | string> = {}
  if (!atom.params) return params
  for (const [pname, spec] of Object.entries(atom.params)) {
    if (spec.type === 'number') {
      const n = extractNumber(chant)
      const capped = n !== null ? Math.min(spec.max ?? n, n) : null
      params[pname] = capped ?? (spec.default as number)
    } else if (spec.type === 'direction') {
      params[pname] = extractDirection(chant) ?? (spec.default as string)
    } else if (spec.type === 'item') {
      params[pname] = extractItem(chant) ?? (spec.default as string)
    } else if (spec.type === 'guard') {
      params[pname] = extractGuard(chant) ?? (spec.default as string)
    } else if (spec.type === 'text') {
      params[pname] = extractTaskText(chant, spec.stripGuard ?? false, atom.words)
    }
  }
  return params
}

export function resolveExactAtom(key: string, atoms: Atom[]): { atom: Atom } | { code: 'unknown_skill' | 'ambiguous_skill'; summary: string } {
  const trimmed = key.trim()
  const id = atoms.find((a) => a.id.toLowerCase() === trimmed.toLowerCase())
  if (id) return { atom: id }
  const names = atoms.filter((a) => a.name === trimmed)
  const matches = names.length ? names : atoms.filter((a) => a.words.some((w) => w.toLowerCase() === trimmed.toLowerCase()))
  if (matches.length === 1) return { atom: matches[0] }
  if (matches.length > 1) return { code: 'ambiguous_skill', summary: `「${trimmed}」对应多项技艺，请使用技能 ID：${matches.map((a) => a.id).join('、')}。` }
  return { code: 'unknown_skill', summary: `未知技艺「${trimmed}」，请使用技能 ID、完整名称或唯一咒语词。` }
}

/** Structured CLI parameters never silently become another item, direction or target. */
export function exactParams(atom: Atom, supplied: Record<string, string | number>): { params: Record<string, string | number> } | { error: string } {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return { error: '技能参数须为 key=value 对。' }
  const params = extractParams('', atom)
  for (const [key, raw] of Object.entries(supplied)) {
    const spec = atom.params?.[key]
    if (key === 'count' && atom.id === 'give') {
      const value = typeof raw === 'number' ? raw : (/^\d+$/.test(raw) ? Number(raw) : NaN)
      if (!Number.isInteger(value) || value < 1 || value > 16) return { error: '造物数量 count 须为 1–16 的整数。' }
      params.count = value
      continue
    }
    if (!spec) return { error: `「${atom.name}」不支持参数 ${key}。${key === 'target' ? '此技能按施法者自身结算和生效。' : ''}` }
    if (spec.type === 'number') {
      const value = typeof raw === 'number' ? raw : (/^\d+$/.test(raw) ? Number(raw) : NaN)
      if (!Number.isInteger(value) || value < (spec.min ?? 0) || value > (spec.max ?? Number.MAX_SAFE_INTEGER)) {
        return { error: `${key} 须为 ${spec.min ?? 0}–${spec.max ?? Number.MAX_SAFE_INTEGER} 的整数。` }
      }
      params[key] = value
    } else if (spec.type === 'direction') {
      const aliases: Record<string, string> = { east: '东', west: '西', north: '北', south: '南', northeast: '东北', northwest: '西北', southeast: '东南', southwest: '西南' }
      const value = String(raw).trim()
      const canonical = aliases[value.toLowerCase()] ?? value
      if (!Object.hasOwn(DIR_VECTORS, canonical)) return { error: '方向须为东、西、南、北、东北、西北、东南或西南。' }
      params[key] = canonical
    } else if (spec.type === 'item') {
      const value = String(raw).trim()
      const short = value.startsWith('minecraft:') ? value.slice('minecraft:'.length) : value
      const canonical = Object.hasOwn(GIVE_WHITELIST, value) ? GIVE_WHITELIST[value] : short
      if (!Object.values(GIVE_WHITELIST).includes(canonical)) return { error: `不支持造物物品「${value}」，请使用已开放的物品名称或 ID。` }
      params[key] = canonical
    } else if (spec.type === 'guard') {
      const value = String(raw).trim()
      if (!Object.hasOwn(GUARD_PARAM_WORDS, value)) return { error: '守卫须为桐人或鸣人。' }
      params[key] = GUARD_PARAM_WORDS[value]
    } else {
      const value = String(raw).trim()
      if (value.length > 240 || /[\r\n\0]/.test(value)) return { error: `${key} 须为不超过 240 字的单行文字。` }
      params[key] = value
    }
  }
  return { params }
}
