const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path')
const snapshot = process.env.TAU_GATE_TEST_SOURCE
if (!snapshot) throw Error('Set TAU_GATE_TEST_SOURCE to the prepared gateway source snapshot')
const data = require('minecraft-data')('1.21.1')
const { createBackendComponentProtocol } = require(path.join(snapshot, 'component-protocol.cjs'))
const registry = new Map(Object.entries(data.protocol.types.SlotComponentType[1].mappings).map(([id, name]) => ['minecraft:' + name, Number(id)]))
registry.set('tombstone:tb_model_color', 180)
registry.set('tombstone:tb_stored_xp', 181)
registry.set('tombstone:tb_location', 182)
registry.set('tombstone:tb_additional_data', 183)
const protocol = createBackendComponentProtocol(registry)

test('Tombstone model color is signed SHORT and consumes exactly two data bytes', () => {
  const raw = Buffer.from([0xb4, 1, 0xff, 0xfe])
  const parsed = protocol.parsePacketBuffer('SlotComponent', raw)
  assert.equal(parsed.metadata.size, raw.length)
  assert.deepEqual(parsed.data, { type: 'tombstone:tb_model_color', data: -2 })
  assert.deepEqual(protocol.createPacketBuffer('SlotComponent', parsed.data), raw)
  assert.throws(() => protocol.parsePacketBuffer('SlotComponent', raw.subarray(0, 3)))
})

test('Tombstone XP is fixed INT and location preserves dimension and absolute position', () => {
  const raw = Buffer.from([0xb5, 1, 0, 0, 1, 0])
  assert.equal(protocol.parsePacketBuffer('SlotComponent', raw).data.data, 256)
  const component = { type: 'tombstone:tb_location', data: { dimension: 'minecraft:the_nether', position: { x: -582, y: -27, z: 934 } } }
  const encoded = protocol.createPacketBuffer('SlotComponent', component)
  const parsed = protocol.parsePacketBuffer('SlotComponent', encoded)
  assert.equal(parsed.metadata.size, encoded.length)
  assert.deepEqual(parsed.data, component)
})

test('Tombstone stored compound is preserved rather than skipped', () => {
  const component = { type: 'tombstone:tb_additional_data', data: { type: 'compound', value: { name: { type: 'string', value: '回程' } } } }
  const encoded = protocol.createPacketBuffer('SlotComponent', component)
  const parsed = protocol.parsePacketBuffer('SlotComponent', encoded)
  assert.deepEqual(require('prismarine-nbt').simplify(parsed.data.data), { name: '回程' })
  assert.deepEqual(protocol.createPacketBuffer('SlotComponent', parsed.data), encoded)
})
