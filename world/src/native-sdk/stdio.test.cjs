'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { dispatch } = require('./stdio.cjs')
test('private JSONL methods keep RPC IDs separate from action IDs and preserve async calls', async () => {
  const calls = [], sdk = { submit: value => { calls.push(value); return { accepted: true } },
    wait: async (id, options) => ({ id, options, status: 'running' }), actionStatus: id => ({ id, status: 'unknown' }) }
  assert.deepEqual(await dispatch(sdk, { request_id: 'rpc1', method: 'submit', action_id: 'turn1', operation: 'curios.open', args: {} }), { accepted: true })
  assert.deepEqual(calls, [{ action_id: 'turn1', operation: 'curios.open', args: {} }])
  assert.deepEqual(await dispatch(sdk, { request_id: 'rpc2', method: 'result', action_id: 'turn1' }), { id: 'turn1', status: 'unknown' })
  assert.equal((await dispatch(sdk, { request_id: 'rpc3', method: 'wait', action_id: 'turn1', timeoutMs: 100 })).options.timeoutMs, 100)
})
test('private JSONL rejects missing request IDs and unsupported methods without dispatch', async () => {
  await assert.rejects(dispatch({}, { method: 'snapshot' }), /REQUEST_INVALID/)
  await assert.rejects(dispatch({}, { request_id: 'rpc1', method: 'eval' }), /METHOD_UNSUPPORTED/)
})
