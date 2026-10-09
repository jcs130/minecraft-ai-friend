'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachConstructionClient } = require('./construction-client.cjs')
const uuid = '11111111-2222-3333-8444-555555555555'
function fixture () {
  const state = { playerUuid: uuid, windowId: 0, menuType: 'minecraft:inventory', selectedHotbarSlot: 0,
    carried: null, slots: Array(46).fill(null), self: { playerUuid: uuid, food: 12 } }
  state.slots[9] = { id: 'farmersdelight:vegetable_soup', count: 2, snbt: 'complete-original-soup-stack',
    food: { nutrition: 6, saturation: 7.2, canAlwaysEat: false, eatSeconds: 1.6 } }
  const bot = Object.assign(new EventEmitter(), { health: 20, _client: { uuid, write (name, args) {
    if (name === 'held_item_slot') state.selectedHotbarSlot = args.slotId
  } }, setQuickBarSlot () {}, activateItem () {
    uses++; const item = state.slots[36 + state.selectedHotbarSlot]; item.count--; item.snbt = 'remaining-original-stack'; state.self.food = 18
  }, deactivateItem () { releases++ } })
  let uses = 0, releases = 0, clicks = 0
  Object.defineProperty(bot, 'inventory', { get () { throw Error('must not consult proxy inventory') } })
  const menu = { current: () => structuredClone(state), async click (slot) {
    clicks++; [state.carried, state.slots[slot]] = [state.slots[slot], state.carried]
    return { ok: true, changed: true, requestId: 'click-' + clicks, state: structuredClone(state) }
  } }
  return { bot, state, client: attachConstructionClient(bot, menu, {}), counts: () => ({ uses, releases, clicks }) }
}
test('native food operation moves exact mod food and verifies one serving and hunger', async () => {
  const f = fixture(); assert.equal(f.client.food().items[0].id, 'farmersdelight:vegetable_soup')
  const r = await f.client.consume({ itemId: 'farmersdelight:vegetable_soup', inventorySlot: 9, expectedSnbt: 'complete-original-soup-stack' })
  assert.equal(r.ok, true); assert.equal(r.consumedCount, 1); assert.equal(r.foodBefore, 12); assert.equal(r.foodAfter, 18)
  assert.deepEqual(f.counts(), { uses: 1, releases: 1, clicks: 2 }); assert.equal(f.state.carried, null)
})
test('changed full components and a full player reject without use or inventory movement', async () => {
  const f = fixture()
  assert.equal((await f.client.consume({ itemId: 'farmersdelight:vegetable_soup', expectedSnbt: 'different' })).code, 'native_food_item_changed')
  f.state.self.food = 20
  assert.equal((await f.client.consume({ itemId: 'farmersdelight:vegetable_soup' })).code, 'already_full')
  assert.deepEqual(f.counts(), { uses: 0, releases: 0, clicks: 0 })
})
test('a death after use stops observation, releases use and preserves unknown instead of retrying', async () => {
  const f = fixture(); f.bot.activateItem = () => { f.bot.emit('death') }
  const r = await f.client.consume({ itemId: 'farmersdelight:vegetable_soup' })
  assert.equal(r.outcomeUnknown, true); assert.equal(r.ok, false); assert.equal(f.counts().releases, 1)
  f.client.detach(); assert.equal(f.bot.listenerCount('death'), 0)
})
