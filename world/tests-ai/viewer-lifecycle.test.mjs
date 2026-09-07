import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import { createRequire } from 'node:module'
import { createViewerLifecycle, startModernViewer, viewerOrigin, viewerRequestAllowed } from '../src/mc-modern-viewer.mts'

const origin = 'http://127.0.0.1:19092'
const require = createRequire(import.meta.url)
const bot = () => ({ entity: {}, version: '1.21.1', _client: { state: 'play' } })

test('viewer accepts only exact configured host and origin, including socket handshakes', () => {
  assert.equal(viewerOrigin(origin), origin)
  assert.equal(viewerRequestAllowed({ host: '127.0.0.1:19092' }, origin), true)
  assert.equal(viewerRequestAllowed({ host: '127.0.0.1:19092', origin }, origin, true), true)
  assert.equal(viewerRequestAllowed({ host: '127.0.0.1:19092', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }, origin, true), true)
  for (const headers of [{ host: 'evil.test:19092', origin: 'http://evil.test:19092' },
    { host: '127.0.0.1:19092', origin: 'http://evil.test:19092' },
    { host: '127.0.0.1:19092, evil.test:19092', origin },
    { host: '127.0.0.1:3070', origin }]) assert.equal(viewerRequestAllowed(headers, origin), false)
  assert.equal(viewerRequestAllowed({ host: '127.0.0.1:19092' }, origin, true), false)
  for (const bad of ['file:///private', 'http://user:secret@localhost', origin + '/path', origin + '?secret=x', origin + '/#fragment']) {
    assert.throws(() => viewerOrigin(bad))
  }
})

test('viewer replaces a disconnected bot only after the prior listener closes', async () => {
  const first = bot(), second = bot(); let current = first
  const events = []; let closeFirst
  const closed = new Promise(resolve => { closeFirst = resolve })
  const lifecycle = createViewerLifecycle(() => current, async target => {
    events.push(target === first ? 'open-first' : 'open-second')
    return { health: () => ({ ok: true }), close: async () => {
      events.push(target === first ? 'closing-first' : 'closing-second')
      if (target === first) await closed
      events.push(target === first ? 'closed-first' : 'closed-second')
    } }
  })
  await lifecycle.sync()
  assert.equal(lifecycle.getHealth().ok, true)
  current = second
  const pending = lifecycle.sync()
  await Promise.resolve(); lifecycle.sync()
  assert.deepEqual(events, ['open-first', 'closing-first'])
  assert.equal(lifecycle.getHealth().ok, false)
  closeFirst(); await pending
  assert.deepEqual(events, ['open-first', 'closing-first', 'closed-first', 'open-second'])
  await lifecycle.close()
  await lifecycle.sync()
  assert.equal(events.filter(value => value === 'open-second').length, 1)
})

test('disposed during listener creation closes that listener and never opens another', async () => {
  let release; const pending = new Promise(resolve => { release = resolve }); let closes = 0, opens = 0
  const current = bot()
  const lifecycle = createViewerLifecycle(() => current, async () => {
    opens++; await pending
    return { close: async () => { closes++ }, health: () => ({ ok: true }) }
  })
  const opening = lifecycle.sync()
  await Promise.resolve()
  const closing = lifecycle.close()
  release(); await opening; await closing
  assert.equal(opens, 1); assert.equal(closes, 1)
  assert.equal(lifecycle.getHealth().ok, false)
})

test('offline/erroring bot access and failed starts cannot report a healthy viewer', async () => {
  let current = null, count = 0
  const lifecycle = createViewerLifecycle(() => { if (!current) throw Error('offline'); return current }, async () => {
    count++; throw Error('PRIVATE_SENTINEL')
  })
  await lifecycle.sync()
  assert.equal(count, 0); assert.equal(lifecycle.getHealth().ok, false)
  current = bot(); await lifecycle.sync()
  assert.equal(count, 1); assert.equal(lifecycle.getHealth().error, 'viewer_start_failed')
  current._client.socket = { destroyed: true }; await lifecycle.sync()
  assert.equal(count, 1); assert.equal(lifecycle.getHealth().observerOnline, false)
  assert.equal(JSON.stringify(lifecycle.getHealth()).includes('PRIVATE_SENTINEL'), false)
  await lifecycle.close()
})

test('actual local viewer health is host-restricted and its listener closes cleanly', async t => {
  const saved = process.env.MC_MODERN_VIEWER
  process.env.MC_MODERN_VIEWER = '1'
  t.after(() => { if (saved === undefined) delete process.env.MC_MODERN_VIEWER; else process.env.MC_MODERN_VIEWER = saved })
  const current = Object.assign(new EventEmitter(), bot(), { username: 'Goddess', game: { dimension: 'minecraft:overworld' }, world: {} })
  const lifecycle = startModernViewer(() => current, { port: 0, blockStateMapping: { ready: true, normalize: value => value, health: { ready: true } } })
  t.after(() => lifecycle.close())
  await lifecycle.sync()
  assert.equal(lifecycle.getHealth().ok, true)
  const port = lifecycle.getHealth().runtime.port
  async function read(host) {
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/healthz', headers: { Host: host } }, res => {
        let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, body }))
      }); req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('timeout')))
    })
  }
  const response = await read('127.0.0.1:19092')
  assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).observerOnline, true)
  assert.equal(JSON.parse(response.body).viewDistanceChunks, 3)
  assert.equal(JSON.parse(response.body).maxSessions, 2)
  assert.equal((await read('untrusted.test:19092')).status, 403)
  await lifecycle.close()
  assert.equal(current.listenerCount('respawn'), 0)
  assert.equal(current.listenerCount('game'), 0)
  await assert.rejects(read('127.0.0.1:19092'))
})

test('actual Socket.IO sends mapped bounded chunks once and coalesces duplicate entity updates', async t => {
  const saved = process.env.MC_MODERN_VIEWER; process.env.MC_MODERN_VIEWER = '1'
  t.after(() => { if (saved === undefined) delete process.env.MC_MODERN_VIEWER; else process.env.MC_MODERN_VIEWER = saved })
  const Vec3 = require('vec3').Vec3, { io } = require('socket.io-client')
  const entity = { id: 2, name: 'villager', type: 'passive', position: new Vec3(1, 65, 1), metadata: {} }
  const column = { minY: -64, worldHeight: 384, toJson: () => JSON.stringify({ minY: -64, worldHeight: 384,
    sections: [JSON.stringify({ data: JSON.stringify({ type: 'single', value: 1838 }) })] }) }
  const current = Object.assign(new EventEmitter(), bot(), { username: 'Goddess',
    entity: { id: 1, position: new Vec3(0, 65, 0), equipment: [] }, game: { dimension: 'minecraft:overworld' },
    entities: { 2: entity }, inventory: Object.assign(new EventEmitter(), { slots: [] }), world: { getColumn: () => column } })
  const lifecycle = startModernViewer(() => current, { port: 0, blockStateMapping: { ready: true, normalize: id => id === 1838 ? 1688 : id, health: { ready: true } } })
  t.after(() => lifecycle.close()); await lifecycle.sync()
  const port = lifecycle.getHealth().runtime.port, messages = []
  const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false, extraHeaders: { Host: '127.0.0.1:19092', Origin: origin } })
  t.after(() => socket.disconnect()); socket.onAny((event, value) => messages.push({ event, value }))
  const until = async predicate => { const end = Date.now() + 4000; while (!predicate()) { if (Date.now() > end) throw Error('Fixture stream timeout'); await new Promise(resolve => setTimeout(resolve, 20)) } }
  await until(() => messages.filter(row => row.event === 'loadChunk').length === 25 && messages.some(row => row.event === 'entity' && row.value.id === 2))
  const chunks = messages.filter(row => row.event === 'loadChunk')
  assert.deepEqual(chunks[0].value.worldConfig, { minY: -64, worldHeight: 384 })
  assert.equal(JSON.parse(JSON.parse(JSON.parse(chunks[0].value.chunk).sections[0]).data).value, 1688)
  for (let i = 0; i < 500; i++) { entity.position.x = 2; current.emit('entityMoved', entity); current.emit('entityUpdate', entity) }
  await until(() => messages.some(row => row.event === 'entityMoved' && row.value.id === 2))
  const entityMessages = messages.filter(row => ['entity', 'entityMoved'].includes(row.event) && row.value.id === 2)
  assert.equal(entityMessages.length, 2); assert.equal(entityMessages[1].value.metadata, undefined)
  assert.ok(lifecycle.getHealth().runtime.streams[0].entities.coalesced >= 499)
  const legacy = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/legacy/', headers: { Host: '127.0.0.1:19092' } }, res => {
    let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ code: res.statusCode, body }))
  }).on('error', reject))
  assert.equal(legacy.code, 200); assert.match(legacy.body, /尚未启用/)
  socket.disconnect(); await lifecycle.close()
  for (const event of ['entityMoved', 'entityUpdate', 'entityGone', 'chunkColumnLoad', 'chunkColumnUnload', 'blockUpdate']) assert.equal(current.listenerCount(event), 0)
})
