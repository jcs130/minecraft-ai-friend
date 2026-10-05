'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { reconcileInterruptedActions } = require('./restart-reconciliation.cjs')
const intent = (actionId, action, extra = {}) => ({ kind: 'action_intent', actionId, action, at: '2026-10-05T03:12:04Z', ...extra })
test('legacy unfinished wait is retired as discarded, never completed or replayed; retirement itself makes later restart idempotent', () => {
  const events = [intent('wait', { type: 'wait', seconds: 30 })], result = reconcileInterruptedActions(events)
  assert.equal(result.pending.length, 0); assert.equal(result.retire[0].outcome, 'known_aborted'); assert.equal(result.retire[0].retryAutomatically, false)
  assert.equal(result.retire[0].ok, undefined)
  assert.deepEqual(reconcileInterruptedActions([...events, { kind: 'action_read_retired', ...result.retire[0] }]), { retire: [], pending: [] })
})
test('versioned native status/capabilities reads retire but legacy uncertain reads remain conservative', () => {
  const events = [intent('new', { type: 'colony', operation: 'capabilities' }, { readOnly: true, readOnlyContractVersion: 1 }),
    intent('old', { type: 'colony', operation: 'status' })]
  const result = reconcileInterruptedActions(events)
  assert.equal(result.retire[0].actionId, 'new'); assert.equal(result.pending[0].actionId, 'old')
})
test('actual mutation evidence and forged readOnly flags preserve unknown writes pending even for an allegedly readonly wait', () => {
  const events = [intent('wait', { type: 'wait', seconds: 30 }, { readOnly: true, readOnlyContractVersion: 1 }),
    { kind: 'action_mutation_dispatch', actionId: 'wait', packet: 'window_click' },
    intent('write', { type: 'colony', operation: 'deliver' }, { readOnly: true, readOnlyContractVersion: 1 })]
  assert.equal(reconcileInterruptedActions(events).retire.length, 0); assert.equal(reconcileInterruptedActions(events).pending.length, 2)
})
test('finished actions are not changed and duplicate unknown intents do not generate successful synthetic results', () => {
  const result = reconcileInterruptedActions([intent('done', { type: 'wait' }), { kind: 'action_result', actionId: 'done', result: { outcome: 'known_aborted' } },
    intent('write', { type: 'craft' }), intent('write', { type: 'craft' })])
  assert.equal(result.retire.length, 0); assert.equal(result.pending.length, 1)
})
test('crash after unknown write result but before pause persists remains fenced until explicit operator retirement, preserving original evidence', () => {
  const events = [intent('write', { type: 'colony', operation: 'found' }), { kind: 'action_mutation_dispatch', actionId: 'write' },
    { kind: 'action_result', actionId: 'write', result: { ok: false, outcomeUnknown: true, code: 'operator_interrupted' } }]
  const serialized = JSON.stringify(events)
  assert.equal(reconcileInterruptedActions(events).pending.length, 1)
  for (const patch of [{}, { retryAutomatically: true }, { disposition: 'completed' }]) {
    assert.equal(reconcileInterruptedActions([...events, { kind: 'action_operator_reconciled', actionId: 'write', disposition: 'retired_without_replay', retryAutomatically: false, operator: 'owner', reason: 'owned shutdown and preserved unknown evidence', ...patch }]).pending.length, patch.retryAutomatically || patch.disposition ? 1 : 0)
  }
  assert.equal(JSON.stringify(events), serialized)
})
