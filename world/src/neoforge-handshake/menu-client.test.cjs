'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachMenuClient } = require('./menu-client.cjs')
const OWN = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-2222-3333-4444-555555555555'

function state (fields = {}) {
  return { schemaVersion: 1, kind: 'menu_state', playerUuid: OWN, windowId: 3, stateId: 4,
    self: { playerUuid: OWN }, slots: [null], carried: null, ...fields }
}
function fixture (t, options) {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot._client.uuid = OWN
  const writes = []
  bot._client.write = (name, packet) => writes.push({ name, channel: packet.channel, request: JSON.parse(packet.data.toString('utf8')) })
  const menu = attachMenuClient(bot, options)
  t.after(() => menu.detach())
  const emit = body => bot._client.emit('custom_payload', { channel: 'maw_agent:menu_state', data: Buffer.from(JSON.stringify(body)) })
  const receipt = (requestId, fields = {}) => emit({ schemaVersion: 1, kind: 'action_receipt', playerUuid: OWN,
    action: 'click', requestId, ok: true, changed: true, outcomeKnown: true, ...fields })
  return { bot, writes, menu, emit, receipt }
}

test('oversized action receipt invalidates the owned pending slot snapshot', async t => {
  const { menu, emit, writes, receipt } = fixture(t)
  const errors = []
  menu.events.on('stateError', error => errors.push(error))
  emit(state())
  const pending = menu.click(0)
  receipt(writes[0].request.requestId, { stateUnavailable: true, stateError: 'menu_state_too_large' })
  assert.equal((await pending).ok, true)
  assert.equal(menu.current(), null)
  assert.equal(errors[0].stateError, 'menu_state_too_large')
})

test('owned menu error blocks stale clicks and fresh state supplies exact identity state and component CAS', async t => {
  const { menu, emit, writes, receipt } = fixture(t)
  emit(state({ slots: [{ id: 'minecraft:oak_log', count: 4, snbt: 'old-slot-components' }] }))
  const errors = []
  menu.events.on('stateError', error => { assert.equal(menu.current(), null); errors.push(error) })
  emit({ schemaVersion: 1, kind: 'menu_state_error', playerUuid: OWN, windowId: 3, code: 'menu_state_too_large' })
  assert.equal(errors[0].code, 'menu_state_too_large')
  await assert.rejects(menu.click(0), /MENU_STATE_UNAVAILABLE/)
  assert.equal(writes.length, 0)
  const fresh = state({ windowId: 4, stateId: 8,
    slots: [{ id: 'farmersdelight:tree_bark', count: 2, snbt: 'fresh-native-components' }],
    carried: { id: 'minecraft:stick', count: 1, snbt: 'fresh-cursor-components' } })
  emit(fresh)
  const pending = menu.click(0, 1)
  receipt(writes[0].request.requestId, { state: fresh })
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(writes[0].name, 'custom_payload')
  assert.equal(writes[0].channel, 'maw_agent:menu_action')
  assert.deepEqual(writes[0].request, {
    requestId: result.requestId, playerUuid: OWN, windowId: 4, expectedStateId: 8, slot: 0, button: 1,
    expectedItemId: 'farmersdelight:tree_bark', expectedCount: 2,
    expectedSnbt: 'fresh-native-components', expectedCarriedSnbt: 'fresh-cursor-components'
  })
})

test('foreign connection and embedded self identities cannot contaminate native inventory', t => {
  const { menu, emit } = fixture(t)
  const errors = []
  menu.events.on('protocolError', error => errors.push(error.message))
  const own = state()
  emit(own)
  emit(state({ playerUuid: OTHER }))
  emit(state({ self: { playerUuid: OTHER } }))
  emit({ schemaVersion: 1, kind: 'menu_state_error', playerUuid: OTHER, code: 'menu_state_too_large' })
  assert.deepEqual(menu.current(), own)
  assert.deepEqual(errors, ['MENU_PLAYER_MISMATCH', 'MENU_PLAYER_MISMATCH', 'MENU_PLAYER_MISMATCH'])
})

test('receipt requires original pending actor action and embedded state before resolution', async t => {
  const { menu, emit, writes, receipt } = fixture(t)
  const errors = []
  menu.events.on('protocolError', error => errors.push(error.message))
  emit(state())
  let resolved = false
  const pending = menu.click(0).then(result => { resolved = true; return result })
  const id = writes[0].request.requestId
  receipt(id, { playerUuid: OTHER })
  receipt(id, { action: 'cast' })
  receipt(id, { state: state({ playerUuid: OTHER }) })
  await Promise.resolve()
  assert.equal(resolved, false)
  assert.equal(menu.current().windowId, 3)
  receipt(id, { state: state({ stateId: 5 }) })
  await pending
  assert.equal(menu.current().stateId, 5)
  assert.deepEqual(errors, ['MENU_PLAYER_MISMATCH', 'MENU_ACTION_RECEIPT_MISMATCH', 'MENU_RECEIPT_STATE_MISMATCH'])
})

test('changed login UUID cannot complete an earlier same-request mutation', async t => {
  const { bot, menu, emit, writes, receipt } = fixture(t, { timeoutMs: 25 })
  const errors = []
  menu.events.on('protocolError', error => errors.push(error.message))
  emit(state())
  const pending = menu.click(0)
  const rejected = assert.rejects(pending, error => error.outcomeUnknown === true && /MENU_RECEIPT_TIMEOUT/.test(error.message))
  bot._client.uuid = OTHER
  receipt(writes[0].request.requestId, { playerUuid: OTHER, state: state({ playerUuid: OTHER, self: { playerUuid: OTHER } }) })
  assert.equal(menu.current(), null)
  await rejected
  assert.deepEqual(errors, ['MENU_ACTION_RECEIPT_MISMATCH'])
  assert.equal(writes.length, 1)
})

test('spawn and respawn retire pending clicks and late receipts never revive an old window', async t => {
  for (const event of ['spawn', 'respawn']) {
    const { bot, menu, emit, writes, receipt } = fixture(t)
    emit(state())
    const pending = menu.click(0)
    const rejected = assert.rejects(pending, error => error.outcomeUnknown && error.retryAutomatically === false)
    const id = writes[0].request.requestId
    bot.emit(event)
    await rejected
    receipt(id, { state: state() })
    assert.equal(menu.current(), null)
    await assert.rejects(menu.click(0), /MENU_STATE_UNAVAILABLE/)
    emit(state({ windowId: 9, stateId: 1 }))
    assert.equal(menu.current().windowId, 9)
    assert.equal(writes.length, 1)
  }
})

test('server unknown click outcome invalidates a supplied state instead of permitting retry', async t => {
  const { menu, emit, writes, receipt } = fixture(t)
  emit(state())
  const pending = menu.click(0)
  receipt(writes[0].request.requestId, { ok: false, changed: false, outcomeKnown: false,
    code: 'action_outcome_unknown', state: state() })
  assert.equal((await pending).outcomeKnown, false)
  assert.equal(menu.current(), null)
  await assert.rejects(menu.click(0), /MENU_STATE_UNAVAILABLE/)
  assert.equal(writes.length, 1)
})

test('lost receipt clears state and is unknown with one wire write and no automatic retry', async t => {
  const { menu, emit, writes } = fixture(t, { timeoutMs: 15 })
  emit(state())
  await assert.rejects(menu.click(0), error => error.outcomeUnknown && error.retryAutomatically === false)
  assert.equal(menu.current(), null)
  assert.equal(writes.length, 1)
})

test('native receive and send budgets are enforced before decoding or mutation', async t => {
  const { bot, menu, emit, writes } = fixture(t)
  const errors = []
  menu.events.on('protocolError', error => errors.push(error.message))
  bot._client.emit('custom_payload', { channel: 'maw_agent:menu_state', data: Buffer.alloc(65537, 32) })
  assert.deepEqual(errors, ['MENU_RECEIPT_BUDGET_EXCEEDED'])
  const large = state({ slots: [{ id: 'minecraft:stone', count: 1, snbt: '' }] })
  delete large.self
  // The complete snapshot fits, but additional outgoing CAS fields exceed
  // 64 KiB. No truncated SNBT or mutation packet is emitted.
  large.slots[0].snbt = 's'.repeat(65536 - Buffer.byteLength(JSON.stringify(large)) - 10)
  assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 65536)
  emit(large)
  assert.ok(menu.current())
  await assert.rejects(menu.click(0), /MENU_REQUEST_BUDGET_EXCEEDED/)
  assert.equal(writes.length, 0)
})

test('disconnect keeps old client closed and invalidates state and pending action', async t => {
  const { bot, menu, emit, writes, receipt } = fixture(t)
  emit(state())
  const pending = menu.click(0)
  const rejected = assert.rejects(pending, error => /MENU_CONNECTION_CLOSED/.test(error.message) && error.outcomeUnknown)
  bot.emit('end')
  await rejected
  emit(state())
  receipt(writes[0].request.requestId, { state: state() })
  assert.equal(menu.current(), null)
  await assert.rejects(menu.click(0), /MENU_CONNECTION_CLOSED/)
  assert.equal(writes.length, 1)
})
