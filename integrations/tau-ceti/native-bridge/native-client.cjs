'use strict'
const { randomUUID, createHash } = require('node:crypto')
const contract = require('./operations.json')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REQUEST_ID = /^[A-Za-z0-9:_-]{1,64}$/
const NATIVE_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const operations = new Map(contract.operations.map(row => [row.id, row]))
const clone = value => structuredClone(value)
const canonical = value => JSON.stringify(value, function (key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]]))
  return item
})

function parameterProblem (value, schema, path = 'args') {
  if (value === null || value === undefined) return { field: path, expected: schema.type, issue: 'missing or null' }
  if (schema.type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) return { field: path, expected: 'object', issue: 'not an object' }
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) return { field: `${path}.${key}`, expected: 'required field', issue: 'missing' }
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) return { field: `${path}.${key}`, expected: 'declared field', issue: 'unexpected field' }
      const issue = parameterProblem(item, schema.properties[key], `${path}.${key}`); if (issue) return issue
    }
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) return { field: path, expected: 'integer', issue: 'not a finite safe integer' }
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) return { field: path, expected: 'integer in declared range', issue: 'out of range' }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') return { field: path, expected: 'string', issue: 'not a string' }
    if (value.length > (schema.maxLength ?? Infinity)) return { field: path, expected: 'bounded string', issue: 'too long' }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return { field: path, expected: schema.pattern, issue: 'pattern mismatch' }
  } else return { field: path, expected: 'supported schema', issue: 'unsupported schema type' }
  return null
}

/** Attach to one already authenticated Mineflayer connection; never creates a body. */
function attachTauNativeClient (bot, { timeoutMs = 5000, readIntervalMs = 110 } = {}) {
  if (!bot?._client?.write || !bot._client.on || !bot.on) throw Error('NATIVE_CONNECTION_REQUIRED')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('INVALID_NATIVE_TIMEOUT')
  if (!Number.isInteger(readIntervalMs) || readIntervalMs < 0 || readIntervalMs > 5000) throw Error('INVALID_NATIVE_READ_INTERVAL')
  const pending = new Map(), writes = new Map(), diagnostics = [], subscribers = new Set()
  let closed = false, generation = 0, lastSent = 0, reading = Promise.resolve(), menu = null, capabilities = null, unknown = null
  const identity = () => UUID.test(bot._client.uuid || '') ? bot._client.uuid.toLowerCase() : null
  const unavailable = (requestId, code, readOnly, more = {}) => ({ schemaVersion: 1, playerUuid: identity(), requestId,
    status: readOnly ? 'unavailable' : 'unknown', ok: false, code, readOnly, outcomeKnown: readOnly,
    outcomeUnknown: !readOnly, retryAutomatically: false, retryable: false,
    ...(!readOnly ? { changed: null, nextSafeRead: { operation: 'control.actionStatus', args: { actionRequestId: requestId } } } : {}), ...more })
  const issue = code => { if (diagnostics.length === 16) diagnostics.shift(); diagnostics.push({ code, observedAt: new Date().toISOString() }) }
  const validMenu = value => value?.schemaVersion === 1 && value.kind === 'menu_state' && value.playerUuid?.toLowerCase() === identity() &&
    Number.isInteger(value.windowId) && Number.isInteger(value.stateId) && Array.isArray(value.slots) && value.slots.length <= 256 &&
    value.slots.every(item => item === null || (NATIVE_ID.test(item?.id || '') && Number.isInteger(item.count) && item.count > 0))
  function observedMenu (value) {
    if (!validMenu(value)) { issue('invalid_native_menu'); return false }
    menu = { ...value, receivedAt: new Date().toISOString() }
    for (const callback of subscribers) { try { callback(clone(menu)) } catch { issue('native_subscriber_failed') } }
    return true
  }
  function finish (requestId, value) {
    const request = pending.get(requestId); if (!request) return
    clearTimeout(request.timer); pending.delete(requestId)
    if (!request.readOnly) {
      const write = writes.get(requestId); if (write) write.result = clone(value)
      if (value.outcomeUnknown || value.outcomeKnown === false) unknown = { requestId, serverEpoch: value.serverEpoch ?? request.serverEpoch }
    }
    request.resolve(value)
  }
  function payload (packet) {
    if (closed || !['maw_agent:world_state', 'maw_agent:menu_state'].includes(packet.channel)) return
    let value
    try {
      const bytes = Buffer.from(packet.data); if (bytes.length > contract.limits.stateBytes) throw Error('budget')
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch { issue('invalid_native_payload'); return }
    if (value?.schemaVersion !== 1 || value.playerUuid?.toLowerCase() !== identity()) { issue('native_identity_or_schema_mismatch'); return }
    if (packet.channel === 'maw_agent:menu_state' && value.kind === 'menu_state_error') { menu = null; issue(value.code || 'native_menu_unavailable'); return }
    if (packet.channel === 'maw_agent:menu_state' && value.kind === 'menu_state') { observedMenu(value); return }
    const request = pending.get(value.requestId)
    if (!request || request.uuid !== identity() || request.generation !== generation || typeof value.ok !== 'boolean') return
    if (request.readOnly) {
      if (packet.channel !== 'maw_agent:world_state' || value.kind !== 'world_receipt' || (value.ok && value.query !== request.query)) { issue('native_read_receipt_mismatch'); return }
      if (value.menu) observedMenu(value.menu)
      if (value.ok && value.query === 'capabilities') capabilities = clone(value)
      finish(value.requestId, { ...value, readOnly: true, retryAutomatically: false })
    } else {
      if (packet.channel !== 'maw_agent:menu_state' || value.kind !== 'action_receipt' || value.action !== request.action ||
          ![true, false, null].includes(value.changed) || typeof value.outcomeKnown !== 'boolean') { issue('native_action_receipt_mismatch'); return }
      if (value.state && !validMenu(value.state)) { issue('native_action_state_mismatch'); return }
      if (value.state && value.outcomeKnown) observedMenu(value.state)
      else if (!value.outcomeKnown || value.stateUnavailable) menu = null
      finish(value.requestId, value)
    }
  }
  function reset (code) {
    generation++; menu = null; capabilities = null
    for (const [id, request] of [...pending]) finish(id, unavailable(id, code, request.readOnly, { serverEpoch: request.serverEpoch }))
  }
  const changed = () => reset('native_body_context_changed')
  function ended () { closed = true; reset('native_connection_closed') }
  const budgets = [[bot, 4], [bot._client, 1]].map(([emitter, extra]) => {
    const original = emitter.getMaxListeners?.(); const ours = original === 0 ? 0 : (original ?? 10) + extra
    emitter.setMaxListeners?.(ours); return { emitter, original, ours }
  })
  bot._client.on('custom_payload', payload)
  for (const event of ['spawn', 'respawn', 'death']) bot.on(event, changed)
  bot.on('end', ended)

  function send (query, args, requestId, readOnly) {
    if (closed || !identity()) return Promise.resolve(unavailable(requestId, 'native_connection_unavailable', readOnly))
    const wire = readOnly ? { schemaVersion: 1, kind: query, requestId, ...args } : { schemaVersion: 1, requestId, playerUuid: identity(), ...(query === 'close' ? { action: 'close' } : {}), ...args }
    const data = Buffer.from(JSON.stringify(wire), 'utf8')
    if (data.length > (readOnly ? contract.limits.queryBytes : contract.limits.actionBytes)) return Promise.resolve({ ...unavailable(requestId, 'native_request_budget', true), readOnly, status: 'error', outcomeKnown: true, outcomeUnknown: false })
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (!readOnly) menu = null
        finish(requestId, unavailable(requestId, 'native_receipt_not_observed', readOnly))
      }, timeoutMs)
      pending.set(requestId, { timer, resolve, uuid: identity(), generation, readOnly, query, action: readOnly ? null : query, serverEpoch: capabilities?.serverEpoch ?? menu?.serverEpoch })
      try { bot._client.write('custom_payload', { channel: readOnly ? 'maw_agent:world_query' : 'maw_agent:menu_action', data }) }
      catch { finish(requestId, unavailable(requestId, 'native_write_failed_outcome_unconfirmed', readOnly)) }
    })
  }
  function invalid (op, problem) {
    return { ok: false, status: 'error', code: 'invalid_parameters', readOnly: op?.readOnly ?? true, outcomeKnown: true,
      outcomeUnknown: false, retryAutomatically: false, diagnostic: problem, example: clone(op?.example ?? {}) }
  }
  async function read (operation, args = {}) {
    const op = operations.get(operation)
    if (!op?.readOnly) return invalid(op, { field: 'operation', expected: 'declared read-only operation', issue: 'unsupported operation' })
    const problem = parameterProblem(args, op.parameters); if (problem) return invalid(op, problem)
    const epoch = generation
    const work = reading.catch(() => {}).then(async () => {
      const wait = Math.max(0, lastSent + readIntervalMs - Date.now()); if (wait) await new Promise(resolve => setTimeout(resolve, wait))
      if (epoch !== generation || closed) return unavailable(null, 'native_body_context_changed', true)
      lastSent = Date.now(); return send(op.query, args, randomUUID(), true)
    })
    reading = work; return work
  }
  async function call (operation, args, { requestId = randomUUID() } = {}) {
    const op = operations.get(operation)
    if (op?.readOnly) return read(operation, args)
    if (!op || !['menu.click','menu.close'].includes(operation)) return invalid(op, { field: 'operation', expected: 'supported native operation', issue: 'unsupported operation' })
    const problem = parameterProblem(args, op.parameters); if (problem) return invalid(op, problem)
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return invalid(op, { field: 'requestId', expected: REQUEST_ID.source, issue: 'invalid request identity' })
    const intent = createHash('sha256').update(canonical(args)).digest('hex')
    const previous = writes.get(requestId)
    if (previous) return previous.intent === intent ? clone(previous.result ?? await previous.promise) : invalid(op, { field: 'requestId', expected: 'original action arguments', issue: 'request_id_conflict' })
    if (unknown) return { ...unavailable(unknown.requestId, 'unreconciled_previous_action', false), originServerEpoch: unknown.serverEpoch }
    if ([...pending.values()].some(row => !row.readOnly)) return { ...unavailable(requestId, 'native_action_in_flight', true), readOnly: false, status: 'blocked' }
    if (closed || !identity()) return { ...unavailable(requestId, 'native_connection_unavailable', true), readOnly: false, status: 'blocked' }
    const row = { intent, result: null, promise: null }; writes.set(requestId, row)
    row.promise = send(op.action || 'click', args, requestId, false)
    const result = await row.promise; row.result = clone(result)
    // Retain every unknown ID. Bound only known terminal receipts.
    for (const [id, old] of writes) if (writes.size > contract.limits.receiptsPerPlayer && old.result?.outcomeKnown && id !== requestId) writes.delete(id)
    return result
  }
  async function click ({ slot, button = 0, requestId = randomUUID() } = {}) {
    const prior = writes.get(requestId), clickIntent = JSON.stringify({ slot, button })
    if (prior) return prior.clickIntent === clickIntent ? clone(prior.result ?? await prior.promise) : invalid(operations.get('menu.click'), { field: 'requestId', expected: 'original click intent', issue: 'request_id_conflict' })
    if (unknown) return { ...unavailable(unknown.requestId, 'unreconciled_previous_action', false), originServerEpoch: unknown.serverEpoch }
    if (!menu || Date.now() - Date.parse(menu.receivedAt) > 2000) {
      const state = await read('body.snapshot'); if (!state.ok) return state
    }
    if (!menu || !Number.isInteger(slot) || slot < 0 || slot >= menu.slots.length) return invalid(operations.get('menu.click'), { field: 'args.slot', expected: 'slot in actual current menu', issue: 'unknown or invalid slot' })
    const item = menu.slots[slot], cursor = menu.carried
    if (item?.componentsComplete === false || cursor?.componentsComplete === false) return { ok: false, status: 'blocked', code: 'native_components_incomplete', outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false }
    const result = call('menu.click', { windowId: menu.windowId, expectedStateId: menu.stateId, slot, button,
      expectedItemId: item?.id ?? 'minecraft:air', expectedCount: item?.count ?? 0, expectedSnbt: item?.snbt ?? '',
      expectedCarriedSnbt: cursor?.snbt ?? '', expectedServerEpoch: menu.serverEpoch }, { requestId })
    const row = writes.get(requestId); if (row) row.clickIntent = clickIntent
    return result
  }
  async function actionStatus (requestId, originServerEpoch) {
    const result = await read('control.actionStatus', { actionRequestId: requestId, ...(originServerEpoch ? { originServerEpoch } : {}) })
    if (result.ok && result.receipt?.outcomeKnown) {
      const row = writes.get(requestId); if (row) row.result = clone(result.receipt)
      if (unknown?.requestId === requestId) unknown = null
      // A ledger receipt describes the original action time, not the currently open window.
      // Preserve it as evidence; never refresh the live menu cache with historical slots.
      menu = null
    }
    return result
  }
  function detach () {
    if (!closed) ended()
    bot._client.off('custom_payload', payload)
    for (const event of ['spawn', 'respawn', 'death']) bot.off(event, changed)
    bot.off('end', ended); subscribers.clear()
    for (const { emitter, original, ours } of budgets) if (emitter.getMaxListeners?.() === ours) emitter.setMaxListeners?.(original)
  }
  return { read, call, click, actionStatus, detach,
    snapshot: () => read('body.snapshot'), inspect: slot => read('inventory.inspect', { slot }), recipes: filters => read('native.recipes', filters),
    async operations ({ refresh = false } = {}) { return !refresh && capabilities ? clone(capabilities) : read('native.capabilities') },
    currentMenu: () => menu ? clone(menu) : null,
    diagnostics: () => clone(diagnostics),
    onMenu (callback) { subscribers.add(callback); return () => subscribers.delete(callback) },
    state: () => ({ closed, generation, playerUuid: identity(), pending: pending.size, unreconciledAction: unknown ? clone(unknown) : null,
      remoteCapabilitiesObserved: !!capabilities, serverEpoch: capabilities?.serverEpoch ?? menu?.serverEpoch ?? null }) }
}
module.exports = { attachTauNativeClient, parameterProblem, contract }
