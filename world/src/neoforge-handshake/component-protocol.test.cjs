'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const mcData = require('minecraft-data')('1.21.1')
const mc = require('minecraft-protocol')
const { registryFromTsv, createBackendComponentProtocol, vanillaProjection, isItemPacket, disconnectComponent } = require('./component-protocol.cjs')
const vanilla = mcData.protocol.types.SlotComponentType[1].mappings
const registry = new Map(Object.entries(vanilla).map(([id, name]) => ['minecraft:' + name, Number(id)]))
registry.set('touhou_little_maid:init_maid_owner', 86)
registry.set('patchouli:book', 88)
registry.set('test:unsupported', 89)
const protocol = createBackendComponentProtocol(registry)
const empty = { itemCount: 0 }
const stack = (itemId, components) => ({ itemCount: 1, itemId, addedComponentCount: components.length, removedComponentCount: 0, components, removeComponents: [] })
const owner = '600c9882-ac6c-4620-a5c8-2ec6588aa3b9'
const maid = stack(1400, [{ type: 'touhou_little_maid:init_maid_owner', data: owner }])
const book = stack(1401, [{ type: 'patchouli:book', data: 'touhou_little_maid:memorizable_gensokyo' }])
const particleRegistry = () => new Map(Object.entries(mcData.protocol.types.Particle[1][0].type[1].mappings).map(([id, name]) => [
  'minecraft:' + ({ trial_spawner_detected_player: 'trial_spawner_detection', trial_spawner_detected_player_ominous: 'trial_spawner_detection_ominous' }[name] || name), Number(id)
]))

test('decodes native UUID and guidebook components without changing the vanilla protocol', async () => {
  const packet = { name: 'window_items', params: { windowId: 0, stateId: 7, items: [maid, book, empty], carriedItem: empty } }
  const buffer = protocol.createPacketBuffer('packet', packet)
  assert.equal(isItemPacket(buffer), true)
  const parsed = protocol.parsePacketBuffer('packet', buffer)
  assert.equal(parsed.metadata.size, buffer.length)
  assert.equal(parsed.data.params.items[0].components[0].data, owner)
  assert.equal(parsed.data.params.items[1].components[0].data, 'touhou_little_maid:memorizable_gensokyo')
  assert.equal(Object.hasOwn(mcData.protocol.types.SlotComponentType[1].mappings, '86'), false)
  const projected = vanillaProjection(parsed.data)
  assert.equal(projected.params.items[0].addedComponentCount, 0)
  assert.equal(projected.params.items[0].itemCount, 1)
  assert.equal(parsed.data.params.items[0].components.length, 1)
  const serializer = mc.createSerializer({ state: 'play', isServer: true, version: '1.21.1' })
  const parser = mc.createDeserializer({ state: 'play', isServer: false, version: '1.21.1' })
  const result = new Promise((resolve, reject) => { parser.once('data', resolve); parser.once('error', reject); serializer.once('error', reject) })
  serializer.pipe(parser)
  serializer.end(projected)
  const front = await result
  assert.equal(front.data.params.items[0].itemCount, 1)
  assert.equal(front.data.params.items[0].components.length, 0)
})

test('recursively projects nested container stacks while preserving names and component removals', () => {
  const name = { type: 'custom_name', data: { type: 'string', value: '女仆召唤道具' } }
  const container = stack(1, [{ type: 'container', data: { items: [maid] } }, name])
  container.removeComponents = [{ type: 'patchouli:book' }, { type: 'lore' }]
  container.removedComponentCount = 2
  const front = vanillaProjection(container)
  assert.equal(front.components[0].data.items[0].components.length, 0)
  assert.deepEqual(front.components[1], name)
  assert.equal(front.removedComponentCount, 1)
  assert.deepEqual(front.removeComponents, [{ type: 'lore' }])
  assert.equal(container.components[0].data.items[0].components.length, 1)
})

test('an unsupported native codec explicitly fails instead of consuming a neighbouring stack', () => {
  const packet = { name: 'set_slot', params: { windowId: 0, stateId: 1, slot: 36, item: empty } }
  const emptyPacket = protocol.createPacketBuffer('packet', packet)
  const buffer = Buffer.concat([emptyPacket.subarray(0, -1), Buffer.from([1, 1, 1, 0, 89, 123])])
  assert.throws(() => protocol.parsePacketBuffer('packet', buffer), /UNSUPPORTED_NATIVE_ITEM_COMPONENT/)
})

test('does not route mod command trees or regular keepalive packets through the item decoder', () => {
  assert.equal(isItemPacket(Buffer.from([0x11])), false)
  assert.equal(isItemPacket(Buffer.from([0x26])), false)
})

test('registry export rejects duplicate IDs, missing vanilla types and malformed rows', () => {
  assert.throws(() => registryFromTsv('minecraft:custom_data\t0\npatchouli:book\t0'), /INVALID/)
  assert.throws(() => registryFromTsv('patchouli:book\tbad'), /INVALID/)
  assert.throws(() => createBackendComponentProtocol(new Map()), /MISSING_VANILLA/)
  assert.equal(registryFromTsv('patchouli:book\t88').get('patchouli:book'), 88)
})

test('the explicit incompatibility reason remains readable NBT in play and configuration', async () => {
  for (const [state, name] of [['play', 'kick_disconnect'], ['configuration', 'disconnect']]) {
    const message = '模组物品协议尚未适配，无法安全同步背包'
    const serializer = mc.createSerializer({ state, isServer: true, version: '1.21.1' })
    const parser = mc.createDeserializer({ state, isServer: false, version: '1.21.1' })
    const result = new Promise((resolve, reject) => { parser.once('data', resolve); parser.once('error', reject); serializer.once('error', reject) })
    serializer.pipe(parser)
    serializer.end({ name, params: { reason: disconnectComponent(message) } })
    assert.equal((await result).data.params.reason.value.text.value, message)
  }
})

test('native Create rotation particle decodes an independent raw wire fixture using the exported type ID', () => {
  const particles = particleRegistry()
  particles.set('create:rotation_indicator', 319)
  const native = createBackendComponentProtocol(registry, particles)
  // Actual layout: packet ID, ordinary particle header, native registry VarInt,
  // INT color, FLOAT speed/radii, INT lifetime, Catnip enum ordinal VarInt.
  const buffer = Buffer.alloc(69)
  let offset = 0
  buffer[offset++] = 0x29; buffer[offset++] = 0
  for (const value of [3.5, 65.5, -1.5]) { buffer.writeDoubleBE(value, offset); offset += 8 }
  for (const value of [0, 0, 0, 0]) { buffer.writeFloatBE(value, offset); offset += 4 }
  buffer.writeInt32BE(1, offset); offset += 4
  buffer[offset++] = 0xbf; buffer[offset++] = 2 // Native type ID 319, not a hardcoded modpack ID.
  buffer.writeInt32BE(0xf0bf62, offset); offset += 4
  for (const value of [-32, 0.25, 0.375]) { buffer.writeFloatBE(value, offset); offset += 4 }
  buffer.writeInt32BE(20, offset); offset += 4
  buffer[offset++] = 1 // Axis.Y
  assert.equal(offset, buffer.length)
  const parsed = native.parsePacketBuffer('packet', buffer)
  assert.equal(parsed.metadata.size, buffer.length)
  assert.equal(parsed.data.name, 'world_particles')
  assert.equal(parsed.data.params.particle.type, 'create:rotation_indicator')
  assert.deepEqual(parsed.data.params.particle.data, { color: 0xf0bf62, speed: -32, radius1: 0.25, radius2: 0.375, lifeSpan: 20, axis: 'y' })
  assert.deepEqual(native.createPacketBuffer('packet', parsed.data), buffer)
  assert.equal(Object.hasOwn(mcData.protocol.types.Particle[1][0].type[1].mappings, '319'), false)
})

test('native particle protocol keeps ordinary particles and rejects unsupported mod codecs', () => {
  const particles = particleRegistry()
  particles.set('test:unsupported_particle', 400)
  const native = createBackendComponentProtocol(registry, particles)
  const params = { longDistance: false, x: 0, y: 0, z: 0, offsetX: 0, offsetY: 0, offsetZ: 0, velocityOffset: 0, amount: 1, particle: { type: 'cloud' } }
  const buffer = native.createPacketBuffer('packet', { name: 'world_particles', params })
  const parsed = native.parsePacketBuffer('packet', buffer)
  assert.equal(parsed.metadata.size, buffer.length)
  assert.equal(parsed.data.params.particle.type, 'cloud')
  const unknown = Buffer.concat([buffer.subarray(0, -1), Buffer.from([0x90, 3, 123])])
  assert.throws(() => native.parsePacketBuffer('packet', unknown), /UNSUPPORTED_NATIVE_PARTICLE_CODEC/)
})

const metadataRegistry = () => new Map([
  ['touhou_little_maid:maid_schedule', 301],
  ['touhou_little_maid:maid_chat_bubble', 335],
  ['test:unsupported_serializer', 600]
])
const wireVarInt = value => {
  const bytes = []
  do { bytes.push((value & 0x7f) | (value >>> 7 ? 0x80 : 0)); value >>>= 7 } while (value)
  return Buffer.from(bytes)
}
const wireString = value => {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([wireVarInt(bytes.length), bytes])
}

test('TLM chat bubble independently encoded wire fixture reads JSON text and fixed long then the next vanilla entry', () => {
  const serializers = metadataRegistry()
  const native = createBackendComponentProtocol(registry, null, serializers)
  const expiry = Buffer.alloc(8)
  expiry.writeBigInt64BE(1791097836958n)
  // Sanitised text with the exact installed JAR's wire layout. Network IDs
  // deliberately differ from the current lab, exercising exported mappings.
  const text = '"女仆欢迎你"'
  const background = 'touhou_little_maid:textures/entity/chat_bubble/type2.png'
  const buffer = Buffer.concat([
    Buffer.from([0x58]), wireVarInt(2963), Buffer.from([37]),
    wireVarInt(serializers.get('touhou_little_maid:maid_chat_bubble')),
    wireVarInt(1), expiry, wireString('touhou_little_maid:text'), wireString(text), wireString(background),
    Buffer.from([32]), wireVarInt(serializers.get('touhou_little_maid:maid_schedule')), wireVarInt(2),
    Buffer.from([1, 1]), wireVarInt(300), Buffer.from([0xff])
  ])
  assert.equal(isItemPacket(buffer), true)
  const parsed = native.parsePacketBuffer('packet', buffer)
  assert.equal(parsed.metadata.size, buffer.length)
  assert.equal(parsed.data.params.entityId, 2963)
  const [chat, schedule, vanillaEntry] = parsed.data.params.metadata
  assert.equal(chat.key, 37)
  assert.equal(chat.type, 'touhou_little_maid:maid_chat_bubble')
  assert.equal(chat.value[0].expiresAt.toString(), '1791097836958')
  assert.deepEqual(chat.value[0].data, { text, background })
  assert.equal(schedule.type, 'touhou_little_maid:maid_schedule')
  assert.equal(schedule.value, 2)
  assert.deepEqual(vanillaEntry, { key: 1, type: 'int', value: 300 })
  assert.deepEqual(native.createPacketBuffer('packet', parsed.data), buffer)
  assert.equal(Object.hasOwn(mcData.protocol.types.entityMetadataEntry[1][1].type[1].mappings, '335'), false)
})

test('all five installed TLM bubble codecs roundtrip alongside native item stack metadata', () => {
  const native = createBackendComponentProtocol(registry, null, metadataRegistry())
  const bubbles = [
    { type: 'touhou_little_maid:text', data: { text: '{"text":"欢迎"}', background: 'test:bg' } },
    { type: 'touhou_little_maid:image', data: { width: 12, height: 24, uOffset: 3, vOffset: 4, textureWidth: 64, textureHeight: 128, background: 'test:bg', image: 'test:image' } },
    { type: 'touhou_little_maid:waiting', data: { background: 'test:bg', text: '"等待"', secondaryText: '"继续"', icon: 'test:icon' } },
    { type: 'touhou_little_maid:progress', data: { background: 'test:bg', text: '"进度"', barBackgroundColor: -1234, barForegroundColor: 5678, progress: 0.625, alignCenter: true } },
    { type: 'touhou_little_maid:emoji', data: { background: 'test:bg' } }
  ].map(value => ({ expiresAt: [417, 999], ...value }))
  const packet = { name: 'entity_metadata', params: { entityId: 42, metadata: [
    { key: 37, type: 'touhou_little_maid:maid_chat_bubble', value: bubbles },
    { key: 39, type: 'item_stack', value: maid },
    { key: 16, type: 'boolean', value: true }
  ] } }
  const buffer = native.createPacketBuffer('packet', packet)
  const parsed = native.parsePacketBuffer('packet', buffer)
  assert.equal(parsed.metadata.size, buffer.length)
  assert.deepEqual(parsed.data.params.metadata[0].value.map(value => ({ type: value.type, data: value.data })),
    bubbles.map(value => ({ type: value.type, data: value.data })))
  assert.equal(parsed.data.params.metadata[1].value.components[0].data, owner)
  assert.deepEqual(native.createPacketBuffer('packet', parsed.data), buffer)
  const absentSecondary = { ...bubbles[2], data: { ...bubbles[2].data, secondaryText: undefined } }
  const nullable = { name: 'entity_metadata', params: { entityId: 42, metadata: [
    { key: 37, type: 'touhou_little_maid:maid_chat_bubble', value: [absentSecondary] }
  ] } }
  assert.equal(native.parsePacketBuffer('packet', native.createPacketBuffer('packet', nullable)).data.params.metadata[0].value[0].data.secondaryText, undefined)
})

test('vanilla metadata projection removes only custom fields and retains native decoded data and item names', async () => {
  const native = createBackendComponentProtocol(registry, null, metadataRegistry())
  const named = stack(1, [{ type: 'custom_name', data: { type: 'string', value: '女仆的背包' } }, ...maid.components])
  const packet = { name: 'entity_metadata', params: { entityId: 42, metadata: [
    { key: 32, type: 'touhou_little_maid:maid_schedule', value: 0 },
    { key: 37, type: 'touhou_little_maid:maid_chat_bubble', value: [] },
    { key: 39, type: 'item_stack', value: named },
    { key: 16, type: 'boolean', value: true }
  ] } }
  const decoded = native.parsePacketBuffer('packet', native.createPacketBuffer('packet', packet)).data
  const projected = vanillaProjection(decoded)
  assert.equal(decoded.params.metadata.length, 4)
  assert.equal(projected.params.entityId, decoded.params.entityId)
  assert.deepEqual(projected.params.metadata.map(item => item.type), ['item_stack', 'boolean'])
  assert.equal(projected.params.metadata[0].value.components[0].type, 'custom_name')
  assert.equal(projected.params.metadata[0].value.components.length, 1)
  assert.equal(decoded.params.metadata[2].value.components.length, 2)
  const serializer = mc.createSerializer({ state: 'play', isServer: true, version: '1.21.1' })
  const parser = mc.createDeserializer({ state: 'play', isServer: false, version: '1.21.1' })
  const result = new Promise((resolve, reject) => { parser.once('data', resolve); parser.once('error', reject); serializer.once('error', reject) })
  serializer.pipe(parser)
  serializer.end(projected)
  const front = await result
  assert.equal(front.data.params.metadata.length, 2)
  assert.equal(front.data.params.entityId, 42)
})

test('unknown exported or unexported metadata serializers fail before reading neighbouring fields', () => {
  const native = createBackendComponentProtocol(registry, null, metadataRegistry())
  for (const id of [600, 601]) {
    const buffer = Buffer.concat([Buffer.from([0x58, 42, 37]), wireVarInt(id), Buffer.from([0, 1, 1, 10, 0xff])])
    assert.throws(() => native.parsePacketBuffer('packet', buffer), /UNSUPPORTED_NATIVE_ENTITY_METADATA_CODEC/)
  }
})

test('TLM chat bubble decoder rejects unknown extensions, oversized collections and truncated bodies', () => {
  const serializers = metadataRegistry()
  const native = createBackendComponentProtocol(registry, null, serializers)
  const header = Buffer.concat([Buffer.from([0x58, 42, 37]), wireVarInt(serializers.get('touhou_little_maid:maid_chat_bubble'))])
  assert.throws(() => native.parsePacketBuffer('packet', Buffer.concat([header, Buffer.from([6, 0xff])])), /INVALID_NATIVE_CHAT_BUBBLE_COUNT/)
  assert.throws(() => native.parsePacketBuffer('packet', Buffer.concat([header, wireVarInt(-1), Buffer.from([0xff])])), /INVALID_NATIVE_CHAT_BUBBLE_COUNT/)
  const unknown = Buffer.concat([header, Buffer.from([1]), Buffer.alloc(8), wireString('test:future_bubble'), Buffer.from([0xff])])
  assert.throws(() => native.parsePacketBuffer('packet', unknown), /UNSUPPORTED_NATIVE_CHAT_BUBBLE_CODEC/)
  const truncated = Buffer.concat([header, Buffer.from([1]), Buffer.alloc(8), wireString('touhou_little_maid:text'), wireVarInt(40), Buffer.from('short')])
  assert.throws(() => native.parsePacketBuffer('packet', truncated), /Missing characters|PartialReadError/)
})

test('custom entity metadata registry must contain actual network IDs outside the reserved vanilla range', () => {
  assert.throws(() => createBackendComponentProtocol(registry, null, new Map([['touhou_little_maid:maid_schedule', 0]])), /INVALID_ENTITY_SERIALIZER_REGISTRY/)
  assert.throws(() => createBackendComponentProtocol(registry, null, new Map([['test:first', 301], ['test:second', 301]])), /INVALID_ENTITY_SERIALIZER_REGISTRY/)
  assert.throws(() => createBackendComponentProtocol(registry, null, new Map([['not_a_registry_name', 301]])), /INVALID_ENTITY_SERIALIZER_REGISTRY/)
})

test('native Ars spell caster remains structured component data while vanilla projection preserves its item name', () => {
  const components = new Map(registry)
  components.set('ars_nouveau:spell_caster', 90)
  const native = createBackendComponentProtocol(components, null, metadataRegistry())
  const caster = {
    currentSlot: 0, flavorText: '本人治愈法术', isHidden: false, hiddenText: '', maxSlots: 10,
    spells: [{ slot: 0, spell: {
      name: '自我治疗', color: { id: 'ars_nouveau:constant', r: 50, g: 255, b: 50 },
      sound: { id: 'ars_nouveau:default', volume: 1, pitch: 1 },
      glyphs: ['ars_nouveau:glyph_self', 'ars_nouveau:glyph_heal'], timelineCount: 0
    } }]
  }
  const item = stack(1402, [
    { type: 'ars_nouveau:spell_caster', data: caster },
    { type: 'custom_name', data: { type: 'string', value: '个人法术书' } }
  ])
  const packet = { name: 'set_slot', params: { windowId: 0, stateId: 8, slot: 36, item } }
  const buffer = native.createPacketBuffer('packet', packet)
  const parsed = native.parsePacketBuffer('packet', buffer)
  assert.equal(parsed.metadata.size, buffer.length)
  assert.deepEqual(parsed.data.params.item.components[0].data, caster)
  assert.deepEqual(native.createPacketBuffer('packet', parsed.data), buffer)
  const front = vanillaProjection(parsed.data)
  assert.deepEqual(front.params.item.components.map(component => component.type), ['custom_name'])
  assert.equal(front.params.item.addedComponentCount, 1)
  assert.equal(parsed.data.params.item.components.length, 2)
  assert.equal(Object.hasOwn(mcData.protocol.types.SlotComponentType[1].mappings, '90'), false)
})

const arsMetadataRegistry = () => new Map([
  ...metadataRegistry(), ['ars_nouveau:spell_resolver', 409], ['ars_nouveau:vec3', 423]
])
const wireI32 = value => { const buffer = Buffer.alloc(4); buffer.writeInt32BE(value); return buffer }
const wireF32 = value => { const buffer = Buffer.alloc(4); buffer.writeFloatBE(value); return buffer }
const wireF64 = value => { const buffer = Buffer.alloc(8); buffer.writeDoubleBE(value); return buffer }
const arsResolverWire = (timelineCount = 0) => Buffer.concat([
  wireString('星芒箭'), wireString('ars_nouveau:constant'),
  ...[255, 50, 125].map(wireI32), wireString('ars_nouveau:default'), wireF32(0.5), wireF32(1.25),
  wireI32(2), wireString('ars_nouveau:glyph_projectile'), wireString('ars_nouveau:glyph_harm'), wireI32(timelineCount)
])

test('Ars projectile resolver and Vec3 metadata decode independent wire using server-exported IDs', () => {
  const serializers = arsMetadataRegistry()
  const native = createBackendComponentProtocol(registry, null, serializers)
  const buffer = Buffer.concat([
    Buffer.from([0x58]), wireVarInt(4061), Buffer.from([9]),
    wireVarInt(serializers.get('ars_nouveau:spell_resolver')), arsResolverWire(),
    Buffer.from([12]), wireVarInt(serializers.get('ars_nouveau:vec3')),
    ...[-500.125, 64.75, 301.0625].map(wireF64),
    Buffer.from([1, 1]), wireVarInt(300), Buffer.from([0xff])
  ])
  assert.equal(isItemPacket(buffer), true)
  const parsed = native.parsePacketBuffer('packet', buffer)
  assert.equal(parsed.metadata.size, buffer.length)
  assert.equal(parsed.data.params.entityId, 4061)
  const [resolver, vector, vanillaEntry] = parsed.data.params.metadata
  assert.equal(resolver.type, 'ars_nouveau:spell_resolver')
  assert.deepEqual(resolver.value, { spell: {
    name: '星芒箭', color: { id: 'ars_nouveau:constant', r: 255, g: 50, b: 125 },
    sound: { id: 'ars_nouveau:default', volume: 0.5, pitch: 1.25 },
    glyphs: ['ars_nouveau:glyph_projectile', 'ars_nouveau:glyph_harm'], timelineCount: 0
  } })
  assert.deepEqual(vector, { key: 12, type: 'ars_nouveau:vec3', value: { x: -500.125, y: 64.75, z: 301.0625 } })
  assert.deepEqual(vanillaEntry, { key: 1, type: 'int', value: 300 })
  assert.deepEqual(native.createPacketBuffer('packet', parsed.data), buffer)
  assert.equal(Object.hasOwn(mcData.protocol.types.entityMetadataEntry[1][1].type[1].mappings, '409'), false)
})

test('Ars metadata projection preserves the same projectile identity and native resolver data', async () => {
  const native = createBackendComponentProtocol(registry, null, arsMetadataRegistry())
  const packet = { name: 'entity_metadata', params: { entityId: 4061, metadata: [
    { key: 12, type: 'ars_nouveau:vec3', value: { x: -500.125, y: 64.75, z: 301.0625 } },
    { key: 1, type: 'int', value: 300 }
  ] } }
  const decoded = native.parsePacketBuffer('packet', native.createPacketBuffer('packet', packet)).data
  const projected = vanillaProjection(decoded)
  assert.equal(decoded.params.metadata.length, 2)
  assert.equal(projected.params.entityId, 4061)
  assert.deepEqual(projected.params.metadata, [{ key: 1, type: 'int', value: 300 }])
  const serializer = mc.createSerializer({ state: 'play', isServer: true, version: '1.21.1' })
  const parser = mc.createDeserializer({ state: 'play', isServer: false, version: '1.21.1' })
  const result = new Promise((resolve, reject) => { parser.once('data', resolve); parser.once('error', reject); serializer.once('error', reject) })
  serializer.pipe(parser)
  serializer.end(projected)
  const front = await result
  assert.equal(front.data.params.entityId, 4061)
  assert.deepEqual(front.data.params.metadata, projected.params.metadata)
})

test('nonempty Ars timelines explicitly fail without treating their bytes as a neighbouring metadata entry', () => {
  const serializers = arsMetadataRegistry()
  const native = createBackendComponentProtocol(registry, null, serializers)
  const buffer = Buffer.concat([
    Buffer.from([0x58]), wireVarInt(4061), Buffer.from([9]),
    wireVarInt(serializers.get('ars_nouveau:spell_resolver')), arsResolverWire(1),
    Buffer.from([1, 1]), wireVarInt(300), Buffer.from([0xff])
  ])
  assert.throws(() => native.parsePacketBuffer('packet', buffer), /UNSUPPORTED_ARS_PARTICLE_TIMELINE/)
})
