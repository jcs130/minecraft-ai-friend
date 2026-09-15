import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const world = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dependencyRoot = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const { build } = createRequire(join(dependencyRoot, '.qiandeng-mapping-test.cjs'))('esbuild')
const compiled = mkdtempSync(join(tmpdir(), 'qiandeng-mapping-module-'))
after(() => rmSync(compiled, { recursive: true, force: true }))
await build({ entryPoints: { magic: join(world, 'src/mc-magic.ts'), catalog: join(world, 'src/gameplay/magic/catalog.ts') },
  outdir: compiled, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
  nodePaths: [dependencyRoot], logLevel: 'silent' })
const { createMagic } = await import(pathToFileURL(join(compiled, 'magic.mjs')).href)
const { validateSkillCatalog } = await import(pathToFileURL(join(compiled, 'catalog.mjs')).href)
const atoms = JSON.parse(readFileSync(join(world, 'data/magic-atoms.json'), 'utf8')).atoms
const catalog = JSON.parse(readFileSync(join(world, '../config/skill-catalog.json'), 'utf8'))
const mapped = atoms.filter(a => catalog.featuredDetails[a.id]?.nativeSpell)
const nativeId = id => catalog.featuredDetails[id].nativeSpell

function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qiandeng-mapping-case-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const timers = []
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { timers.push({ fn, ms }); return { offline: true } })
  t.mock.method(globalThis, 'setInterval', () => ({ offline: true }))
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden') })
  t.mock.method(console, 'log', () => {})
  const statePath = join(dir, 'state.json'), atomsPath = join(dir, 'atoms.json')
  writeFileSync(atomsPath, JSON.stringify({ atoms }))
  writeFileSync(join(dir, 'skill-catalog.json'), JSON.stringify(catalog))
  writeFileSync(statePath, JSON.stringify({ version: 1, players: { QA: {
    mana: 0, maxMana: 100, maxManaBonus: 7, level: 1, lastUpdate: Date.now(),
    learned: [], innateSkill: null, passives: ['night_vision'], passiveProgress: { night_vision: 93 },
    ...options.player,
  } } }))
  const commands = []
  const handle = createMagic({ enabled: false, atomsPath, statePath, stateMirrorPath: null,
    balancePath: join(dir, 'balance.json'), maxManaDefault: 100, regenPerSec: 0 }, {
    getBot: () => { throw new Error('Legacy bot access forbidden') },
    rcon: { getEntityNumber: () => { throw new Error('Legacy entity query forbidden') },
      send: async command => {
        commands.push(command)
        const match = /^qdspell cast QA (irons_spellbooks:[a-z0-9_./-]+)$/.exec(command)
        assert.ok(match, `Unexpected legacy command: ${command}`)
        if (options.send) return options.send(command)
        const receipt = { schema: 1, engine: 'irons_spellbooks', action: 'cast', actor: 'QA',
          actorUuid: '00000000-0000-0000-0000-000000000001', ok: true, code: 'casting_started',
          accepted: true, summary: '原生施法已开始', spell: { id: match[1], level: 1 }, ...options.receipt }
        return 'QD_SPELL_JSON ' + JSON.stringify(receipt)
      } },
  })
  handle.setSpecialExecutor(async () => { throw new Error('Legacy special executor forbidden') })
  t.after(() => handle.dispose())
  return { service: handle.service, commands, timers, statePath, disk: () => readFileSync(statePath, 'utf8') }
}

test('catalogue restores 35 active entries, 26 explicit mappings and 35 distinct icons with ordered groups', () => {
  const result = validateSkillCatalog(catalog, atoms)
  assert.equal(result.featured.length, 35)
  assert.equal(mapped.length, 26)
  assert.equal(new Set([...result.icons.values()]).size, 35)
  assert.deepEqual(result.featured.slice(0, 8), ['home', 'tp', 'give', 'blood_mana', 'spring', 'sky_walk', 'feather_boots', 'fireworks'])
  for (const a of mapped) {
    const entry = result.entries.get(a.id)
    assert.equal(entry.nativeSpell, nativeId(a.id))
    assert.equal(entry.status, 'featured')
    assert.match(entry.reason, /主题替代.*原生法力/)
    assert.ok(['combat', 'support', 'movement', 'life'].includes(entry.group))
  }
  assert.equal(result.entries.get('starburst').category, 'sword')
  assert.equal(result.entries.get('rasengan').category, 'ninja')
  assert.equal(result.entries.get('starlight').nativeSpell, undefined)
  for (const id of ['time_day', 'weather_clear', 'rain', 'storm', 'summon_wolf', 'summon_pack',
    'kage_bunshin', 'golem_guard', 'initiate', 'purge', 'magnet', 'ench_rasengan']) {
    assert.equal(result.entries.get(id).status, 'archived', id)
  }
})

test('malformed or unclassified mapping metadata fails closed', () => {
  const invalid = [
    raw => { raw.featuredDetails.rasengan.nativeSpell = 'gust' },
    raw => { raw.featuredDetails.rasengan.nativeSpell = 'minecraft:gust' },
    raw => { raw.featuredDetails.rasengan.nativeSpell = 'irons_spellbooks:gust\n' },
    raw => { raw.featuredDetails.rasengan.nativeSpell = null },
    raw => { delete raw.featuredDetails.rasengan.category },
    raw => { raw.featuredDetails.rasengan.category = 'wrong' },
    raw => { raw.categories.ninja.group = 'arbitrary' },
    raw => { raw.categories.ninja.ids = [] },
    raw => { delete raw.categories },
    raw => { raw.archived.initiate.nativeSpell = 'irons_spellbooks:heal' },
  ]
  for (const mutate of invalid) {
    const raw = structuredClone(catalog); mutate(raw)
    assert.throws(() => validateSkillCatalog(raw, atoms), /Invalid skill catalogue/)
  }
})

test('all mapped IDs and names use one native command across exact, chant, fuzzy, divine and owner routes', async t => {
  const f = fixture(t), before = f.disk()
  for (const a of mapped) {
    for (const key of [a.id, a.name]) {
      const result = await f.service.castExact('QA', key)
      assert.equal(result.ok, true, key)
      assert.equal(result.code, 'casting_started')
      assert.equal(result.skillId, a.id)
      assert.equal(result.nativeSpell, nativeId(a.id))
      assert.equal(result.executionConfirmed, false)
      assert.equal(result.effectReceipt.spell.id, nativeId(a.id))
      assert.match(result.summary, /主题替代.*仍待确认/)
    }
    for (const invoke of [() => f.service.castSpell('QA', `咏唱：${a.name}`),
      () => f.service.castFuzzy('QA', '含糊表达', a.id, { mode: 'llm', tokens: 9999 }),
      () => f.service.castByGod('QA', a.id, { consumeMana: 999, tokens: 9999 }),
      () => f.service.castAsOwner('QA', a.id)]) {
      const count = f.commands.length
      assert.match(await invoke(), /原生施法已开始/, a.id)
      assert.deepEqual(f.commands.slice(count), [`qdspell cast QA ${nativeId(a.id)}`])
    }
  }
  assert.equal(f.commands.length, mapped.length * 6)
  assert.equal(f.disk(), before, 'no old MP, level, innate, progress, learning or skillbar mutation')
  assert.equal(f.timers.some(timer => timer.ms === 60_000), false, 'mapped windburst must not schedule global projectile deletion')
})

test('native denials remain truthful and no mapped entry falls back to old commands or teaching', async t => {
  for (const code of ['not_equipped', 'mana', 'cooldown', 'unlearned', 'native_denied', 'busy', 'actor_unavailable', 'bridge_error']) {
    const f = fixture(t, { receipt: { ok: false, code, accepted: false, summary: `原生拒绝 ${code}`, spell: undefined } })
    const before = f.disk()
    const result = await f.service.castExact('QA', 'rasengan')
    assert.equal(result.ok, false)
    assert.equal(result.code, code)
    assert.equal(result.executionConfirmed, false)
    assert.deepEqual(f.commands, ['qdspell cast QA irons_spellbooks:gust'])
    assert.equal(f.disk(), before)
  }
})

test('missing, mismatched and contradictory native receipts stay unknown without replay', async t => {
  const cases = [
    { send: async () => '' },
    { send: async () => { throw new Error('connection closed after dispatch') } },
    { receipt: { actor: 'Other' } },
    { receipt: { spell: { id: 'irons_spellbooks:fireball' } } },
    { receipt: { spell: undefined } },
    { receipt: { accepted: undefined } },
    { receipt: { code: 'ok' } },
    { receipt: { ok: false } },
    { receipt: { action: 'list' } },
    { receipt: { schema: 2 } },
  ]
  for (const options of cases) {
    const f = fixture(t, options), before = f.disk()
    const result = await f.service.castExact('QA', 'starburst')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'outcome_unknown')
    assert.equal(result.executionConfirmed, false)
    assert.equal(f.commands.length, 1)
    assert.equal(f.disk(), before)
  }
})

test('mapped native routes share the existing owner lock until their receipt arrives', async t => {
  let release
  const f = fixture(t, { send: () => new Promise(resolve => { release = resolve }) })
  const pending = f.service.castExact('QA', 'rasengan')
  assert.equal((await f.service.castExact('QA', 'heal')).code, 'busy')
  assert.match(await f.service.castByGod('QA', 'heal'), /上一道法术/)
  assert.match(await f.service.castAsOwner('QA', 'heal'), /上一道法术/)
  assert.equal(f.commands.length, 1)
  release('')
  assert.equal((await pending).code, 'outcome_unknown')
})

test('native mapping rejects legacy parameters before sending a command', async t => {
  const f = fixture(t)
  for (const params of [{ distance: 3 }, { direction: '东' }, [], null]) {
    assert.equal((await f.service.castExact('QA', 'meteor', params)).code, 'invalid_params')
  }
  assert.deepEqual(f.commands, [])
})

test('native shortcut bindings preserve eight positions, deduplicate IDs and do not grant learning', t => {
  const f = fixture(t, { player: { learned: ['home', 'rasengan'] } })
  const expected = ['home', 'irons_spellbooks:gust', '', '', 'rasengan', 'irons_spellbooks:heal', '', '']
  assert.deepEqual(f.service.setSkillbar('QA', ['home', 'irons_spellbooks:gust', '', 'irons_spellbooks:gust',
    'rasengan', 'irons_spellbooks:heal', 'minecraft:fireball', 'initiate', 'irons_spellbooks:starfall']), expected)
  const saved = JSON.parse(f.disk()).players.QA
  assert.deepEqual(saved.skillbar, expected)
  assert.deepEqual(saved.learned, ['home', 'rasengan'])
  assert.deepEqual(f.service.getSkillbar('QA'), expected)
  const before = f.disk()
  assert.deepEqual(f.service.getState('QA').skillbar, expected)
  assert.equal(f.disk(), before, 'reading an unequipped native binding never removes it')
  assert.deepEqual(f.service.setSkillbar('QA', ['irons_spellbooks:' + 'a'.repeat(128)]), [''])
})

test('persisted native shortcuts survive controller recreation without native equipment queries or default injection', t => {
  const original = ['home', 'irons_spellbooks:gust', '', 'rasengan', 'irons_spellbooks:heal', '', '', '']
  const f = fixture(t, { player: { learned: ['home', 'rasengan'], skillbar: original } })
  const before = f.disk()
  assert.deepEqual(f.service.getSkillbar('QA'), original)
  assert.equal(f.disk(), before)
  const restarted = fixture(t, { player: JSON.parse(f.disk()).players.QA })
  assert.deepEqual(restarted.service.getSkillbar('QA'), original)
  assert.deepEqual(restarted.commands, [])
  const defaultBar = fixture(t, { player: { learned: ['home'], skillbar: undefined } })
  assert.deepEqual(defaultBar.service.getSkillbar('QA'), ['home'])
  const malformed = fixture(t, { player: { skillbar: ['irons_spellbooks:gust', 'irons_spellbooks:gust',
    'minecraft:heal', 'irons_spellbooks:', 'irons_spellbooks:' + 'a'.repeat(128)] } })
  assert.deepEqual(malformed.service.getSkillbar('QA'), ['irons_spellbooks:gust', '', '', '', ''])
})
