'use strict'
const fs = require('node:fs')
const data = require('minecraft-data')('1.21.1')
const TLM_SHA = 'f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27'
const WANDSCAPE_SHA = 'b9ff4debb039f1fbcac006fd8b53d306e49f8042611b9eb385f292f8c75f0788'
const CHANNEL = 'mawbedrock:entity'
const MOTION_CHANNEL = 'mawbedrock:motion'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

// Only the Bedrock bridge uses these display carriers. Original entity UUID,
// entity ID, movement, interactions and authoritative native AI remain unchanged.
class BedrockModels {
  constructor (catalog, { now = Date.now } = {}) {
    if (catalog.schemaVersion !== 1 || catalog.maidMetadata?.jarSha256 !== TLM_SHA ||
      catalog.maidMetadata.model !== 23 || catalog.maidMetadata.isYsm !== 19 ||
      catalog.maidMetadata.ysmModel !== 20 || catalog.maidMetadata.ysmTexture !== 21 ||
      catalog.maidMetadata.defaultModel !== 'touhou_little_maid:hakurei_reimu') throw Error('BEDROCK_MAID_METADATA_NOT_LOCKED')
    this.models = new Map(); this.entities = new Map(); this.ready = false; this.selfState = null; this.now = now
    this.wandscape = catalog.wandscapeMetadata
    if (this.wandscape && (this.wandscape.jarSha256 !== WANDSCAPE_SHA || this.wandscape.skinVariant !== 16 || this.wandscape.hatColor !== 17 || !Number.isInteger(this.wandscape.skinCount) || this.wandscape.skinCount < 1)) throw Error('BEDROCK_WANDSCAPE_METADATA_NOT_LOCKED')
    this.voices = Boolean(catalog.voices)
    this.globalVoiceFrequency = Number(process.env.GATE_MAID_SOUND_FREQUENCY ?? 1)
    if (!Number.isFinite(this.globalVoiceFrequency) || this.globalVoiceFrequency < 0 || this.globalVoiceFrequency > 1) throw Error('INVALID_GLOBAL_MAID_FREQUENCY')
    this.stats = { modelsBound: 0, modelsUnavailable: 0, motionFrames: 0 }
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
    if (row.type !== type && row.type !== ({ string: 4, boolean: 8, number: 3 })[type] && !(type === 'number' && row.type === 'float')) throw Error('BEDROCK_MAID_METADATA_TYPE_MISMATCH')
    if (typeof row.value !== type) throw Error('BEDROCK_MAID_METADATA_VALUE_MISMATCH')
    return row.value
  }

  selected (state) {
    if (state.kind === 'wandscape') {
      const skin = this.wizardInt(state, 16, -1)
      return this.models.get('wandscape\nwizard_' + (skin >= 0 && skin < this.wandscape.skinCount ? skin : 0))
    }
    if (this.metadata(state, 19, 'boolean', false)) {
      return this.models.get('ysm\n' + this.metadata(state, 20, 'string', '') + '\n' + this.metadata(state, 21, 'string', ''))
    }
    return this.models.get('touhou\n' + this.metadata(state, 23, 'string', 'touhou_little_maid:hakurei_reimu'))
  }

  wizardInt (state, key, fallback) {
    const row = state.metadata.get(key)
    if (!row) return fallback
    if (!['int', 1].includes(row.type) || !Number.isInteger(row.value) || row.value < -2147483648 || row.value > 2147483647) throw Error('BEDROCK_WANDSCAPE_METADATA_INVALID')
    return row.value
  }

  motion (entityId, state, force = false) {
    if (!this.ready || !state.shown) return []
    const at = this.now(), flags = state.metadata.get(0)?.value ?? 0, pose = state.metadata.get(6)?.value ?? 0
    if (!Number.isInteger(flags) || !Number.isInteger(pose)) throw Error('BEDROCK_ACTOR_POSE_INVALID')
    const sitting = state.kind === 'touhou' && ((state.metadata.get(17)?.value ?? 0) & 1) !== 0
    const moving = state.walkUntil > at
    const variant = sitting ? 4 : pose === 2 ? 5 : pose === 3 || flags & 16 ? 6 : pose === 5 || flags & 2 ? 7
      : pose === 1 ? 8 : state.onGround === false && state.rising ? 3 : moving ? flags & 8 ? 2 : 1 : 0
    const swinging = state.swingUntil > at
    if (!force && variant === state.motionPose && swinging === state.motionSwing && at - state.motionAt < 200) return []
    state.motionPose = variant; state.motionSwing = swinging; state.motionAt = at
    this.stats.motionFrames++
    const angle = value => ((value & 255) * 360 / 256 + 180) % 360 - 180
    const frame = { schemaVersion: 1, entityId, uuid: state.spawn.objectUUID, sequence: ++state.motionSequence,
      source: 'same_connection_native_entity_packets', pose: variant, moving, swinging,
      bodyYaw: angle(state.spawn.yaw), headYaw: angle(state.headYaw ?? state.spawn.yaw), pitch: angle(state.spawn.pitch),
      onGround: state.onGround, leaseMs: 500 }
    return [{ name: 'custom_payload', params: { channel: MOTION_CHANNEL, data: Buffer.from(JSON.stringify(frame), 'utf8') } }]
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
    if (name === 'spawn_entity' && (registry?.get(packet.type) === 'touhou_little_maid:maid' || this.wandscape && registry?.get(packet.type) === 'wandscape:wandscape_npc')) {
      if (this.entities.size >= 4096 || !uuid.test(packet.objectUUID || '')) throw Error('INVALID_BEDROCK_MAID_SPAWN')
      this.entities.set(packet.entityId, { spawn: structuredClone(packet), metadata: new Map(), shown: null,
        motionSequence: 0, motionAt: -Infinity, walkUntil: 0, swingUntil: 0, onGround: null,
        kind: registry.get(packet.type) === 'wandscape:wandscape_npc' ? 'wandscape' : 'touhou' })
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
      const hatColor = state.kind === 'wandscape' ? (this.wizardInt(state, 17, 0) || 0xff5030a0) & 0xffffff : 0
      const before = []
      if (!selected) {
        this.stats.modelsUnavailable++
        if (state.shown) before.push({ name: 'entity_destroy', params: { entityIds: [packet.entityId] } })
        state.shown = null
        return before.length ? { before, params: { ...packet, metadata: [] } } : null
      }
      if (selected.bedrockIdentifier !== state.shown || state.hatColor !== hatColor) {
        state.voiceConfig = null // The remove/spawn below replaces the extension's per-entity cache.
        state.motionAt = -Infinity
        if (state.shown) before.push({ name: 'entity_destroy', params: { entityIds: [packet.entityId] } })
        before.push({ name: 'custom_payload', params: { channel: CHANNEL, data: Buffer.from(JSON.stringify({
          schemaVersion: 1, entityId: packet.entityId, uuid: state.spawn.objectUUID, identifier: selected.bedrockIdentifier, ...(state.kind === 'wandscape' ? { hatColor } : {})
        }), 'utf8') } }, { name: 'spawn_entity', params: { ...state.spawn,
          // ViaVersion supplies default armor-stand head poses. Geyser packs
          // them into MARK_VARIANT, which would overwrite the native hat RGB.
          // The pinned golem translator leaves that field unused. This is only
          // a display carrier: the original UUID, hit target and server AI stay.
          type: data.entitiesByName[state.kind === 'wandscape' ? 'iron_golem' : 'armor_stand'].id, objectData: 0 } })
        state.shown = selected.bedrockIdentifier; this.stats.modelsBound++
        state.hatColor = hatColor
      }
      if (this.voices && state.kind !== 'wandscape') {
        const frequency = this.metadata(state, 50, 'number', 1)
        if (!Number.isFinite(frequency) || frequency < 0 || frequency > 1) throw Error('INVALID_MAID_VOICE_FREQUENCY')
        const config = JSON.stringify({ schemaVersion: 1, entityId: packet.entityId, uuid: state.spawn.objectUUID,
          pack: this.metadata(state, 24, 'string', null),
          frequency: frequency * this.globalVoiceFrequency, silent: this.metadata(state, 4, 'boolean', false) })
        if (config !== state.voiceConfig) {
          before.push({ name: 'custom_payload', params: { channel: 'mawbedrock:voice_config', data: Buffer.from(config) } })
          state.voiceConfig = config
        }
      }
      // Entity + LivingEntity fields share the locked inheritance layout.
      // Never let TLM serializer IDs be interpreted as armor-stand fields.
      before.push(...this.motion(packet.entityId, state))
      return { before, params: { ...packet, metadata: [...state.metadata.values()].filter(row => row.key <= 14) } }
    }
    const spawn = state.spawn
    if (name === 'entity_teleport') {
      Object.assign(spawn, { x: packet.x, y: packet.y, z: packet.z, yaw: packet.yaw, pitch: packet.pitch })
      // A teleport is a relocation, not evidence of walking speed.
      state.walkUntil = 0; state.rising = false
    }
    if (name === 'rel_entity_move' || name === 'entity_move_look') {
      spawn.x += packet.dX / 4096; spawn.y += packet.dY / 4096; spawn.z += packet.dZ / 4096
      if (packet.dX || packet.dZ) state.walkUntil = this.now() + 300
      state.rising = packet.dY > 0
    }
    if (name === 'entity_look' || name === 'entity_move_look') { spawn.yaw = packet.yaw; spawn.pitch = packet.pitch }
    if (name === 'entity_head_rotation') state.headYaw = packet.headYaw
    if (typeof packet.onGround === 'boolean') state.onGround = packet.onGround
    if (name === 'animation' && [0, 3].includes(packet.animation)) state.swingUntil = this.now() + 350
    // Continue through the general native attribute/ID adapter after display
    // binding. A known maid must not bypass the vanilla attribute filter.
    if (!state.shown) return null
    if (!['rel_entity_move', 'entity_move_look', 'entity_teleport', 'entity_look', 'entity_head_rotation', 'animation'].includes(name)) return undefined
    const before = this.motion(packet.entityId, state)
    return before.length ? { before, params: packet } : undefined
  }
}
module.exports = { BedrockModels, CHANNEL, MOTION_CHANNEL }
