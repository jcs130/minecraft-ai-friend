import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { serveMapTiles } from '../admin/map-service.mts'

function body() {
  return Object.assign(new EventEmitter(), { entity: {}, world: {}, game: { dimension: 'minecraft:overworld' }, _client: { state: 'play' } })
}
async function start(t, options = {}) {
  let current = body()
  const service = serveMapTiles(() => current, undefined, { host: '127.0.0.1', port: 0, ...options })
  await service.ready; t.after(() => service.dispose())
  const base = `http://127.0.0.1:${service.server.address().port}`
  return { service, bot: current, replace: next => { current = next },
    read: (query = 'cx=0&cz=0&r=8') => fetch(base + '/map.png?' + query), base }
}

test('concurrent map requests all receive busy503 rather than overwriting a waiting response', async t => {
  let release, entered
  const pending = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const f = await start(t, { render: async () => { entered(); await pending; return Buffer.from('tile') } })
  const first = f.read(); await started
  const responses = await Promise.all([f.read('cx=1&cz=0'), f.read('cx=2&cz=0'), f.read('cx=3&cz=0')])
  for (const response of responses) { assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '1') }
  release(); const result = await first
  assert.equal(result.status, 200); assert.equal(await result.text(), 'tile')
})

test('tile cache is private to current dimension, bot generation and respawn', async t => {
  let renders = 0
  const f = await start(t, { render: async bot => Buffer.from(`${++renders}:${bot.game.dimension}`) })
  assert.equal(await (await f.read()).text(), '1:minecraft:overworld')
  assert.equal(await (await f.read()).text(), '1:minecraft:overworld')
  f.bot.game.dimension = 'minecraft:the_nether'; f.bot.emit('game')
  const nether = await f.read()
  assert.equal(await nether.text(), '2:minecraft:the_nether')
  assert.equal(nether.headers.get('cache-control'), 'no-store')
  assert.equal(nether.headers.get('x-qiandeng-dimension'), 'minecraft:the_nether')
  f.bot.emit('respawn')
  assert.equal(await (await f.read()).text(), '3:minecraft:the_nether')
  f.replace(body())
  assert.equal(await (await f.read()).text(), '4:minecraft:overworld')
})

test('world changing during rendering rejects its result and does not cache a mixed tile', async t => {
  let release, entered, renders = 0
  const started = new Promise(resolve => { entered = resolve })
  const pending = new Promise(resolve => { release = resolve })
  const f = await start(t, { render: async () => { if (++renders === 1) { entered(); await pending }; return Buffer.from('new tile') } })
  const first = f.read(); await started
  f.bot.game.dimension = 'minecraft:the_nether'; f.bot.emit('game'); release()
  assert.equal((await first).status, 503)
  assert.equal((await f.read()).status, 200)
  assert.equal(renders, 2)
})

test('render timeout is an explicit response and cannot permit overlapping scans', async t => {
  let release, calls = 0
  const pending = new Promise(resolve => { release = resolve })
  const f = await start(t, { renderTimeoutMs: 20, render: async () => { calls++; await pending; return Buffer.from('late') } })
  const response = await f.read()
  assert.equal(response.status, 503); assert.match(await response.text(), /timeout/)
  assert.equal((await f.read()).status, 503)
  assert.equal(calls, 1)
  release(); await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal((await f.read()).status, 200)
  assert.equal(calls, 2)
})

test('map coordinates are finite, radius is integral and original bounds are preserved', async t => {
  const radii = []
  const f = await start(t, { render: async (_bot, _x, _z, radius) => { radii.push(radius); return Buffer.from('tile') } })
  for (const query of ['cz=0', 'cx=0', 'cx=NaN&cz=0', 'cx=Infinity&cz=0', 'cx=30000001&cz=0']) {
    assert.equal((await f.read(query)).status, 400)
  }
  for (const radius of ['8.9', '-10', '10000']) assert.equal((await f.read(`cx=${radius}&cz=0&r=${radius}`)).status, 200)
  assert.deepEqual(radii, [8, 8, 128])
  f.bot._client.socket = { destroyed: true }
  assert.equal((await f.read()).status, 503)
})

test('renderer errors release the busy slot, expose no private error, and dispose removes listeners', async t => {
  let failed = false
  const f = await start(t, { render: async () => { if (!failed) { failed = true; throw Error('PRIVATE_SENTINEL') }; return Buffer.from('tile') } })
  const response = await f.read()
  assert.equal(response.status, 500); assert.equal((await response.text()).includes('PRIVATE_SENTINEL'), false)
  assert.equal((await f.read()).status, 200)
  await f.service.dispose()
  assert.equal(f.bot.listenerCount('game'), 0); assert.equal(f.bot.listenerCount('respawn'), 0)
})
