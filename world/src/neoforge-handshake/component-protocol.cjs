'use strict'

// Backend-only codecs, from the exact installed server registry. Do not pass
// customPackets to minecraft-protocol: its global cache would also change the
// vanilla front-end protocol. Native identity/components remain in menu_state.
const fs = require('node:fs')
const mcData = require('minecraft-data')('1.21.1')
const { ProtoDefCompiler } = require('protodef').Compiler
const nbt = require('prismarine-nbt')
const nativeTypes = require('minecraft-protocol/src/datatypes/compiler-minecraft')
const { arsNativeTypes } = require('./native-ars-codec.cjs')
const { arsEntityNativeTypes } = require('./native-ars-entity-codec.cjs')
const { domumNativeTypes } = require('./native-domum-codec.cjs')

// Verified in TLM 1.5.3 InitDataComponent and Patchouli 93: UUIDUtil.STREAM_CODEC
// is fixed 16-byte UUID; ResourceLocation.STREAM_CODEC is a protocol string.
const MOD_CODECS = {
  'touhou_little_maid:init_maid_owner': 'UUID',
  'patchouli:book': 'string',
  'ars_nouveau:spell_caster': 'MawArsSpellCaster',
  'domum_ornamentum:texture_data': 'MawDomumTextureData'
}
// Exact installed TLM 1.5.3 / Ars 5.13.2 stream codecs. The names are mapped
// to the exported network IDs of this server, never to assumed registry order.
const ENTITY_METADATA_CODECS = {
  'touhou_little_maid:maid_schedule': 'varint',
  'touhou_little_maid:maid_chat_bubble': 'MawMaidChatBubbles',
  'ars_nouveau:spell_resolver': 'MawArsSpellResolver',
  'ars_nouveau:vec3': 'MawArsVec3'
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

function createBackendComponentProtocol (registry, particles = null, entitySerializers = null, direction = 'toClient') {
  if (!['toClient', 'toServer'].includes(direction)) throw Error('INVALID_NATIVE_PROTOCOL_DIRECTION')
  const protocol = structuredClone(mcData.protocol)
  const vanillaMappings = protocol.types.SlotComponentType[1].mappings
  const mappings = {}
  for (const name of Object.values(vanillaMappings)) {
    const id = registry.get('minecraft:' + name)
    if (!Number.isSafeInteger(id)) throw Error('MISSING_VANILLA_COMPONENT ' + name)
    mappings[id] = name
  }
  const fields = protocol.types.SlotComponent[1][1].type[1].fields
  // The installed MC 1.21.1 PotionContents.STREAM_CODEC is a three-field
  // composite: optional Potion holder, optional INT color, MobEffect list.
  // Its Mojang mapping and NeoForge 21.1.248 bytecode contain no customName.
  // minecraft-data 3.112.0's 1.21.1 definition includes that later field;
  // reading its extra option byte truncates real entity-equipment packets.
  // Correct only this detached backend schema. The Mineflayer front-end's
  // dependency schema and the server's actual components remain untouched.
  fields.potion_contents = ['container', [
    { name: 'potionId', type: ['option', 'varint'] },
    { name: 'customColor', type: ['option', 'i32'] },
    { name: 'customEffects', type: ['array', { countType: 'varint', type: 'ItemPotionEffect' }] }
  ]]
  for (const [name, id] of registry) {
    if (name.startsWith('minecraft:')) continue
    mappings[id] = name
    fields[name] = MOD_CODECS[name] || 'mawUnsupportedComponent'
  }
  protocol.types.SlotComponentType = ['mapper', { type: 'varint', mappings }]
  protocol.types.SlotComponent[1][1].type[1].default = 'mawUnsupportedComponent'
  protocol.types.MawArsSpellCaster = 'mawArsSpellCasterCodec'
  protocol.types.MawArsSpellResolver = 'mawArsSpellResolverCodec'
  protocol.types.MawArsVec3 = 'mawArsVec3Codec'
  protocol.types.MawDomumTextureData = 'mawDomumTextureDataCodec'
  // NeoForge 21.1.248 CommonHooks keeps vanilla IDs and adds 256 to the
  // custom serializer registry ID. The TSV contains those actual network IDs.
  // TLM maids and Ars spell projectiles use custom serializers; every unknown
  // metadata codec must fail before its payload is mistaken for another key.
  const metadata = protocol.types.entityMetadataEntry[1]
  const metadataMappings = { ...metadata[1].type[1].mappings }
  const metadataFields = metadata[2].type[1].fields
  metadata[2].type[1].default = 'mawUnsupportedEntityMetadata'
  if (entitySerializers) {
    const ids = new Set(Object.keys(metadataMappings).map(Number))
    for (const [name, id] of entitySerializers) {
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(name) ||
          !Number.isSafeInteger(id) || id < 256 || ids.has(id)) throw Error('INVALID_ENTITY_SERIALIZER_REGISTRY')
      ids.add(id)
      metadataMappings[id] = name
      metadataFields[name] = ENTITY_METADATA_CODECS[name] || 'mawUnsupportedEntityMetadata'
    }
    metadata[1].type = ['mapper', { type: 'varint', mappings: metadataMappings }]
  }
  // ChatBubbleRegister$1$1 writes up to five entries. Expiry is a fixed
  // big-endian long, not VarLong. Text is writeJsonWithCodec's UTF-8 JSON
  // string, not the NBT component used by vanilla metadata.
  protocol.types.MawMaidChatBubbleCount = ['mawMaidChatBubbleCount', {}]
  protocol.types.MawMaidChatBubbles = ['array', {
    countType: 'MawMaidChatBubbleCount',
    type: ['container', [
      { name: 'expiresAt', type: 'i64' },
      { name: 'type', type: 'string' },
      { name: 'data', type: ['switch', { compareTo: 'type', fields: {
        'touhou_little_maid:text': ['container', [
          { name: 'text', type: 'string' }, { name: 'background', type: 'string' }
        ]],
        'touhou_little_maid:image': ['container', [
          { name: 'width', type: 'varint' }, { name: 'height', type: 'varint' },
          { name: 'uOffset', type: 'varint' }, { name: 'vOffset', type: 'varint' },
          { name: 'textureWidth', type: 'varint' }, { name: 'textureHeight', type: 'varint' },
          { name: 'background', type: 'string' }, { name: 'image', type: 'string' }
        ]],
        'touhou_little_maid:waiting': ['container', [
          { name: 'background', type: 'string' }, { name: 'text', type: 'string' },
          { name: 'secondaryText', type: ['option', 'string'] }, { name: 'icon', type: 'string' }
        ]],
        'touhou_little_maid:progress': ['container', [
          { name: 'background', type: 'string' }, { name: 'text', type: 'string' },
          { name: 'barBackgroundColor', type: 'i32' }, { name: 'barForegroundColor', type: 'i32' },
          { name: 'progress', type: 'f64' }, { name: 'alignCenter', type: 'bool' }
        ]],
        'touhou_little_maid:emoji': ['container', [{ name: 'background', type: 'string' }]]
      }, default: 'mawUnsupportedChatBubble' }] }
    ]]
  }]
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
  const unsupportedMetadata = () => { throw Error('UNSUPPORTED_NATIVE_ENTITY_METADATA_CODEC') }
  const unsupportedChatBubble = () => { throw Error('UNSUPPORTED_NATIVE_CHAT_BUBBLE_CODEC') }
  const compiler = new ProtoDefCompiler()
  compiler.addTypes(nativeTypes)
  compiler.addTypes(arsNativeTypes)
  compiler.addTypes(arsEntityNativeTypes)
  compiler.addTypes(domumNativeTypes)
  compiler.addTypes({
    Read: {
      mawUnsupportedComponent: ['native', unsupported], mawUnsupportedParticle: ['native', unsupportedParticle],
      mawUnsupportedEntityMetadata: ['native', unsupportedMetadata], mawUnsupportedChatBubble: ['native', unsupportedChatBubble],
      mawMaidChatBubbleCount: ['parametrizable', compiler => compiler.wrapCode(`
const result = ctx.varint(buffer, offset)
if (result.value < 0 || result.value > 5) throw Error('INVALID_NATIVE_CHAT_BUBBLE_COUNT')
return result
      `.trim())]
    },
    Write: {
      mawUnsupportedComponent: ['native', unsupported], mawUnsupportedParticle: ['native', unsupportedParticle],
      mawUnsupportedEntityMetadata: ['native', unsupportedMetadata], mawUnsupportedChatBubble: ['native', unsupportedChatBubble],
      mawMaidChatBubbleCount: ['parametrizable', compiler => compiler.wrapCode(`
if (!Number.isInteger(value) || value < 0 || value > 5) throw Error('INVALID_NATIVE_CHAT_BUBBLE_COUNT')
return ctx.varint(value, buffer, offset)
      `.trim())]
    },
    SizeOf: {
      mawUnsupportedComponent: ['native', unsupported], mawUnsupportedParticle: ['native', unsupportedParticle],
      mawUnsupportedEntityMetadata: ['native', unsupportedMetadata], mawUnsupportedChatBubble: ['native', unsupportedChatBubble],
      mawMaidChatBubbleCount: ['parametrizable', compiler => compiler.wrapCode(`
if (!Number.isInteger(value) || value < 0 || value > 5) throw Error('INVALID_NATIVE_CHAT_BUBBLE_COUNT')
return ctx.varint(value)
      `.trim())]
    }
  })
  compiler.addProtocol(protocol, ['play', direction])
  nbt.addTypesToCompiler('big', compiler)
  const compiled = compiler.compileProtoDefSync()
  const parsePacketBuffer = compiled.parsePacketBuffer.bind(compiled)
  compiled.parsePacketBuffer = (type, buffer, offset = 0) => {
    // minecraft-protocol's equipment array decoder clears continuation bits
    // in-place. Gate emits parsed.buffer/fullBuffer to raw listeners after
    // decoding; parse a private copy so diagnostics and native packet sources
    // retain the exact server wire. Native params still have ordinary slot IDs.
    const parsed = parsePacketBuffer(type, Buffer.from(buffer), offset)
    parsed.buffer = buffer.subarray(0, parsed.metadata.size)
    parsed.fullBuffer = buffer
    return parsed
  }
  return compiled
}

function loadBackendComponentProtocol (file, particleFile = null, entitySerializerFile = null, direction = 'toClient') {
  if (particleFile && !file) throw Error('PARTICLE_PROTOCOL_REQUIRES_COMPONENT_REGISTRY')
  if (entitySerializerFile && !file) throw Error('ENTITY_METADATA_PROTOCOL_REQUIRES_COMPONENT_REGISTRY')
  return file ? createBackendComponentProtocol(registryFromTsv(fs.readFileSync(file, 'utf8')),
    particleFile ? registryFromTsv(fs.readFileSync(particleFile, 'utf8')) : null,
    entitySerializerFile ? registryFromTsv(fs.readFileSync(entitySerializerFile, 'utf8')) : null, direction) : null
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
  // Keep the native decoded packet intact. Only its vanilla front-end
  // projection omits metadata entries whose custom codec has no representation.
  if (Number.isInteger(copy.entityId) && Array.isArray(copy.metadata)) {
    copy.metadata = copy.metadata.filter(entry => !String(entry?.type).includes(':'))
  }
  return copy
}

module.exports = { registryFromTsv, createBackendComponentProtocol, loadBackendComponentProtocol, vanillaProjection, isItemPacket, disconnectComponent }
