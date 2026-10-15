'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { remapChunk } = require('./native-chunk-remap.cjs')
const Chunk = require('prismarine-chunk')('1.21.1')
const BitArray = require('prismarine-chunk/src/pc/common/BitArrayNoSpan')
const { Vec3 } = require('vec3')
const vi = value => { const bytes = []; do { const part = value % 128; value = Math.floor(value / 128); bytes.push(part | (value ? 128 : 0)) } while (value); return Buffer.from(bytes) }
const biome = Buffer.from([0, 1, 0])
const emptySection = Buffer.from([0, 0, 0, 0, 0, ...biome])
function longs(bits, array) {
  const packed = BitArray.fromArray(array, bits).toLongArray()
  const out = Buffer.alloc(packed.length * 8)
  packed.forEach(([hi, lo], i) => { out.writeInt32BE(hi, i * 8); out.writeInt32BE(lo, i * 8 + 4) })
  return Buffer.concat([vi(packed.length), out])
}
function chunk(bits, array, palette = null) {
  const block = bits === 0 ? Buffer.concat([Buffer.from([0]), vi(array[0]), vi(0)])
    : Buffer.concat([Buffer.from([bits]), ...(palette ? [vi(palette.length), ...palette.map(vi)] : []), longs(bits, array)])
  return Buffer.concat([Buffer.from([16, 0]), block, biome, ...Array(23).fill(emptySection)])
}
function checkWorld(data, expected) {
  const world = new Chunk(); world.load(data)
  for (let i = 0; i < 4096; i++) assert.equal(world.getBlockStateId(new Vec3(i & 15, -64 + (i >> 8), (i >> 4) & 15)), expected[i])
}

test('native 19-bit global palette becomes readable vanilla indirect data; source and biomes unchanged', () => {
  const values = Array.from({ length: 4096 }, (_, i) => 300000 + i % 3)
  const input = chunk(19, values); const original = Buffer.from(input)
  const projected = remapChunk(input, id => id === 0 ? 0 : id - 299999, 15)
  assert.ok(input.length - projected.length > 4096)
  assert.equal(projected[2], 4)
  checkWorld(projected, values.map(id => id - 299999))
  assert.deepEqual(input, original)
  assert.deepEqual(projected.subarray(-23 * emptySection.length), Buffer.concat(Array(23).fill(emptySection)))
  assert.deepEqual(projected.subarray(-23 * emptySection.length - 3, -23 * emptySection.length), biome)
})

test('more than 256 native states are repacked at the vanilla global width', () => {
  const values = Array.from({ length: 4096 }, (_, i) => 300000 + i % 300)
  const projected = remapChunk(chunk(19, values), id => id === 0 ? 0 : id - 299999, 15)
  assert.equal(projected[2], 15)
  checkWorld(projected, values.map(id => id - 299999))
})

test('single and indirect palettes map every ID without changing property indices', () => {
  checkWorld(remapChunk(chunk(0, [777]), id => id === 777 ? 5 : 0, 15), Array(4096).fill(5))
  const indices = Array.from({ length: 4096 }, (_, i) => i % 2)
  checkWorld(remapChunk(chunk(4, indices, [777, 888]), id => ({ 0: 0, 777: 5, 888: 8 })[id], 15), indices.map(i => i ? 8 : 5))
})

test('truncation, invalid indices, oversized data and unknown mappings fail explicitly', () => {
  const input = chunk(19, Array(4096).fill(300000))
  assert.throws(() => remapChunk(input.subarray(0, -1), () => 1, 15), /TRUNCATED_NATIVE_CHUNK/)
  assert.throws(() => remapChunk(chunk(4, Array(4096).fill(2), [1, 2]), id => id, 15), /PALETTE_INDEX/)
  assert.throws(() => remapChunk(Buffer.alloc(8 * 1024 * 1024 + 1), id => id, 15), /CHUNK_SIZE/)
  assert.throws(() => remapChunk(input, () => undefined, 15), /INVALID_PROJECTED_BLOCK_STATE/)
  const bad = Buffer.from(emptySection); bad[4] = 1
  assert.throws(() => remapChunk(bad, id => id, 15), /LONG_COUNT/)
})

test('native waterlogged block-plus-fluid counts above 4096 are valid and preserved', () => {
  const input = chunk(0, [777]); input.writeInt16BE(4980, 0)
  const output = remapChunk(input, id => id === 777 ? 5 : 0, 15)
  assert.equal(output.readInt16BE(0), 4980)
  checkWorld(output, Array(4096).fill(5))
  for (const count of [-1, 8193]) {
    input.writeInt16BE(count, 0)
    assert.throws(() => remapChunk(input, id => id, 15), /INVALID_NATIVE_CHUNK_BLOCK_COUNT/)
  }
})
