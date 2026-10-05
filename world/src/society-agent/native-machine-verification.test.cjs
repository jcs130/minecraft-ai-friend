'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { nativeMachineSnapshot, nativeMachineRecipeEvidence, nativeMachineOutcome, createNativeMachineVerifier } = require('./native-machine-verification.cjs')
const { nativeInventorySnapshot } = require('./native-inventory-delta.cjs')
const uuid = '11111111-2222-3333-8444-555555555555', verificationId = 'aaaaaaaa-bbbb-cccc-8ddd-eeeeeeeeeeee'
const context = { playerUuid: uuid, epoch: 2, dimension: 'minecraft:overworld' }, position = { x: 4, y: 64, z: -5 }
const item = (id, count = 1, components = '{}', slot = 0) => ({ id, count, slot, snbt: `{id:"${id}",count:${count},components:${components}}` })
const menu = items => { const slots = Array(46).fill(null); for (const [slot, value] of items) slots[slot] = value; return { playerUuid: uuid, windowId: 0, slots, carried: null } }
const world = block => ({ schemaVersion: 1, kind: 'world_receipt', ok: true, playerUuid: uuid, dimension: context.dimension, position, block })
const board = input => world({ id: 'farmersdelight:cutting_board', farmersDelight: { source: 'native_visible_block_entity', kind: 'cutting_board', inventory: input,
  storedItem: input[0] ?? null, empty: input.length === 0, maxStackSize: 64, isItemCarvingBoard: false } })
const mill = (input = [], output = [], status = 'waiting_input', timer = 0) => world({ id: 'create:millstone', kinetic: { speed: status === 'processing' ? -32 : 0, stressCapacity: 256, stressUsed: 128 },
  processing: { type: 'create:milling', inputSlotCount: 1, outputSlotCount: 9, input, output, status, timer, outputAvailable: output.length > 0 } })
const stove = (input = [], progress = 0) => world({ id: 'farmersdelight:stove', farmersDelight: { source: 'native_visible_block_entity', kind: 'stove', inventory: input,
  slotCount: 6, slotLimit: 1, lit: true, cookingTimes: [progress, 0, 0, 0, 0, 0], cookingTotalTimes: [200, 0, 0, 0, 0, 0], nextEmptySlot: input.length, full: false } })
function baseline (receipt, playerMenu, outputs) { return { context, machine: nativeMachineSnapshot(receipt, context), inventory: nativeInventorySnapshot(playerMenu, uuid), expectedOutputs: outputs } }
const recipe = (id, type, output, processing = {}) => ({ ok: true, playerUuid: uuid, query: 'recipes', source: 'server_recipe_manager', recipes: [{ recipeId: id, type, definitionAvailable: true,
  ingredients: [{ index: 0, alternatives: [item('minecraft:oak_log')] }], output, processing }] })
test('cutting-board input placement is not product generation or pickup', () => {
  const log = item('minecraft:oak_log'), stripped = item('minecraft:stripped_oak_log')
  const result = nativeMachineOutcome(baseline(board([]), menu([[36, log]]), [stripped]), board([log]), menu([]))
  assert.equal(result.postcondition.inputPlacedObserved, true); assert.equal(result.pickupConfirmed, false)
  assert.equal(result.postcondition.newNativeProductObserved, false); assert.equal(result.inventoryDelta.removed[0].id, log.id)
})
test('taking unprocessed board input back does not count as the expected processed product', () => {
  const log = item('minecraft:oak_log')
  const result = nativeMachineOutcome(baseline(board([log]), menu([]), [item('minecraft:stripped_oak_log')]), board([]), menu([[36, log]]))
  assert.equal(result.postcondition.inputRemovedObserved, true); assert.equal(result.pickupConfirmed, false); assert.deepEqual(result.productGains, [])
})
test('actual expected full-component product gain plus input removal confirms inventory acquisition, not drop entity attribution', () => {
  const product = item('minecraft:stripped_oak_log', 1), before = baseline(board([item('minecraft:oak_log')]), menu([[10, product]]), [product])
  const result = nativeMachineOutcome(before, board([]), menu([[10, item(product.id, 2)]]))
  assert.equal(result.pickupConfirmed, true); assert.equal(result.productGains[0].count, 1)
  assert.equal(result.postcondition.worldDropObserved, null); assert.equal(result.postcondition.newNativeProductObserved, false)
  assert.match(result.postcondition.attribution, /not_drop_entity_attributed/)
})
test('consumption, tool durability, unrelated loot and different components cannot masquerade as product pickup', () => {
  const expected = item('minecraft:iron_axe', 1, '{"minecraft:damage":1}'), old = item(expected.id, 1, '{"minecraft:damage":0}')
  let result = nativeMachineOutcome(baseline(board([item('minecraft:oak_log')]), menu([[36, old]]), [expected]), board([]), menu([[36, expected], [10, item('minecraft:apple')]]))
  assert.equal(result.pickupConfirmed, false)
  result = nativeMachineOutcome(baseline(board([item('minecraft:oak_log')]), menu([]), [item('minecraft:stripped_oak_log')]), board([]), menu([[10, item('minecraft:stripped_oak_log', 1, '{"minecraft:custom_name":"other"}')]]))
  assert.equal(result.pickupConfirmed, false)
})
test('existing millstone output can be collected but never falsely becomes newly produced output', () => {
  const flour = item('create:wheat_flour', 3), before = baseline(mill([], [flour], 'output_ready'), menu([[10, item(flour.id)]]), [flour])
  const unchanged = nativeMachineOutcome(before, mill([], [flour], 'output_ready'), menu([[10, item(flour.id)]]))
  assert.equal(unchanged.postcondition.expectedNativeOutputPresent, true); assert.equal(unchanged.postcondition.newNativeProductObserved, false); assert.equal(unchanged.pickupConfirmed, false)
  const taken = nativeMachineOutcome(before, mill(), menu([[10, item(flour.id, 4)]]))
  assert.equal(taken.pickupConfirmed, true); assert.equal(taken.productGains[0].count, 3); assert.equal(taken.postcondition.newNativeProductObserved, false)
})
test('actual milling power/timer progress and new buffered output remain separate from acquired inventory', () => {
  const wheat = item('minecraft:wheat'), flour = item('create:wheat_flour')
  const before = baseline(mill([wheat], [], 'waiting_power', 146), menu([]), [flour])
  const processing = nativeMachineOutcome(before, mill([wheat], [], 'processing', 132), menu([]))
  assert.equal(processing.effectVerified, true); assert.equal(processing.pickupConfirmed, false); assert.equal(processing.machine.kinetic.speed, -32)
  const ready = nativeMachineOutcome(before, mill([], [flour], 'output_ready'), menu([]))
  assert.equal(ready.postcondition.newNativeProductObserved, true); assert.equal(ready.postcondition.expectedNativeOutputPresent, true); assert.equal(ready.pickupConfirmed, false)
})
test('stove timers and disappearing input cannot alone prove cooked food pickup', () => {
  const raw = item('minecraft:beef'), cooked = item('minecraft:cooked_beef'), before = baseline(stove([raw]), menu([]), [cooked])
  const progress = nativeMachineOutcome(before, stove([raw], 50), menu([]))
  assert.equal(progress.effectVerified, true); assert.equal(progress.pickupConfirmed, false)
  const vanished = nativeMachineOutcome(before, stove([]), menu([]))
  assert.equal(vanished.postcondition.inputRemovedObserved, true); assert.equal(vanished.pickupConfirmed, false); assert.equal(vanished.postcondition.worldDropObserved, null)
  assert.equal(nativeMachineOutcome(before, stove([]), menu([[11, cooked]])).pickupConfirmed, true)
})
test('unknown recipe keeps expected products and pickup unknown rather than guessing output IDs', () => {
  const result = nativeMachineOutcome(baseline(board([item('minecraft:oak_log')]), menu([]), null), board([]), menu([[10, item('minecraft:stick')]]))
  assert.equal(result.postcondition.expectedOutputKnown, false); assert.equal(result.pickupConfirmed, null); assert.equal(result.productGains, null)
})
test('actual recipe DTO accepts rollable outputs and retains capability false, tool match and full SNBT', () => {
  const receipt = recipe('create:milling/wheat', 'create:milling', item('create:wheat_flour'), { rollableResults: [{ item: item('create:wheat_flour'), baseChancePerItem: 1 }, { item: item('minecraft:wheat_seeds'), baseChancePerItem: 0.25 }], executionAvailable: false, machineExecutionVerified: false, fluidHandlingAvailable: false })
  const result = nativeMachineRecipeEvidence(receipt, 'create:milling/wheat', context, nativeMachineSnapshot(mill(), context))
  assert.equal(result.ok, true); assert.equal(result.expectedOutputs.length, 2); assert.equal(result.expectedOutputs[1].baseChancePerItem, 0.25)
  assert.equal(result.executionAvailable, false); assert.equal(result.machineExecutionVerified, false)
  receipt.recipes[0].definitionAvailable = false; assert.equal(nativeMachineRecipeEvidence(receipt, 'create:milling/wheat', context, { kind: 'millstone' }).ok, false)
})
test('baseline cap, expiry, player/epoch/dimension and actual block identity are enforced before accepting observations', async () => {
  let clock = 0, n = 0, reads = 0
  const verifier = createNativeMachineVerifier({ now: () => clock, newId: () => `aaaaaaaa-bbbb-cccc-8ddd-${String(++n).padStart(12, '0')}`, maxEntries: 1, ttlMs: 1000 })
  const capture = () => verifier.capture({ receipt: board([]), menu: menu([]), context })
  const first = capture(), second = capture()
  assert.equal(verifier.capture({ receipt: board([]), menu: { ...menu([]), carried: item('minecraft:stripped_oak_log') }, context }).code, 'native_machine_capture_requires_empty_cursor')
  const options = { getContext: () => context, getMenu: () => menu([]), readBlock: async () => { reads++; return board([]) }, waitMs: 0 }
  assert.equal((await verifier.verify({ ...options, verificationId: first.verificationId })).ok, false)
  for (const changed of [{ ...context, epoch: 3 }, { ...context, dimension: 'minecraft:the_nether' }, { ...context, playerUuid: verificationId }]) assert.equal((await verifier.verify({ ...options, verificationId: second.verificationId, getContext: () => changed })).code, 'native_machine_verification_context_changed')
  assert.equal(reads, 0)
  const moved = board([]); moved.position = { ...position, y: 65 }
  assert.equal((await verifier.verify({ ...options, verificationId: second.verificationId, readBlock: async () => moved })).observationAvailable, false)
  clock = 1000; assert.equal((await verifier.verify({ ...options, verificationId: second.verificationId })).code, 'native_machine_verification_expired_or_unavailable')
})
test('verification polls at most four read-only snapshots and accumulates seen output/removal before acquisition', async () => {
  let clock = 0, reads = 0, inventory = menu([])
  const flour = item('create:wheat_flour'), verifier = createNativeMachineVerifier({ now: () => clock, newId: () => verificationId })
  const cap = verifier.capture({ receipt: mill([item('minecraft:wheat')], [], 'processing'), menu: inventory, context,
    recipeEvidence: nativeMachineRecipeEvidence(recipe('create:milling/wheat', 'create:milling', flour), 'create:milling/wheat', context, { kind: 'millstone' }) })
  const result = await verifier.verify({ verificationId: cap.verificationId, getContext: () => context, getMenu: () => inventory, wait: async ms => { clock += ms },
    readBlock: async () => { reads++; if (reads === 1) return mill([], [flour], 'output_ready'); inventory = menu([[10, flour]]); return mill() }, goal: 'pickup', waitMs: 1500 })
  assert.equal(reads, 2); assert.equal(result.pickupConfirmed, true); assert.equal(result.postcondition.newNativeProductObserved, true)
  const still = await verifier.verify({ verificationId: cap.verificationId, getContext: () => context, getMenu: () => menu([]), readBlock: async () => mill(), wait: async ms => { clock += ms }, goal: 'pickup', waitMs: 8000 })
  assert.equal(still.reads, 4); assert.equal(still.ok, false); assert.equal(still.outcomeUnknown, false)
})
test('stalled and timeout read-only callbacks are bounded known observations; late receipt is ignored and cancellation is not swallowed', async () => {
  const verifier = createNativeMachineVerifier({ newId: () => verificationId })
  const cap = verifier.capture({ receipt: board([]), menu: menu([]), context })
  const options = { verificationId: cap.verificationId, getContext: () => context, getMenu: () => menu([]), waitMs: 5, wait: async () => {} }
  const result = await verifier.verify({ ...options, readBlock: () => new Promise(resolve => setTimeout(() => resolve(board([item('minecraft:oak_log')])), 20)) })
  assert.equal(result.observationAvailable, false); assert.equal(result.outcomeUnknown, false); assert.equal(result.retryAutomatically, false)
  const timeout = await verifier.verify({ ...options, readBlock: async () => { throw Error('WORLD_QUERY_TIMEOUT q') } })
  assert.equal(timeout.code, 'native_machine_read_not_observed')
  await assert.rejects(verifier.verify({ ...options, check: () => { throw Error('ACTION_CONTEXT_CHANGED') }, readBlock: async () => board([]) }), /CONTEXT_CHANGED/)
})
test('each verify starts with cross-query spacing, and rate limit stays a known read rejection without mutation replay', async () => {
  let clock = 0, reads = 0
  const waits = [], verifier = createNativeMachineVerifier({ now: () => clock, newId: () => verificationId })
  const cap = verifier.capture({ receipt: board([]), menu: menu([]), context })
  const options = { verificationId: cap.verificationId, getContext: () => context, getMenu: () => menu([]), waitMs: 1500,
    wait: async ms => { waits.push(ms); clock += ms }, readBlock: async () => { reads++; return { ok: false, code: 'rate_limited' } } }
  const first = await verifier.verify(options), second = await verifier.verify(options)
  assert.deepEqual(waits, [150, 150]); assert.equal(reads, 2)
  assert.equal(first.code, 'rate_limited'); assert.equal(second.outcomeUnknown, false); assert.equal(second.ok, false)
  assert.equal(second.retryAutomatically, false)
})
