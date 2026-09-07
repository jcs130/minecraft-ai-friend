import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import net from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const world = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deps = process.env.QD_TEST_NODE_MODULES || join(world, 'node_modules')
const { build } = createRequire(join(deps, '.qa.cjs'))('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'qiandeng-rcon-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))
await build({ entryPoints: [join(world, 'src', 'rcon.ts'), join(world, 'src', 'mc-rcon.ts')],
  outdir: temp, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { Rcon, RconNotSentError } = await import(pathToFileURL(join(temp, 'rcon.mjs')).href)
const { createRcon } = await import(pathToFileURL(join(temp, 'mc-rcon.mjs')).href)
const passwordPath = join(temp, 'fictional-secret.txt')
writeFileSync(passwordPath, 'offline-fixture-password')

function packet(id, type, text = '') {
  const payload = Buffer.from(text), frame = Buffer.alloc(14 + payload.length)
  frame.writeInt32LE(frame.length - 4); frame.writeInt32LE(id, 4); frame.writeInt32LE(type, 8)
  payload.copy(frame, 12); return frame
}

async function serverFixture(t, command, auth = true) {
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
        const len = buffer.readInt32LE(0), id = buffer.readInt32LE(4), type = buffer.readInt32LE(8)
        const text = buffer.subarray(12, len + 2).toString('utf8'); buffer = buffer.subarray(len + 4)
        if (type === 3 && auth) {
          // AUTH_RESPONSE may be preceded by RESPONSE_VALUE; only the matching auth type settles it.
          socket.write(Buffer.concat([packet(id, 0), packet(id, 2)]))
        } else if (type === 2) command(socket, id, text)
      }
    })
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((done) => server.close(done)) })
  const port = server.address().port
  return { port, create: () => createRcon({ enabled: true, host: '127.0.0.1', port, passwordPath }) }
}

test('parallel world callers share one command in flight and receive their own replies', async (t) => {
  let inFlight = 0, maximum = 0
  const server = await serverFixture(t, (socket, id, text) => {
    maximum = Math.max(maximum, ++inFlight)
    setTimeout(() => { --inFlight; socket.write(packet(id, 0, `reply:${text}`)) }, 15)
  })
  const handle = server.create(); t.after(() => handle.dispose())
  assert.deepEqual(await Promise.all(['one', 'two', 'three'].map((s) => handle.service.send(s))),
    ['reply:one', 'reply:two', 'reply:three'])
  assert.equal(maximum, 1)
})

test('close after the server received a mutation never replays it; next queued request reconnects', async (t) => {
  const seen = []
  const server = await serverFixture(t, (socket, id, text) => {
    seen.push(text)
    if (text === 'give-fixture') socket.destroy()
    else socket.write(packet(id, 0, 'query-ok'))
  })
  const handle = server.create(); t.after(() => handle.dispose())
  const first = handle.service.send('give-fixture')
  const next = handle.service.send('read-fixture')
  await assert.rejects(first, /closed|reset/i)
  assert.equal(await next, 'query-ok')
  assert.deepEqual(seen, ['give-fixture', 'read-fixture'])
})

test('a silent auth peer times out, and a closed client proves no command was sent', async (t) => {
  const server = await serverFixture(t, () => assert.fail('No command expected'), false)
  const client = new Rcon('127.0.0.1', server.port, 'fictional')
  t.after(() => client.close())
  await assert.rejects(client.connect(40), /timeout/)
  await assert.rejects(client.send('never-written'), RconNotSentError)
})

test('oversized UTF-8 commands are rejected before any server command is received', async (t) => {
  let received = 0
  const server = await serverFixture(t, () => { received++ })
  const client = new Rcon('127.0.0.1', server.port, 'fictional', 1446); t.after(() => client.close())
  await client.connect()
  await assert.rejects(client.send('汉'.repeat(483)), /1446 UTF-8 bytes/)
  assert.equal(received, 0)
})

test('an explicit patched-server limit transmits a long Unicode command intact but refuses the next byte', async (t) => {
  const seen = []
  const server = await serverFixture(t, (socket, id, text) => {
    seen.push(text); socket.write(packet(id, 0, 'long-ok'))
  })
  const limit = 65522
  const client = new Rcon('127.0.0.1', server.port, 'fictional', limit); t.after(() => client.close())
  await client.connect()
  const command = '汉'.repeat(21840) + 'ab'
  assert.equal(Buffer.byteLength(command), limit)
  assert.equal(await client.send(command), 'long-ok')
  await assert.rejects(client.send(command + 'x'), /65522 UTF-8 bytes/)
  assert.deepEqual(seen, [command])
})
