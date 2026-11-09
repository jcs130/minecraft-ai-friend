import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const MAP_FILE_LIMIT = 8 * 1024 * 1024;
export const MAP_FRESH_MS = 20000;
export const MAP_AVATAR_LIMIT = 512 * 1024;
export function validateMapAvatar(bytes) {
  // Operator-only public portraits: bounded static PNG, never SVG/HTML or a URL fetch.
  if (bytes.length < 45 || bytes.length > MAP_AVATAR_LIMIT || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || bytes.subarray(12, 16).toString() !== 'IHDR' || bytes.readUInt32BE(8) !== 13
      || ![bytes.readUInt32BE(16), bytes.readUInt32BE(20)].every(n => n >= 8 && n <= 512)
      || bytes.subarray(-8, -4).toString() !== 'IEND') throw fail(400, 'MAP_AVATAR_STATIC_PNG_8_TO_512_REQUIRED');
  let offset = 8, data = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString();
    if (size > bytes.length - offset - 12 || type === 'acTL') throw fail(400, 'MAP_AVATAR_STATIC_PNG_8_TO_512_REQUIRED');
    if (type === 'IDAT') data = true;
    offset += size + 12;
    if (type === 'IEND') {
      if (size || offset !== bytes.length || !data) throw fail(400, 'MAP_AVATAR_STATIC_PNG_8_TO_512_REQUIRED');
      return bytes;
    }
  }
  throw fail(400, 'MAP_AVATAR_STATIC_PNG_8_TO_512_REQUIRED');
}
const fail = (status, reason) => Object.assign(new Error(reason), { status, reason });
const mapIds = new Set(['overworld', 'nether', 'end']);
const dimensions = { overworld: 'minecraft:overworld', nether: 'minecraft:the_nether', end: 'minecraft:the_end' };
const services = /^(?:goddess|live|ag_photolens|cortieye|corticam)$/i;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.conf': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.prbm': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };

export function mapFileKey(value) {
  if (typeof value !== 'string' || value.length > 220 || !/^[A-Za-z0-9_./-]+$/.test(value)
      || value.split('/').some(part => !part || part.startsWith('.')) || value.includes('/live/')) throw fail(400, 'MAP_FILE_PATH');
  const plain = value.endsWith('.gz') ? value.slice(0, -3) : value;
  if (!mime[path.posix.extname(plain)] || !(value === 'index.html' || value === 'settings.json'
      || /^(?:assets|lang)\//.test(value) || /^maps\/(?:overworld|nether|end)\//.test(value))) throw fail(400, 'MAP_FILE_TYPE');
  return value;
}

export function validateMapState(value, now = Date.now()) {
  const at = Date.parse(value?.observedAt || '');
  if (value?.schemaVersion !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 0
      || !Number.isFinite(at) || at > now + 5000 || now - at > 60000
      || !Array.isArray(value.players) || value.players.length > 256
      || !Array.isArray(value.maps) || value.maps.length > 3) throw fail(400, 'MAP_STATE_FORMAT');
  const seen = new Set();
  const players = value.players.map(row => {
    if (!/^\.?[A-Za-z0-9_]{1,16}$/.test(row?.name || '') || services.test(row.name)
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.uuid || '')
        || !Object.values(dimensions).includes(row.dimension) || seen.has(row.name.toLowerCase())
        || !['x', 'y', 'z', 'yaw', 'pitch'].every(key => Number.isFinite(row[key]))
        || Math.abs(row.x) > 30000000 || Math.abs(row.z) > 30000000 || Math.abs(row.y) > 100000) throw fail(400, 'MAP_PLAYER_FORMAT');
    seen.add(row.name.toLowerCase());
    return Object.fromEntries(['name', 'uuid', 'dimension', 'x', 'y', 'z', 'yaw', 'pitch'].map(key => [key, row[key]]));
  });
  const ids = new Set();
  const maps = value.maps.map(row => {
    if (!mapIds.has(row?.id) || ids.has(row.id) || row.dimension !== dimensions[row.id]
        || typeof row.label !== 'string' || row.label.length > 60 || !row.bounds
        || !['minX', 'maxX', 'minZ', 'maxZ'].every(key => Number.isFinite(row.bounds[key]))
        || row.bounds.minX >= row.bounds.maxX || row.bounds.minZ >= row.bounds.maxZ) throw fail(400, 'MAP_WORLD_FORMAT');
    ids.add(row.id);
    return { id: row.id, label: row.label, dimension: row.dimension, bounds: Object.fromEntries(['minX', 'maxX', 'minZ', 'maxZ'].map(key => [key, row.bounds[key]])) };
  });
  return { schemaVersion: 1, sequence: value.sequence, observedAt: new Date(at).toISOString(), source: 'minecraft.rcon-readonly', players, maps };
}

async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw fail(413, 'MAP_BODY_LIMIT');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, 'MAP_BODY_LIMIT'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

export class WorldMap {
  constructor(config, { now = Date.now } = {}) {
    this.enabled = config.worldMap?.enabled === true;
    this.root = path.resolve(config.dataDir, 'world-map'); this.now = now;
    this.queue = Promise.resolve(); this.stateCache = null;
  }
  async checkedFile(key, create = false) {
    const target = path.resolve(this.root, ...key.split('/'));
    if (!target.startsWith(this.root + path.sep)) throw fail(400, 'MAP_FILE_PATH');
    if (create) await fs.mkdir(this.root, { recursive: true });
    // Reject links for every existing component, including the root. An upload
    // never follows a link into account data or any adjacent directory.
    const parts = [this.root]; let current = this.root;
    for (const part of key.split('/')) { current = path.join(current, part); parts.push(current); }
    for (const part of parts) {
      try { if ((await fs.lstat(part)).isSymbolicLink()) throw fail(400, 'MAP_FILE_LINK'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (create) await fs.mkdir(path.dirname(target), { recursive: true });
    return target;
  }
  async write(key, bytes) {
    const file = await this.checkedFile(key, true), temporary = file + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(() => {}); }
  }
  async state() {
    if (!this.stateCache) {
      try { this.stateCache = JSON.parse(await fs.readFile(await this.checkedFile('state.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const state = this.stateCache;
    const stale = !state || this.now() - Date.parse(state.observedAt) > MAP_FRESH_MS;
    return { schemaVersion: 1, available: !!state && !stale, stale, observedAt: state?.observedAt || null, source: 'minecraft.rcon-readonly',
      freshForMs: MAP_FRESH_MS, players: stale ? [] : state.players, maps: state?.maps || [], readOnly: true };
  }
  async acceptState(value) {
    const checked = validateMapState(value, this.now());
    const operation = this.queue.then(async () => {
      await this.state();
      if (this.stateCache && checked.sequence <= this.stateCache.sequence) {
        if (checked.sequence === this.stateCache.sequence && JSON.stringify(checked) === JSON.stringify(this.stateCache)) return { accepted: true, duplicate: true };
        throw Object.assign(fail(409, 'MAP_STATE_SEQUENCE'), { currentSequence: this.stateCache.sequence });
      }
      await this.write('state.json', JSON.stringify(checked)); this.stateCache = checked;
      return { accepted: true, observedAt: checked.observedAt };
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async route(req, res, pathname, { authorize, json, respond }) {
    const internal = pathname.startsWith('/api/v1/internal/world-map/');
    const publicMap = pathname === '/api/v1/world-map' || pathname === '/world-map' || pathname.startsWith('/world-map/');
    if (!internal && !publicMap) return false;
    if (!this.enabled) throw fail(404, 'MAP_DISABLED');
    if (internal) {
      authorize(req);
      if (req.method !== 'PUT') throw fail(405, 'METHOD_NOT_ALLOWED');
      if (pathname === '/api/v1/internal/world-map/state') { respond(res, 200, await this.acceptState(await json(req, 131072))); return true; }
      const avatar = /^\/api\/v1\/internal\/world-map\/avatars\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/.exec(pathname);
      if (avatar) {
        if (req.headers['content-type'] !== 'image/png' || req.headers['content-encoding']) throw fail(415, 'MAP_AVATAR_PNG_REQUIRED');
        const bytes = validateMapAvatar(await readBody(req, MAP_AVATAR_LIMIT));
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (req.headers['x-content-sha256'] !== sha256) throw fail(400, 'MAP_FILE_SHA256');
        await this.write(`assets/player-portraits/${avatar[1]}.png`, bytes);
        respond(res, 200, { accepted: true, uuid: avatar[1], sha256, bytes: bytes.length, visibility: 'public' }); return true;
      }
      const prefix = '/api/v1/internal/world-map/files/';
      if (!pathname.startsWith(prefix)) throw fail(404, 'NOT_FOUND');
      const key = mapFileKey(pathname.slice(prefix.length)), expected = req.headers['x-content-sha256'];
      if (!/^[a-f0-9]{64}$/.test(expected || '')) throw fail(400, 'MAP_FILE_SHA256');
      if (req.headers['content-type'] !== 'application/octet-stream' || req.headers['content-encoding']) throw fail(415, 'MAP_FILE_ENCODING');
      const bytes = await readBody(req, MAP_FILE_LIMIT);
      if (createHash('sha256').update(bytes).digest('hex') !== expected) throw fail(400, 'MAP_FILE_SHA256');
      await this.write(key, bytes); respond(res, 200, { accepted: true, bytes: bytes.length, sha256: expected }); return true;
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'METHOD_NOT_ALLOWED');
    if (pathname === '/api/v1/world-map') { respond(res, 200, await this.state()); return true; }
    if (pathname === '/world-map') { res.writeHead(308, { Location: '/world-map/' }); res.end(); return true; }
    const live = /^\/world-map\/maps\/(overworld|nether|end)\/live\/(players|markers)\.json$/.exec(pathname);
    if (live) {
      const state = await this.state();
      respond(res, 200, live[2] === 'players' ? { players: state.players.filter(row => row.dimension === dimensions[live[1]]).map(row => ({
        uuid: row.uuid, name: row.name, foreign: false, position: { x: row.x, y: row.y, z: row.z }, rotation: { pitch: row.pitch, yaw: row.yaw, roll: 0 }
      })) } : {}); return true;
    }
    const key = mapFileKey(pathname === '/world-map/' ? 'index.html' : pathname.slice('/world-map/'.length));
    const head = /^maps\/(?:overworld|nether|end)\/assets\/playerheads\/([a-f0-9-]{36})\.png$/.exec(key);
    if (head) {
      try {
        const portrait = await fs.readFile(await this.checkedFile(`assets/player-portraits/${head[1]}.png`));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': portrait.length, 'Cache-Control': 'no-cache', 'X-Map-Player-Head': 'custom' });
        res.end(req.method === 'HEAD' ? undefined : portrait); return true;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let bytes, compressed = key.endsWith('.gz');
    try { bytes = await fs.readFile(await this.checkedFile(key)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (/^maps\/(?:overworld|nether|end)\/assets\/playerheads\/[a-f0-9-]{36}\.png$/.test(key)) {
        try {
          bytes = await fs.readFile(await this.checkedFile('assets/steve.png'));
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'public, max-age=60', 'X-Map-Player-Head': 'default' });
          res.end(req.method === 'HEAD' ? undefined : bytes); return true;
        } catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
      }
      if (compressed) { res.writeHead(404); res.end(); return true; }
      try { bytes = await fs.readFile(await this.checkedFile(mapFileKey(key + '.gz'))); compressed = true; }
      catch (missing) {
        if (missing.code !== 'ENOENT') throw missing;
        if (/^maps\/(?:overworld|nether|end)\/tiles\/\d+\/x-?\d+\/z-?\d+\.(?:prbm|png)$/.test(key)) res.setHeader('X-Map-Tile-State', 'unknown');
        res.writeHead(/\.prbm$/.test(key) ? 204 : 404); res.end(); return true;
      }
    }
    const extension = path.posix.extname(key.endsWith('.gz') ? key.slice(0, -3) : key);
    const etag = '"' + createHash('sha256').update(bytes).digest('hex') + '"';
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', /\.(?:json|conf|html)$/.test(key) ? 'no-cache' : 'public, max-age=120');
    // Pinned BlueMap's Vue i18n compiler and config substitutions use Function/eval.
    // Permit it only inside the map document; the portal shell keeps its stricter policy.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; frame-ancestors 'self'");
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return true; }
    if (compressed) res.setHeader('Content-Encoding', 'gzip');
    res.writeHead(200, { 'Content-Type': mime[extension], 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes); return true;
  }
}
