import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSpokenIntent } from '../src/gameplay/commands/spoken-intent.ts'
import { CHANT_PREFIXES, matchChantFrame } from '../src/gameplay/magic/spell-input.ts'

const atom = (id, name, words, extra = {}) => ({ id, name, words, cost: { mana: 8 }, cooldownMs: 1000,
  requiredLevel: 1, commands: [], catalog: { status: 'featured', reason: '', nativeHints: [] }, ...extra })
const atoms = [
  atom('home', '归乡', ['回家']),
  atom('tp', '空间传送', ['传送']),
  atom('give', '造物术', ['造物']),
  atom('sky_walk', '御空术', ['御空']),
  atom('rasengan', '螺旋丸', ['忍术螺旋丸'], { catalog: { status: 'archived', reason: '原生替代', nativeHints: ['irons_spellbooks:gust'] } }),
  atom('old_lightning', '旧闪电', ['闪电术', '闪电'], { catalog: { status: 'archived', reason: '旧主动停用', nativeHints: ['irons_spellbooks:chain_lightning'] } }),
  atom('night_eye', '夜视之瞳', ['夜视'], { type: 'passive' }),
]
const cast = id => ({ kind: 'command', verb: 'cast', args: [id] })
const command = (verb, args = []) => ({ kind: 'command', verb, args })
const parse = text => parseSpokenIntent(text, atoms)

test('native spoken aliases match whole utterances and choose the verified native IDs', () => {
  for (const key of ['火焰弹', '火焰箭']) assert.deepEqual(parse(key), cast('irons_spellbooks:firebolt'))
  for (const key of ['落雷', '雷电', '闪电术']) assert.deepEqual(parse(key), cast('irons_spellbooks:lightning_bolt'))
  assert.deepEqual(parse('irons_spellbooks:firebolt'), cast('irons_spellbooks:firebolt'))
  assert.deepEqual(parse('咏唱：铁魔法：火焰箭'), cast('irons_spellbooks:firebolt'))
  assert.deepEqual(parse('铁魔法：落雷'), cast('irons_spellbooks:lightning_bolt'))
})

test('ASR punctuation and Goddess vocatives do not damage exact skills or menu commands', () => {
  for (const key of ['女神，火焰弹。', '灯语：火焰箭，', '灯语女神，请咏唱火焰弹！', '女神释放火焰箭。'])
    assert.deepEqual(parse(key), cast('irons_spellbooks:firebolt'), key)
  assert.deepEqual(parse('  女神，查看状态。  '), command('status'))
  assert.deepEqual(parse('灯语，请打开技能罗盘！'), command('menu'))
})

test('every existing anime and public chant prefix is reused, including 女神在上', () => {
  for (const prefix of CHANT_PREFIXES) {
    assert.deepEqual(parse(`${prefix}：火焰弹。`), cast('irons_spellbooks:firebolt'), prefix)
    assert.deepEqual(parse(`${prefix}，火焰箭！`), cast('irons_spellbooks:firebolt'), prefix)
  }
  for (const prefix of ['施放', '释放', '施放技能', '施放法术', '使用技能'])
    assert.deepEqual(parse(`${prefix}火焰弹`), cast('irons_spellbooks:firebolt'))
})

test('featured legacy names, stable IDs and unique words resolve without a substring guess', () => {
  for (const name of ['归乡', '回家', 'HOME', '咏唱：回家']) assert.deepEqual(parse(name), cast('home'))
  assert.deepEqual(parse('空间传送'), cast('tp'))
  assert.deepEqual(parse('使用技能御空术'), cast('sky_walk'))
  for (const text of ['回家以后再聊', '我看见火焰弹', '火焰弹很漂亮', '我想了解归乡', '技能罗盘很好用'])
    assert.deepEqual(parse(text), { kind: 'conversation', text })
})

test('archived and passive skills are not re-enabled or mapped through nativeHints', () => {
  for (const text of ['螺旋丸', 'rasengan', '忍术螺旋丸', '闪电', '夜视之瞳', '夜视'])
    assert.deepEqual(parse(text), { kind: 'conversation', text })
  for (const text of ['咏唱：螺旋丸', '巴啦啦能量 夜视之瞳'])
    assert.deepEqual(parse(text), { kind: 'chant', text })
  // This explicit new voice alias chooses native lightning, not either old atom or its hint.
  assert.deepEqual(parse('闪电术'), cast('irons_spellbooks:lightning_bolt'))
})

test('unresolved explicit chants have a valid legacy frame and preserve their parameter prose', () => {
  for (const text of ['咏唱：未知之术', '古娜拉黑暗之神 向东传送五格', '咏唱：传送 distance=5 direction=东'])
    assert.deepEqual(parse(text), { kind: 'chant', text })
  for (const [input, expected] of [
    ['释放造物术 火把三个', '施法：造物术 火把三个'],
    ['施放空间传送向左五格', '施法：空间传送向左五格'],
    ['施放技能未知之术', '施法：未知之术'],
    ['施放法术未知之术', '施法：未知之术'],
    ['铁魔法：未知之术', '施法：铁魔法：未知之术'],
  ]) {
    assert.deepEqual(parse(input), { kind: 'chant', text: expected })
    assert.ok(matchChantFrame(parse(input).text))
  }
  for (const prefix of CHANT_PREFIXES) {
    const input = `${prefix} 未知之术，向左五格`
    assert.deepEqual(parse(input), { kind: 'chant', text: input })
    assert.equal(matchChantFrame(parse(input).text), '未知之术，向左五格')
  }
  assert.deepEqual(parse('女神，巴啦啦能量 向东传送五格。'), { kind: 'chant', text: '巴啦啦能量 向东传送五格' })
  assert.deepEqual(parse('咏唱：隐身术'), { kind: 'chant', text: '咏唱：隐身术' })
  assert.deepEqual(parse('隐身术'), { kind: 'conversation', text: '隐身术' })
})

test('explicit complete tp prose becomes exact parameters without defaults or clamping', () => {
  for (const input of ['咏唱 空间传送 向东五格', '施放空间传送向东五格', '咏唱：空间传送，向东五格',
    '女神，空间传送向东5格。', '巴啦啦能量 传送向东五格'])
    assert.deepEqual(parse(input), command('cast', ['tp', 'distance=5', 'direction=东']), input)
  for (const direction of ['东', '南', '西', '北', '东南', '东北', '西南', '西北'])
    assert.deepEqual(parse(`释放传送向${direction}十二格`), command('cast', ['tp', 'distance=12', `direction=${direction}`]))
  assert.deepEqual(parse('施放传送向东一百格'), command('cast', ['tp', 'distance=100', 'direction=东']))
  for (const input of ['咏唱传送向左五格', '咏唱传送向东', '咏唱传送五格', '咏唱传送向东五米',
    '咏唱传送向东二八格', '咏唱传送向东十十格', '咏唱传送向东5.5格', '咏唱传送向东0格',
    '咏唱传送向东五格再向西两格']) {
    assert.equal(parse(input).kind, 'chant', input)
    assert.ok(matchChantFrame(parse(input).text))
  }
  for (const input of ['我看见空间传送向东五格', '不要空间传送向东五格', '咏唱空间传送向东五格可以吗'])
    assert.equal(parse(input).kind, 'conversation', input)
  const archived = atoms.map(row => row.id === 'tp' ? { ...row, catalog: { status: 'archived', reason: '暂停', nativeHints: [] } } : row)
  assert.deepEqual(parseSpokenIntent('释放传送向东五格', archived), { kind: 'chant', text: '施法：传送向东五格' })
  assert.equal(parseSpokenIntent('传送向东五格', archived).kind, 'conversation')
})

test('negations, questions, reported speech and quotations never become commands or chants', () => {
  const examples = ['不要放火焰弹', '女神，不要释放火焰箭。', '别放落雷', '使用技能火焰箭？',
    '使用技能火焰箭可以吗', '怎么使用火焰箭', '咏唱火焰弹是什么意思', '如何传送到家',
    '查看状态吗', '打开技能罗盘？', '传送到家好吗', '我看见他释放火焰弹',
    '他说：咏唱火焰弹', '比如咏唱火焰弹', '释放火焰弹只是一个例子', '如果释放火焰弹',
    '咏唱火焰弹的话会怎样', '咏唱火焰弹，不要真的施放', '咏唱：不要释放落雷',
    '咏唱：我不放火焰弹', '女神在上，不施放火焰箭', '咏唱：别帮我放落雷', 'cast not firebolt', 'cast firebolt how',
    '“火焰弹”', '「咏唱火焰弹」', '咏唱：“火焰弹”', '女神，取消施法吗',
    '停止咏唱是什么意思', '咏唱 firebolt\n不要执行']
  for (const text of examples) assert.deepEqual(parse(text), { kind: 'conversation', text }, text)
})

test('cancel, menus and status use only exact bounded spoken commands', () => {
  for (const text of ['取消施法', '停止咏唱']) assert.deepEqual(parse(text), command('cancel'))
  for (const text of ['打开技能罗盘', '打开技能轮盘']) assert.deepEqual(parse(text), command('menu'))
  for (const text of ['打开铁魔法', '打开铁魔法菜单']) assert.deepEqual(parse(text), command('menu', ['irons']))
  assert.deepEqual(parse('查看状态'), command('status'))
  for (const text of ['打开铁魔法真好看', '我想取消施法', '给我管理员', '买三本书', '供奉铁锭'])
    assert.deepEqual(parse(text), { kind: 'conversation', text })
})

test('waypoint names are handed to the existing safe resolver intact, never substring-selected', () => {
  assert.deepEqual(parse('女神，传送到千灯村广场。'), command('goto', ['千灯村广场']))
  assert.deepEqual(parse('传送到 不夜城 南门'), command('goto', ['不夜城 南门']))
  assert.deepEqual(parse('传送到shared:3'), command('goto', ['shared:3']))
  for (const text of ['传送到', '传送到家，然后释放火焰弹', '传送到家之后查看状态'])
    assert.deepEqual(parse(text), { kind: 'conversation', text })
})

test('the existing complete spoken door-number protocol maps only valid 1–99 ordinals to goto', () => {
  for (const [input, index] of [['二', 2], ['两', 2], ['八号哎', 8], ['8号哎', 8], ['十二', 12],
    ['十九点呀', 19], ['九十九号', 99], ['一十号点哦', 10], ['08啊', 8], ['八号呢', 8], ['女神，二。', 2]])
    assert.deepEqual(parse(input), command('goto', [String(index)]), input)
  for (const input of ['我有八个苹果', '八号是什么', '八号吗', '八号呢？', '二十八个', '8号以后再去',
    '八号哎呀', '去八号', '二八', '十十', '1二', '一2', '100', '零', '0', '00', '008', '-2',
    '2.5', '八号和二号', '“八号”', '不要八号', '女神，\n八号哎'])
    assert.deepEqual(parse(input), { kind: 'conversation', text: input }, input)
})

test('ASCII prefix words cannot capture ordinary English nouns or conversation', () => {
  for (const text of ['chanting is fun', 'spellbook looks nice', 'castle', 'cast_spellbook', 'hello Goddess'])
    assert.deepEqual(parse(text), { kind: 'conversation', text })
  assert.deepEqual(parse('CAST：火焰箭'), cast('irons_spellbooks:firebolt'))
})

test('ambiguous aliases do not pick a first atom; exact names take precedence', () => {
  const pool = [...atoms, atom('other_home', '第二归途', ['回家'])]
  assert.deepEqual(parseSpokenIntent('回家', pool), { kind: 'conversation', text: '回家' })
  assert.deepEqual(parseSpokenIntent('咏唱回家', pool), { kind: 'chant', text: '咏唱回家' })
  assert.deepEqual(parseSpokenIntent('归乡', pool), cast('home'))
})

test('parsing does not mutate caller data or share mutable command arguments', () => {
  const snapshot = JSON.stringify(atoms)
  const first = parse('打开铁魔法'); first.args.push('injected')
  assert.deepEqual(parse('打开铁魔法'), command('menu', ['irons']))
  assert.equal(JSON.stringify(atoms), snapshot)
  assert.deepEqual(parse(''), { kind: 'conversation', text: '' })
  assert.equal(parse('火焰弹'.repeat(1000)).kind, 'conversation')
})

test('archived framed speech still reaches the real legacy archive denial without effects or spending', async t => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, relative, isAbsolute } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'qd-spoken-archive-'))
  t.after(() => {
    const target = realpathSync(dir), rel = relative(realpathSync(tmpdir()), target)
    assert(!isAbsolute(rel) && rel.startsWith('qd-spoken-archive-') && !rel.includes('..'))
    rmSync(target, { recursive: true, force: true })
  })
  t.mock.method(globalThis, 'setTimeout', () => 0)
  t.mock.method(globalThis, 'setInterval', () => 0)
  t.mock.method(console, 'log', () => {})
  let effects = 0, modelCalls = 0
  const noEffect = () => { effects++; throw new Error('Game side effects forbidden in this fixture') }
  t.mock.method(globalThis, 'fetch', () => { modelCalls++; throw new Error('Network forbidden in this fixture') })
  const archived = { ...atoms.find(row => row.id === 'rasengan'), commands: ['say forbidden-offline-effect'], reply: '不应执行' }
  const atomsPath = join(dir, 'atoms.json'), statePath = join(dir, 'state.json'), catalogPath = join(dir, 'skill-catalog.json')
  writeFileSync(atomsPath, JSON.stringify({ atoms: [archived] }))
  writeFileSync(catalogPath, JSON.stringify({ schema: 1, featured: [], archived: { rasengan: {
    kind: 'native_alternative', reason: '旧主动已归档', nativeHints: ['irons_spellbooks:gust'],
  } } }))
  const initial = JSON.stringify({ version: 1, players: { Probe: { mana: 100, level: 10, learned: ['rasengan'],
    innateSkill: null, lastUpdate: Date.now(), maxMana: 100, maxManaBonus: 0 } } })
  writeFileSync(statePath, initial)
  const { createMagic } = await import('../src/mc-magic.ts')
  const handle = createMagic({ enabled: false, atomsPath, statePath, catalogPath, stateMirrorPath: null,
    balancePath: join(dir, 'balance.json'), maxManaDefault: 100, regenPerSec: 0 },
  { getBot: noEffect, rcon: { send: async () => noEffect(), getPos: async () => noEffect(), getEntityNumber: async () => noEffect() } })
  try {
    for (const input of ['咏唱：螺旋丸', '古娜拉黑暗之神 螺旋丸', '施放螺旋丸']) {
      const intent = parseSpokenIntent(input, handle.service.listAtoms())
      assert.equal(intent.kind, 'chant')
      assert.ok(matchChantFrame(intent.text))
      assert.match(await handle.service.castSpell('Probe', intent.text), /已归档/)
    }
    assert.equal(effects, 0)
    assert.equal(modelCalls, 0)
    assert.equal(readFileSync(statePath, 'utf8'), initial)
  } finally { handle.dispose() }
})
test('numbered shortcut edits and editor opening use all eight slots without casting', () => {
  assert.deepEqual(parseSpokenIntent('八号快捷技能设为归乡', atoms), {kind:'command',verb:'skillbar',args:['set','8','home']})
  assert.deepEqual(parseSpokenIntent('清空第三号快捷槽', atoms), {kind:'command',verb:'skillbar',args:['clear','3']})
  assert.deepEqual(parseSpokenIntent('编辑快捷技能', atoms), {kind:'command',verb:'menu',args:['skillbar']})
  for(const text of ['不要清空第三号快捷槽','九号快捷技能设为烟花术','八号快捷技能设为烟花术吗']) assert.equal(parseSpokenIntent(text,atoms).kind,'conversation')
})

test('observed ASR 用唱 prefix resolves only an explicit complete chant', () => {
  const fixtures=[...atoms,atom('fireworks','烟花术',['烟花术'])]
  assert.deepEqual(parseSpokenIntent('用唱烟花树',fixtures),cast('fireworks'))
  for(const text of ['不要用唱烟花树','用唱烟花树是什么意思','我说过用唱烟花树']) assert.equal(parseSpokenIntent(text,fixtures).kind,'conversation')
})

test('hash-confirmed ASR 烟花束 stays an exact framed alias with all denial gates', () => {
  const fixtures=[...atoms,atom('fireworks','烟花术',['烟花术'])]
  for(const text of ['用唱烟花束','咏唱烟花束','女神，请用唱烟花束。'])
    assert.deepEqual(parseSpokenIntent(text,fixtures),cast('fireworks'))
  for(const text of ['烟花束','不要用唱烟花束','用唱烟花束是什么意思','用唱烟花束吗',
    '我说过用唱烟花束','如果用唱烟花束','“用唱烟花束”','用唱烟花束，不要施放'])
    assert.equal(parseSpokenIntent(text,fixtures).kind,'conversation',text)
  for(const text of ['用唱烟花束三个','用唱烟花束再放火焰箭','用唱烟花书'])
    assert.equal(parseSpokenIntent(text,fixtures).kind,'chant',text)
  for(const patch of [{catalog:{status:'archived'}},{type:'passive'}])
    assert.equal(parseSpokenIntent('用唱烟花束',[atom('fireworks','烟花术',['烟花术'],patch)]).kind,'chant')
})
