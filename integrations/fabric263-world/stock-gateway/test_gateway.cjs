'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const fs = require('node:fs')
const { Projection } = require('./projection.cjs')
const { parseQuery, query } = require('./queries.cjs')
const { validateConfig, fromFront } = require('./gateway.cjs')
const { vanillaProtocol } = require('./backend.cjs')
const { ChunkProjection } = require('./chunks.cjs')

const valid = { labOnly: true, bindHost: '127.0.0.1', backendHost: '127.0.0.1', bindPort: 39785, backendPort: 39783, maxConnections: 4, runtime: 'E:/test/runtime' }
test('lab gateway cannot silently become a public offline login gateway', () => {
  assert.equal(validateConfig(valid), valid)
  for (const change of [{ bindHost: '0.0.0.0' }, { backendHost: 'remote.test' }, { labOnly: false }, { maxConnections: 9 }, { bindPort: 39783 }, { runtime: 'relative' }]) assert.throws(() => validateConfig({ ...valid, ...change }))
})
test('private command grammar has deterministic bounds and does not steal other commands', () => {
  assert.equal(parseQuery('other arg'), null)
  assert.equal(parseQuery('agent help').section, 'help')
  assert.deepEqual(parseQuery('agent q1 inventory 0 12'), { requestId: 'q1', section: 'inventory', offset: 0, limit: 12, filter: '' })
  assert.equal(parseQuery('agent q1 items 0 13').field, 'limit')
  assert.equal(parseQuery('agent q1 inventory -1').field, 'offset')
  assert.equal(parseQuery('agent q1 block 0 1').field, 'position')
  assert.equal(parseQuery('agent q1 block 0 1 2 extra').field, 'position')
  assert.deepEqual(parseQuery('agent q1 block -2 150 -1').position, { x: -2, y: 150, z: -1 })
})
test('server-only extra protocol registration is an explicit reviewed allowlist', () => {
  const { attachModConfiguration } = require('../mineflayer/mod_configuration.cjs')
  assert.throws(() => attachModConfiguration({}, () => ({}), { extraPlayChannels: ['unreviewed:channel'] }), /unreviewed/)
})

const runtime = process.env.MAW_NATIVE263_RUNTIME
const catalog = process.env.MAW_STOCK_NATIVE_CATALOG
const hasRuntime = !!runtime && !!catalog
let req, native, vanilla, p
if (hasRuntime) {
  req = createRequire(require('node:path').resolve(runtime, 'package.json'))
  native = JSON.parse(fs.readFileSync(catalog, 'utf8'))
  vanilla = req('minecraft-data')('26.3')
  p = new Projection(native, vanilla, req)
}
test('native items keep identities when their vanilla carrier is the same', { skip: !hasRuntime }, () => {
  const a = native.items.find(row => row.name === 'farmersdelight:rice')
  const b = native.items.find(row => row.name === 'farmersdelight:cooking_pot')
  const raw = { itemCount: 4, itemId: a.id, addedComponentCount: 0, removedComponentCount: 0, components: [], removeComponents: [] }
  const before = JSON.stringify(raw)
  const projected = p.slot(raw)
  assert.equal(JSON.stringify(raw), before)
  assert.equal(projected.components.find(row => row.type === 'custom_data').data.value.maw_native.value.id.value, a.name)
  assert.notEqual(p.slot({ ...raw, itemId: b.id }).components.find(row => row.type === 'custom_data').data.value.maw_native.value.id.value, a.name)
  assert.equal(p.slotInfo(raw).nativeId, 'farmersdelight:rice')
  assert.equal(p.slotInfo(raw).componentsArePacketOverrides, true)
  assert.equal(p.slotInfo(raw).defaultComponents, null)
  assert.equal(projected.itemCount, 4)
  assert.throws(() => p.slot({ ...raw, itemId: 999999 }), /unknown_native_item/)
})
test('unprojectable components remain readable as native data and are declared omitted in the carrier', { skip: !hasRuntime }, () => {
  const rice = native.items.find(row => row.name === 'farmersdelight:rice')
  const slot = { itemId: rice.id, itemCount: 8, components: [{ type: 'unimplemented:example', data: { value: 42 } }], removeComponents: [] }
  const output = p.slot(slot)
  assert.equal(p.slotInfo(slot).components[0].data.value, 42)
  const metadata = output.components.find(row => row.type === 'custom_data').data.value.maw_native.value
  assert.deepEqual(metadata.omitted_components.value.value, ['unimplemented:example'])
  assert.equal(output.components.some(row => row.type === 'unimplemented:example'), false)
  const customAttributes = p.slot({ ...slot, components: [{ type: 'attribute_modifiers', data: [{ typeId: 999, value: 4 }] }] })
  assert.equal(customAttributes.components.some(row => row.type === 'attribute_modifiers'), false)
})
test('a client-reported position cannot replace an authoritative status snapshot', { skip: !hasRuntime }, () => {
  const session = { projection: p, backend: { client: { uuid: 'one-body' }, data: native }, position: { x: 999999, y: 0, z: 999999 },
    snapshot: { status: 'ok', position: { x: 1, y: 70, z: 2 }, health: 19, maxHealth: 20, food: 18 }, omitted: new Map() }
  const value = query(session, parseQuery('agent r1 status'))
  assert.deepEqual(value.position, session.snapshot.position)
  assert.equal(value.positionSource, 'authoritative_server_thread_snapshot')
  session.snapshot = { status: 'rate_limited' }
  assert.equal(query(session, parseQuery('agent r1 status')).status, 'unknown')
})
test('an unobserved quest view is unknown rather than an empty completed view', { skip: !hasRuntime }, () => {
  const session = { projection: p, backend: { client: { uuid: 'one-body' }, data: native, views: { get: () => ({ status: 'unknown' }) } } }
  const value = query(session, parseQuery('agent r1 view 0 1 village-quest:reputation_view_v2'))
  assert.equal(value.status, 'unknown')
  assert.equal(value.complete, false)
})
test('generic menu padding never becomes a writable native slot', { skip: !hasRuntime }, () => {
  const layout = { inventoryStart: 10, inventoryEnd: 46, slotCount: 46 }
  const menu = p.menu(layout)
  assert.equal(menu.carrierOwn, 18)
  assert.equal(menu.toCarrierSlot(10), 18)
  assert.equal(menu.toNativeSlot(18), 10)
  assert.equal(menu.toNativeSlot(-999), -999)
  for (let slot = 10; slot < 18; slot++) assert.throws(() => menu.toNativeSlot(slot))
  assert.throws(() => p.menu({ inventoryStart: 10, inventoryEnd: 45, slotCount: 46 }))
})
test('inventory clicks never reverse arbitrary carrier components into authoritative items', { skip: !hasRuntime }, () => {
  const writes = []
  const session = { windows: new Map([[1, { projection: p.menu({ inventoryStart: 9, inventoryEnd: 45, slotCount: 45 }) }]]), backend: { client: { write: (...args) => writes.push(args) } } }
  fromFront(session, { windowId: 1, slot: 10, stateId: 3, mouseButton: 0, mode: 0,
    changedSlots: [{ location: 1, item: { itemId: 999999 } }], cursorItem: { itemId: 999999 } }, 'window_click')
  assert.equal(writes.length, 1)
  assert.equal(writes[0][1].slot, 10)
  assert.deepEqual(writes[0][1].changedSlots, [])
  assert.equal(writes[0][1].cursorItem, null)
})
test('private inventory pagination reports actual coverage without inventing missing items', { skip: !hasRuntime }, () => {
  const session = { projection: p, backend: { client: { uuid: 'one-body' }, data: native }, activeWindow: 0,
    windows: new Map([[0, { items: Array.from({ length: 46 }, () => ({ itemCount: 0 })), stateId: 4 }]]) }
  const result = query(session, parseQuery('agent q1 inventory 0 12'))
  assert.equal(result.bodyId, 'one-body')
  assert.equal(result.status, 'partial')
  assert.equal(result.returnedCount, 12)
  assert.equal(result.remainingCount, 34)
  assert.equal(result.next.offset, 12)
  assert.ok(result.rows.every(row => row.item === null))
  session.windows.clear()
  assert.equal(query(session, parseQuery('agent q1 inventory')).status, 'unknown')
})
test('actual vanilla 26.3 max health attribute uses wire ID 23, not the stale protocol mapper', { skip: !hasRuntime }, () => {
  const mc = req('minecraft-protocol')
  const options = { version: '26.3', state: 'play', customPackets: vanillaProtocol(vanilla) }
  const buffer = mc.createSerializer({ ...options, isServer: true }).createPacketBuffer({ name: 'entity_update_attributes', params: {
    entityId: 7, properties: [{ key: 'minecraft:max_health', value: 20, modifiers: [] }] } })
  const value = mc.createDeserializer({ ...options, isServer: false }).parsePacketBuffer(buffer).data.params
  assert.equal(value.properties[0].key, 'minecraft:max_health')
  assert.equal(value.properties[0].value, 20)
  const mapper = vanillaProtocol(vanilla)['26.3'].play.toClient.types.packet_entity_update_attributes[1][1].type[1].type[1][0].type[1].mappings
  assert.equal(mapper[23], 'minecraft:max_health')
})
test('chunk projection retains authoritative native states and serializes a separate vanilla view', { skip: !hasRuntime }, () => {
  const registry = req('prismarine-registry')('26.3')
  require('../mineflayer/native_registry.cjs').applyRegistry(registry, native)
  const Chunk = req('prismarine-chunk')(registry)
  const original = new Chunk({ minY: -64, worldHeight: 384 })
  const pot = native.states.find(row => row.name === 'farmersdelight:cooking_pot')
  original.setBlockStateId({ x: 15, y: 150, z: 15 }, pot.id)
  const columns = new ChunkProjection(req, registry, vanilla, p, { minY: -64, worldHeight: 384 })
  const result = columns.project({ x: -1, z: -1, chunkData: original.dump(), blockEntities: [] })
  const VanillaChunk = req('prismarine-chunk')(vanilla)
  const view = new VanillaChunk({ minY: -64, worldHeight: 384 }); view.load(result.chunkData)
  assert.equal(view.getBlockStateId({ x: 15, y: 150, z: 15 }), p.block(pot.id).stateId)
  assert.equal(columns.at({ x: -1, y: 150, z: -1 }).id, pot.id)
  assert.equal(original.getBlockStateId({ x: 15, y: 150, z: 15 }), pot.id)
})
