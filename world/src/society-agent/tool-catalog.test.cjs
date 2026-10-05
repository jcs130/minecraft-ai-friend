'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { agentToolCatalog } = require('./tool-catalog.cjs'), { parsePlan } = require('./plan.cjs')
const uuid = '11111111-2222-3333-8444-555555555555'
const parse = action => parsePlan(JSON.stringify({ goal: '生活', reason: '按原生证据操作', actions: [action] }))
test('tool list/explain expose installed parameters and bounded declared coverage without inventing all-mod support', () => {
  const list = agentToolCatalog()
  assert.equal(list.tools.length, 23); assert.equal(new Set(list.tools.map(tool => tool.id)).size, list.tools.length)
  for (const id of ['recipes', 'block_inspect', 'block_verify', 'entity_inspect', 'entity_interact', 'maid', 'colony', 'spell', 'eat']) assert.ok(agentToolCatalog(id).tool.parameters)
  assert.ok(agentToolCatalog('block_inspect').tool.parameters.aimOffset.includes('.03'))
  assert.equal(agentToolCatalog('summon_anything').ok, false)
  list.tools[0].parameters.operation = 'bad'; assert.equal(agentToolCatalog('tools').tool.parameters.operation, 'list|explain')
})
test('machine verification and explicit cutting-board processing parameters are discoverable and bounded before dispatch', () => {
  assert.equal(parse({ type: 'block_verify', verificationId: uuid, goal: 'pickup', waitMs: 8000 }).actions.length, 1)
  for (const action of [{ type: 'block_verify', verificationId: 'old' }, { type: 'block_verify', verificationId: uuid, waitMs: 8001 },
    { type: 'block_verify', verificationId: uuid, goal: 'auto_craft' }, { type: 'use_block', position: { x: 1, y: 64, z: 2 }, recipeId: 'guessed' },
    { type: 'use_block', position: { x: 1, y: 64, z: 2 }, intent: 'auto_pickup' }]) assert.throws(() => parse(action), /BLOCK_/)
  assert.equal(parse({ type: 'use_block', position: { x: 1, y: 64, z: 2 }, intent: 'process', recipeId: 'farmersdelight:cutting/oak_log' }).actions.length, 1)
  assert.match(agentToolCatalog('block_verify').tool.description, /worldDropObserved=null/)
  assert.match(agentToolCatalog('use_block').tool.description, /heldToolMatches/)
})
test('native entity actions require real UUID and supported intention/hand, not an unrestricted entityId', () => {
  for (const type of ['attack', 'entity_inspect', 'entity_interact']) {
    assert.throws(() => parse({ type, entityId: 7 }), /IDENTITY/)
    assert.equal(parse({ type, entityId: 7, expectedUuid: uuid }).actions[0].entityId, 7)
  }
  assert.throws(() => parse({ type: 'attack', entityId: 7, expectedUuid: uuid, intent: 'kill_friends' }), /INTENT/)
  assert.equal(parse({ type: 'attack', entityId: 7, expectedUuid: uuid, intent: 'hunt_food' }).actions[0].intent, 'hunt_food')
})
test('thin block offsets and exact recipe pagination are validated before any dispatch', () => {
  assert.equal(parse({ type: 'block_inspect', position: { x: 1, y: 64, z: 2 }, aimOffset: [0.5, 0.03, 0.5] }).actions.length, 1)
  for (const aimOffset of [[0.5, 2, 0.5], [0.5, 0.03], ['0.5', 0, 0]]) assert.throws(() => parse({ type: 'use_block', position: { x: 1, y: 64, z: 2 }, aimOffset }), /OFFSET/)
  assert.equal(parse({ type: 'recipes', args: { recipeType: 'create:milling', limit: 12, offset: 0 } }).actions.length, 1)
  for (const args of [{ query: 'flour' }, { recipeType: 'milling' }, { limit: 13 }]) assert.throws(() => parse({ type: 'recipes', args }), /RECIPE/)
})
test('maid booleans and actual task IDs cannot be confused with untyped free-form arguments', () => {
  assert.equal(parse({ type: 'maid', operation: 'pickup', maidUuid: uuid, args: { pickup: false } }).actions.length, 1)
  assert.throws(() => parse({ type: 'maid', operation: 'follow', maidUuid: uuid, args: { follow: 'true' } }), /ARGUMENT/)
  assert.throws(() => parse({ type: 'maid', operation: 'task', maidUuid: uuid, args: { taskId: 'farm' } }), /ARGUMENT/)
})
