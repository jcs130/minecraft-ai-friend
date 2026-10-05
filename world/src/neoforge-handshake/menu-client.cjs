'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')

// Attach to an already connected Mineflayer bot. Native slot identity and
// components come from the server, never from a vanilla proxy ItemStack.
function attachMenuClient (bot, { timeoutMs = 5000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('INVALID_MENU_TIMEOUT')
  const events = new EventEmitter()
  const pending = new Map()
  let state = null
  let epoch = 0
  let closed = false
  const MAX_BYTES = 65536
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  function identity () {
    const uuid = bot._client.uuid || bot.entity?.uuid
    return UUID.test(uuid || '') ? uuid.toLowerCase() : null
  }
  function owned (body, uuid) {
    return uuid && UUID.test(body?.playerUuid || '') && body.playerUuid.toLowerCase() === uuid &&
      (!body.self || (UUID.test(body.self.playerUuid || '') && body.self.playerUuid.toLowerCase() === uuid))
  }
  function validState (body, uuid) {
    return owned(body, uuid) && body.schemaVersion === 1 && body.kind === 'menu_state' &&
      Number.isInteger(body.windowId) && Number.isInteger(body.stateId) && Array.isArray(body.slots)
  }

  function onPayload (packet) {
    if (closed) return
    if (packet.channel !== 'maw_agent:menu_state') return
    let body
    try {
      const data = Buffer.from(packet.data)
      if (data.length > MAX_BYTES) throw new Error('MENU_RECEIPT_BUDGET_EXCEEDED')
      body = JSON.parse(data.toString('utf8'))
    }
    catch (error) { events.emit('protocolError', error); return }
    if (!body || body.schemaVersion !== 1) return
    const uuid = identity()
    if (!owned(body, uuid)) { events.emit('protocolError', new Error('MENU_PLAYER_MISMATCH')); return }
    if (body.kind === 'menu_state') {
      if (!validState(body, uuid)) { events.emit('protocolError', new Error('INVALID_MENU_STATE')); return }
      state = body
      events.emit('state', structuredClone(state))
    } else if (body.kind === 'menu_state_error') {
      state = null
      events.emit('stateError', body)
    } else if (body.kind === 'action_receipt') {
      const request = pending.get(body.requestId)
      // Late replies from a retired spawn/window cannot revive its snapshot.
      // Only a receipt belonging to a currently pending click may update it.
      if (!request) { events.emit('unmatchedReceipt', body); return }
      if (body.action !== 'click' || typeof body.ok !== 'boolean' || typeof body.changed !== 'boolean' ||
          typeof body.outcomeKnown !== 'boolean' || (request && (request.uuid !== uuid || request.epoch !== epoch))) {
        events.emit('protocolError', new Error('MENU_ACTION_RECEIPT_MISMATCH')); return
      }
      if (body.state && !validState(body.state, uuid)) {
        events.emit('protocolError', new Error('MENU_RECEIPT_STATE_MISMATCH')); return
      }
      if (body.stateUnavailable || body.outcomeKnown === false) {
        state = null
        events.emit('stateError', body)
      } else if (body.state) state = body.state
      events.emit('receipt', body)
      if (request) {
        clearTimeout(request.timer)
        pending.delete(body.requestId)
        request.resolve(body)
      }
    }
  }

  function reset (code) {
    state = null
    epoch++
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      const error = new Error(`${code} ${request.requestId}: outcome unknown; inspect authoritative state before any new action`)
      error.requestId = request.requestId
      error.outcomeUnknown = true
      error.retryAutomatically = false
      request.reject(error)
    }
    pending.clear()
  }
  function onSpawn () { reset('MENU_PLAYER_LIFECYCLE_CHANGED') }
  function onEnd () { closed = true; reset('MENU_CONNECTION_CLOSED') }

  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)
  bot.on('spawn', onSpawn)
  bot.on('respawn', onSpawn)

  async function click (slot, button = 0) {
    if (closed) throw new Error('MENU_CONNECTION_CLOSED')
    const uuid = identity()
    if (!uuid || !validState(state, uuid)) state = null
    if (!state) throw new Error('MENU_STATE_UNAVAILABLE: wait for maw_agent:menu_state')
    if (!Number.isInteger(slot) || slot < 0 || slot >= state.slots.length) throw new Error('INVALID_MENU_SLOT')
    if (button !== 0 && button !== 1) throw new Error('INVALID_MENU_BUTTON')
    const item = state.slots[slot]
    const requestId = randomUUID()
    const request = {
      requestId,
      playerUuid: uuid,
      windowId: state.windowId,
      expectedStateId: state.stateId,
      slot,
      button,
      expectedItemId: item?.id || 'minecraft:air',
      expectedCount: item?.count || 0,
      expectedSnbt: item?.snbt || '',
      expectedCarriedSnbt: state.carried?.snbt || ''
    }
    const data = Buffer.from(JSON.stringify(request), 'utf8')
    if (data.length > MAX_BYTES) throw new Error('MENU_REQUEST_BUDGET_EXCEEDED')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        state = null
        const error = new Error(`MENU_RECEIPT_TIMEOUT ${requestId}: outcome unknown; inspect state before any new action`)
        error.requestId = requestId
        error.outcomeUnknown = true
        error.retryAutomatically = false
        reject(error)
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer, uuid, epoch, requestId })
      try {
        bot._client.write('custom_payload', {
          channel: 'maw_agent:menu_action',
          data
        })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        state = null
        error.requestId = requestId
        error.outcomeUnknown = true
        error.retryAutomatically = false
        reject(error)
      }
    })
  }

  return {
    events,
    current: () => !closed && validState(state, identity()) ? structuredClone(state) : null,
    click,
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      bot.off('spawn', onSpawn)
      bot.off('respawn', onSpawn)
      onEnd()
    }
  }
}

module.exports = { attachMenuClient }
