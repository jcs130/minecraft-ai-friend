'use strict'
// One existing game port also serves an explicit allowlist of public SDK/type
// assets. Minecraft bytes (including premium encryption) pass through unchanged.
const net = require('node:net'), http = require('node:http'), fs = require('node:fs'), path = require('node:path')
const readline = require('node:readline')

function createFront ({ host, port, backendPort, assetsRoot = null, maxConnections = 64 }) {
  if (!['127.0.0.1', '0.0.0.0'].includes(host) || !Number.isInteger(port) || !Number.isInteger(backendPort)) throw Error('explicit_front_ports_required')
  const active = new Set(), assetRoot = assetsRoot && path.resolve(assetsRoot)
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return }
    let files
    try { files = assetRoot && JSON.parse(fs.readFileSync(path.join(assetRoot, 'assets.json'))).files } catch {}
    const file = files?.[req.url]
    if (!file || typeof file.path !== 'string') { res.writeHead(404); res.end(); return }
    const target = path.resolve(assetRoot, file.path)
    let stat
    try { if (!target.startsWith(assetRoot + path.sep) || fs.lstatSync(target).isSymbolicLink()) throw Error('unsafe_asset'); stat = fs.statSync(target) } catch { res.writeHead(503); res.end(); return }
    if (!stat.isFile() || stat.size !== file.bytes || stat.size > 32 * 1024 * 1024) { res.writeHead(503); res.end(); return }
    res.writeHead(200, { 'Content-Type': file.contentType || 'application/octet-stream', 'Content-Length': stat.size,
      'Cache-Control': ['/native-manifest.json', '/sao-agent-sdk.tgz', '/SHA256SUMS'].includes(req.url) ? 'no-store' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff', 'X-Content-SHA256': file.sha256, Connection: 'close' })
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(target).on('error', () => res.destroy()).pipe(res)
  })
  server.on('clientError', (_, socket) => socket.destroy())
  const listener = net.createServer(socket => {
    if (active.size >= maxConnections) { socket.destroy(); return }
    active.add(socket); socket.setNoDelay(true)
    let first = Buffer.alloc(0), back, classified = false
    const timeout = setTimeout(() => socket.destroy(), 5000)
    socket.once('close', () => { active.delete(socket); clearTimeout(timeout); back?.destroy() })
    socket.on('error', () => back?.destroy())
    const select = data => {
      first = Buffer.concat([first, data])
      if (first.length > 8192) { socket.destroy(); return }
      if (first.length < 5) return
      classified = true; clearTimeout(timeout); socket.pause(); socket.removeListener('data', select)
      const isHttp = first.subarray(0, 4).toString() === 'GET ' || first.subarray(0, 5).toString() === 'HEAD '
      if (isHttp && assetRoot) { socket.unshift(first); server.emit('connection', socket); socket.resume(); return }
      back = net.connect({ host: '127.0.0.1', port: backendPort }, () => { back.write(first); socket.pipe(back); socket.resume() })
      back.setNoDelay(true); back.pipe(socket); back.on('error', () => socket.destroy()); back.once('close', () => socket.destroy())
    }
    socket.on('data', select)
  })
  listener.on('error', error => { process.exitCode = 1; console.error(JSON.stringify({ event: 'front_error', code: error.code })) })
  return { listener, listen: () => new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, host, resolve) }),
    close: () => new Promise(resolve => { for (const socket of active) socket.destroy(); listener.close(resolve); server.closeIdleConnections() }) }
}
if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(process.argv[2])); const front = createFront(config)
  front.listen().then(() => console.log(JSON.stringify({ event: 'native_front_ready', port: config.port })))
  readline.createInterface({ input: process.stdin }).on('line', async line => { if (line === '{"kind":"shutdown"}') { await front.close(); process.exit(0) } })
}
module.exports = { createFront }
