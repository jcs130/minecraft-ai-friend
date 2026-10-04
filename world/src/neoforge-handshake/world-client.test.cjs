'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachWorldClient } = require('./world-client.cjs')
const { Vec3 } = require('vec3')

test('look query correlates only its own private native reply', async () => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  let sent
  bot._client.write = (name, body) => { sent = { name, body } }
  const world = attachWorldClient(bot)
  const waiting = world.look()
  assert.equal(sent.name, 'custom_payload')
  assert.equal(sent.body.channel, 'maw_agent:world_query')
  const query = JSON.parse(sent.body.data.toString('utf8'))
  assert.equal(query.kind, 'look')
  bot._client.emit('custom_payload', { channel: 'maw_agent:world_state',
    data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'world_receipt', requestId: 'someone_else', ok: true })) })
  bot._client.emit('custom_payload', { channel: 'maw_agent:world_state',
    data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'world_receipt', requestId: query.requestId,
      ok: true, position: { x: 3, y: 64, z: -2 }, block: { id: 'create:shaft' } })) })
  assert.equal((await waiting).block.id, 'create:shaft')
  world.detach()
})

test('native raycast waits until forced rotation has reached the physics tick', async () => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  let finishTick, sent = null
  const operations = []
  bot.lookAt = async (point, force) => operations.push({ kind: 'look', point, force })
  bot.waitForTicks = ticks => {
    operations.push({ kind: 'tick', ticks })
    return new Promise(resolve => { finishTick = resolve })
  }
  bot._client.write = (name, body) => { sent = { name, body } }
  const world = attachWorldClient(bot)
  const target = { position: new Vec3(0, 65, -7) }
  const waiting = world.lookAtBlock(target)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(operations, [
    { kind: 'look', point: target.position.offset(0.5, 0.5, 0.5), force: true },
    { kind: 'tick', ticks: 1 }
  ])
  assert.equal(sent, null, 'query must not overtake the outgoing rotation')
  finishTick()
  await new Promise(resolve => setImmediate(resolve))
  const request = JSON.parse(sent.body.data.toString('utf8'))
  bot._client.emit('custom_payload', { channel: 'maw_agent:world_state', data: Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'world_receipt', requestId: request.requestId, ok: true,
    position: { x: 0, y: 65, z: -7 }, block: { id: 'minecraft:mangrove_log' }
  })) })
  assert.equal((await waiting).ok, true)
  world.detach()
})

test('failed physics synchronization never sends a stale raycast query', async () => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot.lookAt = async () => {}
  bot.waitForTicks = async () => { throw Error('connection ended while turning') }
  let writes = 0
  bot._client.write = () => { writes++ }
  const world = attachWorldClient(bot)
  await assert.rejects(world.lookAtBlock({ position: new Vec3(0, 65, -7) }), /connection ended/)
  assert.equal(writes, 0)
  world.detach()
})
