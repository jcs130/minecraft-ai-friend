import test from 'node:test'
import assert from 'node:assert/strict'
import { rejectedRead } from './read-recovery.mjs'
test('a rejected read exposes missing parameters so the model can correct its query', () => {
  const result = rejectedRead({ code: 'MOD_CALL_ARGUMENT_INVALID', field: '$', missingFields: ['action', 'position'] }, 'mc_read')
  assert.deepEqual(result.missingFields, ['action', 'position'])
  assert.equal(result.mutationDispatched, false)
  assert.match(result.hint, /mc_help/)
  assert.equal(rejectedRead({ code: 'MOD_CALL_ARGUMENT_UNSUPPORTED', field: '$.includeState' }, 'mc_read').field, '$.includeState')
})
test('mutation errors, transport uncertainty and corrupt ledgers are never converted into recoverable reads', () => {
  for (const name of ['mc_do', 'mc_cancel', 'mc_control']) for (const code of ['MOD_CALL_ARGUMENT_INVALID', 'MOD_CALL_ARGUMENT_UNSUPPORTED']) assert.equal(rejectedRead({ code }, name), null)
  for (const code of ['ETIMEDOUT', 'NEKO_NATIVE_LEDGER_RESULT_INVALID', 'MODEL_TRANSPORT_UNKNOWN', 'body_action_blocked']) {
    assert.equal(rejectedRead({ code }, 'mc_read'), null)
  }
})
