'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')

// Uses this bot's connection; target body/player UUIDs are never sent.
function attachSpellClient (bot, { timeoutMs = 4000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('INVALID_SPELL_TIMEOUT')
  const events = new EventEmitter()
  const pending = new Map()
  const issuedCasts = new Set()
  let state = null
  let closed = false

  function identity () { return bot._client.uuid || bot.entity?.uuid || null }
  function onPayload (packet) {
    if (packet.channel !== 'maw_agent:spell_state') return
    let body
    try { body = JSON.parse(Buffer.from(packet.data).toString('utf8')) }
    catch (error) { events.emit('protocolError', error); return }
    if (body.schemaVersion !== 1 || body.kind !== 'spell_receipt' || body.engine !== 'ars_nouveau') return
    const request = pending.get(body.requestId)
    // A foreign actor receipt must not complete a pending request or update state.
    if (!identity() || body.playerUuid !== identity()) {
      events.emit('protocolError', new Error('SPELL_ACTOR_MISMATCH'))
      return
    }
    if (request && body.action !== request.kind) {
      events.emit('protocolError', new Error('SPELL_ACTION_MISMATCH'))
      return
    }
    if (body.stateUnavailable || body.outcomeKnown === false) state = null
    else if (body.state?.playerUuid === identity()) state = body.state
    events.emit('receipt', body)
    if (request) {
      clearTimeout(request.timer)
      pending.delete(body.requestId)
      request.resolve(body)
    }
  }
  function onEnd () {
    closed = true
    state = null
    for (const [requestId, request] of pending) {
      clearTimeout(request.timer)
      const error = new Error(`${request.kind === 'cast' ? 'SPELL_CAST_OUTCOME_UNKNOWN' : 'SPELL_CONNECTION_CLOSED'} ${requestId}`)
      error.requestId = requestId
      error.outcomeUnknown = request.kind === 'cast'
      error.retryAutomatically = false
      request.reject(error)
    }
    pending.clear()
  }
  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)

  function ask (channel, kind, fields = {}, requestId = randomUUID()) {
    if (closed) return Promise.reject(new Error('SPELL_CONNECTION_CLOSED'))
    if (!identity()) return Promise.reject(new Error('SPELL_ACTOR_UNAVAILABLE'))
    if (!/^[A-Za-z0-9:_-]{1,64}$/.test(requestId)) return Promise.reject(new Error('INVALID_SPELL_REQUEST_ID'))
    if (pending.has(requestId)) return Promise.reject(new Error('SPELL_REQUEST_ALREADY_PENDING'))
    if (kind === 'cast' && issuedCasts.has(requestId)) return Promise.reject(new Error('SPELL_CAST_ALREADY_ISSUED'))
    if (kind === 'cast') issuedCasts.add(requestId)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        if (kind === 'cast') state = null
        const error = new Error(`${kind === 'cast' ? 'SPELL_CAST_OUTCOME_UNKNOWN' : 'SPELL_QUERY_TIMEOUT'} ${requestId}`)
        error.requestId = requestId
        error.outcomeUnknown = kind === 'cast'
        error.retryAutomatically = false
        reject(error)
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer, kind })
      try {
        bot._client.write('custom_payload', {
          channel,
          data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind, requestId, ...fields }), 'utf8')
        })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        if (kind === 'cast') state = null
        error.requestId = requestId
        error.outcomeUnknown = kind === 'cast'
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
  return {
    events,
    current: () => state,
    list: () => ask('maw_agent:spell_query', 'list'),
    explain,
    cast,
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      onEnd()
    }
  }
}

module.exports = { attachSpellClient }
