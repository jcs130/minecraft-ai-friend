'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Read MineColonies facts from the same server-side player connection.
// This never uses the operator-only Numen command bridge.
function attachColonyClient (bot, { timeoutMs = 4000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('INVALID_COLONY_TIMEOUT')
  const events = new EventEmitter()
  const pending = new Map()
  const issuedRequests = new Set()
  const retiredRequests = new Set()
  let closed = false
  let epoch = 0

  function onPayload (packet) {
    if (closed) return
    if (packet.channel !== 'maw_agent:colony_state') return
    let body
    try {
      const bytes = Buffer.from(packet.data)
      if (bytes.length > 16384) throw Error('COLONY_RECEIPT_BUDGET_EXCEEDED')
      body = JSON.parse(bytes.toString('utf8'))
    }
    catch (error) { events.emit('protocolError', error); return }
    if (!body || body.schemaVersion !== 1 || body.kind !== 'colony_receipt') return
    const owner = bot._client.uuid
    if (!UUID.test(owner || '') || !UUID.test(body.playerUuid || '') || body.playerUuid.toLowerCase() !== owner.toLowerCase()) {
      events.emit('protocolError', new Error('COLONY_PLAYER_MISMATCH'))
      return
    }
    const request = pending.get(body.requestId)
    // Late replies must not revive an old read snapshot after spawn/respawn,
    // nor masquerade as a result for a different request in the same UUID.
    if (!request) { events.emit('unmatchedReceipt', body); return }
    if (request) {
      if (request.uuid !== body.playerUuid.toLowerCase() || request.epoch !== epoch) return
      if (body.ok === true && request.expectedAction && body.action !== request.expectedAction) {
        events.emit('protocolError', new Error('COLONY_ACTION_RECEIPT_MISMATCH'))
        return
      }
      if (body.ok === true && request.expectedQuery && body.query !== request.expectedQuery) {
        events.emit('protocolError', new Error('COLONY_QUERY_RECEIPT_MISMATCH'))
        return
      }
      clearTimeout(request.timer)
      pending.delete(body.requestId)
      request.resolve(body)
    }
    events.emit('receipt', body)
  }

  function reset (readCode, mutationCode) {
    epoch++
    for (const requestId of issuedRequests) retiredRequests.add(requestId)
    issuedRequests.clear()
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      if (request.readOnly) request.resolve(readUnavailable(request.requestId, request.uuid, readCode, request.kind, request.dispatched))
      else request.reject(mutationError(mutationCode, request.requestId, request.kind, request.dispatched))
    }
    pending.clear()
    events.emit('invalidate', { epoch, code: readCode, closed })
  }

  function onEnd () {
    if (closed) return
    closed = true
    reset('colony_query_connection_closed', 'COLONY_CONNECTION_CLOSED')
  }

  function onLifecycle () {
    if (!closed) reset('colony_query_player_lifecycle_changed', 'COLONY_PLAYER_LIFECYCLE_CHANGED')
  }

  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)
  bot.on('spawn', onLifecycle)
  bot.on('respawn', onLifecycle)

  function ask (channel, body) {
    const requestId = body.requestId || randomUUID()
    const uuid = bot._client.uuid?.toLowerCase(), readOnly = channel === 'maw_agent:colony_query'
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(requestId)) {
      throw mutationError('INVALID_COLONY_REQUEST_ID', requestId, body.kind, false)
    }
    if (closed) {
      if (readOnly) return Promise.resolve(readUnavailable(requestId, UUID.test(uuid || '') ? uuid : null, 'colony_query_connection_closed', body.kind))
      return Promise.reject(mutationError('COLONY_CONNECTION_CLOSED_NOT_SENT', requestId, body.kind, false))
    }
    if (retiredRequests.has(requestId)) {
      if (readOnly) return Promise.resolve(readUnavailable(requestId, uuid, 'colony_query_request_retired', body.kind))
      return Promise.reject(mutationError('COLONY_REQUEST_RETIRED_NOT_SENT', requestId, body.kind, false))
    }
    if (pending.has(requestId)) throw mutationError('COLONY_REQUEST_ALREADY_PENDING', requestId, body.kind, false)
    if (!UUID.test(uuid || '')) throw mutationError('COLONY_PLAYER_NOT_READY', requestId, body.kind, false)
    const data = Buffer.from(JSON.stringify({ schemaVersion: 1, ...body, requestId }), 'utf8')
    if (data.length > 16384) throw mutationError('COLONY_REQUEST_BUDGET_EXCEEDED', requestId, body.kind, false)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        retiredRequests.add(requestId)
        issuedRequests.delete(requestId)
        pending.delete(requestId)
        if (readOnly) resolve(readUnavailable(requestId, uuid, 'colony_query_not_observed', body.kind, true))
        else reject(mutationError('COLONY_RECEIPT_TIMEOUT', requestId, body.kind, true))
      }, timeoutMs)
      const request = { resolve, reject, timer, uuid, readOnly, requestId, kind: body.kind, epoch, dispatched: false,
        expectedAction: readOnly ? null : body.kind, expectedQuery: readOnly && body.kind === 'resources' ? 'resources' : null }
      pending.set(requestId, request)
      try {
        issuedRequests.add(requestId)
        request.dispatched = true // Once write is called a thrown error cannot prove that no bytes were sent.
        bot._client.write('custom_payload', {
          channel,
          data
        })
      } catch (error) {
        clearTimeout(timer)
        retiredRequests.add(requestId)
        issuedRequests.delete(requestId)
        pending.delete(requestId)
        if (readOnly) resolve(readUnavailable(requestId, uuid, 'colony_query_not_sent', body.kind, true))
        else {
          const unknown = mutationError('COLONY_WRITE_OUTCOME_UNKNOWN', requestId, body.kind, true)
          unknown.cause = error
          reject(unknown)
        }
      }
    })
  }
  function readUnavailable (requestId, playerUuid, code, query, dispatched = false) {
    return { schemaVersion: 1, kind: 'colony_receipt', requestId, playerUuid, ok: false, code,
      query, readOnly: true, changed: false, dispatched,
      outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false }
  }

  function mutationError (code, requestId, action, dispatched) {
    const error = new Error(`${code}${requestId ? ` ${requestId}` : ''}${dispatched ? ': outcome unknown; inspect authoritative state before any new action' : ': request not dispatched'}`)
    return Object.assign(error, { code, requestId, action, dispatched, changed: dispatched ? null : false,
      outcomeKnown: !dispatched, outcomeUnknown: dispatched, knownNotApplied: !dispatched, retryAutomatically: false })
  }

  function status () { return ask('maw_agent:colony_query', { kind: 'status' }) }
  function capabilities () { return ask('maw_agent:colony_query', { kind: 'capabilities' }) }

  function resources ({ buildingPosition, offset = 0, limit = 12, requestId } = {}) {
    if (!validPosition(buildingPosition) ||
        !['x', 'y', 'z'].every(key => buildingPosition[key] >= -2147483648 && buildingPosition[key] <= 2147483647) ||
        !Number.isInteger(offset) || offset < 0 || offset > 2147483647 ||
        !Number.isInteger(limit) || limit < 1 || limit > 24) throw Error('INVALID_COLONY_RESOURCES')
    return ask('maw_agent:colony_query', { kind: 'resources', buildingPosition, offset, limit, requestId })
  }

  function deliver ({ buildingPosition, token, inventorySlot, quantity, expectedSnbt, requestId }) {
    if (!buildingPosition || !['x', 'y', 'z'].every(key => Number.isInteger(buildingPosition[key])) ||
        typeof token !== 'string' || token.length < 1 ||
        !Number.isInteger(inventorySlot) || inventorySlot < 0 || inventorySlot >= 36 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 64 ||
        typeof expectedSnbt !== 'string' || !expectedSnbt) {
      throw mutationError('INVALID_COLONY_DELIVERY', requestId, 'deliver', false)
    }
    return ask('maw_agent:colony_action', {
      kind: 'deliver', buildingPosition, token, inventorySlot, quantity, expectedSnbt, requestId
    })
  }

  function stockResource ({ buildingPosition, inventorySlot, quantity, expectedSnbt, requestId }) {
    if (!validPosition(buildingPosition) || !validInventoryItem(inventorySlot, expectedSnbt) ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 64) {
      throw mutationError('INVALID_COLONY_STOCK', requestId, 'stock_resource', false)
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
        !validInventoryItem(inventorySlot, expectedSnbt)) throw mutationError('INVALID_COLONY_FOUNDING', requestId, 'found', false)
    return ask('maw_agent:colony_action', {
      kind: 'found', position, name, inventorySlot, expectedSnbt, requestId
    })
  }

  function placeBuilder ({ position, inventorySlot, expectedSnbt, requestId }) {
    if (!validPosition(position) || !validInventoryItem(inventorySlot, expectedSnbt)) {
      throw mutationError('INVALID_COLONY_BUILDER', requestId, 'place_builder', false)
    }
    return ask('maw_agent:colony_action', {
      kind: 'place_builder', position, inventorySlot, expectedSnbt, requestId
    })
  }
  function placeHut ({ position, hutType, inventorySlot, expectedSnbt, requestId }) {
    if (!validPosition(position) || !['builder', 'home', 'farmer', 'warehouse', 'blacksmith', 'cook', 'deliveryman'].includes(hutType) ||
        !validInventoryItem(inventorySlot, expectedSnbt)) throw mutationError('INVALID_COLONY_HUT', requestId, 'place_hut', false)
    return ask('maw_agent:colony_action', { kind: 'place_hut', position, hutType, inventorySlot, expectedSnbt, requestId })
  }

  function requestBuild ({ buildingPosition, builderPosition, requestId }) {
    if (!validPosition(buildingPosition) || !validPosition(builderPosition)) {
      throw mutationError('INVALID_COLONY_BUILD_REQUEST', requestId, 'request_build', false)
    }
    return ask('maw_agent:colony_action', {
      kind: 'request_build', buildingPosition, builderPosition, requestId
    })
  }

  return {
    events,
    status,
    capabilities,
    resources,
    deliver,
    stockResource,
    found,
    placeBuilder,
    placeHut,
    requestBuild,
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      bot.off('spawn', onLifecycle)
      bot.off('respawn', onLifecycle)
      onEnd()
    }
  }
}

module.exports = { attachColonyClient }
