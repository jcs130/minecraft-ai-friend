'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const { planCropHarvest } = require('./farming.cjs')
function fixture () {
  const slots = Array(46).fill(null)
  slots[10] = { id: 'minecraft:wheat_seeds', count: 3, snbt: 'seed-components' }
  slots[36] = { id: 'minecraft:iron_hoe', count: 1, snbt: 'hoe-components' }
  return [{ ok: true, playerUuid: 'self', dimension: 'minecraft:overworld', position: { x: -12, y: 64, z: 31 },
    block: { id: 'minecraft:wheat', properties: { age: '7' }, crop: { source: 'native_crop_block', mature: true, seedItemId: 'minecraft:wheat_seeds', seedPlacesThisCrop: true } } },
  { playerUuid: 'self', windowId: 0, selectedHotbarSlot: 0, carried: null, slots }]
}
test('native maturity, complete CAS and absolute positions feed an ordinary SDK action', () => {
  const [observation, menu] = fixture(), r = planCropHarvest(observation, menu)
  assert.equal(r.ok, true); assert.equal(r.nextAction.operation, 'world.dig')
  assert.deepEqual(r.nextAction.args.expectedProperties, { age: '7' }); assert.equal(r.nextAction.args.expectedHeldSnbt, 'hoe-components')
  assert.deepEqual(r.replant.soilPosition, { x: -12, y: 63, z: 31 }); assert.equal(r.retryAutomatically, false)
})
test('does not harvest immature crops, other accounts, GUI icons or unsupported crops', () => {
  for (const mutate of [(o, m) => { o.block.crop.mature = false }, (o, m) => { m.playerUuid = 'other' },
    (o, m) => { m.windowId = 3 }, (o, m) => { m.carried = { id: 'minecraft:stone' } },
    (o, m) => { o.block.crop.seedPlacesThisCrop = false }, (o, m) => { o.position.x = NaN }]) {
    const f = fixture(); mutate(...f); assert.equal(planCropHarvest(...f).nextAction, null)
  }
})
test('requires a real existing seed and never promises newly dropped seeds', () => {
  const f = fixture(); f[1].slots[10] = null
  assert.equal(planCropHarvest(...f).code, 'reserve_seed_before_harvest')
})
