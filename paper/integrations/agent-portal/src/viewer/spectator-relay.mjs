import { randomInt } from 'node:crypto';
import { SPECTATOR_PROTOCOL, CHUNK_BYTES, MAX_BODY_BYTES, CHANNEL_PATTERN, UUID_PATTERN,
  observationPath, validatedSource, decodeChunk } from './spectator-protocol.mjs';

const CSP = "default-src 'self'; script-src 'self'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
const error = (res, status, reason) => {
  if (res.destroyed) return;
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify({ available: false, reason }));
};
const send = (ws, value) => { if (ws.readyState === 1) ws.send(JSON.stringify(value)); };

/** Authorization is mandatory and belongs to the portal's existing session and
 * role database. Tokens never occur in a URL, browser bundle or viewer response.
 * WebSocketServer is injected so the deployed site has an explicit ws lock.
 */
export function createSpectatorRelay({ WebSocketServer, site, authorizePublisher, authorizeViewer,
  pagePrefix = '/watch', sourcePrefix = '/api/v1/live', maxPublishers = 32, maxViewers = 4,
  permissionIntervalMs = 5000, headerTimeoutMs = 10000, requestTimeoutMs = 60000, authTimeoutMs = 3000 }) {
  if (typeof WebSocketServer !== 'function' || !site?.page || !site?.file || !site.build
      || typeof authorizePublisher !== 'function' || typeof authorizeViewer !== 'function'
      || !/^\/[A-Za-z0-9_/-]+$/.test(pagePrefix) || pagePrefix.endsWith('/')
      || !/^\/[A-Za-z0-9_/-]+$/.test(sourcePrefix) || sourcePrefix.endsWith('/')) throw Error('SPECTATOR_RELAY_CONFIGURATION');
  const wss = new WebSocketServer({ noServer: true, maxPayload: CHUNK_BYTES + 1024, perMessageDeflate: false });
  const sources = new Map();
  let closed = false, nextId = randomInt(1, 0x7fffffff);
  const newId = () => { nextId = nextId === 0xffffffff ? 1 : nextId + 1; return nextId; };

  function retire(source, reason = 'SPECTATOR_SOURCE_OFFLINE') {
    if (source.closed) return;
    source.closed = true;
    clearTimeout(source.authTimer); clearInterval(source.timer);
    if (sources.get(source.channelId) === source) sources.delete(source.channelId);
    for (const pending of source.requests.values()) pending.fail(503, reason);
    source.requests.clear();
    if (source.ws.readyState === 1) source.ws.close(1008, reason);
  }
  function state(channelId) {
    const source = sources.get(channelId);
    return { available: !!source?.info && !source.closed, readOnly: true, mode: 'native-3d',
      playerUuid: source?.info?.playerUuid ?? null, viewerBuild: source?.info?.viewerBuild ?? null,
      viewers: source ? [...source.requests.values()].filter(p => p.path === 'events').length : 0 };
  }
  function dispatch(source) {
    if (source.closed) return;
    let active = [...source.requests.values()].filter(p => p.dispatched).length;
    for (const pending of source.requests.values()) {
      if (active >= 24) break;
      if (pending.dispatched) continue;
      pending.dispatched = true; active++;
      pending.headerTimer = setTimeout(() => pending.fail(504, 'SPECTATOR_SOURCE_TIMEOUT'), headerTimeoutMs);
      pending.headerTimer.unref();
      send(source.ws, { type: 'request', id: pending.id, method: 'GET', path: pending.path });
    }
  }
  function upgrade(req, socket, head) {
    const raw = req.url?.split('?')[0] ?? '';
    if (!raw.startsWith(sourcePrefix + '/')) return false;
    const suffix = raw.slice(sourcePrefix.length + 1), parts = suffix.split('/');
    if (parts.length !== 2 || parts[1] !== 'source') return false;
    if (closed || req.url.includes('?') || !CHANNEL_PATTERN.test(parts[0]) || wss.clients.size >= maxPublishers * 2) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return true;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, parts[0]));
    return true;
  }
  wss.on('connection', (ws, req, channelId) => {
    const source = { ws, req, channelId, token: null, playerUuid: null, info: null,
      requests: new Map(), closed: false, authing: false, lastPong: Date.now(), lastSource: 0 };
    source.authTimer = setTimeout(() => retire(source, 'SPECTATOR_AUTH_REQUIRED'), authTimeoutMs);
    source.authTimer.unref();
    ws.on('pong', () => { source.lastPong = Date.now(); });
    ws.on('error', () => retire(source)); ws.on('close', () => retire(source));
    ws.on('message', async (data, binary) => {
      if (source.closed) return;
      try {
        if (binary) {
          if (!source.info) throw Error('SPECTATOR_SOURCE_NOT_READY');
          const chunk = decodeChunk(data), pending = source.requests.get(chunk.id);
          if (!pending) return; // A cancelled request's last in-flight chunk.
          if (!pending.started || chunk.sequence !== pending.sequence || pending.awaitingDrain) throw Error('SPECTATOR_CHUNK_ORDER');
          pending.sequence++; pending.size += chunk.bytes.length;
          if (pending.path !== 'events' && pending.size > MAX_BODY_BYTES) throw Error('SPECTATOR_BODY_LIMIT');
          pending.awaitingDrain = !pending.res.write(chunk.bytes);
          const acknowledge = () => {
            pending.awaitingDrain = false;
            if (source.requests.has(chunk.id)) send(ws, { type: 'ack', id: chunk.id, sequence: chunk.sequence });
          };
          if (pending.awaitingDrain) pending.res.once('drain', acknowledge); else acknowledge();
          return;
        }
        const value = JSON.parse(data.toString('utf8'));
        if (!source.playerUuid) {
          if (source.authing || value.type !== 'auth' || value.protocol !== SPECTATOR_PROTOCOL
              || typeof value.token !== 'string' || !/^pub_[A-Za-z0-9_-]{43}$/.test(value.token)) throw Error('SPECTATOR_AUTH_REQUIRED');
          source.authing = true;
          const binding = await authorizePublisher(req, channelId, value.token);
          if (source.closed) return;
          if (!UUID_PATTERN.test(binding?.playerUuid ?? '')) throw Error('SPECTATOR_AUTH_REQUIRED');
          if (sources.has(channelId) || sources.size >= maxPublishers) throw Error('SPECTATOR_PUBLISHER_BUSY');
          source.token = value.token; source.playerUuid = binding.playerUuid.toLowerCase();
          sources.set(channelId, source);
          // Keep the initial deadline until identity and the exact renderer
          // hashes have also passed; an authenticated idle socket is not live.
          send(ws, { type: 'ready', protocol: SPECTATOR_PROTOCOL, playerUuid: source.playerUuid, build: site.build, maxChunkBytes: CHUNK_BYTES });
          return;
        }
        if (value.type === 'source') {
          const info = validatedSource(value.status, source.playerUuid, site.build);
          if (source.info && (source.info.viewerBuild !== info.viewerBuild || source.info.registrySha256 !== info.registrySha256)) {
            throw Error('SPECTATOR_SOURCE_BUILD_CHANGED');
          }
          source.info = info; source.lastSource = Date.now(); clearTimeout(source.authTimer);
          if (!source.timer) {
            let checking = false;
            source.timer = setInterval(async () => {
              if (checking || source.closed) return;
              checking = true;
              try {
                if (Date.now() - source.lastPong > 45000 || Date.now() - source.lastSource > 15000) throw Error('SPECTATOR_SOURCE_STALE');
                const current = await authorizePublisher(req, channelId, source.token);
                if (current?.playerUuid?.toLowerCase() !== source.playerUuid) throw Error('SPECTATOR_AUTH_REVOKED');
                for (const pending of source.requests.values()) {
                  try { await authorizeViewer(pending.req, channelId); }
                  catch { pending.fail(403, 'SPECTATOR_VIEW_REVOKED'); }
                }
                if (ws.readyState === 1) ws.ping();
              } catch (e) { retire(source, e.message === 'SPECTATOR_SOURCE_STALE' ? e.message : 'SPECTATOR_AUTH_REVOKED'); }
              finally { checking = false; }
            }, permissionIntervalMs);
            source.timer.unref();
          }
          send(ws, { type: 'accepted', protocol: SPECTATOR_PROTOCOL });
          return;
        }
        const pending = source.requests.get(value.id);
        if (!pending) return;
        if (value.type === 'response') {
          if (pending.started || !Number.isInteger(value.status) || value.status !== 200
              || value.contentType !== observationPath(pending.path)) {
            pending.fail(value.status === 404 ? 404 : 502, 'SPECTATOR_SOURCE_RESOURCE_UNAVAILABLE'); return;
          }
          pending.started = true; clearTimeout(pending.headerTimer);
          pending.res.writeHead(200, { 'Content-Type': value.contentType + (value.contentType.startsWith('text/') || value.contentType === 'application/json' ? '; charset=utf-8' : ''),
            'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP,
            ...(pending.path === 'events' ? { 'X-Accel-Buffering': 'no' } : {}) });
          if (pending.path === 'events') pending.res.flushHeaders();
        } else if (value.type === 'end') {
          if (!pending.started || pending.awaitingDrain) throw Error('SPECTATOR_RESPONSE_ORDER');
          pending.cleanup(); pending.res.end();
        } else if (value.type === 'error') pending.fail(502, 'SPECTATOR_SOURCE_RESOURCE_UNAVAILABLE');
        else throw Error('SPECTATOR_MESSAGE_INVALID');
      } catch (e) {
        const safe = new Set(['SPECTATOR_PUBLISHER_BUSY', 'SPECTATOR_SOURCE_IDENTITY_OR_STATE', 'SPECTATOR_RENDERER_BUILD_MISMATCH', 'SPECTATOR_SOURCE_BUILD_CHANGED']);
        retire(source, safe.has(e.message) ? e.message : 'SPECTATOR_PROTOCOL_REJECTED');
      }
    });
  });

  async function http(req, res) {
    if (!req.url?.startsWith(pagePrefix + '/')) return false;
    const raw = req.url.slice(pagePrefix.length + 1), parts = raw.split('/'), channelId = parts.shift();
    if (closed || req.method !== 'GET' || !CHANNEL_PATTERN.test(channelId ?? '') || /[%\\?#\x00-\x20]/.test(raw)
        || parts.some(p => p === '.' || p === '..')) { error(res, 400, 'SPECTATOR_REQUEST_INVALID'); return true; }
    try { await authorizeViewer(req, channelId); }
    catch { error(res, 403, 'SPECTATOR_VIEW_FORBIDDEN'); return true; }
    if (res.destroyed) return true;
    const source = sources.get(channelId);
    if (!source?.info || source.closed) { error(res, 503, 'SPECTATOR_SOURCE_OFFLINE'); return true; }
    const relative = parts.join('/');
    if (['third', '3dview'].includes(relative)) {
      res.writeHead(303, { Location: `${pagePrefix}/${channelId}/${relative}/`, 'Cache-Control': 'no-store' }); res.end(); return true;
    }
    const page = relative === '' ? 'first' : ['third/', '3dview/'].includes(relative) ? relative.slice(0, -1) : null;
    const resource = relative.replace(/^(?:third|3dview)\//, '');
    const local = page ? { bytes: site.page(`${pagePrefix}/${channelId}/`, source.info.viewerBuild, page), contentType: 'text/html; charset=utf-8' } : site.file(resource);
    if (local) {
      res.writeHead(200, { 'Content-Type': local.contentType, 'Content-Length': local.bytes.length, 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' });
      res.end(local.bytes); return true;
    }
    if (!observationPath(resource)) { error(res, 404, 'SPECTATOR_ROUTE_NOT_FOUND'); return true; }
    // HTTP/2 can request the original HUD/texture atlas in one burst. Queue a
    // bounded burst rather than turning legitimate texture loads into 429s;
    // only 24 reads (including SSE) reach the source at a time.
    if (source.requests.size >= 256 || resource === 'events' && [...source.requests.values()].filter(p => p.path === 'events').length >= maxViewers) {
      error(res, 429, 'SPECTATOR_VIEWER_LIMIT'); return true;
    }
    const id = newId();
    const pending = { id, req, res, path: resource, sequence: 0, size: 0, started: false, dispatched: false, awaitingDrain: false,
      cleanup() {
        clearTimeout(pending.headerTimer); clearTimeout(pending.deadline); res.off('close', pending.cancel);
        source.requests.delete(id);
        queueMicrotask(() => dispatch(source));
      },
      cancel() { pending.cleanup(); if (pending.dispatched) send(source.ws, { type: 'cancel', id }); },
      fail(status, reason) { pending.cancel(); error(res, status, reason); } };
    if (resource !== 'events') {
      pending.deadline = setTimeout(() => pending.fail(504, 'SPECTATOR_SOURCE_TIMEOUT'), requestTimeoutMs);
      pending.deadline.unref();
    }
    source.requests.set(id, pending); res.once('close', pending.cancel);
    dispatch(source);
    return true;
  }
  return { http, upgrade, state,
    async close() {
      if (closed) return;
      closed = true;
      for (const source of sources.values()) retire(source);
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
    } };
}
