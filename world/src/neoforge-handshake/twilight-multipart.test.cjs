'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { decodeTwilightMultipart, CHANNEL } = require('./twilight-multipart.cjs')
const { createBedrockFrontendProtocol } = require('./component-protocol.cjs')
const { encodeNativePacket, decodeNativePacket } = require('./native-viewer-packet.cjs')
const protocol = createBedrockFrontendProtocol()
function wire (metadata = Buffer.from([255])) {
  const body = Buffer.alloc(4 + 4 + 24 + 16 + 1)
  let o = 0
  body.writeInt32BE(100, o); o += 4; body.writeInt32BE(101, o); o += 4
  for (const n of [-550.25, 64, -365]) { body.writeDoubleBE(n, o); o += 8 }
  for (const n of [180, -22.5, 2, 2]) { body.writeFloatBE(n, o); o += 4 }
  body[o] = 0
  const end = Buffer.alloc(4); end.writeInt32BE(-1)
  return Buffer.concat([body, metadata, end])
}
test('the exact original multipart layout preserves absolute position, size and native metadata', () => {
  const metadata = protocol.createPacketBuffer('entityMetadata', [{ key: 0, type: 'byte', value: 32 }])
  const result = decodeTwilightMultipart(wire(metadata), protocol)
  assert.equal(result.entityId, 100); assert.equal(result.sourceChannel, CHANNEL)
  assert.deepEqual(result.parts[0].position, { x: -550.25, y: 64, z: -365 })
  assert.deepEqual(result.parts[0].metadata, [{ key: 0, type: 'byte', value: 32 }])
  const hash = 'a'.repeat(64), message = encodeNativePacket('custom_payload', { channel: CHANNEL, data: wire(metadata) }, hash, 1, protocol)
  assert.deepEqual(decodeNativePacket(message, hash).params, result)
})
test('truncation, trailing data, invalid bounds and noncanonical parts fail before frame publication', () => {
  const good = wire()
  for (let i = 0; i < good.length; i++) assert.throws(() => decodeTwilightMultipart(good.subarray(0, i), protocol))
  assert.throws(() => decodeTwilightMultipart(Buffer.concat([good, Buffer.from([0])]), protocol), /TRAILING_BYTES/)
  const bad = Buffer.from(good); bad.writeDoubleBE(NaN, 8)
  assert.throws(() => decodeTwilightMultipart(bad, protocol), /VALUE_INVALID/)
  const same = Buffer.from(good); same.writeInt32BE(100, 4)
  assert.throws(() => decodeTwilightMultipart(same, protocol), /PART_INVALID/)
})
