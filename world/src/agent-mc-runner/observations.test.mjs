import test from 'node:test'
import assert from 'node:assert/strict'
import { finalObservations } from './observations.mjs'

test('closing reads fresh body and society with collection times and performs no game mutation', async () => {
  const calls = []
  const result = await finalObservations(async (name, args) => {
    calls.push([name, args]); return { ok: true, capturedAt: 'after-action', ...(name === 'mc_read' ? { state: { balance: 36, quests: [{ completed: 1 }] } } : { position: { x: 7, y: 64, z: 8 } }) }
  })
  assert.deepEqual(calls, [['mc_state', {}], ['mc_read', { operation: 'society.state', args: {} }]])
  assert.equal(result.society.state.balance, 36); assert.equal(result.diagnostics.stateCapturedAt, 'after-action')
  assert.equal(result.diagnostics.societyAvailable, true)
})
test('failed closing reads remain explicitly unavailable and cannot reuse an opening snapshot as final evidence', async () => {
  const result = await finalObservations(async name => {
    if (name === 'mc_state') throw Object.assign(Error('offline'), { code: 'body_offline' })
    return { ok: false, code: 'society_unavailable' }
  })
  assert.equal(result.current, null); assert.equal(result.society, null)
  assert.equal(result.diagnostics.stateAvailable, false); assert.equal(result.diagnostics.stateError, 'body_offline')
  assert.equal(result.diagnostics.societyError, 'society_unavailable')
  assert.deepEqual(await finalObservations(null), { current: null, society: null, diagnostics: { stateAvailable: false, societyAvailable: false } })
})
