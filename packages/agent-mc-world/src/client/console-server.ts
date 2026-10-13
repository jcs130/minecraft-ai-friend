import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ClientConsolePort {
  operatorState(): Promise<unknown>;
  operatorAction(action: string): Promise<void>;
  metrics: { snapshot(phase: string): unknown };
  status(): { phase: string };
}
const actions = new Set(['connect', 'disconnect', 'observer.start', 'observer.stop', 'player.start', 'player.stop']);
/** Loopback operator UI. It cannot execute arbitrary commands, edit credentials or expose token caches. */
export async function serveClientConsole(port: number, runtime: ClientConsolePort,
  assets = fileURLToPath(new URL('../../dist/client-console/', import.meta.url))) {
  const token = randomBytes(32).toString('hex');
  const operations = new Map<string, { status: 'running' | 'completed' | 'failed'; at: string; error?: string }>();
  const pending = new Set<Promise<void>>();
  const files = new Map(await Promise.all(['index.html', 'console.css', 'console.js', 'metrics.html', 'metrics.css', 'metrics.js'].map(async name =>
    ['/' + (name === 'index.html' ? '' : name === 'metrics.html' ? 'metrics' : name), await readFile(join(assets, name))] as const)));
  let closing = false;
  const server = createServer(async (request, response) => {
    const address = server.address();
    const expected = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    const origin = `http://${expected}`;
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.host !== expected || request.headers.origin && request.headers.origin !== origin
      || request.headers['sec-fetch-site'] === 'cross-site') { json(403, { error: 'Local operator access only.' }); return; }
    try {
      if (request.method === 'GET') {
        if (request.url === '/api/client') { json(200, { ...await runtime.operatorState() as object, controlToken: token, operations: Object.fromEntries(operations) }); return; }
        if (request.url === '/api/harness/metrics') { json(200, runtime.metrics.snapshot(runtime.status().phase)); return; }
        const file = files.get(request.url ?? '');
        if (!file) { json(404, { error: 'Not found.' }); return; }
        response.writeHead(200, { 'content-type': request.url === '/' || request.url === '/metrics' ? 'text/html; charset=utf-8'
          : request.url?.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
        response.end(file); return;
      }
      if (request.method !== 'POST' || request.url !== '/api/client/action') { json(405, { error: 'Method not allowed.' }); return; }
      const supplied = request.headers['x-mc-control'];
      if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json'
        || typeof supplied !== 'string' || supplied.length !== token.length
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { json(403, { error: 'Use the local console.' }); return; }
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 4096) { json(413, { error: 'Request too large.' }); return; }
      }
      const action = (JSON.parse(body) as { action?: unknown }).action;
      if (typeof action !== 'string' || !actions.has(action)) { json(400, { error: 'Unknown action.' }); return; }
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
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise<void>((resolve, reject) => {
    closing = true; server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}
