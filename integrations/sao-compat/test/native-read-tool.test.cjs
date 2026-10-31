'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const { NATIVE_READ_TOOL, executeNativeRead } = require('../native-read-tool.cjs')
const contract = require('../../tau-ceti/native-bridge/operations.json')
test('native recipe filters come from the same operation schema', () => {
  assert.deepEqual(NATIVE_READ_TOOL.parameters.properties.recipe, contract.operations.find(r => r.id === 'native.recipes').parameters)
})
test('one actual partial read retains original facts and an explicit continuation without auto-reading', async () => {
  let calls = 0
  const receipt = { ok: true, status: 'partial', recipes: [{ recipeId: 'test:food' }], nextOffset: 2, remainingCount: 12, observedAt: 'now' }
  const result = await executeNativeRead({ native: { recipes: async filters => { calls++; assert.equal(filters.outputId, 'test:bread'); return receipt } } }, { section: 'recipes', recipe: { outputId: 'test:bread', limit: 2 } })
  assert.equal(calls, 1); assert.equal(result.data.response, receipt); assert.equal(result.failed, false)
  assert.deepEqual(result.data.next.arguments, { section: 'recipes', recipe: { outputId: 'test:bread', limit: 2, offset: 2 } })
  assert(!result.text.includes('recipes"'))
})
test('format errors and conflicting sections fail before any network call', async () => {
  const bot = { native: new Proxy({}, { get () { throw Error('must not dispatch') } }) }
  for (const [args, field] of [[{ section: 'recipes', recipe: { limit: 13 } }, 'args.recipe.limit'], [{ section: 'recipes', recipe: { limit: '2' } }, 'args.recipe.limit'],
    [{ section: 'state', recipe: {} }, 'args.recipe'], [{ section: 'item' }, 'args.slot'], [{ section: 'recipes', slot: 36 }, 'args.slot']]) {
    const r = await executeNativeRead(bot, args); assert.equal(r.failed, true); assert.equal(r.data.response.diagnostic.field, field)
  }
})
test('existing sections preserve their original receipt text and real unavailable remains unavailable', async () => {
  const value = { ok: false, status: 'blocked', code: 'authentication_required' }
  const r = await executeNativeRead({ native: { snapshot: async () => value } }, { section: 'state' })
  assert.deepEqual(JSON.parse(r.text), value); assert.equal(r.failed, true)
  const unavailable = await executeNativeRead({}, { section: 'recipes' }); assert.equal(unavailable.data.response.reason, 'native_provider_not_attached')
})
test('item inspect uses the explicitly selected original player menu slot', async () => {
  const r = await executeNativeRead({ native: { inspect: async slot => ({ ok: true, status: 'ok', slot, item: { id: 'test:wand' } }) } }, { section: 'item', slot: 36 })
  assert.equal(r.data.response.item.id, 'test:wand'); assert.equal(r.data.response.slot, 36)
})
