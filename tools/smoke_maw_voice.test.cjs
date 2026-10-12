'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { Reader, readSecret, readAudio, seal, open } = require('./smoke_maw_voice.cjs')

test('voice encryption authenticates ciphertext and rejects another connection key', () => {
  const key = crypto.randomBytes(16), input = Buffer.from([1, 3, 248, 255, 254])
  const encrypted = seal(input, key)
  assert.deepEqual(open(encrypted, key), input)
  assert.throws(() => open(encrypted, crypto.randomBytes(16)))
  encrypted[12] ^= 1
  assert.throws(() => open(encrypted, key))
})
test('bounded voice decoder rejects truncated, oversized and malformed varints', () => {
  assert.throws(() => new Reader(Buffer.from([16, 1])).array(1275))
  assert.throws(() => new Reader(Buffer.from([128, 16])).array(1275))
  assert.throws(() => new Reader(Buffer.alloc(6, 255)).variable())
  assert.throws(() => readSecret(Buffer.alloc(40)))
  assert.throws(() => open(Buffer.alloc(28), Buffer.alloc(16)))
})
test('secret decoder keeps player identity and explicit endpoint without exposing key', () => {
  const key = crypto.randomBytes(16), host = Buffer.from('192.168.3.163:28989')
  const base = Buffer.alloc(54)
  key.copy(base); base.writeInt32BE(28989, 16)
  Buffer.from('123456781234123412341234567890ab', 'hex').copy(base, 20)
  base[36] = 0; base.writeInt32BE(1275, 37); base.writeDoubleBE(32, 41)
  base.writeInt32BE(1000, 49); base[53] = 0
  const wire = Buffer.concat([base, Buffer.from([host.length]), host, Buffer.from([1])])
  const decoded = readSecret(wire)
  assert.equal(decoded.uuid, '12345678-1234-1234-1234-1234567890ab')
  assert.equal(decoded.host, '192.168.3.163:28989')
  assert.equal(decoded.range, 32); assert.equal(decoded.groupsEnabled, false)
  assert.deepEqual(decoded.key, key)
  assert.throws(() => readSecret(Buffer.concat([wire, Buffer.from([0])])) )
})
test('player sound preserves whisper range and exact Opus bytes', () => {
  const ids = Buffer.from('123456781234123412341234567890ab'.repeat(2), 'hex')
  const tail = Buffer.alloc(13); tail.writeBigInt64BE(42n); tail.writeFloatBE(8, 8); tail[12] = 1
  const frame = Buffer.concat([ids, Buffer.from([3, 248, 255, 254]), tail])
  const value = readAudio(2, new Reader(frame))
  assert.equal(value.sender, '12345678-1234-1234-1234-1234567890ab')
  assert.equal(value.range, 8); assert.equal(value.whisper, true); assert.equal(value.sequence, 42n)
  assert.deepEqual(value.opus, Buffer.from([248, 255, 254]))
  assert.throws(() => readAudio(2, new Reader(frame.subarray(0, -1))))
})
