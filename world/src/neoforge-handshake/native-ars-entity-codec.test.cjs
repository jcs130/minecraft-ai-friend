'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { ProtoDefCompiler } = require('protodef').Compiler
const { arsEntityNativeTypes, MAX_GLYPHS, MAX_TIMELINES } = require('./native-ars-entity-codec.cjs')
const { arsNativeTypes } = require('./native-ars-codec.cjs')

const read = arsEntityNativeTypes.Read.mawArsSpellResolverCodec[1]
const write = arsEntityNativeTypes.Write.mawArsSpellResolverCodec[1]
const sizeOf = arsEntityNativeTypes.SizeOf.mawArsSpellResolverCodec[1]
const readVec3 = arsEntityNativeTypes.Read.mawArsVec3Codec[1]
const writeVec3 = arsEntityNativeTypes.Write.mawArsVec3Codec[1]

// Fixture follows the audited Java STREAM, independently of the native codec.
function wireSpell (spell) {
  const chunks = []
  let length = 0
  const add = bytes => { chunks.push(bytes); length += bytes.length }
  const int = value => { const bytes = Buffer.alloc(4); bytes.writeInt32BE(value); add(bytes) }
  const float = value => { const bytes = Buffer.alloc(4); bytes.writeFloatBE(value); add(bytes) }
  const utf = value => {
    const bytes = Buffer.from(value)
    let remaining = bytes.length
    do {
      const byte = remaining & 127
      remaining = Math.floor(remaining / 128)
      add(Buffer.from([remaining ? byte | 128 : byte]))
    } while (remaining)
    add(bytes)
  }
  utf(spell.name); utf(spell.color.id); int(spell.color.r); int(spell.color.g); int(spell.color.b)
  utf(spell.sound.id); float(spell.sound.volume); float(spell.sound.pitch)
  const glyphCount = length
  int(spell.glyphs.length); spell.glyphs.forEach(utf)
  const timelineCount = length
  int(spell.timelineCount)
  return { bytes: Buffer.concat(chunks), glyphCount, timelineCount }
}
function attackSpell (method = 'projectile', color = 'constant') {
  return {
    name: `QA ${method} Harm 📘`,
    color: { id: `ars_nouveau:${color}`, r: 255, g: 25, b: 180 },
    sound: { id: 'ars_nouveau:default', volume: 0.75, pitch: 1.25 },
    glyphs: [`ars_nouveau:glyph_${method}`, 'ars_nouveau:glyph_harm'],
    timelineCount: 0
  }
}
function verifyRoundtrip (spell) {
  const { bytes } = wireSpell(spell)
  const parsed = read(bytes, 0)
  assert.equal(parsed.size, bytes.length)
  assert.deepEqual(parsed.value, { spell })
  assert.equal(sizeOf(parsed.value), bytes.length)
  const encoded = Buffer.alloc(bytes.length)
  assert.equal(write(parsed.value, encoded, 0), bytes.length)
  assert.deepEqual(encoded, bytes)
}

test('resolver wire contains only the configured Spell, with exact touch/projectile Harm bytes', () => {
  verifyRoundtrip(attackSpell('touch'))
  verifyRoundtrip(attackSpell('projectile'))
  verifyRoundtrip(attackSpell('projectile', 'rainbow'))
  const empty = attackSpell()
  empty.name = ''; empty.glyphs = []
  verifyRoundtrip(empty)
})

test('resolver and held spell book encode the same complete Spell fields', () => {
  const spell = attackSpell()
  const book = { currentSlot: 0, flavorText: '', isHidden: false, hiddenText: '', maxSlots: 10, spells: [{ slot: 0, spell }] }
  const encodeBook = arsNativeTypes.Write.mawArsSpellCasterCodec[1]
  const bookSize = arsNativeTypes.SizeOf.mawArsSpellCasterCodec[1](book)
  const encoded = Buffer.alloc(bookSize)
  encodeBook(book, encoded, 0)
  // Caster fixed fields + two empty UTF8 strings + hidden flag + map count + slot.
  assert.deepEqual(encoded.subarray(19), wireSpell(spell).bytes)
})

test('compiler embeds resolver between neighbouring metadata without overconsuming bytes', () => {
  const compiler = new ProtoDefCompiler()
  compiler.addTypes(arsEntityNativeTypes)
  compiler.addTypesToCompile({
    MawArsSpellResolver: 'mawArsSpellResolverCodec',
    MawArsVec3: 'mawArsVec3Codec',
    metadataFixture: ['container', [
      { name: 'before', type: 'u8' }, { name: 'resolver', type: 'MawArsSpellResolver' },
      { name: 'vec', type: 'MawArsVec3' }, { name: 'after', type: 'u8' }
    ]]
  })
  const compiled = compiler.compileProtoDefSync()
  const vecBytes = Buffer.alloc(24)
  vecBytes.writeDoubleBE(0.125, 0); vecBytes.writeDoubleBE(-64.5, 8); vecBytes.writeDoubleBE(123456.75, 16)
  const bytes = Buffer.concat([Buffer.from([0x33]), wireSpell(attackSpell()).bytes, vecBytes, Buffer.from([0xff])])
  const parsed = compiled.parsePacketBuffer('metadataFixture', bytes)
  assert.equal(parsed.metadata.size, bytes.length)
  assert.deepEqual(parsed.data, { before: 0x33, resolver: { spell: attackSpell() }, vec: { x: 0.125, y: -64.5, z: 123456.75 }, after: 0xff })
  assert.deepEqual(compiled.createPacketBuffer('metadataFixture', parsed.data), bytes)
})

test('fixed INT glyph counts are bounded before list iteration or allocation', () => {
  const { bytes, glyphCount } = wireSpell(attackSpell())
  for (const count of [-1, MAX_GLYPHS + 1, 2147483647]) {
    const invalid = Buffer.from(bytes)
    invalid.writeInt32BE(count, glyphCount)
    assert.throws(() => read(invalid, 0), /INVALID_ARS_GLYPH_COUNT/)
  }
  const spell = attackSpell()
  spell.glyphs = new Array(MAX_GLYPHS + 1).fill('ars_nouveau:glyph_harm')
  assert.throws(() => sizeOf({ spell }), /INVALID_ARS_GLYPH_COUNT/)
  spell.glyphs = new Array(MAX_GLYPHS).fill('ars_nouveau:glyph_harm')
  verifyRoundtrip(spell)
})

test('timeline counts reject negative/huge counts and nonempty dynamic timelines without skipping bytes', () => {
  const { bytes, timelineCount } = wireSpell(attackSpell())
  for (const count of [-1, 1, MAX_TIMELINES + 1, 2147483647]) {
    const invalid = Buffer.concat([bytes, Buffer.from([0xa5, 0xa5])])
    invalid.writeInt32BE(count, timelineCount)
    const message = count === 1 ? /UNSUPPORTED_ARS_PARTICLE_TIMELINE/ : /INVALID_ARS_TIMELINE_COUNT/
    assert.throws(() => read(invalid, 0), message)
    const value = { spell: { ...attackSpell(), timelineCount: count } }
    assert.throws(() => sizeOf(value), message)
    assert.throws(() => write(value, Buffer.alloc(1024), 0), message)
  }
})

test('truncation, bad offsets, malformed UTF8, huge strings and total byte budget fail explicitly', () => {
  const { bytes } = wireSpell(attackSpell())
  for (const length of [0, 1, 7, bytes.length - 1]) assert.throws(() => read(bytes.subarray(0, length), 0), /TRUNCATED_ARS_ENTITY_DATA/)
  for (const offset of [-1, 0.5, NaN]) assert.throws(() => read(bytes, offset), /INVALID_ARS_ENTITY_OFFSET/)
  assert.throws(() => write({ spell: attackSpell() }, Buffer.alloc(1), 0), /TRUNCATED_ARS_ENTITY_DATA/)
  const malformed = Buffer.from(bytes); malformed[1] = 0xff
  assert.throws(() => read(malformed, 0), /INVALID_ARS_UTF8/)
  assert.throws(() => read(Buffer.from([0xff, 0xff, 0xff, 0xff, 7]), 0), /INVALID_ARS_STRING_LENGTH/)
  assert.throws(() => read(Buffer.from([0x80, 0]), 0), /INVALID_ARS_STRING_LENGTH/)
  const huge = attackSpell(); huge.name = 'x'.repeat(32768)
  assert.throws(() => sizeOf({ spell: huge }), /INVALID_ARS_STRING_LENGTH/)
  huge.name = 'ok'; huge.glyphs = new Array(MAX_GLYPHS).fill('x'.repeat(32767))
  assert.throws(() => sizeOf({ spell: huge }), /ARS_ENTITY_DATA_TOO_LARGE/)
})

test('Vec3 is exactly three big-endian doubles, preserving signs and neighbouring bytes', () => {
  const vec = { x: -0, y: -1.125, z: Number.MAX_VALUE }
  const bytes = Buffer.alloc(26, 0xa5)
  assert.equal(writeVec3(vec, bytes, 1), 25)
  assert.equal(bytes[0], 0xa5); assert.equal(bytes[25], 0xa5)
  const parsed = readVec3(bytes, 1)
  assert.equal(parsed.size, 24)
  assert.deepEqual(parsed.value, vec)
  assert.equal(arsEntityNativeTypes.SizeOf.mawArsVec3Codec[1](vec), 24)
  assert.throws(() => readVec3(bytes.subarray(0, 24), 1), /TRUNCATED_ARS_ENTITY_DATA/)
  const invalid = Buffer.alloc(24); invalid.writeDoubleBE(Infinity, 8)
  assert.throws(() => readVec3(invalid, 0), /INVALID_ARS_FLOAT/)
  assert.throws(() => writeVec3({ ...vec, z: NaN }, Buffer.alloc(24), 0), /INVALID_ARS_FLOAT/)
})
