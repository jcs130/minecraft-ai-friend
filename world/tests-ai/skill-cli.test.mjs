import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseCli, parseCastInput, explicitChantBody, cliOverview } from '../src/mc-cli.ts'
import { createSkillCliQueue } from '../src/skill-cli-queue.ts'
import { createIronsSpellClient } from '../src/irons-spell-client.ts'

const atoms = [{ id: 'give', name: '造物术', words: ['造物'] }, { id: 'tp', name: '空间传送', words: ['传送'] }]
test('explicit CLI never turns a typo or a verb hidden in conversation into an action', () => {
  assert.equal(parseCli('/mycli please cast tp').verb, 'invalid')
  assert.equal(parseCli('/mycli caast tp --json').json, true)
  assert.equal(parseCli('/mycli caast tp --json').verb, 'invalid')
  assert.equal(parseCli('/mycli chat please cast tp').verb, 'chat')
  assert.equal(parseCli('你好'), null)
})
test('flags and quoted parameters preserve verb and content', () => {
  assert.deepEqual(parseCli('/mycli --json cast tp direction="东" distance=5').args, ['tp', 'direction=东', 'distance=5'])
  assert.equal(parseCli('/mycli cast tp --help').wantHelp, true)
  assert.equal(parseCli('/mycli chat help').wantHelp, false)
  assert.ok(parseCli('/mycli cast "unfinished').error)
  assert.equal(parseCli('/mycli').verb, 'help')
  assert.ok(cliOverview().length <= 8)
})
test('Chinese and English explicit chanting share one gate and preserve item-picker syntax', () => {
  for (const raw of ['铁魔法： 隐身术', '咏唱：铁魔法： 隐身术']) {
    const body = explicitChantBody(raw)
    assert.equal(body, '铁魔法：隐身术')
    assert.equal(parseCastInput(parseCli(`/mycli cast ${body}`).args, atoms, []).ok, true)
  }
  assert.equal(explicitChantBody('chant:隐身术'), '隐身术')
  assert.equal(explicitChantBody('咏唱：造物 火把'), '造物 火把')
  assert.equal(explicitChantBody('chanting is fun'), null)
})
test('slot 8 retains its position and forwards all cast parameters', () => {
  const bar = ['', '', '', '', '', '', '', 'tp']
  const parsed = parseCastInput(['8', 'distance=5', 'direction=东'], atoms, bar)
  assert.equal(parsed.skill, 'tp'); assert.equal(parsed.slot, 8)
  assert.deepEqual({ ...parsed.params }, { distance: 5, direction: '东' })
  assert.equal(parseCastInput(['1'], atoms, bar).code, 'empty_slot')
  assert.equal(parseCastInput(['9'], atoms, bar).code, 'invalid_slot')
})
test('existing item-picker command is compatible and duplicate params are rejected', () => {
  const parsed = parseCastInput(['造物', '火把'], atoms, [])
  assert.equal(parsed.skill, 'give'); assert.equal(parsed.params.item, '火把')
  assert.equal(parseCastInput(['tp', 'distance=3', 'distance=5'], atoms, []).code, 'invalid_params')
  assert.equal(parseCastInput(['tp', 'constructor=x'], atoms, []).code, 'invalid_params')
  assert.equal(parseCastInput(['tp', 'somewhere'], atoms, []).code, 'invalid_params')
})
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'qd-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const submit = (patch = {}) => {
    const id = randomUUID(), now = Date.now()
    const request = { id, actor: 'QDCliProbe', command: 'cast tp', submittedAt: now, expiresAt: now + 30000, ...patch }
    const dir = join(root, 'requests', id); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'request.json'), JSON.stringify(request))
    return id
  }
  const receipt = id => JSON.parse(readFileSync(join(root, 'results', `${id}.json`), 'utf8'))
  return { root, submit, receipt }
}
test('duplicate polls and process restart cannot replay a completed cast', async t => {
  const f = fixture(t); let calls = 0
  const exec = async () => { calls++; return { ok: true, code: 'ok', manaLeft: 92 } }
  const queue = createSkillCliQueue(f.root, exec)
  const id = f.submit()
  await Promise.all([queue.poll(), queue.poll()]); await queue.poll()
  const restarted = createSkillCliQueue(f.root, exec); await restarted.poll()
  assert.equal(calls, 1); assert.equal(f.receipt(id).manaLeft, 92)
})
test('expired or invalid actor requests cannot execute', async t => {
  const f = fixture(t); let calls = 0
  const queue = createSkillCliQueue(f.root, async () => { calls++; return { ok: true } })
  const bad = f.submit({ actor: '@a' })
  const old = f.submit({ submittedAt: Date.now() - 40000, expiresAt: Date.now() - 10000 })
  await queue.poll()
  assert.equal(calls, 0)
  assert.equal(f.receipt(bad).code, 'invalid_request'); assert.equal(f.receipt(old).code, 'expired')
})
test('interrupted claimed actions become outcome_unknown, never an automatic retry', async t => {
  const f = fixture(t); let calls = 0
  const id = randomUUID(); mkdirSync(join(f.root, 'processing', id), { recursive: true })
  const queue = createSkillCliQueue(f.root, async () => { calls++; return { ok: true } })
  await queue.poll()
  assert.equal(calls, 0); assert.equal(f.receipt(id).code, 'outcome_unknown')
})

test('a manually duplicated intake cannot block a later unrelated request', async t => {
  const f = fixture(t); let calls = 0
  const queue = createSkillCliQueue(f.root, async () => { calls++; return { ok: true } })
  const id = f.submit(); await queue.poll()
  const duplicate = join(f.root, 'requests', id); mkdirSync(duplicate)
  writeFileSync(join(duplicate, 'request.json'), '{}')
  const next = f.submit(); await queue.poll()
  assert.equal(calls, 2); assert.equal(f.receipt(next).ok, true)
})
test('incomplete producer reservations cannot starve ready requests', async t => {
  const f = fixture(t); let calls = 0
  const queue = createSkillCliQueue(f.root, async () => { calls++; return { ok: true } })
  for (let i = 0; i < 12; i++) mkdirSync(join(f.root, 'requests', `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`))
  const ready = f.submit(); await queue.poll()
  assert.equal(calls, 1); assert.equal(f.receipt(ready).ok, true)
})

function nativeResponse(action, fields = {}) {
  return 'QD_SPELL_JSON ' + JSON.stringify({ schema: 1, engine: 'irons_spellbooks', ok: true, code: 'ok', action, actor: 'QDCliProbe', summary: 'test', ...fields })
}
test('native Chinese spell names resolve only among equipped spells and retain native start semantics', async () => {
  const commands = []
  const client = createIronsSpellClient(async command => {
    commands.push(command)
    return command.includes(' list ') ? nativeResponse('list', { spells: [{ id: 'irons_spellbooks:firebolt', name: 'Firebolt', nameKey: 'spell.firebolt' }] }) : nativeResponse('cast', { code: 'casting_started', phase: 'casting', accepted: true })
  }, { 'spell.firebolt': '火焰弹' })
  const result = await client.cast('QDCliProbe', '火焰弹')
  assert.deepEqual(commands, ['qdspell list QDCliProbe', 'qdspell cast QDCliProbe irons_spellbooks:firebolt'])
  assert.equal(result.code, 'casting_started'); assert.equal(result.phase, 'casting')
  const denied = await client.cast('QDCliProbe', '未装备法术')
  assert.equal(denied.code, 'not_equipped'); assert.equal(commands.length, 3)
})
test('native spell transport rejects selectors and injection; an interrupted cast is never replayed', async () => {
  let sends = 0
  const client = createIronsSpellClient(async () => { sends++; throw new Error('lost receipt') }, {})
  assert.equal((await client.request('cast', '@a', 'irons_spellbooks:heal')).code, 'invalid_actor')
  assert.equal((await client.request('cast', 'QDCliProbe', 'irons_spellbooks:heal\nsay hi')).code, 'invalid_skill_id')
  assert.equal(sends, 0)
  assert.equal((await client.cast('QDCliProbe', 'irons_spellbooks:heal')).code, 'outcome_unknown')
  assert.equal(sends, 1)
})
test('wrong actor and wrong action receipts cannot acknowledge another cast', async () => {
  const wrongActor = createIronsSpellClient(async () => nativeResponse('cast', { actor: 'OtherPlayer' }), {})
  assert.equal((await wrongActor.cast('QDCliProbe', 'irons_spellbooks:heal')).code, 'outcome_unknown')
  const wrongAction = createIronsSpellClient(async () => nativeResponse('list'), {})
  assert.equal((await wrongAction.cast('QDCliProbe', 'irons_spellbooks:heal')).code, 'outcome_unknown')
  const wrongDenial = createIronsSpellClient(async () => nativeResponse('cast', { ok: false, code: 'cooldown', actor: 'OtherPlayer' }), {})
  assert.equal((await wrongDenial.cast('QDCliProbe', 'irons_spellbooks:heal')).code, 'outcome_unknown')
  const offline = createIronsSpellClient(async () => nativeResponse('cast', { ok: false, code: 'actor_not_found', actor: '', actorUuid: '' }), {})
  assert.equal((await offline.cast('QDCliProbe', 'irons_spellbooks:heal')).code, 'actor_not_found')
})
