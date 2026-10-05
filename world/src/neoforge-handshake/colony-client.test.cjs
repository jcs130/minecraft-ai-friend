'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachColonyClient } = require('./colony-client.cjs')

function harness () {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot._client.uuid = '11111111-1111-1111-1111-111111111111'
  const writes = []
  bot._client.write = (name, packet) => writes.push({ name, packet })
  return { bot, writes, colony: attachColonyClient(bot) }
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
    data: Buffer.from(JSON.stringify(receipt(body.requestId))) })
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
    data: Buffer.from(JSON.stringify(receipt(first.requestId))) })
  assert.equal((await founded).ok, true)

  const builder = colony.placeBuilder({ position: { x: 303, y: 64, z: 300 },
    inventorySlot: 5, expectedSnbt: '{count:1,id:"minecolonies:blockhutbuilder"}' })
  const second = JSON.parse(writes[1].packet.data.toString('utf8'))
  assert.equal(second.kind, 'place_builder')
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state',
    data: Buffer.from(JSON.stringify(receipt(second.requestId))) })
  await builder

  const build = colony.requestBuild({ buildingPosition: position,
    builderPosition: { x: 303, y: 64, z: 300 } })
  const third = JSON.parse(writes[2].packet.data.toString('utf8'))
  assert.equal(third.kind, 'request_build')
  bot._client.emit('custom_payload', { channel: 'maw_agent:colony_state',
    data: Buffer.from(JSON.stringify(receipt(third.requestId))) })
  await build
  assert.throws(() => colony.found({ position, name: '', inventorySlot: 4, expectedSnbt: 'item' }),
    /INVALID_COLONY_FOUNDING/)
  colony.detach()
})
