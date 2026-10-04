'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachMenuClient } = require('./menu-client.cjs')

test('oversized action receipt invalidates the old slot snapshot', () => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  const menu = attachMenuClient(bot)
  const errors = []
  menu.events.on('stateError', error => errors.push(error))
  bot._client.emit('custom_payload', {
    channel: 'maw_agent:menu_state',
    data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'menu_state', windowId: 3, slots: [null] }))
  })
  assert.equal(menu.current().windowId, 3)
  bot._client.emit('custom_payload', {
    channel: 'maw_agent:menu_state',
    data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'action_receipt', requestId: 'example',
      ok: true, changed: true, stateUnavailable: true, stateError: 'menu_state_too_large' }))
  })
  assert.equal(menu.current(), null)
  assert.equal(errors[0].stateError, 'menu_state_too_large')
  menu.detach()
})

test('menu state error blocks stale clicks until a fresh native snapshot arrives', async t => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  const menu = attachMenuClient(bot)
  t.after(() => menu.detach())
  const writes = []
  const emit = body => bot._client.emit('custom_payload', {
    channel: 'maw_agent:menu_state',
    data: Buffer.from(JSON.stringify(body))
  })
  bot._client.write = (name, packet) => {
    const request = JSON.parse(packet.data.toString('utf8'))
    writes.push({ name, channel: packet.channel, request })
    emit({ schemaVersion: 1, kind: 'action_receipt', requestId: request.requestId,
      ok: true, changed: false, code: 'no_change', state: fresh })
  }
  emit({ schemaVersion: 1, kind: 'menu_state', windowId: 3,
    slots: [{ id: 'minecraft:oak_log', count: 4, snbt: 'old-slot-components' }], carried: null })
  assert.equal(menu.current().windowId, 3)
  const errors = []
  menu.events.on('stateError', error => {
    assert.equal(menu.current(), null)
    errors.push(error)
  })
  emit({ schemaVersion: 1, kind: 'menu_state_error', windowId: 3, code: 'menu_state_too_large' })
  assert.equal(menu.current(), null)
  assert.equal(errors[0].code, 'menu_state_too_large')
  await assert.rejects(menu.click(0), /MENU_STATE_UNAVAILABLE/)
  assert.equal(writes.length, 0)

  const fresh = { schemaVersion: 1, kind: 'menu_state', windowId: 4,
    slots: [{ id: 'farmersdelight:tree_bark', count: 2, snbt: 'fresh-native-components' }],
    carried: { id: 'minecraft:stick', count: 1, snbt: 'fresh-cursor-components' } }
  emit(fresh)
  assert.equal(menu.current().windowId, 4)
  const receipt = await menu.click(0, 1)
  assert.equal(receipt.ok, true)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].name, 'custom_payload')
  assert.equal(writes[0].channel, 'maw_agent:menu_action')
  assert.deepEqual(writes[0].request, {
    requestId: receipt.requestId, windowId: 4, slot: 0, button: 1,
    expectedItemId: 'farmersdelight:tree_bark', expectedCount: 2,
    expectedSnbt: 'fresh-native-components', expectedCarriedSnbt: 'fresh-cursor-components'
  })
})
