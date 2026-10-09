'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createShutdownGate } = require('./shutdown-gate.cjs')

test('startup and duplicate stops await cleanup and preserve the first failure', async () => {
  let finish, finalized = false
  const reasons = []
  const shutdown = createShutdownGate(async (reason, code) => {
    reasons.push([reason, code])
    await new Promise(resolve => { finish = resolve })
    finalized = true
    return code
  })
  const death = shutdown('trial_player_died', 1)
  assert.strictEqual(shutdown('operator_stop', 0), death)
  assert.strictEqual(shutdown.wait(), death)
  assert.equal(finalized, false)
  finish()
  assert.equal(await shutdown.wait(), 1)
  assert.equal(finalized, true)
  assert.deepEqual(reasons, [['trial_player_died', 1]])
})

test('synchronous cleanup failure remains visible to every waiter', async () => {
  const shutdown = createShutdownGate(() => { throw new Error('status write failed') })
  await assert.rejects(shutdown('death', 1), /status write failed/)
  await assert.rejects(shutdown.wait(), /status write failed/)
})
