'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createNativeRecipeDiscovery } = require('./native-recipe-discovery.cjs')
const uuid = '11111111-2222-3333-8444-555555555555'
const page = playerUuid => ({ playerUuid, schemaVersion: 1, kind: 'world_receipt', ok: true, query: 'recipes', source: 'server_recipe_manager',
  recipes: [{ recipeId: 'farmersdelight:test', definitionAvailable: false, code: 'ingredient_options_exceed_limit' }],
  recipeTypes: Array.from({ length: 40 }, (_, i) => ({ id: `test:type${i}`, count: i + 1 })), nextOffset: 1 })
test('first inspect gets one exact native page; subsequent inspections use 30s same-identity cache and preserve incomplete reasons/types', async () => {
  let calls = 0, clock = 100000
  const cache = createNativeRecipeDiscovery({ recipes: async args => { calls++; assert.deepEqual(args, { limit: 1 }); return page(uuid) } }, { now: () => clock })
  const first = await cache.get(uuid, 1); assert.equal(first.available, true); assert.equal(first.source, 'server_recipe_manager')
  assert.equal(first.recipes[0].definitionAvailable, false); assert.equal(first.recipes[0].code, 'ingredient_options_exceed_limit')
  assert.equal(first.recipeTypes.length, 40); first.recipeTypes.length = 0
  clock += 29999; assert.equal((await cache.get(uuid, 1)).recipeTypes.length, 40); assert.equal(calls, 1)
  clock++; await cache.get(uuid, 1); assert.equal(calls, 2)
})
test('epoch change invalidates read cache; unknown read results are not disguised as available content or automatically replayed', async () => {
  let calls = 0
  const cache = createNativeRecipeDiscovery({ recipes: async () => { calls++; return { ...page(uuid), ok: false, code: 'native_query_not_observed', recipes: undefined } } })
  assert.equal((await cache.get(uuid, 1)).available, false); await cache.get(uuid, 1); assert.equal(calls, 1)
  assert.equal((await cache.get(uuid, 2)).code, 'native_query_not_observed'); assert.equal(calls, 2)
})
test('concurrent reads share one query and foreign/late previous-epoch receipts cannot poison current identity cache', async () => {
  const resolves = [], calls = []
  const cache = createNativeRecipeDiscovery({ recipes: args => { calls.push(args); return new Promise(resolve => resolves.push(resolve)) } })
  const a = cache.get(uuid, 1), same = cache.get(uuid, 1), newer = cache.get(uuid, 2)
  assert.equal(calls.length, 2)
  resolves[1](page(uuid)); await newer; resolves[0](page(uuid)); await Promise.all([a, same])
  assert.equal((await cache.get(uuid, 2)).observationEpoch, 2); assert.equal(calls.length, 2)
  const foreign = createNativeRecipeDiscovery({ recipes: async () => page('aaaaaaaa-2222-3333-8444-555555555555') })
  assert.equal((await foreign.get(uuid, 0)).available, false)
})
