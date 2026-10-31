'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const P = require('../agent-access/registry-protocol.cjs')
const hash = '1'.repeat(64)
function fixture () {
  const bot = new EventEmitter(), writes = [], packets = { events: new EventEmitter(), health: () => ({ failed: false }), detach () {} }
  bot._client = new EventEmitter(); bot._client.state = 'configuration'; bot._client.write = (name, p) => writes.push({ name, ...p })
  bot.game = { minY: 0, height: 16 }; bot.blockAt = p => ({ name: 'stone', position: p }); const original = bot.blockAt
  bot.openContainer = block => block.name
  const m = { exports: {} }, source = fs.readFileSync(path.join(__dirname, '../agent-access/mineflayer-plugin.cjs'), 'utf8')
  const stubs = { './native-client.cjs': { attachTauNativeClient: () => ({ state: () => ({}), detach () {} }) },
    './native-stream.cjs': { attachNativeViewerPackets: () => packets },
    './native-world.cjs': require('../agent-access/native-world.cjs'), './registry-protocol.cjs': P,
    './native-chunk-remap.cjs': { visitChunk: (_b, fn) => fn(0, new Uint32Array(4096).fill(7)) } }
  vm.runInNewContext(source, { module: m, require: key => { if (!stubs[key]) throw Error('unreviewed dependency'); return stubs[key] },
    Buffer, TextDecoder, setTimeout, clearTimeout, Promise, Map, Set, Error }, { filename: 'mineflayer-plugin.cjs' })
  const api = m.exports.mineflayerPlugin(bot)
  const receive = body => bot._client.emit('custom_payload', { channel: P.CHANNEL, data: P.encode(body) })
  const manifest = () => receive({ schemaVersion: 1, protocol: 1, kind: 'manifest', sequence: 0, minecraftVersion: '1.21.1', registrySha256: hash,
    mode: 'stream_catalog', stateCount: 99, source: 'same_connection_received_states', complete: false })
  const row = { stateId: 7, blockId: 9, name: 'lootr:lootr_chest', properties: {}, canOcclude: true, collisionBoxes: [[0, 0, 0, 1, .875, 1]], destroySpeed: 2.5 }
  const page = (sequence = 1) => receive({ schemaVersion: 1, protocol: 1, kind: 'states', sequence, registrySha256: hash, rows: [row] })
  const chunk = () => packets.events.emit('packet', { name: 'map_chunk', params: { x: 0, z: 0, chunkData: Buffer.from([0]) } })
  return { bot, api, writes, manifest, page, chunk, original, receive, plugin: m.exports.mineflayerPlugin }
}
test('standard plugin receives native definitions without any local files or extra body', async () => {
  const f = fixture(); assert.equal(f.writes.length, 1); assert.equal(P.decode(f.writes[0].data).mode, 'stream_catalog')
  f.manifest(); assert.equal(await f.api.ready, f.api); f.page(); f.bot.entity = {}; f.bot.emit('spawn'); f.chunk()
  assert.equal(f.bot.blockAt({ x: 0, y: 0, z: 0 }).name, 'lootr:lootr_chest')
  assert.equal(f.api.health().definitions, 1); f.bot._client.emit('state'); assert.equal(f.writes.length, 1)
  f.api.detach(); assert.equal(f.bot.blockAt, f.original); assert.equal(f.bot.nativeAdventure, undefined)
})
test('registry gaps or duplicate pages make observations unknown, never carrier stone', async () => {
  const f = fixture(); f.manifest(); await f.api.ready; f.page(); f.bot.entity = {}; f.bot.emit('spawn'); f.chunk()
  f.page(3); assert.match(f.api.health().failure, /PAGE_INVALID/); assert.equal(f.bot.blockAt({ x: 0, y: 0, z: 0 }), null)
  f.api.detach(); assert.equal(f.bot.blockAt, f.original)
})
test('definitions cannot exceed the count announced by this connection', async () => {
  const f = fixture()
  f.receive({ schemaVersion: 1, protocol: 1, kind: 'manifest', sequence: 0, minecraftVersion: '1.21.1', registrySha256: hash,
    mode: 'stream_catalog', stateCount: 1, source: 'same_connection_received_states', complete: false })
  await f.api.ready; f.page()
  f.receive({ schemaVersion: 1, protocol: 1, kind: 'states', sequence: 2, registrySha256: hash,
    rows: [{ stateId: 8, blockId: 8, name: 'test:stone', collisionBoxes: [], properties: {}, canOcclude: false, destroySpeed: 1 }] })
  assert.match(f.api.health().failure, /PAGE_INVALID/); f.api.detach()
})
test('another plugin reader is preserved on detach', async () => {
  const f = fixture(); f.manifest(); await f.api.ready; f.bot.entity = {}; f.bot.emit('spawn')
  const other = () => 'other'; f.bot.blockAt = other; f.api.detach(); assert.equal(f.bot.blockAt, other)
})
test('an invalid initial manifest cannot silently leave carrier terrain as native truth', () => {
  const f = fixture()
  f.receive({ schemaVersion: 1, protocol: 1, kind: 'manifest', registrySha256: 'bad' })
  assert.match(f.api.health().failure, /MANIFEST_INVALID/); assert.equal(f.bot.blockAt({ x: 0, y: 0, z: 0 }), null)
  f.api.detach(); assert.equal(f.bot.blockAt, f.original)
})
test('no duplicate body adapter and no late attach', async () => {
  const f = fixture(); assert.throws(() => f.plugin(f.bot), /ONE_NATIVE/)
  f.api.detach(); f.bot.entity = {}; assert.throws(() => f.plugin(f.bot), /BEFORE_SPAWN/)
})
