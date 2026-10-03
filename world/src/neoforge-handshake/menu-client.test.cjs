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
