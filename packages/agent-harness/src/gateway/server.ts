import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HarnessRuntime } from '../harness.ts';
import { AgentRegistry, type GatewayAgentConfig } from './auth.ts';
import { GatewayCore, type GatewayInfo, type GatewaySession, type HandleResult } from './core.ts';
import { DEFAULT_LIMITS, type GatewayLimits } from './limits.ts';
import { GATEWAY_PROTOCOL, GATEWAY_VERSION, GatewayError, HTTP_STATUS, requestIdOf, type ErrorPayload, type HarnessEventKindList, type ResponseEnvelope } from './protocol.ts';

export interface GatewayServerOptions {
  harness: HarnessRuntime;
  /** Default 127.0.0.1. A non-loopback host requires at least one configured agent token. */
  host?: string;
  /** Default 8787; 0 = ephemeral. */
  port?: number;
  agents?: readonly GatewayAgentConfig[];
  env?: NodeJS.ProcessEnv;
  limits?: Partial<GatewayLimits>;
  /** Browser origins allowed to connect. Requests carrying any other Origin are refused (default: none). */
  allowedOrigins?: readonly string[];
  info?: GatewayInfo;
  /** WebSocket keepalive ping interval (ms); 0 disables. Default 30000. */
  heartbeatMs?: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface GatewayServer {
  host: string; port: number;
  /** http://host:port */
  url: string;
  /** ws://host:port/v1/ws */
  wsUrl: string;
  core: GatewayCore;
  close(): Promise<void>;
}

export function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

const bearer = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(\S{1,512})$/i.exec(h);
  return m ? m[1]! : '';
};

export async function startGateway(options: GatewayServerOptions): Promise<GatewayServer> {
  const host = options.host ?? '127.0.0.1';
  const limits: GatewayLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const loopback = isLoopback(host);
  const registry = new AgentRegistry(options.agents ?? [], { env: options.env, allowAnonymous: loopback });
  if (!loopback && registry.size === 0) throw new Error(`refusing to bind ${host} without agent tokens (set AGENT_HARNESS_GATEWAY_AGENTS_FILE)`);
  const log = options.log ?? (() => {});
  const core = new GatewayCore(options.harness, registry, limits, options.info, log);
  const origins = new Set(options.allowedOrigins ?? []);
  const originOk = (req: IncomingMessage) => !req.headers.origin || origins.has(req.headers.origin);
  const remoteOf = (req: IncomingMessage) => req.socket.remoteAddress ?? 'unknown';
  const sockets = new Set<WebSocket>();
  const sse = new Set<ServerResponse>();

  const sendJson = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(text);
  };
  const sendEnvelope = (res: ServerResponse, env: ResponseEnvelope) => {
    const err = env.type === 'error' ? env.payload as ErrorPayload : null;
    sendJson(res, err ? HTTP_STATUS[err.code] : 200, env, err?.retryAfterMs ? { 'retry-after': String(Math.ceil(err.retryAfterMs / 1000)) } : {});
  };
  const httpError = (res: ServerResponse, error: GatewayError) => sendEnvelope(res, core.errorResponse(error));

  const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limits.maxMessageBytes) { reject(new GatewayError('too_large', `message exceeds ${limits.maxMessageBytes} bytes`)); req.resume(); return; }
    const chunks: Buffer[] = []; let size = 0; let failed = false;
    req.on('data', (c: Buffer) => {
      if (failed) return;
      size += c.length;
      if (size > limits.maxMessageBytes) { failed = true; reject(new GatewayError('too_large', `message exceeds ${limits.maxMessageBytes} bytes`)); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });

  /** HTTP session authenticated by Bearer header (or anonymous on loopback). */
  const httpSession = (req: IncomingMessage, transport: 'http' | 'sse', push?: GatewaySession['push']) => {
    const s = core.openSession(transport, remoteOf(req), push);
    const token = bearer(req);
    try { if (token !== null || registry.anonymous) core.authenticate(s, token || null); }
    catch (error) { core.closeSession(s); throw error; }
    return s;
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://gateway.local');
      if (!originOk(req)) return httpError(res, new GatewayError('forbidden', 'origin not allowed'));
      if (req.method === 'GET' && url.pathname === '/v1/health')
        return sendJson(res, 200, { ok: true, protocol: GATEWAY_PROTOCOL, v: GATEWAY_VERSION, stream: options.harness.events.streamId });

      if (req.method === 'POST' && url.pathname === '/v1/messages') {
        if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return httpError(res, new GatewayError('bad_request', 'content-type must be application/json'));
        const body = await readBody(req);
        const s = core.openSession('http', remoteOf(req));
        try {
          const token = bearer(req);
          if (token !== null) {
            try { core.authenticate(s, token || null); }
            catch (error) { return sendEnvelope(res, core.errorResponse(error, requestIdOf(body))); }
          }
          const r = await core.handle(s, body, Buffer.byteLength(body));
          return sendEnvelope(res, r.response);
        } finally { core.closeSession(s); }
      }

      if (req.method === 'GET' && url.pathname === '/v1/events') {
        const s = httpSession(req, 'http');
        try {
          const q = url.searchParams;
          const payload = { ...num(q, 'after'), ...num(q, 'limit'), ...num(q, 'minSeverity'), ...kinds(q), ...(q.get('stream') ? { stream: q.get('stream') } : {}) };
          const r = await core.handle(s, JSON.stringify({ v: 1, id: 'http-pull', type: 'pull_events', payload }));
          return sendEnvelope(res, r.response);
        } finally { core.closeSession(s); }
      }

      if (req.method === 'GET' && url.pathname === '/v1/events/stream') {
        let s: GatewaySession | null = null;
        const write = (env: ResponseEnvelope) => {
          if (res.writableLength > limits.maxBufferedBytes) return false;
          const seq = (env.payload as { event?: { seq?: number } }).event?.seq;
          res.write(`${seq !== undefined ? `id: ${seq}\n` : ''}event: ${env.type}\ndata: ${JSON.stringify(env)}\n\n`);
          return true;
        };
        s = httpSession(req, 'sse', write);
        const q = url.searchParams;
        const last = req.headers['last-event-id'];
        const after = typeof last === 'string' && /^\d+$/.test(last) ? Number(last) : (q.get('after') ? Number(q.get('after')) : undefined);
        const sub = core.subscribeDirect(s, { ...(after !== undefined && Number.isInteger(after) && after >= 0 ? { after } : {}),
          ...(q.get('minSeverity') ? { minSeverity: Number(q.get('minSeverity')) as 1 | 2 | 3 } : {}), ...(kinds(q) as object),
          ...(q.get('stream') ? { stream: q.get('stream')! } : {}) });
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        write(sub.response);
        sub.after?.();
        sse.add(res);
        const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15_000); keepalive.unref();
        req.on('close', () => { clearInterval(keepalive); sse.delete(res); core.closeSession(s!); });
        return;
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      if (!res.headersSent) httpError(res, error instanceof GatewayError ? error : new GatewayError('internal', 'internal error'));
      else res.end();
      if (!(error instanceof GatewayError)) log('gateway http error', { error: String(error).slice(0, 200) });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxMessageBytes });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://gateway.local');
    const reject = (status: number, text: string) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`); };
    if (url.pathname !== '/v1/ws') return reject(404, 'Not Found');
    if (!originOk(req)) return reject(403, 'Forbidden');
    const token = bearer(req);
    wss.handleUpgrade(req, socket, head, ws => onSocket(ws, req, token));
  });

  const onSocket = (ws: WebSocket, req: IncomingMessage, token: string | null) => {
    sockets.add(ws);
    let alive = true;
    const send = (env: ResponseEnvelope) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(env)); };
    const s = core.openSession('ws', remoteOf(req), env => {
      if (ws.readyState !== ws.OPEN || ws.bufferedAmount > limits.maxBufferedBytes) return false;
      ws.send(JSON.stringify(env)); return true;
    });
    const closeWith = (code: number, reason: string) => { try { ws.close(code, reason); } catch { ws.terminate(); } };
    if (token !== null) {
      try { core.authenticate(s, token || null); }
      catch (error) { send(core.errorResponse(error)); closeWith(1008, 'unauthorized'); }
    }
    const helloTimer = setTimeout(() => { if (!s.agent && !registry.anonymous) closeWith(1008, 'hello timeout'); }, limits.helloTimeoutMs);
    helloTimer.unref();
    let chain = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      if (isBinary) { send(core.errorResponse(new GatewayError('bad_request', 'binary frames are not supported'))); return; }
      const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      // Process in order per connection.
      chain = chain.then(async () => {
        const r: HandleResult = await core.handle(s, text, Buffer.byteLength(text));
        send(r.response);
        r.after?.();
        if (r.close) closeWith(1008, 'unauthorized');
      }).catch(error => log('gateway ws error', { error: String(error).slice(0, 200) }));
    });
    ws.on('pong', () => { alive = true; });
    const beat = options.heartbeatMs === 0 ? null : setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false; try { ws.ping(); } catch { /* closed */ }
    }, options.heartbeatMs ?? 30_000);
    beat?.unref();
    ws.on('close', () => { clearTimeout(helloTimer); if (beat) clearInterval(beat); sockets.delete(ws); core.closeSession(s); });
    ws.on('error', () => { /* close follows */ });
  };

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 8787, host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address() as AddressInfo;
  const shownHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  log('gateway listening', { host: address.address, port: address.port, agents: registry.size, anonymous: !!registry.anonymous });
  return {
    host: address.address, port: address.port, url: `http://${shownHost}:${address.port}`, wsUrl: `ws://${shownHost}:${address.port}/v1/ws`, core,
    async close() {
      for (const ws of sockets) ws.close(1001, 'server shutting down');
      for (const res of sse) res.end();
      core.closeAll();
      wss.close();
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); });
    },
  };
}

function num(q: URLSearchParams, k: string): Record<string, number> {
  const v = q.get(k); if (v === null) return {};
  if (!/^\d{1,15}$/.test(v)) throw new GatewayError('bad_request', `${k} must be a non-negative integer`);
  return { [k]: Number(v) };
}
function kinds(q: URLSearchParams): { kinds?: HarnessEventKindList } {
  const v = q.get('kinds'); return v ? { kinds: v.split(',').filter(Boolean) as HarnessEventKindList } : {};
}
