'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const { isDeepStrictEqual, TextDecoder } = require('node:util')
const decodeUtf8 = new TextDecoder('utf-8', { fatal: true })
const MAX_BYTES = 16384
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GROUP_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const int32 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
const groupIdValid = value => typeof value === 'string' && value.length <= 256 && GROUP_ID.test(value)
const itemValid = value => value && typeof value.id === 'string' && Number.isInteger(value.count) &&
  value.count >= 0 && typeof value.snbt === 'string'

// Only reads/selects the connected player's genuine Architects Cutter menu.
// Inventory inputs and taking the genuine output use the native menu SDK.
function attachDomumClient (bot, { timeoutMs = 5000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('INVALID_DOMUM_TIMEOUT')
  const events = new EventEmitter(), pending = new Map(), retired = new Set(), usedMutations = new Set()
  let closed = false, epoch = 0, currentState = null
  const identity = () => UUID.test(bot._client.uuid || '') ? bot._client.uuid.toLowerCase() : null
  const owns = (body, uuid) => uuid && UUID.test(body?.playerUuid || '') && body.playerUuid.toLowerCase() === uuid
  const validState = (state, uuid) => owns(state, uuid) && state.schemaVersion === 1 &&
    state.source === 'same_player_native_architects_cutter' && int32(state.windowId) && state.windowId >= 0 &&
    int32(state.stateId) && state.stateId >= 0 && state.position && ['x', 'y', 'z'].every(k => int32(state.position[k])) &&
    (state.currentGroup === null || groupIdValid(state.currentGroup)) && itemValid(state.currentVariant) &&
    itemValid(state.carried) && itemValid(state.output) && Array.isArray(state.inputs) && state.inputs.length <= 24 &&
    state.inputs.every((row, index) => row?.slot === index && itemValid(row.item)) &&
    Number.isInteger(state.outputSlot) && state.outputSlot >= 0 && Array.isArray(state.groups) &&
    state.groups.every(row => groupIdValid(row.groupId) && Number.isInteger(row.buttonId) && row.buttonId >= 0 &&
      Number.isInteger(row.variantCount) && row.variantCount >= 0)

  function mutationError (code, requestId, dispatched = false) {
    const error = new Error(`${code}${requestId ? ` ${requestId}` : ''}${dispatched ? ': outcome unknown; inspect authoritative state before any new action' : ': request not dispatched'}`)
    return Object.assign(error, { code, requestId, action: 'select', dispatched, changed: dispatched ? null : false,
      outcomeKnown: !dispatched, outcomeUnknown: dispatched, knownNotApplied: !dispatched, retryAutomatically: false })
  }
  function unavailable (code, requestId, query, uuid, dispatched = false) {
    return { schemaVersion: 1, kind: 'domum_receipt', playerUuid: uuid, requestId, query, readOnly: true,
      ok: false, code, changed: false, outcomeKnown: true, outcomeUnknown: false, dispatched,
      stateUnavailable: true, retryAutomatically: false }
  }
  function invalidate (code, mutationCode) {
    currentState = null; epoch++
    for (const request of pending.values()) {
      clearTimeout(request.timer); retired.add(request.id)
      if (request.readOnly) request.resolve(unavailable(code, request.id, request.kind, request.uuid, request.dispatched))
      else request.reject(mutationError(mutationCode, request.id, request.dispatched))
    }
    pending.clear()
    events.emit('invalidate', { epoch, code, closed })
  }
  function onEnd () {
    if (closed) return
    closed = true; invalidate('domum_connection_closed', 'DOMUM_CONNECTION_CLOSED')
  }
  function onLifecycle () {
    if (!closed) invalidate('domum_player_lifecycle_changed', 'DOMUM_PLAYER_LIFECYCLE_CHANGED')
  }
  function onPayload (packet) {
    if (closed || packet.channel !== 'maw_agent:domum_state') return
    let body
    try {
      const bytes = Buffer.from(packet.data)
      if (bytes.length > MAX_BYTES) throw Error('DOMUM_RECEIPT_BUDGET_EXCEEDED')
      body = JSON.parse(decodeUtf8.decode(bytes))
    } catch (error) { events.emit('protocolError', error); return }
    if (body?.schemaVersion !== 1 || body.kind !== 'domum_receipt') return
    const uuid = identity()
    if (!owns(body, uuid)) { events.emit('protocolError', Error('DOMUM_PLAYER_MISMATCH')); return }
    const request = pending.get(body.requestId)
    if (!request) { events.emit('unmatchedReceipt', body); return }
    if (request.uuid !== uuid || request.epoch !== epoch) return
    if (typeof body.ok !== 'boolean' || (request.readOnly ? body.query !== request.kind : body.action !== 'select') ||
        (!request.readOnly && (typeof body.outcomeKnown !== 'boolean' ||
          (body.outcomeKnown ? typeof body.changed !== 'boolean' : body.changed !== null))) ||
        (body.state && !validState(body.state, uuid))) {
      events.emit('protocolError', Error('DOMUM_RECEIPT_MISMATCH')); return
    }
    if (body.stateUnavailable || body.outcomeKnown === false) currentState = null
    else if (body.state) currentState = structuredClone(body.state)
    clearTimeout(request.timer); pending.delete(body.requestId); retired.add(body.requestId)
    request.resolve(body); events.emit('receipt', body)
  }
  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd); bot.on('spawn', onLifecycle); bot.on('respawn', onLifecycle)

  function ask (readOnly, body) {
    const id = body.requestId || randomUUID(), uuid = identity()
    if (typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(id)) throw mutationError('INVALID_DOMUM_REQUEST_ID', id)
    if (closed) return readOnly ? Promise.resolve(unavailable('domum_connection_closed', id, body.kind, uuid)) :
      Promise.reject(mutationError('DOMUM_CONNECTION_CLOSED_NOT_SENT', id))
    if (!uuid) throw mutationError('DOMUM_PLAYER_NOT_READY', id)
    if (pending.has(id) || retired.has(id) || usedMutations.has(id)) throw mutationError('DOMUM_REQUEST_ID_ALREADY_USED', id)
    const data = Buffer.from(JSON.stringify({ schemaVersion: 1, ...body, requestId: id }), 'utf8')
    if (data.length > MAX_BYTES) throw mutationError('DOMUM_REQUEST_BUDGET_EXCEEDED', id)
    return new Promise((resolve, reject) => {
      const request = { id, kind: body.kind, uuid, epoch, readOnly, resolve, reject, dispatched: false }
      request.timer = setTimeout(() => {
        pending.delete(id); retired.add(id); currentState = null
        if (readOnly) resolve(unavailable('domum_query_not_observed', id, body.kind, uuid, request.dispatched))
        else reject(mutationError('DOMUM_RECEIPT_TIMEOUT', id, request.dispatched))
      }, timeoutMs)
      pending.set(id, request)
      try {
        if (!readOnly) usedMutations.add(id)
        request.dispatched = true
        bot._client.write('custom_payload', { channel: readOnly ? 'maw_agent:domum_query' : 'maw_agent:domum_action', data })
      } catch (error) {
        clearTimeout(request.timer); pending.delete(id); retired.add(id); currentState = null
        if (readOnly) resolve(unavailable('domum_query_write_failed', id, body.kind, uuid, true))
        else { const unknown = mutationError('DOMUM_WRITE_OUTCOME_UNKNOWN', id, true); unknown.cause = error; reject(unknown) }
      }
    })
  }
  function state ({ requestId } = {}) { return ask(true, { kind: 'state', requestId }) }
  function choices ({ groupId, offset = 0, limit = 12, requestId } = {}) {
    if (!groupIdValid(groupId) || !int32(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 24) {
      throw mutationError('INVALID_DOMUM_CHOICES', requestId)
    }
    return ask(true, { kind: 'choices', groupId, offset, limit, requestId })
  }
  function select ({ selection, groupId, variantIndex, choiceSnbt, state: suppliedState, requestId } = {}) {
    if (closed) return Promise.reject(mutationError('DOMUM_CONNECTION_CLOSED_NOT_SENT', requestId))
    const uuid = identity()
    // A caller-supplied snapshot is a comparison hint, never a cache/epoch override.
    if (!validState(currentState, uuid)) throw mutationError('DOMUM_STATE_UNAVAILABLE', requestId)
    if (suppliedState != null && !validState(suppliedState, uuid)) throw mutationError('DOMUM_STATE_UNAVAILABLE', requestId)
    if (suppliedState != null && !isDeepStrictEqual(suppliedState, currentState)) {
      throw mutationError('DOMUM_STATE_CHANGED_NOT_SENT', requestId)
    }
    const snapshot = currentState
    if (!groupIdValid(groupId) || !['group', 'variant'].includes(selection)) throw mutationError('INVALID_DOMUM_SELECTION', requestId)
    const group = snapshot.groups.find(row => row.groupId === groupId)
    if (!group) throw mutationError('DOMUM_GROUP_NOT_AVAILABLE', requestId)
    if (selection === 'variant' && (snapshot.currentGroup !== groupId || !Number.isInteger(variantIndex) ||
        variantIndex < 0 || variantIndex > 4095 || variantIndex >= group.variantCount || typeof choiceSnbt !== 'string' || !choiceSnbt)) {
      throw mutationError('INVALID_DOMUM_VARIANT', requestId)
    }
    const body = { kind: 'select', selection, groupId, requestId, playerUuid: uuid, windowId: snapshot.windowId,
      expectedStateId: snapshot.stateId, expectedPosition: { ...snapshot.position }, expectedGroup: snapshot.currentGroup,
      expectedVariantSnbt: snapshot.currentVariant.snbt, expectedInputsSnbt: snapshot.inputs.map(row => row.item.snbt),
      expectedCarriedSnbt: snapshot.carried.snbt, expectedOutputSnbt: snapshot.output.snbt }
    if (selection === 'variant') Object.assign(body, { variantIndex, choiceSnbt })
    // Taking output/inserting materials happens through native menu.click, not here.
    return ask(false, body)
  }
  return { events, state, choices, select,
    current: () => !closed && validState(currentState, identity()) ? structuredClone(currentState) : null,
    detach: () => {
      bot._client.off('custom_payload', onPayload); bot.off('end', onEnd)
      bot.off('spawn', onLifecycle); bot.off('respawn', onLifecycle); onEnd()
    } }
}
module.exports = { attachDomumClient }
