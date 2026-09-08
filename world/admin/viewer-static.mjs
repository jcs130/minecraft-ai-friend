import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);
const acceptsGzip = header => String(header || '').split(',').some(value => {
  const [name, ...parameters] = value.trim().split(';');
  return name.toLowerCase() === 'gzip' && !parameters.some(p => /^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(p));
});

// Caller owns route/path and origin validation. This cache only serves those
// already approved files; changed files are revalidated on every request.
export function createViewerStaticResponder({ maxBytes = 32 * 1024 * 1024, maxEntries = 16 } = {}) {
  const cache = new Map(), pending = new Map();
  let bytes = 0;
  function remember(key, entry) {
    const old = cache.get(key);
    if (old) { bytes -= old.size; cache.delete(key); }
    if (entry.size > maxBytes) return;
    while (cache.size && (cache.size >= maxEntries || bytes + entry.size > maxBytes)) {
      const first = cache.keys().next().value;
      bytes -= cache.get(first).size; cache.delete(first);
    }
    cache.set(key, entry); bytes += entry.size;
  }
  async function load(file, type) {
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new Error('viewer_asset_not_file');
    const identity = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    const existing = cache.get(file);
    if (existing?.identity === identity) {
      cache.delete(file); cache.set(file, existing); return existing;
    }
    const key = file + ':' + identity;
    if (!pending.has(key)) pending.set(key, (async () => {
      const body = await readFile(file);
      const zipped = body.length >= 1024 && /javascript|json|css|text\/|wasm/.test(type)
        ? await compress(body, { level: 1 }) : null;
      const entry = { identity, body, zipped: zipped && zipped.length < body.length ? zipped : null,
        hash: createHash('sha256').update(body).digest('hex'), modified: metadata.mtime.toUTCString() };
      entry.size = body.length + (entry.zipped?.length || 0);
      remember(file, entry); return entry;
    })().finally(() => pending.delete(key)));
    return pending.get(key);
  }
  return async function serveViewerStatic(req, res, file, contentType) {
    const entry = await load(file, contentType);
    const zipped = entry.zipped && acceptsGzip(req.headers['accept-encoding']);
    const body = zipped ? entry.zipped : entry.body;
    const tag = `"${entry.hash}-${zipped ? 'gzip' : 'identity'}"`;
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('ETag', tag);
    res.setHeader('Last-Modified', entry.modified);
    res.setHeader('Vary', 'Accept-Encoding');
    if (String(req.headers['if-none-match'] || '').split(',').some(t => t.trim().replace(/^W\//, '') === tag || t.trim() === '*')) {
      res.writeHead(304); res.end(); return;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', body.length);
    if (zipped) res.setHeader('Content-Encoding', 'gzip');
    res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : body);
  };
}
