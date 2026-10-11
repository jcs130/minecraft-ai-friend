'use strict'
const { EventEmitter } = require('node:events')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { loadBackendComponentProtocol } = require('../neoforge-handshake/component-protocol.cjs')

// This is a read-only presentation adapter, NOT a Mineflayer login or control
// body. Its UUID, pose, inventory and packets all come from one owned Numen.
class NumenViewerBody extends EventEmitter {
  constructor ({ bodyId, name, registryDirectory, assetDirectory, registrySha256 }) {
    super()
    if (!/^[a-f0-9-]{36}$/.test(bodyId) || !/^[A-Za-z0-9_]{1,16}$/.test(name)) throw Error('NUMEN_VIEWER_IDENTITY_INVALID')
    this.username = name; this._client = new EventEmitter(); this._client.uuid = bodyId; this._client.username = name
    this.registry = { dimensionsByName: {} }; this.players = {}; this.sequence = 0; this.binding = null; this.frame = null
    this.stream = { events: new EventEmitter() }; this.hash = registrySha256; this.entityPackets = new Map(); this.columnCursor = 0; this.loadedColumns = new Map()
    this.protocol = loadBackendComponentProtocol(path.join(registryDirectory, 'components.tsv'), path.join(registryDirectory, 'particles.tsv'), path.join(registryDirectory, 'entity-data-serializers.tsv'))
    const states = fs.readFileSync(path.join(assetDirectory, 'registry/block-states.jsonl'))
    if (createHash('sha256').update(states).digest('hex') !== registrySha256) throw Error('NUMEN_VIEWER_ASSET_REGISTRY_MISMATCH')
    this.stateCount = states.toString('utf8').trim().split('\n').length
  }
  packet (name, params) { this.stream.events.emit('packet', { schemaVersion: 1, minecraftVersion: '1.21.1', registrySha256: this.hash, sequence: ++this.sequence, name, params }) }
  columns () {
    if (!this.entity) return []
    const x = Math.floor(this.entity.position.x / 16), z = Math.floor(this.entity.position.z / 16)
    const rows = []
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) rows.push([x + dx, z + dz])
    rows.sort((a, b) => (a[0] - x) ** 2 + (a[1] - z) ** 2 - (b[0] - x) ** 2 - (b[1] - z) ** 2)
    const selected = [rows[this.columnCursor++ % rows.length], rows[this.columnCursor++ % rows.length]]
    return selected
  }
  update (frame) {
    if (frame?.schemaVersion !== 1 || frame.source !== 'numen_server_body' || frame.playerUuid !== this._client.uuid || frame.name !== this.username || !frame.ok) throw Error('NUMEN_VIEWER_FRAME_IDENTITY_MISMATCH')
    if (frame.blockStatesCount !== undefined && frame.blockStatesCount !== this.stateCount) throw Error('NUMEN_VIEWER_NATIVE_REGISTRY_CHANGED')
    if (!Array.isArray(frame.packets) || frame.packets.length > 450 || !Array.isArray(frame.entityIds) || frame.entityIds.length > 96) throw Error('NUMEN_VIEWER_FRAME_BUDGET')
    const binding = `${frame.entityId}:${frame.dimension.name}`
    if (binding !== this.binding || !this.entity) {
      this.binding = binding; this.columnCursor = 0; this.entityPackets.clear(); this.loadedColumns.clear()
      this.registry.dimensionsByName[frame.dimension.name.replace('minecraft:', '')] = frame.dimension
      this.packet('respawn', { worldState: { dimension: frame.dimension.name, name: frame.dimension.name, hashedSeed: frame.biomeSeed } })
      this.emit('spawn')
    }
    if (Array.isArray(frame.biomes)) {
      const rows = [...frame.biomes].sort((a, b) => a.id - b.id)
      if (rows.some((row, id) => row.id !== id)) throw Error('NUMEN_VIEWER_BIOME_REGISTRY_INVALID')
      this._client.emit('registry_data', { id: 'minecraft:worldgen/biome', entries: rows.map(row => ({ key: row.key, value: row.value })) })
    }
    const p = frame.pose, self = frame.menu?.self
    if (!p || ![p.x, p.y, p.z, p.yaw, p.pitch, p.eyeHeight].every(Number.isFinite) || frame.menu?.playerUuid !== this._client.uuid || !self) throw Error('NUMEN_VIEWER_BODY_STATE_INVALID')
    this.entity = { id: frame.entityId, uuid: this._client.uuid, username: this.username, isValid: true,
      position: { x: p.x, y: p.y, z: p.z }, yaw: p.yaw, pitch: p.pitch, eyeHeight: p.eyeHeight, onGround: frame.onGround,
      attributes: { 'minecraft:generic.max_health': { value: self.maxHealth, modifiers: [] } } }
    this.health = self.health; this.food = self.food; this.foodSaturation = self.saturation; this.quickBarSlot = frame.menu.selectedHotbarSlot
    this.experience = { level: self.experienceLevel, progress: self.experienceProgress, points: self.experiencePoints }
    this.isRaining = frame.raining; this.rainState = frame.rain; this.thunderState = frame.thunder
    this.players[this.username] = { uuid: this._client.uuid, username: this.username, skinData: frame.hasCustomTextures ? {} : null }
    const keep = new Set(frame.entityIds), gone = []
    for (const [key] of this.loadedColumns) {
      const [x, z] = key.split(',').map(Number)
      if (Math.abs(x - Math.floor(p.x / 16)) > 2 || Math.abs(z - Math.floor(p.z / 16)) > 2) {
        this.loadedColumns.delete(key); this.packet('unload_chunk', { chunkX: x, chunkZ: z })
      }
    }
    for (const [id] of this.entityPackets) if (!keep.has(id)) { this.entityPackets.delete(id); gone.push(id) }
    if (gone.length) this.packet('entity_destroy', { entityIds: gone })
    for (const encoded of frame.packets) {
      if (typeof encoded !== 'string' || encoded.length > 1400000) throw Error('NUMEN_VIEWER_PACKET_BUDGET')
      const wire = Buffer.from(encoded, 'base64'), parsed = this.protocol.parsePacketBuffer('packet', wire)
      if (parsed.metadata.size !== wire.length) throw Error('NUMEN_VIEWER_PACKET_LENGTH_MISMATCH')
      const { name, params } = parsed.data
      if (!['map_chunk', 'spawn_entity', 'entity_metadata', 'entity_equipment', 'entity_teleport'].includes(name)) throw Error('NUMEN_VIEWER_PACKET_NOT_ALLOWED')
      if (name === 'map_chunk') {
        const key = `${params.x},${params.z}`, hash = createHash('sha256').update(wire).digest('hex')
        if (this.loadedColumns.get(key) !== hash) { this.packet(name, params); this.loadedColumns.set(key, hash) }
        continue
      }
      const id = params.entityId
      if (!keep.has(id)) throw Error('NUMEN_VIEWER_ENTITY_NOT_TRACKED')
      const cache = this.entityPackets.get(id) || new Map(); this.entityPackets.set(id, cache)
      if (name === 'spawn_entity' && cache.has(name)) continue
      if (cache.get(name) !== encoded) { this.packet(name, params); cache.set(name, encoded) }
    }
    this.packet('update_time', { age: String(frame.age), time: String(frame.day) })
    // Bound memory to the actual nearby columns, including after teleports.
    this.frame = frame; this.emit('physicsTick')
  }
  suspend () { if (this.entity) { this.entity = null; this.frame = null; this.emit('death') } }
}
module.exports = { NumenViewerBody }
