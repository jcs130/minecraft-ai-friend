'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')

// Attach to an already connected Mineflayer bot. Native slot identity and
// components come from the server, never from a vanilla proxy ItemStack.
function attachMenuClient (bot) {
  const events = new EventEmitter()
  const pending = new Map()
  let state = null

  function onPayload (packet) {
    if (packet.channel !== 'maw_agent:menu_state') return
    let body
    try { body = JSON.parse(Buffer.from(packet.data).toString('utf8')) }
    catch (error) { events.emit('protocolError', error); return }
    if (body.schemaVersion !== 1) return
    if (body.kind === 'menu_state') {
      state = body
      events.emit('state', structuredClone(state))
    } else if (body.kind === 'menu_state_error') {
      events.emit('stateError', body)
    } else if (body.kind === 'action_receipt') {
      if (body.state) state = body.state
      events.emit('receipt', body)
      const request = pending.get(body.requestId)
      if (request) {
        clearTimeout(request.timer)
        pending.delete(body.requestId)
        request.resolve(body)
      }
    }
  }

  function onEnd () {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('MENU_CONNECTION_CLOSED: inspect authoritative state before retrying'))
    }
    pending.clear()
  }

  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)

  async function click (slot, button = 0) {
    if (!state) throw new Error('MENU_STATE_UNAVAILABLE: wait for maw_agent:menu_state')
    if (!Number.isInteger(slot) || slot < 0 || slot >= state.slots.length) throw new Error('INVALID_MENU_SLOT')
    if (button !== 0 && button !== 1) throw new Error('INVALID_MENU_BUTTON')
    const item = state.slots[slot]
    const requestId = randomUUID()
    const request = {
      requestId,
      windowId: state.windowId,
      slot,
      button,
      expectedItemId: item?.id || 'minecraft:air',
      expectedCount: item?.count || 0,
      expectedSnbt: item?.snbt || '',
      expectedCarriedSnbt: state.carried?.snbt || ''
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`MENU_RECEIPT_TIMEOUT ${requestId}: inspect state before retrying`))
      }, 5000)
      pending.set(requestId, { resolve, reject, timer })
      try {
        bot._client.write('custom_payload', {
          channel: 'maw_agent:menu_action',
          data: Buffer.from(JSON.stringify(request), 'utf8')
        })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(error)
      }
    })
  }

  return {
    events,
    current: () => state && structuredClone(state),
    click,
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      onEnd()
    }
  }
}

module.exports = { attachMenuClient }
