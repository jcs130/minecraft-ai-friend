import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Only the application module and its pure contracts are loaded. No bootstrap,
// production storage, provider, Minecraft connection or server fixture is used.
const world = resolve(import.meta.dirname, '..')
const modules = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const { build } = createRequire(join(modules, '.qd-tests.cjs'))('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'qd-player-commands-'))
after(() => {
  const target = resolve(temp), inside = relative(resolve(tmpdir()), target)
  assert.ok(inside && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside),
    'Refuse cleanup outside the resolved temporary directory')
  assert.ok(basename(target).startsWith('qd-player-commands-'), 'Refuse cleanup of an unrelated directory')
  rmSync(target, { recursive: true, force: true })
})
const bundled = await build({ absWorkingDir: world,
  entryPoints: { commands: 'src/application/player-commands.ts', parser: 'src/gameplay/commands/player-cli.ts' },
  outdir: temp, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
  packages: 'external', metafile: true, logLevel: 'silent' })
const { createPlayerCommands, EXTENDED_PLAYER_COMMANDS } = await import(pathToFileURL(join(temp, 'commands.mjs')).href)
const { parseCli, CLI_VERBS } = await import(pathToFileURL(join(temp, 'parser.mjs')).href)
const UUID = '00000000-0000-0000-0000-000000000001'
const clone = value => structuredClone(value)
const atom = (id, name, extra = {}) => ({ id, name, words: [name], type: 'active',
  cost: { mana: 5, food: 0, hp: 0 }, requiredLevel: 1, icon: 'minecraft:paper', ...extra })

function fixture() {
  const calls = [], messages = [], behaviors = {}, cooldowns = new Map()
  const atoms = [
    atom('fireworks', '烟花术', { icon: 'minecraft:firework_rocket', catalog: { status: 'featured' } }),
    atom('tp', '空间传送', { words: ['传送'], catalog: { status: 'featured' } }),
    atom('new_skill', '新术', { catalog: { status: 'featured' } }),
    atom('heal', '圣愈术', { catalog: { status: 'archived', reason: '使用原生治疗', nativeHints: ['irons_spellbooks:heal'] } }),
    atom('night_vision', '夜视', { type: 'passive', passiveId: 'night_eyes', catalog: { status: 'passive' } }),
    atom('appraise', '鉴定', { catalog: { status: 'archived', reason: '原生状态替代' } }),
  ]
  const state = { mana: 95, maxMana: 100, maxManaBonus: 0, learned: ['fireworks', 'tp', 'heal'],
    advancementSkills: [], innateSkill: null, backstory: '测试旅人', level: 50, passives: [],
    hpRatio: 1, foodRatio: 1, manaPerSec: 0.1, skillbar: ['fireworks', 'tp'] }
  const entries = [
    { index: 1, scope: 'shared', ref: 'shared:1', waypoint: { id: 1, name: '广场', x: 1, y: 64, z: 3, dim: 'minecraft:overworld', createdAt: 1 } },
    { index: 9, scope: 'personal', ref: 'personal:6', waypoint: { id: 6, name: '远方的家', x: 12.5, y: 70, z: 34.5, dim: 'minecraft:the_nether', createdAt: 2 } },
  ]
  const native = (action, actor, extra = {}) => ({ schema: 1, engine: 'irons_spellbooks',
    action, actor, actorUuid: UUID, ok: true, code: 'ok', summary: '原生回执', ...extra })
  const travel = (actor, extra = {}) => ({ schema: 1, action: 'location', actor, actorUuid: UUID,
    ok: true, code: 'ok', summary: '当前位置', dimension: 'minecraft:the_nether', x: 12.5, y: 70, z: 34.5, ...extra })
  const record = (name, fn) => (...args) => {
    calls.push({ name, args: args.map(value => Array.isArray(value) ? [...value] : value) })
    return (behaviors[name] || fn)(...args)
  }
  const deps = {
    magic: {
      listAtoms: record('magic.listAtoms', () => clone(atoms)),
      getAtomById: record('magic.getAtomById', id => clone(atoms.find(a => a.id === id) || null)),
      getInnate: record('magic.getInnate', () => state.innateSkill ? atoms.find(a => a.id === state.innateSkill)?.name : null),
      setInnate: record('magic.setInnate', (_actor, id) => { state.innateSkill = id }),
      getState: record('magic.getState', () => clone(state)),
      getSkillbar: record('magic.getSkillbar', () => [...state.skillbar]),
      setSkillbar: record('magic.setSkillbar', (_actor, bar) => { state.skillbar = [...bar]; return [...bar] }),
      castExact: record('magic.castExact', async (_actor, id) => ({ ok: true, code: 'ok', skillId: id, summary: '中文技能回执', manaLeft: 90 })),
      castAsOwner: record('magic.castAsOwner', async () => '代主人执行回执'),
      learnViaAdvancement: record('magic.learnViaAdvancement', (_actor, id) => { state.learned.push(id) }),
      unlockPassive: record('magic.unlockPassive', (_actor, id) => { state.passives.push(id); return true }),
    },
    rcon: { send: record('rcon.send', async command => {
      if (command.endsWith(' Pos')) return 'Probe has the following entity data: [12.5d, 70.0d, 34.5d]'
      if (command.endsWith(' Inventory')) return 'skillbook:"新术" skillbook:"夜视"'
      if (command.startsWith('give ')) return 'Gave item to player'
      return 'Command completed'
    }) },
    irons: {
      request: record('irons.request', async (action, actor) => native(action, actor, action === 'status'
        ? { level: 50, mana: 71, maxMana: 200, attributes: { health: 18, maxHealth: 24 }, casting: { active: false } }
        : action === 'list' ? { spells: [{ id: 'irons_spellbooks:firebolt', name: '火焰弹', level: 1, mana: 8, cooldownMs: 0 }] } : {})),
      cast: record('irons.cast', async (actor, skill) => native('cast', actor, { code: 'casting_started', phase: 'casting', accepted: true, spellId: skill })),
    },
    worlddb: {
      chronicleRecord: record('worlddb.chronicleRecord', () => undefined),
      discoveryList: record('worlddb.discoveryList', () => [{ id: 7, name: '远方', x: 1.5, z: 4.5, found_by: 'Owner' }]),
      discoveryRename: record('worlddb.discoveryRename', () => true),
    },
    waypoints: {
      listWithRefs: record('waypoints.listWithRefs', () => clone(entries)),
      getStatus: record('waypoints.getStatus', () => ({ available: true, mirrorOk: true })),
      resolve: record('waypoints.resolve', (_owner, query) => {
        const entry = entries.find(e => e.ref === query || e.waypoint.name === query)
        return entry ? { status: 'found', entry: clone(entry) } : { status: 'not_found' }
      }),
      allFor: record('waypoints.allFor', () => clone(entries.map(e => e.waypoint))),
      add: record('waypoints.add', (_owner, name, x, y, z, dim) => {
        const waypoint = { id: 11, name, x, y, z, dim, createdAt: 3 }
        entries.push({ index: 10, scope: 'personal', ref: 'personal:11', waypoint }); return clone(waypoint)
      }),
      removeRef: record('waypoints.removeRef', () => clone(entries[1].waypoint)),
      remove: record('waypoints.remove', () => clone(entries[1].waypoint)),
    },
    waypointTravel: { location: record('waypointTravel.location', async actor => travel(actor)) },
    tpWaypoint: record('tpWaypoint', async (actor, wp) => travel(actor, { action: 'teleport', code: 'teleported', dimension: wp.dim, x: wp.x, y: wp.y, z: wp.z })),
    resolveLogin: record('resolveLogin', name => name === '鸣人' ? 'Naruto' : name),
    skillBookItem: record('skillBookItem', () => 'minecraft:written_book'),
    parseNbtPosition: record('parseNbtPosition', text => text.includes('entity data:') ? [12.5, 70, 34.5] : null),
    queryNativeProgression: record('queryNativeProgression', async (_rcon, actor) => ({ schema_version: 1, player: actor,
      ok: true, code: null, source: 'puffish_skills_api', categories: [{ id: 'puffish_skills:combat',
        available: true, code: null, level: 0, experience: 0, points_total: 0, points_spent: 0, points_left: 0 }] })),
    nativeProgressionLines: record('nativeProgressionLines', () => ['原生技艺点：0']),
    cliWhisper: (target, text) => messages.push({ target, text }),
    bubble: { show: record('bubble.show', () => undefined) },
    now: record('now', () => 100_000),
    getCultivationCooldowns: record('getCultivationCooldowns', () => cooldowns),
    extendedCommand: record('extendedCommand', () => assert.fail('Ordinary CLI must not call chat, prayer or guard integration')),
  }
  const app = createPlayerCommands(deps)
  const called = name => calls.filter(call => call.name === name)
  const dispatch = async (body, options = {}) => {
    const cmd = options.cmd || parseCli(`/mycli ${body}${options.json === false ? '' : ' --json'}`)
    assert.ok(cmd)
    const receipts = []
    await app.handleCli(options.subject || 'Owner', options.replyTarget || 'sys_Owner', cmd,
      options.guardian || false, options.capture === false ? undefined : result => receipts.push(result))
    return receipts
  }
  return { app, deps, calls, called, messages, behaviors, state, atoms, entries, cooldowns, native, travel, dispatch }
}

test('application bundles without provider, Bot, filesystem, network or package runtime imports', () => {
  for (const output of Object.values(bundled.metafile.outputs)) assert.deepEqual(output.imports, [])
  for (const path of Object.keys(bundled.metafile.inputs)) {
    assert.match(path.replaceAll('\\', '/'), /^src\/(application|gameplay)\//)
    assert.doesNotMatch(path, /(?:providers|mc-god|bootstrap|infrastructure)/)
  }
})

test('every declared verb help, explicit help and parse errors perform zero port calls', async () => {
  for (const verb of CLI_VERBS) {
    const f = fixture(), [result] = await f.dispatch(`${verb.id} --help`)
    assert.equal(result.ok, true); assert.equal(result.command, verb.id); assert.ok(result.help.length)
    assert.deepEqual(f.calls, []); assert.deepEqual(f.messages, [])
  }
  for (const body of ['help', 'commands', 'help 咏唱', 'caast tp', 'please cast tp', 'cast "unfinished']) {
    const f = fixture(), result = await f.dispatch(body)
    assert.equal(result.length, 1); assert.deepEqual(f.calls, [])
    if (/caast|please|unfinished/.test(body)) assert.equal(result[0].code, 'invalid_command')
  }
})

const ordinaryCases = {
  'staff-cast': 'staff-cast 1',
  commands: 'commands', help: 'help', menu: 'menu', status: 'status', skills: 'skills',
  spells: 'spells', cast: 'cast fireworks', cancel: 'cancel', 'guardian-cast': 'guardian-cast fireworks',
  innate: 'innate', appraise: 'appraise', discoveries: 'discoveries', cultivate: 'cultivate',
  skillbar: 'skillbar', bookget: 'bookget fireworks', learn: 'learn 新术',
  goto: 'goto personal:6', waypoint: 'waypoint list', growth: 'growth',
}
test('every ordinary command executes without the optional intelligent integrations', async () => {
  assert.deepEqual(CLI_VERBS.filter(v => !EXTENDED_PLAYER_COMMANDS.has(v.id)).map(v => v.id).sort(), Object.keys(ordinaryCases).sort())
  for (const body of Object.values(ordinaryCases)) {
    const f = fixture(), receipts = await f.dispatch(body, { guardian: true })
    assert.ok(receipts.length, body)
    assert.equal(f.called('extendedCommand').length, 0, body)
    assert.deepEqual(f.messages, [], body)
  }
})

test('only explicit extended commands forward the exact trusted subject, reply target and capture', async () => {
  for (const verb of EXTENDED_PLAYER_COMMANDS) {
    const f = fixture(), capture = () => {}, cmd = { verb, args: ['保留原文'], json: true, wantHelp: false, raw: verb }
    f.behaviors.extendedCommand = async (...args) => assert.deepEqual(args, ['Owner', 'sys_Owner', cmd, true, capture])
    await f.app.handleCli('Owner', 'sys_Owner', cmd, true, capture)
    assert.deepEqual(f.calls.map(call => call.name), ['extendedCommand'])
  }
})

test('missing optional integration returns unavailable while ordinary status remains usable', async () => {
  const f = fixture(); delete f.deps.extendedCommand
  const [result] = await f.dispatch('chat 你好')
  assert.equal(result.code, 'integration_unavailable'); assert.equal(result.ok, false)
  assert.deepEqual(f.calls, []); assert.equal((await f.dispatch('status'))[0].ok, true)
})

test('guardian permission comes only from the ingress flag, never the sys_ spelling', async () => {
  for (const replyTarget of ['sys_Owner', 'Owner', 'sys_Administrator']) {
    const f = fixture(), [result] = await f.dispatch('guardian-cast fireworks', { replyTarget })
    assert.equal(result.ok, false); assert.equal(f.called('magic.castAsOwner').length, 0)
    assert.deepEqual(f.calls, [])
  }
  const f = fixture()
  await f.dispatch('guardian-cast 烟花术', { guardian: true, capture: false })
  assert.deepEqual(f.called('magic.castAsOwner').map(c => c.args), [['Owner', 'fireworks']])
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].target, 'sys_Owner')
  assert.equal(f.called('magic.castExact').length, 0)
})

test('JSON private feedback keeps the complete original native receipt, with no public or duplicate reply', async () => {
  const f = fixture(), raw = f.native('cast', 'Owner', { ok: false, code: 'outcome_unknown',
    summary: '中文"引号"\\路径\n下一行', raw: '扩展内容'.repeat(1500), nullable: null, zero: 0, accepted: false })
  f.behaviors['irons.cast'] = async () => raw
  await f.dispatch('cast irons_spellbooks:firebolt', { capture: false })
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].target, 'sys_Owner')
  assert.deepEqual(JSON.parse(f.messages[0].text.slice('[CLI] '.length)), raw)
  const captured = await f.dispatch('cast irons_spellbooks:firebolt')
  assert.deepEqual(captured, [raw]); assert.equal(f.messages.length, 1)
  assert.equal(f.called('irons.cast').length, 2) // One call per explicit invocation, no internal retry.
})

test('status reads the owner and keeps native and legacy mana plus native zero progression distinct', async () => {
  const f = fixture(), [result] = await f.dispatch('status')
  assert.equal(result.mana, 95); assert.equal(result.native.mana, 71)
  assert.equal(result.hp, 18); assert.equal(result.maxHp, 24)
  assert.equal(result.progression.categories[0].points_left, 0)
  assert.deepEqual(f.called('magic.getState').map(c => c.args), [['Owner']])
  assert.deepEqual(f.called('irons.request').map(c => c.args), [['status', 'Owner']])
  await f.dispatch('status', { json: false, capture: false })
  assert.ok(f.messages.some(m => m.text.includes('秘术魔力')))
  assert.ok(f.messages.every(m => m.target === 'sys_Owner'))
})

test('native offline, ambiguity and UUID status never create or read legacy player state', async () => {
  for (const code of ['actor_not_found', 'ambiguous_actor']) {
    const f = fixture(); f.behaviors['irons.request'] = async (action, actor) => f.native(action, actor, { ok: false, code })
    const [result] = await f.dispatch('status')
    assert.equal(result.code, code); assert.equal(result.ok, false)
    assert.equal(f.called('magic.getState').length, 0); assert.equal(f.called('magic.getInnate').length, 0)
  }
  const f = fixture(), [result] = await f.dispatch('status', { subject: UUID })
  assert.equal(result.actor, UUID); assert.equal(f.called('magic.getState').length, 0)
  assert.deepEqual(f.called('queryNativeProgression')[0].args.slice(1), [UUID])
})

test('featured, archived and native lists are separate and invalid pages request nothing', async () => {
  const f = fixture()
  const featured = (await f.dispatch('spells legacy'))[0]
  assert.match(JSON.stringify(featured), /fireworks/); assert.doesNotMatch(JSON.stringify(featured), /"heal"|night_vision/)
  const archive = (await f.dispatch('spells archive'))[0]
  assert.match(JSON.stringify(archive), /"heal"/); assert.doesNotMatch(JSON.stringify(archive), /fireworks/)
  const skills = (await f.dispatch('skills'))[0]
  assert.doesNotMatch(JSON.stringify(skills), /"heal"|night_vision/)
  const native = (await f.dispatch('spells'))[0]
  assert.equal(native.spells[0].id, 'irons_spellbooks:firebolt')
  for (const body of ['spells irons 2', 'spells archive 0', 'spells legacy NaN', 'spells random']) {
    const invalid = fixture(), [result] = await invalid.dispatch(body)
    assert.equal(result.code, 'invalid_params'); assert.deepEqual(invalid.calls, [])
  }
})

test('skillbar slot 8 moves an existing skill without compacting holes or duplicating it', async () => {
  const f = fixture(), [result] = await f.dispatch('skillbar set 8 烟花术')
  assert.deepEqual(f.state.skillbar, ['', 'tp', '', '', '', '', '', 'fireworks'])
  assert.deepEqual(result.skillbar.map(item => [item.slot, item.id]), [[2, 'tp'], [8, 'fireworks']])
  assert.deepEqual(f.called('magic.setSkillbar')[0].args, ['Owner', f.state.skillbar])
  await f.dispatch('skillbar clear 2')
  assert.equal(f.state.skillbar[1], ''); assert.equal(f.state.skillbar[7], 'fireworks')
})

test('skillbar rejects invalid slots, unknown, passive, archived and unlearned skills without writes', async () => {
  for (const [body, code] of [['set 9 fireworks', 'invalid_slot'], ['set 1 no_such_skill', 'unknown_skill'],
    ['set 1 night_vision', 'passive'], ['set 1 heal', 'skill_archived'], ['set 1 new_skill', 'not_learned'], ['typo', 'invalid_subcommand']]) {
    const f = fixture(), before = clone(f.state), [result] = await f.dispatch(`skillbar ${body}`)
    assert.equal(result.code, code); assert.equal(f.called('magic.setSkillbar').length, 0)
    assert.deepEqual(f.state, before)
  }
})

test('cast forwards slot 8 and typed parameters once and emits a bubble only for success', async () => {
  const f = fixture(); f.state.skillbar = ['', '', '', '', '', '', '', 'tp']
  const result = await f.app.castUnified('Owner', ['8', 'distance=5', 'direction=东'])
  assert.equal(result.slot, 8)
  const [actor, id, params] = f.called('magic.castExact')[0].args
  assert.equal(actor, 'Owner'); assert.equal(id, 'tp'); assert.deepEqual({ ...params }, { distance: 5, direction: '东' })
  assert.deepEqual(f.called('bubble.show').map(c => c.args[0]), ['Owner'])
  assert.equal(f.called('irons.cast').length, 0)
})

test('cast failures, including archived and uncertain outcomes, are returned once with no fallback or bubble', async () => {
  for (const code of ['offline', 'skill_archived', 'outcome_unknown', 'command_failed', 'mana']) {
    const f = fixture(), raw = { ok: false, code, summary: '明确失败', manaLeft: 95, cooldownMs: 0 }
    f.behaviors['magic.castExact'] = async () => raw
    assert.deepEqual(await f.app.castUnified('Owner', ['fireworks']), raw)
    assert.equal(f.called('magic.castExact').length, 1)
    for (const name of ['irons.cast', 'extendedCommand', 'bubble.show']) assert.equal(f.called(name).length, 0)
  }
  const f = fixture(), error = new Error('interrupted after dispatch')
  f.behaviors['magic.castExact'] = async () => { throw error }
  await assert.rejects(f.app.castUnified('Owner', ['fireworks']), e => e === error)
  assert.equal(f.called('magic.castExact').length, 1); assert.equal(f.called('extendedCommand').length, 0)
})

test('native cast and UUID routing preserve native semantics without a legacy state lookup', async () => {
  const f = fixture(), result = await f.app.castUnified(UUID, ['irons_spellbooks:firebolt'])
  assert.equal(result.code, 'casting_started'); assert.equal(result.phase, 'casting'); assert.equal(result.accepted, true)
  assert.deepEqual(f.called('irons.cast').map(c => c.args), [[UUID, 'irons_spellbooks:firebolt']])
  assert.equal(f.called('magic.getSkillbar').length, 0)
  assert.equal((await f.app.castUnified(UUID, ['fireworks'])).code, 'login_required')
  assert.equal((await f.app.castUnified(UUID, ['irons_spellbooks:firebolt', 'power=99'])).code, 'invalid_params')
  assert.equal(f.called('irons.cast').length, 1); assert.equal(f.called('magic.castExact').length, 0)
})

test('menu checks online state and never claims success after failed or interrupted execution', async () => {
  for (const response of ['No entity was found', new Error('closed')]) {
    const f = fixture(); f.behaviors['rcon.send'] = async () => { if (response instanceof Error) throw response; return response }
    const [result] = await f.dispatch('menu waypoints')
    assert.equal(result.ok, false); assert.equal(result.code, 'menu_unavailable'); assert.equal(f.called('rcon.send').length, 1)
  }
  const f = fixture(); f.behaviors['rcon.send'] = async command => command.endsWith(' Pos') ? 'entity data:' : 'Unknown command'
  assert.equal((await f.dispatch('menu archive'))[0].ok, false)
  assert.equal(f.called('rcon.send').length, 2)
  const g = fixture(); await g.dispatch('menu waypoints', { subject: '鸣人' })
  assert.deepEqual(g.called('rcon.send').map(c => c.args[0]), ['data get entity Naruto Pos', 'skillchest waypoints Naruto 0'])
})

test('native menu and cancel preserve failures and invalid parameters cannot reach native execution', async () => {
  for (const action of ['menu', 'cancel']) {
    const f = fixture(), raw = f.native(action, 'Owner', { ok: false, code: 'actor_not_found', summary: '离线' })
    f.behaviors['irons.request'] = async () => raw
    assert.deepEqual((await f.dispatch(action === 'menu' ? 'menu irons' : 'cancel'))[0], raw)
    assert.equal(f.called('irons.request').length, 1); assert.equal(f.called('rcon.send').length, 0)
  }
  for (const command of ['cancel extra', 'menu irons extra', 'menu illegal']) {
    const f = fixture(); assert.equal((await f.dispatch(command))[0].code, 'invalid_params'); assert.deepEqual(f.calls, [])
  }
})

test('book learning and innate selection write only to the subject and preserve passive learning', async () => {
  const f = fixture(); await f.dispatch('learn 夜视')
  assert.deepEqual(f.called('magic.learnViaAdvancement').map(c => c.args), [['Owner', 'night_vision']])
  assert.deepEqual(f.called('magic.unlockPassive').map(c => c.args), [['Owner', 'night_eyes']])
  await f.dispatch('innate 我选 烟花术')
  assert.deepEqual(f.called('magic.setInnate').map(c => c.args), [['Owner', 'fireworks']])
  await f.dispatch('bookget 烟花术')
  assert.ok(f.called('rcon.send').some(c => c.args[0] === 'give Owner minecraft:written_book 1'))
  assert.ok(f.called('worlddb.chronicleRecord').every(c => c.args[1] === 'Owner'))
})

test('archived book actions and missing inventory cannot learn or give items', async () => {
  for (const command of ['learn heal', 'bookget heal']) {
    const f = fixture(); assert.equal((await f.dispatch(command))[0].code, 'skill_archived')
    assert.equal(f.called('rcon.send').length, 0); assert.equal(f.called('magic.learnViaAdvancement').length, 0)
  }
  const f = fixture(); f.behaviors['rcon.send'] = async () => ''
  await f.dispatch('learn 新术')
  assert.equal(f.called('magic.learnViaAdvancement').length, 0)
  assert.equal(f.called('worlddb.chronicleRecord').length, 0)
})

test('waypoint stable refs use the resolved owner while teleport acts on the original exact subject', async () => {
  const f = fixture(); f.behaviors['waypointTravel.location'] = async () => f.travel('NumenBody')
  const [result] = await f.dispatch('goto personal:6', { subject: UUID })
  assert.equal(result.ref, 'personal:6'); assert.equal(result.dimension, 'minecraft:the_nether')
  assert.deepEqual(f.called('waypoints.resolve').map(c => c.args), [['NumenBody', 'personal:6']])
  assert.equal(f.called('tpWaypoint')[0].args[0], UUID)
  assert.deepEqual(f.called('tpWaypoint')[0].args[1], f.entries[1].waypoint)
})

test('ambiguous, missing, offline and unsafe waypoints never silently choose, retry or delegate', async () => {
  for (const status of ['ambiguous', 'not_found']) {
    const f = fixture(); f.behaviors['waypoints.resolve'] = () => ({ status, matches: clone(f.entries) })
    const [result] = await f.dispatch('goto 重名')
    assert.equal(result.ok, false); assert.equal(f.called('tpWaypoint').length, 0)
    if (status === 'ambiguous') assert.equal(result.code, 'ambiguous_waypoint')
  }
  const offline = fixture(); offline.behaviors['waypointTravel.location'] = async actor => offline.travel(actor, { ok: false, code: 'actor_not_found' })
  assert.equal((await offline.dispatch('goto personal:6'))[0].code, 'actor_not_found')
  assert.equal(offline.called('waypoints.resolve').length, 0)
  for (const code of ['unsafe_destination', 'cooldown', 'dimension_unavailable', 'outcome_unknown']) {
    const f = fixture(); f.behaviors.tpWaypoint = async actor => f.travel(actor, { ok: false, code })
    const [result] = await f.dispatch('goto personal:6')
    assert.equal(result.ok, false); assert.equal(result.code, code); assert.equal(result.ref, 'personal:6')
    assert.equal(f.called('tpWaypoint').length, 1); assert.equal(f.called('extendedCommand').length, 0)
  }
})

test('waypoint add records actual dimension, personal deletion compatibility and unavailable storage remain explicit', async () => {
  const f = fixture(), [added] = await f.dispatch('waypoint add 新家')
  assert.equal(added.entry.ref, 'personal:11')
  assert.deepEqual(f.called('waypoints.add')[0].args, ['Owner', '新家', 12.5, 70, 34.5, 'minecraft:the_nether'])
  await f.dispatch('waypoint remove personal:6'); await f.dispatch('waypoint remove 6')
  assert.deepEqual(f.called('waypoints.removeRef')[0].args, ['Owner', 'personal:6'])
  assert.deepEqual(f.called('waypoints.remove')[0].args, ['Owner', 6])
  assert.equal((await f.dispatch('waypoint remove shared:1'))[0].ok, false)
  assert.equal(f.called('waypoints.removeRef').length, 1); assert.equal(f.called('waypoints.remove').length, 1)
  f.behaviors['waypoints.getStatus'] = () => ({ available: false })
  assert.equal((await f.dispatch('waypoint list'))[0].code, 'waypoints_unavailable')
  f.behaviors['waypoints.add'] = () => null
  assert.equal((await f.dispatch('waypoint add 满额'))[0].code, 'waypoint_limit')
  f.behaviors['waypoints.add'] = () => { throw new Error('read-only preserved source') }
  assert.equal((await f.dispatch('waypoint add 错误'))[0].code, 'waypoint_storage_error')
})

test('cultivation uses the injected clock and per-subject cooldown, with no real timers', async () => {
  const f = fixture(); await f.dispatch('cultivate mining'); await f.dispatch('cultivate mining')
  assert.deepEqual(f.called('rcon.send').map(c => c.args[0]), ['puffish_skills experience add Owner mining 5'])
  assert.equal(f.cooldowns.get('Owner'), 100_000)
  f.behaviors.now = () => 160_000
  await f.dispatch('cultivate mining')
  assert.equal(f.called('rcon.send').length, 2)
  await f.dispatch('cultivate mining', { subject: 'Other' })
  assert.equal(f.called('rcon.send').length, 3)
  // Existing cultivate/growth success-envelope policy is deliberately not
  // represented here as repaired native success/failure accounting.
})

test('queue allowlist refuses extended and guardian commands before any online or AI call', async () => {
  for (const command of ['chat 你好', 'ask 世界', 'pray 面包', 'summon 桐人 帮忙', 'guardian-cast fireworks', 'learn 新术', 'cultivate']) {
    const f = fixture(), result = await f.app.executeRequest({ actor: 'sys_Owner', command })
    assert.equal(result.code, 'unsupported_command', command); assert.deepEqual(f.calls, []); assert.deepEqual(f.messages, [])
  }
  for (const command of ['caast fireworks', '/mycli cast "unfinished']) {
    const f = fixture(); assert.equal((await f.app.executeRequest({ actor: 'Owner', command })).code, 'invalid_command')
    assert.deepEqual(f.calls, [])
  }
})

test('queue static help is offline-capable while legacy actions stop after one online check', async () => {
  for (const command of ['help', '/mycli commands', '!cli help cast']) {
    const f = fixture(); assert.equal((await f.app.executeRequest({ actor: 'Owner', command })).ok, true)
    assert.deepEqual(f.calls, []); assert.deepEqual(f.messages, [])
  }
  for (const command of ['cast fireworks', 'skillbar', 'skills', 'menu waypoints']) {
    const f = fixture(); f.behaviors['rcon.send'] = async () => 'No entity was found'
    const result = await f.app.executeRequest({ actor: 'Owner', command })
    assert.equal(result.code, 'offline', command)
    assert.deepEqual(f.called('rcon.send').map(c => c.args), [['data get entity Owner Pos']])
    assert.equal(f.called('magic.castExact').length, 0); assert.equal(f.called('extendedCommand').length, 0)
    assert.deepEqual(f.messages, [])
  }
})

test('queue native actions bypass the legacy online check and preserve exact UUID and failed receipts', async () => {
  for (const command of ['status', 'spells', 'cancel', 'menu irons', 'cast irons_spellbooks:firebolt', 'goto personal:6', 'waypoint list']) {
    const f = fixture(), result = await f.app.executeRequest({ actor: UUID, command })
    assert.equal(result.ok, true, command); assert.equal(f.called('rcon.send').length, 0, command)
    assert.equal(f.called('magic.getState').length, 0, command); assert.deepEqual(f.messages, [])
  }
  const f = fixture(), raw = f.native('cast', UUID, { ok: false, code: 'outcome_unknown', summary: '未确认，禁止重放', raw: '原始扩展回执' })
  f.behaviors['irons.cast'] = async () => raw
  assert.deepEqual(await f.app.executeRequest({ actor: UUID, command: 'cast irons_spellbooks:firebolt' }), raw)
  assert.equal(f.called('irons.cast').length, 1); assert.equal(f.called('extendedCommand').length, 0)
})

test('queue legacy success is captured only; interrupted preflight or execution is not replayed or sent to AI', async () => {
  const f = fixture(), result = await f.app.executeRequest({ actor: 'Owner', command: '/cli cast fireworks' })
  assert.equal(result.skillId, 'fireworks'); assert.equal(f.called('magic.castExact').length, 1)
  assert.deepEqual(f.messages, [])
  for (const port of ['rcon.send', 'magic.castExact']) {
    const g = fixture(), error = new Error('fixture transport interruption')
    g.behaviors[port] = async () => { throw error }
    await assert.rejects(g.app.executeRequest({ actor: 'Owner', command: 'cast fireworks' }), e => e === error)
    assert.equal(g.called(port).length, 1); assert.equal(g.called('extendedCommand').length, 0)
    assert.deepEqual(g.messages, [])
  }
})

test('staff shortcut claims exactly one real gesture before using the existing slot cast', async () => {
  const f = fixture(), claims = []
  f.deps.claimStaff = async (...args) => { claims.push(args); return { ok: true, code: 'claimed' } }
  const [result] = await f.dispatch('staff-cast 1')
  assert.equal(result.ok, true)
  assert.deepEqual(claims, [['Owner', 100_000, 100_000, 1]])
  assert.equal(f.called('magic.castExact').length, 1)
})

test('staff shortcut cannot bypass the raised-staff gate using direct voice or consumed gestures', async () => {
  for (const gate of [{ok:true,code:'direct_voice'}, {ok:false,code:'gesture_consumed',summary:'already used'}]) {
    const f=fixture(); f.deps.claimStaff=async()=>gate
    const [result]=await f.dispatch('staff-cast 1')
    assert.equal(result.ok,false); assert.equal(f.called('magic.castExact').length,0); assert.equal(f.called('irons.cast').length,0)
  }
})

test('staff shortcut validates slot before consuming a gesture and never retries an uncertain claim', async () => {
  const f=fixture(); let claims=0
  f.deps.claimStaff=async()=>{claims++;throw new Error('lost response')}
  assert.equal((await f.dispatch('staff-cast 9'))[0].code,'invalid_params'); assert.equal(claims,0)
  assert.equal((await f.dispatch('staff-cast 1'))[0].code,'outcome_unknown'); assert.equal(claims,1)
  assert.equal(f.called('magic.castExact').length,0)
})

test('HUD sync reflects eight positions, stays quiet, and a display failure does not undo a saved edit', async () => {
  const f=fixture(), sync=[]
  f.deps.syncStaffBar=async(actor,bar)=>{sync.push([actor,bar]);return {ok:true,code:'bar_synced'}}
  await f.app.handleCli('Owner','Owner',parseCli('/mycli skillbar sync'))
  assert.equal(sync.length,1);assert.equal(sync[0][0],'Owner');assert.equal(sync[0][1].length,8)
  assert.equal(sync[0][1][0].chant,'咏唱烟花术');assert.equal(sync[0][1][7].id,'')
  assert.deepEqual(f.messages,[])
  f.deps.syncStaffBar=async()=>{throw new Error('No connected custom client')}
  const [result]=await f.dispatch('skillbar set 8 fireworks')
  assert.equal(result.ok,true);assert.equal(f.state.skillbar[7],'fireworks')
  assert.equal(f.state.skillbar[0],'');assert.equal(f.called('magic.castExact').length,0)
})
