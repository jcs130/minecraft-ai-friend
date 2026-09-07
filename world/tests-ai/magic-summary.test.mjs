import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const world = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Optional read-only dependency location; compiled output and fixtures stay in temp.
const dependencyRoot = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const requireDependency = createRequire(join(dependencyRoot, '.qiandeng-test.cjs'))
const { build } = requireDependency('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'qiandeng-magic-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))
const modulePath = join(temp, 'mc-magic.mjs')
await build({
  entryPoints: [join(world, 'src', 'mc-magic.ts')], outfile: modulePath,
  bundle: true, platform: 'node', format: 'esm', nodePaths: [dependencyRoot], logLevel: 'silent',
})
const { createMagic } = await import(pathToFileURL(modulePath).href)
const baseline = JSON.parse(readFileSync(join(world, 'data', 'magic-atoms.json'), 'utf8'))
const atoms = Array.isArray(baseline) ? baseline : baseline.atoms

function fixture(t) {
  // createMagic schedules embedding warmup and RCON maintenance. Neither may run offline.
  t.mock.method(globalThis, 'setTimeout', () => ({ offline: true }))
  t.mock.method(globalThis, 'setInterval', () => ({ offline: true }))
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden in offline test') })
  const atomsPath = join(temp, 'atoms.json')
  writeFileSync(atomsPath, JSON.stringify({ atoms }))
  const handle = createMagic({
    enabled: false, atomsPath, statePath: join(temp, 'state.json'),
    balancePath: join(temp, 'balance.json'), maxManaDefault: 100, regenPerSec: 2,
  }, {
    getBot: () => { throw new Error('No Minecraft bot in offline test') },
    rcon: { send: () => { throw new Error('RCON forbidden in offline test') } },
  })
  t.after(() => handle.dispose())
  return handle.service
}

test('public skill catalogue preserves all passive unlock identifiers', (t) => {
  const service = fixture(t)
  const passiveAtoms = atoms.filter((a) => a.type === 'passive')
  assert.ok(passiveAtoms.some((a) => a.passiveId), 'fixture must contain unlockable passives')
  const catalogue = service.listAtoms()
  assert.equal(catalogue.length, atoms.length)
  for (const atom of passiveAtoms) {
    const summary = catalogue.find((a) => a.id === atom.id)
    assert.equal(summary.type, 'passive', `${atom.id}: passive classification was lost`)
    assert.equal(summary.passiveId, atom.passiveId, `${atom.id}: unlock identifier was lost`)
    assert.deepEqual(service.getAtomById(atom.id), summary)
  }
})

test('single lookup and catalogue remain consistent without exposing mutable engine state', (t) => {
  const service = fixture(t)
  const atom = atoms.find((a) => a.type !== 'passive')
  const summary = service.getAtomById(atom.id)
  assert.equal(summary.requiredLevel, atom.requiredLevel ?? 1)
  assert.equal(summary.icon, atom.icon)
  assert.equal(summary.type, atom.type)
  assert.equal(summary.passiveId, atom.passiveId)
  summary.words.push('test-only-mutation')
  summary.cost.mana = -123
  const fresh = service.listAtoms().find((a) => a.id === atom.id)
  assert.deepEqual(fresh.words, atom.words)
  assert.deepEqual(fresh.cost, atom.cost)
  assert.equal(service.getAtomById('missing-skill-for-test'), null)
})
