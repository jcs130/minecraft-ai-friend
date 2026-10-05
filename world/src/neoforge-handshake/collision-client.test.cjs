'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachCollisionClient } = require('./collision-client.cjs')
const OWN = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-2222-3333-4444-555555555555'
const DIMENSION = 'minecraft:overworld'
const POS = { x: -425, y: 65, z: 411 }
const PROPERTIES = { facing: 'south', half: 'bottom', open: 'false', waterlogged: 'false' }
const QUERY = { position: POS, expectedBlockId: 'domum_ornamentum:panel', expectedProperties: PROPERTIES }

function fixture (t, options) {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot._client.uuid = OWN
  bot.game = { dimension: 'overworld' }
  const writes = []
  bot._client.write = (name, packet) => writes.push({ name, channel: packet.channel, body: JSON.parse(packet.data.toString('utf8')) })
  const collision = attachCollisionClient(bot, options)
  t.after(() => collision.detach())
  const errors = []
  collision.events.on('protocolError', error => errors.push(error.message))
  const emit = body => bot._client.emit('custom_payload', { channel: 'maw_agent:world_state', data: Buffer.from(JSON.stringify(body)) })
  function success (fields = {}) {
    return { schemaVersion: 1, kind: 'world_receipt', query: 'collision', requestId: writes.at(-1).body.requestId,
      playerUuid: OWN, dimension: DIMENSION, source: 'same_player_server_collision_shape', readOnly: true,
      outcomeKnown: true, retryAutomatically: false, globalStateCacheSafe: false,
      physicsIntegrated: false, pathfinderIntegrated: false, ok: true, available: true,
      code: 'native_collision_shape_observed', position: POS,
      block: { id: QUERY.expectedBlockId, stateId: 65011, properties: PROPERTIES,
        javaClass: 'com.ldtteam.domumornamentum.block.decorative.PanelBlock', dynamicShape: false, hasOffsetFunction: false },
      context: { source: 'CollisionContext.of_actual_ServerPlayer', capturedTick: 131, gameTime: '1000342',
        pose: 'standing', width: 0.6, height: 1.8, playerPosition: { x: -424.5, y: 65, z: 409.5 }, loadedNeighbourhoodRadius: 1 },
      boxes: [[0, 0, 0, 1, 0.1875, 1]], boxCount: 1, boxCoordinates: 'block_local',
      boxesMayExtendBeyondUnitBlock: true, sampledAt: Date.now(), maxAgeMs: 250, ...fields }
  }
  return { bot, collision, writes, emit, errors, success }
}

test('same ordinary account reads native panel box without physics or global cache claims', async t => {
  const { collision, writes, emit, success } = fixture(t)
  assert.equal(writes.length, 0)
  const pending = collision.query(QUERY)
  assert.deepEqual(writes[0].body, { schemaVersion: 1, kind: 'collision', requestId: writes[0].body.requestId,
    playerUuid: OWN, dimension: DIMENSION, position: POS, expectedBlockId: QUERY.expectedBlockId,
    expectedProperties: PROPERTIES })
  assert.equal(writes[0].name, 'custom_payload')
  assert.equal(writes[0].channel, 'maw_agent:world_query')
  emit(success())
  const result = await pending
  assert.deepEqual(result.boxes, [[0, 0, 0, 1, 0.1875, 1]])
  assert.equal(result.boxCoordinates, 'block_local')
  assert.equal(result.expiresAfterMs, 250)
  assert.equal(result.physicsIntegrated, false)
  assert.equal(result.pathfinderIntegrated, false)
  assert.equal(result.globalStateCacheSafe, false)
  assert.equal(collision.current, undefined)
})

test('full state properties are mandatory and numeric booleans or partial CAS are not silently inferred', t => {
  const { collision, writes } = fixture(t)
  assert.throws(() => collision.query({ position: POS, expectedBlockId: QUERY.expectedBlockId }), /INVALID_COLLISION_PROPERTIES/)
  assert.throws(() => collision.query({ ...QUERY, expectedProperties: { open: false } }), /INVALID_COLLISION_PROPERTIES/)
  assert.throws(() => collision.query({ ...QUERY, position: { x: -425.5, y: 65, z: 411 } }), /INVALID_COLLISION_POSITION/)
  assert.throws(() => collision.query({ ...QUERY, position: { x: -425, y: '65', z: 411 } }), /INVALID_COLLISION_POSITION/)
  assert.throws(() => collision.query({ ...QUERY, position: { x: -2147483649, y: 65, z: 411 } }), /INVALID_COLLISION_POSITION/)
  assert.throws(() => collision.query({ ...QUERY, playerUuid: OTHER }), /INVALID_COLLISION_QUERY/)
  assert.equal(writes.length, 0)
})

test('actual current login UUID is used; invalid identity sends no packet', async t => {
  const { bot, collision, writes, emit, success } = fixture(t)
  bot._client.uuid = OTHER
  const pending = collision.query(QUERY)
  assert.equal(writes[0].body.playerUuid, OTHER)
  emit(success({ playerUuid: OTHER }))
  assert.equal((await pending).playerUuid, OTHER)
  bot._client.uuid = 'offline-name-is-not-a-uuid'
  const absent = await collision.query(QUERY)
  assert.equal(absent.available, false)
  assert.equal(absent.dispatched, false)
  assert.equal(writes.length, 1)
})

test('foreign, changed actor and another query cannot satisfy a pending collision sample', async t => {
  const { bot, collision, writes, emit, success, errors } = fixture(t)
  let completed = false
  const pending = collision.query(QUERY).then(result => { completed = true; return result })
  emit(success({ playerUuid: OTHER }))
  emit(success({ query: 'look' }))
  bot._client.uuid = OTHER
  emit(success())
  await Promise.resolve()
  assert.equal(completed, false)
  assert.deepEqual(errors, ['COLLISION_PLAYER_MISMATCH', 'COLLISION_PLAYER_MISMATCH'])
  bot._client.uuid = OWN
  emit(success())
  assert.equal((await pending).available, true)
  assert.equal(writes.length, 1)
})

test('position, material id, complete properties and actual context bind the returned shape', async t => {
  const { collision, emit, success, errors } = fixture(t)
  const pending = collision.query(QUERY)
  const original = success()
  emit(success({ position: { ...POS, x: POS.x + 1 } }))
  emit(success({ block: { ...original.block, id: 'minecraft:stone' } }))
  emit(success({ block: { ...original.block, properties: { ...PROPERTIES, half: 'top' } } }))
  emit(success({ context: { ...original.context, source: 'CollisionContext.empty' } }))
  emit(success({ physicsIntegrated: true }))
  emit(success({ block: { ...original.block, dynamicShape: true } }))
  emit(success({ boxCoordinates: 'world_absolute' }))
  emit(success())
  assert.equal((await pending).available, true)
  assert.equal(errors.length, 7)
})

test('empty collision is real known empty; stair component boxes and fence height above 1 stay intact', async t => {
  const { collision, emit, success } = fixture(t)
  for (const boxes of [[], [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0.5, 1, 1, 1]], [[0.375, 0, 0.375, 0.625, 1.5, 0.625]]]) {
    const pending = collision.query(QUERY)
    emit(success({ boxes, boxCount: boxes.length }))
    assert.deepEqual((await pending).boxes, boxes)
  }
})

test('64 native boxes fit but 65, flattened bounding hull, invalid extent or degenerate box are rejected', async t => {
  const { collision, emit, success, errors } = fixture(t)
  const pending = collision.query(QUERY)
  const box = [0, 0, 0, 1, 0.5, 1]
  emit(success({ boxes: Array(65).fill(box), boxCount: 65 }))
  emit(success({ boxes: [0, 0, 0, 1, 1, 1], boxCount: 6 }))
  emit(success({ boxes: [[0, 0, 0, 1, 17, 1]] }))
  emit(success({ boxes: [[0, 0, 0, 0, 1, 1]] }))
  emit(success({ boxes: [[0, 0, 0, 1, null, 1]] }))
  emit(success({ boxes: Array(64).fill(box), boxCount: 64 }))
  assert.equal((await pending).boxes.length, 64)
  assert.deepEqual(errors, Array(5).fill('COLLISION_BOXES_INVALID'))
})

test('16KiB UTF8 budget and malformed byte decoding reject instead of replacing data', async t => {
  const { bot, collision, emit, success, errors } = fixture(t)
  const pending = collision.query(QUERY)
  emit(success({ padding: '界'.repeat(6000) }))
  bot._client.emit('custom_payload', { channel: 'maw_agent:world_state', data: Buffer.from([0xc0, 0x80]) })
  emit(success())
  assert.equal((await pending).available, true)
  assert.equal(errors[0], 'COLLISION_RECEIPT_BUDGET_EXCEEDED')
  assert.equal(errors.length, 2)
})

test('no loaded/native shape returns available false boxes null and never full cube fallback', async t => {
  const { collision, writes, emit } = fixture(t)
  for (const code of ['collision_context_not_loaded', 'collision_class_not_audited', 'collision_dynamic_shape_unsupported', 'collision_block_state_changed']) {
    const pending = collision.query(QUERY)
    emit({ schemaVersion: 1, kind: 'world_receipt', query: 'collision', requestId: writes.at(-1).body.requestId,
      playerUuid: OWN, dimension: DIMENSION, ok: false, available: false, boxes: null, code })
    const result = await pending
    assert.equal(result.available, false)
    assert.equal(result.boxes, null)
    assert.equal(result.retryAutomatically, false)
    assert.equal(result.physicsIntegrated, false)
  }
})

test('shared world-query throttling is a known unavailable sample, with no automatic retry', async t => {
  const { collision, writes, emit } = fixture(t)
  const pending = collision.query(QUERY)
  emit({ schemaVersion: 1, kind: 'world_receipt', requestId: writes[0].body.requestId, playerUuid: OWN,
    ok: false, code: 'rate_limited' })
  assert.equal((await pending).code, 'rate_limited')
  assert.equal(writes.length, 1)
})

test('respawn and end invalidate pending readings; late replies cannot revive a snapshot', async t => {
  const { bot, collision, writes, emit, success } = fixture(t)
  const pending = collision.query({ ...QUERY, requestId: 'test-fixed-id' })
  const old = success()
  bot.emit('respawn')
  assert.equal((await pending).code, 'collision_player_lifecycle_changed')
  emit(old)
  assert.throws(() => collision.query({ ...QUERY, requestId: 'test-fixed-id' }), /COLLISION_REQUEST_ID_ALREADY_USED/)
  const next = collision.query(QUERY)
  bot.emit('end')
  assert.equal((await next).code, 'collision_connection_closed')
  const unavailable = await collision.query(QUERY)
  assert.equal(unavailable.dispatched, false)
  assert.equal(writes.length, 2)
})

test('local timeout never invents geometry and dispatch bounds cannot produce a query flood', async t => {
  const { collision, writes } = fixture(t, { timeoutMs: 15, maxPending: 1 })
  const first = collision.query(QUERY)
  const second = await collision.query(QUERY)
  assert.equal(second.code, 'collision_pending_budget_exceeded')
  const missing = await first
  assert.equal(missing.code, 'collision_query_not_observed')
  assert.equal(missing.boxes, null)
  assert.equal(missing.retryAutomatically, false)
  assert.equal(writes.length, 1)
})

test('forced look waits one rotation physics tick and sends only collision query with frozen full state', async t => {
  const { bot, collision, writes, emit, success } = fixture(t)
  const steps = []
  let endWait
  bot.lookAt = async (target, force) => { steps.push({ target, force }) }
  bot.waitForTicks = count => { steps.push(count); return new Promise(resolve => { endWait = resolve }) }
  const block = { position: { ...POS, offset: (x, y, z) => ({ x: POS.x + x, y: POS.y + y, z: POS.z + z }) } }
  const options = { expectedBlockId: QUERY.expectedBlockId, expectedProperties: { ...PROPERTIES } }
  const pending = collision.lookAtBlock(block, options)
  await Promise.resolve()
  assert.equal(writes.length, 0)
  options.expectedProperties.half = 'top'
  endWait()
  await Promise.resolve()
  emit(success())
  assert.equal((await pending).available, true)
  assert.deepEqual(steps, [{ target: { x: POS.x + 0.5, y: POS.y + 0.5, z: POS.z + 0.5 }, force: true }, 1])
  assert.equal(writes.length, 1)
  assert.equal(writes[0].body.kind, 'collision')
  assert.deepEqual(writes[0].body.expectedProperties, PROPERTIES)
})

test('context change during forced look stops before querying; closed connection does not rotate', async t => {
  const { bot, collision, writes } = fixture(t)
  const steps = []
  bot.lookAt = async () => { steps.push('look'); bot.emit('spawn') }
  bot.waitForTicks = async () => { steps.push('tick') }
  const block = { position: { ...POS, offset: () => POS } }
  const options = { expectedBlockId: QUERY.expectedBlockId, expectedProperties: PROPERTIES }
  const changed = await collision.lookAtBlock(block, options)
  assert.equal(changed.available, false)
  assert.equal(writes.length, 0)
  bot.emit('end')
  const closed = await collision.lookAtBlock(block, options)
  assert.equal(closed.available, false)
  assert.deepEqual(steps, ['look', 'tick'])
})

test('dimension mismatch never writes and known empty cannot carry a changed dimension', async t => {
  const { bot, collision, writes, emit, success, errors } = fixture(t)
  assert.throws(() => collision.query({ ...QUERY, dimension: 'minecraft:the_nether' }), /COLLISION_DIMENSION_CHANGED/)
  const pending = collision.query(QUERY)
  emit(success({ dimension: 'minecraft:the_nether' }))
  bot.game.dimension = 'minecraft:the_end'
  emit(success())
  bot.game.dimension = 'overworld'
  emit(success())
  assert.equal((await pending).available, true)
  assert.equal(writes.length, 1)
  assert.deepEqual(errors, ['COLLISION_DIMENSION_CHANGED', 'COLLISION_DIMENSION_CHANGED'])
})

test('two ordinary accounts keep native player-context samples separate', async t => {
  const first = fixture(t)
  const second = fixture(t)
  second.bot._client.uuid = OTHER
  const a = first.collision.query(QUERY)
  const b = second.collision.query(QUERY)
  first.emit(first.success({ playerUuid: OTHER }))
  second.emit(second.success({ playerUuid: OWN }))
  first.emit(first.success())
  second.emit(second.success({ playerUuid: OTHER, boxes: [], boxCount: 0 }))
  assert.equal((await a).boxes.length, 1)
  assert.equal((await b).boxes.length, 0)
  assert.equal(first.writes.length, 1)
  assert.equal(second.writes.length, 1)
})
