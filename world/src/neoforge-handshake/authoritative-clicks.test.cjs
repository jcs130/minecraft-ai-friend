'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { authoritativeWindowClick } = require('./authoritative-clicks.cjs')

test('vanilla Agent click keeps the exact action and discards tokenless speculative items', () => {
  const packet = { windowId: 7, stateId: 31, slot: 9, mouseButton: 1, mode: 0,
    changedSlots: [{ location: 9, item: { itemCount: 7, itemId: 1 } }], cursorItem: { itemCount: 5, itemId: 1 } }
  const before = structuredClone(packet)
  const result = authoritativeWindowClick(packet)
  assert.deepEqual(result, { windowId: 7, stateId: 31, slot: 9, mouseButton: 1, mode: 0,
    changedSlots: [], cursorItem: { itemCount: 0 } })
  assert.deepEqual(packet, before, 'native/raw observation is never mutated')
})

test('split, shift, outside, drag and empty-cursor clicks preserve every native action field', () => {
  for (const [slot, mouseButton, mode] of [[0, 0, 0], [12, 1, 0], [22, 0, 1], [-999, 0, 0], [7, 4, 5], [0, 0, 6]]) {
    const packet = { windowId: 2, stateId: 88, slot, mouseButton, mode,
      changedSlots: [{ location: slot, item: { itemCount: 64, itemId: 999999 } }],
      cursorItem: { itemCount: 64, itemId: 999999, components: [{ type: 'invented:component', data: 'not trusted' }] } }
    const result = authoritativeWindowClick(packet)
    for (const key of ['windowId', 'stateId', 'slot', 'mouseButton', 'mode']) assert.equal(result[key], packet[key])
    assert.deepEqual(result.changedSlots, [])
    assert.deepEqual(result.cursorItem, { itemCount: 0 })
  }
})
