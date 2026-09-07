/**
 * mc-offering —— 供奉物品的共享词典与解析（穿越者侧 + 世界侧共用）。
 *
 * 供奉是祈愿的代价：穿越者祷告时可自愿献上行囊中的物品，
 * 贡品一经献上即从行囊消失（世界侧用 /clear 收执），
 * 女神根据供品贵贱与供奉历史自行判断虔诚度、裁量是否相助。
 *
 * 本模块零依赖、纯函数，可离线单测：
 *   - OFFERING_ITEMS     中文名 → 物品 id（供品词典；也接受英文 id 直填）
 *   - resolveOfferingText 解析「面包x3」「3个金锭」「钻石」等写法
 *   - parseInventoryCounts 从 RCON `data get entity <p> Inventory` 回显里数物品
 *   - sumItemCount        从 mineflayer 背包物品列表里数某 id 总数
 */

/** 供品词典：中文名 → 物品 id（不含 minecraft: 前缀）。 */
export const OFFERING_ITEMS: Record<string, string> = {
  // 食物（口粮级）
  '面包': 'bread',
  '熟牛肉': 'cooked_beef',
  '牛排': 'cooked_beef',
  '烤猪排': 'cooked_porkchop',
  '烤鸡': 'cooked_chicken',
  '金胡萝卜': 'golden_carrot',
  '金苹果': 'golden_apple',
  '蛋糕': 'cake',
  '南瓜派': 'pumpkin_pie',
  '苹果': 'apple',
  '甜浆果': 'sweet_berries',
  // 基础材料
  '煤': 'coal',
  '木炭': 'charcoal',
  '铁': 'iron_ingot',
  '铁锭': 'iron_ingot',
  '铜': 'copper_ingot',
  '铜锭': 'copper_ingot',
  '金': 'gold_ingot',
  '金锭': 'gold_ingot',
  '圆石': 'cobblestone',
  '木头': 'oak_log',
  '纸': 'paper',
  '书': 'book',
  // 贵重之物（最能打动女神）
  '钻石': 'diamond',
  '绿宝石': 'emerald',
  '红石': 'redstone',
  '青金石': 'lapis_lazuli',
  '石英': 'quartz',
  '萤石粉': 'glowstone_dust',
  '紫水晶': 'amethyst_shard',
  '末影珍珠': 'ender_pearl',
  '烈焰棒': 'blaze_rod',
  '恶魂之泪': 'ghast_tear',
  '附魔书': 'enchanted_book',
}

/** id → 中文名反查（供品回显用；同 id 多个中文名时取最具体的那个）。 */
export const OFFERING_ITEM_CN: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const [cn, id] of Object.entries(OFFERING_ITEMS)) {
    if (!map[id] || cn.length > map[id].length) map[id] = cn
  }
  return map
})()

/** 一笔供奉（收执成功后的记账口径：归一化 id + 数量 + 回显名）。 */
export interface OfferingInfo {
  id: string
  cn: string
  count: number
}

export interface ResolvedOffering {
  /** 归一化物品 id（带 minecraft: 前缀）。 */
  id: string
  /** 供奉数量（1-64）。 */
  count: number
  /** 回显名（中文优先，英文 id 兜底）。 */
  cn: string
}

/**
 * 解析供奉描述。支持：
 *   「面包x3」「面包×3」「面包*3」「面包 3」「面包3」「3个面包」「3 面包」「diamond 2」
 * 返回 null = 无法辨认（物品不在词典里，也不是合法 id）。
 */
export function resolveOfferingText(text: string): ResolvedOffering | null {
  const raw = text.trim().replace(/^供奉[:：]?\s*/, '')
  if (!raw) return null
  let name = raw
  let count = 1
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => void]> = [
    [/^(.+?)[x×*＊]\s*(\d+)$/i, (m) => { name = m[1]; count = parseInt(m[2], 10) }],
    [/^(\d+)\s*[个只块颗组张本]\s*(.+)$/, (m) => { name = m[2]; count = parseInt(m[1], 10) }],
    [/^(.+?)\s+(\d+)$/, (m) => { name = m[1]; count = parseInt(m[2], 10) }],
    [/^(.+?)(\d+)$/, (m) => { name = m[1]; count = parseInt(m[2], 10) }],
  ]
  for (const [re, apply] of patterns) {
    const m = raw.match(re)
    if (m) { apply(m); break }
  }
  name = name.trim()
  if (!name) return null
  count = Math.max(1, Math.min(64, Math.floor(count)))

  // 中文词典直查
  if (OFFERING_ITEMS[name]) {
    const id = OFFERING_ITEMS[name]
    return { id: `minecraft:${id}`, count, cn: name }
  }
  // 英文 id 直填（可带/不带 minecraft: 前缀，空格转下划线）
  const norm = name.toLowerCase().replace(/\s+/g, '_').replace(/^minecraft:/, '')
  if (OFFERING_ITEM_CN[norm]) {
    return { id: `minecraft:${norm}`, count, cn: OFFERING_ITEM_CN[norm] }
  }
  return null
}

/**
 * 从 RCON `data get entity <p> Inventory` 的回显文本里统计每种物品数量。
 * 回显形如：`Kirito has the following entity data: [{Slot:0b,id:"minecraft:bread",Count:3b}, ...]`
 * （NBT 键序可能变，逐个花括号组解析，容错两种顺序。）
 */
export function parseInventoryCounts(output: string): Map<string, number> {
  const counts = new Map<string, number>()
  const groups = output.match(/\{[^{}]*\}/g) ?? []
  for (const g of groups) {
    const idm = g.match(/id:\s*"?([a-z0-9_:]+)"?/i)
    const cm = g.match(/Count:\s*(\d+)b?/i)
    if (!idm || !cm) continue
    const id = idm[1].toLowerCase().replace(/^minecraft:/, '')
    counts.set(id, (counts.get(id) ?? 0) + parseInt(cm[1], 10))
  }
  return counts
}

/** 从 mineflayer 背包（或任意 {name,count} 列表）里统计某 id（可带/不带前缀）的总数。 */
export function sumItemCount(items: Array<{ name: string; count: number }>, id: string): number {
  const bare = id.toLowerCase().replace(/^minecraft:/, '')
  return items.reduce((sum, it) => (it.name === bare || it.name === `minecraft:${bare}` ? sum + it.count : sum), 0)
}
