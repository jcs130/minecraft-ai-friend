import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createVoiceCommandInbox, validateTranscript } from '../src/voice-command-inbox.ts'
import { createSpokenCommands } from '../src/application/spoken-commands.ts'
import { parseSpokenIntent } from '../src/gameplay/commands/spoken-intent.ts'
import { parseCli } from '../src/gameplay/commands/player-cli.ts'

// Independent adapter review. These fixtures never connect to Minecraft,
// a model, the production microphone directory, or a real player's state.
const NOW = 1_788_000_000_000
const ACTOR = 'QDVoiceReview'
const PREFIX = 'qd-voice-review-'
const atoms = [
  { id: 'fireworks', name: '烟花术', words: ['烟花术'], type: 'active', catalog: { status: 'featured' } },
  { id: 'home', name: '归乡', words: ['回家'], type: 'active', catalog: { status: 'featured' } },
  { id: 'tp', name: '空间传送', words: ['传送'], type: 'active', catalog: { status: 'featured' } },
  { id: 'old_fire', name: '旧火球术', words: ['老火球'], type: 'active', catalog: { status: 'archived', nativeHints: ['irons_spellbooks:fireball'] } },
]

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), PREFIX))
  const directory = join(root, 'outbox'), receipts = join(root, 'receipts.jsonl')
  mkdirSync(directory)
  t.after(() => {
    const target = resolve(realpathSync(root)), parent = resolve(realpathSync(tmpdir()))
    const rel = relative(parent, target)
    assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'cleanup target must stay below the temp root')
    assert.ok(basename(target).startsWith(PREFIX), 'cleanup target must have the owned fixture prefix')
    rmSync(target, { recursive: true, force: true })
  })
  let now = NOW, online = new Set([ACTOR])
  const calls = [], observations = [], logs = []
  const ports = {
    directory, receipts, allowed: new Set([ACTOR]), now: () => now, online: () => online,
    execute: async (actor, text) => { calls.push({ actor, text }); return { kind: 'command', verb: 'cast', ok: true, code: 'ok', skillId: 'fireworks', manaLeft: 45, summary: '私密正文不应进入回执日志' } },
    observed: (...args) => observations.push(args), log: text => logs.push(text),
  }
  const transcript = (id, patch = {}) => ({ schema: 2, player: ACTOR, text: '咏唱烟花术', ts: now, recordedAt: now - 2_000, recordingEndedAt: now - 1_000, emittedAt: now, wav: `${id}.wav`, ...patch })
  return {
    root, ports, calls, observations, logs, transcript,
    write(id, patch = {}) { writeFileSync(join(directory, `${id}.json`), JSON.stringify(transcript(id, patch))) },
    rows() { return existsSync(receipts) ? readFileSync(receipts, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [] },
    setNow(value) { now = value }, setOnline(value) { online = new Set(value) },
  }
}

test('review: inclusive freshness edges, original capture time and exact identities are enforced', () => {
  const players = new Set([ACTOR])
  const valid = { schema: 2, player: ACTOR, text: '咏唱烟花术', wav: 'edge.wav', ts: NOW, recordedAt: NOW - 120_000, recordingEndedAt: NOW, emittedAt: NOW }
  assert.ok(validateTranscript(valid, 'edge.json', NOW, players, players))
  assert.ok(validateTranscript({ ...valid, ts: NOW + 5_000, recordedAt: NOW + 5_000, recordingEndedAt: NOW + 5_000, emittedAt: NOW + 5_000 }, 'edge.json', NOW, players, players))
  for (const patch of [{ recordedAt: NOW - 120_001 }, { ts: NOW - 120_001 }, { recordedAt: NOW + 5_001 },
    { ts: NOW + 5_001 }, { recordedAt: NOW, ts: NOW - 5_001 }, { player: ACTOR.toLowerCase() },
    { player: ` ${ACTOR}` }, { player: '@a' }, { player: '' }, { recordedAt: '1788000000000' },
    { ts: Infinity }, { recordedAt: NaN }, { text: '咏唱\u0000烟花术' }, { wav: 'other.wav' }])
    assert.equal(validateTranscript({ ...valid, ...patch }, 'edge.json', NOW, players, players), null)
  for (const name of ['../edge.json', 'edge.json.json', 'edge.tmp', '.json'])
    assert.equal(validateTranscript(valid, name, NOW, players, players), null)
  assert.equal(validateTranscript(valid, 'edge.json', NOW, players, new Set()), null)
  assert.equal(validateTranscript(valid, 'edge.json', NOW, new Set(), players), null)
})

test('review: malformed, oversized and structurally invalid jobs do not poison later valid speech', async t => {
  const f = fixture(t), service = createVoiceCommandInbox(f.ports)
  writeFileSync(join(f.ports.directory, '00-malformed.json'), '{"player":')
  writeFileSync(join(f.ports.directory, '01-oversized.json'), 'x'.repeat(16_385))
  for (const [index, value] of [null, [], {}, { player: '@a' }].entries())
    writeFileSync(join(f.ports.directory, `02-invalid-${index}.json`), JSON.stringify(value))
  f.write('99-good')
  await service.poll()
  assert.deepEqual(f.calls, [{ actor: ACTOR, text: '咏唱烟花术' }])
  assert.equal(service.status().ready, true)
  assert.equal(f.observations.length, 1)
})

test('review: missing input directory reports unavailable and recovers on the next poll', async t => {
  const f = fixture(t), service = createVoiceCommandInbox(f.ports)
  const held = join(f.root, 'outbox-held')
  renameSync(f.ports.directory, held)
  await service.poll()
  assert.equal(service.status().ready, false)
  assert.equal(f.calls.length, 0)
  renameSync(held, f.ports.directory)
  f.write('after-directory-restore')
  await service.poll()
  assert.equal(service.status().ready, true)
  assert.equal(f.calls.length, 1)
})

test('review: an unreadable input entry can recover without resetting replay history', async t => {
  const f = fixture(t), service = createVoiceCommandInbox(f.ports)
  f.write('00-before'); await service.poll()
  const obstruction = join(f.ports.directory, '01-obstruction.json')
  mkdirSync(obstruction)
  f.write('99-after')
  await service.poll()
  assert.equal(service.status().ready, false)
  // Empty, explicitly owned fixture directory: no recursive deletion needed.
  rmdirSync(obstruction)
  f.write('00-before')
  await service.poll()
  assert.equal(service.status().ready, true)
  assert.equal(f.calls.length, 2)
})

test('review: transcript presentation failure cannot cancel or permanently disable accurate commands', async t => {
  const f = fixture(t)
  f.ports.observed = () => { throw new Error('test bubble display unavailable') }
  const service = createVoiceCommandInbox(f.ports)
  f.write('first'); f.write('second'); await service.poll()
  assert.equal(service.status().ready, true)
  assert.equal(f.calls.length, 2)
  assert.equal(f.rows().filter(row => row.ok === true).length, 2)
})

test('review: unknown execution outcome is terminal across polls and a service restart', async t => {
  const f = fixture(t)
  f.ports.execute = async () => { f.calls.push('attempt'); throw new Error('lost game connection after send') }
  const service = createVoiceCommandInbox(f.ports)
  f.write('uncertain'); await service.poll()
  f.write('uncertain'); await service.poll()
  const restarted = createVoiceCommandInbox(f.ports)
  f.write('uncertain'); await restarted.poll()
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.rows().map(row => row.kind), ['claimed', 'error'])
  assert.equal(f.rows()[1].code, 'outcome_unknown')
  assert.equal(f.rows()[1].ok, false)
})

test('review: repeated concurrent poll calls cannot overlap game actions', async t => {
  const f = fixture(t)
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  f.ports.execute = async () => { f.calls.push('attempt'); enter(); await gate; return { ok: true, code: 'ok' } }
  const service = createVoiceCommandInbox(f.ports)
  f.write('parallel')
  const pending = service.poll()
  try {
    await entered
    await Promise.all(Array.from({ length: 25 }, () => service.poll()))
    assert.equal(f.calls.length, 1)
  } finally { release(); await pending }
  assert.equal(f.rows().filter(row => row.kind === 'claimed').length, 1)
})

test('review: online presence is rechecked for each queued recording', async t => {
  const f = fixture(t)
  f.ports.execute = async () => { f.calls.push('attempt'); f.setOnline([]); return { ok: true } }
  const service = createVoiceCommandInbox(f.ports)
  f.write('first'); f.write('second'); await service.poll()
  assert.equal(f.calls.length, 1)
  assert.equal(f.observations.length, 1)
  assert.equal(service.status().ready, true)
})

test('review: durable claim exists before side effects and the journal excludes transcript and private summaries', async t => {
  const f = fixture(t), originalExecute = f.ports.execute
  f.ports.execute = async (actor, text) => {
    assert.deepEqual(f.rows().map(row => row.kind), ['claimed'])
    assert.equal(f.rows()[0].actor, ACTOR)
    return originalExecute(actor, text)
  }
  f.write('claim-before-effect'); await createVoiceCommandInbox(f.ports).poll()
  assert.equal(f.rows()[1].manaLeft, 45)
  for (const row of f.rows()) for (const key of ['text', 'summary', 'wav', 'prompt', 'native'])
    assert.equal(Object.hasOwn(row, key), false, key)
})

test('review: claim write failure prevents execution and remains closed until explicit repair', async t => {
  const f = fixture(t)
  f.ports.receipts = join(f.root, 'missing-journal-parent', 'receipts.jsonl')
  const service = createVoiceCommandInbox(f.ports)
  f.write('unclaimed'); await service.poll()
  assert.equal(service.status().ready, false)
  assert.equal(f.calls.length, 0)
  mkdirSync(join(f.root, 'missing-journal-parent'))
  await service.poll()
  assert.equal(f.calls.length, 0, 'repairing storage alone must not silently resume an untrusted journal')
})

test('review: result write failure never repeats an action after restart because its claim survives', async t => {
  const f = fixture(t), saved = join(f.root, 'saved-claim.jsonl')
  f.ports.execute = async () => {
    f.calls.push('effect')
    renameSync(f.ports.receipts, saved)
    mkdirSync(f.ports.receipts)
    return { ok: true, code: 'ok' }
  }
  const service = createVoiceCommandInbox(f.ports)
  f.write('effect-with-missing-result'); await service.poll()
  assert.equal(service.status().ready, false)
  assert.equal(f.calls.length, 1)
  rmdirSync(f.ports.receipts)
  renameSync(saved, f.ports.receipts)
  const restarted = createVoiceCommandInbox(f.ports)
  f.write('effect-with-missing-result'); await restarted.poll()
  assert.equal(f.calls.length, 1)
})

test('review: expired capture remains rejected after recent replay memory is compacted on restart', async t => {
  const f = fixture(t), service = createVoiceCommandInbox(f.ports)
  const stale = f.transcript('expired')
  f.write('expired'); await service.poll()
  f.setNow(NOW + 126_000)
  const restarted = createVoiceCommandInbox(f.ports)
  assert.equal(f.rows().length, 0, 'old persisted rows should be compacted')
  f.write('expired', stale); f.write('fresh')
  await restarted.poll()
  assert.equal(f.calls.length, 2, 'only original and new fresh recording execute')
  assert.deepEqual(f.rows().map(row => row.id), ['fresh', 'fresh'])
})

function spokenFixture(t, overrides = {}) {
  const effects = [], feedback = [], conversation = []
  const service = createSpokenCommands({
    atoms: () => atoms,
    execute: async request => { effects.push(request); return { ok: true, code: 'ok', skillId: 'fireworks', summary: '实际成功' } },
    feedback: (actor, text) => feedback.push({ actor, text }),
    conversation: async (actor, text) => conversation.push({ actor, text }),
    ...overrides,
  })
  // This pure application has no business contacting any model itself.
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network call in spoken application') })
  return { service, effects, feedback, conversation }
}

test('review: negation, reported speech and unresolved chants never become a second guessed action', async t => {
  const f = spokenFixture(t)
  const conversations = ['女神，不要放火焰弹', '女神，火焰弹是什么意思', '女神说过咏唱烟花术',
    '“归乡”', '如果传送到家', '咏唱烟花术，可不可以', '传送到家，然后落雷', '女神，停止咏唱吗']
  for (const text of conversations) {
    assert.equal(parseSpokenIntent(text, atoms).kind, 'conversation', text)
    await f.service.execute(ACTOR, text)
  }
  for (const text of ['咏唱未知技能', '施放旧火球术', '咏唱空间传送向左五格']) {
    const receipt = await f.service.execute(ACTOR, text)
    assert.equal(receipt.code, 'unknown_chant', text)
    assert.equal(receipt.ok, false)
  }
  assert.equal(f.effects.length, 0)
  assert.equal(f.conversation.length, conversations.length)
})

test('review: exact native words and waypoint references preserve one actor and one parsed command', async t => {
  const f = spokenFixture(t)
  for (const text of ['女神，火焰弹。', '女神，落雷', '咏唱烟花术', '传送到personal:19', '传送到 Home Base'])
    await f.service.execute(ACTOR, text)
  const parsed = f.effects.map(request => ({ actor: request.actor, ...parseCli(`/mycli ${request.command}`) }))
  assert.deepEqual(parsed.map(command => [command.actor, command.verb, command.args]), [
    [ACTOR, 'cast', ['irons_spellbooks:firebolt']], [ACTOR, 'cast', ['irons_spellbooks:lightning_bolt']],
    [ACTOR, 'cast', ['fireworks']], [ACTOR, 'goto', ['personal:19']], [ACTOR, 'goto', ['Home Base']],
  ])
  assert.equal(f.conversation.length, 0)
})

test('review: feedback failure preserves a known game success instead of changing it to an unknown outcome', async t => {
  let effects = 0
  const f = spokenFixture(t, {
    execute: async () => { effects++; return { ok: true, code: 'ok', skillId: 'fireworks', manaLeft: 45, summary: '实际成功' } },
    feedback: () => { throw new Error('test speaker unavailable') },
  })
  const receipt = await f.service.execute(ACTOR, '咏唱烟花术')
  assert.equal(receipt.ok, true)
  assert.equal(receipt.code, 'ok')
  assert.equal(receipt.manaLeft, 45)
  assert.equal(receipt.feedbackDelivered, false)
  assert.equal(effects, 1)
})

test('review: unavailable conversation is not reported as a failed or successful spell', async t => {
  const f = spokenFixture(t, { conversation: async () => { throw new Error('test model unavailable') } })
  const receipt = await f.service.execute(ACTOR, '女神，火焰弹是什么')
  assert.equal(receipt.kind, 'conversation')
  assert.equal(receipt.ok, false)
  assert.equal(receipt.code, 'conversation_unavailable')
  assert.equal(f.effects.length, 0)
  assert.equal(f.feedback.length, 0)
})

test('review: a begun native cast is described as started, never as a confirmed impact', async t => {
  const f = spokenFixture(t, { execute: async () => ({ ok: true, code: 'casting_started', summary: 'fixture: this text is not evidence of a hit' }) })
  const receipt = await f.service.execute(ACTOR, '女神，火焰弹')
  assert.equal(receipt.code, 'casting_started')
  assert.equal(f.feedback[0].text, '开始咏唱。')
  assert.equal(f.feedback[0].actor, ACTOR)
})
