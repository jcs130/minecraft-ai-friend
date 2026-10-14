import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';

/** Explicit local, read-only framebuffer view. UI is supplied by mc-visual-console. */
export async function serveNativeView(port: number, pageFile: string, capture: () => Promise<Buffer>, status: () => unknown, notice?: string): Promise<Server> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid native viewer port');
  let page = readFileSync(pageFile);
  if (page.length > 256 * 1024) throw new Error('Native viewer page too large');
  if (notice) {
    const safe = notice.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
    page = Buffer.from(page.toString('utf8').replace('</body>', `<div role="status" style="position:fixed;bottom:8px;left:8px;background:#172129;color:white;padding:8px;z-index:9999">${safe}</div></body>`));
  }
  let pending: Promise<Buffer> | undefined, cached: Buffer | undefined, capturedAt = 0;
  const frame = () => {
    if (cached && Date.now() - capturedAt < 300) return Promise.resolve(cached);
    return pending ??= capture().then(bytes => { cached = bytes; capturedAt = Date.now(); return bytes; }).finally(() => { pending = undefined; });
  };
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${port}`;
    if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin && req.headers.origin !== origin || req.method !== 'GET') {
      res.writeHead(403).end(); return;
    }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const path = new URL(req.url ?? '/', origin).pathname;
      if (path === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); }
      else if (path === '/native/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(status())); }
      else if (path === '/native/frame') { const bytes = await frame(); res.setHeader('Content-Type', 'image/png'); res.end(bytes); }
      else res.writeHead(404).end();
    } catch { res.writeHead(503).end('Actual Java client frame unavailable'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
