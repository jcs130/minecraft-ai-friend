const rendering = new Set(['renderRegistries', 'entityRenderStates', 'contraptionRenderStates'])
const plain = text => typeof text === 'string' ? text.replace(/§[0-9a-fk-or]/gi, '') : text
function chatText(value) {
  if (typeof value === 'string') return plain(value)
  if (Array.isArray(value)) return value.map(chatText).join('')
  if (!value || typeof value !== 'object') return ''
  return plain(value.text || value.translate || '') + (value.with || []).map(chatText).join(' ') + (value.extra || []).map(chatText).join('')
}

// Read only the standard lore string list. This is a display projection,
// never a substitute for the exact SNBT used by native inventory operations.
export function loreFromSnbt(snbt) {
  const match = /["']?minecraft:lore["']?\s*:\s*\[/.exec(snbt)
  if (!match) return []
  let p = match.index + match[0].length
  const lines = []
  while (lines.length < 64) {
    while (/\s|,/.test(snbt[p] || '') && p < snbt.length) p++
    const quote = snbt[p++]
    if (quote !== '"' && quote !== "'") break
    let text = '', closed = false
    while (p < snbt.length && text.length <= 8192) {
      const ch = snbt[p++]
      if (ch === quote) { closed = true; break }
      if (ch === '\\') {
        const escaped = snbt[p++]
        if (escaped !== quote && escaped !== '\\') return lines
        text += escaped
      } else text += ch
    }
    if (!closed) break
    try { lines.push(chatText(JSON.parse(text))) } catch { lines.push(plain(text)) }
    while (/\s/.test(snbt[p] || '') && p < snbt.length) p++
    if (snbt[p] !== ',') break
  }
  return lines
}

export function modelView(value, artifact, path = []) {
  if (Array.isArray(value)) return value.map((entry, i) => modelView(entry, artifact, [...path, i]))
  if (!value || typeof value !== 'object') return value
  if (typeof value.id === 'string' && Number.isInteger(value.count) && typeof value.snbt === 'string') {
    const item = { id: value.id, count: value.count, displayName: plain(value.displayName || value.id),
      ...(Number.isInteger(value.slot) ? { slot: value.slot } : path.at(-2) === 'slots' ? { slot: path.at(-1) } : {}),
      fullItem: { artifact, path } }
    const lore = loreFromSnbt(value.snbt)
    if (lore.length) item.lore = lore
    if (Buffer.byteLength(value.snbt) <= 200) item.snbt = value.snbt
    if (value.food) item.food = modelView(value.food, artifact, [...path, 'food'])
    return item
  }
  const projected = Object.fromEntries(Object.entries(value).filter(([key]) => !rendering.has(key)).map(([key, entry]) => [key, modelView(entry, artifact, [...path, key])]))
  if (value.source === 'server_first_hit_rays_and_tracked_visible_entities') projected.observationCoverage = {
    orientationIndependent: true, rayCount: 48, complete: false,
    note: '以眼睛位置为起点的全方向固定48条首命中射线，受方块遮挡；不随yaw/pitch改变。同地点反复转头再观察不会扫到墙后的物体。可见方块坐标是方块本身，不是可以直接站立的空气坐标。'
  }
  return projected
}
