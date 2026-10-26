import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { gunzipSync } from 'node:zlib';
import { SPECTATOR_PROTOCOL, CHUNK_BYTES, MAX_BODY_BYTES, CHANNEL_PATTERN, UUID_PATTERN,
  observationPath, validatedSource, decodeChunk } from './spectator-protocol.mjs';
import { SpectatorFanout, SpectatorAssetCache, cacheableSpectatorAsset } from './spectator-fanout.mjs';
import { publicSpectatorEvent, publicSpectatorStatus } from './spectator-public.mjs';

const CSP = "default-src 'self'; script-src 'self'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
const error = (res, status, reason) => {
  if (res.destroyed) return;
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify({ available: false, reason }));
};
const send = (ws, value) => { if (ws.readyState === 1) ws.send(JSON.stringify(value)); };
export function spectatorContentEncoding(header) {
  if (!header) return 'identity';
  const values = new Map();
  for (const item of String(header).toLowerCase().split(',')) {
    const [name, ...parameters] = item.trim().split(';');
    const q = parameters.map(s => s.trim()).find(s => s.startsWith('q='));
    const quality = q ? /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(q.slice(2)) ? Number(q.slice(2)) : 0 : 1;
    if (name) values.set(name, quality);
  }
  const quality = name => values.get(name) ?? (name === 'identity' ? values.get('*') === 0 ? 0 : 1 : values.get('*') ?? 0);
  const candidates = ['br', 'gzip', 'identity'].sort((a, b) => quality(b) - quality(a));
  return quality(candidates[0]) > 0 ? candidates[0] : null;
}
function staticResponse(req, res, file, isPublic = false) {
  const encoding = file.encodings ? spectatorContentEncoding(req.headers['accept-encoding']) : 'identity';
  if (!encoding) { error(res, 406, 'SPECTATOR_ENCODING_UNAVAILABLE'); return; }
  const bytes = encoding === 'identity' ? file.bytes : file.encodings[encoding];
  const headers = { 'Content-Type': file.contentType, 'Cache-Control': isPublic ? 'public, max-age=31536000, immutable' : 'private, no-cache',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer',
    ...(file.encodings ? { Vary: 'Accept-Encoding' } : {}), ...(file.etag ? { ETag: file.etag } : {}) };
  const match = file.etag && String(req.headers['if-none-match'] ?? '').split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === file.etag.replace(/^W\//, ''));
  if (match) { res.writeHead(304, headers); res.end(); return; }
  res.writeHead(200, { ...headers, 'Content-Length': bytes.length, ...(encoding === 'identity' ? {} : { 'Content-Encoding': encoding }) }); res.end(bytes);
}
export function decodedSpectatorChunk(data,encoding='identity') {
  const chunk=decodeChunk(data,encoding);
  if(encoding==='gzip-chunks-v1')chunk.bytes=gunzipSync(chunk.bytes,{maxOutputLength:CHUNK_BYTES});
  if(!chunk.bytes.length||chunk.bytes.length>CHUNK_BYTES)throw Error('SPECTATOR_CHUNK_INVALID');
  return chunk;
}

/** Authorization is mandatory and belongs to the portal's existing session and
 * role database. Tokens never occur in a URL, browser bundle or viewer response.
 * WebSocketServer is injected so the deployed site has an explicit ws lock.
 */
export function createSpectatorRelay({ WebSocketServer, site, authorizePublisher, authorizeViewer,
  pagePrefix = '/watch', sourcePrefix = '/api/v1/live', maxPublishers = 32, maxViewers = 4,
  sharedStreams = false, cacheAssets = false, fanoutOptions = {}, assetCacheOptions = {},
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
    source.hub?.close(); source.assets?.clear();
    for (const pending of source.requests.values()) pending.fail(503, reason);
    source.requests.clear();
    if (source.ws.readyState === 1) source.ws.close(1008, reason);
  }
  function state(channelId) {
    const source = sources.get(channelId);
    return { available: !!source?.info && !source.closed, readOnly: true, mode: 'native-3d',
      playerUuid: source?.info?.playerUuid ?? null, viewerBuild: source?.info?.viewerBuild ?? null,
      viewers: source?.hub ? source.hub.state().viewers : source ? [...source.requests.values()].filter(p => p.path === 'events').length : 0,
      ...(sharedStreams ? { upstreamStreams: source?.hub?.state().upstreamStreams ?? 0, replayBytes: source?.hub?.state().replayBytes ?? 0,
        assetCacheBytes: source?.assets?.bytes ?? 0 } : {}) };
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
  function flushChunks(source, pending) {
    while (!pending.awaitingDrain && pending.chunks.length && source.requests.has(pending.id)) {
      const chunk = pending.chunks.shift();
      const acknowledge = () => {
        pending.unacknowledged--; pending.awaitingDrain = false; pending.onDrain = null;
        if (source.requests.has(chunk.id)) send(source.ws, { type: 'ack', id: chunk.id, sequence: chunk.sequence });
      };
      pending.awaitingDrain = !pending.res.write(chunk.bytes);
      if (pending.awaitingDrain) {
        pending.onDrain = () => { acknowledge(); flushChunks(source, pending); };
        pending.res.once('drain', pending.onDrain);
      } else acknowledge();
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
          const id = data.length >= 8 ? data.readUInt32BE(0) : 0, pending = source.requests.get(id);
          if (!pending) return; // A cancelled request's last in-flight chunk.
          const chunk = decodedSpectatorChunk(data, pending.encoding);
          if (!pending.started || chunk.sequence !== pending.sequence || pending.unacknowledged >= 4) throw Error('SPECTATOR_CHUNK_ORDER');
          pending.sequence++; pending.size += chunk.bytes.length;
          if (pending.path !== 'events' && pending.size > MAX_BODY_BYTES) throw Error('SPECTATOR_BODY_LIMIT');
          pending.unacknowledged++; pending.chunks.push(chunk); flushChunks(source, pending);
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
          send(ws, { type: 'ready', protocol: SPECTATOR_PROTOCOL, playerUuid: source.playerUuid, build: site.build, maxChunkBytes: CHUNK_BYTES, compression: 'gzip-chunks-v1', maxInFlightChunks: 4 });
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
                await source.hub?.check(request => authorizeViewer(request, channelId));
                for (const pending of source.requests.values()) {
                  if (pending.internal) continue; // The hub checks every downstream separately.
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
              || value.contentType !== observationPath(pending.path) || !['identity','gzip-chunks-v1'].includes(value.encoding ?? 'identity')) {
            pending.fail(value.status === 404 ? 404 : 502, 'SPECTATOR_SOURCE_RESOURCE_UNAVAILABLE'); return;
          }
          pending.encoding = value.encoding ?? 'identity'; pending.started = true; clearTimeout(pending.headerTimer);
          pending.res.writeHead(200, { 'Content-Type': value.contentType + (value.contentType.startsWith('text/') || value.contentType === 'application/json' ? '; charset=utf-8' : ''),
            'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP,
            ...(pending.path === 'events' ? { 'X-Accel-Buffering': 'no' } : {}) });
          if (pending.path === 'events') pending.res.flushHeaders();
        } else if (value.type === 'end') {
          if (!pending.started || pending.unacknowledged || pending.chunks.length) throw Error('SPECTATOR_RESPONSE_ORDER');
          pending.cleanup(); pending.res.end();
        } else if (value.type === 'error') pending.fail(502, 'SPECTATOR_SOURCE_RESOURCE_UNAVAILABLE');
        else throw Error('SPECTATOR_MESSAGE_INVALID');
      } catch (e) {
        const safe = new Set(['SPECTATOR_PUBLISHER_BUSY', 'SPECTATOR_SOURCE_IDENTITY_OR_STATE', 'SPECTATOR_RENDERER_BUILD_MISMATCH', 'SPECTATOR_SOURCE_BUILD_CHANGED']);
        retire(source, safe.has(e.message) ? e.message : 'SPECTATOR_PROTOCOL_REJECTED');
      }
    });
  });

  function request(source, req, res, resource, internal = false) {
    if(source.closed||res.destroyed){error(res,503,'SPECTATOR_SOURCE_OFFLINE');return;}
    if(source.requests.size>=256){error(res,429,'SPECTATOR_VIEWER_LIMIT');return;}
    const id = newId();
    const pending = { id, req, res, internal, path: resource, sequence: 0, size: 0, started: false, dispatched: false, awaitingDrain: false, unacknowledged: 0, chunks: [], onDrain: null,
      cleanup() {
        clearTimeout(pending.headerTimer); clearTimeout(pending.deadline); res.off('close', pending.cancel);
        if (pending.onDrain) res.off('drain', pending.onDrain);
        pending.chunks.length = 0; pending.onDrain = null;
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
  }

  async function http(req, res) {
    if (!req.url?.startsWith(pagePrefix + '/')) return false;
    const staticPrefix = pagePrefix + '/_static/';
    if (req.url.startsWith(staticPrefix)) {
      // Public immutable scripts contain application code only. Their exact
      // hash is part of the URL, independent of a private observation channel.
      const local = req.method === 'GET' && site.staticFile?.(req.url.slice(staticPrefix.length));
      if (!local) error(res, 404, 'SPECTATOR_ROUTE_NOT_FOUND'); else staticResponse(req, res, local, true);
      return true;
    }
    const raw = req.url.slice(pagePrefix.length + 1), parts = raw.split('/'), channelId = parts.shift();
    if (closed || req.method !== 'GET' || !CHANNEL_PATTERN.test(channelId ?? '') || /[%\\?#\x00-\x20]/.test(raw)
        || parts.some(p => p === '.' || p === '..')) { error(res, 400, 'SPECTATOR_REQUEST_INVALID'); return true; }
    let viewerScope='owner';
    try { const grant=await authorizeViewer(req, channelId);viewerScope=grant?.scope??'owner';if(!['owner','scene'].includes(viewerScope))throw Error('SPECTATOR_SCOPE_INVALID'); }
    catch (failure) {
      // A consumer may report source replacement only after verifying role
      // access. Keep that explicit temporary state retryable; all other
      // authorization errors stay forbidden and reveal no role information.
      const waiting=failure?.status===503&&failure?.reason==='SPECTATOR_SOURCE_OFFLINE';
      error(res,waiting?503:403,waiting?'SPECTATOR_SOURCE_OFFLINE':'SPECTATOR_VIEW_FORBIDDEN');return true;
    }
    if (res.destroyed) return true;
    const source = sources.get(channelId);
    if (!source?.info || source.closed) { error(res, 503, 'SPECTATOR_SOURCE_OFFLINE'); return true; }
    const relative = parts.join('/');
    if (['third', '3dview'].includes(relative)) {
      res.writeHead(303, { Location: `${pagePrefix}/${channelId}/${relative}/`, 'Cache-Control': 'no-store' }); res.end(); return true;
    }
    const page = relative === '' ? 'first' : ['third/', '3dview/'].includes(relative) ? relative.slice(0, -1) : null;
    const resource = relative.replace(/^(?:third|3dview)\//, '');
    const local = page ? { bytes: site.page(`${pagePrefix}/${channelId}/`, source.info.viewerBuild, page, { staticPrefix: pagePrefix + '/_static' }), contentType: 'text/html; charset=utf-8' } : site.file(resource);
    if (local) {
      if (!page) { staticResponse(req, res, local); return true; }
      res.writeHead(200, { 'Content-Type': local.contentType, 'Content-Length': local.bytes.length, 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' });
      res.end(local.bytes); return true;
    }
    if (!observationPath(resource)) { error(res, 404, 'SPECTATOR_ROUTE_NOT_FOUND'); return true; }
    if(viewerScope==='scene'&&resource==='agent-views') {
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({schema:'mc-agent-views/v1',available:false,reason:'PUBLIC_SCENE_ONLY'}));return true;
    }
    if(viewerScope==='scene'&&resource==='status.json') {
      // Buffer only this small JSON resource; never forward a private header or
      // a partial raw status to a guest. Recheck permission after the read.
      const value=await new Promise(resolve=>{
        const sink=new EventEmitter();let chunks=[],size=0,status=0,done=false;
        const finish=value=>{if(done)return;done=true;sink.destroyed=true;chunks=[];sink.emit('close');resolve(value);};
        sink.writeHead=code=>{status=code;sink.headersSent=true;};sink.flushHeaders=()=>{};
        sink.write=bytes=>{size+=bytes.length;if(size>1024*1024)finish(null);else if(!done)chunks.push(bytes);return true;};
        sink.end=()=>{try{finish(status===200?publicSpectatorStatus(JSON.parse(Buffer.concat(chunks))):null);}catch{finish(null);}};
        sink.destroy=()=>finish(null);request(source,null,sink,resource,true);
      });
      try{const grant=await authorizeViewer(req,channelId);if((grant?.scope??'owner')!=='scene'||source.closed||sources.get(channelId)!==source)throw Error('changed');}
      catch{error(res,403,'SPECTATOR_VIEW_FORBIDDEN');return true;}
      if(!value){error(res,502,'SPECTATOR_SOURCE_RESOURCE_UNAVAILABLE');return true;}
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end(JSON.stringify(value));return true;
    }
    if(viewerScope==='scene'&&resource==='events'&&!sharedStreams){error(res,403,'SPECTATOR_PUBLIC_STREAM_UNAVAILABLE');return true;}
    if (sharedStreams && resource === 'events') {
      if (!source.hub || source.hub.closed) source.hub = new SpectatorFanout({ ...fanoutOptions, playerUuid:source.playerUuid, maxViewers,
        projectPublic:publicSpectatorEvent,
        open: sink => request(source,null,sink,'events',true) });
      if (!source.hub.subscribe(req,res,{scope:viewerScope})) error(res,429,'SPECTATOR_VIEWER_LIMIT');
      return true;
    }
    if (cacheAssets && cacheableSpectatorAsset(resource)) {
      source.assets ||= new SpectatorAssetCache(assetCacheOptions);
      const asset = await source.assets.read(resource, sink => request(source,null,sink,resource,true));
      // Authorization may have changed while the shared cache miss was pending.
      // Never send old private bytes after an ownership/visibility invalidation.
      try { await authorizeViewer(req,channelId); }
      catch { error(res,403,'SPECTATOR_VIEW_FORBIDDEN'); return true; }
      if (source.closed || sources.get(channelId)!==source) { error(res,503,'SPECTATOR_SOURCE_OFFLINE'); return true; }
      if (res.destroyed) return true;
      if (asset) { staticResponse(req,res,asset); return true; }
    }
    // HTTP/2 can request the original HUD/texture atlas in one burst. Queue a
    // bounded burst rather than turning legitimate texture loads into 429s;
    // only 24 reads (including SSE) reach the source at a time.
    if (source.requests.size >= 256 || resource === 'events' && [...source.requests.values()].filter(p => p.path === 'events').length >= maxViewers) {
      error(res, 429, 'SPECTATOR_VIEWER_LIMIT'); return true;
    }
    request(source,req,res,resource);
    return true;
  }
  return { http, upgrade, state, invalidate: (id,reason='SPECTATOR_VIEW_REVOKED') => { const source=sources.get(id);if(source)retire(source,reason); },
    preload: () => site.preload?.(pagePrefix + '/_static') ?? [],
    async close() {
      if (closed) return;
      closed = true;
      for (const source of sources.values()) retire(source);
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
    } };
}
