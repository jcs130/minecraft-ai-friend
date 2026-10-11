import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { NumenViewerBody } = require('./numen-viewer-body.cjs')
const ROOT = '/numen/view/', COOKIE = 'maw_numen_view', UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function viewerUpstream ({ port, token, path, body }) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body))
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', timeout: 12000,
      headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, res => {
      const chunks = []; let size = 0
      res.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) req.destroy(Error('NUMEN_VIEWER_RESPONSE_BUDGET')); else chunks.push(chunk) })
      res.on('end', () => {
        try { const data = JSON.parse(Buffer.concat(chunks)); resolve({ status: res.statusCode, data }) } catch { reject(Error('NUMEN_VIEWER_RESPONSE_INVALID')) }
      })
      res.on('error', reject)
    })
    req.once('timeout', () => req.destroy(Error('NUMEN_VIEWER_UPSTREAM_TIMEOUT'))); req.once('error', reject); req.end(bytes)
  })
}

// Hosted by the existing supervised worker. Cookies grant only detached
// observation; they never proxy MCP mutations or carry controller leases.
export function attachNumenViewerGateway ({ server, prepared, assetDirectory, registryDirectory, createPresentation, simplifyNBT, lanAddress = null, upstreamPort = 28989, now = Date.now }) {
  const [original, ...other] = server.listeners('request')
  if (!original || other.length) throw Error('NUMEN_VIEWER_SINGLE_HOST_REQUIRED')
  const sessions = new Map(), pending = new Set()
  let stopped = false
  const cookie = req => /(?:^|;\s*)maw_numen_view=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
  const close = session => { sessions.delete(session.id); for (const view of session.views.values()) void view.host.close(); session.views.clear(); session.token = null }
  function allowed (req) {
    const port = server.address()?.port, peer = req.socket.remoteAddress?.replace(/^::ffff:/, '')
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...(lanAddress ? [`${lanAddress}:${port}`] : [])]
    const local = peer === '127.0.0.1' || peer === '::1'
    const lan = lanAddress && peer?.split('.').length === 4 && peer.split('.').slice(0, 3).join('.') === lanAddress.split('.').slice(0, 3).join('.')
    return (local || lan) && hosts.includes(req.headers.host) && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`)
  }
  const send = (res, status, value, html = false, headers = {}) => {
    res.writeHead(status, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'", ...headers })
    res.end(html ? value : JSON.stringify(value))
  }
  const page = content => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Agent World · Numen 观战</title><style>body{background:#101b20;color:#eff6ee;font:16px/1.7 system-ui;max-width:720px;margin:8vh auto;padding:24px}a{color:#a5e1ff}input,button{padding:12px;font:inherit;margin:6px 0}input{width:90%}li{margin:14px 0}</style><h1>Numen 第一人称观战</h1>${content}</html>`
  const login = page(`<p>使用服务器发给你的 Agent 接入令牌，查看自己身体的实时画面。观战不会取得控制权。</p><form id="login"><label>Agent 接入令牌<input name="token" type="password" autocomplete="off" required minlength="64" maxlength="64"></label><button>查看我的 Agent</button></form><p id="error"></p><script>document.getElementById('login').onsubmit=async e=>{e.preventDefault();const token=new FormData(e.target).get('token');const r=await fetch('${ROOT}login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});e.target.reset();if(r.ok)location.href='${ROOT}';else document.getElementById('error').textContent='无法验证接入令牌，请确认令牌有效且服务器在线。'}</script>`)
  async function makeView (session, id) {
    const record = session.bodies.find(row => row.bodyId === id)
    if (!record) throw Error('NUMEN_VIEWER_BODY_NOT_OWNED')
    if ([...sessions.values()].reduce((n, s) => n + s.views.size, 0) >= 4) throw Error('NUMEN_VIEWER_BODY_CAPACITY')
    const body = new NumenViewerBody({ bodyId: id, name: record.name, registryDirectory, assetDirectory, registrySha256: prepared.registrySha256 })
    const host = prepared.attach({ bot: body, expectedUsername: record.name, nativeStream: body.stream, simplifyNBT,
      sourceMode: 'numen_server_body', basePath: `${ROOT}${id}/`,
      getPresentationState: () => body.frame ? createPresentation({ playerUuid: id, menu: body.frame.menu, spellState: body.frame.spell?.state, spellCatalog: body.frame.spell,
        spellObservedAt: Date.parse(body.frame.sampledAt), curiosReceipt: body.frame.curios, domumState: body.frame.domum?.state, modObservedAt: Date.parse(body.frame.sampledAt) }) : null,
      getAgentStatus: () => ({ username: record.name, online: Boolean(body.entity), mode: body.frame?.controller?.driver || 'offline', goal: 'Numen 原生身体 · 只读观战', receipts: [] }), logger: null })
    const view = { body, host, busy: false, lastUse: now(), initialized: false, error: null, frames: 0, latencyMs: null }
    session.views.set(id, view)
    await poll(session, id, view)
    return view
  }
  async function poll (session, id, view) {
    if (view.busy) return view.pending
    if (stopped || !session.token || !session.views.has(id)) return
    view.busy = true; const started = now()
    let release
    view.pending = new Promise(resolve => { release = resolve })
    try {
      const { status, data } = await viewerUpstream({ port: upstreamPort, token: session.token, path: '/viewer', body: { companion: id, initialize: !view.initialized, columns: view.body.columns() } })
      if (stopped || !session.views.has(id)) return
      if (status === 401 || data.code === 'body_not_owned') { close(session); return }
      if (data.code === 'body_offline_or_dead' || data.code === 'body_dead') { view.body.suspend(); view.initialized = false; view.error = data.code; return }
      if (status !== 200 || !data.ok) throw Error(data.code || 'NUMEN_VIEWER_UPSTREAM_FAILED')
      view.body.update(data); view.initialized = true; view.frames++; view.latencyMs = now() - started; view.error = null
    } catch (error) {
      view.error = error.message; view.body.suspend(); view.initialized = false
    } finally { view.busy = false; release(); view.pending = null }
  }
  const handler = async (req, res) => {
    if (!req.url?.startsWith(ROOT)) return original.call(server, req, res)
    if (!allowed(req)) return send(res, 403, { ok: false, code: 'NUMEN_VIEWER_LAN_REQUIRED' })
    const route = req.url.slice(ROOT.length).split('?')[0]
    let session = sessions.get(cookie(req))
    if (session && now() - session.usedAt > 30 * 60 * 1000) { close(session); session = null }
    try {
      if (route === 'health' && req.method === 'GET') return send(res, 200, { ok: true, enabled: true, readOnly: true, route: ROOT, maxSessions: 4,
        sessions: sessions.size, bodies: [...sessions.values()].reduce((n, s) => n + s.views.size, 0), newMinecraftConnections: 0 })
      if (route === 'login' && req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, { code: 'JSON_REQUIRED' })
        if (pending.size >= 4) return send(res, 503, { code: 'NUMEN_VIEWER_BUSY' })
        pending.add(req)
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 1024) return send(res, 413, { code: 'REQUEST_TOO_LARGE' }); chunks.push(chunk) }
        const input = JSON.parse(Buffer.concat(chunks)), token = input.token
        if (Object.keys(input).length !== 1 || !/^[a-f0-9]{64}$/.test(token || '')) return send(res, 401, { code: 'INVALID_TOKEN' })
        const response = await viewerUpstream({ port: upstreamPort, token, path: '/mcp', body: { jsonrpc: '2.0', id: 'viewer-list', method: 'tools/call', params: { name: 'list_companions', arguments: {} } } })
        const result = response.data.result?.structuredContent
        if (response.status !== 200 || !result?.ok || !Array.isArray(result.companions)) return send(res, 401, { code: 'INVALID_TOKEN' })
        if (session) close(session)
        // One browser session per credential avoids multiplying per-owner
        // snapshot work. Multiple tabs in that session share the same body.
        for (const previous of [...sessions.values()]) if (previous.token === token) close(previous)
        if (sessions.size >= 4) return send(res, 429, { code: 'NUMEN_VIEWER_CAPACITY' })
        const id = randomBytes(32).toString('hex')
        session = { id, token, bodies: result.companions.map(row => ({ bodyId: row.bodyId, name: row.name, online: row.online })), views: new Map(), usedAt: now() }; sessions.set(id, session)
        return send(res, 200, { ok: true }, false, { 'Set-Cookie': `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=${ROOT}; Max-Age=1800` })
      }
      if (route === 'logout' && req.method === 'POST') { if (session) close(session); return send(res, 200, { ok: true }, false, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=${ROOT}; Max-Age=0` }) }
      if (req.method !== 'GET') return send(res, 405, { code: 'GET_REQUIRED' })
      if (route === '') {
        if (!session) return send(res, 200, login, true)
        session.usedAt = now()
        return send(res, 200, page(`<ul>${session.bodies.map(row => `<li><a href="${ROOT}${escape(row.bodyId)}/">${escape(row.name)}</a> · ${row.online ? '在线' : '休眠或离线'}<br><small>${escape(row.bodyId)}</small></li>`).join('')}</ul><p>未显示其他账号的身体。休眠的身体需由原控制器恢复。</p><button id="exit">退出观战</button><script>document.getElementById('exit').onclick=async()=>{await fetch('${ROOT}logout',{method:'POST'});location.href='${ROOT}'}</script>`), true)
      }
      if (!session) return send(res, 401, { code: 'VIEWER_LOGIN_REQUIRED' })
      const match = /^([a-f0-9-]{36})\/(.*)$/.exec(route)
      if (!match || !UUID.test(match[1]) || !session.bodies.some(row => row.bodyId === match[1])) return send(res, 403, { code: 'BODY_NOT_OWNED' })
      session.usedAt = now()
      const view = session.views.get(match[1]) || await makeView(session, match[1])
      // Revalidate an idle cached body before disclosing any new state after a
      // token revocation; continuously streamed views revalidate every poll.
      if (now() - view.lastUse > 3000) await poll(session, match[1], view)
      if (!sessions.has(session.id)) return send(res, 401, { code: 'VIEWER_REVOKED' })
      view.lastUse = now()
      const oldUrl = req.url; req.url = '/' + match[2] + (oldUrl.includes('?') ? '?' + oldUrl.split('?').slice(1).join('?') : '')
      try { view.host.server.emit('request', req, res) } finally { req.url = oldUrl }
    } catch { if (!res.headersSent) send(res, 503, { code: 'NUMEN_VIEWER_UNAVAILABLE' }); else res.destroy() }
    finally { pending.delete(req) }
  }
  server.removeListener('request', original); server.on('request', handler)
  const timer = setInterval(() => {
    for (const session of sessions.values()) {
      if (now() - session.usedAt > 30 * 60 * 1000) { close(session); continue }
      for (const [id, view] of session.views) {
        if (view.host.activeViewers() || now() - view.lastUse < 3000) void poll(session, id, view)
        else if (now() - view.lastUse > 60000) { void view.host.close(); session.views.delete(id) }
      }
    }
  }, 200); timer.unref()
  return { status: () => ({ enabled: true, readOnly: true, route: ROOT, sessions: sessions.size, bodies: [...sessions.values()].reduce((n, s) => n + s.views.size, 0), maxSessions: 4 }),
    close () { stopped = true; clearInterval(timer); for (const session of [...sessions.values()]) close(session); server.removeListener('request', handler); server.on('request', original) } }
}
