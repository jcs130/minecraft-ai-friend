// idmap-remap.cjs — gate 出站号翻译层（2026-09-21）
// 默认关闭（无 idmap.json 或 GATE_REMAP=0 时完全透传，零行为变化）。
// 开启后：后端→前端 方向的 map_chunk palette、block_update 状态号、
// 含 ItemStack 的包(set_slot/container_set_content/entity_equipment 等) 的
// item id 与 blockstate id，从 NeoForge 网络号翻译为原版号；反向同理。
'use strict'
const fs = require('fs')
const path = require('path')

// A registry map belongs to one exact modpack build. Never reuse the production
// map when a lab world has a different registry order.
const mapFile = process.env.GATE_IDMAP_FILE || path.join(__dirname, 'idmap.json')
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
    reverseVanillaItems: raw.reverseVanillaItems || null,
    reverseVanillaStates: raw.reverseVanillaStates || null,
    fallbackBlock: raw.fallbackBlockState ?? 0 // air? 由映射生成器决定
  }
  console.log(`[REMAP] 载入 state=${MAP.bs.size} item=${MAP.im.size}`)
  finalize()   // 2026-09-21 定谳:此前从未调用 → 反表缺失 → 入站翻译形同虚设 ✗ 补 ✓
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
  // 反表必须"恒等对优先"：mod 物品常被近似到 paper/stone 等通用原版号 ✓
  // 若 modX→paper 后插入会顶掉真 paper 的反查 ✗ 原版对(号相同)是铁证 ✓ 先非恒等后恒等 ✓
  MAP.rev = new Map(); MAP.revI = new Map()
  for (const [n, v] of MAP.bs) MAP.rev.set(v, n)
  for (const [n, v] of MAP.bs) if (n === v) MAP.rev.set(v, n)
  for (const [n, v] of MAP.im) MAP.revI.set(v, n)
  for (const [n, v] of MAP.im) if (n === v) MAP.revI.set(v, n)
  // A content pack can move vanilla IDs too. Numeric equality is not proof
  // of identity; newer exports resolve the reverse table by registry name.
  if (MAP.reverseVanillaItems) for (const [v, n] of Object.entries(MAP.reverseVanillaItems)) {
    if (!Number.isInteger(n) || MAP.im.get(n) !== Number(v)) throw Error('INVALID_VANILLA_ITEM_REVERSE')
    MAP.revI.set(Number(v), n)
  }
  if (MAP.reverseVanillaStates) for (const [v, n] of Object.entries(MAP.reverseVanillaStates)) {
    if (!Number.isInteger(n) || MAP.bs.get(n) !== Number(v)) throw Error('INVALID_VANILLA_STATE_REVERSE')
    MAP.rev.set(Number(v), n)
  }
  console.log(`[REMAP] 反表 state=${MAP.rev.size} item=${MAP.revI.size}`)
}

// ItemStack 结构里 item 数字字段名（mcp 767：Slot = {itemId? present...}）
// mcp 的 play 包 item 栈字段名不一：统一走"深改写"按已知键名
const ITEM_KEYS = ['itemId', 'itemID']
function remapStack (st) {
  if (!MAP || st == null || typeof st !== 'object') return st
  for (const k of ITEM_KEYS) if (typeof st[k] === 'number') st[k] = itemToVanilla(st[k])
  return st
}

const { remapChunk } = require('./native-chunk-remap.cjs')
let vanillaGlobalBits
function remapChunkBuf (buf) {
  vanillaGlobalBits ??= Math.ceil(Math.log2(Math.max(...require('minecraft-data')('1.21.1').blocksArray.map(b => b.maxStateId)) + 1))
  return remapChunk(buf, id => {
    if (!MAP.bs.has(id)) throw Error('UNKNOWN_NATIVE_BLOCK_STATE ' + id)
    return MAP.bs.get(id)
  }, vanillaGlobalBits)
}

const BLOCK_KEYS = { blockId: 1, newState: 1, blockStateId: 1, block: 1 }
function remapOut (name, params) { // 后端→前端: NeoForge号→原版号
  if (!MAP) return params
  if (name === 'world_event' && params.effectId === 2001) return { ...params, data: stateToVanilla(params.data) }
  if (name === 'world_particles' && ['block','block_marker','falling_dust','dust_pillar'].includes(params.particle?.type)) {
    return { ...params, particle: { ...params.particle, data: stateToVanilla(params.particle.data) } }
  }
  if (name === 'block_change' && typeof params.type === 'number') { // 单方块更新:字段名是 type (2026-09-21 pktspy 定谳) ✓
    const v = MAP.bs.get(params.type)
    if (v != null) params.type = v
    else if (params.type > 26684) params.type = MAP.fallbackBlock // 超原版表界=mod方块→兜底 ✓ 界内查不到=恒等对 ✓ 原样过 ✓
    return params
  }
  if (name === 'map_chunk' && Buffer.isBuffer(params.chunkData)) {
    // Palette compression may legitimately change length by far more than
    // 4096 bytes. Invalid wire data is rejected by the owning session, never
    // silently forwarded as if native numeric IDs were vanilla IDs.
    params = { ...params, chunkData: remapChunkBuf(params.chunkData) }
    return params
  }
  if (name === 'multi_block_change' && Array.isArray(params.records)) {
    // 1.20.5+ Section Blocks Change：records 是扁平 varint[] ✓ 每条 = (blockStateId << 12) | 局部坐标(低 12 位)
    // 2026-09-21 实测定谳：rec=[19504904,19537671] → >>12 = 4761/4769（号 ✓）低 12 位 = 0xF08/0xF07（同列相邻 y ✓）
    // fill/结构生成/模组批量改块走这个包 ✓ 不翻就会把 NeoForge 高位号砸进客户端 → 读成 air ✗
    const VANILLA_STATE_MAX = 26684
    for (let i = 0; i < params.records.length; i++) {
      const r = params.records[i]
      if (typeof r !== 'number' || !Number.isFinite(r)) continue
      const hi = Math.floor(r / 4096)              // 用除法而非移位，避开 32 位符号坑 ✓
      const low = r - hi * 4096
      const v = MAP.bs.get(hi)
      const nv = v != null ? v : (hi > VANILLA_STATE_MAX ? MAP.fallbackBlock : hi)
      params.records[i] = nv * 4096 + low
    }
    return params
  }
  const stOut = id => { const v = MAP.bs.get(id); return v == null ? id : v }
  const itOut = id => { const v = MAP.im.get(id); return v == null ? id : v }
  const deep = (obj, d) => { // 通用深改写:只碰安全字段名 ✓ 不碰 entityId/windowId 这类"id" ✓
    if (obj == null || typeof obj !== 'object' || d > 6) return
    if (Array.isArray(obj)) { for (const v of obj) deep(v, d + 1); return }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && BLOCK_KEYS[k]) obj[k] = stOut(v)
      else if (ITEM_KEYS.includes(k) && typeof v === 'number') obj[k] = itOut(v)
      else deep(v, d + 1)
    }
  }
  deep(params, 0)
  switch (name) {
    case 'block_update': {
      const k = 'newState' in params ? 'newState' : ('stateId' in params ? 'stateId' : ('data' in params && typeof params.data === 'number' ? 'data' : null))
      if (k) params[k] = stateToVanilla(params[k])
      return params
    }
    // The recursive pass above already visits these stacks. Applying the
    // native map twice corrupts non-identity vanilla registry assignments.
    case 'set_slot': return params
    case 'container_set_content': return params
    case 'container_data': return params
    case 'entity_equipment_update': return params
    default: return params
  }
}
function remapIn (name, params) { // 前端→后端: 原版号→NeoForge号 ✓ 通用深改写(与出站同法)
  if (!MAP) return params
  const stIn = id => { const v = MAP.rev.get(id); return v == null ? id : v }
  const itIn = id => { const v = MAP.revI.get(id); return v == null ? id : v }
  const deep = (obj, d) => {
    if (obj == null || typeof obj !== 'object' || d > 6) return
    if (Array.isArray(obj)) { for (const v of obj) deep(v, d + 1); return }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && BLOCK_KEYS[k]) obj[k] = stIn(v)
      else if (k === 'itemId' && typeof v === 'number') obj[k] = itIn(v)
      else deep(v, d + 1)
    }
  }
  deep(params, 0)
  return params
}
function remapInStack (st) {
  if (!st || typeof st !== 'object') return st
  for (const k of ITEM_KEYS) if (typeof st[k] === 'number') st[k] = itemToNeo(st[k])
  return st
}

module.exports = { load, finalize, remapOut, remapIn, hasMap: () => !!MAP }
