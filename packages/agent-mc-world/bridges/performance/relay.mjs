/** Explicit performance endpoint, bound to the observed player's host identity. Never discovers ports. */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
const routes = new Set(['/speech-source', '/overlay', '/overlay/app.js', '/overlay/styles.css', '/stream']);

export function createRelay({ endpoint, sourceId }) {
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('Performance endpoint must be an explicit HTTP(S) origin without credentials');
  if (!sourceId) throw new Error('Performance source identity required');
  const lifetime = new AbortController();
  const requests = new Set();
  let checkedAt = 0, available = false, checking;
  async function identity() {
    if (lifetime.signal.aborted) return false;
    if (Date.now() - checkedAt < 1000) return available;
    checking ??= (async () => {
      try {
        const response = await fetch(new URL('/identity', base), { redirect: 'error',
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(1000)]) });
        available = response.ok && (await response.json()).sourceId === sourceId;
      } catch { available = false; }
      checkedAt = Date.now();
      return !lifetime.signal.aborted && available;
    })();
    try { return await checking; } finally { checking = undefined; }
  }
  return {
    async handle(req, res, pathname) {
      if (!routes.has(pathname)) return false;
      const online = await identity();
      if (lifetime.signal.aborted) { if (!res.destroyed) res.writeHead(503).end(); return true; }
      if (pathname === '/speech-source') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ available: online, sourceId })); return true;
      }
      if (!online) { res.writeHead(503).end(); return true; }
      const url = new URL(pathname, base);
      url.searchParams.set('source', sourceId);
      const upstream = (base.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        signal: lifetime.signal, headers: req.headers['last-event-id'] ? { 'last-event-id': req.headers['last-event-id'] } : {},
      }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400) { response.resume(); res.writeHead(502).end(); return; }
        res.writeHead(response.statusCode ?? 502, { 'content-type': response.headers['content-type'] ?? 'text/plain',
          'cache-control': 'no-store', ...(pathname === '/stream' ? { 'x-accel-buffering': 'no' } : {}) });
        response.on('error', () => res.destroy()); response.pipe(res);
      });
      requests.add(upstream);
      const close = () => { upstream.destroy(); requests.delete(upstream); };
      res.once('close', close);
      upstream.on('error', () => { available = false; checkedAt = 0; if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); });
      upstream.once('close', () => { requests.delete(upstream); res.removeListener('close', close); });
      upstream.setTimeout(30000, () => upstream.destroy()); upstream.end(); return true;
    },
    close() { lifetime.abort(); for (const req of requests) req.destroy(); requests.clear(); },
  };
}
