import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { springRcon } from './spring-receipt-fixture.mjs'

const world = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dependencyRoot = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const requireDependency = createRequire(join(dependencyRoot, '.qiandeng-core-test.cjs'))
const { build } = requireDependency('esbuild')
const compiled = mkdtempSync(join(tmpdir(), 'qiandeng-magic-core-module-'))
after(() => rmSync(compiled, { recursive: true, force: true }))
const modulePath = join(compiled, 'mc-magic.mjs')
await build({ entryPoints: [join(world, 'src/mc-magic.ts')], outfile: modulePath,
  bundle: true, platform: 'node', format: 'esm', nodePaths: [dependencyRoot], logLevel: 'silent' })
const { createMagic, SKILLBAR_SLOTS } = await import(pathToFileURL(modulePath).href)
const raw = JSON.parse(readFileSync(join(world, 'data/magic-atoms.json'), 'utf8'))
const atoms = Array.isArray(raw) ? raw : raw.atoms
const consolidatedCatalog = JSON.parse(readFileSync(join(world, '../config/skill-catalog.json'), 'utf8'))

function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qiandeng-magic-core-case-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const clock = { now: 1_788_744_000_000 }
  t.mock.method(Date, 'now', () => clock.now)
  t.mock.method(globalThis, 'setTimeout', () => ({ offline: true }))
  t.mock.method(globalThis, 'setInterval', () => ({ offline: true }))
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden in offline core test') })
  t.mock.method(console, 'log', () => {})
  const players = Object.fromEntries(Object.entries(options.players ?? {}).map(([name, state]) => [name, {
    mana: 1000, maxMana: 1000, maxManaBonus: 0, level: 1, learned: [], lastUpdate: clock.now,
    innateSkill: null, ...state,
  }]))
  const statePath = join(dir, 'state.json')
  writeFileSync(statePath, JSON.stringify({ version: 1, players }))
  const atomsPath = join(dir, 'atoms.json')
  writeFileSync(atomsPath, JSON.stringify({ atoms }))
  const catalogPath = join(dir, 'skill-catalog.json')
  if (options.catalog) writeFileSync(catalogPath, typeof options.catalog === 'string' ? options.catalog : JSON.stringify(options.catalog))
  const commands = []
  const spring = springRcon(options.spring)
  const queries = []
  const position = { x: 10, y: 64, z: 20 }
  const bot = { entity: options.offline ? null : { position },
    players: new Proxy({}, { get: () => ({ entity: { position, yaw: 0, pitch: 0 } }) }),
    world: { getBlock: (p) => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }) } }
  const values = { XpLevel: 50, Health: 20, foodLevel: 20, 'Rotation[0]': 0, 'Rotation[1]': 0, ...options.values }
  const rcon = {
    async getEntityNumber(player, field) {
      queries.push([player, field])
      await options.onQuery?.(player, field)
      return values[field] ?? null
    },
    async getPos() { return position },
    async send(command) {
      commands.push(command)
      if (command.startsWith('qdlocation ')) {
        const actor = JSON.parse(command.slice('qdlocation '.length))
        return 'QD_WARP_JSON ' + JSON.stringify({ schema: 1, action: 'location', ok: true,
          code: 'located', actor, actorUuid: '00000000-0000-0000-0000-000000000001', summary: '位置信息',
          dimension: 'minecraft:overworld', ...position, ...options.origin })
      }
      if (command.startsWith('qdwarp ')) {
        if (options.warp) return options.warp(command)
        const [, actor, dimension, x, y, z] = /^qdwarp ("[^"]+") ("[^"]+") (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(command)
        return 'QD_WARP_JSON ' + JSON.stringify({ schema: 1, action: 'teleport', ok: true,
          code: 'teleported', actor: JSON.parse(actor), actorUuid: '00000000-0000-0000-0000-000000000001', summary: '已确认传送',
          dimension: JSON.parse(dimension), x: Number(x), y: Number(y), z: Number(z) })
      }
      const springReply = await spring.send(command)
      if (springReply !== undefined) return springReply
      if (options.send) return options.send(command)
      if (command.endsWith(' UUID')) return 'Entity has the following data: [I; 1, 2, 3, 4]'
      if (command.startsWith('execute if entity')) return 'No entity found'
      return 'OK'
    },
  }
  const handle = createMagic({ enabled: false, atomsPath, statePath, stateMirrorPath: null,
    balancePath: join(dir, 'balance.json'), maxManaDefault: 1000, regenPerSec: 0 },
  { getBot: () => bot, rcon })
  handle.setSpecialExecutor(async () => ({ ok: true, reply: 'Special effect applied.' }))
  t.after(() => handle.dispose())
  return { service: handle.service, commands, queries, clock, bot, values, statePath, catalogPath, atomsPath,
    usage: () => readFileSync(join(dir, 'skill-usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) }
}

test('the 72-atom catalogue resolves every stable ID and full name without semantic inference', async (t) => {
  assert.equal(atoms.length, 72)
  assert.equal(new Set(atoms.map((a) => a.id)).size, 72)
  const f = fixture(t)
  for (const [index, atom] of atoms.entries()) {
    for (const [kind, key] of [['id', atom.id], ['name', atom.name]]) {
      const result = await f.service.castExact(`QA${index}${kind}`, key)
      assert.equal(result.skillId, atom.id, `${key} resolved to the wrong skill`)
      assert.notEqual(result.code, 'unknown_skill')
      assert.notEqual(result.code, 'ambiguous_skill')
      if (atom.type === 'passive') assert.equal(result.code, 'passive')
    }
  }
})

test('exact alias support rejects ambiguous aliases and arbitrary prose without RCON', async (t) => {
  const f = fixture(t)
  assert.equal((await f.service.castExact('QA', '铁卫')).code, 'ambiguous_skill')
  assert.equal((await f.service.castExact('QA', '请随便给我一个未知法术')).code, 'unknown_skill')
  assert.equal(f.queries.length, 0)
  assert.equal(f.commands.length, 0)
  const result = await f.service.castExact('QA', '缓降')
  assert.equal(result.ok, true)
  assert.equal(result.skillId, 'feather_fall')
})

test('precise names in legacy natural chanting cannot be intercepted by shorter spell words', async (t) => {
  const f = fixture(t)
  const text = await f.service.castSpell('QA', '咏唱：附魔·闪电链')
  assert.equal(typeof text, 'string')
  assert.ok(f.commands.some((c) => c.startsWith('skillenchant ')), 'must use the weapon enchantment command')
  assert.equal(f.usage().at(-1).atom, 'ench_chain_lightning')
  assert.equal(f.service.sniffChant('feather_fall'), true)
})

test('successful unknown spells retain the original learn-on-cast rule and charge the same mana', async (t) => {
  const f = fixture(t)
  assert.deepEqual(f.service.getState('QA').learned, [])
  const result = await f.service.castExact('QA', '羽落')
  assert.equal(result.ok, true)
  assert.equal(result.manaLeft, 992)
  assert.ok(f.service.getState('QA').learned.includes('feather_fall'))
  const natural = await f.service.castSpell('QANatural', '轻如鸿毛')
  assert.equal(typeof natural, 'string')
  assert.equal(f.service.getState('QANatural').mana, 992)
})

test('level and innate exemption remain shared, and mana failure is a typed denial', async (t) => {
  const f = fixture(t, { values: { XpLevel: 0 }, players: { QAPoor: { mana: 0 } } })
  assert.equal((await f.service.castExact('QA', 'feather_fall')).code, 'level')
  f.service.setInnate('QA', 'feather_fall')
  assert.equal((await f.service.castExact('QA', 'feather_fall')).ok, true)
  f.service.setInnate('QAPoor', 'feather_fall')
  assert.equal((await f.service.castExact('QAPoor', 'feather_fall')).code, 'mana')
  assert.equal(f.commands.filter((c) => c.startsWith('effect give QAPoor ')).length, 0)
})

test('passive IDs return a non-cast result even below level without taking resources', async (t) => {
  const f = fixture(t, { values: { XpLevel: 0 } })
  f.service.unlockPassive('QA', 'night_vision')
  const result = await f.service.castExact('QA', 'night_eye')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'passive')
  assert.equal(f.queries.length, 0)
  assert.equal(f.commands.length, 0)
  assert.equal(f.service.getState('QA').mana, 1000)
})

test('structured distance, direction, item and count reach the effect and correct cost', async (t) => {
  const f = fixture(t)
  const tp = await f.service.castExact('QA', 'tp', { distance: '4', direction: 'north' })
  assert.equal(tp.ok, true)
  assert.equal(tp.manaLeft, 960, '20 base + 5 per block')
  assert.ok(f.commands.includes('tp QA 10 64 16'))
  const give = await f.service.castExact('QA', 'give', { item: 'minecraft:torch', count: '3' })
  assert.equal(give.ok, true)
  assert.ok(f.commands.includes('give QA torch 3'))
})

test('invalid parameters never silently clamp, pick bread, or redirect the target', async (t) => {
  const f = fixture(t)
  for (const [skill, params] of [
    ['tp', { distance: -1 }], ['tp', { distance: 31 }], ['tp', { distance: 'Infinity' }],
    ['tp', { direction: 'upward' }], ['tp', { target: '@a' }],
    ['give', { item: 'minecraft:command_block' }], ['give', { count: 0 }],
    ['give', { count: 17 }], ['give', { count: 2.5 }], ['give', { target: 'AnotherPlayer' }],
    ['feather_fall', { item: 'bread' }],
  ]) assert.equal((await f.service.castExact('QA', skill, params)).code, 'invalid_params')
  assert.equal(f.queries.length, 0)
  assert.equal(f.commands.length, 0)
})

test('cooldown rejects same-millisecond duplicates and does not depend on a player name', async (t) => {
  const f = fixture(t)
  for (const name of ['QA', 'Kirito']) {
    assert.equal((await f.service.castExact(name, 'feather_fall')).ok, true)
    const duplicate = await f.service.castExact(name, 'feather_fall')
    assert.equal(duplicate.code, 'cooldown')
    assert.equal(duplicate.cooldownMs, 6000)
  }
  f.clock.now += 6000
  assert.equal((await f.service.castExact('QA', 'feather_fall')).ok, true)
  assert.equal((await f.service.castExact('Kirito', 'feather_fall')).ok, true)
})

test('preflight failures do not consume cooldown or mana', async (t) => {
  const f = fixture(t, { offline: true })
  assert.equal((await f.service.castExact('QA', 'feather_fall')).code, 'offline')
  assert.equal(f.service.getState('QA').mana, 1000)
  f.bot.entity = { position: { x: 10, y: 64, z: 20 } }
  assert.equal((await f.service.castExact('QA', 'feather_fall')).ok, true)
})

test('one in-flight owner lock prevents cross-spell resource races and is released', async (t) => {
  let release
  const gate = new Promise((done) => { release = done })
  let blocked = true
  const f = fixture(t, { onQuery: async () => { if (blocked) await gate } })
  const pending = f.service.castExact('QA', 'feather_fall')
  const overlapping = await f.service.castExact('QA', 'light')
  assert.equal(overlapping.code, 'busy')
  assert.equal(f.commands.length, 0)
  blocked = false
  release()
  assert.equal((await pending).ok, true)
  assert.equal((await f.service.castExact('QA', 'light')).ok, true)
  assert.equal(f.service.getState('QA').mana, 987)
})

test('command rejection is failure and never becomes new learning or successful usage', async (t) => {
  const f = fixture(t, { send: () => 'Invalid components: malformed value' })
  const result = await f.service.castExact('QA', 'feather_fall')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'command_failed')
  assert.equal(f.service.getState('QA').learned.includes('feather_fall'), false)
  assert.equal(f.usage().at(-1).success, false)
  assert.equal((await f.service.castExact('QA', 'feather_fall')).code, 'cooldown')
})

test('blood conversion requires readable safe health and reports actual gained mana', async (t) => {
  const f = fixture(t, { values: { Health: null }, players: { QA: { mana: 100 } } })
  assert.equal((await f.service.castExact('QA', 'blood_mana')).code, 'health')
  assert.equal(f.service.getState('QA').mana, 100)
  f.values.Health = 20
  const result = await f.service.castExact('QA', 'blood_mana')
  assert.equal(result.ok, true)
  assert.equal(result.manaLeft, 115)
  assert.match(result.summary, /换取魔力 15/)
})

test('a rejected blood sacrifice never credits mana or teaches the spell', async (t) => {
  const f = fixture(t, { players: { QA: { mana: 100 } },
    send: (command) => command.startsWith('damage ') ? 'That entity is invulnerable' : 'OK' })
  const result = await f.service.castExact('QA', 'blood_mana')
  assert.equal(result.code, 'command_failed')
  assert.equal(result.manaLeft, 100)
  assert.equal(f.service.getState('QA').learned.includes('blood_mana'), false)
})

test('transport interruption is never retried and the owner lock is released', async (t) => {
  let fail = true
  const f = fixture(t, { send: () => { if (fail) throw new Error('socket closed after write'); return 'OK' } })
  assert.equal((await f.service.castExact('QA', 'feather_fall')).code, 'execution_error')
  const attempts = f.commands.length
  assert.equal((await f.service.castExact('QA', 'feather_fall')).code, 'cooldown')
  assert.equal(f.commands.length, attempts)
  fail = false
  assert.equal((await f.service.castExact('QA', 'light')).ok, true)
})

test('visual failure does not claim that an already-applied spell failed', async (t) => {
  const f = fixture(t, { send: (command) => {
    if (command.startsWith('particle ')) throw new Error('visual channel interrupted')
    return 'OK'
  } })
  const result = await f.service.castExact('QA', 'feather_fall')
  assert.equal(result.ok, true)
  assert.ok(f.service.getState('QA').learned.includes('feather_fall'))
  assert.ok(f.commands.some((c) => c.startsWith('effect give QA ')))
})

test('eight-slot bars keep positions, exclude passive and unknown entries, and return copies', (t) => {
  assert.equal(SKILLBAR_SLOTS, 8)
  const known = ['heal', 'rasengan', 'chain_lightning', 'fireburst', 'swift', 'home', 'light', 'feather_fall', 'night_eye']
  const f = fixture(t, { players: { QA: { learned: known }, QAFresh: { learned: [] } } })
  assert.equal(f.service.getSkillbar('QA').length, 8)
  assert.ok(!f.service.getSkillbar('QA').includes('night_eye'))
  const bar = f.service.setSkillbar('QA', ['heal', 'heal', 'night_eye', 'missing', '', 'light', 'home', 'feather_fall', 'swift'])
  assert.deepEqual(bar, ['heal', '', '', '', '', 'light', 'home', 'feather_fall'])
  bar[0] = 'external mutation'
  const copy = f.service.getSkillbar('QA')
  assert.equal(copy[0], 'heal')
  copy[0] = 'external mutation'
  assert.equal(f.service.getSkillbar('QA')[0], 'heal')
  assert.deepEqual(f.service.getSkillbar('QAFresh'), [])
  f.service.learnViaAdvancement('QAFresh', 'light')
  assert.deepEqual(f.service.getSkillbar('QAFresh'), ['light'])
})

test('public parameter schemas are copies and reveal the bounded give count', (t) => {
  const f = fixture(t)
  const schema = f.service.getAtomById('tp')
  schema.params.distance.max = -1
  assert.equal(f.service.getAtomById('tp').params.distance.max, 30)
  assert.deepEqual(f.service.getAtomById('give').params.count, { type: 'number', min: 1, max: 16, default: 4 })
})

test('consolidated catalogue covers every atom, preserves passive metadata, and exposes copied policy/icons', (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog })
  const list = f.service.listAtoms()
  assert.equal(list.length, 72)
  assert.equal(list.filter((a) => a.catalog.status === 'featured').length, 8)
  assert.equal(list.filter((a) => a.catalog.status === 'archived').length, 64)
  assert.equal(list.filter((a) => a.type === 'passive').length, 7)
  const archive = f.service.getAtomById('chain_lightning')
  archive.catalog.nativeHints.push('fake:mutation')
  archive.catalog.reason = 'changed'
  assert.deepEqual(f.service.getAtomById('chain_lightning').catalog.nativeHints, ['irons_spellbooks:chain_lightning'])
  assert.notEqual(f.service.getAtomById('chain_lightning').catalog.reason, 'changed')
  assert.equal(f.service.getAtomById('sky_walk').icon, 'minecraft:elytra')
  assert.equal(f.service.getAtomById('night_eye').passiveId, 'night_vision')
  assert.notEqual(f.service.getAtomById('feather_boots').type, 'passive')
})

test('every archived active ID is blocked across exact, chant, semantic, divine and owner routes before any world access', async (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog,
    players: { QA: { innateSkill: 'chain_lightning', learned: atoms.map((a) => a.id), mana: 25 } } })
  const initialDisk = readFileSync(f.statePath, 'utf8')
  for (const atom of atoms.filter((a) => a.type !== 'passive' && consolidatedCatalog.archived[a.id])) {
    for (const key of [atom.id, atom.name]) {
      const result = await f.service.castExact('QA', key, { deliberatelyInvalid: 1 })
      assert.equal(result.code, 'skill_archived', key)
      assert.equal(result.ok, false)
      assert.equal(result.skillId, atom.id)
      assert.deepEqual(result.nativeHints, consolidatedCatalog.archived[atom.id].nativeHints)
    }
    assert.match(await f.service.castSpell('QA', `咏唱：${atom.name}`), /已归档/, atom.id)
    assert.match(await f.service.castFuzzy('QA', '含糊表达', atom.id, { mode: 'llm', tokens: 999 }), /已归档/, atom.id)
    assert.match(await f.service.castByGod('QA', atom.id, { consumeMana: 80 }), /已归档/, atom.id)
    assert.match(await f.service.castAsOwner('QA', atom.id), /已归档/, atom.id)
  }
  assert.deepEqual(f.commands, [])
  assert.deepEqual(f.queries, [])
  assert.equal(readFileSync(f.statePath, 'utf8'), initialDisk, 'denial must not learn, charge or rewrite progress')
})

test('archived passives retain their no-cast response and permanent rewards', async (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog, players: { QA: {
    learned: ['night_eye', 'aura_healing'], passives: ['night_vision', 'fortitude'],
    passiveProgress: { night_vision: 87, fortitude: 30 }, maxManaBonus: 25,
  } } })
  for (const atom of atoms.filter((a) => a.type === 'passive')) {
    assert.equal((await f.service.castExact('QA', atom.id)).code, 'passive')
    assert.match(await f.service.castByGod('QA', atom.id), /被动/)
  }
  assert.equal(f.service.hasPassive('QA', 'night_vision'), true)
  assert.equal(f.service.hasPassive('QA', 'fortitude'), true, 'passives outside atom IDs must survive')
  assert.equal(f.service.getPassiveProgress('QA', 'night_vision'), 87)
  assert.equal(f.service.getState('QA').maxManaBonus, 25)
  assert.deepEqual(f.commands, [])
  assert.deepEqual(f.queries, [])
})

test('archived slot IDs are hidden in-place without rewriting existing saved slots or learned/innate history', (t) => {
  const original = ['heal', 'home', '', 'chain_lightning', 'tp', 'night_eye', 'give', 'fireworks']
  // A passive slot is invalid even in the original system; test only existing valid active slots here.
  original[5] = 'feather_fall'
  const f = fixture(t, { catalog: consolidatedCatalog, players: { QA: {
    learned: atoms.map((a) => a.id), innateSkill: 'chain_lightning', skillbar: original,
  } } })
  const before = readFileSync(f.statePath, 'utf8')
  const expected = ['', 'home', '', '', 'tp', '', 'give', 'fireworks']
  assert.deepEqual(f.service.getSkillbar('QA'), expected)
  assert.deepEqual(f.service.getState('QA').skillbar, expected)
  assert.equal(readFileSync(f.statePath, 'utf8'), before)
  assert.equal(f.service.getInnate('QA'), 'chain_lightning')
  assert.ok(f.service.getState('QA').learned.includes('heal'))
})

test('default bars use featured order and new archived bindings cannot enter a slot', (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog, players: { QA: { learned: atoms.map((a) => a.id) } } })
  assert.deepEqual(f.service.getSkillbar('QA'), consolidatedCatalog.featured)
  assert.deepEqual(f.service.setSkillbar('QA', ['heal', '', 'home', 'chain_lightning', 'fireworks']), ['', '', 'home', '', 'fireworks'])
  assert.deepEqual(f.service.getSkillbar('QA'), ['', '', 'home', '', 'fireworks'])
})

test('featured active spells keep the common cost/cooldown and learn-on-success rules', async (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog, players: { QA: { mana: 100 } } })
  const first = await f.service.castExact('QA', 'feather_boots')
  assert.equal(first.ok, true)
  assert.equal(first.manaLeft, 80)
  assert.ok(f.commands.some((c) => c.startsWith('execute at QA run give QA minecraft:leather_boots') && c.includes('featherfall')))
  assert.ok(f.service.getState('QA').learned.includes('feather_boots'))
  const attempts = f.commands.length
  assert.equal((await f.service.castExact('QA', 'feather_boots')).code, 'cooldown')
  assert.equal(f.commands.length, attempts)
})

test('present malformed, unknown, duplicate and incomplete catalogues fail closed at startup', (t) => {
  const cases = [
    '{ broken',
    { ...consolidatedCatalog, schema: 2 },
    { ...consolidatedCatalog, featured: [...consolidatedCatalog.featured, 'home'] },
    { ...consolidatedCatalog, featured: [...consolidatedCatalog.featured, 'fake_skill'] },
    { ...consolidatedCatalog, featured: consolidatedCatalog.featured.filter((id) => id !== 'home') },
    { ...consolidatedCatalog, archived: { ...consolidatedCatalog.archived, home: { kind: 'redundant', reason: 'duplicate', nativeHints: [] } } },
    { ...consolidatedCatalog, archived: { ...consolidatedCatalog.archived, night_eye: { kind: 'redundant', reason: 'wrong passive', nativeHints: [] } } },
    JSON.stringify(consolidatedCatalog).replace('"schema":1', '"schema":1,"schema":1'),
  ]
  for (const catalog of cases) assert.throws(() => fixture(t, { catalog }), /[Ii]nvalid skill catalogue/)
})

test('failed or deleted hot-reload catalogue leaves the previous archive gate active', async (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog })
  writeFileSync(f.catalogPath, JSON.stringify({ ...consolidatedCatalog, featured: [] }))
  assert.throws(() => f.service.reloadAtoms(), /[Ii]nvalid skill catalogue/)
  assert.equal((await f.service.castExact('QA', 'heal')).code, 'skill_archived')
  rmSync(f.catalogPath)
  assert.throws(() => f.service.reloadAtoms(), /catalogue disappeared/)
  assert.equal((await f.service.castExact('QA', 'heal')).code, 'skill_archived')
  assert.deepEqual(f.queries, [])
  assert.deepEqual(f.commands, [])
})

test('read-only appraisal remains supported in legacy fixtures without a catalogue', async (t) => {
  const f = fixture(t)
  const fixtureAtoms = JSON.parse(readFileSync(f.atomsPath, 'utf8')).atoms
  fixtureAtoms.push({ id: 'appraise', name: '鉴定', words: ['鉴定'], layer: 'effect',
    cost: { mana: 0, food: 0, hp: 0 }, commands: [], reply: '' })
  writeFileSync(f.atomsPath, JSON.stringify({ atoms: fixtureAtoms }))
  f.service.reloadAtoms()
  assert.equal((await f.service.castExact('QA', 'appraise')).ok, true)
  assert.ok(f.commands.some((c) => c.startsWith('tellraw QA ')))
  assert.equal(f.commands.some((c) => c.startsWith('give ') || c.startsWith('effect ') || c.startsWith('tp ')), false)
})

test('featured home returns to overworld and directional teleport stays in the real actor dimension', async (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog,
    origin: { dimension: 'minecraft:the_nether', x: 200, y: 75, z: -20 }, players: { QA: { mana: 200 } } })
  assert.equal((await f.service.castExact('QA', 'home')).ok, true)
  assert.ok(f.commands.includes('qdwarp "QA" "minecraft:overworld" -540 64 868'))
  assert.equal((await f.service.castExact('QA', 'tp', { direction: '东', distance: 5 })).ok, true)
  assert.ok(f.commands.includes('qdwarp "QA" "minecraft:the_nether" 205 75 -20'))
  assert.equal(f.commands.some(c => /^tp | run tp /.test(c)), false)
  assert.equal(f.service.getState('QA').mana, 200 - 20 - 45)
  assert.ok(f.commands.some(c => c.startsWith('execute at QA run playsound') && c.includes('205 75 -20')))
})

test('failed native teleport never charges or teaches, and ambiguous outcomes cannot be replayed immediately', async (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog, players: { QA: { mana: 100 } },
    warp: () => 'QD_WARP_JSON ' + JSON.stringify({ schema: 1, action: 'teleport', actor: 'QA',
      ok: false, code: 'unsafe_destination', summary: '找不到安全落点' }) })
  assert.equal((await f.service.castExact('QA', 'home')).code, 'unavailable')
  assert.equal(f.service.getState('QA').mana, 100)
  assert.equal(f.service.getState('QA').learned.includes('home'), false)
  const unknown = fixture(t, { catalog: consolidatedCatalog, players: { QA: { mana: 100 } },
    warp: () => { throw new Error('connection lost after write') } })
  assert.equal((await unknown.service.castExact('QA', 'home')).code, 'outcome_unknown')
  assert.equal(unknown.service.getState('QA').mana, 100)
  assert.equal((await unknown.service.castExact('QA', 'home')).code, 'cooldown')
  assert.equal(unknown.commands.filter(c => c.startsWith('qdwarp ')).length, 1)
  assert.equal(unknown.service.getState('QA').learned.includes('home'), false)
})

test('featured spatial commands and effects use actor coordinates and execute-at dimension, not observer cache', async (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog,
    origin: { dimension: 'minecraft:the_nether', x: 200, y: 75, z: -20 } })
  assert.equal((await f.service.castExact('QA', 'spring', { direction: '东', distance: 2 })).ok, true)
  assert.ok(f.commands.some(c => c.endsWith('if dimension minecraft:the_nether run setblock 202 74 -20 minecraft:water')))
  assert.equal((await f.service.castExact('QA', 'fireworks')).ok, true)
  assert.ok(f.commands.includes('execute at QA run summon minecraft:firework_rocket 200 76 -20 {LifeTime:20}'))
  assert.ok(f.commands.filter(c => c.includes('particle ') || c.includes('playsound ')).every(c => c.startsWith('execute at QA run ')))
})

test('rejected or interrupted featured effects do not debit mana, learn, or blindly replay', async (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog, players: { QA: { mana: 100 } },
    spring: { success: 0, result: 0 } })
  assert.equal((await f.service.castExact('QA', 'spring')).code, 'command_failed')
  assert.equal(f.service.getState('QA').mana, 100)
  assert.equal(f.service.getState('QA').learned.includes('spring'), false)
  const interrupted = fixture(t, { catalog: consolidatedCatalog, players: { QA: { mana: 100 } },
    send: (command) => { if (command.includes('summon ')) throw new Error('closed after write'); return 'OK' } })
  assert.equal((await interrupted.service.castExact('QA', 'fireworks')).code, 'execution_error')
  assert.equal(interrupted.service.getState('QA').mana, 100)
  assert.equal((await interrupted.service.castExact('QA', 'fireworks')).code, 'cooldown')
  assert.equal(interrupted.commands.filter(c => c.includes('summon ')).length, 1)
})

test('divine featured travel also uses the native dimension bridge and charges only confirmed movement', async (t) => {
  const f = fixture(t, { catalog: consolidatedCatalog, origin: { dimension: 'minecraft:the_end', x: 50, y: 80, z: 60 },
    players: { QA: { mana: 100 } } })
  assert.match(await f.service.castByGod('QA', 'tp', { distance: 3, direction: '西', consumeMana: 12 }), /神力代施/)
  assert.ok(f.commands.includes('qdwarp "QA" "minecraft:the_end" 47 80 60'))
  assert.equal(f.service.getState('QA').mana, 88)
  const bad = fixture(t, { catalog: consolidatedCatalog, players: { QA: { mana: 100 } }, warp: () => '' })
  assert.match(await bad.service.castByGod('QA', 'home', { consumeMana: 12 }), /不要自动重发/)
  assert.equal(bad.service.getState('QA').mana, 100)
})

test('spring existing water and unattributed observed water do not debit or teach', async (t) => {
  for (const [spring, code] of [[{ beforeWater: 1 }, 'no_change'],
    [{ success: -1, result: -1, lostResponse: true }, 'outcome_unknown']]) {
    const f = fixture(t, { catalog: consolidatedCatalog, players: { QA: { mana: 100 } }, spring })
    const result = await f.service.castExact('QA', 'spring')
    assert.equal(result.code, code)
    assert.equal(result.ok, false)
    assert.equal(f.service.getState('QA').mana, 100)
    assert.equal(f.service.getState('QA').learned.includes('spring'), false)
  }
})
