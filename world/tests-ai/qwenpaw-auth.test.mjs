import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const world = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dependencies = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const { build } = createRequire(join(dependencies, '.qiandeng-test.cjs'))('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'qiandeng-auth-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))
const modulePath = join(temp, 'qwenpaw-auth.mjs')
await build({ entryPoints: [join(world, 'src', 'qwenpaw-auth.ts')], outfile: modulePath,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { qwenpawHeaders } = await import(pathToFileURL(modulePath).href)

test('legacy calls remain compatible; file credentials override env and are read again after rotation', () => {
  const legacy = { 'Content-Type': 'application/json', 'X-Agent-Id': 'mc-god' }
  assert.deepEqual(qwenpawHeaders('mc-god', {}), legacy)
  const tokenFile = join(temp, 'test-token.txt')
  writeFileSync(tokenFile, '\ufefftest.signature\n')
  const env = { QWENPAW_CONSOLE_TOKEN_FILE: tokenFile, QWENPAW_CONSOLE_TOKEN: 'unused' }
  assert.deepEqual(qwenpawHeaders('mc-god', env), { ...legacy, Authorization: 'Bearer test.signature' })
  writeFileSync(tokenFile, 'rotated.signature\n')
  assert.equal(qwenpawHeaders('mc-herald', env).Authorization, 'Bearer rotated.signature')
})

test('configured empty, missing, oversized and multiline credentials fail closed', () => {
  const tokenFile = join(temp, 'bad-token.txt')
  const env = { QWENPAW_CONSOLE_TOKEN_FILE: tokenFile }
  assert.throws(() => qwenpawHeaders('mc-god', env))
  for (const text of ['', 'test\ninjected', 'a'.repeat(8193)]) {
    writeFileSync(tokenFile, text)
    assert.throws(() => qwenpawHeaders('mc-god', env))
  }
})
