'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { walkAndObserve } = require('./navigation.cjs')

function setup(error, after = { ok: true, status: 'alive', position: { x: 2.5, y: 65, z: 1.5 } }) {
  let moving = true, stopped = false, interrupted = false
  const bot = { controlStates: { forward: true }, clearControlStates() { this.controlStates.forward = false },
    pathfinder: { async goto() { if (error) throw error }, setGoal(goal) { assert.equal(goal, null); moving = false; stopped = true }, isMoving: () => moving } }
  const scope = { phase() {}, mutationDispatched() {}, check() { if (interrupted) throw Error('ACTION_CONTEXT_ABORTED') }, async wait() {} }
  return { bot, scope, goal: {}, position: { x: 9, y: 65, z: 1 }, snapshot: async () => { assert.equal(stopped, true); return after }, interrupt() { interrupted = true } }
}
test('route failures report actual partial progress and release all control before observation', async () => {
  for (const name of ['NoPath', 'Timeout', 'GoalChanged', 'PathStopped']) {
    const f = setup(Object.assign(Error('route rejected'), { name }))
    const result = await walkAndObserve(f)
    assert.equal(result.ok, false); assert.equal(result.code, 'navigation_path_failed')
    assert.equal(result.navigationError, name); assert.equal(result.outcomeKnown, true)
    assert.deepEqual(result.position, { x: 2.5, y: 65, z: 1.5 })
    assert.equal(f.bot.controlStates.forward, false)
  }
})
test('resolved empty path never counts as arrival and actual arrival is independently verified', async () => {
  const f = setup(); assert.equal((await walkAndObserve(f)).ok, false)
  const arrived = setup(null, { ok: true, status: 'alive', position: { x: 9.5, y: 65, z: 1.5 } })
  assert.equal((await walkAndObserve(arrived)).ok, true)
})
test('unknown transport, missing position and changed context are never released as a known route failure', async () => {
  await assert.rejects(walkAndObserve(setup(Object.assign(Error('socket lost'), { name: 'TransportError' }))), /socket lost/)
  const unavailable = await walkAndObserve(setup(Object.assign(Error(), { name: 'NoPath' }), { ok: false, status: 'unavailable' }))
  assert.equal(unavailable.outcomeUnknown, true)
  const changed = setup(Object.assign(Error(), { name: 'NoPath' })); changed.interrupt()
  await assert.rejects(walkAndObserve(changed), /CONTEXT_ABORTED/)
})
