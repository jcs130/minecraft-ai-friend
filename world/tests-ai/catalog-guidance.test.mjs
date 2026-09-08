import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { hasSkillCatalog, newcomerSkillGuidance, nativeEmergencyHealingFeedback } from '../src/catalog-guidance.ts'

const catalog = JSON.parse(readFileSync(new URL('../../config/skill-catalog.json', import.meta.url), 'utf8'))
const atoms = JSON.parse(readFileSync(new URL('../data/magic-atoms.json', import.meta.url), 'utf8')).atoms
const projected = atoms.map(atom => ({ ...atom, catalog: {
  status: catalog.featured.includes(atom.id) ? 'featured' : 'archived',
  reason: catalog.archived[atom.id]?.reason ?? '', nativeHints: catalog.archived[atom.id]?.nativeHints ?? [],
} }))

test('welcome derives exactly the active featured set and explains native equipment without archived examples', () => {
  const prompt = newcomerSkillGuidance(projected)
  assert.equal(hasSkillCatalog(projected), true)
  for (const id of catalog.featured) assert.ok(prompt.includes(`（${id}）`))
  for (const atom of projected.filter(a => a.catalog.status === 'archived')) assert.equal(prompt.includes(`（${atom.id}）`), false)
  assert.doesNotMatch(prompt, /圣愈|照明|迅捷|螺旋丸/)
  assert.match(prompt, /装备.*法术书.*卷轴/)
  assert.match(prompt, /知道法术名就拥有原生法术/)
  const oneLess = projected.map(a => a.id === 'home' ? { ...a, catalog: { ...a.catalog, status: 'archived' } } : a)
  assert.equal(newcomerSkillGuidance(oneLess).includes('（home）'), false)
})

test('absence of a catalogue preserves legacy onboarding compatibility', () => {
  assert.equal(hasSkillCatalog(atoms), false)
  assert.match(newcomerSkillGuidance(atoms), /归乡\/圣愈/)
})

test('only exact native acceptance produces a cast-start event, never a restored-health claim', () => {
  const feedback = nativeEmergencyHealingFeedback({ ok: true, code: 'casting_started' })
  assert.equal(feedback.accepted, true)
  assert.equal(feedback.record.action, 'emergency_cast_started')
  assert.equal(feedback.record.skill, 'irons_spellbooks:heal')
  assert.match(feedback.hint, /开始施法.*尚待确认/)
  assert.doesNotMatch(feedback.hint + feedback.record.reply, /已救活|已经恢复|我已喂饱/)
  for (const result of [{ ok: false, code: 'casting_started' }, { ok: true, code: 'unexpected' },
    { ok: false, code: 'not_equipped' }, { ok: false, code: 'mana' }, { ok: false, code: 'cooldown' },
    { ok: false, code: 'outcome_unknown' }, { ok: false, code: 'busy' }]) {
    const denied = nativeEmergencyHealingFeedback(result)
    assert.equal(denied.accepted, false)
    assert.equal(denied.record, undefined)
    assert.doesNotMatch(denied.hint, /已救活|我已出手救你/)
  }
})

// Execute the actual guardScan body with isolated dependencies. No world service,
// timers, socket, model or player files are created by this test harness.
const require = createRequire(new URL('../package.json', import.meta.url))
const { transform } = require('esbuild')
const godSource = readFileSync(new URL('../src/mc-god.ts', import.meta.url), 'utf8')
await transform(godSource, { loader: 'ts', format: 'esm', logLevel: 'silent' })
const guardStart = godSource.indexOf('  async function guardScan(')
const guardEnd = godSource.indexOf('  // ── 填坑', guardStart)
assert.ok(guardStart >= 0 && guardEnd > guardStart)
const { code } = await transform(`export function makeGuard(ctx) {
  const { rcon, magic, irons, log, worlddb, guardHint, hasSkillCatalog, nativeEmergencyHealingFeedback,
    lastGuardSave, GUARD_SAVE_COOLDOWN_MS, lastDiscover, EXPLORE_COOLDOWN_MS, nightHintDay,
    courier, parseNbtPosition } = ctx;
  ${godSource.slice(guardStart, guardEnd)}
  return guardScan;
}`, { loader: 'ts', format: 'esm', logLevel: 'silent' })
const { makeGuard } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

function fixture(options = {}) {
  const calls = [], hints = [], records = [], memories = []
  const ctx = {
    rcon: { getEntityNumber: async (_name, key) => ({ Health: 2, foodLevel: 20, Air: 300, ...options.vitals })[key],
      send: async () => { throw new Error('Unexpected RCON command') } },
    magic: { listAtoms: () => options.legacy ? atoms : projected,
      castByGod: async (name, id) => { calls.push(['legacy', name, id]); return 'legacy result' } },
    irons: { cast: async (name, id) => { calls.push(['native', name, id]);
      if (options.throwCast) throw new Error('transport error');
      return options.result ?? { ok: false, code: 'not_equipped' } } },
    log() {},
    worlddb: { chronicleRecord: (...args) => records.push(args), remember: async (...args) => memories.push(args) },
    guardHint: async (...args) => hints.push(args), hasSkillCatalog, nativeEmergencyHealingFeedback,
    lastGuardSave: new Map(), GUARD_SAVE_COOLDOWN_MS: 90_000,
    lastDiscover: new Map([['QA', Date.now()]]), EXPLORE_COOLDOWN_MS: 30 * 60_000,
    nightHintDay: new Map(), courier() {}, parseNbtPosition: () => null,
  }
  return { scan: makeGuard(ctx), calls, hints, records, memories }
}

test('actual dying scan invokes native healing once and never falls back to archived legacy healing', async () => {
  const f = fixture()
  await f.scan('QA', false, -1)
  await f.scan('QA', false, -1)
  assert.deepEqual(f.calls, [['native', 'QA', 'irons_spellbooks:heal']])
  assert.deepEqual(f.records, [])
  assert.deepEqual(f.memories, [])
  assert.ok(f.hints.every(([, , hint]) => !/已救活|圣愈|我已出手/.test(hint)))
})

test('actual accepted rescue records only casting_started and a transport failure records no success', async () => {
  const accepted = fixture({ result: { ok: true, code: 'casting_started' } })
  await accepted.scan('QA', false, -1)
  assert.equal(accepted.records.length, 1)
  assert.equal(accepted.records[0][2].action, 'emergency_cast_started')
  assert.doesNotMatch(JSON.stringify(accepted.records) + JSON.stringify(accepted.memories), /已救活|直接代施.*救活/)
  const failed = fixture({ throwCast: true })
  await failed.scan('QA', false, -1)
  assert.equal(failed.calls.length, 1)
  assert.equal(failed.records.length, 0)
  assert.equal(failed.memories.length, 0)
  assert.match(failed.hints[0][2], /待核实.*不要自动重发/)
})

test('actual starvation and hurt hints avoid archived feed/heal while legacy scans stay compatible', async () => {
  const starving = fixture({ vitals: { Health: 8, foodLevel: 0 } })
  await starving.scan('QA', false, -1)
  assert.equal(starving.calls.length, 0)
  assert.equal(starving.records.length, 0)
  assert.match(starving.hints.find(([, kind]) => kind === 'starving')[2], /进食.*cast give/)
  const hurt = fixture({ vitals: { Health: 5, foodLevel: 20 } })
  await hurt.scan('QA', false, -1)
  assert.equal(hurt.calls.length, 0)
  assert.doesNotMatch(hurt.hints[0][2], /圣愈|迅捷/)
  const legacy = fixture({ legacy: true })
  await legacy.scan('QA', false, -1)
  assert.deepEqual(legacy.calls, [['legacy', 'QA', 'heal']])
})
