const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
function fixture () {
  const queue = [], messages = [], commands = []
  const p = { uuid: '11111111-2222-3333-4444-555555555555', name: { string: '@a' }, x: 8.5, y: 69, z: 0.5,
    level: { dimension: 'myagentworld:wilderness' }, connection: { toString: () => 'connection-one' },
    tell: text => messages.push(JSON.parse(text.slice(9))) }
  const server = { getPlayerList: () => ({ getPlayer: () => p }),
    scheduleInTicks: (_, callback) => queue.push(callback),
    runCommandSilent: command => { commands.push(command); queue.unshift(() => { p.level.dimension = 'minecraft:overworld'; p.x = -582.5; p.y = 69; p.z = 934.5 }) } }
  p.server = server
  const ctx = vm.createContext({ ServerEvents: { loaded () {}, commandRegistry () {} }, PlayerEvents: { loggedIn () {} },
    global: {}, Java: { loadClass: () => ({ randomUUID: () => 'request-one' }) }, JSON, Date, Math, String })
  vm.runInContext(fs.readFileSync(require.resolve('./aincrad-profile.js'), 'utf8'), ctx)
  return { ctx, p, server, queue, messages, commands, flush: () => { for (let i = 0; queue.length && i < 30; i++) queue.shift()() } }
}
test('queued teleport is accepted first and completed only after the actual body moves', () => {
  const f = fixture(); assert.equal(f.ctx.mawGo(f.p, 'spawn'), 1)
  assert.equal(f.messages[0].status, 'accepted'); assert.equal(f.messages.length, 1)
  assert.equal(f.p.level.dimension, 'myagentworld:wilderness')
  assert.ok(f.commands[0].includes(f.p.uuid)); assert.ok(!f.commands[0].includes('@a'))
  f.flush(); assert.equal(f.messages.at(-1).status, 'completed')
  assert.equal(f.messages.at(-1).position.x, f.p.x)
  assert.equal(f.messages.at(-1).requestId, 'request-one')
})
test('an in-flight request is reported busy without dispatching another move', () => {
  const f = fixture(); f.ctx.mawGo(f.p, 'spawn'); assert.equal(f.ctx.mawGo(f.p, 'spawn'), 0)
  assert.equal(f.commands.length, 1); assert.equal(f.messages.at(-1).status, 'busy')
  assert.equal(f.messages.at(-1).requestId, 'request-one')
})
test('a verification exception after dispatch is unknown, never a no-change failure', () => {
  const f = fixture(); f.ctx.mawGo(f.p, 'spawn'); f.queue.shift()()
  f.server.getPlayerList = () => { throw Error('observation unavailable') }
  f.flush(); assert.equal(f.messages.at(-1).status, 'unknown'); assert.equal(f.messages.at(-1).changed, null)
  assert.equal(f.ctx.mawTravelRequests[f.p.uuid].status, 'unknown')
})
