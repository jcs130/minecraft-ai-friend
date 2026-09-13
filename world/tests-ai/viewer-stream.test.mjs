import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createViewerChunkStream, createViewerEntityStream } from '../src/viewer-stream.mts'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture() {
  const sent = [], columns = new Map(), reads = []
  const bot = Object.assign(new EventEmitter(), { entity: { id: 1, position: { x: 0, y: 65, z: 0 } }, world: {
    getColumn(x, z) { reads.push([x, z]);const key = `${x},${z}`;if (!columns.has(key)) columns.set(key, { minY: -64, worldHeight: 384, toJson: () => JSON.stringify({ sections: [], minY: -64, worldHeight: 384 }) });return columns.get(key) }
  } })
  const socket = { connected: true, conn: { transport: { writable: true }, writeBuffer: [] }, emit: (event, value) => sent.push({ event, value }) }
  const stream = createViewerChunkStream({ bot, socket, emit: socket.emit })
  return { bot, socket, stream, sent, reads }
}
test('initial stream reads only a bounded set of loaded columns, nearest first, and provides real bounds', async () => {
  const f = fixture(); await f.stream.init(f.bot.entity.position)
  assert.equal(f.sent.length, 25); assert.deepEqual(f.reads[0], [0, 0])
  assert.deepEqual(f.sent[0].value.worldConfig, { minY: -64, worldHeight: 384 })
  assert.equal(f.stream.stats().maxVisibleColumns, 25)
  assert.equal(new Set(f.sent.map(row => `${row.value.x},${row.value.z}`)).size, 25)
  for (let i = 0; i < 500; i++) f.bot.emit('chunkColumnLoad', { x: 0, z: 0 })
  await f.stream.updatePosition(f.bot.entity.position)
  assert.equal(f.sent.length, 25); assert.ok(f.stream.stats().coalescedChunks > 0)
  f.stream.close(); for (const event of ['chunkColumnLoad', 'chunkColumnUnload', 'blockUpdate']) assert.equal(f.bot.listenerCount(event), 0)
})
test('position changes cancel queued old columns and never ask for the old distant area', async () => {
  const f = fixture(); const start = f.stream.init(f.bot.entity.position)
  await f.stream.updatePosition({ x: 1600, y: 65, z: 1600 }); await start
  assert.equal(f.sent.length, 25)
  assert.ok(f.sent.every(row => Math.abs(row.value.x / 16 - 100) < 3 && Math.abs(row.value.z / 16 - 100) < 3))
  f.stream.close()
})
test('blocked transports keep an unsent column queue bounded and close cancels the pending work', async () => {
  const f = fixture(); f.socket.conn.transport.writable = false
  const work = f.stream.init(f.bot.entity.position); await delay(5)
  assert.equal(f.sent.length, 0); assert.equal(f.stream.stats().pendingColumns, 25)
  f.stream.close(); await work; assert.equal(f.sent.length, 0)
})
test('chunk unload and coalesced block updates preserve air state zero and only change loaded columns', async () => {
  const f = fixture(); await f.stream.init(f.bot.entity.position); f.sent.length = 0
  for (let state = 1; state < 30; state++) f.bot.emit('blockUpdate', { position: { x: 1, y: 65, z: 1 } }, { position: { x: 1, y: 65, z: 1 }, stateId: state })
  f.bot.emit('blockUpdate', null, { position: { x: 1, y: 65, z: 1 }, stateId: 0 })
  await f.stream.updatePosition(f.bot.entity.position)
  assert.deepEqual(f.sent, [{ event: 'blockUpdate', value: { pos: { x: 1, y: 65, z: 1 }, stateId: 0 } }])
  f.bot.emit('chunkColumnUnload', { x: 0, z: 0 }); assert.equal(f.sent.at(-1).event, 'unloadChunk'); f.stream.close()
})
test('invalid column bounds close the stream and expose only a bounded error', async () => {
  const f = fixture();f.bot.world.getColumn = () => ({ minY: -64, worldHeight: NaN, toJson: () => '{}' })
  await f.stream.init(f.bot.entity.position)
  assert.equal(f.sent.length, 0); assert.equal(f.stream.stats().error, 'viewer_chunk_stream_failed')
  assert.equal(f.bot.listenerCount('blockUpdate'), 0)
})
test('entity storms coalesce into one full spawn and compact movement; unchanged properties and far entities are omitted', () => {
  const f = fixture(), entity = { id: 2, type: 'player', name: 'player', position: { x: 1, y: 65, z: 1 }, metadata: { stable: 'large' } }
  const stream = createViewerEntityStream({ bot: f.bot, socket: f.socket, serialize: e => ({ id: e.id, name: e.name, position: { ...e.position }, metadata: e.metadata }) })
  for (let i = 0; i < 500; i++) stream.queue(entity, true)
  stream.flush(); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].event, 'entity')
  for (let i = 0; i < 500; i++) { entity.position.x = 2; stream.queue(entity, true) }
  stream.flush(); assert.equal(f.sent.length, 2); assert.equal(f.sent[1].event, 'entityMoved'); assert.equal(f.sent[1].value.metadata, undefined)
  stream.queue(entity); stream.flush(); assert.equal(f.sent.length, 2)
  entity.position.x = 1000; stream.queue(entity); assert.equal(f.sent.at(-1).value.delete, true)
  assert.ok(stream.stats().coalesced >= 998); stream.close(); f.stream.close()
})
test('entity output waits for transport capacity and visible entities have a hard cap', () => {
  const f = fixture(), stream = createViewerEntityStream({ bot: f.bot, socket: f.socket, maxEntities: 2, serialize: e => ({ id: e.id, name: 'player' }) })
  f.socket.conn.transport.writable = false
  for (let i = 0; i < 5; i++) stream.queue({ id: 10 + i, type: 'player', position: { x: i, y: 65, z: 1 } }, true)
  stream.flush(); assert.equal(f.sent.length, 0)
  f.socket.conn.transport.writable = true; stream.flush(); assert.equal(f.sent.length, 2); assert.equal(stream.stats().visibleEntities, 2)
  stream.close(); f.stream.close()
})
