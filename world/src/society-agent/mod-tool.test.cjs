'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { parsePlan } = require('./plan.cjs')
const { actionIsReadOnly } = require('./action-policy.cjs')
const { runModToolAction } = require('./mod-tool.cjs')
const { modOperationCatalog } = require('../neoforge-handshake/mod-call-client.cjs')
const parse = action => parsePlan(JSON.stringify({ goal: '模组生活', reason: '实际原生状态', actions: [action] })).actions[0]

test('spell aiming accepts finite absolute points and rejects malformed or unbounded targets', () => {
  assert.deepEqual(parse({ type: 'look', position: { x: .5, y: 68.25, z: -10 } }).position, { x: .5, y: 68.25, z: -10 })
  for (const position of [null, { x: '1', y: 64, z: 0 }, { x: 30000000, y: 64, z: 0 }, { x: 0, y: 64, z: 0, actor: 'other' }]) {
    assert.throws(() => parse({ type: 'look', position }), /LOOK_POSITION/)
  }
  assert.equal(actionIsReadOnly({ type: 'look' }), false)
})

test('body plans discover the same operations and typed schemas as the external SDK', async () => {
  const calls = { call () { throw Error('catalog must not dispatch') } }
  const list = await runModToolAction(parse({ type: 'mod', operation: 'list' }), calls)
  assert.equal(list.operationCount, 49)
  assert.deepEqual(list.operations.map(row => row.id), modOperationCatalog().operations.map(row => row.id))
  assert.equal(list.operations[0].parameters, undefined)
  const explained = await runModToolAction(parse({ type: 'mod', operation: 'explain', id: 'colony.assignCitizen' }), calls)
  assert.deepEqual(explained.operation.parameters, modOperationCatalog('colony.assignCitizen').operation.parameters)
  assert.ok(explained.operation.parameters.required.includes('expectedModuleKey'))
})

test('model calls reject unknown operations, actor substitution, malformed arrays and extra parameters before dispatch', () => {
  for (const action of [
    { operation: 'eval', id: 'colony.management' }, { operation: 'call', id: 'colony.op' },
    { operation: 'explain', id: 'spell.configure', args: {} }, { operation: 'list', id: 'curios.open' },
    { operation: 'call', id: 'curios.open', actor: 'OtherPlayer' },
    { operation: 'call', id: 'curios.open', args: { playerUuid: 'other' } },
    { operation: 'call', id: 'spell.configure', args: { slot: 0, name: 'test', glyphs: [] } },
    ...[[.5, 2, .5], [.5, .1], ['.5', 0, 0]].map(aimOffset => ({ operation: 'call', id: 'create.settings', args: { position: { x: 1, y: 64, z: 2 }, aimOffset } })),
    { operation: 'call', id: 'colony.assignCitizen', args: { buildingPosition: { x: 1, y: 64, z: 2 }, moduleId: 102 } }
  ]) assert.throws(() => parse({ type: 'mod', ...action }), /PLAN_MOD|MOD_CALL|MOD_OPERATION/)
  assert.deepEqual(parse({ type: 'mod', operation: 'call', id: 'create.settings', args: { position: { x: 1, y: 64, z: 2 }, aimOffset: [.1, .8, .5] } }).args.aimOffset, [.1, .8, .5])
})

test('read classification comes from installed bindings and mutations preserve unknown receipts without retries', async () => {
  for (const definition of modOperationCatalog().operations) {
    assert.equal(actionIsReadOnly({ type: 'mod', operation: 'call', id: definition.id }), definition.readOnly)
  }
  assert.equal(actionIsReadOnly({ type: 'mod', operation: 'call', id: 'unknown', readOnly: true }), false)
  assert.equal(actionIsReadOnly({ type: 'mod', operation: 'call', id: 'curios.open', readOnly: true }), false)
  assert.equal(actionIsReadOnly({ type: 'mod', operation: 'explain', id: 'curios.open' }), true)
  let dispatched = 0
  const unknown = { ok: false, outcomeKnown: false, outcomeUnknown: true, retryAutomatically: false }
  const calls = { async call (id, args) { dispatched++; assert.equal(id, 'curios.open'); assert.deepEqual(args, {}); return unknown } }
  assert.equal(await runModToolAction(parse({ type: 'mod', operation: 'call', id: 'curios.open' }), calls), unknown)
  assert.equal(dispatched, 1)
})
