'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { properties, applyRegistry, loginBootstrap, fabricConfiguration } = require('./native_registry.cjs')
const { normalizePacket } = require('./create_bot.cjs')
const { utf, varint, Reader, parseConfiguration, attachModConfiguration } = require('./mod_configuration.cjs')
const { attachViews, viewChannels } = require('./views.cjs')
const { strictParser, nativeProtocolOverrides } = require('./native_protocol.cjs')
const { chooseIngredients } = require('./recipes.cjs')
const { attachMenus } = require('./menus.cjs')
const { nativeRead } = require('./native_tools.cjs')
const { createRequire } = require('node:module')
const path = require('node:path')

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const epoch = '82d91a8e-b19b-415d-b621-e108920edbb8'
const channels = ['reputation_view', 'reputation_interaction', 'journal', 'quest_tracker', 'notice_board', 'notice_journey'].map(n => 'village-quest:' + n)
const sample = () => ({ schemaVersion: 1, minecraft: '26.3', protocol: 777, serverEpoch: epoch,
  observedAt: '2026-11-01T08:00:00Z', states: [
    { id: 0, blockId: 0, name: 'minecraft:air', defaultStateId: 0, hardness: 0, canOcclude: false, properties: {}, shapeAvailable: true, collisionShapes: [] },
    { id: 1, blockId: 1, name: 'test:glass', defaultStateId: 1, hardness: 0.3, canOcclude: false, properties: {}, shapeAvailable: true, collisionShapes: [[0, 0, 0, 1, 1, 1]] }
  ], items: [{ id: 1, name: 'test:soup', stackSize: 16 }], entities: [{ id: 2, name: 'test:npc', width: 0.6, height: 1.8 }],
  menus: [{ id: 34, name: 'farmersdelight:cooking_pot' }], menuBridge: 'maw_agent:menu_state', components: [], gridRecipes: [],
  fabricRegistries: { 'minecraft:recipe_display': { 'farmersdelight:cooking': 5 } },
  viewBridge: { schemaVersion: 1, villageQuestVersion: '2.6.3', channel: 'maw_agent:view_state', channels } })
const registry = () => ({ blocksByName: {}, itemsByName: {}, entitiesByName: {}, recipes: { stale: true } })
function client () {
  const c = new EventEmitter(); c.uuid = 'c6bfda14-dd9a-3b77-ab82-b6f01f68c0d7'; c.writes = []
  c.write = (name, body) => c.writes.push({ name, body }); c.end = reason => { c.ended = reason }
  c.on('error', error => { c.lastError = error })
  return c
}

test('native IDs and namespace survive; transparent glass is physically solid', () => {
  const r = registry(); const result = applyRegistry(r, sample())
  assert.equal(result.nativeIdsPreserved, true); assert.equal(r.items[1].name, 'test:soup')
  assert.equal(r.blocks[1].transparent, true); assert.equal(r.blocks[1].boundingBox, 'block')
  assert.equal(r.blocks[0].boundingBox, 'empty'); assert.deepEqual(r.recipes, {})
})
test('unknown collision stays unknown and has conservative collision', () => {
  const s = sample(); s.states[1].shapeAvailable = false
  const r = registry(); applyRegistry(r, s)
  assert.equal(r.blocks[1].shapeStatus, 'unknown_requires_live_context')
  assert.equal(r.mawNativeRegistry.unknownShapes, 1)
})
test('duplicate native state fails rather than silently aliasing a block', () => {
  const s = sample(); s.states.push(s.states[0]); assert.throws(() => applyRegistry(registry(), s), /duplicate/)
})
test('noncontiguous state mapping fails', () => {
  const s = sample(); s.states.push({ ...s.states[1], id: 3, properties: { lit: 'true' } }); assert.throws(() => applyRegistry(registry(), s))
})
test('state property ordering is derived from actual native IDs', () => {
  const rows = [{ lit: 'true', age: '0' }, { lit: 'true', age: '1' }, { lit: 'false', age: '0' }, { lit: 'false', age: '1' }].map(properties => ({ properties }))
  assert.deepEqual(properties(rows).map(p => [p.name, p.values]), [['lit', [true, false]], ['age', [0, 1]]])
})
test('entity deltas combine every native interpolation step', () => {
  const p = normalizePacket('rel_entity_move', { move: { onGround: true, steps: [{ dX: 4096, dY: 0, dZ: -2 }, { dX: -1, dY: 2, dZ: 0 }] } })
  assert.equal(p.dX, 4095); assert.equal(p.dY, 2); assert.equal(p.dZ, -2); assert.equal(p.onGround, true)
})
test('stepped entity positions use the final native endpoint', () => {
  const p = normalizePacket('sync_entity_position', { positionType: 'stepped', steps: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }] })
  assert.equal(p.x, 4); assert.equal(p.z, 6)
  assert.throws(() => normalizePacket('sync_entity_position', { positionType: 'stepped', steps: [] }))
})
test('UTF-8 uses protocol varint length; JSON config is actually parsed', () => {
  const b = utf('{"名称":"星芒"}'); const r = new Reader(b); assert.equal(r.string(), '{"名称":"星芒"}'); r.end()
  assert.equal(parseConfiguration('spell_engine:config_sync', b).value['名称'], '星芒')
})
test('invalid and trailing configuration bytes do not get acknowledged', () => {
  assert.throws(() => parseConfiguration('bettercombat:config_sync', Buffer.concat([utf('{}'), Buffer.from([0])])), /trailing/)
  const c = client(); attachModConfiguration(c, sample)
  c.emit('custom_payload', { channel: 'bettercombat:config_sync', data: utf('bad-json') })
  assert.equal(c.writes.length, 0); assert.equal(c.ended, 'invalid_mod_configuration')
})
test('compressed Better Combat weapon registry uses bounded gzip/base64', () => {
  const text = zlib.gzipSync(Buffer.from('{"attributes":{"test:axe":{}},"registrations":{}}')).toString('base64')
  const header = Buffer.alloc(5); header[0] = 1; header.writeInt32BE(1, 1)
  const result = parseConfiguration('bettercombat:weapon_registry', Buffer.concat([header, utf(text)]))
  assert.deepEqual(Object.keys(result.value.attributes), ['test:axe'])
})
test('raw config and registry limits are enforced', () => {
  assert.throws(() => new Reader(Buffer.alloc(1024 * 1024 + 1)), /budget/)
  assert.throws(() => new Reader(Buffer.from([255, 255, 255, 255, 255, 1])).varint())
  assert.throws(() => parseConfiguration('unknown:config', Buffer.alloc(0)), /unsupported/)
})
test('Fabric sync mismatches fail without completion ACK', () => {
  const c = client(); fabricConfiguration(c, () => ({ fabricSyncSha256: hash(Buffer.from('real')), fabricRegistries: {} }))
  c.emit('custom_payload', { channel: 'fabric:registry/sync', data: Buffer.from('different') })
  assert.equal(c.writes.length, 0); assert.equal(c.ended, 'fabric_registry_sync_mismatch')
})
test('Fabric sync acknowledges only a matching native snapshot', () => {
  const c = client(); fabricConfiguration(c, () => ({ fabricSyncSha256: hash(Buffer.from('real')), fabricRegistries: { a: {} } }))
  c.emit('custom_payload', { channel: 'fabric:registry/sync', data: Buffer.from('real') })
  assert.equal(c.writes[0].body.channel, 'fabric:registry/sync/complete')
})
test('optional login queries retain vanilla negative responses; native data waits for injection', async () => {
  const c = client()
  function onLoginPluginRequest (packet) { c.write('login_plugin_response', { messageId: packet.messageId }) }
  c.on('login_plugin_request', onLoginPluginRequest)
  const boot = loginBootstrap(c, { timeoutMs: 1000 })
  c.emit('login_plugin_request', { messageId: 1, channel: 'another:required', data: Buffer.alloc(0) })
  assert.deepEqual(c.writes.pop().body, { messageId: 1 })
  const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(sample())))
  const offer = { schemaVersion: 1, minecraft: '26.3', serverEpoch: epoch, compression: 'gzip', sha256: hash(bytes), bytes: bytes.length }
  c.emit('login_plugin_request', { messageId: 2, channel: 'maw_agent:registry_offer', data: Buffer.from(JSON.stringify(offer)) })
  c.emit('login_plugin_request', { messageId: 3, channel: 'maw_agent:registry_data', data: bytes })
  assert.equal((await boot.promise).serverEpoch, epoch); assert.equal(c.writes.length, 1)
  boot.ready(); assert.equal(c.writes.at(-1).body.messageId, 3)
})
test('unsupported Village Quest bridge cannot advertise compatibility', () => {
  const s = sample(); s.viewBridge.villageQuestVersion = '2.7'
  assert.throws(() => viewChannels(s), /unsupported/)
})
test('view state is usable only after matching the actual original packet', () => {
  const c = client(); const views = attachViews(c, sample); const channel = channels[0]; const wire = Buffer.from('actual-wire')
  const row = { schemaVersion: 1, channel, bodyId: c.uuid, observedAt: '2026-11-01T08:00:00Z', wireSha256: hash(wire), complete: true, data: { reputation: 7 } }
  c.emit('custom_payload', { channel: 'maw_agent:view_state', data: Buffer.from(JSON.stringify(row)) })
  assert.equal(views.get(channel).status, 'unknown')
  c.emit('custom_payload', { channel, data: wire })
  assert.equal(views.get(channel).wireVerified, true); assert.equal(views.get(channel).data.reputation, 7)
  const copy = views.get(channel); copy.data.reputation = 100; assert.equal(views.get(channel).data.reputation, 7)
})
test('view of another body is rejected and never exposed', () => {
  const c = client(); const views = attachViews(c, sample)
  c.emit('custom_payload', { channel: 'maw_agent:view_state', data: Buffer.from(JSON.stringify({ schemaVersion: 1, bodyId: 'somebody-else' })) })
  assert.equal(c.ended, 'invalid_native_view'); assert.equal(views.list().length, 0)
})
test('unsupported common protocol is not echoed to fake compatibility', () => {
  const c = client(); attachModConfiguration(c, sample)
  c.emit('custom_payload', { channel: 'c:version', data: Buffer.concat([varint(1), varint(9)]) })
  assert.equal(c.ended, 'invalid_fabric_common_protocol'); assert.equal(c.writes.length, 0)
})
test('strict packet parsing rejects trailing bytes and converts swallowed partial errors', () => {
  const c = client(); c.deserializer = { parsePacketBuffer: () => ({ metadata: { size: 1 } }) }; strictParser(c)
  assert.throws(() => c.deserializer.parsePacketBuffer(Buffer.alloc(2)), { code: 'NATIVE_PACKET_DECODE_FAILED' })
  c.deserializer = { parsePacketBuffer: () => { const e = new Error('short'); e.partialReadError = true; throw e } }; c.emit('state', 'play')
  assert.throws(() => c.deserializer.parsePacketBuffer(Buffer.alloc(2)), e => e.code === 'NATIVE_PACKET_DECODE_FAILED' && !e.partialReadError)
})
test('native ingredient alternatives are selected against actual counts without changing inventory', () => {
  const counts = new Map([[1, 1], [2, 1]])
  const result = chooseIngredients([[1, 2], [1]], new Map(counts))
  assert.deepEqual(result.ids, [2, 1]); assert.deepEqual([...counts], [[1, 1], [2, 1]])
  assert.equal(chooseIngredients([[1], [1]], new Map([[1, 1]])).status, 'missing_materials')
  assert.equal(chooseIngredients([[1], [1]], new Map([[1, 2]]), 1).status, 'unknown_budget')
})
test('native catalog partial counts and continuation agree and never auto-read remaining pages', () => {
  const data = sample(); data.items = Array.from({ length: 30 }, (_, id) => ({ id, name: 'test:item_' + id }))
  const bot = { entity: {}, native263: { registry: data }, _client: { uuid: 'body' } }
  const first = nativeRead(bot, { section: 'items', limit: 5 })
  assert.equal(first.status, 'partial'); assert.equal(first.returned_count, 5); assert.equal(first.remaining, 25)
  assert.equal(first.next.offset, 5); assert.equal(first.rows.at(-1).id, 4)
  const second = nativeRead(bot, first.next)
  assert.equal(second.rows[0].id, 5); assert.equal(second.remaining, 20)
})
test('native menu is held until its actual layout arrives; custom type stays custom', () => {
  const c = client(); const m = attachMenus(c, sample); const delivered = []
  m.setDeliver((name, packet) => delivered.push([name, packet])); assert.equal(m.holdOpen({ windowId: 1, inventoryType: 34 }), true)
  const row = { schemaVersion: 1, bodyId: c.uuid, complete: true, windowId: 1, nativeId: 'farmersdelight:cooking_pot',
    slotCount: 45, inventoryStart: 9, inventoryEnd: 45, resultSlot: -1, slots: Array.from({ length: 45 }, (_, index) => ({ index })) }
  c.emit('custom_payload', { channel: 'maw_agent:menu_state', data: Buffer.from(JSON.stringify(row)) })
  assert.equal(delivered[0][0], 'open_window')
  class Window { constructor (...args) { this.args = args } }
  const w = m.factory({ windows: { Window }, id: 1, type: 34, title: 'Pot' })
  assert.equal(w.args[1], 'farmersdelight:cooking_pot'); assert.equal(w.args[3], 45)
})

const runtime = process.env.MAW_NATIVE263_RUNTIME
test('real native recipe codec round trips and compiled schemas stay isolated between servers', { skip: !runtime }, () => {
  const req = createRequire(path.resolve(runtime, 'package.json')); const protocol = req('minecraft-protocol'); const base = req('minecraft-data')('26.3').protocol
  const before = JSON.stringify(base)
  const a = sample(); const b = sample(); b.fabricRegistries['minecraft:recipe_display']['farmersdelight:cooking'] = 7
  const item = id => ({ type: 'item', data: id })
  const packet = { name: 'recipe_book_add', params: { entries: [{ recipe: { displayId: 10,
    display: { type: 'farmersdelight:cooking', data: { ingredients: [item(1810)], container: null, result: item(1800), craftingStation: item(1715), duration: 200, experience: 0.35 } },
    group: null, category: 'furnace_food', craftingRequirements: null }, flags: { notification: false, highlight: false } }], replace: false } }
  const buffers = []
  for (const data of [a, b]) {
    const customPackets = nativeProtocolOverrides(data, base)
    const encoder = protocol.createSerializer({ state: 'play', version: '26.3', isServer: true, customPackets })
    const decoder = protocol.createDeserializer({ state: 'play', version: '26.3', isServer: false, customPackets })
    const bytes = encoder.createPacketBuffer(packet); buffers.push(bytes)
    const actual = decoder.parsePacketBuffer(bytes)
    assert.equal(actual.metadata.size, bytes.length)
    assert.equal(actual.data.params.entries[0].recipe.display.data.duration, 200)
  }
  assert.notDeepEqual(buffers[0], buffers[1]); assert.equal(JSON.stringify(base), before)
})
test('an unsupported item component throws instead of consuming zero bytes', { skip: !runtime }, () => {
  const req = createRequire(path.resolve(runtime, 'package.json')); const protocol = req('minecraft-protocol'); const data = sample()
  data.components.push({ id: 200, name: 'test:unimplemented_component' })
  const customPackets = nativeProtocolOverrides(data, req('minecraft-data')('26.3').protocol)
  const encoder = protocol.createSerializer({ state: 'play', version: '26.3', isServer: true, customPackets })
  assert.throws(() => encoder.createPacketBuffer({ name: 'window_items', params: { windowId: 0, stateId: 1, items: [
    { itemCount: 1, itemId: 1, addedComponentCount: 1, removedComponentCount: 0, components: [{ type: 'test:unimplemented_component', data: {} }], removeComponents: [] }
  ], carriedItem: { itemCount: 0 } } }), /UNSUPPORTED_NATIVE_CODEC/)
})
