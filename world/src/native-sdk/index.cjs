'use strict'
// Framework-neutral body controller. No model calls, server admin transport,
// sockets, credentials or autonomous loop are created by this SDK.
const crypto = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const { attachModAgentClient } = require('../neoforge-handshake/mod-agent-client.cjs')
const { NativeLedger } = require('../neko-adapter/native-runtime.cjs')
const { operationCatalog, validateArguments } = require('./catalog.cjs')
const { runActionWithDeadline, outboundGameMutation } = require('../society-agent/action-deadline.cjs')
const { nativeInventorySnapshot, nativeInventoryDelta } = require('../society-agent/native-inventory-delta.cjs')
const { nativeNavigationResult } = require('../society-agent/native-navigation-result.cjs')
const OWNER = Symbol.for('maw.nativeBody.owner')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID = /^[A-Za-z0-9_.:-]{1,96}$/
const copy = value => value === undefined ? null : structuredClone(value)
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const hash = (id, args) => crypto.createHash('sha256').update(JSON.stringify([id, canonical(args)])).digest('hex')
const fail = (code, extra = {}) => ({ ok: false, code, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false, ...extra })
const isUnknown = result => result?.outcomeKnown === false || result?.outcomeUnknown === true || result?.outcome === 'unknown'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function attachNativeBody (bot, { ledgerDir, controllerId, expectedUuid, account = bot.username || bot._client?.username, attach = attachModAgentClient } = {}) {
  if (!ID.test(controllerId || '') || (expectedUuid !== undefined && !UUID.test(expectedUuid))) throw Error('SDK_BINDING_CONFIG_INVALID')
  if (bot[OWNER] || bot.mawNative) throw Error('SDK_BODY_ALREADY_CONTROLLED')
  const ledger = new NativeLedger(ledgerDir, account)
  // This aggregate owns a fixed set of lifecycle adapters. Reserve a finite
  // listener budget before attaching and restore it after complete cleanup.
  const originalLimit = bot.getMaxListeners(), ownedLimit = originalLimit === 0 ? 0 : originalLimit + 16
  if (ownedLimit) bot.setMaxListeners(ownedLimit)
  let sdk
  try { sdk = attach(bot) } catch (error) { ledger.close(); bot.setMaxListeners(originalLimit); throw error }
  const scopes = new AsyncLocalStorage(), token = {}, originalWrite = bot._client.write
  let ended = false, closing = false, epoch = 0, active = null, lastUuid = null, remote = null, queryChain = Promise.resolve(), lastQuery = 0
  bot[OWNER] = token
  const uuid = () => UUID.test(bot._client.uuid || '') ? bot._client.uuid.toLowerCase() : lastUuid
  const identity = () => ({ schemaVersion: 1, bodyId: uuid(), playerUuid: uuid(), account,
    bodyKind: 'connected_player', controllerId, connected: !ended && !closing && !!uuid() && !!bot.entity, epoch,
    capturedAt: new Date().toISOString(), numenRestoreExisting: false })
  const bindingValid = () => !!uuid() && (!bot.username || bot.username === account) && (!expectedUuid || uuid() === expectedUuid.toLowerCase()) &&
    (!ledger.playerUuid || ledger.playerUuid === uuid())
  const blocked = () => ledger.broken || ledger.unresolvedById.size > (active && ledger.unresolvedById.has(active.id) ? 1 : 0) || sdk.callStatus().mutationBlocked
  const check = () => {
    if (ended || closing || !bindingValid() || !bot.entity || bot.health <= 0 || (active && active.epoch !== epoch)) throw Error('SDK_BODY_CONTEXT_CHANGED')
  }
  const stop = () => {
    let ok = true
    for (const fn of [() => bot.pathfinder?.setGoal(null), () => bot.clearControlStates?.(), () => bot.stopDigging?.(), () => bot.deactivateItem?.()]) {
      try { fn() } catch { ok = false }
    }
    return ok
  }
  const gameMutation = (name, data) => outboundGameMutation(name, data) ||
    (name === 'custom_payload' && /^maw_agent:.*_action$/.test(data?.channel || ''))
  function guardedWrite (name, data) {
    if (gameMutation(name, data)) {
      const frame = scopes.getStore()
      if (!active || frame !== active || frame.closed || blocked() || ended || closing || frame.epoch !== epoch) return false
      frame.scope?.mutationDispatched()
    }
    return originalWrite.call(this, name, data)
  }
  bot._client.write = guardedWrite
  const contextChanged = () => { epoch++; lastUuid = uuid(); remote = null; active?.scope?.abort('context'); stop() }
  const died = () => { epoch++; active?.scope?.abort('context'); stop() }
  const onEnd = () => { ended = true; close() }
  bot.on('spawn', contextChanged); bot.on('respawn', contextChanged); bot.on('death', died); bot.on('end', onEnd)

  // World reads share the server's two-tick rate limit. Only explicit read-only
  // rate-limit rejections are retried; actions are never retried here.
  function query (invoke) {
    const pending = queryChain.then(async () => {
      for (let i = 0; i < 4; i++) {
        if (ended || !bindingValid()) return fail(ended ? 'body_offline' : 'body_identity_mismatch')
        const observedEpoch = epoch, observedUuid = uuid()
        await delay(Math.max(0, 150 - (Date.now() - lastQuery))); lastQuery = Date.now()
        const result = await invoke()
        if (observedEpoch !== epoch || observedUuid !== uuid() || ended) return fail('observation_context_changed')
        if (result?.code !== 'rate_limited') return result
      }
      return fail('observation_rate_limited')
    })
    queryChain = pending.catch(() => {})
    return pending
  }
  async function snapshot () {
    const base = identity()
    if (ended) return { ...base, ok: false, status: 'offline', code: 'body_offline', currentAction: null }
    if (!bindingValid()) return { ...base, ok: false, status: 'unavailable', code: 'body_identity_mismatch' }
    try {
      const state = await query(() => sdk.native.bodySnapshot())
      if (!state?.ok || state.bodyId !== uuid() || state.menu?.playerUuid !== uuid()) return { ...base,
        ok: false, status: ended ? 'offline' : 'unavailable', code: state?.code || 'body_snapshot_invalid' }
      return { ...base, ...copy(state), currentAction: active ? { action_id: active.id, operation: active.operation, phase: active.phase } : null,
        inventory: nativeInventorySnapshot(state.menu, uuid()), equipment: copy(state.self?.equipment),
        health: state.self?.health ?? null, hunger: state.self?.food ?? null }
    } catch (error) { return { ...base, ok: false, status: 'unavailable', code: error.code || error.message } }
  }
  async function capabilities () {
    const value = await query(() => sdk.native.capabilities())
    if (value?.ok && value.bodyId === uuid() && value.bodyKind === 'connected_player') remote = copy(value)
    return { ...identity(), ...copy(value), operations: operationCatalog(undefined, remote) }
  }
  function status (action_id) {
    if (!ID.test(action_id || '')) return fail('action_id_invalid', identity())
    if (ledger.playerUuid && uuid() !== ledger.playerUuid) return fail('body_identity_mismatch', identity())
    const record = ledger.records.get(action_id)
    if (!record) return { ...identity(), ...fail('action_not_found'), action_id, status: 'unknown', terminal: true,
      outcomeKnown: false, outcomeUnknown: true, result: null }
    if (active?.id === action_id) return { ...identity(), ok: true, action_id, operation: record.id, status: 'running',
      terminal: false, phase: active.phase, startedAt: record.at, result: null }
    const result = record.result
    return { ...identity(), ok: result?.ok === true, action_id, operation: record.id, terminal: true,
      status: record.kind === 'intent' || isUnknown(result) ? 'unknown' : result?.cancelled ? 'cancelled' : result?.ok ? 'succeeded' : 'failed',
      outcomeKnown: record.kind === 'result' && !isUnknown(result), outcomeUnknown: record.kind === 'intent' || isUnknown(result),
      result: copy(result), fingerprint: record.fingerprint }
  }
  async function read (operation, args = {}) {
    validateArguments(operation, args)
    const row = operationCatalog(operation, remote)
    if (!row?.readOnly) return fail('read_requires_read_only_operation')
    if (operation === 'body.identity') return { ok: !ended && !closing && bindingValid(), ...identity() }
    if (operation === 'action.status') return status(args.action_id)
    if (operation === 'body.snapshot') return snapshot()
    if (ended || !bindingValid()) return fail(ended ? 'body_offline' : 'body_identity_mismatch', identity())
    if (operation === 'sdk.capabilities') return capabilities()
    if (operation === 'body.observe') return query(() => sdk.native.bodyObserve(args))
    const result = await sdk.call(operation, args)
    return { ...identity(), ...copy(result) }
  }
  async function execute (operation, args, frame, scope) {
    scope.check(); frame.phase = 'executing'
    if (operation === 'body.move') {
      const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
      const { Vec3 } = require('vec3')
      const p = args.position, target = new Vec3(p.x, p.y, p.z)
      if (bot.entity.position.distanceTo(target.offset(.5, 0, .5)) > 16 || !bot.blockAt(target) || !bot.blockAt(target.offset(0, -1, 0))) return fail('movement_target_outside_loaded_local_range')
      if (!bot.pathfinder) bot.loadPlugin(pathfinder)
      const movements = new Movements(bot)
      movements.canDig = false; movements.allow1by1towers = false; movements.allowParkour = false
      movements.allowFreeMotion = false; movements.canOpenDoors = false; movements.maxDropDown = 2
      bot.pathfinder.setMovements(movements)
      frame.phase = 'walking'; scope.mutationDispatched()
      try { await bot.pathfinder.goto(new goals.GoalBlock(p.x, p.y, p.z)); scope.check() } finally { bot.clearControlStates() }
      const after = await snapshot(); scope.check()
      if (!after.ok) return fail('movement_position_unavailable', { outcomeKnown: false, outcomeUnknown: true })
      return nativeNavigationResult({ requestedPosition: p, position: after.position, exact: true })
    }
    if (operation === 'inventory.equipSlot') {
      const menu = sdk.menu.current(), dest = { head: 5, chest: 6, legs: 7, feet: 8, offhand: 45 }[args.destination]
      if (menu?.windowId !== 0 || menu.carried || menu.slots[dest] || menu.slots[args.sourceSlot]?.snbt !== args.expectedSnbt ||
          (args.destination !== 'offhand' && menu.slots[args.sourceSlot]?.count !== 1)) return fail('equipment_menu_or_stack_changed')
      const original = copy(menu.slots[args.sourceSlot])
      const grabbed = await sdk.menu.click(args.sourceSlot); scope.check()
      if (!grabbed.ok) return grabbed
      const placed = await sdk.menu.click(dest); scope.check()
      if (!placed.ok) return placed
      const after = sdk.menu.current()
      const ok = after?.slots[dest]?.snbt === original.snbt && !after?.slots[args.sourceSlot] && !after.carried
      return { ok, code: ok ? 'equipment_slot_verified' : 'equipment_slot_not_verified', outcomeKnown: true, outcomeUnknown: false,
        effectVerified: ok, sourceSlot: args.sourceSlot, destination: args.destination, equipped: copy(after?.slots[dest]) }
    }
    if (operation === 'inventory.use') {
      const menu = sdk.menu.current()
      if (menu?.windowId !== 0 || menu.carried || menu.selectedHotbarSlot !== args.hotbarSlot ||
          menu.slots[36 + args.hotbarSlot]?.snbt !== args.expectedSnbt) return fail('held_item_changed')
      bot.activateItem(); await scope.wait(300); bot.deactivateItem(); scope.check()
      return { ok: true, code: 'item_use_dispatched_inspect_effect', effectVerified: false, outcomeKnown: true, outcomeUnknown: false }
    }
    return sdk.call(operation, args)
  }
  async function perform (frame, args) {
    let result, before = null, after = null
    try {
      before = await snapshot()
      if (!before.ok || before.status !== 'alive') result = fail(before.status === 'dead' ? 'body_dead' : 'body_state_unavailable')
      else result = await scopes.run(frame, () => runActionWithDeadline(scope => execute(frame.operation, args, frame, scope), {
        timeoutMs: frame.operation === 'body.move' ? args.timeoutMs ?? 20000 : 45000,
        checkContext: check, signal: frame.abort.signal, onScope: scope => { frame.scope = scope },
        onAbort: () => { frame.closed = true; stop() }
      }))
    } catch (error) {
      result = error.result || fail(error.code || error.message, { outcomeKnown: !frame.scope?.mutationObserved(), outcomeUnknown: !!frame.scope?.mutationObserved() })
      if (!frame.scope?.mutationObserved()) result = { ...result, outcomeKnown: true, outcomeUnknown: false }
      if (frame.cancelRequested) result = { ...result, cancelled: true }
    }
    frame.closed = true; frame.phase = 'verifying'
    try { after = await snapshot() } catch {}
    if (!result || typeof result.ok !== 'boolean') result = fail('action_result_invalid', { outcomeKnown: false, outcomeUnknown: true })
    result = { ...copy(result), bodyId: frame.uuid, action_id: frame.id, operation: frame.operation,
      completedAt: new Date().toISOString(), actualPosition: after?.ok ? after.position : null,
      dimension: after?.ok ? after.dimension : null,
      inventoryDelta: nativeInventoryDelta(before?.inventory, after?.inventory), retryAutomatically: false }
    if (ended || epoch !== frame.epoch || uuid() !== frame.uuid) result = { ...result, ok: false,
      code: 'action_context_changed', outcomeKnown: false, outcomeUnknown: true }
    try { ledger.append({ ...frame.record, kind: 'result', result }) }
    catch { result = fail('action_ledger_io_failure', { outcomeKnown: false, outcomeUnknown: true }) }
    active = null; frame.resolve(copy(result))
    if (closing) cleanup()
  }
  function submit ({ action_id, operation, args = {} } = {}) {
    try { validateArguments(operation, args) } catch (error) { return fail(error.code || error.message, { field: error.field ?? null, missingFields: error.missingFields ?? [] }) }
    const row = operationCatalog(operation, remote)
    if (row.readOnly || row.executor === 'control') return fail('submit_requires_mutation_operation')
    if (!ID.test(action_id || '')) return fail('action_id_required')
    const immutable = copy(args), fingerprint = hash(operation, immutable), previous = ledger.records.get(action_id)
    if (previous) {
      if (previous.fingerprint !== fingerprint) return fail('action_id_conflict', { action_id })
      return { ...status(action_id), replayed: true, dispatched: false }
    }
    if (active || blocked()) return fail('body_action_blocked', { action_id, unresolved: ledger.unresolved() })
    try { check() } catch { return fail(ended ? 'body_offline' : bot.health <= 0 ? 'body_dead' : 'body_not_ready') }
    if (bot.targetDigBlock || bot.pathfinder?.isMoving?.() || bot.pvp?.target || bot.usingHeldItem || Object.values(bot.controlStates || {}).some(Boolean)) return fail('body_busy_outside_sdk')
    const frame = { id: action_id, operation, uuid: uuid(), epoch, phase: 'accepted', closed: false, abort: new AbortController(), cancelRequested: false }
    frame.record = { callId: action_id, id: operation, args: immutable, fingerprint, playerUuid: frame.uuid, epoch }
    frame.done = new Promise(resolve => { frame.resolve = resolve }); active = frame
    try { ledger.append({ ...frame.record, kind: 'intent' }) } catch { active = null; return fail('action_ledger_io_failure') }
    setImmediate(() => perform(frame, immutable).catch(() => { frame.closed = true; active = null; frame.resolve(fail('action_worker_failed', { outcomeKnown: false, outcomeUnknown: true })); if (closing) cleanup() }))
    return { ...identity(), ok: true, accepted: true, action_id, operation, status: 'accepted', terminal: false, dispatched: false }
  }
  function cancel (action_id) {
    if (active?.id !== action_id) return { ...status(action_id), cancelRequested: false }
    active.cancelRequested = true; active.closed = true; active.abort.abort(); active.scope?.abort('maintenance'); stop()
    return { ...identity(), ok: true, action_id, cancelRequested: true, terminal: false, rollback: false }
  }
  async function wait (action_id, { timeoutMs = 50000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw Error('SDK_WAIT_TIMEOUT_INVALID')
    if (active?.id !== action_id) return status(action_id)
    const frame = active
    let timer
    try { await Promise.race([frame.done, new Promise(resolve => { timer = setTimeout(resolve, timeoutMs) })]) } finally { clearTimeout(timer) }
    return status(action_id) // A wait timeout does not cancel or resubmit the action.
  }
  function cleanup () {
    ledger.close(); sdk.detach()
    if (bot.getMaxListeners() === ownedLimit) bot.setMaxListeners(originalLimit)
    // Keep this retired connection fenced. A cancelled native promise may
    // still resume after detach; restoring write would let it mutate again.
    // Reconnection always uses a fresh bot, never this retired connection.
    bot.off('spawn', contextChanged); bot.off('respawn', contextChanged); bot.off('death', died); bot.off('end', onEnd)
  }
  function close () {
    if (closing) return
    closing = true
    if (active) { active.closed = true; active.abort.abort(); active.scope?.abort('shutdown'); stop() } else cleanup()
  }
  return { identity, capabilities, snapshot, read, submit, actionStatus: status, cancel, wait,
    stop () { if (active) return cancel(active.id); return { ...identity(), ok: stop(), code: 'body_stopped' } },
    operations: id => copy(operationCatalog(id, remote)),
    health: () => ({ ...identity(), ok: !ledger.broken && bindingValid(), inFlight: active?.id ?? null,
      mutationBlocked: blocked(), unresolved: ledger.unresolved(), ledgerScope: 'local_account_directory', modelRequests: 0 }),
    close }
}
module.exports = { attachNativeBody }
