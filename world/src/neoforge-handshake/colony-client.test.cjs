'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachColonyClient } = require('./colony-client.cjs')

function harness (options) {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot._client.uuid = '11111111-1111-1111-1111-111111111111'
  const writes = []
  bot._client.write = (name, packet) => writes.push({ name, packet })
  return { bot, writes, colony: attachColonyClient(bot, options) }
}

function receipt (requestId, playerUuid = '11111111-1111-1111-1111-111111111111') {
  return { schemaVersion: 1, kind: 'colony_receipt', requestId, playerUuid, ok: true }
}

test('status uses the player connection and matches only its private receipt', async () => {
  const { bot, writes, colony } = harness()
  const pending = colony.status()
  const { packet } = writes[0]
  const body = JSON.parse(packet.data.toString('utf8'))
  assert.equal(packet.channel, 'maw_agent:colony_query')
  assert.equal(body.kind, 'status')
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state',
    data: Buffer.from(JSON.stringify(receipt(body.requestId, '22222222-2222-2222-2222-222222222222'))) })
  assert.equal(bot.uuid, undefined)
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state',
    data: Buffer.from(JSON.stringify({ ...receipt(body.requestId), playerUuid: null })) })
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state',
    data: Buffer.from(JSON.stringify(receipt(body.requestId))) })
  assert.deepEqual(await pending, receipt(body.requestId))
  colony.detach()
})
test('ordinary capabilities and status timeouts are known readonly observations; delivery timeout stays unknown and is not retried', async () => {
  const { writes, colony } = harness({ timeoutMs: 3 })
  const cap = await colony.capabilities()
  assert.equal(JSON.parse(writes[0].packet.data.toString()).kind, 'capabilities')
  assert.equal(writes[0].packet.channel, 'maw_agent:colony_query'); assert.equal(cap.outcomeKnown, true); assert.equal(cap.outcomeUnknown, false)
  const state = await colony.status(); assert.equal(state.code, 'colony_query_not_observed'); assert.equal(state.readOnly, true)
  await assert.rejects(colony.deliver({ buildingPosition: { x: 1, y: 64, z: 2 }, token: 'token', inventorySlot: 4, quantity: 1, expectedSnbt: 'item' }), /COLONY_RECEIPT_TIMEOUT/)
  assert.equal(writes.length, 3); colony.detach()
})
test('native supported huts require exact original type, slot and complete item precondition; keep builder compatibility', async () => {
  const { bot, writes, colony } = harness()
  const snbt = '{id:"minecolonies:blockhuthome",count:1,components:{"minecraft:custom_name":"house"}}'
  const pending = colony.placeHut({ position: { x: 4, y: 64, z: 4 }, hutType: 'home', inventorySlot: 5, expectedSnbt: snbt, requestId: 'home-once' })
  const body = JSON.parse(writes[0].packet.data.toString())
  assert.equal(body.kind, 'place_hut'); assert.equal(body.hutType, 'home'); assert.equal(body.expectedSnbt, snbt)
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state', data: Buffer.from(JSON.stringify({ ...receipt(body.requestId), action: body.kind })) })
  assert.equal((await pending).ok, true)
  for (const hutType of ['../home', 'minecolonies:home', 'castle']) assert.throws(() => colony.placeHut({ position: { x: 4, y: 64, z: 4 }, hutType, inventorySlot: 5, expectedSnbt: snbt }), /INVALID_COLONY_HUT/)
  assert.equal(writes.length, 1); assert.equal(typeof colony.placeBuilder, 'function'); colony.detach()
})
test('pending receipts are bound to original player identity, not merely a subsequently changed client UUID', async () => {
  const { bot, writes, colony } = harness({ timeoutMs: 5 })
  const pending = colony.status(), body = JSON.parse(writes[0].packet.data.toString())
  bot._client.uuid = '22222222-2222-2222-2222-222222222222'
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state', data: Buffer.from(JSON.stringify(receipt(body.requestId, bot._client.uuid))) })
  const result = await pending
  assert.equal(result.ok, false); assert.equal(result.playerUuid, '11111111-1111-1111-1111-111111111111'); colony.detach()
})

test('deliver carries explicit slot, component and building preconditions', async () => {
  const { bot, writes, colony } = harness()
  const pending = colony.deliver({ buildingPosition: { x: 8, y: 64, z: 4 },
    token: 'e1a5fa9e-69d8-4be9-a56a-0a8b85257e09', inventorySlot: 5,
    quantity: 16, expectedSnbt: '{count:16,id:"minecraft:oak_planks"}' })
  const { packet } = writes[0]
  const body = JSON.parse(packet.data.toString('utf8'))
  assert.equal(packet.channel, 'maw_agent:colony_action')
  assert.equal(body.kind, 'deliver')
  assert.equal(body.inventorySlot, 5)
  assert.equal(body.expectedSnbt, '{count:16,id:"minecraft:oak_planks"}')
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state',
    data: Buffer.from(JSON.stringify({ ...receipt(body.requestId), action: body.kind })) })
  assert.equal((await pending).ok, true)
  assert.throws(() => colony.deliver({ inventorySlot: 36 }), /INVALID_COLONY_DELIVERY/)
  colony.detach()
})

test('construction stocking carries an exact player item and never retries a lost result', async () => {
  const { bot, writes, colony } = harness()
  const pending = colony.stockResource({ buildingPosition: { x: 603, y: 64, z: 600 },
    inventorySlot: 7, quantity: 12, expectedSnbt: '{count:12,id:"minecraft:oak_planks"}',
    requestId: 'stock-once' })
  const body = JSON.parse(writes[0].packet.data.toString('utf8'))
  assert.equal(writes[0].packet.channel, 'maw_agent:colony_action')
  assert.equal(body.kind, 'stock_resource')
  assert.deepEqual(body.buildingPosition, { x: 603, y: 64, z: 600 })
  assert.equal(body.inventorySlot, 7)
  assert.equal(body.quantity, 12)
  assert.equal(body.expectedSnbt, '{count:12,id:"minecraft:oak_planks"}')
  assert.throws(() => colony.stockResource({ buildingPosition: { x: 603, y: 64, z: 600 },
    inventorySlot: 7, quantity: 12, expectedSnbt: 'item', requestId: 'stock-once' }),
  /COLONY_REQUEST_ALREADY_PENDING/)
  bot.emit('end')
  await assert.rejects(pending, /COLONY_CONNECTION_CLOSED/)
  assert.equal(writes.length, 1)
  assert.throws(() => colony.stockResource({ buildingPosition: { x: 0, y: 64, z: 0 },
    inventorySlot: 36, quantity: 1, expectedSnbt: 'item' }), /INVALID_COLONY_STOCK/)
  colony.detach()
})

test('a lost connection rejects pending delivery instead of retrying it', async () => {
  const { bot, colony } = harness()
  const pending = colony.deliver({ buildingPosition: { x: 8, y: 64, z: 4 }, token: 'token',
    inventorySlot: 5, quantity: 1, expectedSnbt: 'item' })
  bot.emit('end')
  await assert.rejects(pending, /COLONY_CONNECTION_CLOSED/)
  colony.detach()
})

test('founding and construction use explicit positions and caller-held hut items', async () => {
  const { bot, writes, colony } = harness()
  const position = { x: 300, y: 64, z: 300 }
  const founded = colony.found({ position, name: 'Agent Village', inventorySlot: 4,
    expectedSnbt: '{count:1,id:"minecolonies:blockhuttownhall"}', requestId: 'found-once' })
  assert.throws(() => colony.found({ position, name: 'Agent Village', inventorySlot: 4,
    expectedSnbt: '{count:1,id:"minecolonies:blockhuttownhall"}', requestId: 'found-once' }),
  /COLONY_REQUEST_ALREADY_PENDING/)
  const first = JSON.parse(writes[0].packet.data.toString('utf8'))
  assert.equal(first.kind, 'found')
  assert.equal(first.requestId, 'found-once')
  assert.deepEqual(first.position, position)
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state',
    data: Buffer.from(JSON.stringify({ ...receipt(first.requestId), action: first.kind })) })
  assert.equal((await founded).ok, true)

  const builder = colony.placeBuilder({ position: { x: 303, y: 64, z: 300 },
    inventorySlot: 5, expectedSnbt: '{count:1,id:"minecolonies:blockhutbuilder"}' })
  const second = JSON.parse(writes[1].packet.data.toString('utf8'))
  assert.equal(second.kind, 'place_builder')
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state',
    data: Buffer.from(JSON.stringify({ ...receipt(second.requestId), action: second.kind })) })
  await builder

  const build = colony.requestBuild({ buildingPosition: position,
    builderPosition: { x: 303, y: 64, z: 300 } })
  const third = JSON.parse(writes[2].packet.data.toString('utf8'))
  assert.equal(third.kind, 'request_build')
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state',
    data: Buffer.from(JSON.stringify({ ...receipt(third.requestId), action: third.kind })) })
  await build
  assert.throws(() => colony.found({ position, name: '', inventorySlot: 4, expectedSnbt: 'item' }),
    /INVALID_COLONY_FOUNDING/)
  colony.detach()
})

test('cached success for a different wire action never resolves or emits a construction success; explicit rejection without action is known', async () => {
  const { bot, writes, colony } = harness({ timeoutMs: 10 }), receipts = [], errors = []
  colony.events.on('receipt', body => receipts.push(body)); colony.events.on('protocolError', error => errors.push(error.message))
  const pending = colony.placeHut({ position: { x: 4, y: 64, z: 4 }, hutType: 'home', inventorySlot: 5,
    expectedSnbt: '{id:"minecolonies:blockhuthome",count:1}', requestId: 'reused' })
  const emit = body => bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state', data: Buffer.from(JSON.stringify(body)) })
  emit({ ...receipt('reused'), action: 'found' }); emit(receipt('reused'))
  assert.deepEqual(errors, ['COLONY_ACTION_RECEIPT_MISMATCH', 'COLONY_ACTION_RECEIPT_MISMATCH']); assert.equal(receipts.length, 0)
  const rejected = { ...receipt('reused'), ok: false, code: 'request_id_payload_conflict' }
  emit(rejected); assert.deepEqual(await pending, rejected); assert.equal(receipts.length, 1); assert.equal(writes.length, 1)
  const timedOut = colony.placeHut({ position: { x: 5, y: 64, z: 4 }, hutType: 'home', inventorySlot: 5,
    expectedSnbt: '{id:"minecolonies:blockhuthome",count:1}', requestId: 'never-replay' })
  emit({ ...receipt('never-replay'), action: 'found' })
  await assert.rejects(timedOut, /COLONY_RECEIPT_TIMEOUT/); assert.equal(writes.length, 2)
  colony.detach()
})

test('outgoing colony requests preserve complete SNBT and canonical schema fields and enforce the native byte budget before dispatch', async () => {
  const { bot, writes, colony } = harness()
  const snbt = '{id:"minecolonies:blockhuthome",count:1,components:{"minecraft:custom_data":{text:"\\\"☃\\\"",array:[I;1,2,3]}}}'
  const pending = colony.placeHut({ position: { x: 9, y: 64, z: -3 }, hutType: 'home', inventorySlot: 0, expectedSnbt: snbt, requestId: 'component-cas' })
  assert.deepEqual(JSON.parse(writes[0].packet.data.toString('utf8')), { schemaVersion: 1, kind: 'place_hut', position: { x: 9, y: 64, z: -3 }, hutType: 'home', inventorySlot: 0, expectedSnbt: snbt, requestId: 'component-cas' })
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state', data: Buffer.from(JSON.stringify({ ...receipt('component-cas'), action: 'place_hut' })) })
  await pending
  assert.throws(() => colony.placeHut({ position: { x: 9, y: 64, z: -3 }, hutType: 'home', inventorySlot: 0, expectedSnbt: '☃'.repeat(6000) }), /BUDGET/)
  assert.equal(writes.length, 1); colony.detach()
})

test('construction resource pages retain full same-id components and native counts on the own readonly connection', async () => {
  const { bot, writes, colony } = harness()
  const pending = colony.resources({ buildingPosition: { x: 603, y: 64, z: 600 }, offset: 12, limit: 24, requestId: 'resource-page-2' })
  const request = JSON.parse(writes[0].packet.data.toString('utf8'))
  assert.equal(writes[0].packet.channel, 'maw_agent:colony_query')
  assert.deepEqual(request, { schemaVersion: 1, kind: 'resources', buildingPosition: { x: 603, y: 64, z: 600 }, offset: 12, limit: 24, requestId: 'resource-page-2' })
  const oak = '{count:1,id:"domum_ornamentum:panel",components:{"domum_ornamentum:material":{main:"minecraft:oak_planks"}}}'
  const spruce = oak.replace('oak_planks', 'spruce_planks')
  const response = { ...receipt(request.requestId), query: 'resources', readOnly: true,
    source: 'native_builder_needed_resources', offset: 12, limit: 24, total: 38, returned: 2, truncated: true, nextOffset: 14,
    resources: [{ id: 'domum_ornamentum:panel', name: 'Oak panel', count: 1, snbt: oak, needed: 50, availableReported: 2, inDelivery: 3 },
      { id: 'domum_ornamentum:panel', name: 'Spruce panel', count: 1, snbt: spruce, needed: 5, availableReported: 0, inDelivery: 0 }] }
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state', data: Buffer.from(JSON.stringify(response)) })
  assert.deepEqual(await pending, response)
  assert.equal(response.resources[0].snbt, oak); assert.equal(response.resources[1].snbt, spruce)
  colony.detach()
})

test('resource page bounds reject before dispatch; native oversized rows and timeouts remain explicit readonly failures', async () => {
  const { bot, writes, colony } = harness({ timeoutMs: 3 })
  const buildingPosition = { x: 1, y: 64, z: 2 }
  for (const invalid of [undefined, {}, { buildingPosition, offset: -1 }, { buildingPosition, offset: 1.5 },
    { buildingPosition, offset: 2147483648 }, { buildingPosition, limit: 0 }, { buildingPosition, limit: 25 },
    { buildingPosition, limit: '12' }, { buildingPosition: { x: 0.5, y: 64, z: 2 } },
    { buildingPosition: { x: 2147483648, y: 64, z: 2 } }]) {
    assert.throws(() => colony.resources(invalid), /INVALID_COLONY_RESOURCES/)
  }
  assert.equal(writes.length, 0)
  const pending = colony.resources({ buildingPosition, requestId: 'blocked-page' })
  assert.deepEqual(JSON.parse(writes[0].packet.data.toString('utf8')), {
    schemaVersion: 1, kind: 'resources', buildingPosition, offset: 0, limit: 12, requestId: 'blocked-page'
  })
  const blocked = { ...receipt('blocked-page'), ok: false, query: 'resources', readOnly: true,
    code: 'resource_item_too_large', resources: [], offset: 0, limit: 12, total: 3, returned: 0,
    truncated: true, nextOffset: 0, blockedOffset: 0 }
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state', data: Buffer.from(JSON.stringify(blocked)) })
  assert.deepEqual(await pending, blocked)
  const unavailable = await colony.resources({ buildingPosition, offset: 2 })
  assert.equal(unavailable.code, 'colony_query_not_observed'); assert.equal(unavailable.outcomeKnown, true)
  assert.equal(unavailable.readOnly, true); assert.equal(writes.length, 2); colony.detach()
})

test('a successful status receipt cannot resolve or emit a pending resources page', async () => {
  const { bot, colony } = harness({ timeoutMs: 10 }), errors = [], received = []
  colony.events.on('protocolError', error => errors.push(error.message))
  colony.events.on('receipt', body => received.push(body))
  const pending = colony.resources({ buildingPosition: { x: 1, y: 64, z: 2 }, requestId: 'only-resources' })
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state', data: Buffer.from(JSON.stringify({ ...receipt('only-resources'), query: 'status' })) })
  assert.deepEqual(errors, ['COLONY_QUERY_RECEIPT_MISMATCH']); assert.equal(received.length, 0)
  bot.emit('end'); const unavailable = await pending
  assert.equal(unavailable.code, 'colony_query_connection_closed'); assert.equal(unavailable.readOnly, true)
  colony.detach()
})

test('end and detach permanently close fresh reads and mutations without writing to the old connection', async () => {
  for (const close of ['end', 'detach']) {
    const { bot, writes, colony } = harness()
    if (close === 'end') bot.emit('end'); else colony.detach()
    for (const read of [() => colony.status(), () => colony.capabilities(),
      () => colony.resources({ buildingPosition: { x: 1, y: 64, z: 2 } })]) {
      const result = await read()
      assert.equal(result.code, 'colony_query_connection_closed'); assert.equal(result.readOnly, true)
      assert.equal(result.changed, false); assert.equal(result.dispatched, false)
      assert.equal(result.outcomeKnown, true); assert.equal(result.outcomeUnknown, false)
    }
    const position = { x: 1, y: 64, z: 2 }, item = { inventorySlot: 3, expectedSnbt: 'complete-item' }
    for (const mutation of [
      () => colony.deliver({ buildingPosition: position, token: 'request-token', quantity: 1, ...item }),
      () => colony.stockResource({ buildingPosition: position, quantity: 1, ...item }),
      () => colony.found({ position, name: 'Own colony', ...item }),
      () => colony.placeBuilder({ position, ...item }),
      () => colony.placeHut({ position, hutType: 'home', ...item }),
      () => colony.requestBuild({ buildingPosition: position, builderPosition: position })]) {
      await assert.rejects(mutation(), error => error.code === 'COLONY_CONNECTION_CLOSED_NOT_SENT' &&
        error.outcomeKnown === true && error.outcomeUnknown === false && error.changed === false &&
        error.dispatched === false && error.knownNotApplied === true && error.retryAutomatically === false)
    }
    bot.emit('spawn'); bot.emit('respawn')
    assert.equal((await colony.status()).dispatched, false)
    assert.equal(writes.length, 0); colony.detach(); colony.detach()
    assert.equal(bot._client.listenerCount('custom_payload'), 0)
    for (const event of ['end', 'spawn', 'respawn']) assert.equal(bot.listenerCount(event), 0)
  }
})

test('spawn and respawn retire own-account pending requests and late receipts; fresh observations need new request IDs', async () => {
  for (const lifecycle of ['spawn', 'respawn']) {
    const { bot, writes, colony } = harness(), receipts = [], unmatched = [], invalidated = []
    colony.events.on('receipt', body => receipts.push(body)); colony.events.on('unmatchedReceipt', body => unmatched.push(body))
    colony.events.on('invalidate', body => invalidated.push(body))
    const position = { x: 1, y: 64, z: 2 }
    const read = colony.resources({ buildingPosition: position, requestId: 'old-resources' })
    const mutation = colony.stockResource({ buildingPosition: position, inventorySlot: 3,
      quantity: 1, expectedSnbt: 'complete-item', requestId: 'old-stock' })
    const unknown = assert.rejects(mutation, error => error.code === 'COLONY_PLAYER_LIFECYCLE_CHANGED' &&
      error.requestId === 'old-stock' && error.outcomeKnown === false && error.outcomeUnknown === true &&
      error.changed === null && error.dispatched === true && error.retryAutomatically === false)
    bot.emit(lifecycle)
    const unavailable = await read; await unknown
    assert.equal(unavailable.code, 'colony_query_player_lifecycle_changed')
    assert.equal(unavailable.readOnly, true); assert.equal(unavailable.outcomeKnown, true)
    assert.equal(invalidated.length, 1); assert.equal(invalidated[0].closed, false)
    for (const old of [{ ...receipt('old-resources'), query: 'resources', resources: ['old page'] },
      { ...receipt('old-stock'), action: 'stock_resource' }]) {
      bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state', data: Buffer.from(JSON.stringify(old)) })
    }
    assert.equal(receipts.length, 0); assert.equal(unmatched.length, 2)
    const oldPage = await colony.resources({ buildingPosition: position, requestId: 'old-resources' })
    assert.equal(oldPage.code, 'colony_query_request_retired'); assert.equal(oldPage.dispatched, false)
    await assert.rejects(colony.stockResource({ buildingPosition: position, inventorySlot: 3,
      quantity: 1, expectedSnbt: 'complete-item', requestId: 'old-stock' }), error =>
      error.code === 'COLONY_REQUEST_RETIRED_NOT_SENT' && error.outcomeKnown === true && error.changed === false)
    assert.equal(writes.length, 2)
    const fresh = colony.resources({ buildingPosition: position, requestId: 'new-page' })
    const response = { ...receipt('new-page'), query: 'resources', resources: [], total: 0, nextOffset: null }
    bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state', data: Buffer.from(JSON.stringify(response)) })
    assert.deepEqual(await fresh, response); assert.equal(receipts.length, 1); assert.equal(writes.length, 3)
    colony.detach()
  }
})

test('already dispatched mutations remain unknown on end, timeout, and synchronous wire error; none is automatically retried', async () => {
  for (const failure of ['end', 'timeout', 'write']) {
    const { bot, writes, colony } = harness({ timeoutMs: 3 })
    if (failure === 'write') bot._client.write = () => { writes.push('attempted'); throw Error('transport failed') }
    const mutation = colony.stockResource({ buildingPosition: { x: 1, y: 64, z: 2 }, inventorySlot: 3,
      quantity: 1, expectedSnbt: 'complete-item', requestId: `unknown-${failure}` })
    const unknown = assert.rejects(mutation, error => error.outcomeKnown === false && error.outcomeUnknown === true &&
      error.changed === null && error.dispatched === true && error.retryAutomatically === false)
    if (failure === 'end') bot.emit('end')
    await unknown
    assert.equal(writes.length, 1)
    if (failure !== 'end') await assert.rejects(colony.stockResource({ buildingPosition: { x: 1, y: 64, z: 2 },
      inventorySlot: 3, quantity: 1, expectedSnbt: 'complete-item', requestId: `unknown-${failure}` }), error =>
      error.code === 'COLONY_REQUEST_RETIRED_NOT_SENT' && error.dispatched === false && error.changed === false)
    assert.equal(writes.length, 1); colony.detach()
  }
})

test('mutation validation before dispatch exposes a known unchanged result', () => {
  const { writes, colony } = harness()
  assert.throws(() => colony.stockResource({ buildingPosition: { x: 1, y: 64, z: 2 }, inventorySlot: 36,
    quantity: 1, expectedSnbt: 'complete-item' }), error => error.code === 'INVALID_COLONY_STOCK' &&
    error.outcomeKnown === true && error.changed === false && error.dispatched === false)
  assert.equal(writes.length, 0); colony.detach()
})
