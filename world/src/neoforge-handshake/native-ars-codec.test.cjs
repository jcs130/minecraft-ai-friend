'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { ProtoDefCompiler } = require('protodef').Compiler
const { arsNativeTypes, MAX_SLOTS, MAX_GLYPHS } = require('./native-ars-codec.cjs')

const read = arsNativeTypes.Read.mawArsSpellCasterCodec[1]
const write = arsNativeTypes.Write.mawArsSpellCasterCodec[1]
const sizeOf = arsNativeTypes.SizeOf.mawArsSpellCasterCodec[1]

// Independent encoder uses the javap-proven layout; it does not call this codec.
function wireFixture (book) {
  const parts = []
  const offsets = { slotCount: null, glyphCounts: [], timelineCounts: [] }
  let length = 0
  const add = bytes => { parts.push(bytes); length += bytes.length }
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
  int(book.currentSlot); utf(book.flavorText); add(Buffer.from([book.isHidden ? 1 : 0])); utf(book.hiddenText); int(book.maxSlots)
  offsets.slotCount = length; int(book.spells.length)
  for (const { slot, spell } of book.spells) {
    int(slot); utf(spell.name); utf(spell.color.id); int(spell.color.r); int(spell.color.g); int(spell.color.b)
    utf(spell.sound.id); float(spell.sound.volume); float(spell.sound.pitch)
    offsets.glyphCounts.push(length); int(spell.glyphs.length)
    spell.glyphs.forEach(utf)
    offsets.timelineCounts.push(length); int(spell.timelineCount)
  }
  return { buffer: Buffer.concat(parts), offsets }
}
function configuredBook (maxSlots = 10, populated = 1, rainbow = false) {
  return {
    currentSlot: populated ? populated - 1 : 0,
    flavorText: '真实法术书 📖', isHidden: false, hiddenText: '', maxSlots,
    spells: Array.from({ length: populated }, (_, slot) => ({ slot, spell: {
      name: slot ? `Book Spell ${slot}` : 'Smoke Heal',
      color: { id: rainbow ? 'ars_nouveau:rainbow' : 'ars_nouveau:constant', r: 255 - slot, g: 25, b: 180 },
      sound: { id: 'ars_nouveau:default', volume: 1, pitch: 0.75 },
      glyphs: ['ars_nouveau:glyph_self', 'ars_nouveau:glyph_heal'], timelineCount: 0
    } }))
  }
}

test('independent Self + Heal bytes decode, retain all fields and re-encode byte for byte', () => {
  const expected = configuredBook()
  const { buffer } = wireFixture(expected)
  const parsed = read(buffer, 0)
  assert.equal(parsed.size, buffer.length)
  assert.deepEqual(parsed.value, expected)
  assert.equal(sizeOf(parsed.value), buffer.length)
  const roundtrip = Buffer.alloc(buffer.length)
  assert.equal(write(parsed.value, roundtrip, 0), buffer.length)
  assert.deepEqual(roundtrip, buffer)
})

test('empty, full configured books, sparse slots and rainbow use the common ID and RGB stream', () => {
  const books = [configuredBook(10, 0), configuredBook(10, 10), configuredBook(20, 20, true), configuredBook(30, 30)]
  const sparse = configuredBook(100, 2, true)
  sparse.currentSlot = 99
  sparse.isHidden = true
  sparse.hiddenText = '隐藏配方'
  sparse.spells[1].slot = 99
  sparse.spells[1].spell.glyphs.push('ars_nouveau:glyph_amplify')
  books.push(sparse)
  for (const expected of books) {
    const { buffer } = wireFixture(expected)
    const parsed = read(buffer, 0)
    assert.deepEqual(parsed.value, expected)
    const encoded = Buffer.alloc(sizeOf(parsed.value))
    write(parsed.value, encoded, 0)
    assert.deepEqual(encoded, buffer)
  }
})

test('compiler registration reads/writes nested caster data and leaves neighbouring bytes untouched', () => {
  const compiler = new ProtoDefCompiler()
  compiler.addTypes(arsNativeTypes)
  compiler.addTypesToCompile({
    MawArsSpellCaster: 'mawArsSpellCasterCodec',
    paired: ['container', [{ name: 'first', type: 'MawArsSpellCaster' }, { name: 'second', type: 'MawArsSpellCaster' }]]
  })
  const compiled = compiler.compileProtoDefSync()
  const expected = { first: configuredBook(10, 1), second: configuredBook(10, 0) }
  const wire = Buffer.concat([wireFixture(expected.first).buffer, wireFixture(expected.second).buffer])
  const parsed = compiled.parsePacketBuffer('paired', wire)
  assert.equal(parsed.metadata.size, wire.length)
  assert.deepEqual(parsed.data, expected)
  assert.deepEqual(compiled.createPacketBuffer('paired', parsed.data), wire)
})

test('negative and excessive slot/glyph counts fail before allocating arrays', () => {
  const { buffer, offsets } = wireFixture(configuredBook())
  for (const value of [-1, MAX_SLOTS + 1, 2147483647]) {
    const invalid = Buffer.from(buffer)
    invalid.writeInt32BE(value, offsets.slotCount)
    assert.throws(() => read(invalid, 0), /INVALID_ARS_SLOT_COUNT/)
  }
  for (const value of [-1, MAX_GLYPHS + 1, 2147483647]) {
    const invalid = Buffer.from(buffer)
    invalid.writeInt32BE(value, offsets.glyphCounts[0])
    assert.throws(() => read(invalid, 0), /INVALID_ARS_GLYPH_COUNT/)
  }
  assert.throws(() => sizeOf(configuredBook(MAX_SLOTS + 1, MAX_SLOTS + 1)), /INVALID_ARS_SLOT_COUNT/)
  const excess = configuredBook()
  excess.spells[0].spell.glyphs = new Array(MAX_GLYPHS + 1).fill('ars_nouveau:glyph_self')
  assert.throws(() => sizeOf(excess), /INVALID_ARS_GLYPH_COUNT/)
})

test('nonempty and malformed timelines explicitly fail at the count in read, write and size', () => {
  const { buffer, offsets } = wireFixture(configuredBook())
  for (const count of [-1, 1, 2147483647]) {
    const invalid = Buffer.from(buffer)
    invalid.writeInt32BE(count, offsets.timelineCounts[0])
    assert.throws(() => read(invalid, 0), /UNSUPPORTED_ARS_PARTICLE_TIMELINE/)
    const value = configuredBook()
    value.spells[0].spell.timelineCount = count
    assert.throws(() => sizeOf(value), /UNSUPPORTED_ARS_PARTICLE_TIMELINE/)
    assert.throws(() => write(value, Buffer.alloc(1000), 0), /UNSUPPORTED_ARS_PARTICLE_TIMELINE/)
  }
})

test('truncated stream, malformed UTF8, unbounded strings and invalid scalar values fail explicitly', () => {
  const { buffer } = wireFixture(configuredBook())
  for (const length of [0, 4, 10, buffer.length - 1]) assert.throws(() => read(buffer.subarray(0, length), 0), /TRUNCATED_ARS_COMPONENT/)
  const invalid = Buffer.from(buffer)
  invalid[5] = 0xff // flavor text begins after currentSlot + byte length.
  assert.throws(() => read(invalid, 0), /INVALID_ARS_UTF8/)
  const huge = Buffer.concat([Buffer.alloc(4), Buffer.from([0xff, 0xff, 0xff, 0xff, 7])])
  assert.throws(() => read(huge, 0), /INVALID_ARS_STRING_LENGTH/)
  const value = configuredBook()
  value.flavorText = 'x'.repeat(32768)
  assert.throws(() => sizeOf(value), /INVALID_ARS_STRING_LENGTH/)
  value.flavorText = '\ud800'
  assert.throws(() => sizeOf(value), /INVALID_ARS_UTF8/)
  value.flavorText = ''
  value.currentSlot = 1.2
  assert.throws(() => sizeOf(value), /INVALID_ARS_INT/)
  value.currentSlot = 0
  value.spells[0].spell.sound.volume = NaN
  assert.throws(() => sizeOf(value), /INVALID_ARS_FLOAT/)
})

test('aggregate component limit rejects many individually bounded glyph strings', () => {
  const value = configuredBook()
  value.spells[0].spell.glyphs = new Array(MAX_GLYPHS).fill('x'.repeat(6000))
  const { buffer } = wireFixture(value)
  assert.throws(() => read(buffer, 0), /ARS_COMPONENT_TOO_LARGE/)
  assert.throws(() => sizeOf(value), /ARS_COMPONENT_TOO_LARGE/)
})
