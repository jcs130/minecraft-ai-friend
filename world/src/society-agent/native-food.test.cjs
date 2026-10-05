'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { nativeFoodOptions, consumeNativeFood } = require('./native-food.cjs')
const uuid = '11111111-2222-3333-8444-555555555555'
const food = (id = 'farmersdelight:vegetable_soup', count = 2) => ({ id, count, snbt: `{id:"${id}",count:${count},components:{"minecraft:custom_name":"Lunch"}}`,
  food: { nutrition: 6, saturation: 7.2, canAlwaysEat: false, eatSeconds: 0 } })
function fixture (slot = 36, stack = food(), mutate = true) {
  const state = { playerUuid: uuid, windowId: 0, menuType: 'minecraft:inventory', selectedHotbarSlot: 0, carried: null,
    self: { playerUuid: uuid, food: 5 }, slots: Array(46).fill(null) }
  state.slots[slot] = stack
  let uses = 0, releases = 0; const clicks = []
  const menu = { current: () => structuredClone(state), async click (slot) {
    clicks.push(slot)
    if (state.carried === null) { state.carried = state.slots[slot]; state.slots[slot] = null }
    else { state.slots[slot] = state.carried; state.carried = null }
    return { ok: true, requestId: `click-${clicks.length}`, state: structuredClone(state) }
  } }
  const options = { menu, uuid, itemId: stack.id, check: () => {}, wait: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 2))),
    timeoutMs: 8, select: async selected => { state.selectedHotbarSlot = selected; return { ok: true } }, bot: {
      get inventory () { throw Error('proxy registry must not be consulted') },
      activateItem () { uses++; if (mutate) {
        const selected = state.slots[36 + state.selectedHotbarSlot]
        state.self.food = Math.min(20, state.self.food + selected.food.nutrition)
        selected.count--; selected.snbt = `{id:"${selected.id}",count:${selected.count}}`
        if (selected.count === 0) state.slots[36 + state.selectedHotbarSlot] = null
      } }, deactivateItem () { releases++ }
    } }
  return { state, options, menu, clicks, counts: () => ({ uses, releases }) }
}
test('edible discovery uses actual FOOD components and canonical inventory while preserving full native ID/SNBT', () => {
  const f = fixture(11)
  f.state.slots[11].food.nativeComponent = { nutrition: 6, effects: [{ effect: { id: 'minecraft:hunger', duration: 600 }, probability: 0.8 }] }
  f.state.slots[11].food.additionalItemHooksDescribed = false
  const result = nativeFoodOptions(f.state, uuid)
  assert.equal(result.items[0].id, 'farmersdelight:vegetable_soup'); assert.equal(result.items[0].slot, 11)
  assert.ok(result.items[0].snbt.includes('custom_name'))
  assert.equal(result.items[0].food.nativeComponent.effects[0].probability, 0.8)
  assert.equal(result.items[0].food.additionalItemHooksDescribed, false)
  f.state.slots[12] = { ...food('minecraft:rotten_flesh'), food: null }
  assert.equal(nativeFoodOptions(f.state, uuid).items.length, 1)
  const external = { ...f.state, windowId: 3, slots: [], playerInventory: f.state.slots }
  assert.equal(nativeFoodOptions(external, uuid).items[0].id, 'farmersdelight:vegetable_soup')
})

test('unknown or switched-menu preparation stops after the first click without using or clicking the second destination', async () => {
  for (const unavailable of [true, false]) {
    const f = fixture(9), click = f.options.menu.click
    f.options.menu.click = async slot => {
      const receipt = await click(slot)
      if (unavailable) receipt.stateUnavailable = true
      else { receipt.state.windowId = 3; receipt.state.menuType = 'farmersdelight:cooking_pot' }
      return receipt
    }
    const result = await consumeNativeFood(f.options)
    assert.equal(result.outcomeUnknown, true); assert.equal(result.retryAutomatically, false)
    assert.deepEqual(f.clicks, [9]); assert.deepEqual(f.counts(), { uses: 0, releases: 0 })
  }
})
test('actual mod food can be consumed without consulting or equipping a proxy item', async () => {
  const f = fixture(); const result = await consumeNativeFood(f.options)
  assert.equal(result.ok, true); assert.equal(result.itemId, 'farmersdelight:vegetable_soup')
  assert.equal(result.consumedCount, 1); assert.equal(result.foodBefore, 5); assert.equal(result.foodAfter, 11)
  assert.equal(result.inventoryDelta.removed[0].count, 1); assert.deepEqual(f.counts(), { uses: 1, releases: 1 })
})
test('stored vanilla food including rotten flesh moves through complete-component native menu clicks before one use', async () => {
  const f = fixture(9, food('minecraft:rotten_flesh'))
  const result = await consumeNativeFood(f.options)
  assert.equal(result.ok, true); assert.deepEqual(f.clicks, [9, 36]); assert.equal(f.state.carried, null)
  assert.equal(result.itemId, 'minecraft:rotten_flesh'); assert.equal(result.receiptIDs.length, 2)
})
test('missing food data, full cursor or full hunger refuses consumption without automatic substitution', async () => {
  const f = fixture(); f.state.carried = food()
  assert.equal((await consumeNativeFood(f.options)).ok, false); assert.equal(f.counts().uses, 0)
  const g = fixture(); g.state.self.food = 20
  assert.equal((await consumeNativeFood(g.options)).code, 'already_full'); assert.equal(g.counts().uses, 0)
  const h = fixture(); delete h.state.slots[36].food
  assert.equal((await consumeNativeFood(h.options)).code, 'native_food_item_unavailable'); assert.equal(h.counts().uses, 0)
})
test('unobserved consumption is unknown and never activates a second time', async () => {
  const f = fixture(36, food(), false), result = await consumeNativeFood(f.options)
  assert.equal(result.code, 'native_food_consumption_unverified'); assert.equal(result.outcomeUnknown, true)
  assert.equal(result.retryAutomatically, false); assert.deepEqual(f.counts(), { uses: 1, releases: 1 })
})
test('a whole-stack disappearance is recorded as an anomaly rather than a successful single meal', async () => {
  const f = fixture(36, food('minecraft:rotten_flesh', 16), false)
  f.options.bot.activateItem = () => { f.state.slots[36] = null; f.state.self.food = 9 }
  const result = await consumeNativeFood(f.options)
  assert.equal(result.ok, false); assert.equal(result.code, 'native_food_consumption_count_anomaly'); assert.equal(result.consumedCount, 16)
  assert.equal(result.outcomeKnown, true); assert.equal(result.retryAutomatically, false)
})
