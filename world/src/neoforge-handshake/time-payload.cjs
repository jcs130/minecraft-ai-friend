// NeoForge 21.1 ClientboundCustomSetTimePayload -> vanilla update_time.
// Source codec: VAR_LONG gameTime, VAR_LONG dayTime, BOOL gameRule,
// FLOAT dayTimeFraction, FLOAT dayTimePerTick.
'use strict'

function readVarLong (data, start) {
  let value = 0n
  let offset = start
  for (let i = 0; i < 10; i++) {
    if (offset >= data.length) throw new Error('truncated VarLong')
    const byte = data[offset++]
    value |= BigInt(byte & 0x7f) << BigInt(7 * i)
    if ((byte & 0x80) === 0) return { value: BigInt.asIntN(64, value), offset }
  }
  throw new Error('VarLong exceeds 10 bytes')
}

function decodeNeoForgeTime (data) {
  if (!Buffer.isBuffer(data)) throw new TypeError('time payload must be Buffer')
  const game = readVarLong(data, 0)
  const day = readVarLong(data, game.offset)
  if (data.length !== day.offset + 9) throw new Error('invalid time payload length')
  const gameRule = data[day.offset] !== 0
  const fraction = data.readFloatBE(day.offset + 1)
  const perTick = data.readFloatBE(day.offset + 5)
  if (!Number.isFinite(fraction) || !Number.isFinite(perTick)) throw new Error('invalid time payload floats')
  // Vanilla encodes a frozen daylight cycle as a negative day time.
  const time = gameRule ? day.value : -(day.value === 0n ? 1n : day.value)
  return { age: game.value, time }
}

module.exports = { decodeNeoForgeTime }
