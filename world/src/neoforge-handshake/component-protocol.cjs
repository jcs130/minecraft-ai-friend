'use strict'

// Backend-only codecs, from the exact installed server registry. Do not pass
// customPackets to minecraft-protocol: its global cache would also change the
// vanilla front-end protocol. Native identity/components remain in menu_state.
const fs = require('node:fs')
const mcData = require('minecraft-data')('1.21.1')
const { ProtoDefCompiler } = require('protodef').Compiler
const nbt = require('prismarine-nbt')
const nativeTypes = require('minecraft-protocol/src/datatypes/compiler-minecraft')

// Verified in TLM 1.5.3 InitDataComponent and Patchouli 93: UUIDUtil.STREAM_CODEC
// is fixed 16-byte UUID; ResourceLocation.STREAM_CODEC is a protocol string.
const MOD_CODECS = {
  'touhou_little_maid:init_maid_owner': 'UUID',
  'patchouli:book': 'string'
}
// minecraft-data's 1.21.1 wire names for these two particles differ from the
// actual BuiltInRegistries names. Resolve the verified aliases by name, not ID.
const PARTICLE_ALIASES = {
  trial_spawner_detected_player: 'trial_spawner_detection',
  trial_spawner_detected_player_ominous: 'trial_spawner_detection_ominous'
}
const ITEM_PACKET_NAMES = new Set(['window_items', 'set_slot', 'entity_equipment', 'trade_list', 'world_particles', 'entity_metadata'])
const packetMappings = mcData.protocol.play.toClient.types.packet[1][0].type[1].mappings
const itemPacketIds = new Set(Object.entries(packetMappings).filter(([, name]) => ITEM_PACKET_NAMES.has(name)).map(([id]) => Number(id)))
function isItemPacket (buffer) { return itemPacketIds.has(buffer[0]) }

function disconnectComponent (message) {
  return { type: 'compound', value: { text: { type: 'string', value: String(message) } } }
}

function registryFromTsv (text) {
  const result = new Map()
  const ids = new Set()
  for (const line of text.trim().split(/\r?\n/)) {
    const [name, rawId] = line.split('\t')
    const id = Number(rawId)
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(name || '') ||
        !/^\d+$/.test(rawId || '') || !Number.isSafeInteger(id) ||
        result.has(name) || ids.has(id)) throw Error('INVALID_COMPONENT_REGISTRY')
    result.set(name, id)
    ids.add(id)
  }
  return result
}

function createBackendComponentProtocol (registry, particles = null) {
  const protocol = structuredClone(mcData.protocol)
  const vanillaMappings = protocol.types.SlotComponentType[1].mappings
  const mappings = {}
  for (const name of Object.values(vanillaMappings)) {
    const id = registry.get('minecraft:' + name)
    if (!Number.isSafeInteger(id)) throw Error('MISSING_VANILLA_COMPONENT ' + name)
    mappings[id] = name
  }
  const fields = protocol.types.SlotComponent[1][1].type[1].fields
  for (const [name, id] of registry) {
    if (name.startsWith('minecraft:')) continue
    mappings[id] = name
    fields[name] = MOD_CODECS[name] || 'mawUnsupportedComponent'
  }
  protocol.types.SlotComponentType = ['mapper', { type: 'varint', mappings }]
  protocol.types.SlotComponent[1][1].type[1].default = 'mawUnsupportedComponent'
  if (particles) {
    const definition = protocol.types.Particle[1]
    const nativeParticleMappings = {}
    const particleFields = definition[1].type[1].fields
    for (const name of Object.values(definition[0].type[1].mappings)) {
      const id = particles.get('minecraft:' + (PARTICLE_ALIASES[name] || name))
      if (!Number.isSafeInteger(id)) throw Error('MISSING_VANILLA_PARTICLE ' + name)
      nativeParticleMappings[id] = name
      particleFields[name] ||= 'void'
    }
    for (const [name, id] of particles) {
      if (name.startsWith('minecraft:')) continue
      nativeParticleMappings[id] = name
      particleFields[name] = name === 'create:rotation_indicator'
        ? ['container', [
            { name: 'color', type: 'i32' }, { name: 'speed', type: 'f32' },
            { name: 'radius1', type: 'f32' }, { name: 'radius2', type: 'f32' },
            { name: 'lifeSpan', type: 'i32' },
            // Create 6.0.10 + Catnip in Ponder 1.0.82: enum ordinal VarInt.
            { name: 'axis', type: ['mapper', { type: 'varint', mappings: { 0: 'x', 1: 'y', 2: 'z' } }] }
          ]]
        : 'mawUnsupportedParticle'
    }
    definition[0].type = ['mapper', { type: 'varint', mappings: nativeParticleMappings }]
    definition[1].type[1].default = 'mawUnsupportedParticle'
  }
  const unsupported = () => { throw Error('UNSUPPORTED_NATIVE_ITEM_COMPONENT') }
  const unsupportedParticle = () => { throw Error('UNSUPPORTED_NATIVE_PARTICLE_CODEC') }
  const compiler = new ProtoDefCompiler()
  compiler.addTypes(nativeTypes)
  compiler.addTypes({
    Read: { mawUnsupportedComponent: ['native', unsupported], mawUnsupportedParticle: ['native', unsupportedParticle] },
    Write: { mawUnsupportedComponent: ['native', unsupported], mawUnsupportedParticle: ['native', unsupportedParticle] },
    SizeOf: { mawUnsupportedComponent: ['native', unsupported], mawUnsupportedParticle: ['native', unsupportedParticle] }
  })
  compiler.addProtocol(protocol, ['play', 'toClient'])
  nbt.addTypesToCompiler('big', compiler)
  return compiler.compileProtoDefSync()
}

function loadBackendComponentProtocol (file, particleFile = null) {
  if (particleFile && !file) throw Error('PARTICLE_PROTOCOL_REQUIRES_COMPONENT_REGISTRY')
  return file ? createBackendComponentProtocol(registryFromTsv(fs.readFileSync(file, 'utf8')),
    particleFile ? registryFromTsv(fs.readFileSync(particleFile, 'utf8')) : null) : null
}

// The vanilla connection cannot receive mod component type IDs. Strip only
// their wire projections; never alter the actual server inventory or menu SNBT.
// Recurse to cover containers, charged projectiles, carried items and equipment.
function vanillaProjection (value) {
  if (value === null || typeof value !== 'object' || Buffer.isBuffer(value)) return value
  if (Array.isArray(value)) return value.map(vanillaProjection)
  const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, vanillaProjection(item)]))
  if ('itemCount' in copy && Array.isArray(copy.components)) {
    copy.components = copy.components.filter(component => !String(component.type).includes(':'))
    copy.removeComponents = (copy.removeComponents || []).filter(component => !String(component.type).includes(':'))
    copy.addedComponentCount = copy.components.length
    copy.removedComponentCount = copy.removeComponents.length
  }
  return copy
}

module.exports = { registryFromTsv, createBackendComponentProtocol, loadBackendComponentProtocol, vanillaProjection, isItemPacket, disconnectComponent }
