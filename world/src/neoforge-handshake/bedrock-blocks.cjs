'use strict'
const fs = require('node:fs'), zlib = require('node:zlib')
const { visitChunk } = require('./native-chunk-remap.cjs')
const CHANNEL = 'mawbedrock:blocks', READY = 'mawbedrock:blocks_ready'
function copyWire(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (Array.isArray(value)) return value.map(copyWire)
  if (ArrayBuffer.isView(value)) return new value.constructor(value)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copyWire(v)]))
  return value
}
// A private original-state stream crosses ViaVersion without occupying vanilla
// block IDs. The pinned Geyser interceptor restores it before chunk translation.
class BedrockBlocks {
  constructor (catalog) {
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.states)) throw Error('INVALID_NATIVE_BLOCK_CATALOG')
    this.states = new Map(); this.dimensions = new Map(); this.minSection = null; this.sequence = 0
    this.ready = false; this.pending = []; this.pendingBytes = 0
    this.itemReplay = Array.isArray(catalog.blockItems) && catalog.blockItems.length > 0
    this.stats = { chunks: 0, cells: 0, updates: 0, replays: 0 }
    const virtual = new Set()
    for (const row of catalog.states) {
      if (!Number.isInteger(row.nativeId) || row.nativeId < 0 || !Number.isInteger(row.javaId) || row.javaId < 65536 || row.javaId > 1048575 || virtual.has(row.javaId) || this.states.has(row.nativeId)) throw Error('INVALID_NATIVE_BLOCK_ID')
      this.states.set(row.nativeId, row.javaId); virtual.add(row.javaId)
    }
  }
  static load (file) { return file ? new BedrockBlocks(JSON.parse(fs.readFileSync(file, 'utf8'))) : null }
  activate () { if (this.ready) return []; this.ready = true; const rows = this.pending; this.pending = []; this.pendingBytes = 0; this.stats.replays += rows.length; return rows }
  frame (kind, parts) {
    const raw = Buffer.concat(parts), header = Buffer.alloc(13)
    if (raw.length > 2 * 1024 * 1024) throw Error('NATIVE_BLOCK_FRAME_TOO_LARGE')
    header.write('MWB1'); header[4] = kind; header.writeUInt32BE(++this.sequence, 5); header.writeUInt32BE(raw.length, 9)
    const data = Buffer.concat([header, zlib.deflateRawSync(raw, { level: 1 })])
    if (data.length > 1024 * 1024) throw Error('NATIVE_BLOCK_PAYLOAD_TOO_LARGE')
    return { name: 'custom_payload', params: { channel: CHANNEL, data } }
  }
  project (name, params) {
    if (name === 'registry_data' && params.id === 'minecraft:dimension_type') {
      for (const [index, entry] of params.entries.entries()) {
        const y = entry.value?.value?.min_y?.value ?? entry.data?.value?.min_y?.value
        if (Number.isInteger(y) && y % 16 === 0) this.dimensions.set(index, y / 16)
      }
    }
    if (name === 'login' || name === 'respawn') {
      this.minSection = this.dimensions.get(params.worldState?.dimension) ?? null
      if (name === 'respawn') { this.pending = []; this.pendingBytes = 0 }
    }
    const blockPacket=['map_chunk','block_change','multi_block_change'].includes(name)
    const itemPacket=this.itemReplay && ['window_items','set_slot'].includes(name)
    if (!blockPacket && !itemPacket) return []
    if (!this.ready) {
      const size = params.chunkData?.length || 128 + (params.records?.length || 0) * 8
      if (this.pendingBytes + size > 32 * 1024 * 1024 || this.pending.length >= 4096) throw Error('NATIVE_BLOCK_OBSERVER_NOT_READY')
      this.pending.push({ name, params: copyWire(params) }); this.pendingBytes += size
      return []
    }
    if (itemPacket) return []
    if (name === 'map_chunk') {
      if (this.minSection === null) throw Error('NATIVE_BLOCK_DIMENSION_UNAVAILABLE')
      const sections = []
      visitChunk(params.chunkData, (index, values) => {
        const cells = []
        for (let i = 0; i < values.length; i++) { const id = this.states.get(values[i]); if (id !== undefined) cells.push([i, id]) }
        if (!cells.length) return
        const bytes = Buffer.alloc(4 + cells.length * 6); bytes.writeInt16BE(index, 0); bytes.writeUInt16BE(cells.length, 2)
        cells.forEach(([at,id], i) => { bytes.writeUInt16BE(at, 4 + i * 6); bytes.writeUInt32BE(id, 6 + i * 6) })
        sections.push(bytes); this.stats.cells += cells.length
      })
      const header = Buffer.alloc(12); header.writeInt32BE(params.x, 0); header.writeInt32BE(params.z, 4); header.writeInt16BE(this.minSection, 8); header.writeUInt16BE(sections.length, 10)
      this.stats.chunks++
      return [this.frame(1, [header, ...sections])]
    }
    const cells = []
    if (name === 'block_change') {
      const id = this.states.get(params.type)
      if (id !== undefined) cells.push({ ...params.location, id })
    } else {
      const at = params.chunkCoordinates
      for (const record of params.records) {
        const native = Math.floor(record / 4096), id = this.states.get(native), pos = record % 4096
        if (id !== undefined) cells.push({ x: at.x * 16 + (pos >> 8), y: at.y * 16 + (pos & 15), z: at.z * 16 + ((pos >> 4) & 15), id })
      }
    }
    if (!cells.length) return []
    const data = Buffer.alloc(4 + cells.length * 16); data.writeUInt32BE(cells.length)
    cells.forEach((p, i) => { const o = 4 + i * 16; data.writeInt32BE(p.x, o); data.writeInt32BE(p.y, o + 4); data.writeInt32BE(p.z, o + 8); data.writeUInt32BE(p.id, o + 12) })
    this.stats.updates += cells.length
    return [this.frame(2, [data])]
  }
}
module.exports = { BedrockBlocks, CHANNEL, READY }
