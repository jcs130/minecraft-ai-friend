'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const P = require('../agent-access/registry-protocol.cjs')
const { loadDirectGateway, KEY } = require('../agent-access/direct-gateway.cjs')
const { improveMap } = require('../faithful-vanilla-map.cjs')
const { patchGateway } = require('../gateway-patch.cjs')
const cube = [[0, 0, 0, 1, 1, 1]]
const row = (stateId, name, extra = {}) => ({ stateId, blockId: stateId, name, collisionBoxes: cube, canOcclude: true,
  properties: {}, destroySpeed: 2, requiresCorrectTool: false, ...extra })
function fixture (t, rows = [row(1, 'minecraft:stone'), row(2, 'lootr:lootr_chest')]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-direct-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'states.jsonl'), bytes = Buffer.from(rows.map(JSON.stringify).join('\n'))
  fs.writeFileSync(file, bytes)
  const hash = crypto.createHash('sha256').update(bytes).digest('hex')
  return { hash, make: loadDirectGateway(file, hash, (b, fn) => fn(0, Uint32Array.from(b))) }
}

test('stock Mineflayer receives no additional native mirror or catalog', t => {
  const { make } = fixture(t), session = make(), messages = []
  assert.equal(session.beforePacket('map_chunk', { chunkData: [1, 2] }, m => messages.push(m)), false)
  assert.deepEqual(messages, []); assert.equal(session.stats.registryBytes, 0)
})
test('only received state definitions precede the native packet, once per connection', t => {
  const { hash, make } = fixture(t, [row(1, 'minecraft:stone'), row(2, 'lootr:lootr_chest'), row(3, 'minecraft:diamond_ore')])
  const a = make(), b = make(), messages = []
  a.subscribe(P.encode(P.hello('stream_catalog')), 'config')
  assert.equal(a.beforePacket('map_chunk', { chunkData: [1, 2, 1] }, m => messages.push(P.decode(m.data))), true)
  assert.equal(messages[0].registrySha256, hash); assert.equal(messages[0].complete, false)
  assert.deepEqual(messages[1].rows.map(r => r.stateId), [1, 2]); assert.equal(messages.length, 2)
  a.beforePacket('block_change', { type: 2 }, m => messages.push(P.decode(m.data))); assert.equal(messages.length, 2)
  a.beforePacket('block_change', { type: 3 }, m => messages.push(P.decode(m.data))); assert.equal(messages[2].sequence, 2)
  assert.equal(b.enabled(), false); assert.equal(b.stats.stateDefinitions, 0)
})
test('catalog pages obey both wire and row budgets without dropping states', t => {
  const rows = Array.from({ length: 400 }, (_, i) => row(i, 'test:stone_' + i, { properties: { text: 'x'.repeat(100) } }))
  const { make } = fixture(t, rows), a = make(), messages = []
  a.subscribe(P.encode(P.hello('stream_catalog')), 'config')
  a.beforePacket('map_chunk', { chunkData: rows.map(r => r.stateId) }, m => { assert(m.data.length <= P.MAX_BYTES); messages.push(P.decode(m.data)) })
  const pages = messages.slice(1); assert(pages.length > 3)
  assert(pages.every(p => p.rows.length <= P.MAX_PAGE_ROWS)); assert.equal(pages.flatMap(p => p.rows).length, 400)
  assert.deepEqual(pages.map(p => p.sequence), pages.map((_, i) => i + 1))
})
test('missing native definitions, wrong catalog and late subscriptions stay errors', t => {
  const { make } = fixture(t), a = make()
  assert.throws(() => a.subscribe(P.encode(P.hello('external_catalog', '0'.repeat(64))), 'config'), /HELLO_INVALID/)
  a.subscribe(P.encode(P.hello('stream_catalog')), 'config')
  assert.throws(() => a.beforePacket('block_change', { type: 99 }, () => {}), /MISSING/)
  assert.throws(() => a.subscribe(P.encode(P.hello('stream_catalog')), 'play'), /BEFORE_STREAM/)
})
test('mod ItemStack has explicit native identity and name without changing the original', t => {
  const { make } = fixture(t), a = make(), registry = new Map([[5, 'twilightforest:ironwood_sword'], [6, 'minecraft:stick']])
  const item = { itemCount: 1, itemId: 5, components: [{ type: 'damage', data: 7 }], removeComponents: ['custom_name'] }
  const original = structuredClone(item), value = a.itemNames('set_slot', { item }, registry).item
  assert.deepEqual(item, original); assert.equal(value.itemId, 5); assert.equal(value.components.find(c => c.type === 'custom_name').data.value, 'twilightforest:ironwood_sword')
  assert.equal(value.components.find(c => c.type === 'custom_data').data.value[KEY].value.id.value, 'twilightforest:ironwood_sword')
  assert.equal(value.components.find(c => c.type === 'damage').data, 7)
  assert(!value.removeComponents.includes('custom_name'))
  const plain = { itemCount: 1, itemId: 6 }; assert.deepEqual(a.itemNames('set_slot', { item: plain }, registry).item, plain)
  const named = structuredClone(item); named.components.push({ type: 'custom_name', data: { type: 'string', value: 'My sword' } })
  assert.equal(a.itemNames('set_slot', { item: named }, registry).item.components.find(c => c.type === 'custom_name').data.value, 'My sword')
})
test('projection never overrides genuine custom components or accepts an unknown registry', t => {
  const { make } = fixture(t), a = make(), item = { itemCount: 1, itemId: 5, components: [{ type: 'custom_data', data: { type: 'compound', value: { [KEY]: { type: 'string', value: 'original' } } } }] }
  assert.throws(() => a.itemNames('set_slot', { item }, new Map([[5, 'test:thing']])), /NAMESPACE_CONFLICT/)
  assert.throws(() => a.itemNames('set_slot', { item }, new Map()), /REGISTRY_UNAVAILABLE/)
})
test('vanilla chest and stair projection requires exact properties and collision; reversals stay original', () => {
  const rows = [row(10, 'minecraft:chest'), row(11, 'lootr:lootr_chest'), row(20, 'minecraft:oak_stairs', { collisionBoxes: [[0, 0, 0, 1, .5, 1]] }),
    row(21, 'twilightforest:twilight_oak_stairs', { collisionBoxes: [[0, 0, 0, 1, .5, 1]] }), row(22, 'twilightforest:unsafe_stairs', { collisionBoxes: null }),
    row(23, 'twilightforest:other_stairs', { properties: { facing: 'north' } }), row(30, 'test:chest')]
  const map = { states: { 11: 100, 21: 101, 22: 102, 23: 103, 30: 104 }, reverseVanillaStates: { 4: 10, 5: 20 } }
  const before = structuredClone(map.reverseVanillaStates), result = improveMap(map, new Map(rows.map(r => [r.stateId, r])))
  assert.equal(result.updatedStates, 2); assert.equal(map.states[11], 4); assert.equal(map.states[21], 5)
  assert.equal(map.states[22], 102); assert.equal(map.states[23], 103); assert.equal(map.states[30], 104)
  assert.deepEqual(map.reverseVanillaStates, before)
})
test('unreviewed gateway code is not patched or promoted', () => { assert.throws(() => patchGateway(Buffer.from('other gateway')), /REVIEWED/) })
