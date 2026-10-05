'use strict'
const { randomUUID } = require('node:crypto')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
// Read-only queries on the same existing connection. No target player UUID,
// scans, mutation replay, or operator transport is supported here.
function attachNativeWorldQuery (bot, { timeoutMs = 4000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('NATIVE_QUERY_TIMEOUT_INVALID')
  const pending = new Map(); let closed = false
  const unavailable = (requestId, code) => ({ schemaVersion: 1, kind: 'world_receipt', playerUuid: bot._client.uuid,
    requestId, ok: false, code, readOnly: true, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false })
  const payload = packet => {
    if (packet.channel !== 'maw_agent:world_state') return
    let body
    try {
      const bytes = Buffer.from(packet.data)
      if (bytes.length > 65536) return
      body = JSON.parse(bytes.toString('utf8'))
    } catch { return }
    const request = pending.get(body?.requestId)
    if (!request || body.schemaVersion !== 1 || body.kind !== 'world_receipt' || typeof body.ok !== 'boolean' ||
        typeof body.playerUuid !== 'string' || body.playerUuid.toLowerCase() !== request.uuid ||
        bot._client.uuid?.toLowerCase() !== request.uuid || (body.ok && body.query !== request.kind)) return
    clearTimeout(request.timer); pending.delete(body.requestId)
    request.resolve({ ...body, readOnly: true, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false })
  }
  const end = () => {
    closed = true
    for (const [requestId, request] of pending) { clearTimeout(request.timer); request.resolve(unavailable(requestId, 'native_query_connection_closed')) }
    pending.clear()
  }
  const contextChanged = () => {
    for (const [requestId, request] of pending) { clearTimeout(request.timer); request.resolve(unavailable(requestId, 'native_query_context_changed')) }
    pending.clear()
  }
  bot._client.on('custom_payload', payload); bot.on('end', end)
  bot.on('spawn', contextChanged); bot.on('respawn', contextChanged)
  function ask (kind, fields) {
    if (closed || !UUID.test(bot._client.uuid || '')) return Promise.resolve(unavailable(null, 'native_query_connection_unavailable'))
    const uuid = bot._client.uuid.toLowerCase(), requestId = randomUUID()
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(requestId); resolve(unavailable(requestId, 'native_query_not_observed')) }, timeoutMs)
      pending.set(requestId, { uuid, kind, timer, resolve })
      try { bot._client.write('custom_payload', { channel: 'maw_agent:world_query', data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind, requestId, ...fields }), 'utf8') }) }
      catch { clearTimeout(timer); pending.delete(requestId); resolve(unavailable(requestId, 'native_query_not_sent')) }
    })
  }
  return {
    entity ({ entityId, expectedUuid }) {
      if (!Number.isSafeInteger(entityId) || entityId < 0 || !UUID.test(expectedUuid || '')) throw Error('NATIVE_ENTITY_QUERY_INVALID')
      return ask('entity', { entityId, expectedUuid: expectedUuid.toLowerCase() })
    },
    recipes (args = {}) {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['recipeId', 'recipeType', 'outputId', 'offset', 'limit'].includes(key)) ||
          ['recipeId', 'recipeType', 'outputId'].some(key => args[key] !== undefined && !ID.test(args[key])) ||
          !Number.isInteger(args.offset ?? 0) || (args.offset ?? 0) < 0 || (args.offset ?? 0) > 10000 ||
          !Number.isInteger(args.limit ?? 6) || (args.limit ?? 6) < 1 || (args.limit ?? 6) > 12) throw Error('NATIVE_RECIPE_QUERY_INVALID')
      return ask('recipes', { ...args, offset: args.offset ?? 0, limit: args.limit ?? 6 })
    },
    detach () { bot._client.off('custom_payload', payload); bot.off('end', end); bot.off('spawn', contextChanged); bot.off('respawn', contextChanged); end() }
  }
}
module.exports = { attachNativeWorldQuery }
