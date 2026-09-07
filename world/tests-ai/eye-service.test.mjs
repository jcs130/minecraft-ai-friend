import test from 'node:test'
import assert from 'node:assert/strict'
import { createEyeController, startEyeService } from '../admin/eye-service.mts'

const UUID = '12345678-1234-1234-1234-123456789abc'
function fixture() {
  let timestamp = 1000
  const bot = { username: 'Goddess', _client: { state: 'play' }, entity: { id: 1, position: { x: 10, y: 70, z: 20 }, equipment: [] },
    game: { dimension: 'minecraft:overworld' }, health: 20, food: 20,
    players: { MengMeng: { username: 'MengMeng', uuid: UUID } }, entities: {},
    inventory: { slots: [{ name: 'stick', displayName: 'Staff', count: 1, nbt: { secret: 'PRIVATE_SENTINEL' } }] } }
  let current = bot
  const commands = []
  const sendCommand = async command => { commands.push(command); return command.startsWith('gamemode')
    ? "Set Goddess's game mode to Spectator Mode" : 'Teleported Goddess to fixture' }
  const options = { getBot: () => current, sendCommand, now: () => timestamp }
  return { bot, commands, options, controller: createEyeController(options),
    advance: value => { timestamp += value }, replace: value => { current = value } }
}

test('public data is from the observer; remote target inventory and hidden NBT remain unavailable', () => {
  const f = fixture(), state = f.controller.state()
  assert.equal(state.observer.inventory.available, true)
  assert.equal(state.observer.inventory.owner, 'Goddess')
  assert.equal(state.targets[0].inventoryAvailable, false)
  assert.equal(state.targets[0].position, null)
  assert.equal(JSON.stringify(state).includes('PRIVATE_SENTINEL'), false)
  assert.deepEqual(f.commands, [])
  f.bot._client.ended = true
  assert.equal(f.controller.state().observer.online, false)
  assert.equal(f.controller.state().observer.inventory.available, false)
})

test('strict target syntax and actual tab-list membership are required before any command', async () => {
  const f = fixture()
  for (const target of ['@a', 'MengMeng\nkill @a', 'not_online', '1234', { name: 'MengMeng' }, UUID.replace('a', 'd')]) {
    await assert.rejects(f.controller.control({ action: 'follow', target }))
  }
  await assert.rejects(f.controller.control({ action: 'follow', target: 'MengMeng', command: 'kill @a' }))
  await assert.rejects(f.controller.control({ action: 'teleport', target: 'MengMeng' }))
  assert.deepEqual(f.commands, [])
})

test('follow UUID resolves the online name, leases 120 seconds and only moves Goddess', async () => {
  const f = fixture()
  const state = await f.controller.control({ action: 'follow', target: UUID })
  assert.equal(state.follow.active, true)
  assert.equal(state.follow.target, 'MengMeng')
  assert.equal(Date.parse(state.follow.expiresAt), 121000)
  assert.deepEqual(f.commands, ['gamemode spectator Goddess', 'tp Goddess MengMeng'])
  f.bot.game.dimension = 'minecraft:the_nether'
  await f.controller.control({ action: 'park' })
  assert.equal(f.commands.at(-1), 'execute in minecraft:overworld run tp Goddess 10.000 70.000 20.000')
  assert.equal(f.controller.state().follow.parked, true)
})

test('renewal is explicit, same-target and same-lease; reads and repeated follow do not extend it', async () => {
  const f = fixture(), first = await f.controller.control({ action: 'follow', target: 'MengMeng' })
  f.advance(10000)
  assert.equal(f.controller.state().follow.expiresAt, first.follow.expiresAt)
  for (const body of [{ action: 'follow', target: 'MengMeng' },
    { action: 'follow', target: 'MengMeng', leaseId: first.follow.leaseId },
    { action: 'follow', target: 'MengMeng', renew: true, leaseId: 'wrong' }]) await assert.rejects(f.controller.control(body))
  const renewed = await f.controller.control({ action: 'follow', target: 'MengMeng', renew: true, leaseId: first.follow.leaseId })
  assert.equal(Date.parse(renewed.follow.expiresAt), 131000)
  assert.equal(f.commands.length, 2)
})

test('an existing spectator follows without a failing redundant gamemode command', async () => {
  const f = fixture()
  f.bot.game.gameMode = 'spectator'
  const state = await f.controller.control({ action: 'follow', target: 'MengMeng' })
  assert.equal(state.follow.active, true)
  assert.deepEqual(f.commands, ['tp Goddess MengMeng'])
})

test('one-second follow limit and one in-flight command prevent stacked ticks', async () => {
  const f = fixture()
  await f.controller.control({ action: 'follow', target: 'MengMeng' })
  await f.controller.tick(); f.advance(999); await f.controller.tick()
  assert.equal(f.commands.length, 2)
  f.advance(1); await f.controller.tick()
  assert.equal(f.commands.length, 3)
  let unblock
  const pending = new Promise(resolve => { unblock = resolve })
  const commands = []
  const c = createEyeController({ ...f.options, sendCommand: async command => {
    commands.push(command); await pending; return command.startsWith('gamemode') ? 'Spectator Mode' : 'Teleported Goddess to fixture'
  } })
  const start = c.control({ action: 'follow', target: 'MengMeng' })
  await Promise.resolve(); f.advance(1000); await c.tick(); await c.tick()
  assert.equal(commands.length, 1)
  unblock(); await start
  await c.close()
})

test('lease expiration and target departure park without an implicit renewal', async () => {
  for (const expired of [true, false]) {
    const f = fixture()
    const start = await f.controller.control({ action: 'follow', target: 'MengMeng' })
    if (expired) f.advance(120000)
    else { f.advance(1000); delete f.bot.players.MengMeng }
    await f.controller.tick()
    assert.equal(f.controller.state().follow.active, false)
    assert.equal(f.controller.state().follow.parked, true)
    assert.match(f.commands.at(-1), /^execute in minecraft:overworld run tp Goddess /)
    await assert.rejects(f.controller.control({ action: 'follow', target: 'MengMeng', renew: true, leaseId: start.follow.leaseId }))
  }
})

test('observer reconnect cancels the lease and parks the replacement, without moving the target', async () => {
  const f = fixture()
  await f.controller.control({ action: 'follow', target: 'MengMeng' })
  f.replace({ ...f.bot, entity: { ...f.bot.entity, position: { x: 100, y: 40, z: 500 } } })
  await f.controller.tick()
  assert.equal(f.controller.state().follow.parked, true)
  assert.equal(f.commands.filter(command => command === 'tp Goddess MengMeng').length, 1)
})

test('unacknowledged commands never report successful follow and do not leak RCON errors', async () => {
  const f = fixture()
  const c = createEyeController({ ...f.options, sendCommand: async () => 'PRIVATE_SENTINEL' })
  await assert.rejects(c.control({ action: 'follow', target: 'MengMeng' }), /observer_follow_failed/)
  assert.equal(c.state().follow.active, false)
  assert.equal(JSON.stringify(c.state()).includes('PRIVATE_SENTINEL'), false)
  assert.equal(c.state().follow.error, 'observer_park_failed')
})

test('invalid dimensions or non-finite coordinates cannot become park commands', async () => {
  const f = fixture()
  f.bot.game.dimension = 'minecraft:overworld run kill @a'
  await assert.rejects(f.controller.control({ action: 'follow', target: 'MengMeng' }))
  f.bot.game.dimension = 'minecraft:overworld'; f.bot.entity.position.x = Infinity
  await assert.rejects(f.controller.control({ action: 'follow', target: 'MengMeng' }))
  assert.deepEqual(f.commands, [])
})

test('HTTP requires dedicated token, forbids browser origins and only accepts bounded observer JSON', async t => {
  const f = fixture(), token = 'a'.repeat(64)
  const service = startEyeService({ ...f.options, token, host: '127.0.0.1', port: 0 })
  await service.ready; t.after(() => service.close())
  const base = `http://127.0.0.1:${service.server.address().port}`
  const headers = { Authorization: 'Bearer ' + token }
  assert.equal((await fetch(base + '/state')).status, 401)
  assert.equal((await fetch(base + '/state', { headers: { ...headers, Origin: 'http://untrusted.test' } })).status, 403)
  const health = await (await fetch(base + '/healthz', { headers })).json()
  assert.equal(health.ok, true)
  assert.equal((await fetch(base + '/observer', { headers })).status, 405)
  assert.equal((await fetch(base + '/observer', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: 'x'.repeat(2049) })).status, 413)
  assert.equal((await fetch(base + '/observer', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{broken' })).status, 400)
  assert.equal(f.commands.length, 0)
  const response = await fetch(base + '/observer', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'follow', target: 'MengMeng' }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).state.follow.active, true)
})
