const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createTaskAttemptGuard } = require('./task-attempts.cjs')
test('three identical known failures block execution until arguments or body context changes', () => {
  const guard = createTaskAttemptGuard(), context = { x: 1, hand: 3 }, args = { x: 2 }
  for (let i = 0; i < 3; i++) {
    assert.equal(guard.before('world.lookAt', args, context), null)
    guard.observe('world.lookAt', args, context, { ok: false, result: { code: 'different_visible_block' } })
  }
  assert.equal(guard.before('world.lookAt', args, context).previousCode, 'different_visible_block')
  assert.equal(guard.before('world.lookAt', { x: 3 }, context), null)
  assert.equal(guard.before('world.lookAt', args, { x: 4, hand: 3 }), null)
  const rows = guard.recent(); rows[0].count = 100
  assert.equal(guard.recent()[0].count, 3)
})
test('unknown outcomes never become a known rejection or a retry permission', () => {
  const guard = createTaskAttemptGuard()
  for (const receipt of [{ ok: false, outcomeUnknown: true, code: 'unknown' },
    { ok: false, result: { outcomeKnown: false, code: 'unknown' } }, { ok: true, code: 'done' }]) {
    for (let i = 0; i < 4; i++) guard.observe('world.interact', {}, {}, receipt)
  }
  assert.deepEqual(guard.recent(), [])
})
