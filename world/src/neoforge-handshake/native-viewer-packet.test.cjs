'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { CHANNEL, encodeNativePacket, decodeNativePacket, attachNativeViewerPackets } = require('./native-viewer-packet.cjs')
const hash = 'a'.repeat(64)

test('1.21.1 hurt animation remains a received cue on the same connection', () => {
  const params = { entityId: 91, yaw: 123.25 }
  const body = decodeNativePacket(encodeNativePacket('hurt_animation', params, hash, 1), hash)
  assert.equal(body.name, 'hurt_animation')
  assert.deepEqual(body.params, params)
})

test('only the exact original TLM two-varint animation payload is mirrored', () => {
  const original = { channel: 'touhou_little_maid:maid_animation', data: Buffer.from([0xdb, 1, 1]) }
  const body = decodeNativePacket(encodeNativePacket('custom_payload', original, hash, 1), hash)
  assert.equal(body.name, 'maid_animation')
  assert.deepEqual(body.params, { entityId: 219, animationId: 1, sourceChannel: original.channel })
  assert.equal(encodeNativePacket('custom_payload', { channel: 'maw_agent:menu_state', data: Buffer.from('{}') }, hash, 2), null)
  for (const data of [Buffer.from([1]), Buffer.from([1, 0, 0]), Buffer.from([128, 128])]) {
    assert.throws(() => encodeNativePacket('custom_payload', { ...original, data }, hash, 2), /MAID_ANIMATION_PAYLOAD_INVALID/)
  }
})

test('native animation clock preserves absolute game age and frozen day sign', () => {
  const time = { age: 315339n, time: -1000n }
  const body = decodeNativePacket(encodeNativePacket('update_time', time, hash, 1), hash)
  assert.deepEqual(body.params, time)
  assert.equal(body.name, 'update_time')
  assert.equal(encodeNativePacket('chat', { message: 'clock' }, hash, 2), null)
})

test('native snapshot survives a later vanilla projection without mutating server data', () => {
  const original = { location: { x: 603, y: 64, z: 600 }, type: 74628, raw: Buffer.from([1, 2, 255]), long: 9007199254740999n }
  const wire = encodeNativePacket('block_change', original, hash, 1)
  original.type = 1
  original.raw[0] = 0
  const body = decodeNativePacket(wire, hash)
  assert.equal(body.params.type, 74628)
  assert.deepEqual(body.params.raw, Buffer.from([1, 2, 255]))
  assert.equal(body.params.long, 9007199254740999n)
  assert.equal(encodeNativePacket('chat', original, hash, 2), null)
})

test('native packets require the exact modpack state table and bounded binary framing', () => {
  const wire = encodeNativePacket('map_chunk', { chunkData: Buffer.from([0, 1, 2]), x: -7, z: 2 }, hash, 1)
  assert.throws(() => decodeNativePacket(wire, 'b'.repeat(64)), /REGISTRY_OR_SCHEMA/)
  assert.throws(() => decodeNativePacket(Buffer.from('{}'), hash), /WIRE_INVALID/)
  assert.throws(() => encodeNativePacket('map_chunk', {}, '', 1), /ENVELOPE_INVALID/)
  assert.throws(() => encodeNativePacket('map_chunk', { chunkData: Buffer.alloc(17 * 1024 * 1024) }, hash, 1), /PACKET_TOO_LARGE/)
})

test('each attached account receives only its own connection and stops after a gap', () => {
  const bot = () => Object.assign(new EventEmitter(), { _client: new EventEmitter() })
  const a = bot(), b = bot()
  const left = attachNativeViewerPackets(a, hash), right = attachNativeViewerPackets(b, hash)
  const received = [], errors = []
  left.events.on('packet', frame => received.push(frame))
  left.events.on('unavailable', e => errors.push(e.message))
  a._client.emit('custom_payload', { channel: CHANNEL, data: encodeNativePacket('block_change', { type: 42906 }, hash, 1) })
  assert.equal(received.length, 1)
  assert.equal(right.health().packets, 0)
  a._client.emit('custom_payload', { channel: CHANNEL, data: encodeNativePacket('block_change', { type: 1 }, hash, 3) })
  a._client.emit('custom_payload', { channel: CHANNEL, data: encodeNativePacket('block_change', { type: 2 }, hash, 4) })
  assert.equal(received.length, 1)
  assert.deepEqual(errors, ['NATIVE_VIEWER_SEQUENCE_GAP'])
  assert.equal(left.health().failed, true)
  left.detach(); right.detach()
  assert.equal(a._client.listenerCount('custom_payload'), 0)
})
