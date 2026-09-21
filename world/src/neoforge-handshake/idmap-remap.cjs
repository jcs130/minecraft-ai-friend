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

// map_chunk 的 chunkData 是原始字节 ✓ 手写 varint 游标两次翻车(2026-09-21 定谳) ✗
// 唯一懂这格式的=prismarine-chunk(mineflayer 实测能 parse 同一块 buffer) ✓
// 姿势：load → 原地翻 palette(单值段翻 value) → dump 重打包 ✓ 解不懂的直接透传不碰 ✓
let ChunkCls = undefined
function remapChunkBuf (buf) {
  if (ChunkCls === undefined) { try { ChunkCls = require('prismarine-chunk')('1.21.1') } catch (e) { ChunkCls = null } }
  if (!ChunkCls) return buf
  const c = new ChunkCls()
  c.load(buf)                                                  // 解不动会 throw → 上层透传 ✓
  let hit = 0
  for (const s of c.sections) {
    if (!s || !s.data) continue
    const d = s.data
    if (Array.isArray(d.palette)) {                            // 间接调色板 ✓
      for (let i = 0; i < d.palette.length; i++) {
        const v = MAP.bs.get(d.palette[i])
        if (v != null) { d.palette[i] = v; hit++ } else { d.palette[i] = MAP.fallbackBlock; hit++ }
      }
    } else if (typeof d.value === 'number') {                  // 单值段(整段同方块) ✓
      const v = MAP.bs.get(d.value)
      d.value = v == null ? MAP.fallbackBlock : v
      hit++
    }
    // direct 全局调色板段:少见 ✓ 暂不碰(透传) ✓ 若 verify 显示仍错位再补
  }
  if (!hit) return buf                                          // 一个号都没改到 → 别白重打包 ✓
  return c.dump()
}

const BLOCK_KEYS = { blockId: 1, newState: 1, blockStateId: 1, block: 1 }
function remapOut (name, params) { // 后端→前端: NeoForge号→原版号
  if (!MAP) return params
  if (name === 'block_change' && typeof params.type === 'number') { // 单方块更新:字段名是 type (2026-09-21 pktspy 定谳) ✓
    const v = MAP.bs.get(params.type)
    if (v != null) params.type = v
    else if (params.type > 26684) params.type = MAP.fallbackBlock // 超原版表界=mod方块→兜底 ✓ 界内查不到=恒等对 ✓ 原样过 ✓
    return params
  }
  if (name === 'map_chunk' && Buffer.isBuffer(params.chunkData)) {
    try {
      const nb = remapChunkBuf(params.chunkData)
      if (nb && Math.abs(nb.length - params.chunkData.length) <= 4096) params.chunkData = nb // 尺寸剧变=重打包有诈 ✓ 透传
    } catch (e) {} // 手术失败=透传这包 ✓ 错位好过崩溃
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
      else if (k === 'itemId' && typeof v === 'number') obj[k] = itOut(v)
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
    case 'set_slot': if (params.item) remapStack(params.item); return params
    case 'container_set_content': (params.itemsWithSlots || params.itemStacks || []).forEach(its => its && remapStack(its.itemStack ?? its)); return params
    case 'container_data': return params
    case 'entity_equipment_update': if (params.item) remapStack(params.item); if (params.attributeModifiersList) {} return params
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
