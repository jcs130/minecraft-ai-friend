'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { nativeLifecycleReceiptFields } = require('./native-lifecycle-receipt.cjs')
test('native work-order registration remains distinct from completed construction and preserves exact target evidence', () => {
  const workOrder = { id: 7, type: 'build', position: { x: 8, y: 64, z: 3 }, claimedBy: { x: 12, y: 64, z: 3 }, targetLevel: 1 }
  const result = nativeLifecycleReceiptFields({ action: 'request_build', workOrder, workOrders: [workOrder], workOrderCount: 1, built: false, constructionPending: true })
  assert.deepEqual(result.workOrder, workOrder); assert.equal(result.built, false); assert.equal(result.completed, undefined)
  workOrder.targetLevel = 9; assert.equal(result.workOrder.targetLevel, 1)
})
test('no-colony rejection retains real capabilities/options instead of discarding founding requirements', () => {
  const options = { founding: { minDistanceFromWorldSpawn: 100, blueprintAvailable: true }, allowedHuts: [{ hutType: 'home', itemId: 'minecolonies:blockhuthome' }] }
  assert.deepEqual(nativeLifecycleReceiptFields({ ok: false, code: 'no_colony', options }), { options })
})
test('first native ray hit and crafted output slot/native ID remain visible while unrelated private payload fields are excluded', () => {
  const result = nativeLifecycleReceiptFields({ slot: 9, id: 'minecraft:stone_pickaxe', requestedPosition: { x: 1, y: 64, z: 1 },
    blocking: { position: { x: 1, y: 65, z: 1 }, id: 'minecraft:oak_leaves', hit: { face: 2, cursor: { x: .3, y: .4, z: 0 } } }, privatePrompt: 'secret' })
  assert.equal(result.slot, 9); assert.equal(result.id, 'minecraft:stone_pickaxe'); assert.equal(result.blocking.id, 'minecraft:oak_leaves'); assert.equal(result.privatePrompt, undefined)
})
