'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const { TextDecoder } = require('node:util')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const utf8 = new TextDecoder('utf-8', { fatal: true })
const mutating = kind => ['cast', 'learn_glyph', 'configure', 'select'].includes(kind)
const validUuid = value => typeof value === 'string' && UUID.test(value)

// Uses this bot's connection; target body/player UUIDs are never sent.
function attachSpellClient (bot, { timeoutMs = 4000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('INVALID_SPELL_TIMEOUT')
  const events = new EventEmitter()
  const pending = new Map()
  const issuedCasts = new Set()
  let state = null
  let closed = false
  let epoch = 0

  function identity () { const uuid = bot._client.uuid || bot.entity?.uuid; return validUuid(uuid) ? uuid.toLowerCase() : null }
  function onPayload (packet) {
    if (closed || packet.channel !== 'maw_agent:spell_state') return
    let body
    try {
      const data = Buffer.from(packet.data)
      if (data.length > 65536) throw new Error('SPELL_RECEIPT_BUDGET_EXCEEDED')
      body = JSON.parse(utf8.decode(data))
    }
    catch (error) { events.emit('protocolError', error); return }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.schemaVersion !== 1 || body.kind !== 'spell_receipt' || body.engine !== 'ars_nouveau') return
    const request = pending.get(body.requestId)
    // A foreign actor receipt must not complete a pending request or update state.
    if (!identity() || !validUuid(body.playerUuid) || body.playerUuid.toLowerCase() !== identity()) {
      events.emit('protocolError', new Error('SPELL_ACTOR_MISMATCH'))
      return
    }
    if (!request) { events.emit('unmatchedReceipt', body); return }
    if (request.uuid !== identity() || request.epoch !== epoch) return
    if (body.action !== request.kind) {
      events.emit('protocolError', new Error('SPELL_ACTION_MISMATCH'))
      return
    }
    if (typeof body.ok !== 'boolean' || (body.state && (!validUuid(body.state.playerUuid) || body.state.playerUuid.toLowerCase() !== identity()))) {
      events.emit('protocolError', new Error('SPELL_RECEIPT_INVALID')); return
    }
    if (body.stateUnavailable || body.outcomeKnown === false) state = null
    else if (body.state) state = structuredClone(body.state)
    events.emit('receipt', structuredClone(body))
    if (request) {
      clearTimeout(request.timer)
      pending.delete(body.requestId)
      request.resolve(body)
    }
  }
  function reset (reason) {
    epoch++
    state = null
    for (const [requestId, request] of pending) {
      clearTimeout(request.timer)
      const error = new Error(`${mutating(request.kind) ? 'SPELL_CAST_OUTCOME_UNKNOWN' : reason} ${requestId}`)
      error.requestId = requestId
      error.outcomeUnknown = mutating(request.kind)
      error.outcomeKnown = !mutating(request.kind)
      error.retryAutomatically = false
      request.reject(error)
    }
    pending.clear()
  }
  function onEnd () { closed = true; reset('SPELL_CONNECTION_CLOSED') }
  function onLifecycle () { if (!closed) reset('SPELL_PLAYER_LIFECYCLE_CHANGED') }
  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)
  bot.on('spawn', onLifecycle)
  bot.on('respawn', onLifecycle)

  function ask (channel, kind, fields = {}, requestId = randomUUID()) {
    if (closed) return Promise.reject(new Error('SPELL_CONNECTION_CLOSED'))
    if (!identity()) return Promise.reject(new Error('SPELL_ACTOR_UNAVAILABLE'))
    if (!/^[A-Za-z0-9:_-]{1,64}$/.test(requestId)) return Promise.reject(new Error('INVALID_SPELL_REQUEST_ID'))
    if (pending.has(requestId)) return Promise.reject(new Error('SPELL_REQUEST_ALREADY_PENDING'))
    if (mutating(kind) && issuedCasts.has(requestId)) return Promise.reject(new Error('SPELL_CAST_ALREADY_ISSUED'))
    if (mutating(kind)) issuedCasts.add(requestId)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        if (mutating(kind)) state = null
        const error = new Error(`${mutating(kind) ? 'SPELL_CAST_OUTCOME_UNKNOWN' : 'SPELL_QUERY_TIMEOUT'} ${requestId}`)
        error.requestId = requestId
        error.outcomeUnknown = mutating(kind)
        error.retryAutomatically = false
        reject(error)
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer, kind, uuid: identity(), epoch })
      try {
        bot._client.write('custom_payload', {
          channel,
          data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind, requestId, ...fields }), 'utf8')
        })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        if (mutating(kind)) state = null
        error.requestId = requestId
        error.outcomeUnknown = mutating(kind)
        error.retryAutomatically = false
        reject(error)
      }
    })
  }
  function validSpell (spellId) {
    if (typeof spellId !== 'string' || !/^ars_nouveau:slot_(0|[1-9][0-9]?)$/.test(spellId)) throw new Error('INVALID_SPELL_ID')
  }
  function explain (spellId) {
    validSpell(spellId)
    return ask('maw_agent:spell_query', 'explain', { spellId })
  }
  function cast (spellId, options = {}) {
    validSpell(spellId)
    if (Object.keys(options).some(key => !['expectedHeldSnbt', 'expectedHotbarSlot', 'requestId'].includes(key))) {
      throw new Error('UNSUPPORTED_SPELL_OPTION')
    }
    const expectedHeldSnbt = options.expectedHeldSnbt ?? state?.heldSnbt
    const expectedHotbarSlot = options.expectedHotbarSlot ?? state?.selectedHotbarSlot
    if (typeof expectedHeldSnbt !== 'string' || !Number.isInteger(expectedHotbarSlot) || expectedHotbarSlot < 0 || expectedHotbarSlot > 8) {
      throw new Error('SPELL_STATE_UNAVAILABLE')
    }
    return ask('maw_agent:spell_action', 'cast', { spellId, expectedHeldSnbt, expectedHotbarSlot }, options.requestId)
  }
  function heldAction (kind, fields = {}, options = {}) {
    if (Object.keys(options).some(k => !['expectedHeldSnbt', 'expectedHotbarSlot', 'requestId'].includes(k))) throw new Error('UNSUPPORTED_SPELL_OPTION')
    const expectedHeldSnbt = options.expectedHeldSnbt ?? state?.heldSnbt
    const expectedHotbarSlot = options.expectedHotbarSlot ?? state?.selectedHotbarSlot
    if (typeof expectedHeldSnbt !== 'string' || !Number.isInteger(expectedHotbarSlot) || expectedHotbarSlot < 0 || expectedHotbarSlot > 8) throw new Error('SPELL_STATE_UNAVAILABLE')
    return ask('maw_agent:spell_action', kind, { ...fields, expectedHeldSnbt, expectedHotbarSlot }, options.requestId)
  }
  function glyphs (args = {}) {
    const { offset = 0, limit = 12, requestId } = args
    if (Object.keys(args).some(k => !['offset', 'limit', 'requestId'].includes(k)) || !Number.isInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error('INVALID_GLYPH_QUERY')
    return ask('maw_agent:spell_query', 'glyphs', { offset, limit }, requestId)
  }
  function configure (args) {
    const { slot, glyphs, name, ...options } = args
    if (!Number.isInteger(slot) || slot < 0 || slot > 99 || typeof name !== 'string' || name.length > 64 || !Array.isArray(glyphs) || !glyphs.length || glyphs.length > 32 || glyphs.some(g => typeof g !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(g))) throw new Error('INVALID_SPELL_RECIPE')
    return heldAction('configure', { slot, glyphs, name }, options)
  }
  function select (slot, options = {}) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 99) throw new Error('INVALID_SPELL_SLOT')
    return heldAction('select', { slot }, options)
  }
  return {
    events,
    glyphs,
    learnGlyph: options => heldAction('learn_glyph', {}, options),
    configure,
    select,
    current: () => !closed && state?.playerUuid?.toLowerCase() === identity() ? structuredClone(state) : null,
    list: () => ask('maw_agent:spell_query', 'list'),
    explain,
    cast,
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      bot.off('spawn', onLifecycle)
      bot.off('respawn', onLifecycle)
      onEnd()
    }
  }
}

module.exports = { attachSpellClient }
