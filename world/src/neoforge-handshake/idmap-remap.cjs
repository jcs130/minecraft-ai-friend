// idmap-remap.cjs — gate 出站号翻译层（2026-09-21）
// 默认关闭（无 idmap.json 或 GATE_REMAP=0 时完全透传，零行为变化）。
// 开启后：后端→前端 方向的 map_chunk palette、block_update 状态号、
// 含 ItemStack 的包(set_slot/container_set_content/entity_equipment 等) 的
// item id 与 blockstate id，从 NeoForge 网络号翻译为原版号；反向同理。
'use strict'
const fs = require('fs')
const path = require('path')

const mapFile = path.join(__dirname, 'idmap.json')
let MAP = null

function load () {
  if (process.env.GATE_REMAP === '0') { console.log('[REMAP] 显式关闭'); return null }
  if (!fs.existsSync(mapFile)) { console.log('[REMAP] 无 idmap.json，透传'); return null }
  const raw = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
  // raw = { blocks: {neoforgeId: vanillaId|{-1:近似}}, blocksFallback, items: {neoforgeId: vanillaId}, ... }
  MAP = {
    b: new Int32Array(0), // 用 Map 更稳（号段稀疏）
    bm: new Map(Object.entries(raw.blocks || {}).map(([k, v]) => [Number(k), v.v])),
    bs: new Map(Object.entries(raw.states || {}).map(([k, v]) => [Number(k), v])),
    im: new Map(Object.entries(raw.items || {}).map(([k, v]) => [Number(k), v])),
    fallbackBlock: raw.fallbackBlockState ?? 0 // air? 由映射生成器决定
  }
  console.log(`[REMAP] 载入 state=${MAP.bs.size} item=${MAP.im.size}`)
  return MAP
}

function stateToVanilla (id) {
  if (!MAP) return id
  const v = MAP.bs.get(id)
  if (v != null) return v
  if (MAP.bs.has(id)) return id
  return MAP.fallbackBlock
}
function stateToNeo (id) { // 反表（原版→NeoForge）供前端→后端
  if (!MAP || !MAP.rev) return id
  return MAP.rev.get(id) ?? id
}
function itemToVanilla (id) { if (!MAP) return id; const v = MAP.im.get(id); return v == null ? id : v }
function itemToNeo (id) { if (!MAP || !MAP.revI) return id; return MAP.revI.get(id) ?? id }

function finalize () {
  if (!MAP) return
  MAP.rev = new Map([...MAP.bs].map(([n, v]) => [v, n]))
  MAP.revI = new Map([...MAP.im].map(([n, v]) => [v, n]))
}

// ItemStack 结构里 item 数字字段名（mcp 767：Slot = {itemId? present...}）
// mcp 的 play 包 item 栈字段名不一：统一走"深改写"按已知键名
const ITEM_KEYS = ['itemId', 'itemID']
function remapStack (st) {
  if (!MAP || st == null || typeof st !== 'object') return st
  for (const k of ITEM_KEYS) if (typeof st[k] === 'number') st[k] = itemToVanilla(st[k])
  return st
}

// map_chunk: mcp 1.21.1 sections 解析结构 → 若带 palette 的 section，逐号翻译
function remapChunk (p) {
  if (!MAP) return
  try {
    const secs = p.data && (p.data.sections || p.sections)
    if (!secs) return
    for (const s of secs) {
      if (s && Array.isArray(s.palette)) s.palette = s.palette.map(id => stateToVanilla(id))
    }
  } catch (e) { /* 结构对不上就不动，透传比错位强 */ }
}

function remapOut (name, params) { // 后端→前端
  if (!MAP) return params
  switch (name) {
    case 'map_chunk': remapChunk(params); return params
    case 'block_update': {
      const k = 'newState' in params ? 'newState' : ('stateId' in params ? 'stateId' : ('data' in params && typeof params.data === 'number' ? 'data' : null))
      if (k) params[k] = stateToVanilla(params[k])
      return params
    }
    case 'set_slot': if (params.item) remapStack(params.item); return params
    case 'container_set_content': (params.itemsWithSlots || params.itemStacks || []).forEach(its => its && remapStack(its.itemStack ?? its)); return params
    case 'container_data': return params
    case 'entity_equipment_update': if (params.item) remapStack(params.item); if (params.attributeModifiersList) {} return params
    default: return params
  }
}
function remapIn (name, params) { // 前端→后端（原版→NeoForge）
  if (!MAP) return params
  switch (name) {
    case 'set_creative_mode': if (params.slot != null && params.item) remapInStack(params.item); return params
    case 'use_entity_on': return params
    default: return params
  }
}
function remapInStack (st) {
  if (!st || typeof st !== 'object') return st
  for (const k of ITEM_KEYS) if (typeof st[k] === 'number') st[k] = itemToNeo(st[k])
  return st
}

module.exports = { load, finalize, remapOut, remapIn, hasMap: () => !!MAP }
