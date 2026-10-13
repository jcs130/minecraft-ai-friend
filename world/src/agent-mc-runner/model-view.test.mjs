import test from 'node:test'
import assert from 'node:assert/strict'
import { loreFromSnbt, modelView } from './model-view.mjs'

test('menu labels, prices and explicit slots survive projection while complete components remain referenced', () => {
  const component = JSON.stringify({ text: '§aBuy: $6' })
  const snbt = '{components:{"minecraft:lore":[' + "'" + component + "'" + ']},payload:"' + 'x'.repeat(50000) + '"}'
  const raw = { result: { state: { windowId: 4, stateId: 7, slots: [null, { id: 'minecraft:oak_log', count: 1, displayName: '§eOak Log', snbt }], renderRegistries: { enormous: 'x'.repeat(80000) } } } }
  const before = JSON.stringify(raw), view = modelView(raw, 'full')
  assert.deepEqual(view.result.state.slots[1].lore, ['Buy: $6'])
  assert.equal(view.result.state.slots[1].slot, 1)
  assert.deepEqual(view.result.state.slots[1].fullItem, { artifact: 'full', path: ['result', 'state', 'slots', 1] })
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 1000)
  assert.equal(JSON.stringify(raw), before)
})
test('lore projection handles escaped SNBT strings, Unicode and malformed lists without executing data', () => {
  assert.deepEqual(loreFromSnbt('{"minecraft:lore":[\'"中文价格"\',\'{"text":"Left click"}\']}'), ['中文价格', 'Left click'])
  assert.deepEqual(loreFromSnbt('{"minecraft:lore":[unquoted]}'), [])
  assert.deepEqual(loreFromSnbt('{other:1}'), [])
})
