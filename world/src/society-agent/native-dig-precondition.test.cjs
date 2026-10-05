'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { nativeDigPrecondition } = require('./native-dig-precondition.cjs')
const uuid = '11111111-2222-3333-8444-555555555555', requested = { x: 98, y: 68, z: 71 }
const receipt = () => ({ schemaVersion: 1, kind: 'world_receipt', playerUuid: uuid, ok: false, code: 'different_visible_block',
  expectedPosition: requested, position: { x: 97, y: 69, z: 71 }, block: { id: 'minecraft:birch_leaves', properties: { persistent: 'false' } }, hit: { face: 4, cursor: { x: 0, y: 0.25, z: 0.8 } } })
test('actual blocked ray exposes only first server hit absolute coordinates; does not retarget or dispatch dig', () => {
  const result = nativeDigPrecondition(receipt(), { playerUuid: uuid, requestedPosition: requested, expectedId: 'minecraft:birch_log' })
  assert.equal(result.ok, false); assert.equal(result.code, 'different_visible_block'); assert.equal(result.retryAutomatically, false)
  assert.deepEqual(result.requestedPosition, requested); assert.deepEqual(result.blocking.position, { x: 97, y: 69, z: 71 })
  assert.equal(result.blocking.id, 'minecraft:birch_leaves'); assert.equal(result.blocking.source, 'server_native_first_ray_hit')
})
test('foreign UUID, missing native hit, unrelated expected request and rate-limit errors never reveal guessed blockers', () => {
  for (const patch of [{ playerUuid: 'aaaaaaaa-bbbb-cccc-8ddd-eeeeeeeeeeee' }, { hit: null }, { expectedPosition: { x: 1, y: 2, z: 3 } }, { code: 'rate_limited' }, { code: 'no_visible_block' }]) {
    const result = nativeDigPrecondition({ ...receipt(), ...patch }, { playerUuid: uuid, requestedPosition: requested })
    assert.equal(result.ok, false); assert.equal(result.blocking, undefined); assert.equal(result.outcomeUnknown, false)
  }
})
test('verified requested native identity succeeds but replacing it with a proxy or a different block fails closed', () => {
  const actual = { ...receipt(), ok: true, position: requested, block: { id: 'minecraft:birch_log' } }
  assert.equal(nativeDigPrecondition(actual, { playerUuid: uuid, requestedPosition: requested, expectedId: 'minecraft:birch_log' }).ok, true)
  assert.equal(nativeDigPrecondition(actual, { playerUuid: uuid, requestedPosition: requested, expectedId: 'minecraft:stone' }).code, 'native_identity_changed')
})
test('gather obeys native tool-for-drops proof while dig can intentionally clear without harvesting and dirt needs no pickaxe', () => {
  const options = { playerUuid: uuid, requestedPosition: requested, requireDrops: true }
  const stone = { ...receipt(), ok: true, position: requested, block: { id: 'minecraft:stone', requiresCorrectToolForDrops: true, canHarvestWithMainHand: false, mainHandItemId: 'ars_nouveau:novice_spell_book' } }
  const denied = nativeDigPrecondition(stone, options)
  assert.equal(denied.code, 'wrong_tool_for_drops'); assert.equal(denied.outcome, 'known_not_applied'); assert.equal(denied.blockBroken, false); assert.equal(denied.outcomeUnknown, false)
  assert.equal(nativeDigPrecondition(stone, { ...options, requireDrops: false }).ok, true)
  assert.equal(nativeDigPrecondition({ ...stone, block: { ...stone.block, canHarvestWithMainHand: true, mainHandItemId: 'minecraft:wooden_pickaxe' } }, options).ok, true)
  assert.equal(nativeDigPrecondition({ ...stone, block: { id: 'minecraft:dirt', requiresCorrectToolForDrops: false, canHarvestWithMainHand: true } }, options).ok, true)
  assert.equal(nativeDigPrecondition({ ...stone, block: { id: 'minecraft:dirt', requiresCorrectToolForDrops: false, canHarvestWithMainHand: false } }, options).code, 'wrong_tool_for_drops')
  assert.equal(nativeDigPrecondition({ ...stone, block: { id: 'minecraft:stone', requiresCorrectToolForDrops: true } }, options).ok, false)
  assert.equal(nativeDigPrecondition({ ...stone, block: { id: 'minecraft:dirt' } }, options).code, 'native_harvest_precondition_unavailable')
})
