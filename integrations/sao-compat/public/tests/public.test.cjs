'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), http = require('node:http'), crypto = require('node:crypto'), zlib = require('node:zlib')
const { once } = require('node:events')
const { createFront } = require('../native-front.cjs'), { prepareConnection } = require('../sdk.cjs')
const { remapChunk, visitChunk } = require('../native-chunk-remap.cjs')
const { bedrockName, projection, dimensionSections } = require('../compat-gate.cjs')
const { createPrivateAuthenticator } = require('../private-login.cjs')
const sha = data => crypto.createHash('sha256').update(data).digest('hex')
function temporary (t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sao-public-')); t.after(() => fs.rmSync(p, { recursive: true, force: true })); return p }
async function listening (server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
function exchange (port, data) { return new Promise((resolve, reject) => { const socket = net.connect(port, '127.0.0.1', () => socket.write(data)); socket.on('error', reject); socket.once('data', value => { socket.destroy(); resolve(value) }) }) }
test('private login refuses another body and changed broker before dispatch', async t => {
  const root = temporary(t), broker = path.join(root, 'broker.py'); fs.writeFileSync(broker, '#fixture')
  const authenticate = createPrivateAuthenticator({ python: process.execPath, broker, brokerSha256: sha(fs.readFileSync(broker)), root, username: 'ag_Kirito' })
  let sent = false
  await assert.rejects(authenticate({ username: 'Other', chat () { sent = true } }), /identity_or_code_changed/)
  fs.appendFileSync(broker, '\nchanged')
  await assert.rejects(authenticate({ username: 'ag_Kirito', chat () { sent = true } }), /identity_or_code_changed/)
  assert.equal(sent, false)
})
test('private broker failure stays sanitized and never sends an empty login', async t => {
  const root = temporary(t), broker = path.join(root, 'broker.py'); fs.writeFileSync(broker, '#fixture')
  const authenticate = createPrivateAuthenticator({ python: process.execPath, broker, brokerSha256: sha(fs.readFileSync(broker)), root, username: 'ag_Kirito' })
  let sent = false
  await assert.rejects(authenticate({ username: 'ag_Kirito', chat () { sent = true } }), /private_game_credential_unavailable_no_auto_retry/)
  assert.equal(sent, false)
})
test('native front passes actual binary bytes and serves only exact public routes', async t => {
  const root = temporary(t), raw = Buffer.from('public types')
  fs.writeFileSync(path.join(root, 'types.gz'), raw); fs.writeFileSync(path.join(root, 'assets.json'), JSON.stringify({ files: { '/types.gz': { path: 'types.gz', bytes: raw.length, sha256: sha(raw) } } }))
  const backend = net.createServer(socket => socket.pipe(socket)), backendPort = await listening(backend)
  const front = createFront({ host: '127.0.0.1', port: 0, backendPort, assetsRoot: root }); await front.listen()
  t.after(async () => { await front.close(); await new Promise(resolve => backend.close(resolve)) })
  const port = front.listener.address().port, binary = Buffer.from([9, 0, 0, 4, 1, 255, 222])
  assert.deepEqual(await exchange(port, binary), binary)
  const response = await fetch('http://127.0.0.1:' + port + '/types.gz'); assert.equal(response.status, 200); assert.equal(response.headers.get('x-content-sha256'), sha(raw)); assert.deepEqual(Buffer.from(await response.arrayBuffer()), raw)
  const head = await fetch('http://127.0.0.1:' + port + '/types.gz', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0)
  for (const uri of ['/server.properties', '/types.gz?private=1', '/native-manifest.json', '/%2e%2e/passwords']) assert.equal((await fetch('http://127.0.0.1:' + port + uri)).status, 404)
})
test('SDK verifies real compressed bytes and detects a changed cached file', async t => {
  const cache = temporary(t), epoch = '12345678-1234-1234-1234-123456789abc', files = {}, bodies = {}
  for (const name of ['states.jsonl', 'items.jsonl', 'entities.jsonl']) { const raw = Buffer.from('{"fixture":"'+name+'"}\n'), packed = zlib.gzipSync(raw), uri = '/native/' + epoch + '/' + name + '.gz'; files[name] = { path: uri, bytes: raw.length, sha256: sha(raw), compressedSha256: sha(packed) }; bodies[uri] = packed }
  const manifest = { schemaVersion: 1, minecraft: '1.20.1', serverEpoch: epoch, metadata: { minecraft: '1.20.1', serverEpoch: epoch }, files }
  const server = http.createServer((req, res) => { const bytes = req.url === '/native-manifest.json' ? Buffer.from(JSON.stringify(manifest)) : bodies[req.url]; if (!bytes) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'Content-Length': bytes.length }); res.end(bytes) })
  const port = await listening(server); t.after(() => new Promise(resolve => server.close(resolve)))
  const options = { host: '127.0.0.1', port, cacheDirectory: cache }, root = await prepareConnection(options)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'registry-bundle.json'))).serverEpoch, epoch)
  assert.equal(await prepareConnection(options), root)
  fs.appendFileSync(path.join(root, 'registry', epoch, 'items.jsonl'), 'tampered')
  await assert.rejects(prepareConnection(options), /cached_native_registry_hash_mismatch/)
  files['states.jsonl'].path = '/other-origin'
  await assert.rejects(prepareConnection(options), /invalid_native_registry_file/)
})
test('SDK rejects ambiguous network inputs before opening a connection', async () => {
  for (const options of [{ host: 'user@host', port: 28977, cacheDirectory: '.' }, { host: 'localhost', port: '28977', cacheDirectory: '.' }, { host: 'localhost', port: 28977 }]) await assert.rejects(prepareConnection(options), /explicit_host_port/)
})
test('chunk conversion uses declared dimension sections and never invents missing data', () => {
  const one = Buffer.from([0, 1, 0, 5, 0, 0, 1, 0]), source = Buffer.concat([one, one, Buffer.alloc(30)])
  const actual = remapChunk(source, id => id + 1, 15, { sectionCount: 2 })
  const values = []; assert.equal(visitChunk(actual, (_section, rows) => values.push(rows[0])), 2); assert.deepEqual(values, [6, 6])
  assert.throws(() => remapChunk(Buffer.concat([one, Buffer.from([1])]), x => x, 15, { sectionCount: 1 }), /UNEXPECTED_NATIVE_CHUNK_TRAILER/)
  assert.throws(() => remapChunk(one, x => x, 15, { sectionCount: 2 }), /MISSING_DIMENSION_SECTIONS/)
  assert.throws(() => remapChunk(one.subarray(0, 6), x => x, 15, { sectionCount: 1 }), /TRUNCATED_NATIVE_CHUNK/)
  assert.throws(() => remapChunk(one, () => -1, 15), /INVALID_PROJECTED_BLOCK_STATE/)
})
test('Bedrock names reserve a separate identity namespace', () => {
  assert.equal(bedrockName('ag_Kirito'), 'b_ag_Kirito'); assert.equal(bedrockName('SAOBedProbe'), 'b_SAOBedProbe')
  assert.match(bedrockName('长名字 12345678901234567890'), /^bh[a-f0-9]{14}$/)
  assert.throws(() => bedrockName('a\nb'), /invalid_bedrock_name/)
})
test('native projection preserves real item NBT and remaps registry tag IDs', t => {
  const root = temporary(t), epoch = 'fixture', base = path.join(root, 'server/maw-sao/registry'); fs.mkdirSync(path.join(base, epoch), { recursive: true }); fs.writeFileSync(path.join(base, 'current.json'), JSON.stringify({ serverEpoch: epoch }))
  const rows = { items: [{ id: 30001, name: 'test:sandwich', food: { nutrition: 8 } }], states: [{ id: 40001, blockId: 5001, name: 'test:altar', shapeAvailable: true, collisionShapes: [[0, 0, 0, 1, 1, 1]], properties: {} }], entities: [{ id: 1001, name: 'test:enemy', category: 'monster' }] }
  for (const [name, values] of Object.entries(rows)) fs.writeFileSync(path.join(base, epoch, name + '.jsonl'), values.map(x => JSON.stringify(x)).join('\n'))
  const projected = projection(root), original = { present: true, itemId: 30001, itemCount: 3, nbtData: { type: 'compound', name: '', value: { Damage: { type: 'int', value: 7 } } } }, item = projected.slot(original)
  assert.notEqual(item.itemId, original.itemId); assert.equal(item.itemCount, 3); assert.equal(item.nbtData.value.Damage.value, 7); assert.equal(item.nbtData.value.maw_native_item.value, 'test:sandwich'); assert.equal(original.nbtData.value.maw_native_item, undefined)
  const tags = projected.tags({ tags: [{ tagType: 'minecraft:item', tags: [{ tagName: 'test:tag', entries: [30001, 30001, 99999] }] }] })
  assert.deepEqual(tags.tags[0].tags[0].entries, [item.itemId])
})
