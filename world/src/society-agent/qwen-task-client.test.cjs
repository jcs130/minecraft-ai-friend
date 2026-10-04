'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { QwenTaskClient, extractFinalText } = require('./qwen-task-client.cjs')

function fixture (t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maw-task-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const journalPath = path.join(directory, 'journal.json')
  return { journalPath, options: { baseURL: 'http://127.0.0.1:8088/api', agentId: 'maw-explorer', sessionId: 'maw-life-test', journalPath, pollIntervalMs: 1, taskTimeoutSeconds: 1, pollGraceMs: 1 } }
}

function json (data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }
function message (text, overrides = {}) { return { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text }], ...overrides } }
function completed (text, more = {}) { return { status: 'finished', result: { status: 'completed', session_id: 'maw-life-test', output: [message(text)], ...more } } }

test('persist intent before the only POST, receipt before polling; parse last completed assistant text', async t => {
  const { options, journalPath } = fixture(t)
  const calls = []
  const client = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => {
    calls.push({ url, method: request.method })
    const journal = JSON.parse(fs.readFileSync(journalPath))
    if (request.method === 'POST') {
      assert.equal(journal.runs[0].phase, 'intent')
      assert.equal(journal.runs[0].taskId, null)
      const body = JSON.parse(request.body)
      assert.equal(body.session_id, options.sessionId)
      assert.equal(body.user_id, 'maw-controller')
      assert.equal(body.timeout, 1)
      assert.deepEqual(body.request_context.subagent_allowed_tools, [])
      assert.equal(body.request_context.maw_intent_id, journal.runs[0].intentId)
      assert.equal(body.input[0].content[0].text, 'Choose a real action')
      return json({ task_id: 'task-abcdef123456', timeout: 1 })
    }
    assert.equal(journal.runs[0].taskId, 'task-abcdef123456')
    assert.equal(journal.runs[0].phase, 'submitted')
    return json(completed('', { output: [message('Earlier narration'), message('ignored', { status: 'in_progress' }), message('User input', { role: 'user' }), { type: 'tool_result', content: 'Not an answer' }, message('{"action":"look"}')] }))
  } })
  const result = await client.run('Choose a real action')
  assert.equal(result.status, 'completed')
  assert.equal(result.text, '{"action":"look"}')
  assert.equal(result.resumed, false)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'http://127.0.0.1:8088/api/agents/maw-explorer/console/chat/task')
  assert.equal(JSON.parse(fs.readFileSync(journalPath)).runs[0].text, result.text)
})

test('multiple content text blocks concatenate, nontext blocks remain outside the decision', () => {
  assert.equal(extractFinalText({ status: 'completed', output: [{ ...message(''), content: [{ type: 'text', text: 'one' }, { type: 'image', text: 'ignored' }, { type: 'text', text: 'two' }] }] }), 'one\ntwo')
})

test('empty final message and framework sentinels do not fall back to earlier narration', () => {
  assert.throws(() => extractFinalText({ status: 'completed', output: [message('old'), message(' ')] }), { code: 'EMPTY_FINAL_TEXT' })
  for (const sentinel of ['Max iterations (1) reached', 'Doom loop: agent stuck after 3 consecutive repetitions']) {
    assert.throws(() => extractFinalText({ status: 'completed', output: [message('old'), message(sentinel)] }), { code: 'NATIVE_FRAMEWORK_FAILURE' })
  }
  assert.throws(() => extractFinalText({ status: 'completed', output: [message('好'.repeat(12000))] }), { code: 'FINAL_TEXT_TOO_LARGE' })
})

test('uncertain POST persists a blocking intent; another run never resubmits', async t => {
  const { options } = fixture(t)
  let posts = 0
  const client = new QwenTaskClient({ ...options, fetchImpl: async () => { posts++; throw new Error('connection disappeared after dispatch') } })
  assert.equal((await client.run('one')).status, 'unknown')
  const next = await new QwenTaskClient({ ...options, fetchImpl: async () => { throw new Error('must not call') } }).run('different new prompt')
  assert.equal(next.status, 'unknown')
  assert.equal(next.resumed, true)
  assert.equal(posts, 1)
})

test('invalid accepted receipt and busy session remain uncertain, with no retry', async t => {
  for (const status of [200, 409, 500]) {
    const { options } = fixture(t)
    let posts = 0
    const client = new QwenTaskClient({ ...options, fetchImpl: async () => { posts++; return json({ unexpected: true }, status) } })
    assert.equal((await client.run('one')).status, 'unknown')
    assert.equal((await client.run('two')).status, 'unknown')
    assert.equal(posts, 1)
  }
})

test('known native rejection fails once without automatic retry', async t => {
  const { options } = fixture(t)
  let posts = 0
  const client = new QwenTaskClient({ ...options, fetchImpl: async () => { posts++; return json({ detail: 'not authorized' }, 403) } })
  const result = await client.run('one')
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'SUBMISSION_REJECTED')
  assert.equal(posts, 1)
})

test('lost polling connection resumes the same task read-only after client restart', async t => {
  const { options, journalPath } = fixture(t)
  let posts = 0
  const first = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => {
    if (request.method === 'POST') { posts++; return json({ task_id: 'task-111111111111', timeout: 1 }) }
    throw new Error('temporary query failure')
  } })
  assert.equal((await first.run('one')).status, 'unknown')
  const second = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => {
    assert.equal(request.method, 'GET')
    assert.ok(url.endsWith('/task-111111111111'))
    return json(completed('{"action":"wait"}'))
  } })
  const result = await second.run('new prompt ignored until old task is settled')
  assert.equal(result.status, 'completed')
  assert.equal(result.resumed, true)
  assert.equal(posts, 1)
  assert.equal(JSON.parse(fs.readFileSync(journalPath)).runs.length, 1)
})

test('poll timeout keeps its task ID and late completion can be resumed without POST', async t => {
  const { options } = fixture(t)
  let time = 0
  let queries = 0
  const first = new QwenTaskClient({ ...options, now: () => time, sleep: async ms => { time += ms }, fetchImpl: async (url, request) => {
    if (request.method === 'POST') return json({ task_id: 'task-222222222222', timeout: 1 })
    queries++
    time = 2000
    return json({ status: 'running', started_at: 0 })
  } })
  const result = await first.run('one')
  assert.equal(result.status, 'timeout')
  assert.equal(result.taskId, 'task-222222222222')
  assert.equal(queries, 1)
  const second = new QwenTaskClient({ ...options, now: () => time, fetchImpl: async (url, request) => {
    assert.equal(request.method, 'GET')
    return json(completed('{"action":"look"}'))
  } })
  assert.equal((await second.run('do not send this')).status, 'completed')
})

test('404 after runtime restart never becomes fabricated completion or a new submission', async t => {
  const { options } = fixture(t)
  let posts = 0
  const client = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => {
    if (request.method === 'POST') { posts++; return json({ task_id: 'task-333333333333', timeout: 1 }) }
    return json({ detail: 'Task not found' }, 404)
  } })
  const first = await client.run('one')
  assert.equal(first.status, 'unknown')
  assert.equal(first.error.code, 'NATIVE_TASK_NOT_FOUND')
  assert.equal((await client.run('two')).status, 'unknown')
  assert.equal(posts, 1)
})

test('finished native failure, timeout, and cancel are never game decisions', async t => {
  for (const error of [{ message: 'Task cancelled' }, { code: 'timeout', message: 'Task timed out after 1s' }]) {
    const { options } = fixture(t)
    const client = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => request.method === 'POST'
      ? json({ task_id: 'task-444444444444', timeout: 1 })
      : json({ status: 'finished', result: { status: 'failed', error } }) })
    const result = await client.run('one')
    assert.equal(result.status, 'failed')
    assert.equal(result.text, '')
  }
})

test('mismatched session or unknown native status blocks subsequent submissions', async t => {
  for (const data of [completed('other account', { session_id: 'somebody-else' }), { status: 'unexpected' }]) {
    const { options } = fixture(t)
    let posts = 0
    const client = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => {
      if (request.method === 'POST') { posts++; return json({ task_id: 'task-555555555555', timeout: 1 }) }
      return json(data)
    } })
    assert.equal((await client.run('one')).status, 'unknown')
    assert.equal((await client.run('two')).status, 'unknown')
    assert.equal(posts, 1)
  }
})

test('journal identity mismatch prevents network access', async t => {
  const { options } = fixture(t)
  const first = new QwenTaskClient({ ...options, fetchImpl: async () => { throw new Error('uncertain') } })
  await first.run('one')
  const second = new QwenTaskClient({ ...options, agentId: 'another-role', fetchImpl: async () => { throw new Error('must not call') } })
  await assert.rejects(second.run('two'), { code: 'JOURNAL_IDENTITY_MISMATCH' })
})

test('exclusive journal prevents simultaneous controller submissions', async t => {
  const { options } = fixture(t)
  let unblock
  const gate = new Promise(resolve => { unblock = resolve })
  const first = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => {
    if (request.method === 'POST') { await gate; return json({ task_id: 'task-666666666666', timeout: 1 }) }
    return json(completed('done'))
  } })
  const run = first.run('one')
  const second = new QwenTaskClient({ ...options, fetchImpl: async () => { throw new Error('must not call') } })
  await assert.rejects(second.run('two'), { code: 'JOURNAL_LOCKED' })
  await assert.rejects(first.run('three'), { code: 'CLIENT_BUSY' })
  unblock()
  assert.equal((await run).status, 'completed')
})

test('completed native task permits a distinct next decision in the same life session', async t => {
  const { options, journalPath } = fixture(t)
  let posts = 0
  const client = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => {
    if (request.method === 'POST') { posts++; return json({ task_id: `task-${String(posts).padStart(12, '0')}`, timeout: 1 }) }
    return json(completed('{"action":"look"}'))
  } })
  assert.equal((await client.run('first observation')).status, 'completed')
  assert.equal((await client.run('next observation')).status, 'completed')
  assert.equal(posts, 2)
  const journal = JSON.parse(fs.readFileSync(journalPath))
  assert.equal(journal.runs.length, 2)
  assert.notEqual(journal.runs[0].intentId, journal.runs[1].intentId)
  assert.notEqual(journal.runs[0].promptSha256, journal.runs[1].promptSha256)
})

test('status is read-only and excludes prompt, text, identity transport and provider error details', async t => {
  const { options, journalPath } = fixture(t)
  const client = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => request.method === 'POST'
    ? json({ task_id: 'task-777777777777', timeout: 1 })
    : json({ status: 'finished', result: { status: 'failed', error: { message: 'secret provider URL or credential' } } }) })
  assert.equal(client.status().status, 'idle')
  assert.equal(fs.existsSync(journalPath), false)
  await client.run('private model prompt')
  const safe = client.status()
  assert.equal(safe.status, 'failed')
  assert.equal(safe.taskId, 'task-777777777777')
  assert.equal(safe.runCount, 1)
  assert.ok(!JSON.stringify(safe).includes('private model prompt'))
  assert.ok(!JSON.stringify(safe).includes('secret provider'))
  assert.ok(!JSON.stringify(safe).includes('baseURL'))
  assert.ok(!JSON.stringify(safe).includes('promptSha256'))
  assert.ok(!JSON.stringify(fs.readFileSync(journalPath, 'utf8')).includes('secret provider'))
})

test('journal with missing submitted deadline cannot poll forever or submit again', async t => {
  const { options, journalPath } = fixture(t)
  const client = new QwenTaskClient({ ...options, fetchImpl: async (url, request) => request.method === 'POST'
    ? json({ task_id: 'task-888888888888', timeout: 1 })
    : json({ detail: 'gone' }, 404) })
  await client.run('one')
  const journal = JSON.parse(fs.readFileSync(journalPath))
  delete journal.runs[0].pollDeadlineAt
  fs.writeFileSync(journalPath, JSON.stringify(journal))
  const other = new QwenTaskClient({ ...options, fetchImpl: async () => { throw new Error('must not call') } })
  await assert.rejects(other.run('two'), { code: 'INVALID_JOURNAL' })
})

test('oversized or malformed native responses leave an uncertain submission, never retry', async t => {
  for (const body of ['x'.repeat(2 * 1024 * 1024 + 1), 'not json']) {
    const { options } = fixture(t)
    let posts = 0
    const client = new QwenTaskClient({ ...options, fetchImpl: async () => { posts++; return new Response(body, { status: 200 }) } })
    assert.equal((await client.run('one')).status, 'unknown')
    assert.equal((await client.run('two')).status, 'unknown')
    assert.equal(posts, 1)
  }
})
