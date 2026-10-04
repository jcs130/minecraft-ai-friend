'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachMaidClient } = require('./maid-client.cjs')

const OWNER = '11111111-1111-1111-1111-111111111111'
const MAID = '010b4174-8e27-408e-916f-dfd40ee733dc'

function harness (options) {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot._client.uuid = OWNER
  const writes = []
  bot._client.write = (name, packet) => writes.push({ name, packet })
  return { bot, writes, maid: attachMaidClient(bot, options) }
}

function respond (bot, requestId, extra = {}) {
  const body = { schemaVersion: 1, kind: 'maid_receipt', requestId,
    playerUuid: OWNER, ok: true, code: 'ok', ...extra }
  bot._client.emit('custom_payload', { channel: 'maw_agent:maid_state',
    data: Buffer.from(JSON.stringify(body), 'utf8') })
  return body
}

test('real login UUID on _client authenticates private raw UTF-8 receipts without bot.uuid', async () => {
  const { bot, writes, maid } = harness()
  const errors = []
  maid.events.on('protocolError', error => errors.push(error.message))
  assert.equal(bot.uuid, undefined)
  const listed = maid.list()
  const packet = writes[0].packet
  assert.equal(writes[0].name, 'custom_payload')
  assert.equal(packet.channel, 'maw_agent:maid_query')
  assert.equal(packet.data[0], '{'.charCodeAt(0))
  const request = JSON.parse(packet.data.toString('utf8'))
  assert.equal(request.kind, 'list')
  respond(bot, request.requestId, { playerUuid: '22222222-2222-2222-2222-222222222222' })
  assert.deepEqual(errors, ['MAID_PLAYER_MISMATCH'])
  const real = respond(bot, request.requestId, { maids: [{ uuid: MAID, type: 'touhou_little_maid:maid' }] })
  assert.deepEqual(await listed, real)
  const status = maid.status(MAID)
  const second = JSON.parse(writes[1].packet.data.toString('utf8'))
  assert.equal(second.maidUuid, MAID)
  assert.equal(second.kind, 'status')
  respond(bot, second.requestId, { maid: { health: 20, hunger: 60, saturation: null, bag: [] } })
  assert.equal((await status).maid.saturation, null)
  maid.detach()
})

test('native task mutation is replayed locally only after a definite receipt; changed content conflicts', async () => {
  const { bot, writes, maid } = harness()
  const action = { maidUuid: MAID, taskId: 'touhou_little_maid:farm', requestId: 'farm-once' }
  const pending = maid.setTask(action)
  assert.throws(() => maid.setTask(action), /MAID_REQUEST_ALREADY_PENDING/)
  const body = JSON.parse(writes[0].packet.data.toString('utf8'))
  assert.equal(writes[0].packet.channel, 'maw_agent:maid_action')
  assert.equal(body.kind, 'task_set')
  assert.equal(body.taskId, 'touhou_little_maid:farm')
  const receipt = respond(bot, body.requestId, { code: 'task_set', outcome: 'applied' })
  assert.deepEqual(await pending, receipt)
  assert.deepEqual(await maid.setTask({ requestId: 'farm-once', taskId: action.taskId, maidUuid: MAID }), receipt)
  assert.equal(writes.length, 1)
  assert.throws(() => maid.setTask({ ...action, taskId: 'touhou_little_maid:idle' }), /MAID_REQUEST_ID_CONFLICT/)
  maid.detach()
})

test('native menu open preserves the actual window ID and does not invent an inventory transfer', async () => {
  const { bot, writes, maid } = harness()
  const pending = maid.openBag({ maidUuid: MAID, requestId: 'open-bag' })
  const body = JSON.parse(writes[0].packet.data.toString('utf8'))
  assert.equal(body.kind, 'open_bag')
  assert.equal(body.maidUuid, MAID)
  assert.equal(writes.length, 1)
  respond(bot, body.requestId, { code: 'native_menu_opened', windowId: 12 })
  assert.equal((await pending).windowId, 12)
  maid.detach()
})

test('a missing mutation receipt becomes unknown and cannot be automatically replayed', async () => {
  const { bot, writes, maid } = harness({ timeoutMs: 20 })
  const action = { maidUuid: MAID, pickup: true, requestId: 'pickup-lost' }
  const pending = maid.setPickup(action)
  await assert.rejects(pending, /MAID_RECEIPT_TIMEOUT.*outcome unknown/)
  assert.throws(() => maid.setPickup(action), /MAID_OUTCOME_UNKNOWN/)
  assert.equal(writes.length, 1)
  // Late receipts are observable but do not silently reverse the unknown action's decision.
  respond(bot, 'pickup-lost', { code: 'pickup_set', outcome: 'applied' })
  assert.throws(() => maid.setPickup(action), /MAID_OUTCOME_UNKNOWN/)
  const status = maid.status(MAID)
  const query = JSON.parse(writes[1].packet.data.toString('utf8'))
  respond(bot, query.requestId, { maid: { pickup: true } })
  assert.equal((await status).maid.pickup, true)
  maid.detach()
})

test('unknown server outcome and dropped connections do not cause a second write', async () => {
  const { bot, writes, maid } = harness()
  const action = { maidUuid: MAID, follow: false, requestId: 'follow-once' }
  const pending = maid.setFollow(action)
  respond(bot, action.requestId, { ok: false, code: 'action_outcome_unknown', outcome: 'unknown' })
  assert.equal((await pending).ok, false)
  assert.throws(() => maid.setFollow(action), /MAID_OUTCOME_UNKNOWN/)
  const next = maid.setFollow({ ...action, requestId: 'follow-second' })
  bot.emit('end')
  await assert.rejects(next, /MAID_CONNECTION_CLOSED/)
  assert.throws(() => maid.setFollow({ ...action, requestId: 'follow-third' }), /MAID_CONNECTION_CLOSED/)
  assert.equal(writes.length, 2)
  maid.detach()
})

test('invalid task, UUID, booleans and unauthenticated identity fail before writing', () => {
  const { bot, writes, maid } = harness()
  assert.throws(() => maid.status('not-a-uuid'), /INVALID_MAID_UUID/)
  assert.throws(() => maid.setTask({ maidUuid: MAID, taskId: 'farm' }), /INVALID_MAID_TASK_ID/)
  assert.throws(() => maid.setFollow({ maidUuid: MAID, follow: 'true' }), /INVALID_MAID_FOLLOW/)
  assert.throws(() => maid.setPickup({ maidUuid: MAID, pickup: 1 }), /INVALID_MAID_PICKUP/)
  bot._client.uuid = undefined
  // An ad hoc bot.uuid is not evidence of the authenticated connection's UUID.
  bot.uuid = OWNER
  assert.throws(() => maid.list(), /MAID_PLAYER_NOT_AUTHENTICATED/)
  assert.equal(writes.length, 0)
  maid.detach()
})

test('entity UUID is the fallback when the protocol login UUID is unavailable', async () => {
  const { bot, writes, maid } = harness()
  bot._client.uuid = undefined
  bot.entity = { uuid: OWNER }
  const pending = maid.status(MAID)
  const request = JSON.parse(writes[0].packet.data.toString('utf8'))
  respond(bot, request.requestId, { maid: { uuid: MAID } })
  assert.equal((await pending).ok, true)
  maid.detach()
})

test('authenticated protocol UUID takes precedence over an entity UUID', async () => {
  const { bot, writes, maid } = harness()
  bot.entity = { uuid: '22222222-2222-2222-2222-222222222222' }
  const pending = maid.list()
  const request = JSON.parse(writes[0].packet.data.toString('utf8'))
  respond(bot, request.requestId)
  assert.equal((await pending).playerUuid, OWNER)
  maid.detach()
})
