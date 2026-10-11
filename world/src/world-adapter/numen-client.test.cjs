'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict'), http = require('node:http')
const { createNumenClient, endpoint } = require('./numen-client.cjs')
const token = 'a'.repeat(64)
async function host (t, handler) {
  const s = http.createServer(handler); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve))
  t.after(() => { s.closeAllConnections(); return new Promise(resolve => s.close(resolve)) })
  return 'http://127.0.0.1:' + s.address().port + '/mcp'
}
test('plaintext endpoint restricted to explicit LAN/loopback; no credentials/query in URLs', () => {
  for (const value of ['http://8.8.8.8/mcp', 'http://example.test/mcp', 'https://u:p@example.test/mcp', 'https://example.test/mcp?k=secret']) assert.throws(() => endpoint(value))
  for (const value of ['http://192.168.3.163:28984/numen/mcp', 'http://127.0.0.1/mcp', 'http://[::1]/mcp', 'https://example.test/mcp']) assert.ok(endpoint(value))
})
test('MCP client validates ID and structuredContent; token stays in header', async t => {
  let requests = 0
  const url = await host(t, (req, res) => {
    let text = ''; req.on('data', chunk => { text += chunk }); req.on('end', () => {
      requests++; assert.equal(req.headers.authorization, 'Bearer ' + token); assert.equal(text.includes(token), false)
      const call = JSON.parse(text); res.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: { structuredContent: { ok: true } } }))
    })
  })
  assert.equal((await createNumenClient({ url, token }).call('get_state')).ok, true); assert.equal(requests, 1)
})
test('redirect never forwards credentials to another server', async t => {
  let destinationCalls = 0
  const target = await host(t, (req, res) => { destinationCalls++; res.end('{}') })
  const url = await host(t, (req, res) => { res.writeHead(307, { location: target }); res.end() })
  await assert.rejects(createNumenClient({ url, token }).call('lua'), /redirect_refused/)
  assert.equal(destinationCalls, 0)
})
test('timeout remains unconfirmed and is never retried', async t => {
  let count = 0
  const url = await host(t, () => { count++ })
  await assert.rejects(createNumenClient({ url, token, timeoutMs: 100 }).call('lua'), error => error.unconfirmed && !error.message.includes(token))
  assert.equal(count, 1)
})
test('mismatched RPC response and excessive body are explicitly unconfirmed', async t => {
  const wrong = await host(t, (req, res) => res.end('{"jsonrpc":"2.0","id":"wrong","result":{}}'))
  await assert.rejects(createNumenClient({ url: wrong, token }).call('lua'), /receipt_invalid/)
  const huge = await host(t, (req, res) => res.end('x'.repeat(1048577)))
  await assert.rejects(createNumenClient({ url: huge, token }).call('lua'), /over_budget/)
})
