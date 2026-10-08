'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const { TextDecoder } = require('node:util')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const reads = new Set(['create_settings', 'create_fluids', 'curios_state'])
const writes = new Set(['create_value', 'create_filter', 'curios_open', 'curios_page', 'world_interact'])
const utf8 = new TextDecoder('utf-8', { fatal: true })
const error = (code, requestId, dispatched = false, mutation = false) => Object.assign(new Error(code), {
  code, requestId, dispatched, outcomeKnown: !(mutation && dispatched), outcomeUnknown: mutation && dispatched,
  knownNotApplied: !dispatched, retryAutomatically: false
})

// Shares the existing player connection; no second account or target UUID.
function attachModOperationsClient (bot, { timeoutMs = 4000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw error('INVALID_MOD_TIMEOUT')
  const events = new EventEmitter(), pending = new Map(), issued = new Set()
  let epoch = 0, closed = false
  const identity = () => typeof bot._client.uuid === 'string' && UUID.test(bot._client.uuid) ? bot._client.uuid.toLowerCase() : null
  function payload (packet) {
    if (closed || packet.channel !== 'maw_agent:mod_state') return
    let body
    try {
      const bytes = Buffer.from(packet.data)
      if (bytes.length > 65536) throw error('MOD_RECEIPT_TOO_LARGE')
      body = JSON.parse(utf8.decode(bytes))
    } catch (e) { events.emit('protocolError', e); return }
    if (!body || body.schemaVersion !== 1 || body.kind !== 'mod_receipt' || typeof body.ok !== 'boolean') return
    if (!identity() || !UUID.test(body.playerUuid || '') || body.playerUuid.toLowerCase() !== identity()) {
      events.emit('protocolError', error('MOD_ACTOR_MISMATCH')); return
    }
    const request = pending.get(body.requestId)
    if (!request) { events.emit('unmatchedReceipt', body); return }
    if (request.uuid !== identity() || request.epoch !== epoch || request.kind !== body.action) {
      events.emit('protocolError', error('MOD_REQUEST_CONTEXT_MISMATCH')); return
    }
    clearTimeout(request.timer); pending.delete(body.requestId)
    events.emit('receipt', structuredClone(body)); request.resolve(structuredClone(body))
  }
  function reset () {
    epoch++
    for (const [id, request] of pending) {
      clearTimeout(request.timer)
      request.reject(error(request.mutation ? 'MOD_ACTION_OUTCOME_UNKNOWN' : 'MOD_READ_CONTEXT_CHANGED', id, true, request.mutation))
    }
    pending.clear()
  }
  function end () { closed = true; reset() }
  bot._client.on('custom_payload', payload); bot.on('spawn', reset); bot.on('respawn', reset); bot.on('end', end)
  function request (kind, fields = {}) {
    const mutation = writes.has(kind)
    if (!mutation && !reads.has(kind)) throw error('UNSUPPORTED_MOD_ACTION')
    const { requestId = randomUUID(), ...args } = fields
    if (closed || !identity()) return Promise.reject(error('MOD_CONNECTION_UNAVAILABLE', requestId))
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(requestId)) throw error('INVALID_MOD_REQUEST_ID')
    if (Object.keys(args).some(k => ['kind', 'schemaVersion', 'playerUuid', 'targetUuid', '__proto__'].includes(k))) throw error('INVALID_MOD_ARGUMENT')
    if (pending.has(requestId) || issued.has(requestId)) throw error('MOD_REQUEST_ALREADY_ISSUED', requestId)
    const data = Buffer.from(JSON.stringify({ ...args, schemaVersion: 1, kind, requestId }), 'utf8')
    if (data.length > 65536) throw error('MOD_REQUEST_TOO_LARGE', requestId)
    if (mutation) issued.add(requestId)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(error(mutation ? 'MOD_ACTION_OUTCOME_UNKNOWN' : 'MOD_QUERY_TIMEOUT', requestId, true, mutation))
      }, timeoutMs)
      pending.set(requestId, { kind, mutation, uuid: identity(), epoch, timer, resolve, reject })
      try { bot._client.write('custom_payload', { channel: `maw_agent:mod_${mutation ? 'action' : 'query'}`, data }) }
      catch (e) { clearTimeout(timer); pending.delete(requestId); reject(error('MOD_TRANSPORT_OUTCOME_UNKNOWN', requestId, true, mutation)) }
    })
  }
  return {
    events,
    world: { interact: args => request('world_interact', args) },
    create: { settings: args => request('create_settings', args), fluids: args => request('create_fluids', args),
      setValue: args => request('create_value', args), setFilter: args => request('create_filter', args) },
    curios: { state: () => request('curios_state'), open: args => request('curios_open', args), page: args => request('curios_page', args) },
    detach () { bot._client.off('custom_payload', payload); bot.off('spawn', reset); bot.off('respawn', reset); bot.off('end', end); end() }
  }
}
module.exports = { attachModOperationsClient }
