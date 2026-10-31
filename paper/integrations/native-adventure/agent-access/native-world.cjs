'use strict'
const fs = require('node:fs'), crypto = require('node:crypto')

function readStateCatalog (file, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '') || fs.statSync(file).size > 64 * 1024 * 1024) throw Error('NATIVE_CATALOG_BUDGET_OR_HASH')
  const bytes = fs.readFileSync(file)
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw Error('NATIVE_CATALOG_HASH_MISMATCH')
  const rows = new Map()
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line) continue
    const row = JSON.parse(line)
    if (!Number.isSafeInteger(row.stateId) || row.stateId < 0 || rows.has(row.stateId) || rows.size >= 100000 ||
        !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(row.name || '')) throw Error('NATIVE_CATALOG_INVALID')
    if (row.collisionBoxes !== undefined && row.collisionBoxes !== null && (!Array.isArray(row.collisionBoxes) || row.collisionBoxes.length > 64 ||
        !row.collisionBoxes.every(b => Array.isArray(b) && b.length === 6 && b.every(n => Number.isFinite(n) && Math.abs(n) <= 4) && b[0] <= b[3] && b[1] <= b[4] && b[2] <= b[5]))) throw Error('NATIVE_COLLISION_INVALID')
    rows.set(row.stateId, row)
  }
  if (!rows.size) throw Error('NATIVE_CATALOG_EMPTY')
  return rows
}

/** Receives only this connection's original chunk packets; no remote world scans.
 * Collision shapes and visual occlusion remain separate. Dynamic/context-dependent
 * shapes stay unknown. Binding is explicit and owned; detach never overwrites a
 * replacement installed by another plugin. Core visibility filtering still applies.
 */
function attachNativeWorld (bot, packets, { catalog, visitChunk, maxChunks = 256 }) {
  if (!(catalog instanceof Map) || typeof visitChunk !== 'function' || !packets?.events?.on ||
      !Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > 1024) throw Error('NATIVE_WORLD_DEPENDENCIES_REQUIRED')
  const chunks = new Map(), events = packets.events
  let failed = false, bound = false, original, ours, generation = 0
  const key = (x, z) => x + ',' + z
  function reset () { chunks.clear(); generation++ }
  function unavailable () { failed = true; reset() }
  function update (pos, stateId) {
    if (!pos || ![pos.x, pos.y, pos.z, stateId].every(Number.isSafeInteger) || stateId < 0) throw Error('NATIVE_BLOCK_UPDATE_INVALID')
    const c = chunks.get(key(Math.floor(pos.x / 16), Math.floor(pos.z / 16)))
    if (!c) return // An update is not evidence that the rest of a chunk was loaded.
    const section = Math.floor((pos.y - c.minY) / 16), cells = c.sections[section]
    if (!cells) return
    const index = ((pos.y & 15) << 8) | ((pos.z & 15) << 4) | (pos.x & 15)
    cells[index] = stateId
    c.updatedAt.set(section * 4096 + index, new Date().toISOString())
    if (c.updatedAt.size > 4096) chunks.delete(key(Math.floor(pos.x / 16), Math.floor(pos.z / 16)))
  }
  function onPacket (body) {
    if (failed) return
    const { name, params: p } = body
    try {
      if (name === 'login' || name === 'respawn') { reset(); return }
      if (name === 'unload_chunk') { chunks.delete(key(p.chunkX, p.chunkZ)); return }
      if (name === 'map_chunk') {
        const minY = bot.game?.minY, height = bot.game?.height
        if (!Number.isSafeInteger(minY) || minY % 16 || !Number.isSafeInteger(height) || height < 16 || height > 1024 || height % 16 ||
            !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.z)) throw Error('NATIVE_DIMENSION_BOUNDS_UNKNOWN')
        const sections = []
        visitChunk(Buffer.from(p.chunkData), (index, values) => { sections[index] = Uint32Array.from(values) })
        if (sections.length !== height / 16) throw Error('NATIVE_CHUNK_HEIGHT_MISMATCH')
        const k = key(p.x, p.z); chunks.delete(k)
        chunks.set(k, { minY, sections, observedAt: new Date().toISOString(), updatedAt: new Map() })
        while (chunks.size > maxChunks) chunks.delete(chunks.keys().next().value)
      } else if (name === 'block_change') update(p.location, p.type)
      else if (name === 'multi_block_change') {
        const at = p.chunkCoordinates
        if (!at || ![at.x, at.y, at.z].every(Number.isSafeInteger) || !Array.isArray(p.records) || p.records.length > 4096) throw Error('NATIVE_SECTION_UPDATE_INVALID')
        for (const value of p.records) {
          if (!Number.isSafeInteger(value) || value < 0) throw Error('NATIVE_SECTION_RECORD_INVALID')
          const low = value % 4096
          update({ x: at.x * 16 + (low >> 8), y: at.y * 16 + (low & 15), z: at.z * 16 + ((low >> 4) & 15) }, Math.floor(value / 4096))
        }
      }
    } catch (error) { unavailable(); bot.emit('native_world_unavailable', error.message) }
  }
  function read (pos) {
    if (failed || !pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return null
    const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z)
    const c = chunks.get(key(Math.floor(x / 16), Math.floor(z / 16)))
    const cells = c?.sections[Math.floor((y - c.minY) / 16)]
    if (!cells) return null
    const index = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15)
    const stateId = cells[index], row = catalog.get(stateId)
    if (!row) return null
    return { ...structuredClone(row), position: { x, y, z }, coordinateSystem: 'minecraft_absolute_world_blocks',
      source: 'same_connection_original_chunk', observedAt: c.updatedAt.get(Math.floor((y - c.minY) / 16) * 4096 + index) || c.observedAt,
      geometryAvailable: Array.isArray(row.collisionBoxes) }
  }
  function bind () {
    if (bound) return
    if (typeof bot.blockAt !== 'function') throw Error('MINEFLAYER_BLOCK_READER_REQUIRED')
    original = bot.blockAt
    ours = function (pos, ...args) {
      const row = read(pos)
      if (!row?.geometryAvailable) return null
      const carrier = original.call(bot, pos, ...args)
      if (!carrier) return null
      const block = Object.assign(Object.create(Object.getPrototypeOf(carrier)), carrier)
      block.name = row.name.replace(/^minecraft:/, ''); block.displayName = row.name
      block.type = row.blockId; block.stateId = row.stateId; block.position = carrier.position
      block.shapes = row.collisionBoxes.map(b => [...b]); block.transparent = !row.canOcclude
      block.boundingBox = block.shapes.length ? 'block' : 'empty'
      // Native Property#getName exports canonical strings. prismarine-block's
      // public shape uses booleans for true/false, but leaves numeric ages as
      // strings. Preserve the untouched native representation in the evidence.
      block.getProperties = () => Object.fromEntries(Object.entries(row.properties || {}).map(([key, value]) =>
        [key, value === 'true' ? true : value === 'false' ? false : value]))
      block.hardness = row.destroySpeed ?? null; block.diggable = Number.isFinite(row.destroySpeed) && row.destroySpeed >= 0
      block.nativeObservation = row; block.compatibilityCarrier = { name: carrier.name, stateId: carrier.stateId }
      return block
    }
    bot.blockAt = ours; bound = true
  }
  events.on('packet', onPacket); events.on('unavailable', unavailable)
  return { read, bindBlockReads: bind,
    health: () => ({ failed, generation, bound, chunks: chunks.size }),
    detach () { events.off('packet', onPacket); events.off('unavailable', unavailable); reset(); if (bound && bot.blockAt === ours) bot.blockAt = original; bound = false; failed = true } }
}
module.exports = { readStateCatalog, attachNativeWorld }
