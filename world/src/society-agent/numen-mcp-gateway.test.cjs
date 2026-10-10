'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http')
const { attachNumenMcpGateway } = require('./numen-mcp-gateway.cjs')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const close = server => new Promise(resolve => server.close(resolve))
async function request (port, path, { method = 'POST', headers = {}, data = '{}' } = {}) {
  return new Promise((resolve, reject) => {
    if (method === 'GET') data = ''
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    }); req.on('error', error => reject(Object.assign(error, { message: `${path} ${JSON.stringify(headers)}: ${error.message}` }))); req.end(data)
  })
}
test('Numen MCP forwards only its exact route and auth; protects private UI and keeps original host', async () => {
  const seen = []
  const upstream = http.createServer((req, res) => { seen.push({ path: req.url, headers: req.headers }); req.resume(); req.on('end', () => { res.writeHead(req.headers.authorization ? 200 : 401, { 'Content-Type': 'application/json' }); res.end('{"ok":true}') }) })
  const up = await listen(upstream)
  const host = http.createServer((req, res) => { req.resume(); res.end('original:'+req.url) }); const port = await listen(host)
  const detach = attachNumenMcpGateway({ server: host, upstreamPort: up, lanAddress: '192.168.3.163' })
  try {
    assert.equal((await request(port, '/healthz', { method: 'GET' })).body, 'original:/healthz')
    assert.equal((await request(port, '/numen/ui')).body, 'original:/numen/ui')
    assert.equal((await request(port, '/numen/mcp')).status, 401)
    assert.equal((await request(port, '/numen/mcp', { headers: { Authorization: 'Bearer test', 'X-Maw-Bridge': 'DO_NOT_FORWARD' } })).status, 200)
    assert.equal(seen.at(-1).path, '/mcp'); assert.equal(seen.at(-1).headers['x-maw-bridge'], undefined)
    assert.equal(seen.at(-1).headers.host, `127.0.0.1:${up}`)
    const count = seen.length
    assert.equal((await request(port, '/numen/mcp', { headers: { Origin: 'https://evil.example' } })).status, 403)
    assert.equal((await request(port, '/numen/mcp', { headers: { Host: `evil.example:${port}` } })).status, 403)
    assert.equal((await request(port, '/numen/mcp', { data: 'x'.repeat(65537) })).status, 413)
    assert.equal((await request(port, '/numen/mcp', { headers: { 'Content-Type': 'text/plain' } })).status, 415)
    assert.equal(seen.length, count)
    detach(); assert.equal((await request(port, '/numen/mcp')).body, 'original:/numen/mcp')
  } finally { await close(host); await close(upstream) }
})
