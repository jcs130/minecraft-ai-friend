const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const { attachNativeWorld, readStateCatalog } = require('../agent-access/native-world.cjs')
function fixture () {
  const bot = new EventEmitter(), events = new EventEmitter()
  bot.game = { minY: -64, height: 384 }
  bot.blockAt = p => ({ position: { ...p }, name: 'stone', stateId: 1 })
  const original = bot.blockAt
  const cube = [[0, 0, 0, 1, 1, 1]]
  const catalog = new Map([
    [0, { stateId: 0, blockId: 0, name: 'minecraft:air', collisionBoxes: [], canOcclude: false, properties: {} }],
    [1, { stateId: 1, blockId: 1, name: 'minecraft:glass', collisionBoxes: cube, canOcclude: false, properties: {} }],
    [2, { stateId: 2, blockId: 2, name: 'lootr:lootr_chest', collisionBoxes: [[.0625, 0, .0625, .9375, .875, .9375]], canOcclude: true, properties: { facing: 'north', waterlogged: 'false', age: '0' } }],
    [3, { stateId: 3, blockId: 3, name: 'twilightforest:unknown_dynamic_shape', collisionBoxes: null, properties: {} }]
  ])
  const visitChunk = (ignored, fn) => { for (let i = 0; i < 24; i++) fn(i, new Uint32Array(4096).fill(2)) }
  const world = attachNativeWorld(bot, { events }, { catalog, visitChunk, maxChunks: 1 })
  const send = (name, params) => events.emit('packet', { name, params })
  return { bot, world, original, send }
}
test('unknown chunks stay unknown; chunk identity is native and bounded', () => {
  const { bot, world, send } = fixture()
  assert.equal(world.read({ x: 1, y: 20, z: 2 }), null)
  send('map_chunk', { x: 0, z: 0, chunkData: Buffer.from([0]) }); world.bindBlockReads()
  const b = bot.blockAt({ x: 1, y: 20, z: 2 })
  assert.equal(b.name, 'lootr:lootr_chest'); assert.equal(b.compatibilityCarrier.name, 'stone')
  assert.equal(b.shapes[0][4], .875); assert.equal(b.getProperties().facing, 'north')
  assert.equal(b.getProperties().waterlogged, false); assert.equal(b.getProperties().age, '0')
  assert.equal(b.nativeObservation.properties.waterlogged, 'false')
  assert.equal(world.read({ x: 1, y: -65, z: 2 }), null)
  send('map_chunk', { x: 1, z: 0, chunkData: Buffer.from([0]) })
  assert.equal(bot.blockAt({ x: 1, y: 20, z: 2 }), null)
  assert.equal(world.health().chunks, 1)
})
test('glass can be visually transparent and physically impassable', () => {
  const { bot, world, send } = fixture(); send('map_chunk', { x: 0, z: 0, chunkData: Buffer.from([0]) }); world.bindBlockReads()
  send('block_change', { location: { x: 1, y: 20, z: 2 }, type: 1 })
  const b = bot.blockAt({ x: 1, y: 20, z: 2 })
  assert.equal(b.name, 'glass'); assert.equal(b.transparent, true)
  assert.equal(b.boundingBox, 'block'); assert.deepEqual(b.shapes, [[0, 0, 0, 1, 1, 1]])
})
test('unknown dynamic geometry never inherits projected stone collision', () => {
  const { bot, world, send } = fixture(); send('map_chunk', { x: 0, z: 0, chunkData: Buffer.from([0]) }); world.bindBlockReads()
  send('block_change', { location: { x: 1, y: 20, z: 2 }, type: 3 })
  assert.equal(world.read({ x: 1, y: 20, z: 2 }).name, 'twilightforest:unknown_dynamic_shape')
  assert.equal(bot.blockAt({ x: 1, y: 20, z: 2 }), null)
})
test('section updates preserve negative absolute coordinates and local packing', () => {
  const { world, send } = fixture(); send('map_chunk', { x: -1, z: -1, chunkData: Buffer.from([0]) })
  send('multi_block_change', { chunkCoordinates: { x: -1, y: -1, z: -1 }, records: [4096 + (15 << 8) + (14 << 4) + 13] })
  const b = world.read({ x: -1, y: -3, z: -2 }); assert.equal(b.name, 'minecraft:glass')
  assert.deepEqual(b.position, { x: -1, y: -3, z: -2 })
})
test('respawn and sequence failure invalidate old observations', () => {
  const { bot, world, send } = fixture(); send('map_chunk', { x: 0, z: 0, chunkData: Buffer.from([0]) }); world.bindBlockReads()
  send('respawn', {}); assert.equal(world.health().chunks, 0)
  send('map_chunk', { x: 0, z: 0, chunkData: Buffer.from([0]) })
  send('multi_block_change', { chunkCoordinates: {}, records: [] }); assert.equal(world.health().failed, true)
  assert.equal(bot.blockAt({ x: 0, y: 0, z: 0 }), null)
})
test('detach restores only its own binding', () => {
  const f = fixture(); f.world.bindBlockReads(); f.world.detach(); assert.equal(f.bot.blockAt, f.original)
  const g = fixture(); g.world.bindBlockReads(); const other = () => null; g.bot.blockAt = other; g.world.detach(); assert.equal(g.bot.blockAt, other)
})
test('catalog digest and collision validation reject stale or false geometry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-native-world-')), file = path.join(dir, 'states.jsonl')
  try {
    const write = x => { const bytes = Buffer.from(JSON.stringify(x) + '\n'); fs.writeFileSync(file, bytes); return crypto.createHash('sha256').update(bytes).digest('hex') }
    const hash = write({ stateId: 0, name: 'minecraft:glass', collisionBoxes: [[0, 0, 0, 1, 1, 1]] })
    assert.equal(readStateCatalog(file, hash).get(0).name, 'minecraft:glass')
    assert.throws(() => readStateCatalog(file, '0'.repeat(64)), /HASH_MISMATCH/)
    const bad = write({ stateId: 0, name: 'minecraft:glass', collisionBoxes: [[2, 0, 0, 1, 1, 1]] })
    assert.throws(() => readStateCatalog(file, bad), /COLLISION_INVALID/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
