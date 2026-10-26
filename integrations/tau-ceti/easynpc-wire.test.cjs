const { test } = require('node:test'), assert = require('node:assert/strict')
const path = require('node:path')
const snapshot = process.env.TAU_GATE_TEST_SOURCE
if (!snapshot) throw Error('Set TAU_GATE_TEST_SOURCE to the prepared gateway source snapshot')
const data = require('minecraft-data')('1.21.1')
const { createBackendComponentProtocol } = require(path.join(snapshot, 'component-protocol.cjs'))
const registry = new Map(Object.entries(data.protocol.types.SlotComponentType[1].mappings).map(([id, name]) => ['minecraft:' + name, Number(id)]))
const serializers = new Map([['easy_npc:root_model_data', 700], ['easy_npc:display_attribute', 701],
  ['easy_npc:progression', 702], ['easy_npc:dialog_data_set', 703], ['example:unknown', 704]])
const protocol = createBackendComponentProtocol(registry, null, serializers)
test('original readNbt compound is anonymous and preserves the following field', () => {
  const raw = Buffer.from('58071fbf050a0800036e706300045465737400000000ff', 'hex')
  const parsed = protocol.parsePacketBuffer('packet', raw)
  assert.equal(parsed.data.params.metadata[0].type, 'easy_npc:dialog_data_set')
  assert.equal(require('prismarine-nbt').simplify(parsed.data.params.metadata[0].value).npc, 'Test')
  assert.equal(parsed.data.params.metadata[1].key, 0)
  assert.deepEqual(protocol.createPacketBuffer('packet', parsed.data), raw)
})
test('original FFFZ plus FFF root model preserves the next metadata entry', () => {
  const raw = Buffer.from('58071fbc053fc00000c000000040400000013f800000400000003f000000000000ff', 'hex')
  const parsed = protocol.parsePacketBuffer('packet', raw)
  assert.equal(parsed.metadata.size, raw.length)
  const rows = parsed.data.params.metadata
  assert.equal(rows[0].type, 'easy_npc:root_model_data')
  assert.deepEqual(rows[0].value, { rotation: { x: 1.5, y: -2, z: 3, locked: true }, scale: { x: 1, y: 2, z: 0.5 } })
  assert.equal(rows[1].key, 0); assert.equal(rows[1].value, 0)
  assert.deepEqual(protocol.createPacketBuffer('packet', parsed.data), raw)
})
test('progression uses fixed integers, not VarInt or assumed level ordering', () => {
  const raw = Buffer.from('58071fbe050000012c0000000701ff', 'hex')
  const parsed = protocol.parsePacketBuffer('packet', raw)
  assert.deepEqual(parsed.data.params.metadata[0].value, { experience: 300, experienceLevel: 7, attributeScalingEnabled: true })
  assert.deepEqual(protocol.createPacketBuffer('packet', parsed.data), raw)
})
test('oversized collections, truncation and unknown codecs remain explicit errors', () => {
  assert.throws(() => protocol.parsePacketBuffer('packet', Buffer.from('58071fbd058102ff', 'hex')), /COLLECTION_BUDGET/)
  assert.throws(() => protocol.parsePacketBuffer('packet', Buffer.from('58071fbc050000', 'hex')))
  assert.throws(() => protocol.parsePacketBuffer('packet', Buffer.from('58071fc00500ff', 'hex')), /example:unknown/)
})
