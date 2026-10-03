'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachColonyClient } = require('./colony-client.cjs')

function harness () {
  const bot = new EventEmitter()
  bot.uuid = '11111111-1111-1111-1111-111111111111'
  bot._client = new EventEmitter()
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

test('a lost connection rejects pending delivery instead of retrying it', async () => {
  const { bot, colony } = harness()
  const pending = colony.deliver({ buildingPosition: { x: 8, y: 64, z: 4 }, token: 'token',
    inventorySlot: 5, quantity: 1, expectedSnbt: 'item' })
  bot.emit('end')
  await assert.rejects(pending, /COLONY_CONNECTION_CLOSED/)
  colony.detach()
})
