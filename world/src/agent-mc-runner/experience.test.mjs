import test from 'node:test'
import assert from 'node:assert/strict'
import { successfulExperiences } from './experience.mjs'
const row = (id, operation, args, added = []) => [
  { name: 'mc_do', args: { action_id: id, operation, args }, value: { accepted: true } },
  { name: 'mc_wait', at: '2026-10-13T00:00:00Z', value: { action_id: id, bodyId: 'own', terminal: true,
    ok: true, outcomeKnown: true, result: { inventoryDelta: { available: true, playerUuid: 'own', added, removed: [] } } } }
]
test('retrieves verified historic production with market context, not stale executable arguments', () => {
  const source = [...row('market1', 'society.open', { menu: 'market' }),
    ...row('buy1', 'menu.click', { slot: 8, snbt: 'old', key: 'private' }, [{ id: 'minecraft:oak_log', count: 2 }]),
    ...row('craft1', 'inventory.craftRecipe', { recipeId: 'minecraft:oak_planks' }, [{ id: 'minecraft:oak_planks', count: 8 }])]
  const before = JSON.stringify(source), found = successfulExperiences(source, 'own')
  assert.equal(found.length, 2); assert.equal(found[0].menuContext, 'market')
  assert.equal(found[0].requiresFreshState, true); assert.equal(found[1].produced[0].count, 8)
  assert.doesNotMatch(JSON.stringify(found), /private|snbt|slot/)
  assert.equal(JSON.stringify(source), before)
})
test('ignores other bodies, failures, unknowns and duplicate result queries; caps distinct experiences', () => {
  const source = row('test', 'menu.click', {}, [{ id: 'minecraft:oak_log', count: 2 }])
  assert.equal(successfulExperiences([...source, source[1]], 'own').length, 1)
  assert.equal(successfulExperiences(source, 'foreign').length, 0)
  source[1].value.outcomeUnknown = true
  assert.equal(successfulExperiences(source, 'own').length, 0)
  source[1].value.outcomeUnknown = false; source[1].value.ok = false
  assert.equal(successfulExperiences(source, 'own').length, 0)
  const many = ['a', 'b', 'c'].flatMap(id => row(id, 'inventory.craftRecipe', {}, [{ id: 'test:' + id, count: 1 }]))
  assert.deepEqual(successfulExperiences(many, 'own', 2).map(e => e.actionId), ['b', 'c'])
})
