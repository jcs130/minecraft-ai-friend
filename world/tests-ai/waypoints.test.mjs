import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync, rmdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync, chmodSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const world = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deps = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const { build } = createRequire(join(deps, '.qa.cjs'))('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'qiandeng-waypoints-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))
const output = join(temp, 'mc-waypoints.mjs')
await build({ entryPoints: [join(world, 'src', 'mc-waypoints.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { WaypointStore, zhNumberToArabic } = await import(pathToFileURL(output).href)
const wp = (id, name = `点${id}`, dim = 'minecraft:overworld') => ({ id, name, x: 1.5, y: 64, z: -2.5, dim, createdAt: 0 })
let serial = 0
function paths() {
  const dir = join(temp, String(++serial)); mkdirSync(dir)
  return { dir, primary: join(dir, 'waypoints.json'), mirror: join(dir, 'mirror.json') }
}
const opts = (p) => ({ mirrorPath: p.mirror })
const parse = (path) => JSON.parse(readFileSync(path, 'utf8'))
const expectCode = (fn, code) => assert.throws(fn, (e) => e.code === code)

test('new store writes complete primary/mirror; valid BOM source stays byte-identical and keeps order/ids', () => {
  const p = paths()
  const store = new WaypointStore(p.primary, [wp(9)], opts(p))
  assert.equal(store.getStatus().available, true)
  assert.equal(readFileSync(p.primary, 'utf8'), readFileSync(p.mirror, 'utf8'))
  const original = '\uFEFF' + JSON.stringify({ version: 1, shared: [wp(9), wp(2)], players: { Alice: [wp(7), wp(3)] }, extension: { untouched: true } })
  writeFileSync(p.primary, original)
  const loaded = new WaypointStore(p.primary, [wp(999)], opts(p))
  assert.equal(readFileSync(p.primary, 'utf8'), original)
  assert.deepEqual(loaded.listWithRefs('Alice').map((e) => e.ref), ['shared:9', 'shared:2', 'personal:7', 'personal:3'])
  assert.deepEqual(parse(p.mirror).extension, { untouched: true })
})

test('corrupt or structurally invalid source is preserved; no seed/mirror overwrite or writes are permitted', () => {
  const invalid = ['{broken', JSON.stringify({ version: 1, shared: [], players: [] }),
    JSON.stringify({ version: 2, shared: [], players: {} }),
    JSON.stringify({ version: 1, shared: [wp(1), wp(1)], players: {} }),
    JSON.stringify({ version: 1, shared: [{ ...wp(1), dim: 'minecraft:overworld run kill @a' }], players: {} }),
    JSON.stringify({ version: 1, shared: [], players: { Alice: [wp(5)] }, nextPersonalIds: { Alice: 5 } })]
  for (const raw of invalid) {
    const p = paths(); writeFileSync(p.primary, raw); writeFileSync(p.mirror, 'old mirror')
    const store = new WaypointStore(p.primary, [wp(999)], opts(p))
    assert.equal(store.getStatus().available, false)
    assert.equal(store.getStatus().source, 'invalid')
    assert.equal(store.resolve('Alice', '1').status, 'unavailable')
    expectCode(() => store.add('Alice', 'new', 1, 2, 3), 'unavailable')
    expectCode(() => store.allFor('Alice'), 'unavailable')
    assert.equal(readFileSync(p.primary, 'utf8'), raw)
    assert.equal(readFileSync(p.mirror, 'utf8'), 'old mirror')
    assert.deepEqual(readdirSync(p.dir).sort(), ['mirror.json', 'waypoints.json'])
  }
})

test('unreadable existing source and missing parent do not produce a usable phantom store', () => {
  const p = paths(); mkdirSync(p.primary); writeFileSync(p.mirror, 'old mirror')
  const store = new WaypointStore(p.primary, [wp(1)], opts(p))
  assert.equal(store.getStatus().source, 'unreadable')
  assert.equal(store.getStatus().available, false)
  assert.equal(readFileSync(p.mirror, 'utf8'), 'old mirror')
  const missing = new WaypointStore(join(p.dir, 'missing', 'waypoints.json'), [], { mirrorPath: null })
  assert.equal(missing.getStatus().available, false)
  assert.equal(missing.getStatus().lastWriteOk, false)
})

test('stable refs survive earlier deletion and restart; removed highest id is never reused', () => {
  const p = paths(); const store = new WaypointStore(p.primary, [wp(8, '公共')], opts(p))
  const a = store.add('Alice', '私一', 1, 64, 2)
  const b = store.add('Alice', '私二', 3, 64, 4, 'minecraft:the_nether')
  assert.equal(store.byIndex('Alice', 3).id, b.id)
  assert.equal(store.remove('Alice', 1).id, a.id) // 旧个人序号，不是全局序号
  assert.equal(store.byIndex('Alice', 2).id, b.id)
  assert.equal(store.byRef('Alice', `personal:${b.id}`).dim, 'minecraft:the_nether')
  assert.equal(store.removeRef('Alice', 'shared:8'), null)
  assert.equal(store.byRef('Bob', `personal:${b.id}`), null)
  store.removeRef('Alice', `personal:${b.id}`)
  const restarted = new WaypointStore(p.primary, [], opts(p))
  const c = restarted.add('Alice', '私三', 0, 65, 0)
  assert.ok(c.id > b.id)
  assert.equal(restarted.byRef('Alice', `personal:${b.id}`), null)
  assert.equal(restarted.resolve('Alice', `personal:${c.id}`).status, 'found')
  assert.equal(restarted.resolve('Alice', 'shared:08').status, 'invalid_query')
  assert.equal(restarted.byIndex('Alice', 1.5), null)
})

test('existing duplicate names remain intact but exact/fuzzy ambiguity never picks first; new duplicates rejected', () => {
  const p = paths()
  writeFileSync(p.primary, JSON.stringify({ version: 1, shared: [wp(1, '公共')], players: { Alice: [wp(4, '藏宝点'), wp(9, '藏宝点'), wp(10, '藏宝点北')] } }))
  const store = new WaypointStore(p.primary, [], opts(p))
  assert.equal(store.personal('Alice').length, 3)
  assert.equal(store.resolve('Alice', '藏宝点').matches.length, 2)
  assert.equal(store.resolve('Alice', '藏').matches.length, 3)
  assert.equal(store.byName('Alice', '藏宝点'), null)
  assert.equal(store.resolve('Alice', '藏宝点北').entry.ref, 'personal:10')
  expectCode(() => store.add('Alice', '公共', 1, 2, 3), 'duplicate_name')
  expectCode(() => store.add('Alice', '藏宝点', 1, 2, 3), 'duplicate_name')
})

test('invalid input cannot alter primary; custom dimensions and fractional safe data are preserved', () => {
  const p = paths(); const store = new WaypointStore(p.primary, [], opts(p))
  const initial = readFileSync(p.primary, 'utf8')
  for (const args of [['Alice', 'a\nkill @a', 1, 2, 3], ['Alice', '§c危险', 1, 2, 3],
    ['Alice', 'a'.repeat(17), 1, 2, 3], ['Alice', 'a', NaN, 2, 3], ['Alice', 'a', 1, Infinity, 3],
    ['Alice', 'a', 30_000_001, 2, 3], ['Alice', 'a', 1, 2, 3, 'overworld'],
    ['Alice', 'a', 1, 2, 3, 'minecraft:overworld run kill @a'], ['__proto__', 'a', 1, 2, 3]]) {
    expectCode(() => store.add(...args), 'invalid_input')
    assert.equal(readFileSync(p.primary, 'utf8'), initial)
  }
  const added = store.add('Alice', ' 群星门 ', -0.5, -62.25, 9.75, 'my_mod:outer/stars')
  assert.equal(added.name, '群星门')
  assert.equal(added.dim, 'my_mod:outer/stars')
  assert.equal(added.y, -62.25)
  added.name = 'external'; store.personal('Alice')[0].name = 'external'
  assert.equal(store.personal('Alice')[0].name, '群星门')
})

test('ten personal limit preserved; inherited object property names cannot corrupt high water', () => {
  const p = paths(); const store = new WaypointStore(p.primary, [], opts(p))
  for (let i = 0; i < 10; i++) assert.ok(store.add('toString', `点${i}`, i, 64, 0))
  assert.equal(store.add('toString', '十一', 11, 64, 0), null)
  assert.equal(store.personal('toString').length, 10)
  store.remove('toString', 10)
  assert.equal(store.add('toString', '新点', 0, 64, 0).id, 11)
})

test('primary rename failure rolls back memory; recovery succeeds without orphan temp files', () => {
  const p = paths(); const store = new WaypointStore(p.primary, [wp(1)], opts(p))
  const original = readFileSync(p.primary, 'utf8')
  const backup = join(p.dir, 'original.json'); renameSync(p.primary, backup); mkdirSync(p.primary)
  expectCode(() => store.add('Alice', '未保存', 1, 2, 3), 'write_failed')
  assert.equal(store.personal('Alice').length, 0)
  assert.equal(readFileSync(backup, 'utf8'), original)
  assert.equal(store.getStatus().lastWriteOk, false)
  assert.equal(readdirSync(p.dir).some((n) => n.includes('.tmp-')), false)
  rmdirSync(p.primary); renameSync(backup, p.primary)
  assert.ok(store.add('Alice', '恢复', 1, 2, 3))
  assert.equal(store.getStatus().lastWriteOk, true)
})

test('mirror failure is visible while durable primary remains usable; explicit retry repairs mirror', () => {
  const p = paths(); const mirror = join(p.dir, 'not-yet-created', 'mirror.json')
  const store = new WaypointStore(p.primary, [], { mirrorPath: mirror })
  assert.equal(store.getStatus().available, true)
  assert.equal(store.getStatus().mirror.ok, false)
  const added = store.add('Alice', '已落盘', 1, 64, 2)
  assert.equal(parse(p.primary).players.Alice[0].id, added.id)
  assert.equal(store.getStatus().lastWriteOk, true)
  mkdirSync(dirname(mirror))
  assert.equal(store.syncMirror(), true)
  assert.equal(readFileSync(mirror, 'utf8'), readFileSync(p.primary, 'utf8'))
  assert.equal(store.getStatus().mirror.error, null)
})

test('Chinese numbers reject malformed words without dropping valid legacy input', () => {
  for (const [s, n] of [['二', 2], ['两', 2], ['十', 10], ['十二', 12], ['二十', 20], ['九十九', 99], ['08', 8]]) assert.equal(zhNumberToArabic(s), n)
  for (const s of ['十十', '一二', '一百', '12号', 'Infinity', '二十一十']) assert.equal(zhNumberToArabic(s), null)
})

test('POSIX UI mirror remains readable by the Minecraft UID after every atomic replacement', { skip: process.platform === 'win32' }, () => {
  const p = paths()
  const beforeUmask = process.umask(0o077)
  try {
    const store = new WaypointStore(p.primary, [], opts(p))
    assert.equal(statSync(p.primary).mode & 0o777, 0o600)
    assert.equal(statSync(p.mirror).mode & 0o777, 0o644)
    store.add('Alice', '新点', 1, 64, 2)
    assert.equal(statSync(p.primary).mode & 0o777, 0o600)
    assert.equal(statSync(p.mirror).mode & 0o777, 0o644)
    store.remove('Alice', 1)
    assert.equal(statSync(p.mirror).mode & 0o777, 0o644)
    store.syncMirror()
    assert.equal(statSync(p.mirror).mode & 0o777, 0o644)
    if (process.getuid?.() === 0) {
      chmodSync(temp, 0o755)
      chmodSync(p.dir, 0o755)
      execFileSync(process.execPath, ['--input-type=module', '-e',
        'import assert from "node:assert/strict"; import {readFileSync} from "node:fs"; assert.doesNotThrow(()=>JSON.parse(readFileSync(process.argv[1],"utf8"))); assert.throws(()=>readFileSync(process.argv[2]),e=>e.code==="EACCES");',
        p.mirror, p.primary], { uid: 1000, gid: 1000 })
    }
  } finally { process.umask(beforeUmask) }
})
