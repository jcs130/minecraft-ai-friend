const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { CodingPlanBridge } = require('./codingplan-bridge.cjs')
const config = () => ({ journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'maw-neko-model-')), 'calls.jsonl'), apiKey: 'unit-test-only', maxCalls: 1, minIntervalMs: 0 })
test('direct model identity, usage and budget persist without retry', async () => {
  const cfg = config(); let posts = 0
  const bridge = new CodingPlanBridge({ ...cfg, fetchImpl: async (url, options) => {
    posts++; assert.equal(url, 'https://coding.dashscope.aliyuncs.com/v1/chat/completions')
    assert.equal(JSON.parse(options.body).model, 'qwen3.7-plus')
    return new Response(JSON.stringify({ model: 'qwen3.7-plus', id: 'test-response', usage: { total_tokens: 12 }, choices: [{ finish_reason: 'stop', message: { content: '!stats()' } }] }))
  } })
  assert.equal(await bridge.request([], 'test'), '!stats()')
  await assert.rejects(bridge.request([], 'test'), /BUDGET/)
  await assert.rejects(new CodingPlanBridge(cfg).request([], 'test'), /BUDGET/)
  assert.equal(posts, 1); assert.equal(bridge.status().calls, 1)
})
test('uncertain transport survives process recreation and cannot replay', async () => {
  const cfg = config(); let posts = 0
  const bridge = new CodingPlanBridge({ ...cfg, fetchImpl: async () => { posts++; throw Error('timeout') } })
  await assert.rejects(bridge.request([], 'test'), /TRANSPORT_UNKNOWN/)
  await assert.rejects(new CodingPlanBridge(cfg).request([], 'test'), /RECONCILIATION/)
  assert.equal(posts, 1)
})
test('429 preserves specific reason, halts and does not invent a quota limit', async () => {
  const cfg = config(); let posts = 0
  const bridge = new CodingPlanBridge({ ...cfg, fetchImpl: async () => { posts++; return new Response(JSON.stringify({ error: { code: 'throttling', message: 'concurrency allocated quota exceeded' } }), { status: 429 }) } })
  await assert.rejects(bridge.request([], 'test'), /RESPONSE_REJECTED/)
  await assert.rejects(bridge.request([], 'test'), /RECONCILIATION/)
  const result = fs.readFileSync(cfg.journalPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse).find(x => x.kind === 'result')
  assert.equal(result.error.reasonCode, 'rate_limit_concurrency'); assert.equal(posts, 1)
})
