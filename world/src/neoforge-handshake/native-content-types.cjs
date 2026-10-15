'use strict'

function ironCount (value) {
  // Parser allocation bound, not a server gameplay limit. Check before reading
  // entries so a bad count cannot consume a neighbouring inventory stack.
  if (!Number.isInteger(value) || value < 0 || value > 1024) throw Error('INVALID_IRON_COMPONENT_COUNT')
  return value
}

function readVarLong (buffer, start) {
  let value = 0n
  for (let i = 0; i < 10; i++) {
    if (start + i >= buffer.length) throw Error('TRUNCATED_FARMER_VAR_LONG')
    const byte = buffer[start + i]
    if (i === 9 && byte > 1) throw Error('INVALID_FARMER_VAR_LONG')
    value |= BigInt(byte & 127) << BigInt(i * 7)
    if (!(byte & 128)) {
      if (i && byte === 0) throw Error('INVALID_FARMER_VAR_LONG')
      value = BigInt.asIntN(64, value)
      // Match the other native protocol LONGs' JSON-safe [high, low] form.
      return { value: [Number(value >> 32n), Number(value & 0xffffffffn)], size: i + 1 }
    }
  }
  throw Error('INVALID_FARMER_VAR_LONG')
}

function encodeVarLong (value, buffer, offset) {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) ||
      value[0] < -0x80000000 || value[0] > 0x7fffffff || !Number.isInteger(value[1]) ||
      value[1] < 0 || value[1] > 0xffffffff) throw Error('INVALID_FARMER_VAR_LONG')
  let remaining = BigInt.asUintN(64, (BigInt(value[0]) << 32n) | BigInt(value[1]))
  const start = offset
  do {
    const byte = Number(remaining & 127n)
    remaining >>= 7n
    if (buffer) buffer.writeUInt8(remaining ? byte | 128 : byte, offset)
    offset++
  } while (remaining)
  return offset - start
}

// minecraft-protocol 1.68.0 aliases VarLong to its 32-bit VarInt. Isolate the
// proper 64-bit codec here; never mutate the vanilla protocol's global cache.
const contentNativeTypes = {
  Read: {
    mawIronCount: ['native', (buffer, offset) => ({ value: ironCount(buffer.readInt32BE(offset)), size: 4 })],
    mawFarmerVarLong: ['native', readVarLong]
  },
  Write: {
    mawIronCount: ['native', (value, buffer, offset) => { buffer.writeInt32BE(ironCount(value), offset); return offset + 4 }],
    mawFarmerVarLong: ['native', (value, buffer, offset) => offset + encodeVarLong(value, buffer, offset)]
  },
  SizeOf: {
    mawIronCount: ['native', value => { ironCount(value); return 4 }],
    mawFarmerVarLong: ['native', value => encodeVarLong(value, null, 0)]
  }
}
module.exports = { contentNativeTypes }
