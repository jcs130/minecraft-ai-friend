'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Read MineColonies facts from the same authenticated player connection.
// This never uses the operator-only Numen command bridge.
function attachColonyClient (bot, { timeoutMs = 4000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('INVALID_COLONY_TIMEOUT')
  const events = new EventEmitter()
  const pending = new Map()

  function onPayload (packet) {
    if (packet.channel !== 'maw_agent:colony_state') return
    let body
    try {
      const bytes = Buffer.from(packet.data)
      if (bytes.length > 16384) throw Error('COLONY_RECEIPT_BUDGET_EXCEEDED')
      body = JSON.parse(bytes.toString('utf8'))
    }
    catch (error) { events.emit('protocolError', error); return }
    if (body.schemaVersion !== 1 || body.kind !== 'colony_receipt') return
    const owner = bot._client.uuid
    if (!UUID.test(owner || '') || !UUID.test(body.playerUuid || '') || body.playerUuid.toLowerCase() !== owner.toLowerCase()) {
      events.emit('protocolError', new Error('COLONY_PLAYER_MISMATCH'))
      return
    }
    const request = pending.get(body.requestId)
    if (request) {
      if (request.uuid !== body.playerUuid.toLowerCase()) return
      if (body.ok === true && request.expectedAction && body.action !== request.expectedAction) {
        events.emit('protocolError', new Error('COLONY_ACTION_RECEIPT_MISMATCH'))
        return
      }
      clearTimeout(request.timer)
      pending.delete(body.requestId)
      request.resolve(body)
    }
    events.emit('receipt', body)
  }

  function onEnd () {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      if (request.readOnly) request.resolve(readUnavailable(request.requestId, request.uuid, 'colony_query_connection_closed'))
      else request.reject(new Error('COLONY_CONNECTION_CLOSED'))
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
    const uuid = bot._client.uuid?.toLowerCase(), readOnly = channel === 'maw_agent:colony_query'
    if (!UUID.test(uuid || '')) throw Error('COLONY_PLAYER_NOT_READY')
    const data = Buffer.from(JSON.stringify({ schemaVersion: 1, ...body, requestId }), 'utf8')
    if (data.length > 16384) throw Error('COLONY_REQUEST_BUDGET_EXCEEDED')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        if (readOnly) resolve(readUnavailable(requestId, uuid, 'colony_query_not_observed'))
        else reject(new Error(`COLONY_RECEIPT_TIMEOUT ${requestId}: inspect state before retrying`))
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer, uuid, readOnly, requestId, expectedAction: readOnly ? null : body.kind })
      try {
        bot._client.write('custom_payload', {
          channel,
          data
        })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        if (readOnly) resolve(readUnavailable(requestId, uuid, 'colony_query_not_sent'))
        else reject(error)
      }
    })
  }
  function readUnavailable (requestId, playerUuid, code) {
    return { schemaVersion: 1, kind: 'colony_receipt', requestId, playerUuid, ok: false, code,
      readOnly: true, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false }
  }

  function status () { return ask('maw_agent:colony_query', { kind: 'status' }) }
  function capabilities () { return ask('maw_agent:colony_query', { kind: 'capabilities' }) }

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
  function placeHut ({ position, hutType, inventorySlot, expectedSnbt, requestId }) {
    if (!validPosition(position) || !['builder', 'home', 'farmer', 'warehouse', 'blacksmith', 'cook', 'deliveryman'].includes(hutType) ||
        !validInventoryItem(inventorySlot, expectedSnbt)) throw Error('INVALID_COLONY_HUT')
    return ask('maw_agent:colony_action', { kind: 'place_hut', position, hutType, inventorySlot, expectedSnbt, requestId })
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
    capabilities,
    deliver,
    stockResource,
    found,
    placeBuilder,
    placeHut,
    requestBuild,
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      onEnd()
    }
  }
}

module.exports = { attachColonyClient }
