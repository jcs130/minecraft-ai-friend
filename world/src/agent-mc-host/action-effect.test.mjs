import test from 'node:test'
import assert from 'node:assert/strict'
import { describeActionEffect } from './action-effect.mjs'
const now = Date.now()
const snapshot = (x = 1) => ({ ok: true, bodyId: 'same', status: 'alive', dimension: 'minecraft:overworld',
  capturedAt: new Date(now).toISOString(), position: { x, y: 64, z: 3 } })
const options = { operation: 'body.input', args: { keys: ['forward'], durationMs: 5000 },
  before: snapshot(), after: snapshot(), receipt: { ok: true, outcomeKnown: true }, now }

test('completed inputs distinguish actual displacement without claiming goal success', () => {
  const blocked = describeActionEffect(options)
  assert.equal(blocked.noDisplacement, true); assert.equal(blocked.taskCompletionInferred, false)
  assert.equal(blocked.distance, 0); assert.match(blocked.hint, /没有位移/)
  const moved = describeActionEffect({ ...options, after: snapshot(2.5) })
  assert.equal(moved.noDisplacement, false); assert.equal(moved.distance, 1.5)
  assert.deepEqual(moved.delta, { x: 1.5, y: 0, z: 0 })
  for (const operation of ['body.look', 'menu.click']) assert.equal(describeActionEffect({ ...options, operation }).noDisplacement, false)
  assert.equal(describeActionEffect({ ...options, args: { keys: ['sneak'] } }).noDisplacement, false)
})

test('foreign, stale, dimension-changing, dead and uncertain samples never look like a confirmed failed movement', () => {
  for (const after of [{ ...snapshot(), bodyId: 'foreign' }, { ...snapshot(), status: 'dead' },
    { ...snapshot(), dimension: 'minecraft:the_nether' }, { ...snapshot(), capturedAt: 'invalid' }]) {
    const result = describeActionEffect({ ...options, after })
    assert.equal(result.available, false); assert.equal(result.noDisplacement, null)
  }
  assert.equal(describeActionEffect({ ...options, now: now + 20000 }).available, false)
  assert.equal(describeActionEffect({ ...options, receipt: { outcomeUnknown: true } }).code, 'action_effect_unknown')
})

test('rejected malformed inputs cannot crash effect reporting', () => {
  for (const args of [null, {}, { keys: 'forward' }, { keys: 1 }]) {
    const effect = describeActionEffect({ ...options, args, receipt: { ok: false, outcomeKnown: true } })
    assert.equal(effect.movementRequested, false); assert.equal(effect.noDisplacement, false)
  }
})
