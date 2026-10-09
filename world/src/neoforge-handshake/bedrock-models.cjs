'use strict'
const fs = require('node:fs')
const data = require('minecraft-data')('1.21.1')
const TLM_SHA = 'f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27'
const CHANNEL = 'mawbedrock:entity'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

// Only the Bedrock bridge uses these display carriers. Original entity UUID,
// entity ID, movement, interactions and authoritative TLM AI remain unchanged.
class BedrockModels {
  constructor (catalog) {
    if (catalog.schemaVersion !== 1 || catalog.maidMetadata?.jarSha256 !== TLM_SHA ||
      catalog.maidMetadata.model !== 23 || catalog.maidMetadata.isYsm !== 19 ||
      catalog.maidMetadata.ysmModel !== 20 || catalog.maidMetadata.ysmTexture !== 21 ||
      catalog.maidMetadata.defaultModel !== 'touhou_little_maid:hakurei_reimu') throw Error('BEDROCK_MAID_METADATA_NOT_LOCKED')
    this.models = new Map(); this.entities = new Map(); this.ready = false; this.selfState = null
    this.stats = { modelsBound: 0, modelsUnavailable: 0 }
    for (const row of catalog.models) {
      const key = row.kind + '\n' + row.modelId + (row.kind === 'ysm' ? '\n' + row.textureId : '')
      if (this.models.has(key) || !/^maw_native:[a-z0-9_]+$/.test(row.bedrockIdentifier)) throw Error('INVALID_BEDROCK_MODEL_BINDING')
      this.models.set(key, row)
    }
  }

  static load (path) { return path ? new BedrockModels(JSON.parse(fs.readFileSync(path, 'utf8'))) : null }

  activate () {
    if (this.ready) return []
    this.ready = true
    const packets = []
    if (this.selfState) packets.push({ name: 'custom_payload', params: this.selfState })
    for (const [entityId, state] of this.entities) if (state.metadata.size) {
      packets.push({ name: 'entity_metadata', params: { entityId, metadata: [...state.metadata.values()] } })
    }
    return packets
  }

  metadata (state, key, type, fallback) {
    const row = state.metadata.get(key)
    if (!row) return fallback
    if (row.type !== type && row.type !== ({ string: 4, boolean: 8 })[type]) throw Error('BEDROCK_MAID_METADATA_TYPE_MISMATCH')
    if (typeof row.value !== type) throw Error('BEDROCK_MAID_METADATA_VALUE_MISMATCH')
    return row.value
  }

  selected (state) {
    if (this.metadata(state, 19, 'boolean', false)) {
      return this.models.get('ysm\n' + this.metadata(state, 20, 'string', '') + '\n' + this.metadata(state, 21, 'string', ''))
    }
    return this.models.get('touhou\n' + this.metadata(state, 23, 'string', 'touhou_little_maid:hakurei_reimu'))
  }

  project (name, packet, registry) {
    if (name === 'custom_payload' && packet.channel === 'maw_agent:menu_state') {
      this.selfState = { ...packet, data: Buffer.from(packet.data) }
      return this.ready ? undefined : null
    }
    if (name === 'respawn') { this.entities.clear(); this.selfState = null; return undefined }
    if (name === 'entity_destroy') {
      for (const id of packet.entityIds) this.entities.delete(id)
      return undefined
    }
    if (name === 'spawn_entity' && registry?.get(packet.type) === 'touhou_little_maid:maid') {
      if (this.entities.size >= 4096 || !uuid.test(packet.objectUUID || '')) throw Error('INVALID_BEDROCK_MAID_SPAWN')
      this.entities.set(packet.entityId, { spawn: structuredClone(packet), metadata: new Map(), shown: null })
      // Wait for authoritative metadata, including the actual texture suffix.
      return null
    }
    if (name === 'spawn_entity') { this.entities.delete(packet.entityId); return undefined }
    const state = this.entities.get(packet.entityId)
    if (!state) return undefined
    if (name === 'entity_metadata') {
      for (const row of packet.metadata) state.metadata.set(row.key, structuredClone(row))
      if (!this.ready) return null
      const selected = this.selected(state)
      const before = []
      if (!selected) {
        this.stats.modelsUnavailable++
        if (state.shown) before.push({ name: 'entity_destroy', params: { entityIds: [packet.entityId] } })
        state.shown = null
        return before.length ? { before, params: { ...packet, metadata: [] } } : null
      }
      if (selected.bedrockIdentifier !== state.shown) {
        if (state.shown) before.push({ name: 'entity_destroy', params: { entityIds: [packet.entityId] } })
        before.push({ name: 'custom_payload', params: { channel: CHANNEL, data: Buffer.from(JSON.stringify({
          schemaVersion: 1, entityId: packet.entityId, uuid: state.spawn.objectUUID, identifier: selected.bedrockIdentifier
        }), 'utf8') } }, { name: 'spawn_entity', params: { ...state.spawn, type: data.entitiesByName.armor_stand.id, objectData: 0 } })
        state.shown = selected.bedrockIdentifier; this.stats.modelsBound++
      }
      // Entity + LivingEntity fields share the locked inheritance layout.
      // Never let TLM serializer IDs be interpreted as armor-stand fields.
      return { before, params: { ...packet, metadata: [...state.metadata.values()].filter(row => row.key <= 14) } }
    }
    const spawn = state.spawn
    if (name === 'entity_teleport') Object.assign(spawn, { x: packet.x, y: packet.y, z: packet.z, yaw: packet.yaw, pitch: packet.pitch })
    if (name === 'rel_entity_move' || name === 'entity_move_look') {
      spawn.x += packet.dX / 4096; spawn.y += packet.dY / 4096; spawn.z += packet.dZ / 4096
    }
    if (name === 'entity_look' || name === 'entity_move_look') { spawn.yaw = packet.yaw; spawn.pitch = packet.pitch }
    // Continue through the general native attribute/ID adapter after display
    // binding. A known maid must not bypass the vanilla attribute filter.
    return state.shown ? undefined : null
  }
}
module.exports = { BedrockModels, CHANNEL }
