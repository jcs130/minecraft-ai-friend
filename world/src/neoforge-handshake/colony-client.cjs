'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')

// Read MineColonies facts from the same authenticated player connection.
// This never uses the operator-only Numen command bridge.
function attachColonyClient (bot) {
  const events = new EventEmitter()
  const pending = new Map()

  function onPayload (packet) {
    if (packet.channel !== 'maw_agent:colony_state') return
    let body
    try { body = JSON.parse(Buffer.from(packet.data).toString('utf8')) }
    catch (error) { events.emit('protocolError', error); return }
    if (body.schemaVersion !== 1 || body.kind !== 'colony_receipt') return
    if (body.playerUuid && bot.uuid && body.playerUuid !== bot.uuid) {
      events.emit('protocolError', new Error('COLONY_PLAYER_MISMATCH'))
      return
    }
    events.emit('receipt', body)
    const request = pending.get(body.requestId)
    if (request) {
      clearTimeout(request.timer)
      pending.delete(body.requestId)
      request.resolve(body)
    }
  }

  function onEnd () {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('COLONY_CONNECTION_CLOSED'))
    }
    pending.clear()
  }

  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)

  function ask (channel, body) {
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`COLONY_QUERY_TIMEOUT ${requestId}`))
      }, 4000)
      pending.set(requestId, { resolve, reject, timer })
      try {
        bot._client.write('custom_payload', {
          channel,
          data: Buffer.from(JSON.stringify({ schemaVersion: 1, requestId, ...body }), 'utf8')
        })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(error)
      }
    })
  }

  function status () { return ask('maw_agent:colony_query', { kind: 'status' }) }

  function deliver ({ buildingPosition, token, inventorySlot, quantity, expectedSnbt }) {
    if (!buildingPosition || !['x', 'y', 'z'].every(key => Number.isInteger(buildingPosition[key])) ||
        typeof token !== 'string' || token.length < 1 ||
        !Number.isInteger(inventorySlot) || inventorySlot < 0 || inventorySlot >= 36 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 64 ||
        typeof expectedSnbt !== 'string' || !expectedSnbt) {
      throw new Error('INVALID_COLONY_DELIVERY')
    }
    return ask('maw_agent:colony_action', {
      kind: 'deliver', buildingPosition, token, inventorySlot, quantity, expectedSnbt
    })
  }

  return {
    events,
    status,
    deliver,
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      onEnd()
    }
  }
}

module.exports = { attachColonyClient }
