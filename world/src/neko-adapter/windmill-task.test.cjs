const { test } = require('node:test')
const assert = require('node:assert/strict')
const { WindmillTaskEvidence } = require('./windmill-task.cjs')
const uuid = '11111111-2222-3333-8444-555555555555', position = { x: 1, y: 65, z: 3 }
const placed = { playerUuid: uuid, ok: true, id: 'world.place', callId: 'place', result: { ok: true, position,
  nativePlacementVerified: true, nativeBlock: { id: 'create:windmill_bearing' } } }
const reading = angle => ({ playerUuid: uuid, ok: true, id: 'world.lookAt', result: { ok: true, position,
  block: { id: 'create:windmill_bearing', windmill: { source: 'native_visible_block_entity', running: true, generatedSpeed: 1,
    stalled: false, sailCount: 9, minimumSails: 8, angleDegrees: angle, contraptionUuid: uuid } } } })
test('pre-existing mill and model claims do not complete this construction task', () => {
  const task = new WindmillTaskEvidence(uuid)
  task.observe(reading(10), 1000); task.observe(reading(20), 2000); task.observe({ complete: true })
  assert.equal(task.snapshot().complete, false)
})
test('self-placed bearing requires changing native angles of the same contraption', () => {
  const task = new WindmillTaskEvidence(uuid); task.observe(placed)
  task.observe(reading(10), 1000); task.observe(reading(10), 2000)
  assert.equal(task.snapshot().complete, false)
  task.observe(reading(20), 3000); assert.equal(task.snapshot().complete, true)
})
test('foreign, stalled, unknown and mismatched identities cannot produce success', () => {
  for (const change of [r => { r.playerUuid = 'foreign' }, r => { r.result.block.windmill.stalled = true },
    r => { r.outcomeUnknown = true }, r => { r.result.position = { x: 100, y: 0, z: 0 } }]) {
    const task = new WindmillTaskEvidence(uuid); task.observe(placed); task.observe(reading(10), 1000)
    const bad = reading(20); change(bad); task.observe(bad, 2000); assert.equal(task.snapshot().complete, false)
  }
})
