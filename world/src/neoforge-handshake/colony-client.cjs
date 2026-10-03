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
    const requestId = body.requestId || randomUUID()
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(requestId)) {
      throw new Error('INVALID_COLONY_REQUEST_ID')
    }
    if (pending.has(requestId)) throw new Error('COLONY_REQUEST_ALREADY_PENDING')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`COLONY_RECEIPT_TIMEOUT ${requestId}: inspect state before retrying`))
      }, 4000)
      pending.set(requestId, { resolve, reject, timer })
      try {
        bot._client.write('custom_payload', {
          channel,
          data: Buffer.from(JSON.stringify({ schemaVersion: 1, ...body, requestId }), 'utf8')
        })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(error)
      }
    })
  }

  function status () { return ask('maw_agent:colony_query', { kind: 'status' }) }

  function deliver ({ buildingPosition, token, inventorySlot, quantity, expectedSnbt, requestId }) {
    if (!buildingPosition || !['x', 'y', 'z'].every(key => Number.isInteger(buildingPosition[key])) ||
        typeof token !== 'string' || token.length < 1 ||
        !Number.isInteger(inventorySlot) || inventorySlot < 0 || inventorySlot >= 36 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 64 ||
        typeof expectedSnbt !== 'string' || !expectedSnbt) {
      throw new Error('INVALID_COLONY_DELIVERY')
    }
    return ask('maw_agent:colony_action', {
      kind: 'deliver', buildingPosition, token, inventorySlot, quantity, expectedSnbt, requestId
    })
  }

  function stockResource ({ buildingPosition, inventorySlot, quantity, expectedSnbt, requestId }) {
    if (!validPosition(buildingPosition) || !validInventoryItem(inventorySlot, expectedSnbt) ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 64) {
      throw new Error('INVALID_COLONY_STOCK')
    }
    return ask('maw_agent:colony_action', {
      kind: 'stock_resource', buildingPosition, inventorySlot, quantity, expectedSnbt, requestId
    })
  }

  function validPosition (position) {
    return position && ['x', 'y', 'z'].every(key => Number.isInteger(position[key]))
  }

  function validInventoryItem (inventorySlot, expectedSnbt) {
    return Number.isInteger(inventorySlot) && inventorySlot >= 0 && inventorySlot < 36 &&
      typeof expectedSnbt === 'string' && expectedSnbt.length > 0
  }

  function found ({ position, name, inventorySlot, expectedSnbt, requestId }) {
    if (!validPosition(position) || typeof name !== 'string' || !name.trim() ||
        !validInventoryItem(inventorySlot, expectedSnbt)) throw new Error('INVALID_COLONY_FOUNDING')
    return ask('maw_agent:colony_action', {
      kind: 'found', position, name, inventorySlot, expectedSnbt, requestId
    })
  }

  function placeBuilder ({ position, inventorySlot, expectedSnbt, requestId }) {
    if (!validPosition(position) || !validInventoryItem(inventorySlot, expectedSnbt)) {
      throw new Error('INVALID_COLONY_BUILDER')
    }
    return ask('maw_agent:colony_action', {
      kind: 'place_builder', position, inventorySlot, expectedSnbt, requestId
    })
  }

  function requestBuild ({ buildingPosition, builderPosition, requestId }) {
    if (!validPosition(buildingPosition) || !validPosition(builderPosition)) {
      throw new Error('INVALID_COLONY_BUILD_REQUEST')
    }
    return ask('maw_agent:colony_action', {
      kind: 'request_build', buildingPosition, builderPosition, requestId
    })
  }

  return {
    events,
    status,
    deliver,
    stockResource,
    found,
    placeBuilder,
    requestBuild,
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      onEnd()
    }
  }
}

module.exports = { attachColonyClient }
