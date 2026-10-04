'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')

const MAX_BYTES = 16384
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REQUEST_ID = /^[A-Za-z0-9:_-]{1,64}$/

function canonical (value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

// Uses this real player's connection and the owner's actual nearby TLM entity.
// No OP endpoint, summon, ownership change, artificial work, or automatic retry.
function attachMaidClient (bot, { timeoutMs = 4000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('INVALID_MAID_TIMEOUT')
  const events = new EventEmitter()
  const pending = new Map()
  const mutations = new Map()
  let closed = false

  // minecraft-protocol sets the authenticated login UUID on _client. Current
  // Mineflayer versions do not expose bot.uuid; entity UUID is the fallback.
  function identity () { return bot._client.uuid || bot.entity?.uuid }

  function remember (requestId, value) {
    mutations.set(requestId, value)
    while (mutations.size > 128) mutations.delete(mutations.keys().next().value)
  }

  function onPayload (packet) {
    if (packet.channel !== 'maw_agent:maid_state') return
    let body
    try {
      const data = Buffer.from(packet.data)
      if (data.length > MAX_BYTES) throw new Error('MAID_RECEIPT_TOO_LARGE')
      body = JSON.parse(data.toString('utf8'))
      if (!body || body.schemaVersion !== 1 || body.kind !== 'maid_receipt' ||
          typeof body.requestId !== 'string' || typeof body.ok !== 'boolean') throw new Error('INVALID_MAID_RECEIPT')
      const owner = identity()
      if (typeof owner !== 'string' || !UUID.test(owner) || typeof body.playerUuid !== 'string' ||
          !UUID.test(body.playerUuid) || body.playerUuid.toLowerCase() !== owner.toLowerCase()) throw new Error('MAID_PLAYER_MISMATCH')
    } catch (error) { events.emit('protocolError', error); return }
    const request = pending.get(body.requestId)
    events.emit('receipt', body)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(body.requestId)
    if (request.mutation) remember(body.requestId, { fingerprint: request.fingerprint, receipt: body })
    request.resolve(body)
  }

  function onEnd () {
    closed = true
    for (const [requestId, request] of pending) {
      clearTimeout(request.timer)
      if (request.mutation) remember(requestId, { fingerprint: request.fingerprint, unknown: true })
      request.reject(new Error(`MAID_CONNECTION_CLOSED ${requestId}: outcome unknown; inspect status before any new action`))
    }
    pending.clear()
  }

  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)

  function ask (kind, fields = {}, mutation = false) {
    if (closed) throw new Error('MAID_CONNECTION_CLOSED')
    const owner = identity()
    if (typeof owner !== 'string' || !UUID.test(owner)) throw new Error('MAID_PLAYER_NOT_AUTHENTICATED')
    const requestId = fields.requestId || randomUUID()
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw new Error('INVALID_MAID_REQUEST_ID')
    const body = { schemaVersion: 1, kind, ...fields, requestId }
    const fingerprint = JSON.stringify(canonical(body))
    if (pending.has(requestId)) throw new Error('MAID_REQUEST_ALREADY_PENDING')
    if (mutation && mutations.has(requestId)) {
      const previous = mutations.get(requestId)
      if (previous.fingerprint !== fingerprint) throw new Error('MAID_REQUEST_ID_CONFLICT')
      if (previous.unknown || previous.receipt?.code === 'action_outcome_unknown' ||
          previous.receipt?.outcome === 'unknown') throw new Error('MAID_OUTCOME_UNKNOWN: inspect status; do not replay this action')
      return Promise.resolve(previous.receipt)
    }
    const data = Buffer.from(JSON.stringify(body), 'utf8')
    if (data.length > MAX_BYTES) throw new Error('MAID_REQUEST_TOO_LARGE')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        if (mutation) remember(requestId, { fingerprint, unknown: true })
        reject(new Error(`MAID_RECEIPT_TIMEOUT ${requestId}: outcome unknown; inspect status before any new action`))
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer, mutation, fingerprint })
      try {
        bot._client.write('custom_payload', {
          channel: mutation ? 'maw_agent:maid_action' : 'maw_agent:maid_query', data
        })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        if (mutation) remember(requestId, { fingerprint, unknown: true })
        reject(error)
      }
    })
  }

  function maidUuid (uuid) {
    if (typeof uuid !== 'string' || !UUID.test(uuid)) throw new Error('INVALID_MAID_UUID')
    return uuid.toLowerCase()
  }

  return {
    events,
    list: () => ask('list'),
    status: uuid => ask('status', { maidUuid: maidUuid(uuid) }),
    tasks: uuid => ask('tasks', { maidUuid: maidUuid(uuid) }),
    setTask: ({ maidUuid: uuid, taskId, requestId }) => {
      if (typeof taskId !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(taskId)) throw new Error('INVALID_MAID_TASK_ID')
      return ask('task_set', { maidUuid: maidUuid(uuid), taskId, requestId }, true)
    },
    setFollow: ({ maidUuid: uuid, follow, requestId }) => {
      if (typeof follow !== 'boolean') throw new Error('INVALID_MAID_FOLLOW')
      return ask('follow_set', { maidUuid: maidUuid(uuid), follow, requestId }, true)
    },
    setPickup: ({ maidUuid: uuid, pickup, requestId }) => {
      if (typeof pickup !== 'boolean') throw new Error('INVALID_MAID_PICKUP')
      return ask('pickup_set', { maidUuid: maidUuid(uuid), pickup, requestId }, true)
    },
    // The actual TLM menu is then operated using attachMenuClient's native slots.
    openBag: ({ maidUuid: uuid, requestId }) => ask('open_bag', { maidUuid: maidUuid(uuid), requestId }, true),
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      onEnd()
    }
  }
}

module.exports = { attachMaidClient }
