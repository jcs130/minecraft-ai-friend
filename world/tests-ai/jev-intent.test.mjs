import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createJevIntent, decideIntent, intentQuestions, intentSkills, readChoice, publicFallback, parseSpokenIntent } from '../src/application/jev-intent.ts'

const atoms = [
  { id: 'fire', name: '火球术', words: ['火球'], catalog: { status: 'featured', nativeSpell: 'irons_spellbooks:fireball' } },
  { id: 'flower', name: '烟花术', words: ['烟花'], catalog: { status: 'featured' } },
  { id: 'tp', name: '传送', words: ['瞬移'], params: { distance: { type: 'number', default: 10 } }, catalog: { status: 'featured' } },
  { id: 'old', name: '旧法术', words: ['旧法术'], catalog: { status: 'archived' } },
  { id: 'passive', name: '被动', words: ['被动'], type: 'passive', catalog: { status: 'featured' } },
]
const input = (text, channel = 'private') => ({ actor: 'Player', text, channel })
const choice = (keys, selected, confidence = .95) => ({ type: 'choice', choice: selected, confidence,
  probabilities: Object.fromEntries(Object.keys(keys).map(k => [k, k === selected ? 1 : 0])) })
const answers = (route = 'cast', skill = 'fire', channel = 'private') => {
  const q = intentQuestions(channel, intentSkills(atoms))
  return { route: choice(q.route.criteria, route), ...(q.spell ? { spell: choice(q.spell.criteria, skill) } : {}) }
}

test('exact whole skill and command protocols bypass inference, mentions do not', () => {
  assert.equal(parseSpokenIntent('火球', atoms).kind, 'command')
  assert.equal(parseSpokenIntent('女神，火球怎么用？', atoms).kind, 'conversation')
  assert.deepEqual(intentSkills(atoms).map(a => a.id), ['fire', 'flower'])
  assert.deepEqual(decideIntent(input('发一颗火球攻击前面'), atoms, answers()), { route: 'cast', skill: 'fire' })
})
test('negated, quoted, hypothetical and question speech cannot cast even with malicious confident answers', () => {
  for (const text of ['别用火球', '我不想用火球', '火球怎么用', '如果放火球会怎样', '他说“火球”', '火球？', 'not fireball']) {
    assert.notEqual(decideIntent(input(text), atoms, answers()).route, 'cast', text)
  }
  assert.notEqual(decideIntent(input('用火球', 'public'), atoms, answers()).route, 'cast')
  const bad = answers(); bad.spell.choice = 'old'; assert.equal(decideIntent(input('用旧法术'), atoms, bad).route, 'uncertain')
})
test('invalid types, unknown choices, missing probabilities and confidence fail closed', () => {
  const q = { a: '', b: '' }, valid = choice(q, 'a')
  for (const bad of [{}, { ...valid, type: 'score' }, { ...valid, choice: 'x' }, { ...valid, confidence: NaN },
    { ...valid, confidence: 1.1 }, { ...valid, probabilities: { a: .2, b: .8 } },
    { ...valid, probabilities: { a: .8 } }, { ...valid, probabilities: { a: .8, b: .8 } }]) assert.equal(readChoice(bad, q), null)
  const low = answers(); low.spell.confidence = .84
  assert.equal(decideIntent(input('发一个火球'), atoms, low).route, 'uncertain')
})
test('public fallback distinguishes being addressed from being mentioned', () => {
  assert.equal(publicFallback('女神，桐人在哪？', ['桐人'], true), true)
  assert.equal(publicFallback('桐人，你觉得女神的法术怎么样？', ['桐人'], true), false)
  assert.equal(publicFallback('我们去挖矿吧', ['桐人'], false), false)
})

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-intent-'))
const keyFile = path.join(tmp, 'key'); fs.writeFileSync(keyFile, 'test-key-not-a-real-secret')
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
test('official request is bounded typed multiple choice; metrics contain no text or key', async () => {
  let calls = 0
  const client = createJevIntent({ keyFile, fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(options.redirect, 'error')
    const body = JSON.parse(options.body); assert.equal(body.model, 'jev-latest')
    assert.equal(body.questions.route.type, 'choice'); assert.ok(body.questions.spell.criteria.fire)
    return Response.json({ model: 'jev-test', answers: answers() })
  } })
  assert.equal((await client.classify(input('发一个火球'), atoms)).route, 'cast')
  assert.equal(calls, 1); assert.equal(client.status().inFlight, 0)
  assert.equal(client.status().accepted, 1); assert.equal(JSON.stringify(client.status()).includes('test-key'), false)
})
test('busy speakers cancel old results; total inference slots stay bounded with no queue', async () => {
  const pending = []
  const client = createJevIntent({ keyFile, fetcher: async () => await new Promise(resolve => pending.push(resolve)) })
  const first = client.classify(input('发一个火球'), atoms)
  const second = client.classify({ ...input('你好'), actor: 'Other' }, atoms)
  assert.equal(client.status().inFlight, 2)
  assert.equal((await client.classify({ ...input('你好'), actor: 'Third' }, atoms)).route, 'uncertain')
  assert.equal((await client.classify(input('不要放了'), atoms)).route, 'uncertain')
  pending.forEach(resolve => resolve(Response.json({ answers: answers() })))
  assert.equal((await first).route, 'uncertain'); await second
  assert.equal(client.status().inFlight, 0)
})
test('timeouts, HTTP errors, oversize data and absent key use no retry and never cast', async () => {
  for (const fetcher of [async () => new Response('', { status: 403 }), async () => new Response('x'.repeat(65537)),
    async (_url, { signal }) => await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('abort'))))]) {
    const client = createJevIntent({ keyFile, fetcher, timeoutMs: 10 })
    assert.equal((await client.classify(input('用火球'), atoms)).route, 'uncertain')
    assert.equal(client.status().requests, 1); assert.equal(client.status().inFlight, 0)
  }
  const client = createJevIntent({ keyFile: path.join(tmp, 'missing'), fetcher: async () => { throw Error('must not call') } })
  assert.equal((await client.classify(input('用火球'), atoms)).route, 'uncertain'); assert.equal(client.status().requests, 0)
})
