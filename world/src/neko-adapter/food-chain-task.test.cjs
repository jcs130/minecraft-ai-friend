'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { FoodChainTaskEvidence } = require('./food-chain-task.cjs')
const uuid = '11111111-2222-3333-8444-555555555555'
const bearing = { x: 1, y: 64, z: 1 }, mill = { x: 4, y: 65, z: 1 }, furnace = { x: 5, y: 64, z: 1 }
function fixture () {
  let time = 1000
  const task = new FoodChainTaskEvidence(uuid, { bearingPosition: bearing, contraptionUuid: uuid })
  const send = (id, result, args = {}, change = r => r) => task.observe(change({ playerUuid: uuid, ok: true, id,
    callId: String(time), result: { ok: true, playerUuid: uuid, ...result } }), time += 500, args)
  const menu = (type, flour = 0, bread = 0, input = null, output = null) => {
    const slots = Array(46).fill(null); slots[0] = input; slots[2] = output
    const inventory = Array(46).fill(null)
    if (flour) inventory[9] = { id: 'create:wheat_flour', count: flour, snbt: 'native-flour' }
    if (bread) inventory[10] = { id: 'minecraft:bread', count: bread, snbt: 'native-bread' }
    return { menuType: type, slots: type === 'minecraft:inventory' ? inventory : slots, ...(type !== 'minecraft:inventory' ? { playerInventory: inventory } : {}) }
  }
  const start = () => {
    send('menu.current', menu('minecraft:inventory'))
    send('world.place', { position: mill, nativePlacementVerified: true, nativeBlock: { id: 'create:millstone' } })
    send('world.place', { position: furnace, nativePlacementVerified: true, nativeBlock: { id: 'minecraft:furnace' } })
    for (const angle of [5, 10]) send('world.lookAt', { position: bearing, block: { windmill: {
      running: true, generatedSpeed: 1, stalled: false, contraptionUuid: uuid, angleDegrees: angle } } })
  }
  const millRead = output => send('world.lookAt', { position: mill, block: { id: 'create:millstone', kinetic: { rpm: 1, overstressed: false },
    processing: { type: 'create:milling', recipeId: 'create:milling/wheat', advancing: !output,
      output: output ? [{ id: 'create:wheat_flour', count: 1, snbt: 'native-flour' }] : [] } } })
  const bake = () => {
    send('menu.current', menu('minecraft:inventory', 1)); send('native.craftRecipe', { outputId: 'create:dough' })
    send('world.interact', {}, { position: furnace })
    send('menu.current', menu('minecraft:furnace', 0, 0, { id: 'create:dough', count: 1 }))
    send('menu.current', menu('minecraft:furnace', 0, 0, null, { id: 'minecraft:bread', count: 1 }))
    send('menu.current', menu('minecraft:inventory', 0, 1))
  }
  return { task, send, start, millRead, bake }
}
test('only the observed powered milling, original dough cooking and hunger chain completes', () => {
  const f = fixture(); f.start(); f.millRead(false); f.millRead(true); f.bake()
  assert.equal(f.task.complete, false)
  f.send('inventory.consume', { itemId: 'minecraft:bread', consumedCount: 1, foodBefore: 12, foodAfter: 17 })
  assert.equal(f.task.complete, true); assert.equal(f.task.snapshot().progress.breadEaten.foodAfter, 17)
})
test('an existing unplaced machine, unknown or foreign receipt cannot establish the chain', () => {
  for (const change of [r => ({ ...r, playerUuid: 'foreign' }), r => ({ ...r, outcomeUnknown: true }),
    r => ({ ...r, result: { ...r.result, nativePlacementVerified: false } })]) {
    const f = fixture()
    f.send('world.place', { position: mill, nativePlacementVerified: true, nativeBlock: { id: 'create:millstone' } }, {}, change)
    f.millRead(false); f.millRead(true); assert.equal(f.task.snapshot().progress.poweredMilling, undefined)
  }
})
test('output icons, dough crafting and an eaten preexisting bread cannot replace powered production', () => {
  const f = fixture(); f.start(); f.millRead(true); f.bake()
  f.send('inventory.consume', { itemId: 'minecraft:bread', consumedCount: 1, foodBefore: 12, foodAfter: 17 })
  assert.equal(f.task.complete, false); assert.equal(f.task.snapshot().progress.flourOutput, undefined)
})
test('consuming a whole stack or no hunger improvement cannot complete a successful production chain', () => {
  for (const consumption of [{ consumedCount: 2, foodBefore: 12, foodAfter: 17 }, { consumedCount: 1, foodBefore: 20, foodAfter: 20 }]) {
    const f = fixture(); f.start(); f.millRead(false); f.millRead(true); f.bake()
    f.send('inventory.consume', { itemId: 'minecraft:bread', ...consumption }); assert.equal(f.task.complete, false)
  }
})
