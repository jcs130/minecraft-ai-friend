'use strict'

// Locked Ars Nouveau 1.21.1-5.13.2 bytecode:
// DataSerializers.SPELL_RESOLVER -> SpellResolver.STREAM -> SpellContext.STREAM
// writes only Spell.STREAM. It is not NBT and contains no caster identity.
// DataSerializers.VEC writes three big-endian doubles.
const MAX_GLYPHS = 256
const MAX_TIMELINES = 256
const MAX_BYTES = 1024 * 1024
const MAX_STRING_CHARS = 32767

function boundedCount (value, max, label) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw Error(`INVALID_ARS_${label}_COUNT`)
  return value
}
function intValue (value) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw Error('INVALID_ARS_INT')
  return value
}
function startOffset (start) {
  if (!Number.isSafeInteger(start) || start < 0) throw Error('INVALID_ARS_ENTITY_OFFSET')
}

function reader (buffer, start) {
  startOffset(start)
  let offset = start
  function available (length) {
    if (offset - start + length > MAX_BYTES) throw Error('ARS_ENTITY_DATA_TOO_LARGE')
    if (offset + length > buffer.length) throw Error('TRUNCATED_ARS_ENTITY_DATA')
  }
  function int () {
    available(4)
    const value = buffer.readInt32BE(offset)
    offset += 4
    return value
  }
  function floating (bytes) {
    available(bytes)
    const value = bytes === 4 ? buffer.readFloatBE(offset) : buffer.readDoubleBE(offset)
    offset += bytes
    if (!Number.isFinite(value)) throw Error('INVALID_ARS_FLOAT')
    return value
  }
  function string () {
    let length = 0
    for (let index = 0; ; index++) {
      if (index >= 5) throw Error('INVALID_ARS_STRING_LENGTH')
      available(1)
      const byte = buffer[offset++]
      if (index === 4 && byte > 7) throw Error('INVALID_ARS_STRING_LENGTH')
      length += (byte & 127) * 2 ** (7 * index)
      if (!(byte & 128)) {
        if (index > 0 && byte === 0) throw Error('INVALID_ARS_STRING_LENGTH')
        break
      }
    }
    if (length > MAX_STRING_CHARS * 3) throw Error('INVALID_ARS_STRING_LENGTH')
    available(length)
    const encoded = buffer.subarray(offset, offset + length)
    const value = encoded.toString('utf8')
    if (value.length > MAX_STRING_CHARS || !Buffer.from(value, 'utf8').equals(encoded)) throw Error('INVALID_ARS_UTF8')
    offset += length
    return value
  }
  return { int, float: () => floating(4), double: () => floating(8), string, size: () => offset - start }
}

function writer (buffer, start) {
  startOffset(start)
  let offset = start
  function advance (length) {
    const from = offset
    offset += length
    if (offset - start > MAX_BYTES) throw Error('ARS_ENTITY_DATA_TOO_LARGE')
    if (buffer && offset > buffer.length) throw Error('TRUNCATED_ARS_ENTITY_DATA')
    return from
  }
  function int (value) {
    intValue(value)
    const from = advance(4)
    if (buffer) buffer.writeInt32BE(value, from)
  }
  function floating (value, bytes) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (bytes === 4 && !Number.isFinite(Math.fround(value)))) throw Error('INVALID_ARS_FLOAT')
    const from = advance(bytes)
    if (buffer) {
      if (bytes === 4) buffer.writeFloatBE(value, from)
      else buffer.writeDoubleBE(value, from)
    }
  }
  function string (value) {
    if (typeof value !== 'string' || value.length > MAX_STRING_CHARS) throw Error('INVALID_ARS_STRING_LENGTH')
    const length = Buffer.byteLength(value, 'utf8')
    if (length > MAX_STRING_CHARS * 3 || Buffer.from(value, 'utf8').toString('utf8') !== value) throw Error('INVALID_ARS_UTF8')
    let remaining = length
    do {
      const from = advance(1)
      const byte = remaining & 127
      remaining = Math.floor(remaining / 128)
      if (buffer) buffer[from] = remaining ? byte | 128 : byte
    } while (remaining)
    const from = advance(length)
    if (buffer) buffer.write(value, from, length, 'utf8')
  }
  return { int, float: value => floating(value, 4), double: value => floating(value, 8), string, end: () => offset }
}

function timelineCount (value) {
  boundedCount(value, MAX_TIMELINES, 'TIMELINE')
  // Every nonempty timeline dispatches a registered IParticleTimelineType codec.
  // Never skip unknown bytes or resume at an assumed metadata boundary.
  if (value !== 0) throw Error('UNSUPPORTED_ARS_PARTICLE_TIMELINE')
}

function readResolver (buffer, start) {
  const r = reader(buffer, start)
  const spell = {
    name: r.string(),
    // ParticleColor.STREAM is common to constant, rainbow and registered colors.
    color: { id: r.string(), r: r.int(), g: r.int(), b: r.int() },
    sound: { id: r.string(), volume: r.float(), pitch: r.float() },
    glyphs: []
  }
  const glyphs = boundedCount(r.int(), MAX_GLYPHS, 'GLYPH')
  for (let index = 0; index < glyphs; index++) spell.glyphs.push(r.string())
  spell.timelineCount = r.int()
  timelineCount(spell.timelineCount)
  return { value: { spell }, size: r.size() }
}

function writeResolver (value, buffer, start) {
  const spell = value?.spell
  if (!spell || !spell.color || !spell.sound || !Array.isArray(spell.glyphs)) throw Error('INVALID_ARS_SPELL_RESOLVER')
  boundedCount(spell.glyphs.length, MAX_GLYPHS, 'GLYPH')
  timelineCount(spell.timelineCount)
  const w = writer(buffer, start)
  w.string(spell.name)
  w.string(spell.color.id)
  w.int(spell.color.r); w.int(spell.color.g); w.int(spell.color.b)
  w.string(spell.sound.id); w.float(spell.sound.volume); w.float(spell.sound.pitch)
  w.int(spell.glyphs.length)
  for (const glyph of spell.glyphs) w.string(glyph)
  w.int(0)
  return w.end()
}

function readVec3 (buffer, start) {
  const r = reader(buffer, start)
  return { value: { x: r.double(), y: r.double(), z: r.double() }, size: r.size() }
}
function writeVec3 (value, buffer, start) {
  if (!value || typeof value !== 'object') throw Error('INVALID_ARS_VEC3')
  const w = writer(buffer, start)
  w.double(value.x); w.double(value.y); w.double(value.z)
  return w.end()
}

const arsEntityNativeTypes = {
  Read: {
    mawArsSpellResolverCodec: ['native', readResolver],
    mawArsVec3Codec: ['native', readVec3]
  },
  Write: {
    mawArsSpellResolverCodec: ['native', writeResolver],
    mawArsVec3Codec: ['native', writeVec3]
  },
  SizeOf: {
    mawArsSpellResolverCodec: ['native', value => writeResolver(value, null, 0)],
    mawArsVec3Codec: ['native', value => writeVec3(value, null, 0)]
  }
}

module.exports = { arsEntityNativeTypes, MAX_GLYPHS, MAX_TIMELINES, MAX_BYTES }
