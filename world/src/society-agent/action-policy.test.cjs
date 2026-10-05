'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { actionIsReadOnly, actionErrorIsUnknown } = require('./action-policy.cjs')
test('only installed no-write operations are classified readonly; a model flag never changes a mutation', () => {
  for (const action of [{ type: 'wait' }, { type: 'recipes' }, { type: 'block_inspect' }, { type: 'block_verify' },
    { type: 'entity_inspect' }, { type: 'colony', operation: 'status' }, { type: 'maid', operation: 'tasks' }, { type: 'spell', operation: 'explain' }]) assert.equal(actionIsReadOnly(action), true)
  for (const action of [{ type: 'navigate' }, { type: 'craft', readOnly: true }, { type: 'colony', operation: 'deliver', readOnly: true },
    { type: 'spell', operation: 'cast' }, { type: 'maid', operation: 'pickup' }]) assert.equal(actionIsReadOnly(action), false)
})
test('explicit known read outcome wins over timeout wording; any explicit unknown still stays fenced', () => {
  assert.equal(actionErrorIsUnknown({ message: 'ACTION_DEADLINE_TIMEOUT', result: { outcomeKnown: true, outcomeUnknown: false } }), false)
  assert.equal(actionErrorIsUnknown({ message: 'COLONY_RECEIPT_TIMEOUT', result: { outcomeKnown: true } }), false)
  assert.equal(actionErrorIsUnknown({ message: 'MENU_UNAVAILABLE', result: { outcomeKnown: false } }), true)
  assert.equal(actionErrorIsUnknown({ message: 'read timeout', result: { outcomeKnown: true, outcomeUnknown: true } }), true)
  assert.equal(actionErrorIsUnknown({ message: 'COLONY_RECEIPT_TIMEOUT' }), true)
})
