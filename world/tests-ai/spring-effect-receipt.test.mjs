import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { springRcon } from './spring-receipt-fixture.mjs'
const world = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deps = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const { build } = createRequire(join(deps, '.qd-test.cjs'))('esbuild')
const dir = mkdtempSync(join(tmpdir(), 'qd-spring-proof-'))
after(() => rmSync(dir, { recursive: true, force: true }))
await build({ entryPoints: [join(world, 'src/spring-effect-receipt.ts')], outfile: join(dir, 'spring.mjs'),
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { castSpring, withSkillRequest } = await import(pathToFileURL(join(dir, 'spring.mjs')))
const requestId = '12345678-1234-1234-1234-123456789abc'
const target = { actor: 'QA', actorUuid: '00000000-0000-0000-0000-000000000001',
  dimension: 'minecraft:overworld', x: -642, y: 50, z: 1058 }
const cast = (rcon, point = target) => withSkillRequest(requestId, 'QA', () => castSpring(rcon.send, point))

test('empty RCON text succeeds only with exact native success/result and source water', async () => {
  const rcon = springRcon(), receipt = await cast(rcon)
  assert.equal(receipt.state, 'completed'); assert.equal(receipt.ok, true)
  assert.equal(receipt.requestId, requestId); assert.equal(rcon.effects, 1)
  assert.match(rcon.commands.find(c => c.includes('run setblock')), /as 00000000-0000-0000-0000-000000000001 at @s if dimension minecraft:overworld run setblock -642 50 1058 minecraft:water$/)
})
test('lost transport response can read same native callback without replay', async () => {
  const rcon = springRcon({ lostResponse: true })
  assert.equal((await cast(rcon)).state, 'completed'); assert.equal(rcon.effects, 1)
})
test('current water without attributed callback remains effect_observed and never success', async () => {
  const rcon = springRcon({ success: -1, result: -1, lostResponse: true })
  const receipt = await cast(rcon)
  assert.equal(receipt.state, 'effect_observed'); assert.equal(receipt.ok, false); assert.equal(rcon.effects, 1)
})
test('pre-existing water, unloaded target and unavailable precondition never send effect', async () => {
  for (const [options, state] of [[{ beforeWater: 1 }, 'no_change'], [{ loaded: 0 }, 'not_executed'],
    [{ readFailure: 'beforeWater' }, 'not_executed']]) {
    const rcon = springRcon(options); assert.equal((await cast(rcon)).state, state); assert.equal(rcon.effects, 0)
  }
})
test('confirmed rejection and missing callback are distinguishable', async () => {
  const rejected = springRcon({ success: 0, result: 0 })
  assert.equal((await cast(rejected)).state, 'rejected')
  const unknown = springRcon({ readFailure: 'success' })
  assert.equal((await cast(unknown)).state, 'unknown'); assert.equal(unknown.effects, 1)
})
test('existing request cannot overwrite its storage or redispatch after restart', async () => {
  const rcon = springRcon(); await cast(rcon)
  const previous = JSON.stringify([...rcon.records])
  assert.equal((await cast(rcon)).state, 'unknown')
  assert.equal((await cast(rcon, { ...target, x: 1 })).state, 'unknown')
  assert.equal(rcon.effects, 1); assert.equal(JSON.stringify([...rcon.records]), previous)
})
test('invalid actor binding, UUID, dimension and noninteger coordinates fail before claim', async () => {
  for (const point of [{ ...target, actor: 'Other' }, { ...target, actorUuid: '@a' },
    { ...target, dimension: 'minecraft:overworld run kill @a' }, { ...target, x: 1.2 }]) {
    const rcon = springRcon(); assert.equal((await cast(rcon, point)).state, 'not_executed')
    assert.equal(rcon.commands.length, 0)
  }
})
