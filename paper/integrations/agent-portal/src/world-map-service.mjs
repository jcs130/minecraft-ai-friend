import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WorldMap } from './world-map.mjs';

const staticFiles = new Map([['/map.html', 'text/html; charset=utf-8'], ['/world-map.js', 'text/javascript; charset=utf-8'], ['/world-map-model.js', 'text/javascript; charset=utf-8'], ['/world-map.css', 'text/css; charset=utf-8'], ['/site-shell.js', 'text/javascript; charset=utf-8'], ['/site-shell.css', 'text/css; charset=utf-8'], ['/assets/lantern.svg', 'image/svg+xml']]);
export function createWorldMapService(config) {
  if (!path.isAbsolute(config.dataDir || '') || !path.isAbsolute(config.publicDir || '') || !/^[a-f0-9]{64}$/.test(config.tokenHash || '')) throw Error('WORLD_MAP_SERVICE_CONFIGURATION');
  const map = new WorldMap({ dataDir: config.dataDir, worldMap: { enabled: true } });
  const respond = (res, code, body) => { const bytes = Buffer.from(JSON.stringify(body)); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length }); res.end(bytes); };
  const authorize = req => {
    const match = /^Bearer (srv_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    if (!match || !timingSafeEqual(createHash('sha256').update(match[1]).digest(), Buffer.from(config.tokenHash, 'hex'))) throw Object.assign(Error('MAP_AUTH_REQUIRED'), { status: 401, reason: 'MAP_AUTH_REQUIRED' });
  };
  const json = async (req, limit) => {
    if (req.headers['content-type'] !== 'application/json') throw Object.assign(Error(), { status: 415, reason: 'JSON_REQUIRED' });
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(Error(), { status: 413, reason: 'MAP_BODY_LIMIT' }); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks)); } catch { throw Object.assign(Error(), { status: 400, reason: 'INVALID_JSON' }); }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'self'");
    try {
      const pathname = new URL(req.url, 'http://map.invalid').pathname;
      if (pathname === '/world-map-health' && req.method === 'GET') return respond(res, 200, { ok: true, version: '1.0.0', available: (await map.state()).available });
      if (await map.route(req, res, pathname, { authorize, json, respond })) return;
      if (!staticFiles.has(pathname)) return respond(res, 404, { error: { reason: 'NOT_FOUND' } });
      if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 405, { error: { reason: 'METHOD_NOT_ALLOWED' } });
      const bytes = await fs.readFile(path.join(config.publicDir, pathname.slice(1)));
      res.writeHead(200, { 'Content-Type': staticFiles.get(pathname), 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      respond(res, error.status || 500, { error: { reason: error.reason || 'MAP_UNAVAILABLE', ...(Number.isSafeInteger(error.currentSequence) ? { currentSequence: error.currentSequence } : {}) } });
    }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.maxConnections = 64; server.maxRequestsPerSocket = 300;
  return { map, server };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const configPath = process.argv[process.argv.indexOf('--config') + 1];
  if (!process.argv.includes('--config') || !path.isAbsolute(configPath || '')) throw Error('Use --config with an absolute private configuration path');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (config.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw Error('World map service must bind loopback');
  const { server } = createWorldMapService(config);
  server.listen(config.port, config.host, () => console.log('Read-only world map service ready on loopback.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
