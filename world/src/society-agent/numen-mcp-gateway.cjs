'use strict'
const http = require('node:http')

// Reuse this owned worker's existing LAN HTTP listener. The native Numen HTTP
// server remains loopback-only; no firewall/router change or new daemon.
function attachNumenMcpGateway ({ server, lanAddress = null, upstreamPort = 28989 }) {
  if (!server || !Number.isInteger(upstreamPort) || upstreamPort < 1024 || upstreamPort > 65535) throw Error('NUMEN_GATEWAY_CONFIG')
  if (lanAddress !== null && !/^192\.168\.\d{1,3}\.\d{1,3}$/.test(lanAddress)) throw Error('NUMEN_GATEWAY_LAN')
  const listeners = server.listeners('request')
  if (listeners.length !== 1) throw Error('NUMEN_GATEWAY_REQUIRES_SINGLE_HOST_HANDLER')
  const original = listeners[0]
  const active = new Set()
  const handler = (req, res) => {
    if (req.url !== '/numen/mcp') return original.call(server, req, res)
    const address = req.socket.remoteAddress?.replace(/^::ffff:/, '')
    const localPort = server.address()?.port
    const hosts = new Set([`127.0.0.1:${localPort}`, ...(lanAddress ? [`${lanAddress}:${localPort}`] : [])])
    const loopback = address === '127.0.0.1'
    const lan = lanAddress && address?.split('.').length === 4 && address.split('.').slice(0, 3).join('.') === lanAddress.split('.').slice(0, 3).join('.')
    const end = (status, code) => {
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      if (!res.writableEnded) res.end(JSON.stringify({ ok: false, code }))
    }
    if ((!loopback && !lan) || !hosts.has(req.headers.host) || req.headers.origin !== undefined) return end(403, 'NUMEN_LAN_AGENT_CONNECTION_REQUIRED')
    if (!['POST', 'GET', 'DELETE'].includes(req.method)) return end(405, 'METHOD_NOT_SUPPORTED')
    if (active.size >= 16) return end(503, 'NUMEN_GATEWAY_BUSY')
    if (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return end(415, 'JSON_REQUIRED')
    const chunks = []; let size = 0, rejected = false
    req.on('data', chunk => {
      size += chunk.length
      if (size > 65536) { rejected = true; end(413, 'REQUEST_TOO_LARGE'); return }
      if (!rejected) chunks.push(chunk)
    })
    req.on('end', () => {
      if (rejected || res.writableEnded) return
      const headers = { Host: `127.0.0.1:${upstreamPort}` }
      for (const name of ['content-type', 'authorization', 'accept', 'mcp-protocol-version']) if (req.headers[name]) headers[name] = req.headers[name]
      const body = Buffer.concat(chunks); headers['content-length'] = body.length
      const upstream = http.request({ host: '127.0.0.1', port: upstreamPort, path: '/mcp', method: req.method, headers, timeout: 12000 }, response => {
        res.writeHead(response.statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(response.headers['www-authenticate'] ? { 'WWW-Authenticate': response.headers['www-authenticate'] } : {}) })
        response.pipe(res)
        response.on('error', () => { if (!res.writableEnded) res.destroy() })
      })
      active.add(upstream)
      upstream.once('close', () => active.delete(upstream))
      upstream.once('timeout', () => upstream.destroy(Error('NUMEN_UPSTREAM_TIMEOUT')))
      upstream.once('error', () => end(503, 'NUMEN_UPSTREAM_UNAVAILABLE_RESULT_UNKNOWN'))
      res.once('close', () => { if (!res.writableEnded) upstream.destroy() })
      upstream.end(body)
    })
    req.on('error', () => { rejected = true; if (!res.writableEnded) res.destroy() })
  }
  server.removeListener('request', original); server.on('request', handler)
  return () => { server.removeListener('request', handler); server.on('request', original); for (const req of active) req.destroy(); active.clear() }
}
module.exports = { attachNumenMcpGateway }
