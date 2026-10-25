import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountCss, accountPage, accountScript } from './account-page.ts';
import type { ExperimentsSnapshot } from '../decisions/harness2-monitor.ts';

export interface ClientConsolePort {
  operatorState(): Promise<unknown>;
  operatorAction(action: string): Promise<void>;
  metrics: { snapshot(phase: string): unknown };
  status(): { phase: string };
  experiments?(): ExperimentsSnapshot;
}
const actions = new Set(['connect', 'disconnect', 'observer.start', 'observer.stop', 'player.start', 'player.stop','viewer.retry']);
export interface ClientConsolePresentation {
  /** Explicit local host pages allowed to embed this UI. Control APIs keep their own Origin/nonce checks. */
  embedOrigins?: readonly string[];
  /** Hosts without configured native launchers expose only their Agent connection. Defaults to true for existing SDK users. */
  nativeClients?: boolean;
}
function embeddingPolicy(origins: readonly string[] = []) {
  for (const origin of origins) {
    if(origin==='dsh-app://app')continue;
    const value = new URL(origin);
    if (value.origin !== origin || value.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(value.hostname)
      || !value.port || value.username || value.password) throw new Error('Console embedding requires an exact loopback HTTP or owned DSH Desktop origin.');
  }
  return origins.length ? [...new Set(origins)].join(' ') : "'none'";
}
/** Loopback operator UI. It cannot execute arbitrary commands, edit credentials or expose token caches. */
export async function serveClientConsole(port: number, runtime: ClientConsolePort,
  assets = fileURLToPath(new URL('../../dist/client-console/', import.meta.url)),
  binding?: { directory: string; identity: string }, presentation?: ClientConsolePresentation) {
  const ancestors = embeddingPolicy(presentation?.embedOrigins);
  const nativeClients = presentation?.nativeClients !== false;
  const token = randomBytes(32).toString('hex');
  const instanceId = randomBytes(32).toString('hex');
  if (binding && !/^[a-f0-9]{24}$/.test(binding.identity)) throw new Error('Invalid operator identity');
  const operations = new Map<string, { status: 'running' | 'completed' | 'failed'; at: string; error?: string }>();
  const pending = new Set<Promise<void>>();
  let files: Map<string, Buffer>;
  try {
    files = new Map(await Promise.all(['index.html', 'console.css', 'console.js', 'metrics.html', 'metrics.css', 'metrics.js'].map(async name =>
      ['/' + (name === 'index.html' ? '' : name === 'metrics.html' ? 'metrics' : name), await readFile(join(assets, name))] as const)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Engine/SDK builds may omit the optional UI. Keep local control APIs
    // available, without pretending an incomplete asset bundle is a viewer.
    files = new Map();
  }
  let closing = false;
  for(const name of ['experiments.js','experiments.css']){
    try{files.set('/'+name,await readFile(join(assets,name)));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  const accountPath = `/account/${instanceId}`;
  files.set(accountPath, Buffer.from(accountPage));
  files.set('/account.js', Buffer.from(accountScript));
  files.set('/account.css', Buffer.from(accountCss));
  const server = createServer(async (request, response) => {
    const address = server.address();
    const expected = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    const origin = `http://${expected}`;
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      response.end(JSON.stringify(body));
    };
    // An owned Desktop document is cross-site to HTTP loopback. Allow only its
    // iframe navigation, constrained by frame-ancestors, never cross-site APIs.
    const embeddedNavigation=ancestors!=="'none'"&&request.method==='GET'&&request.url==='/'&&!request.headers.origin
      &&request.headers['sec-fetch-mode']==='navigate'&&request.headers['sec-fetch-dest']==='iframe';
    if (request.headers.host !== expected || request.headers.origin && request.headers.origin !== origin
      || request.headers['sec-fetch-site'] === 'cross-site'&&!embeddedNavigation) { json(403, { error: 'Local operator access only.' }); return; }
    try {
      if (request.method === 'GET') {
        if (request.url === '/api/client') {
          if (binding && request.headers['x-mc-instance'] !== instanceId) { json(409, { error: 'Operator instance changed.' }); return; }
          json(200, { ...await runtime.operatorState() as object, capabilities: { nativeClients }, instanceId, webConsoleAvailable: files.has('/'), controlToken: token, operations: Object.fromEntries(operations) }); return;
        }
        if (request.url === '/api/harness/metrics') { json(200, runtime.metrics.snapshot(runtime.status().phase)); return; }
        if (request.url === '/api/experiments') {
          json(200,runtime.experiments?.()??{schema:'agent-mc.experiments/v1',sampledAt:Date.now(),enabled:false,scope:'isolated-practice-only',jobs:[]});return;
        }
        const file = files.get(request.url ?? '');
        if (!file && (request.url === '/' || request.url === '/metrics')) {
          json(503, { error: '本构建未包含网页控制台；SDK/MCP 仍可用。准备匹配的 viewer 资源包后重新构建可启用网页。' }); return;
        }
        if (!file) { json(404, { error: 'Not found.' }); return; }
        response.writeHead(200, { 'content-type': request.url === '/' || request.url === '/metrics' || request.url === accountPath ? 'text/html; charset=utf-8'
          : request.url?.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'content-security-policy': `default-src 'self'; connect-src 'self'; frame-src http://127.0.0.1:*; frame-ancestors ${request.url === '/' ? ancestors : "'none'"}; base-uri 'none'; form-action 'none'` });
        response.end(file); return;
      }
      if (request.method !== 'POST' || request.url !== '/api/client/action') { json(405, { error: 'Method not allowed.' }); return; }
      const supplied = request.headers['x-mc-control'];
      if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json'
        || (binding || request.headers['x-mc-instance']) && request.headers['x-mc-instance'] !== instanceId
        || typeof supplied !== 'string' || supplied.length !== token.length
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { json(403, { error: 'Use the local console.' }); return; }
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 4096) { json(413, { error: 'Request too large.' }); return; }
      }
      const action = (JSON.parse(body) as { action?: unknown }).action;
      if (typeof action !== 'string' || !actions.has(action)) { json(400, { error: 'Unknown action.' }); return; }
      if (!nativeClients && /^(?:observer|player)\./.test(action)) { json(403, { error: 'Native client launchers are not enabled by this host.' }); return; }
      if (closing || operations.get(action)?.status === 'running') { json(409, { error: 'This action is already running or the console is closing.' }); return; }
      const record: { status: 'running' | 'completed' | 'failed'; at: string; error?: string } = { status: 'running', at: new Date().toISOString() };
      operations.set(action, record);
      const task = Promise.resolve().then(() => runtime.operatorAction(action)).then(() => { record.status = 'completed'; }, () => {
        record.status = 'failed'; record.error = '操作未完成，请查看连接或客户端状态。';
      }).finally(() => pending.delete(task));
      pending.add(task);
      json(202, { accepted: action });
    } catch { json(400, { error: 'Unable to read state or request.' }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address() as { port: number };
  const descriptor = binding ? join(binding.directory, 'operator.json') : null;
  if (binding && descriptor) {
    try {
      await mkdir(binding.directory, { recursive: true, mode: 0o700 });
      await writeFile(descriptor, JSON.stringify({ schema: 'minecraft-operator-binding/v1', identity: binding.identity, instanceId, port: address.port }), { mode: 0o600 });
    } catch (error) { server.close(); server.closeAllConnections(); throw error; }
  }
  return { url: `http://127.0.0.1:${address.port}/`, accountUrl: `http://127.0.0.1:${address.port}${accountPath}`, close: async () => {
    closing = true;
    if (descriptor) {
      try { if (JSON.parse(await readFile(descriptor, 'utf8')).instanceId === instanceId) await unlink(descriptor); } catch { /* Stale links fail instance validation. */ }
    }
    return new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }); } };
}
