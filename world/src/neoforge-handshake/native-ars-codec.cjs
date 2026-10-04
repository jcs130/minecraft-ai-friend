'use strict'

// Ars Nouveau 1.21.1-5.13.2: DataComponentRegistry.SPELL_CASTER uses
// SpellCaster.STREAM_CODEC -> AbstractCaster.createStream, not an NBT codec.
// Counts in SpellSlotMap/AbstractSpellPart/TimelineMap are fixed BE INTs.
const MAX_SLOTS = 256
const MAX_GLYPHS = 256
const MAX_BYTES = 1024 * 1024
const MAX_STRING_CHARS = 32767

function count (value, max, label) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw Error(`INVALID_ARS_${label}_COUNT`)
  return value
}
function integer (value) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw Error('INVALID_ARS_INT')
  return value
}

function readCaster (buffer, start) {
  let offset = start
  function available (length) {
    if (!Number.isInteger(length) || length < 0 || offset - start + length > MAX_BYTES) throw Error('ARS_COMPONENT_TOO_LARGE')
    if (offset < 0 || offset + length > buffer.length) throw Error('TRUNCATED_ARS_COMPONENT')
  }
  function int () {
    available(4)
    const value = buffer.readInt32BE(offset)
    offset += 4
    return value
  }
  function bool () {
    available(1)
    const value = buffer[offset++]
    if (value !== 0 && value !== 1) throw Error('INVALID_ARS_BOOL')
    return value === 1
  }
  function float () {
    available(4)
    const value = buffer.readFloatBE(offset)
    offset += 4
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
    // Do not silently replace malformed UTF-8 and then emit different bytes.
    if (value.length > MAX_STRING_CHARS || !Buffer.from(value, 'utf8').equals(encoded)) throw Error('INVALID_ARS_UTF8')
    offset += length
    return value
  }
  const value = { currentSlot: int(), flavorText: string(), isHidden: bool(), hiddenText: string(), maxSlots: int(), spells: [] }
  const slots = count(int(), MAX_SLOTS, 'SLOT')
  for (let index = 0; index < slots; index++) {
    const slot = int()
    const spell = {
      name: string(),
      // The shared ParticleColor.STREAM always writes ID then three INTs.
      // Rainbow and registered subclasses do not add fields to this stream.
      color: { id: string(), r: int(), g: int(), b: int() },
      sound: { id: string(), volume: float(), pitch: float() },
      glyphs: []
    }
    const glyphs = count(int(), MAX_GLYPHS, 'GLYPH')
    for (let glyph = 0; glyph < glyphs; glyph++) spell.glyphs.push(string())
    spell.timelineCount = int()
    // Nonempty timelines dynamically dispatch to type-specific stream codecs.
    // Reject at the count, before consuming the following item/metadata bytes.
    if (spell.timelineCount !== 0) throw Error('UNSUPPORTED_ARS_PARTICLE_TIMELINE')
    value.spells.push({ slot, spell })
  }
  return { value, size: offset - start }
}

function encodeCaster (value, buffer, start) {
  let offset = start
  function advance (length) {
    const from = offset
    offset += length
    if (offset - start > MAX_BYTES) throw Error('ARS_COMPONENT_TOO_LARGE')
    if (buffer && (from < 0 || offset > buffer.length)) throw Error('TRUNCATED_ARS_COMPONENT')
    return from
  }
  function int (value) {
    integer(value)
    const from = advance(4)
    if (buffer) buffer.writeInt32BE(value, from)
  }
  function bool (value) {
    if (typeof value !== 'boolean') throw Error('INVALID_ARS_BOOL')
    const from = advance(1)
    if (buffer) buffer[from] = value ? 1 : 0
  }
  function float (value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw Error('INVALID_ARS_FLOAT')
    const from = advance(4)
    if (buffer) buffer.writeFloatBE(value, from)
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
  if (!value || typeof value !== 'object' || !Array.isArray(value.spells)) throw Error('INVALID_ARS_CASTER')
  count(value.spells.length, MAX_SLOTS, 'SLOT')
  int(value.currentSlot)
  string(value.flavorText)
  bool(value.isHidden)
  string(value.hiddenText)
  int(value.maxSlots)
  int(value.spells.length)
  for (const entry of value.spells) {
    const spell = entry?.spell
    if (!spell || !spell.color || !spell.sound || !Array.isArray(spell.glyphs)) throw Error('INVALID_ARS_SPELL')
    count(spell.glyphs.length, MAX_GLYPHS, 'GLYPH')
    if (spell.timelineCount !== 0) throw Error('UNSUPPORTED_ARS_PARTICLE_TIMELINE')
    int(entry.slot)
    string(spell.name)
    string(spell.color.id)
    int(spell.color.r)
    int(spell.color.g)
    int(spell.color.b)
    string(spell.sound.id)
    float(spell.sound.volume)
    float(spell.sound.pitch)
    int(spell.glyphs.length)
    for (const glyph of spell.glyphs) string(glyph)
    int(0)
  }
  return offset
}

const arsNativeTypes = {
  Read: { mawArsSpellCasterCodec: ['native', readCaster] },
  Write: { mawArsSpellCasterCodec: ['native', (value, buffer, offset) => encodeCaster(value, buffer, offset)] },
  SizeOf: { mawArsSpellCasterCodec: ['native', value => encodeCaster(value, null, 0)] }
}

module.exports = { arsNativeTypes, MAX_SLOTS, MAX_GLYPHS, MAX_BYTES }
