'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const data = require('minecraft-data')('1.21.1')
const { createBackendComponentProtocol, vanillaProjection, isOptionalParticleFailure } = require('./component-protocol.cjs')

const names = ['spell_container', 'upgrade_data', 'affinity_data', 'casting_implement', 'multihand_weapon',
  'clothing_variant', 'upgrade_orb_type', 'potion_bottle_type', 'wayward_compass', 'crossbow_load_state', 'furled_map_data']
const registry = new Map(Object.entries(data.protocol.types.SlotComponentType[1].mappings).map(([id, name]) => ['minecraft:' + name, Number(id)]))
names.forEach((name, i) => registry.set('irons_spellbooks:' + name, 400 + i))
const farmerNames = ['meal', 'container', 'cooking_time_length', 'skillet_ingredient', 'skillet_flip_timestamp', 'skillet_flipped']
farmerNames.forEach((name, i) => registry.set('farmersdelight:' + name, 500 + i))
const protocol = createBackendComponentProtocol(registry)
const empty = { itemCount: 0 }
const stack = (components, itemId = 2600) => ({ itemCount: 1, itemId, addedComponentCount: components.length,
  removedComponentCount: 0, components, removeComponents: [] })
const packet = items => ({ name: 'window_items', params: { windowId: 3, stateId: 8, items, carriedItem: empty } })
const int = value => { const b = Buffer.alloc(4); b.writeInt32BE(value); return b }
const vint = value => { const bytes = []; do { const b = value & 127; value >>>= 7; bytes.push(value ? b | 128 : b) } while (value); return Buffer.from(bytes) }
const str = value => Buffer.concat([vint(Buffer.byteLength(value)), Buffer.from(value)])
// Independent wire constructor follows the pinned mod's javap output, not
// the codec under test. A vanilla stack follows the book to detect overreads.
const bookWire = ({ max = 6, count = 1, body } = {}) => Buffer.concat([
  Buffer.from([0x13, 3, 8, 2]), vint(1), vint(2600), Buffer.from([1, 0]), vint(400),
  int(max), Buffer.from([1, 1, 0]), int(count),
  body || Buffer.concat([str('irons_spellbooks:firebolt'), int(1), Buffer.from([0]), int(0)]),
  Buffer.from([1, 1, 0, 0, 0])
])

test('native Iron spell book decodes independent INT wire and keeps the following vanilla stack', () => {
  const raw = bookWire()
  const parsed = protocol.parsePacketBuffer('packet', raw)
  assert.equal(parsed.metadata.size, raw.length)
  assert.deepEqual(parsed.data.params.items[0].components[0].data, {
    maxSpells: 6, spellWheel: true, mustEquip: true, improved: false,
    spells: [{ id: 'irons_spellbooks:firebolt', level: 1, locked: false, index: 0 }]
  })
  assert.equal(parsed.data.params.items[1].itemId, 1)
  assert.equal(parsed.data.params.carriedItem.itemCount, 0)
  assert.deepEqual(protocol.createPacketBuffer('packet', parsed.data), raw)
  assert.deepEqual(vanillaProjection(parsed.data).params.items[0].components, [])
  assert.equal(parsed.data.params.items[0].components.length, 1)
})

test('Iron decoder rejects negative/oversized fixed counts and truncated spell payloads', () => {
  for (const args of [{ max: -1 }, { max: 1025 }, { count: -1 }, { count: 0x7fffffff }]) {
    assert.throws(() => protocol.parsePacketBuffer('packet', bookWire(args)), /INVALID_IRON_COMPONENT_COUNT/)
  }
  const raw = bookWire()
  assert.throws(() => protocol.parsePacketBuffer('packet', raw.subarray(0, raw.length - 10)))
})

test('Iron empty and multiple spell books preserve locked flag, levels and slot indices', () => {
  for (const spells of [[], [
    { id: 'irons_spellbooks:heal', level: 3, locked: true, index: 1 },
    { id: 'irons_spellbooks:firebolt', level: 7, locked: false, index: 5 }
  ]]) {
    const original = packet([stack([{ type: 'irons_spellbooks:spell_container', data: {
      maxSpells: 6, spellWheel: true, mustEquip: true, improved: true, spells
    } }]), empty])
    const bytes = protocol.createPacketBuffer('packet', original)
    assert.deepEqual(protocol.parsePacketBuffer('packet', bytes).data, original)
  }
})

test('Farmer nested stack wrappers, fixed cooking INT and VarLong flip time retain neighbouring components', () => {
  // Independent wire: wrapper holds one ordinary item, then INT 100,
  // VarLong 300 (= ac 02), BOOL true; the next inventory slot is empty.
  const raw = Buffer.concat([Buffer.from([0x13, 3, 8, 2, 1]), vint(2601), Buffer.from([4, 0]),
    vint(500), Buffer.from([1, 1, 0, 0]), vint(502), int(100), vint(504),
    Buffer.from([0xac, 0x02]), vint(505), Buffer.from([1, 0, 0])])
  const parsed = protocol.parsePacketBuffer('packet', raw)
  assert.equal(parsed.metadata.size, raw.length)
  const components = parsed.data.params.items[0].components
  assert.equal(components[0].data.itemId, 1)
  assert.equal(components[1].data, 100)
  assert.deepEqual(components[2].data, [0, 300])
  assert.equal(components[3].data, true)
  assert.equal(parsed.data.params.items[1].itemCount, 0)
  assert.deepEqual(protocol.createPacketBuffer('packet', parsed.data), raw)
  const wrappers = packet([stack(farmerNames.slice(0, 2).map(name => ({ type: 'farmersdelight:' + name, data: empty })))])
  const bytes = protocol.createPacketBuffer('packet', wrappers)
  assert.deepEqual(protocol.parsePacketBuffer('packet', bytes).data, wrappers)
})

test('Iron fromCodec uses unnamed NBT, while Unit components occupy zero payload bytes', () => {
  const item = stack([
    { type: 'irons_spellbooks:affinity_data', data: { type: 'compound', value: {} } },
    { type: 'irons_spellbooks:casting_implement' },
    { type: 'irons_spellbooks:multihand_weapon' },
    { type: 'irons_spellbooks:clothing_variant', data: 'default' },
    { type: 'irons_spellbooks:upgrade_orb_type', data: { type: 'string', value: 'irons_spellbooks:fire_upgrade_orb' } },
    { type: 'irons_spellbooks:potion_bottle_type', data: { type: 'string', value: 'regular' } }
  ])
  const raw = protocol.createPacketBuffer('packet', packet([item, empty]))
  const parsed = protocol.parsePacketBuffer('packet', raw)
  assert.equal(parsed.metadata.size, raw.length)
  assert.deepEqual(protocol.createPacketBuffer('packet', parsed.data), raw)
  assert.equal(parsed.data.params.items[0].components[3].data, 'default')
})

test('Iron upgrade/map/crossbow codecs roundtrip alongside the native spell container', () => {
  const item = stack([
    { type: 'irons_spellbooks:upgrade_data', data: { upgradedSlot: 'head', upgrades: [{ id: 'irons_spellbooks:mana', level: 2 }] } },
    { type: 'irons_spellbooks:wayward_compass', data: { position: { x: -12, y: 80, z: 400 } } },
    { type: 'irons_spellbooks:crossbow_load_state', data: { isLoading: true, loadTimestamp: 12345 } },
    { type: 'irons_spellbooks:furled_map_data', data: { destinationResource: 'minecraft:village_plains',
      dimension: 'minecraft:overworld', descriptionOverride: { type: 'string', value: '村庄' } } }
  ])
  const raw = protocol.createPacketBuffer('packet', packet([item, empty]))
  const parsed = protocol.parsePacketBuffer('packet', raw)
  assert.equal(parsed.metadata.size, raw.length)
  assert.deepEqual(parsed.data, packet([item, empty]))
  assert.deepEqual(protocol.createPacketBuffer('packet', parsed.data), raw)
})

test('new content is keyed by native names after registry reorder in both protocol directions', () => {
  const reordered = new Map(registry)
  reordered.set('irons_spellbooks:spell_container', 1400)
  reordered.set('farmersdelight:meal', 1500)
  const backend = createBackendComponentProtocol(reordered, null, null, 'toServer')
  const item = stack([{ type: 'irons_spellbooks:spell_container', data: {
    maxSpells: 1, spellWheel: false, mustEquip: false, improved: false, spells: []
  } }])
  const native = { name: 'window_click', params: { windowId: 3, stateId: 8, slot: 0, mouseButton: 0,
    mode: 0, changedSlots: [{ location: 0, item }], cursorItem: empty } }
  const raw = backend.createPacketBuffer('packet', native)
  const parsed = backend.parsePacketBuffer('packet', raw)
  assert.deepEqual(parsed.data, native)
  assert.deepEqual(backend.createPacketBuffer('packet', parsed.data), raw)
  assert.equal(Object.hasOwn(data.protocol.types.SlotComponentType[1].mappings, 1400), false)
})

test('Farmer VarLong retains timestamps above 32 bits and negative LONGs; invalid lengths fail', () => {
  const { contentNativeTypes: types } = require('./native-content-types.cjs')
  const read = types.Read.mawFarmerVarLong[1]
  const write = types.Write.mawFarmerVarLong[1]
  const size = types.SizeOf.mawFarmerVarLong[1]
  for (const [value, hex] of [
    [[256, 0], '808080808020'], // 2^40
    [[-1, 0xffffffff], 'ffffffffffffffffff01'],
    [[0, 300], 'ac02'], [[0, 0], '00']
  ]) {
    const bytes = Buffer.from(hex, 'hex')
    assert.deepEqual(read(bytes, 0), { value, size: bytes.length })
    assert.equal(size(value), bytes.length)
    const out = Buffer.alloc(bytes.length)
    assert.equal(write(value, out, 0), bytes.length)
    assert.deepEqual(out, bytes)
  }
  for (const hex of ['80', '8000', 'ffffffffffffffffff02', 'ffffffffffffffffffff00']) {
    assert.throws(() => read(Buffer.from(hex, 'hex'), 0), /FARMER_VAR_LONG/)
  }
})

const particleId = Number(Object.entries(data.protocol.play.toClient.types.packet[1][0].type[1].mappings).find(([, name]) => name === 'world_particles')[0])
test('unsupported standalone visual particle frame may be omitted in the explicit vanilla projection', () => {
  const raw = Buffer.from([particleId, 0, 0]); const before = Buffer.from(raw)
  assert.equal(isOptionalParticleFailure(raw, Error('Read error for undefined : UNSUPPORTED_NATIVE_PARTICLE_CODEC'), true), true)
  assert.deepEqual(raw, before)
})
test('native/disabled connections retain strict particle codec failures', () => {
  for (const enabled of [false, undefined, '1']) {
    assert.equal(isOptionalParticleFailure(Buffer.from([particleId]), Error('UNSUPPORTED_NATIVE_PARTICLE_CODEC'), enabled), false)
  }
})
test('optional visual exception never swallows inventory or metadata codec errors', () => {
  const mappings = data.protocol.play.toClient.types.packet[1][0].type[1].mappings
  for (const name of ['window_items', 'set_slot', 'entity_equipment', 'entity_metadata', 'trade_list']) {
    const id = Number(Object.entries(mappings).find(([, value]) => name === value)[0])
    assert.equal(isOptionalParticleFailure(Buffer.from([id]), Error('UNSUPPORTED_NATIVE_PARTICLE_CODEC'), true), false)
  }
})
test('length mismatch, truncation and required item errors remain fatal even on a particle frame', () => {
  for (const error of ['NATIVE_PACKET_LENGTH_MISMATCH', 'PartialReadError', 'UNSUPPORTED_NATIVE_ITEM_COMPONENT', 'UNSUPPORTED_NATIVE_ENTITY_METADATA_CODEC']) {
    assert.equal(isOptionalParticleFailure(Buffer.from([particleId]), Error(error), true), false)
  }
})
