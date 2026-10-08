const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { CodingPlanBridge } = require('./codingplan-bridge.cjs')
const config = () => ({ journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'maw-neko-model-')), 'calls.jsonl'), apiKey: 'unit-test-only', maxCalls: 1, minIntervalMs: 0 })

test('a reviewed construction budget remains bounded and preserves earlier calls', () => {
  const cfg = config()
  fs.writeFileSync(cfg.journalPath, JSON.stringify({ kind: 'intent', requestId: 'previous' }) + '\n' +
    JSON.stringify({ kind: 'result', requestId: 'previous', ok: true }) + '\n')
  assert.equal(new CodingPlanBridge({ ...cfg, maxCalls: 256 }).status().calls, 1)
  assert.equal(new CodingPlanBridge({ ...cfg, maxCalls: 576 }).status().calls, 1)
  assert.throws(() => new CodingPlanBridge({ ...cfg, maxCalls: 1025 }), /CONFIG_INVALID/)
})
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

test('memory and foreground inference are serialized without duplicate POSTs', async () => {
  let active = 0, maximum = 0, posts = 0
  const bridge = new CodingPlanBridge({ ...config(), maxCalls: 2, fetchImpl: async () => {
    maximum = Math.max(maximum, ++active); posts++
    await new Promise(resolve => setTimeout(resolve, 10)); active--
    return new Response(JSON.stringify({ model: 'qwen3.7-plus', choices: [{ finish_reason: 'stop', message: { content: 'observed facts' } }] }))
  } })
  assert.deepEqual(await Promise.all([bridge.request([], 'memory'), bridge.request([], 'foreground')]), ['observed facts', 'observed facts'])
  assert.equal(maximum, 1); assert.equal(posts, 2); assert.equal(bridge.status().inFlight, false)
})

test('closing prevents queued unsent inference while retaining the active result', async () => {
  let finish, posts = 0
  const bridge = new CodingPlanBridge({ ...config(), maxCalls: 2, fetchImpl: async () => {
    posts++; await new Promise(resolve => { finish = resolve })
    return new Response(JSON.stringify({ model: 'qwen3.7-plus', choices: [{ finish_reason: 'stop', message: { content: 'completed' } }] }))
  } })
  const first = bridge.request([], 'first'), second = bridge.request([], 'second')
  const rejected = assert.rejects(second, /CONNECTION_CLOSED/)
  while (!finish) await new Promise(resolve => setImmediate(resolve))
  bridge.close(); finish(); assert.equal(await first, 'completed'); await rejected
  assert.equal(posts, 1); assert.equal(bridge.status().calls, 1)
})
test('429 preserves specific reason, halts and does not invent a quota limit', async () => {
  const cfg = config(); let posts = 0
  const bridge = new CodingPlanBridge({ ...cfg, fetchImpl: async () => { posts++; return new Response(JSON.stringify({ error: { code: 'throttling', message: 'concurrency allocated quota exceeded' } }), { status: 429 }) } })
  await assert.rejects(bridge.request([], 'test'), /RESPONSE_REJECTED/)
  await assert.rejects(bridge.request([], 'test'), /RECONCILIATION/)
  const result = fs.readFileSync(cfg.journalPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse).find(x => x.kind === 'result')
  assert.equal(result.error.reasonCode, 'rate_limit_concurrency'); assert.equal(posts, 1)
})
