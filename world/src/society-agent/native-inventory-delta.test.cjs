'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { nativeInventorySnapshot, nativeInventoryDelta, nativeDigResult, summarizeNativeInventoryReceipt } = require('./native-inventory-delta.cjs')
const uuid = 'e371227c-09fa-3722-84f4-f3228a552c3c'
const item = (id = 'minecraft:cobblestone', count = 1, extra = '') => ({ id, count, snbt: `{id:"${id}",count:${count}${extra}}` })
const state = (values = {}, windowId = 0) => ({ playerUuid: uuid, windowId, slots: Array.from({ length: 46 }, (_, slot) => values[slot] || null) })
const snapshot = menu => nativeInventorySnapshot(menu, uuid)
const result = (before, after, type = 'gather', afterBlock = 'minecraft:air') => nativeDigResult({ type,
  position: { x: -393, y: 69, z: 352 }, beforeBlock: { id: 'minecraft:cobblestone' }, afterBlock,
  beforeInventory: snapshot(before), afterInventory: snapshot(after) })
test('crafting result slot0 is a virtual preview and never owned or counted as pickup', () => {
  const before = state({ 0: item() }), after = state()
  assert.deepEqual(snapshot(before).items, []); assert.deepEqual(nativeInventoryDelta(snapshot(before), snapshot(after)).removed, [])
  const value = result(before, after); assert.equal(value.ok, false); assert.equal(value.blockBroken, true)
  assert.equal(value.pickupConfirmed, false); assert.equal(value.code, 'no_pickup_confirmed')
  assert.equal(value.outcomeUnknown, false); assert.equal(value.retryAutomatically, false)
})
test('a real acquired stack is confirmed and keeps native namespace, slot and complete SNBT', () => {
  const native = item('farmersdelight:tree_bark', 2, ',components:{"minecraft:custom_name":"Bark"}')
  const value = result(state(), state({ 13: native }))
  assert.equal(value.ok, true); assert.equal(value.pickupConfirmed, true); assert.equal(value.code, 'gather_pickup_confirmed')
  assert.deepEqual(value.inventoryDelta.added[0], { id: native.id, count: 2, beforeCount: 0, afterCount: 2,
    stacks: [{ slot: 13, ...native }] })
})
test('merging a real dropped item into an existing stack counts only the increase', () => {
  const value = result(state({ 9: item(undefined, 60), 40: item(undefined, 4) }), state({ 9: item(undefined, 64), 40: item(undefined, 5) }))
  assert.equal(value.inventoryDelta.added[0].count, 5); assert.equal(value.pickupConfirmed, true)
})
test('moving a held/input/equipment item between canonical slots is not new pickup', () => {
  const before = state({ 1: item(), 5: item('minecraft:iron_helmet'), 36: item('minecraft:stick', 2) })
  const after = state({ 9: item(), 11: item('minecraft:iron_helmet'), 45: item('minecraft:stick', 2) })
  assert.deepEqual(nativeInventoryDelta(snapshot(before), snapshot(after)).added, [])
  assert.equal(result(before, after).ok, false)
})
test('external menus use only explicit canonical playerInventory, never container result or guessed suffix', () => {
  const before = { ...state({ 0: item('minecraft:diamond', 64) }, 9), playerInventory: state({ 36: item() }).slots }
  const after = { ...state({ 0: item('minecraft:diamond', 63) }, 9), playerInventory: state({ 36: item(undefined, 2) }).slots }
  const value = result(before, after)
  assert.equal(value.pickupConfirmed, true); assert.equal(value.inventoryDelta.added[0].id, 'minecraft:cobblestone')
  assert.equal(snapshot(state({ 0: item() }, 9)).available, false)
})
test('empty-handed break with no drops is known no-pickup, while dig still verifies broken block', () => {
  const value = result(state(), state())
  assert.equal(value.ok, false); assert.equal(value.code, 'no_pickup_confirmed'); assert.equal(value.outcomeKnown, true)
  const dug = result(state(), state(), 'dig'); assert.equal(dug.ok, true); assert.equal(dug.blockBroken, true)
  assert.equal(dug.pickupConfirmed, false); assert.equal(dug.code, 'block_broken')
})
test('inventory loss, tool damage, or a newly appearing result preview cannot confirm gathering', () => {
  assert.equal(result(state({ 9: item() }), state()).pickupConfirmed, false)
  assert.equal(result(state({ 36: item('minecraft:wooden_pickaxe', 1, ',components:{"minecraft:damage":1}') }),
    state({ 36: item('minecraft:wooden_pickaxe', 1, ',components:{"minecraft:damage":2}'), 0: item() })).pickupConfirmed, false)
})
test('foreign or incomplete inventory never falls back to proxy values or claims pickup', () => {
  const foreign = { ...state({ 9: item() }), playerUuid: '010b4174-0000-4000-8000-000000000001' }
  assert.equal(snapshot(foreign).available, false)
  assert.equal(snapshot({ ...state(), slots: [item()] }).available, false)
  const value = result(state(), foreign)
  assert.equal(value.pickupConfirmed, false); assert.equal(value.code, 'no_pickup_confirmed'); assert.equal(value.outcomeUnknown, false)
})
test('world state unavailable remains genuinely unknown, but unchanged solid block is known failure', () => {
  assert.equal(result(state(), state({ 9: item() }), 'gather', null).outcomeUnknown, true)
  const value = result(state(), state({ 9: item() }), 'gather', 'minecraft:cobblestone')
  assert.equal(value.ok, false); assert.equal(value.blockBroken, false); assert.equal(value.code, 'block_not_broken')
})
test('bounded model summary keeps actual namespace and counts without changing complete private evidence', () => {
  const value = result(state(), state({ 12: item('farmersdelight:tree_bark', 2, ',components:{"minecraft:custom_name":"Bark"}') }))
  const summary = summarizeNativeInventoryReceipt(value)
  assert.deepEqual(summary.inventoryAfter, [{ slot: 12, id: 'farmersdelight:tree_bark', count: 2 }])
  assert.equal(summary.inventoryDelta.added[0].count, 2)
  assert.deepEqual(summary.inventoryDelta.added[0].stacks, summary.inventoryAfter)
  assert.ok(!JSON.stringify(summary).includes('snbt'))
  assert.ok(value.inventoryDelta.added[0].stacks[0].snbt.includes('custom_name'))
})
