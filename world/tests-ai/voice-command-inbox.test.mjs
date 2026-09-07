import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import { createVoiceCommandInbox, validateTranscript } from '../src/voice-command-inbox.ts'

const NOW = 1788000000000, NAME = 'QDGuildProbe'
const valid = { schema: 2, player: NAME, text: '咏唱烟花术', ts: NOW, recordedAt: NOW - 2000, recordingEndedAt: NOW - 1000, emittedAt: NOW, wav: 'voice-test.wav' }
const players = new Set([NAME])
test('identity, source name, timestamps and online presence are mandatory', () => {
  assert.equal(validateTranscript(valid, 'voice-test.json', NOW, players, players).player, NAME)
  for (const patch of [{ player: undefined }, { player: '@a' }, { player: 'MengMeng' }, { wav: '../voice-test.wav' },
    {schema:undefined},{schema:1},{recordingEndedAt:undefined},{recordingEndedAt:NOW-3000},{emittedAt:NOW+1},{recordedAt:NOW-1000.5},
    { text: '' }, { text: 'a\nb' }, { text: 'a'.repeat(2049) }, { ts: undefined }, { recordedAt: undefined },
    { ts: NaN }, { recordedAt: NOW-120001 }, { ts: NOW+5001 }, { recordedAt: NOW+5001 }])
    assert.equal(validateTranscript({ ...valid, ...patch }, 'voice-test.json', NOW, players, players), null, JSON.stringify(patch))
  assert.equal(validateTranscript(valid, '../voice-test.json', NOW, players, players), null)
  assert.equal(validateTranscript(valid, 'voice-test.json', NOW, players, new Set()), null)
  assert.equal(validateTranscript(valid, 'voice-test.json', NOW, new Set(), players), null)
})

test('full capture bounds reach the spoken application without replacing them by ASR completion time', async t => {
  const f=fixture(t), contexts=[]
  f.ports.execute=async(actor,text,context)=>{contexts.push(context);return {ok:true,kind:'command',verb:'cast'}}
  f.write();await createVoiceCommandInbox(f.ports).poll()
  assert.deepEqual(contexts,[{recordedAt:NOW-2000,recordingEndedAt:NOW-1000}])
})
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'qiandeng-voice-'))
  const inbox = join(directory, 'inbox'), receipts = join(directory, 'receipts.jsonl')
  mkdirSync(inbox)
  t.after(() => {
    const owned = realpathSync(directory), parent = realpathSync(tmpdir()), rel = relative(parent, owned)
    assert.ok(!isAbsolute(rel) && !rel.startsWith('..') && rel.startsWith('qiandeng-voice-'))
    rmSync(owned, { recursive: true })
  })
  const calls = [], observations = [], logs = []
  const ports = { directory: inbox, receipts, allowed: players, online: () => players, now: () => NOW,
    execute: async (actor, text) => { calls.push({ actor, text }); return { kind: 'command', verb: 'cast', ok: true, code: 'ok', skillId: 'fireworks', summary: 'Private summary' } },
    observed: (...args) => observations.push(args), log: message => logs.push(message) }
  return { ports, calls, observations, logs, write: (value = valid) => writeFileSync(join(inbox, 'voice-test.json'), JSON.stringify(value)),
    rows: () => readFileSync(receipts, 'utf8').trim().split('\n').map(line => JSON.parse(line)) }
}
test('a real transcript executes once across polls and a process restart', async t => {
  const f = fixture(t), service = createVoiceCommandInbox(f.ports)
  f.write(); await service.poll(); f.write(); await service.poll()
  const restarted = createVoiceCommandInbox(f.ports); f.write(); await restarted.poll()
  assert.equal(f.calls.length, 1); assert.equal(f.observations.length, 1)
  assert.deepEqual(f.rows().map(row => row.kind), ['claimed', 'command'])
  assert.equal(f.rows()[1].skillId, 'fireworks')
  assert.ok(f.rows().every(row => !('text' in row) && !('summary' in row)))
})
test('a persisted claim after a crash is not retried', async t => {
  const f = fixture(t)
  writeFileSync(f.ports.receipts, JSON.stringify({ id: 'voice-test', actor: NAME, kind: 'claimed', at: NOW })+'\n')
  f.write(); await createVoiceCommandInbox(f.ports).poll(); assert.equal(f.calls.length, 0)
})
test('stale and unidentifiable transcripts cause no action or feedback', async t => {
  const f = fixture(t), service = createVoiceCommandInbox(f.ports)
  for (const patch of [{ recordedAt: NOW-120001 }, { player: undefined }, { player: 'MengMeng' }]) {
    f.write({ ...valid, ...patch }); await service.poll()
  }
  assert.equal(f.calls.length, 0); assert.equal(f.observations.length, 0); assert.equal(service.status().ready, true)
})
test('concurrent polling cannot execute a second action', async t => {
  const f = fixture(t); let release
  f.ports.execute = async () => { f.calls.push('start'); await new Promise(resolve => { release = resolve }); return { ok: true } }
  const service = createVoiceCommandInbox(f.ports); f.write(); const first = service.poll()
  while (!release) await new Promise(resolve => setTimeout(resolve, 5))
  await service.poll(); release(); await first; assert.equal(f.calls.length, 1)
})
test('unreadable journal disables input instead of silently dropping replay protection', async t => {
  const f = fixture(t); writeFileSync(f.ports.receipts, 'broken\n')
  const service = createVoiceCommandInbox(f.ports); f.write(); await service.poll()
  assert.equal(service.status().ready, false); assert.equal(f.calls.length, 0)
})
