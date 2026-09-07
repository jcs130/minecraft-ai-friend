import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const world = resolve(import.meta.dirname, '..')
const deps = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const { build } = createRequire(join(deps, '.qd-tests.cjs'))('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'qd-travel-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))
const file = join(temp, 'travel.mjs')
await build({ entryPoints: [join(world, 'src/waypoint-travel.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { createWaypointTravel } = await import(pathToFileURL(file).href)
const wp = { id: 1, name: '家', x: 10.2, y: 64, z: 20.3, dim: 'minecraft:the_nether', createdAt: 0 }
const uuid = '00000000-0000-0000-0000-000000000001'
const reply = (extra = {}) => 'QD_WARP_JSON ' + JSON.stringify({ schema: 1, action: 'teleport', ok: true, code: 'teleported', summary: 'ok', actor: 'Probe', actorUuid: uuid, dimension: wp.dim, x: 10.5, y: 64, z: 20.5, ...extra })

test('saved dimension and coordinates reach the server, successful landing is correlated', async () => {
  const commands = []
  const client = createWaypointTravel(async c => { commands.push(c); return reply() })
  assert.equal((await client.teleport('Probe', wp)).ok, true)
  assert.deepEqual(commands, ['qdwarp "Probe" "minecraft:the_nether" 10.2 64 20.3'])
})
test('UUID resolution keeps exact actor while location includes actual dimension', async () => {
  const client = createWaypointTravel(async c => {
    assert.equal(c, `qdlocation "${uuid}"`)
    return reply({ action: 'location', code: 'ok' })
  })
  assert.equal((await client.location(uuid)).dimension, wp.dim)
})
test('invalid actor or unsafe numeric input sends no command', async () => {
  const client = createWaypointTravel(async () => { assert.fail('No RCON permitted') })
  assert.equal((await client.teleport('@a', wp)).code, 'invalid_actor')
  for (const patch of [{ dim: 'nether run kill @a' }, { x: NaN }, { y: Infinity }, { z: 30_000_000 }]) {
    assert.equal((await client.teleport('Probe', { ...wp, ...patch })).code, 'invalid_waypoint')
  }
})
test('wrong actor/dimension/distant coordinates never claim arrival and never replay', async () => {
  for (const patch of [{ actor: 'Other' }, { dimension: 'minecraft:overworld' }, { x: 900 }, { y: '64' }, { action: 'cast' }]) {
    let calls = 0
    const client = createWaypointTravel(async () => { calls++; return reply(patch) })
    assert.equal((await client.teleport('Probe', wp)).code, 'outcome_unknown')
    assert.equal(calls, 1)
  }
})
test('native unsafe landing and cooldown rejection remain explicit failures', async () => {
  for (const code of ['unsafe_destination', 'cooldown', 'dimension_unavailable']) {
    const client = createWaypointTravel(async () => reply({ ok: false, code, dimension: 'minecraft:overworld' }))
    const result = await client.teleport('Probe', wp)
    assert.equal(result.ok, false); assert.equal(result.code, code)
  }
})
test('corrupt/missing/duplicate or disconnected response is unknown and not repeated', async () => {
  for (const output of ['', 'QD_WARP_JSON {', reply() + '\n' + reply(), null]) {
    let calls = 0
    const client = createWaypointTravel(async () => { calls++; if (output === null) throw Error('lost'); return output })
    assert.equal((await client.teleport('Probe', wp)).code, 'outcome_unknown')
    assert.equal(calls, 1)
  }
})
