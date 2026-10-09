'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { BedrockModels, CHANNEL } = require('./bedrock-models.cjs')
const { BedrockProjection } = require('./bedrock-projection.cjs')
const { BedrockItems } = require('./bedrock-items.cjs')
const mc = require('minecraft-data')('1.21.1')
const TLM_SHA = 'f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27'
const ID = 'touhou_little_maid:hakurei_reimu_type_b_1720614ea46709023787aae005df1134'
const UID = '68b6b12b-9824-392a-acda-4c6d028ef2ec'
const catalog = () => ({ schemaVersion: 1, maidMetadata: { jarSha256: TLM_SHA,
  model: 23, isYsm: 19, ysmModel: 20, ysmTexture: 21, defaultModel: 'touhou_little_maid:hakurei_reimu' }, models: [
  { kind: 'touhou', modelId: ID, textureId: 'vengeful', bedrockIdentifier: 'maw_native:touhou_variant' },
  { kind: 'touhou', modelId: 'touhou_little_maid:hakurei_reimu', bedrockIdentifier: 'maw_native:touhou_default' },
  { kind: 'ysm', modelId: 'misc/3_default_boy', textureId: 'blue', bedrockIdentifier: 'maw_native:ysm_blue' }] })
const registry = new Map([[131, 'touhou_little_maid:maid'], [52, 'minecraft:pig']])
const spawn = () => ({ entityId: 47, objectUUID: UID, type: 131, x: 11, y: 65, z: 22, yaw: 0, pitch: 0, objectData: 0 })
const meta = value => ({ entityId: 47, metadata: [{ key: 23, type: 'string', value }, { key: 9, type: 'float', value: 20 }] })

test('actual texture suffix is retained, identity survives and native metadata never reaches an armor-stand decoder', () => {
  const adapter = new BedrockModels(catalog()); const input = spawn()
  adapter.activate()
  assert.equal(adapter.project('spawn_entity', input, registry), null)
  const packet = meta(ID); const original = structuredClone(packet)
  const result = adapter.project('entity_metadata', packet, registry)
  assert.equal(result.before[0].name, 'custom_payload'); assert.equal(result.before[0].params.channel, CHANNEL)
  assert.deepEqual(JSON.parse(result.before[0].params.data), { schemaVersion: 1,
    entityId: 47, uuid: UID, identifier: 'maw_native:touhou_variant' })
  assert.equal(result.before[1].params.type, mc.entitiesByName.armor_stand.id)
  assert.equal(result.before[1].params.objectUUID, UID)
  assert.deepEqual(result.params.metadata, [{ key: 9, type: 'float', value: 20 }])
  assert.deepEqual(packet, original); assert.equal(input.type, 131)
})

test('changed model respawns at current authoritative position; unknown model hides rather than uses the wrong appearance', () => {
  const adapter = new BedrockModels(catalog()); adapter.project('spawn_entity', spawn(), registry)
  adapter.activate()
  adapter.project('entity_metadata', meta(ID), registry)
  adapter.project('rel_entity_move', { entityId: 47, dX: 4096, dY: 2048, dZ: -4096 }, registry)
  const changed = adapter.project('entity_metadata', meta('touhou_little_maid:hakurei_reimu'), registry)
  assert.equal(changed.before[0].name, 'entity_destroy')
  assert.equal(changed.before[2].params.x, 12); assert.equal(changed.before[2].params.y, 65.5)
  assert.equal(changed.before[2].params.z, 21)
  const hidden = adapter.project('entity_metadata', meta('unavailable:model'), registry)
  assert.equal(hidden.before[0].name, 'entity_destroy')
  assert.equal(adapter.project('entity_look', { entityId: 47, yaw: 3, pitch: 4 }, registry), null)
})

test('YSM maid uses its own exact selected texture; partial metadata updates retain current identity', () => {
  const adapter = new BedrockModels(catalog()); adapter.project('spawn_entity', spawn(), registry)
  adapter.activate()
  const packet = { entityId: 47, metadata: [{ key: 19, type: 8, value: true },
    { key: 20, type: 4, value: 'misc/3_default_boy' }, { key: 21, type: 4, value: 'blue' }] }
  const result = adapter.project('entity_metadata', packet, registry)
  assert.equal(JSON.parse(result.before[0].params.data).identifier, 'maw_native:ysm_blue')
  assert.equal(adapter.project('entity_metadata', { entityId: 47, metadata: [{ key: 9, type: 'float', value: 10 }] }, registry).before.length, 0)
})

test('normal entities are untouched, sessions are isolated and changed wire types fail explicitly', () => {
  const first = new BedrockModels(catalog()); const second = new BedrockModels(catalog())
  first.activate(); second.activate()
  first.project('spawn_entity', spawn(), registry)
  assert.equal(second.project('entity_metadata', meta(ID), registry), undefined)
  assert.equal(first.project('spawn_entity', { ...spawn(), entityId: 48, type: 52 }, registry), undefined)
  assert.throws(() => first.project('entity_metadata', { entityId: 47, metadata: [{ key: 23, type: 'int', value: 1 }] }, registry), /TYPE_MISMATCH/)
  assert.equal(first.project('spawn_entity', { ...spawn(), type: 52 }, registry), undefined)
  assert.equal(first.entities.has(47), false)
  first.project('respawn', {}, registry); assert.equal(first.entities.size, 0)
  const bad = catalog(); bad.maidMetadata.jarSha256 = 'changed'; assert.throws(() => new BedrockModels(bad), /NOT_LOCKED/)
})

test('the real Gate consumes readiness privately and emits retained snapshots only after the observer is attached', () => {
  const adapter = new BedrockModels(catalog())
  adapter.project('spawn_entity', spawn(), registry)
  assert.equal(adapter.project('entity_metadata', meta(ID), registry), null)
  assert.equal(adapter.project('custom_payload', { channel: 'maw_agent:menu_state', data: Buffer.from('{}') }, registry), null)
  const source = fs.readFileSync(require.resolve('./gate.cjs'), 'utf8')
  const handler = source.slice(source.indexOf('function onFrontPacket ('), source.indexOf('// 安全重序列化转发'))
  let forwarded = 0; let kicks = 0; let drains = 0
  const onFront = vm.runInNewContext(handler+'\nonFrontPacket', { Buffer, SELF_TELEPORT_ACK: false,
    relayTo: () => forwarded++, kickFront: () => kicks++, drainPlay: () => drains++ })
  const session = { closed: false, backReady: true, phase: 'play', back: { ended: false },
    bedrockProjection: { models: adapter }, playQueue: [] }
  onFront(session, 'custom_payload', { channel: 'mawbedrock:ready', data: Buffer.from([1]) })
  assert.equal(forwarded, 0); assert.equal(kicks, 0); assert.equal(drains, 1)
  assert.deepEqual(session.playQueue.map(p => p.name), ['custom_payload', 'entity_metadata'])
  onFront(session, 'custom_payload', { channel: 'mawbedrock:ready', data: Buffer.from([1]) })
  assert.equal(session.playQueue.length, 2)
  const output = adapter.project('entity_metadata', session.playQueue[1].params, registry)
  assert.equal(JSON.parse(output.before[0].params.data).identifier, 'maw_native:touhou_variant')
  onFront(session, 'custom_payload', { channel: 'mawbedrock:ready', data: Buffer.from([2]) })
  assert.equal(kicks, 1); assert.equal(forwarded, 0)
})

test('real downstream pipeline retains native stacks until readiness and still filters custom attributes after binding', () => {
  const source = fs.readFileSync(require.resolve('./gate.cjs'), 'utf8')
  const handler = source.slice(source.indexOf('function relayTo ('), source.indexOf('// mcp 的 pluginChannels'))
  const writes = []; const kicks = []
  const relay = vm.runInNewContext(handler+'\nrelayTo', {
    Buffer, DEBUG_MENUS: false, BRIDGE_COOKING_POT_GUI: false, BRIDGE_NEOFORGE_TIME: false,
    nativeViewerHash: null, componentProtocol: null, vanillaMenuParserWindows: null,
    createNativeMenuProxyGuard: () => ({ filter: () => ({ forward: true }) }),
    REMAP: { hasMap: () => false }, kickFront: (_, reason) => kicks.push(reason), log: () => {}
  })
  const adapter = new BedrockModels(catalog()); const projection = new BedrockProjection(adapter)
  projection.registries.set('minecraft:entity_type', registry)
  const front = { write: (name, params) => writes.push({ name, params }) }
  const session = { front, back: {}, bedrockProjection: projection, bedrockItems: new BedrockItems() }
  const packet = meta(ID)
  packet.metadata.push({ key: 39, type: 'item_stack', value: { itemCount: 1, itemId: 1, components: [], removeComponents: [] } })
  relay(session, front, 'spawn_entity', spawn(), 'test')
  relay(session, front, 'entity_metadata', packet, 'test')
  assert.equal(writes.length, 0); assert.equal(session.bedrockItems.tokens.size, 0)
  for (const replay of adapter.activate()) relay(session, front, replay.name, replay.params, 'test')
  assert.deepEqual(kicks, [])
  assert.deepEqual(writes.map(row => row.name), ['custom_payload', 'spawn_entity', 'entity_metadata'])
  assert.equal(writes[2].params.metadata.length, 1)
  const attributes = projection.project('entity_update_attributes', { entityId: 47,
    properties: [{ key: '999999', value: 1, modifiers: [] }] })
  assert.equal(attributes.params.properties.length, 0)
  assert.equal(projection.stats.attributesOmitted, 1)
})
