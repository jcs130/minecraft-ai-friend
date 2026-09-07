import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const world = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { build } = createRequire(join(world, 'package.json'))('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'qiandeng-provider-test-'))
after(() => {
  const target = realpathSync(temp), root = realpathSync(tmpdir())
  assert.ok(relative(root, target).startsWith('qiandeng-provider-test-'))
  rmSync(target, { recursive: true, force: true })
})
const modulePath = join(temp, 'provider.mjs')
await build({ stdin: { contents: `
  export * from './providers/qwenpaw-provider.ts';
  export * from './providers/world-model-provider.ts';
  export * from './providers/provider-info.ts';
  export { qwenpawHeaders } from './qwenpaw-auth.ts';
`, resolveDir: join(world, 'src'), loader: 'ts' }, outfile: modulePath,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { createQwenpawProvider, createWorldModelProvider, describeModelProvider,
  DEFAULT_MODEL_PROVIDER_INFO, parseQwenpawSse, extractQwenpawTaskText, qwenpawHeaders } = await import(pathToFileURL(modulePath).href)

const URL = 'http://qwenpaw.fixture.invalid/api/console/chat'
const request = { roleId: 'mc-herald', userId: 'QAUser', sessionId: 'mc:QAUser', prompt: '夹具请求，保持原文',
  images: ['data:image/png;base64,Zml4dHVyZQ=='], timeoutMs: 300_000 }
const frame = event => `data: ${JSON.stringify(event)}\n\n`
const answer = text => frame({ object: 'message', type: 'message', id: 'answer' }) +
  frame({ object: 'content', msg_id: 'answer', delta: false, data: { text } })
const json = body => new Response(JSON.stringify(body), { status: 200 })
function harness(replies, extra = {}) {
  const calls = [], timeouts = [], sleeps = []
  let clock = 100
  const options = { headers: roleId => qwenpawHeaders(roleId, { QWENPAW_CONSOLE_TOKEN: 'fixture.signature' }),
    fetch: async (url, init) => {
      calls.push({ url: String(url), ...init, body: init.body ? JSON.parse(init.body) : undefined })
      const reply = typeof replies === 'function' ? replies(calls.length) : replies.shift()
      if (reply instanceof Error) throw reply
      assert.ok(reply, 'fixture ran out of responses; unexpected request/retry')
      return reply
    },
    timeoutSignal: ms => { timeouts.push(ms); return new AbortController().signal },
    now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms },
    ...extra,
  }
  return { provider: createQwenpawProvider(URL, options), calls, timeouts, sleeps }
}

test('QwenPaw request/auth/image order and all existing chat timeouts stay compatible', async () => {
  for (const timeoutMs of [300_000, 180_000, 120_000]) {
    const h = harness([new Response(answer('连接夹具成功'))])
    assert.deepEqual(await h.provider.chat({ ...request, timeoutMs }), { text: '连接夹具成功' })
    assert.equal(h.calls[0].url, URL)
    assert.equal(h.calls[0].method, 'POST')
    assert.deepEqual(h.calls[0].headers, { 'Content-Type': 'application/json', 'X-Agent-Id': 'mc-herald', Authorization: 'Bearer fixture.signature' })
    assert.deepEqual(h.calls[0].body, { channel: 'console', user_id: 'QAUser', session_id: 'mc:QAUser',
      input: [{ role: 'user', content: [{ type: 'image', image_url: request.images[0] }, { type: 'text', text: request.prompt }] }] })
    assert.deepEqual(h.timeouts, [timeoutMs])
  }
})

test('SSE chooses the last formal message, delta before full, and preserves usage', () => {
  const usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }
  const stream = answer('旧回答') +
    frame({ object: 'message', type: 'reasoning', id: 'reason' }) + frame({ object: 'content', msg_id: 'reason', text: '不展示思考' }) +
    frame({ object: 'message', type: 'message', id: 'final' }) +
    frame({ object: 'content', msg_id: 'final', data: { text: '增量' } }) + frame({ object: 'content', msg_id: 'final', text: '回答' }) +
    frame({ object: 'content', msg_id: 'final', delta: false, text: '全文兜底' }) +
    frame({ object: 'message', type: 'plugin_call', id: 'tool' }) + frame({ object: 'content', msg_id: 'tool', text: '不展示工具参数' }) +
    'data: broken-json\n\ndata: [DONE]\n\n' + frame({ type: 'turn_usage', usage })
  assert.deepEqual(parseQwenpawSse(stream), { text: '增量回答', usage })
  assert.deepEqual(parseQwenpawSse(answer('仅全文')), { text: '仅全文' })
  assert.deepEqual(parseQwenpawSse(frame({ object: 'content', msg_id: 'orphan', text: '未归属' })), { text: '' })
})

test('buffered SSE survives UTF-8 network chunk boundaries without returning partial text', async () => {
  const bytes = new TextEncoder().encode(answer('中文分片'))
  const stream = new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
    controller.close()
  } })
  const h = harness([new Response(stream)])
  assert.equal((await h.provider.chat(request)).text, '中文分片')
})

test('legacy disabled callers retain bare headers and omit HTTP error bodies', async () => {
  const h = harness([new Response('fixture detail', { status: 403 })],
    { headers: undefined, legacyHeaders: true, includeChatErrorBody: false })
  await assert.rejects(h.provider.chat({ ...request, roleId: 'mc-god' }), /^Error: goddess API 403$/)
  assert.deepEqual(h.calls[0].headers, { 'Content-Type': 'application/json', 'X-Agent-Id': 'mc-god' })
  assert.equal(h.calls.length, 1)
  const detailed = harness([new Response('x'.repeat(250), { status: 503 })])
  await assert.rejects(detailed.provider.chat(request), error => error.message === 'goddess API 503: ' + 'x'.repeat(200))
})

test('task submission, polling, timeout payload and final output keep the existing contract', async () => {
  const h = harness([json({ task_id: 'task-fixture' }), json({ status: 'pending' }), json({ status: 'running' }),
    json({ status: 'finished', result: { output: [{ content: [{ type: 'text', text: '旧任务消息' }] },
      { content: [{ type: 'text', text: ' 完成' }, { type: 'image', image_url: 'not-text' }, { type: 'text', text: '回执 ' }] }] } })])
  assert.deepEqual(await h.provider.task(request), { text: '完成\n回执' })
  assert.equal(h.calls[0].url, URL + '/task')
  assert.equal(h.calls[0].body.timeout, 570_000)
  assert.equal(h.calls[0].body.session_id, request.sessionId)
  assert.equal(h.calls[0].body.input[0].content[0].image_url, request.images[0])
  assert.ok(h.calls.slice(1).every(call => call.url === URL + '/task/task-fixture' && !call.body && !call.method))
  assert.ok(h.calls.every(call => call.headers === h.calls[0].headers))
  assert.deepEqual(h.timeouts, [30_000, 15_000, 15_000, 15_000])
  assert.deepEqual(h.sleeps, [5_000, 5_000, 5_000])
})

test('failed/cancelled/unknown task states stop immediately without resubmission or fallback', async () => {
  for (const status of ['failed', 'cancelled', 'canceled', 'error', 'unexpected']) {
    const h = harness([json({ task_id: 'id' }), json({ status, result: { reason: 'fixture' } })])
    await assert.rejects(h.provider.task(request), new RegExp(`goddess task .*${status}`))
    assert.equal(h.calls.length, 2)
    assert.deepEqual(h.sleeps, [5_000])
  }
})

test('missing task ID, empty final answer and HTTP failures remain errors', async () => {
  for (const [replies, pattern] of [
    [[json({})], /no task_id/],
    [[json({ task_id: 'id' }), json({ status: 'finished', result: { output: [] } })], /finished without text/],
    [[new Response('submit detail', { status: 500 })], /task submit 500: submit detail/],
    [[json({ task_id: 'id' }), new Response('', { status: 404 })], /task status 404/],
  ]) await assert.rejects(harness(replies).provider.task(request), pattern)
  assert.equal(extractQwenpawTaskText(null), '')
})

test('task local deadline is 590 seconds and does not submit a second task', async () => {
  const h = harness(count => count === 1 ? json({ task_id: 'id' }) : json({ status: 'queued' }))
  await assert.rejects(h.provider.task(request), /goddess task timed out/)
  assert.equal(h.sleeps.reduce((sum, ms) => sum + ms, 0), 590_000)
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1)
})

test('transport abort and incomplete response errors propagate without automatic retries', async () => {
  for (const task of [false, true]) {
    const failure = new Error('fixture incomplete stream')
    const h = harness([failure])
    await assert.rejects(task ? h.provider.task(request) : h.provider.chat(request), error => error === failure)
    assert.equal(h.calls.length, 1)
  }
})

test('injected replacement wins, needs no QwenPaw HTTP, and public metadata reflects the instance', async () => {
  const received = []
  const replacement = { info: { id: 'fixture-conversations', label: 'Fixture conversations',
    capabilities: { chat: true, task: false, privateCapability: 'not-public' }, endpoint: 'not-public', credential: 'not-public' },
    async chat(input) { received.push(input); return { text: '替换实现回执', usage: { total_tokens: 2 } } } }
  const provider = createWorldModelProvider({ qwenpawUrl: URL, provider: replacement,
    qwenpaw: { fetch: () => assert.fail('replacement must not invoke QwenPaw'), headers: () => assert.fail('must not read QwenPaw credentials') } })
  assert.equal(provider, replacement)
  assert.deepEqual(await provider.chat(request), { text: '替换实现回执', usage: { total_tokens: 2 } })
  assert.equal(received[0], request)
  const info = describeModelProvider(provider)
  assert.deepEqual(info, { id: 'fixture-conversations', label: 'Fixture conversations', capabilities: { chat: true, task: false } })
  info.capabilities.chat = false
  assert.equal(provider.info.capabilities.chat, true)
  const defaultProvider = createWorldModelProvider({ qwenpawUrl: URL })
  assert.deepEqual(describeModelProvider(defaultProvider), DEFAULT_MODEL_PROVIDER_INFO)
})

test('all three production consumers still bundle with the shared provider adapter', async () => {
  const result = await build({ absWorkingDir: world, entryPoints: ['src/mc-god.ts', 'src/mc-saga.ts', 'src/mc-evolve-review.ts'],
    outdir: join(temp, 'consumer-bundles'), write: false, bundle: true, platform: 'node', format: 'esm',
    packages: 'external', metafile: true, logLevel: 'silent' })
  assert.equal(result.outputFiles.length, 3)
  for (const output of Object.values(result.metafile.outputs)) {
    assert.ok(Object.keys(output.inputs).some(path => path.endsWith('providers/world-model-provider.ts')))
  }
})
