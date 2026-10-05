'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { runActionWithDeadline, ActionInterruptionError, installActionPacketFence, outboundGameMutation } = require('./action-deadline.cjs')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('completed action retains the real result and cleans timers', async () => {
  let aborts = 0
  const result = await runActionWithDeadline(async scope => { scope.phase('verify'); await scope.wait(2); return { ok: true, verified: true } },
    { timeoutMs: 100, onAbort: () => aborts++ })
  assert.deepEqual(result, { ok: true, verified: true }); await delay(110); assert.equal(aborts, 0)
})
test('deadline is unknown, aborts once, and discards a late successful result', async () => {
  let scope, aborts = 0, resolves
  const never = new Promise(resolve => { resolves = resolve })
  await assert.rejects(runActionWithDeadline(async value => { scope = value; value.phase('dig'); return never },
    { timeoutMs: 8, onAbort: () => aborts++ }), error => {
    assert.ok(error instanceof ActionInterruptionError)
    assert.deepEqual(error.result, { ok: false, code: 'ACTION_DEADLINE_TIMEOUT', outcome: 'unknown', outcomeUnknown: true,
      outcomeKnown: false, effectVerified: false, retryAutomatically: false, interruptionReason: 'deadline', phase: 'dig', cleanupOk: true })
    return true
  })
  resolves({ ok: true }); await delay(1); assert.equal(aborts, 1)
  assert.throws(() => scope.check(), /ACTION_DEADLINE_TIMEOUT/)
})
test('maintenance abort breaks pending waits and guards late continuation', async () => {
  const controller = new AbortController(); let mutations = 0
  const result = runActionWithDeadline(async scope => { await scope.wait(1000); scope.check(); mutations++ },
    { timeoutMs: 2000, signal: controller.signal })
  setTimeout(() => controller.abort(), 5)
  await assert.rejects(result, error => error.result.code === 'ACTION_MAINTENANCE_ABORTED' && error.result.outcomeUnknown)
  assert.equal(mutations, 0)
})
test('context poll aborts an unresolved native promise instead of waiting for next await', async () => {
  let valid = true, cleanup = 0
  const result = runActionWithDeadline(() => new Promise(() => {}), { timeoutMs: 500, pollIntervalMs: 2,
    checkContext: () => { if (!valid) throw Error('ACTION_CONTEXT_CHANGED') }, onAbort: () => cleanup++ })
  setTimeout(() => { valid = false }, 3)
  await assert.rejects(result, error => error.result.code === 'ACTION_CONTEXT_ABORTED' && error.result.outcome === 'unknown')
  assert.equal(cleanup, 1)
})
test('precondition rejection never dispatches an action', async () => {
  let dispatched = false
  await assert.rejects(runActionWithDeadline(() => { dispatched = true }, { checkContext: () => { throw Error('NOT_ALIVE') } }), /NOT_ALIVE/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(runActionWithDeadline(() => { dispatched = true }, { signal: controller.signal }), /ACTION_NOT_DISPATCHED_ABORTED/)
  assert.equal(dispatched, false)
})
test('cleanup failure cannot reclassify an interrupted mutation as known', async () => {
  await assert.rejects(runActionWithDeadline(() => new Promise(() => {}), { timeoutMs: 2, onAbort: () => { throw Error('private details') } }),
    error => error.result.cleanupOk === false && error.result.outcomeKnown === false && !JSON.stringify(error.result).includes('private'))
})
test('late rejection is consumed and never retried', async () => {
  let attempts = 0, reject
  const pending = new Promise((_resolve, fail) => { reject = fail })
  await assert.rejects(runActionWithDeadline(() => { attempts++; return pending }, { timeoutMs: 2 }), /ACTION_DEADLINE_TIMEOUT/)
  reject(Error('native timeout')); await delay(2); assert.equal(attempts, 1)
})
test('actual client fence blocks stale closure writes while cancellation and connection survive', () => {
  const sent = [], blocked = []
  const client = { write (name, data) { sent.push([name, data]); return 'sent' } }
  const fence = installActionPacketFence(client, item => blocked.push(item))
  assert.equal(client.write('block_dig', { status: 0 }), 'sent'); fence.block()
  for (const [name, data] of [['block_dig', { status: 2 }], ['use_item', {}], ['window_click', {}],
    ['plugin_message', { channel: 'maw_agent:colony_action', data: 'SECRET' }]]) assert.equal(client.write(name, data), false)
  for (const [name, data] of [['block_dig', { status: 1 }], ['position', {}], ['keep_alive', {}],
    ['plugin_message', { channel: 'maw_agent:world_query' }]]) assert.equal(client.write(name, data), 'sent')
  assert.deepEqual(fence.status(), { blocked: true, blockedWrites: 4 }); assert.equal(sent.length, 5)
  assert.ok(!JSON.stringify(blocked).includes('SECRET'))
})
test('blocked write diagnostics are bounded and all mutating bridge channels are fenced', () => {
  let calls = 0
  const client = { write () { throw Error('must not send') } }
  const fence = installActionPacketFence(client, () => calls++); fence.block()
  for (let n = 0; n < 30; n++) client.write('use_entity', { secret: 'not printed' })
  assert.equal(calls, 8); assert.equal(fence.status().blockedWrites, 30)
  for (const name of ['menu', 'colony', 'maid', 'spell']) assert.equal(outboundGameMutation('custom_payload', { channel: `maw_agent:${name}_action` }), true)
})
test('real release-use and dig cancellation pass, drops and swaps remain fenced', () => {
  for (const status of [1, 5]) assert.equal(outboundGameMutation('block_dig', { status }), false)
  for (const status of [0, 2, 3, 4, 6]) assert.equal(outboundGameMutation('block_dig', { status }), true)
})
test('inner navigation deadline synchronously invalidates outer continuation', async () => {
  let outer, mutations = 0
  const operation = runActionWithDeadline(async scope => {
    outer = scope
    try {
      await runActionWithDeadline(() => new Promise(() => {}), { timeoutMs: 3,
        onAbort: ({ reason }) => scope.abort(reason) })
    } catch {}
    scope.check(); mutations++
  }, { timeoutMs: 500 })
  await assert.rejects(operation, error => error.result.code === 'ACTION_DEADLINE_TIMEOUT' && error.result.outcomeUnknown)
  assert.throws(() => outer.check(), /ACTION_DEADLINE_TIMEOUT/); assert.equal(mutations, 0)
})
test('maintenance marker context is labeled without exposing uncontrolled error text', async () => {
  let maintained = false
  const result = runActionWithDeadline(() => new Promise(() => {}), { timeoutMs: 500, pollIntervalMs: 2,
    checkContext: () => {
      if (maintained) { const error = Error('SECRET'); error.actionInterruptionReason = 'maintenance'; throw error }
    } })
  setTimeout(() => { maintained = true }, 2)
  await assert.rejects(result, error => error.result.code === 'ACTION_MAINTENANCE_ABORTED' && !JSON.stringify(error.result).includes('SECRET'))
})
test('death abort of a readonly wait discards the old plan without permanently fencing the next spawn', async () => {
  let alive = true, nextActions = 0, scope, fenceBlocks = 0
  const result = runActionWithDeadline(async value => { scope = value; await value.wait(1000); nextActions++ }, { readOnly: true, timeoutMs: 2000, pollIntervalMs: 2,
    checkContext: () => { if (!alive) throw Error('PLAYER_DEAD') }, onAbort: ({ outcomeUnknown }) => { if (outcomeUnknown) fenceBlocks++ } })
  setTimeout(() => { alive = false }, 3)
  await assert.rejects(result, error => error.result.outcomeKnown === true && error.result.outcomeUnknown === false && error.result.discarded === true)
  assert.equal(nextActions, 0); assert.equal(fenceBlocks, 0); assert.throws(() => scope.check(), /ACTION_CONTEXT_ABORTED/)
  alive = true
  assert.deepEqual(await runActionWithDeadline(() => ({ ok: true, newSpawn: true }), { readOnly: true, checkContext: () => assert.ok(alive) }), { ok: true, newSpawn: true })
})
test('read-only deadline and native query timeout remain known; late successful reads never revive the discarded plan', async () => {
  let resolve, scope
  await assert.rejects(runActionWithDeadline(value => { scope = value; return new Promise(done => { resolve = done }) }, { readOnly: true, timeoutMs: 3 }),
    error => error.result.outcomeKnown && !error.result.outcomeUnknown && error.result.code === 'ACTION_DEADLINE_TIMEOUT')
  resolve({ ok: true }); await delay(1); assert.throws(() => scope.check(), /DEADLINE_TIMEOUT/)
  await assert.rejects(runActionWithDeadline(() => { throw Error('COLONY_RECEIPT_TIMEOUT q') }, { readOnly: true }),
    error => error.result.outcomeKnown && !error.result.outcomeUnknown && error.result.readOnly)
})
test('actual packet dispatch upgrades a declared readonly action to unknown, including a native transport throw', async () => {
  for (const transportThrows of [false, true]) {
    let scope, dispatched = 0, fenced = false
    const client = { write () { dispatched++; if (transportThrows) throw Error('TRANSPORT_FAILURE') } }
    const fence = installActionPacketFence(client, () => {}, () => scope?.mutationDispatched())
    await assert.rejects(runActionWithDeadline(async value => { scope = value; client.write('custom_payload', { channel: 'maw_agent:colony_action' }); await value.wait(1000) },
      { readOnly: true, timeoutMs: 3, onAbort: ({ outcomeUnknown }) => { if (outcomeUnknown) { fenced = true; fence.block() } } }),
    error => error.result.outcomeKnown === false && error.result.outcomeUnknown === true)
    assert.equal(dispatched, 1)
    if (!transportThrows) { assert.equal(fenced, true); assert.equal(client.write('window_click', {}), false) }
  }
})
