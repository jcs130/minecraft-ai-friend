'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { performNativeBlockAction } = require('./native-machine-actions.cjs')
const { createNativeMachineVerifier } = require('./native-machine-verification.cjs')
const uuid = '11111111-2222-3333-8444-555555555555', context = { playerUuid: uuid, epoch: 2, dimension: 'minecraft:overworld' }, position = { x: 4, y: 64, z: -5 }
const item = id => ({ id, count: 1, slot: 0, snbt: `{id:"${id}",count:1}` })
const menu = items => { const slots = Array(46).fill(null); items.forEach((value, i) => { slots[i + 36] = value }); return { playerUuid: uuid, windowId: 0, slots, carried: null } }
const board = input => ({ schemaVersion: 1, kind: 'world_receipt', ok: true, playerUuid: uuid, dimension: context.dimension, position,
  block: { id: 'farmersdelight:cutting_board', farmersDelight: { source: 'native_visible_block_entity', kind: 'cutting_board', inventory: input, storedItem: input[0] ?? null, empty: !input.length } } })
function setup (before, after, { inventoryBefore = menu([]), inventoryAfter = inventoryBefore, recipe: recipeResult = null } = {}) {
  let reads = 0, sends = 0, time = 0
  return { args: { action: { type: 'use_block', position, aimOffset: [0.5, 0.03, 0.5] }, getContext: () => context, getMenu: () => reads < 2 ? inventoryBefore : inventoryAfter,
    readBlock: async () => { reads++; return reads === 1 ? before : typeof after === 'function' ? after() : after },
    readRecipe: async () => recipeResult, sendUse: () => { sends++; return { ok: true } }, wait: async ms => { time += ms },
    verifier: createNativeMachineVerifier({ now: () => time }) }, sends: () => sends, reads: () => reads }
}
const recipe = (toolMatches = true) => ({ ok: true, query: 'recipes', source: 'server_recipe_manager', playerUuid: uuid, recipes: [{ recipeId: 'farmersdelight:cutting/oak_log', type: 'farmersdelight:cutting', definitionAvailable: true,
  ingredients: [{ index: 0, requiredCount: 1, alternatives: [item('minecraft:oak_log')] }], output: item('minecraft:stripped_oak_log'), processing: { heldToolMatches: toolMatches, dropsIntoWorld: true } }] })
test('permission refusal with unchanged board/inventory returns not observed; right-click dispatch is never success', async () => {
  const s = setup(board([]), board([]), { inventoryBefore: menu([item('minecraft:oak_log')]) })
  const result = await performNativeBlockAction(s.args)
  assert.equal(s.sends(), 1); assert.equal(result.ok, false); assert.equal(result.effectVerified, false)
  assert.equal(result.code, 'native_block_interaction_not_observed'); assert.equal(result.interactionSent, true); assert.equal(result.operationCompleted, false)
  assert.equal(s.reads(), 5) // one baseline plus at most four verification reads
})
test('real input load validates input placement separately from completed processing and pickup', async () => {
  const log = item('minecraft:oak_log'), s = setup(board([]), board([log]), { inventoryBefore: menu([log]), inventoryAfter: menu([]) })
  const result = await performNativeBlockAction(s.args)
  assert.equal(result.ok, true); assert.equal(result.postcondition.inputPlacedObserved, true); assert.equal(result.pickupConfirmed, null)
  assert.equal(result.operationCompleted, false); assert.ok(result.verificationId)
})
test('process intent requires actual server recipe, matching native input and correct held tool before any write', async () => {
  for (const [before, recipeResult, code] of [[board([item('minecraft:oak_log')]), recipe(false), 'native_cutting_tool_not_confirmed'],
    [board([item('minecraft:birch_log')]), recipe(true), 'native_cutting_input_does_not_match_recipe']]) {
    const s = setup(before, board([]), { recipe: recipeResult }); Object.assign(s.args.action, { intent: 'process', recipeId: 'farmersdelight:cutting/oak_log' })
    const result = await performNativeBlockAction(s.args)
    assert.equal(result.code, code); assert.equal(s.sends(), 0)
  }
  const s = setup(board([item('minecraft:oak_log')]), board([]), { recipe: recipe(true), inventoryAfter: menu([item('minecraft:stripped_oak_log')]) })
  Object.assign(s.args.action, { intent: 'process', recipeId: 'farmersdelight:cutting/oak_log' })
  const result = await performNativeBlockAction(s.args)
  assert.equal(s.sends(), 1); assert.equal(result.pickupConfirmed, true); assert.equal(result.operationCompleted, true)
})
test('inspect captures a bounded read-only token and preserves full native machine evidence without sending interaction', async () => {
  const s = setup(board([item('minecraft:oak_log')]), board([])); s.args.action.type = 'block_inspect'
  const result = await performNativeBlockAction(s.args)
  assert.equal(s.sends(), 0); assert.equal(result.readOnly, true); assert.equal(result.machine.input[0].snbt, item('minecraft:oak_log').snbt)
  assert.equal(result.expectedOutputs, null); assert.ok(result.verificationId)
})
test('read-only timeout is known but a timeout after an actual write preserves the genuine unknown mutation fence', async () => {
  const s = setup(board([]), () => { throw Error('WORLD_QUERY_TIMEOUT x') })
  let result = await performNativeBlockAction(s.args)
  assert.equal(s.sends(), 1); assert.equal(result.outcomeUnknown, true)
  s.args.readBlock = async () => { throw Error('WORLD_QUERY_TIMEOUT before') }
  result = await performNativeBlockAction(s.args)
  assert.equal(result.outcomeUnknown, false); assert.equal(result.readOnly, true); assert.equal(s.sends(), 1)
})
test('external menu, cursor and changed UUID/position refuse before interaction without inferring inventory gain as success', async () => {
  for (const patch of [{ windowId: 1 }, { carried: item('minecraft:oak_log') }, { carried: undefined }]) {
    const s = setup(board([]), board([]), { inventoryBefore: { ...menu([]), ...patch, playerInventory: Array(46).fill(null) } })
    assert.equal((await performNativeBlockAction(s.args)).ok, false); assert.equal(s.sends(), 0)
  }
  const wrong = board([]); wrong.position = { ...position, x: 5 }
  const s = setup(wrong, board([])); assert.equal((await performNativeBlockAction(s.args)).ok, false); assert.equal(s.sends(), 0)
})
test('an actual dimension change while awaiting the ordinary block read cannot dispatch an old ray hit', async () => {
  const s = setup(board([]), board([])); let current = context
  s.args.getContext = () => current
  s.args.readBlock = async () => { current = { ...context, dimension: 'minecraft:the_nether' }; return board([]) }
  assert.equal((await performNativeBlockAction(s.args)).code, 'native_machine_context_changed'); assert.equal(s.sends(), 0)
})
test('automatic stove timer progress during a denied click is state observation, not a verified interaction', async () => {
  const stove = progress => ({ ...board([]), block: { id: 'farmersdelight:stove', farmersDelight: { source: 'native_visible_block_entity', kind: 'stove',
    inventory: [item('minecraft:beef')], slotCount: 6, slotLimit: 1, lit: true, cookingTimes: [progress, 0, 0, 0, 0, 0], cookingTotalTimes: [200, 0, 0, 0, 0, 0] } } })
  const s = setup(stove(20), stove(30)), result = await performNativeBlockAction(s.args)
  assert.equal(s.sends(), 1); assert.equal(result.postcondition.processingChanged, true)
  assert.equal(result.ok, false); assert.equal(result.effectVerified, false); assert.equal(result.operationCompleted, false)
  const naturallyCompleted = stove(0); naturallyCompleted.block.farmersDelight.inventory = []
  const completed = await performNativeBlockAction(setup(stove(199), naturallyCompleted).args)
  assert.equal(completed.postcondition.inputRemovedObserved, true); assert.equal(completed.ok, false)
  assert.equal(completed.pickupConfirmed, null); assert.equal(completed.operationCompleted, false)
})
test('losing the native menu only after a dispatched click remains unknown and is not a known rejection', async () => {
  const s = setup(board([]), board([item('minecraft:oak_log')]))
  s.args.getMenu = () => { if (s.sends()) throw Error('OWN_MENU_UNAVAILABLE'); return menu([]) }
  const result = await performNativeBlockAction(s.args)
  assert.equal(s.sends(), 1); assert.equal(result.outcomeKnown, false); assert.equal(result.outcomeUnknown, true)
  assert.equal(result.operationCompleted, false); assert.equal(result.retryAutomatically, false)
})
