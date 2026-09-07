import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const world = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deps = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const { build } = createRequire(join(deps, '.qa.cjs'))('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'qiandeng-nbt-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))
const output = join(temp, 'mc-nbt.mjs')
await build({ entryPoints: [join(world, 'src', 'mc-nbt.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { parseNbtPosition } = await import(pathToFileURL(output).href)

test('real SNBT double suffixes and scientific notation preserve XYZ order', () => {
  assert.deepEqual(parseNbtPosition('QA has the following entity data: [-544.5d, 65.0d, 864.25d]'), [-544.5, 65, 864.25])
  assert.deepEqual(parseNbtPosition(' [ +1.25e2D, -.5d, 2E-1 ] '), [125, -0.5, 0.2])
  assert.deepEqual(parseNbtPosition('[0, -64, 30000000]'), [0, -64, 30000000])
})

test('missing, malformed and nonfinite vectors never create a discovery', () => {
  for (const value of ['No entity was found', '[1,2]', '[1,2,3,4]', '[NaN,2,3]',
    '[Infinity,2,3]', '[1e999d,2d,3d]', '[1ed,2d,3d]', '[I;1,2,3]',
    '["1",2,3]', '[1.2.3d,2d,3d]', '[1,2,3] garbage']) {
    assert.equal(parseNbtPosition(value), null, value)
  }
})
