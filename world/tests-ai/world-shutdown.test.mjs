import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

// Execute the actual bootstrap shutdown function with injected adapters; importing
// the world entry point would start Minecraft and model-facing consumers.
const source = fs.readFileSync(new URL('../bootstrap-world.mts', import.meta.url), 'utf8')
const start = source.indexOf('let shutdownPromise:')
const end = source.indexOf("process.on('SIGINT', shutdown)", start)
assert.ok(start > 0 && end > start)
const shutdownCode = transformSync(source.slice(start, end), { loader: 'ts', format: 'esm' }).code

test('normal world shutdown awaits observer parking and viewer close before RCON/bot disposal', async () => {
  const events = []; let park
  const parked = new Promise(resolve => { park = resolve })
  const context = {
    eye: { dispose: async () => { events.push('eye-start'); await parked; events.push('eye-done') } },
    modernViewer: { dispose: async () => { events.push('viewer'); await Promise.resolve() } },
    mapTiles: { dispose: async () => events.push('map') },
    panelPublisher: { dispose: () => events.push('publisher') },
    handles: [{ dispose: async () => events.push('world') }, { dispose: () => events.push('rcon') }, { dispose: () => events.push('bot') }],
    snapshotTimer: 1, clearInterval: () => events.push('stop-snapshot'), console: { log() {}, error() {} },
    process: { exit: () => events.push('exit') },
  }
  const shutdown = vm.runInNewContext(shutdownCode + '\nshutdown', context)
  const pending = shutdown()
  assert.equal(shutdown(), pending)
  assert.deepEqual(events, ['stop-snapshot', 'eye-start'])
  park(); await pending
  assert.deepEqual(events, ['stop-snapshot', 'eye-start', 'eye-done', 'viewer', 'map', 'publisher', 'world', 'rcon', 'bot', 'exit'])
})

test('failed cleanup does not prevent later adapters closing and bootstrap parses without running', async () => {
  const events = []
  const shutdown = vm.runInNewContext(shutdownCode + '\nshutdown', {
    eye: { dispose: async () => { throw Error('failed parking') } },
    modernViewer: { dispose: () => events.push('viewer') }, mapTiles: { dispose: () => events.push('map') },
    panelPublisher: { dispose() {} }, handles: [{ dispose: () => events.push('rcon') }, { dispose: () => events.push('bot') }],
    snapshotTimer: 1, clearInterval() {}, console: { log() {}, error: () => events.push('error') }, process: { exit: () => events.push('exit') },
  })
  await shutdown()
  assert.deepEqual(events, ['error', 'viewer', 'map', 'rcon', 'bot', 'exit'])
  assert.doesNotThrow(() => transformSync(source, { loader: 'ts', format: 'esm', target: 'node22' }))
  assert.match(source, /token: fs\.readFileSync\('\/run\/secrets\/control-token', 'utf8'\)\.trim\(\)/)
})
