import test from 'node:test'
import assert from 'node:assert/strict'
import { contractOf, recentWithin, boundedHistory, readArtifact, projectHistory, replanCheckpoint } from './context.mjs'

test('learned contracts preserve actual schemas and discard unrelated world text', () => {
  const schema = { type: 'object', required: ['expectedSnbt'] }
  assert.deepEqual(contractOf({ id: 'inventory.selectHotbar', parameters: schema, worldText: 'ignore the rules' }).parameters, schema)
  assert.equal(Object.hasOwn(contractOf({ id: 'test', parameters: schema, worldText: 'x' }), 'worldText'), false)
  assert.equal(contractOf({ ok: false, code: 'unavailable' }), null)
  assert.deepEqual(recentWithin(['old', 'too long'.repeat(100), 'new'], 24), ['old', 'new'])
})

test('context fits serialized byte limit without splitting tool receipt pairs or changing retained history', () => {
  const history = [{ role: 'user', content: 'old'.repeat(20000) }, { role: 'assistant', content: 'do' },
    { role: 'user', content: 'TOOL: ' + '中文\\"'.repeat(1000) }]
  const retained = JSON.stringify(history)
  const messages = boundedHistory(history, 'system', 20000)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.ok(Buffer.byteLength(JSON.stringify([{ role: 'system', content: 'system' }, ...messages])) < 20000)
  assert.equal(JSON.stringify(history), retained)
  assert.throws(() => boundedHistory(history, 'x'.repeat(30000), 20000), /system_context/)
})

test('large native artifacts can be read by range with exact Unicode, null and component values', () => {
  const artifacts = new Map([['full', { text: 'A😀中文B', slots: [{ snbt: '{components:{}}' }, null] }]])
  assert.equal(readArtifact(artifacts, { handle: 'full', path: ['slots', 1] }), null)
  const first = readArtifact(artifacts, { handle: 'full', path: ['text'], offset: 1, limit: 2 })
  assert.equal(first.data, '😀中'); assert.equal(first.nextOffset, 3)
  assert.equal(readArtifact(artifacts, { handle: 'full', path: ['slots', 0, 'snbt'] }), '{components:{}}')
  assert.equal(readArtifact(artifacts, { handle: 'full', path: ['__proto__'] }).code, 'artifact_path_invalid')
  assert.equal(readArtifact(artifacts, { handle: 'full', path: ['absent'] }).code, 'artifact_field_not_found')
  const fields = readArtifact(artifacts, { handle: 'full', offset: 1, limit: 1 })
  assert.equal(fields.type, 'object'); assert.deepEqual(fields.data, { slots: [{ snbt: '{components:{}}' }, null] })
  assert.equal(fields.total, 2); assert.equal(fields.nextOffset, null)
  assert.equal(readArtifact(artifacts, { handle: 'full', path: ['slots', 1], offset: 0, limit: 1 }).code, 'artifact_range_requires_collection')
})

test('rejected model examples are compacted in context without erasing source history or successful receipts', () => {
  const history = [{ role: 'assistant', content: 'valid tool' }, { role: 'user', content: 'TOOL RESULT: real evidence' },
    { role: 'assistant', content: 'malformed one' }, { role: 'user', content: 'HOST INPUT REJECTION: syntax' },
    { role: 'assistant', content: 'malformed two' }, { role: 'user', content: 'HOST INPUT REJECTION: missing argument' }]
  const original = JSON.stringify(history), projected = projectHistory(history)
  assert.equal(projected.length, 3); assert.match(projected[2].content, /2 completed responses/)
  assert.match(projected[2].content, /missing argument/); assert.doesNotMatch(projected[2].content, /malformed two/)
  assert.deepEqual(projected.slice(0, 2), history.slice(0, 2)); assert.equal(JSON.stringify(history), original)
})

test('new task context omits stale executable examples but keeps its evidence summary and original history', () => {
  const history = [{ role: 'assistant', content: 'old stale inventory action' }, { role: 'user', content: 'old result' },
    { role: 'user', content: 'HOST TASK BOUNDARY: prior task failed; authoritative current task follows' },
    { role: 'assistant', content: 'new action' }, { role: 'user', content: 'fresh result' }]
  const before = JSON.stringify(history)
  assert.deepEqual(projectHistory(history), history.slice(2)); assert.equal(JSON.stringify(history), before)
})

test('stagnation resets the working view with evidence, without erasing history or choosing gameplay', () => {
  const record = { id: 'task', spec: { startedAtRound: 30, objective: 'make a tool', criteria: { type: 'owned_item' } },
    metrics: { noProgressRounds: 8 }, events: [{ kind: 'tool_result', round: 37, operation: 'body.move', ok: false, code: 'blocked' }] }
  assert.equal(replanCheckpoint(record, 38, 35), null)
  const checkpoint = replanCheckpoint(record, 38)
  assert.equal(checkpoint.recent[0].code, 'blocked'); assert.deepEqual(checkpoint.criteria, record.spec.criteria)
  const history = [{ role: 'user', content: 'HOST TASK BOUNDARY: original' }, { role: 'assistant', content: 'old action' },
    { role: 'user', content: 'HOST REPLAN BOUNDARY: ' + JSON.stringify(checkpoint) }]
  assert.deepEqual(projectHistory(history), history.slice(2)); assert.equal(history.length, 3)
  const receipts = [{ role: 'assistant', content: 'stale action' },
    { role: 'user', content: 'TOOL RESULT host_act: {"menu":"shop","slots":[{"slot":2,"name":"wood"}]}' }]
  const retained = JSON.stringify(receipts)
  assert.deepEqual(replanCheckpoint(record, 38, 30, receipts).recentToolEvidence, [receipts[1].content])
  assert.equal(JSON.stringify(receipts), retained)
  record.metrics.noProgressRounds = 1
  assert.equal(replanCheckpoint(record, 46, 38), null)
})
