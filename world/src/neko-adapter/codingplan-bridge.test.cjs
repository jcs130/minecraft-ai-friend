const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { CodingPlanBridge } = require('./codingplan-bridge.cjs')
const config = () => ({ journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'maw-neko-model-')), 'calls.jsonl'), apiKey: 'unit-test-only', maxCalls: 1, minIntervalMs: 0 })

test('offline reviewed discarded model text preserves the unknown request and cumulative usage', async () => {
  const cfg = config(), hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex')
  const intent = { at: '2026-10-09T00:00:00Z', kind: 'intent', requestId: 'old-memory', model: 'qwen3.7-plus' }
  const evidencePath = path.join(path.dirname(cfg.journalPath), 'operator-evidence.json')
  const bytes = JSON.stringify({ requestId: intent.requestId, processExited: true, gameCommandsAfterIntent: 0, scope: 'model_text_discarded_never_executed' })
  fs.writeFileSync(evidencePath, bytes)
  const audit = { kind: 'operator_audit', requestId: intent.requestId, disposition: 'discard_unreturned_response_allow_new_requests',
    originalRecordSha256: hash(JSON.stringify(intent)), evidencePath, evidenceSha256: hash(bytes) }
  fs.writeFileSync(cfg.journalPath, JSON.stringify(intent) + '\n')
  assert.equal(new CodingPlanBridge(cfg).status().blocked, true)
  fs.appendFileSync(cfg.journalPath, JSON.stringify(audit) + '\n')
  let posts = 0
  const bridge = new CodingPlanBridge({ ...cfg, maxCalls: 2, fetchImpl: async () => { posts++; return new Response(JSON.stringify({ model: 'qwen3.7-plus', choices: [{ finish_reason: 'stop', message: { content: 'fresh observation' } }] })) } })
  assert.equal(bridge.status().calls, 1)
  assert.equal(await bridge.request([], 'new task from current observations'), 'fresh observation')
  assert.equal(bridge.status().calls, 2); assert.equal(posts, 1)
  const rows = fs.readFileSync(cfg.journalPath, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(rows.filter(row => row.kind === 'result' && row.requestId === intent.requestId).length, 0)
  assert.deepEqual(rows[0], intent)
  fs.writeFileSync(evidencePath, '{}')
  assert.throws(() => new CodingPlanBridge(cfg), /AUDIT_EVIDENCE_INVALID/)
})

test('a reviewed transport timeout can only permit new requests with its original halt hash', () => {
  const { reviewedDiscardedResponses } = require('./codingplan-bridge.cjs')
  const cfg = config(), hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex')
  const intent = { kind: 'intent', requestId: 'timeout' }, halt = { kind: 'halt', requestId: 'timeout', code: 'MODEL_TRANSPORT_UNKNOWN' }
  const evidencePath = path.join(path.dirname(cfg.journalPath), 'timeout-evidence.json')
  const bytes = JSON.stringify({ requestId: 'timeout', processExited: true, gameCommandsAfterIntent: 0, scope: 'model_text_discarded_never_executed' })
  fs.writeFileSync(evidencePath, bytes)
  const audit = { kind: 'operator_audit', requestId: 'timeout', disposition: 'discard_unreturned_response_allow_new_requests',
    originalRecordSha256: hash(JSON.stringify(intent)), originalHaltSha256: hash(JSON.stringify(halt)), evidencePath, evidenceSha256: hash(bytes) }
  assert.equal(reviewedDiscardedResponses([intent, halt, audit]).has('timeout'), true)
  assert.throws(() => reviewedDiscardedResponses([intent, { ...halt, code: 'MODEL_RESPONSE_REJECTED' }, audit]), /AUDIT_INVALID/)
  assert.throws(() => reviewedDiscardedResponses([intent, halt, { ...audit, originalHaltSha256: 'wrong' }]), /AUDIT_INVALID/)
  fs.writeFileSync(cfg.journalPath, [intent, halt, audit].map(JSON.stringify).join('\n') + '\n')
  assert.equal(new CodingPlanBridge(cfg).status().blocked, false)
  assert.equal(new CodingPlanBridge(cfg).status().calls, 1)
})

test('a reviewed construction budget remains bounded and preserves earlier calls', () => {
  const cfg = config()
  fs.writeFileSync(cfg.journalPath, JSON.stringify({ kind: 'intent', requestId: 'previous' }) + '\n' +
    JSON.stringify({ kind: 'result', requestId: 'previous', ok: true }) + '\n')
  assert.equal(new CodingPlanBridge({ ...cfg, maxCalls: 256 }).status().calls, 1)
  assert.equal(new CodingPlanBridge({ ...cfg, maxCalls: 576 }).status().calls, 1)
  assert.equal(new CodingPlanBridge({ ...cfg, maxCalls: 1280 }).status().calls, 1)
  assert.throws(() => new CodingPlanBridge({ ...cfg, maxCalls: 1281 }), /CONFIG_INVALID/)
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
