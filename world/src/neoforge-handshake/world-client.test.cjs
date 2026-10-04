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

function nativeReplyBot () {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot.lookAt = async () => {}
  bot.waitForTicks = async () => {}
  let sent
  bot._client.write = (name, packet) => { sent = { name, packet } }
  return {
    bot,
    sent: () => sent,
    reply: body => bot._client.emit('custom_payload', {
      channel: 'maw_agent:world_state',
      data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'world_receipt',
        requestId: JSON.parse(sent.packet.data.toString('utf8')).requestId, ...body }), 'utf8')
    })
  }
}

test('visible millstone reply retains native input, complete components and real processing values', async () => {
  const fixture = nativeReplyBot()
  const world = attachWorldClient(fixture.bot)
  const waiting = world.lookAtBlock({ position: new Vec3(-4, 65, 9) })
  await new Promise(resolve => setImmediate(resolve))
  const request = JSON.parse(fixture.sent().packet.data.toString('utf8'))
  assert.deepEqual(Object.keys(request).sort(), ['kind', 'requestId', 'schemaVersion'],
    'the query must not ask the server to inspect arbitrary coordinates')
  const block = {
    id: 'create:millstone', blockEntityType: 'create:millstone', properties: { axis: 'y' },
    kinetic: { speed: -32, theoreticalSpeed: -32, rpm: -32, overstressed: false,
      speedRequirementFulfilled: true, networkConnected: true, networkStress: 128,
      stressCapacity: 256, stressUnit: 'SU' },
    processing: { type: 'create:milling', status: 'processing', inputSlotCount: 1,
      outputSlotCount: 9, input: [{ slot: 0, id: 'minecraft:wheat', count: 2,
        snbt: '{count:2,id:"minecraft:wheat",components:{"minecraft:custom_name":\'{"text":"本人小麦"}\'}}' }],
      output: [{ slot: 0, id: 'create:wheat_flour', count: 1,
        snbt: '{count:1,id:"create:wheat_flour"}' }], timer: 148,
      timerUnit: 'processing_work_ticks', processingSpeed: 2, advancing: true,
      waitingForPower: false, outputAvailable: true, outputBlocked: false,
      canCollectOutput: true, recipeId: 'create:milling/wheat', recipeDuration: 150 }
  }
  fixture.reply({ ok: true, playerUuid: 'mine', dimension: 'minecraft:overworld',
    position: { x: -4, y: 65, z: 9 }, block })
  const receipt = await waiting
  assert.equal(receipt.ok, true)
  assert.deepEqual(receipt.block, block)
  assert.equal(receipt.block.processing.input[0].snbt, block.processing.input[0].snbt)
  world.detach()
})

test('no network is unknown capacity and zero power never becomes guessed progress', async () => {
  const fixture = nativeReplyBot()
  const world = attachWorldClient(fixture.bot)
  const waiting = world.look()
  const block = { id: 'create:millstone',
    kinetic: { speed: 0, rpm: 0, overstressed: false, networkConnected: false,
      networkStress: null, stressCapacity: null, stressUnit: 'SU' },
    processing: { status: 'waiting_power', input: [{ slot: 0, id: 'minecraft:wheat', count: 1,
      snbt: '{count:1,id:"minecraft:wheat"}' }], output: [], timer: 96,
      timerUnit: 'processing_work_ticks', processingSpeed: 1, advancing: false,
      waitingForPower: true, outputAvailable: false, outputBlocked: false, canCollectOutput: false }
  }
  fixture.reply({ ok: true, position: { x: -4, y: 65, z: 9 }, block })
  assert.deepEqual((await waiting).block, block)
  const oversized = world.look()
  fixture.reply({ ok: false, code: 'world_state_too_large', maxBytes: 16384 })
  assert.equal((await oversized).code, 'world_state_too_large')
  world.detach()
})

test('occluding block cannot pass as the requested machine even if its reply has processing', async () => {
  const fixture = nativeReplyBot()
  const world = attachWorldClient(fixture.bot)
  const waiting = world.lookAtBlock({ position: new Vec3(-4, 65, 9) })
  await new Promise(resolve => setImmediate(resolve))
  fixture.reply({ ok: true, position: { x: -4, y: 65, z: 8 }, block: {
    id: 'create:millstone', processing: { status: 'output_ready', input: [], output: [
      { slot: 0, id: 'create:wheat_flour', count: 3, snbt: '{count:3,id:"create:wheat_flour"}' }
    ], canCollectOutput: true }
  } })
  const receipt = await waiting
  assert.equal(receipt.ok, false)
  assert.equal(receipt.code, 'different_visible_block')
  assert.deepEqual(receipt.position, { x: -4, y: 65, z: 8 })
  world.detach()
})
