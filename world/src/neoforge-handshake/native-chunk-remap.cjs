'use strict'

// Java 1.21.1 section containers use non-spanning packed longs. A modded
// registry can require >16 bits per block, which vanilla prismarine-chunk
// cannot read. Decode that wire width before projecting, rather than passing
// unparsed native IDs into a vanilla client's world. Biome data stays native:
// its dynamic registry is forwarded during configuration.
const MAX_BYTES = 8 * 1024 * 1024
function vi (value) {
  const bytes = []
  do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; bytes.push(byte) } while (value)
  return Buffer.from(bytes)
}
function remapChunk (buffer, mapState, globalBits) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BYTES || !buffer.length) throw Error('INVALID_NATIVE_CHUNK_SIZE')
  if (!Number.isInteger(globalBits) || globalBits < 9 || globalBits > 32) throw Error('INVALID_VANILLA_GLOBAL_BITS')
  let offset = 0
  const need = size => { if (offset + size > buffer.length) throw Error('TRUNCATED_NATIVE_CHUNK') }
  const byte = () => { need(1); return buffer[offset++] }
  const readVi = () => {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const b = byte()
      if (i === 4 && (b & 248)) throw Error('INVALID_NATIVE_CHUNK_VARINT')
      value += (b & 127) * 2 ** (7 * i)
      if (!(b & 128)) return value
    }
    throw Error('INVALID_NATIVE_CHUNK_VARINT')
  }
  function readContainer (entries, maxIndirect) {
    const start = offset; const bits = byte()
    if (bits > 32 || (bits > 0 && bits < (entries === 4096 ? 4 : 1))) throw Error('INVALID_NATIVE_CHUNK_BITS')
    let palette = null
    if (bits === 0) palette = [readVi()]
    else if (bits <= maxIndirect) {
      const length = readVi()
      if (length < 1 || length > 2 ** bits) throw Error('INVALID_NATIVE_CHUNK_PALETTE')
      palette = Array.from({ length }, readVi)
    }
    const longs = readVi()
    const perLong = bits ? Math.floor(64 / bits) : 0
    const expected = bits ? Math.ceil(entries / perLong) : 0
    if (longs !== expected) throw Error('INVALID_NATIVE_CHUNK_LONG_COUNT')
    need(longs * 8)
    const data = buffer.subarray(offset, offset + longs * 8); offset += longs * 8
    return { start, end: offset, bits, palette, data, perLong }
  }
  const mapped = id => {
    const value = mapState(id)
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** globalBits) throw Error('INVALID_PROJECTED_BLOCK_STATE')
    return value
  }
  function values (container, entries) {
    const result = new Uint32Array(entries)
    const mask = (1n << BigInt(container.bits)) - 1n
    let index = 0
    for (let word = 0; word < container.data.length; word += 8) {
      let packed = container.data.readBigUInt64BE(word)
      for (let i = 0; i < container.perLong && index < entries; i++, index++) {
        result[index] = Number(packed & mask); packed >>= BigInt(container.bits)
        if (container.palette && result[index] >= container.palette.length) throw Error('INVALID_NATIVE_CHUNK_PALETTE_INDEX')
      }
    }
    return result
  }
  function pack (array, bits) {
    const perLong = Math.floor(64 / bits)
    const data = Buffer.alloc(Math.ceil(array.length / perLong) * 8)
    for (let i = 0, word = 0; i < array.length; word += 8) {
      let packed = 0n
      for (let slot = 0; slot < perLong && i < array.length; slot++, i++) packed |= BigInt(array[i]) << BigInt(slot * bits)
      data.writeBigUInt64BE(packed, word)
    }
    return Buffer.concat([vi(data.length / 8), data])
  }
  function projectBlocks (c) {
    if (c.bits === 0) return Buffer.concat([Buffer.from([0]), vi(mapped(c.palette[0])), vi(0)])
    const rawValues = values(c, 4096)
    if (c.palette) {
      // Keeping indirect indices avoids repacking the common case and retains
      // exact properties even when several mod display proxies coincide.
      return Buffer.concat([Buffer.from([c.bits]), vi(c.palette.length), ...c.palette.map(id => vi(mapped(id))), vi(c.data.length / 8), c.data])
    }
    const cache = new Map(); const unique = []; const byMapped = new Map(); const indices = new Uint32Array(4096)
    for (let i = 0; i < rawValues.length; i++) {
      const original = rawValues[i]
      if (!cache.has(original)) cache.set(original, mapped(original))
      const id = cache.get(original)
      rawValues[i] = id
      let index = byMapped.get(id)
      if (index === undefined) { index = unique.length; unique.push(id); byMapped.set(id, index) }
      indices[i] = index
    }
    if (unique.length === 1) return Buffer.concat([Buffer.from([0]), vi(unique[0]), vi(0)])
    if (unique.length <= 256) {
      const bits = Math.max(4, Math.ceil(Math.log2(unique.length)))
      return Buffer.concat([Buffer.from([bits]), vi(unique.length), ...unique.map(vi), pack(indices, bits)])
    }
    return Buffer.concat([Buffer.from([globalBits]), pack(rawValues, globalBits)])
  }
  const parts = []
  let sections = 0
  while (offset < buffer.length) {
    if (++sections > 64) throw Error('TOO_MANY_NATIVE_CHUNK_SECTIONS')
    need(2)
    const count = buffer.readInt16BE(offset)
    // The pinned server's LevelChunkSection.BlockCounter increments this for
    // both a nonempty block and its nonempty fluid. Waterlogged sections can
    // legitimately exceed 4096 (observed 4980); preserve the native count.
    if (count < 0 || count > 8192) throw Error('INVALID_NATIVE_CHUNK_BLOCK_COUNT')
    parts.push(buffer.subarray(offset, offset + 2)); offset += 2
    parts.push(projectBlocks(readContainer(4096, 8)))
    const biome = readContainer(64, 3)
    if (biome.bits && biome.palette) values(biome, 64)
    parts.push(buffer.subarray(biome.start, biome.end))
  }
  return Buffer.concat(parts)
}
module.exports = { remapChunk }
