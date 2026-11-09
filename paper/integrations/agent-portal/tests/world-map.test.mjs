import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { WorldMap, mapFileKey, validateMapState, MAP_FRESH_MS, MAP_FILE_LIMIT } from '../src/world-map.mjs';
import { createWorldMapService } from '../src/world-map-service.mjs';
import { parseMapObservation, readCommands } from '../scripts/world-map-source.mjs';
import { visiblePlayers, covered, positionText } from '../public/world-map-model.js';

const uuid = '11111111-1111-3111-8111-111111111111';
const at = Date.parse('2026-11-07T12:00:00Z');
const player = { name: 'ag_Example', uuid, dimension: 'minecraft:overworld', x: -4.5, y: 64, z: 9.1, yaw: 20, pitch: -5 };
const world = { id: 'overworld', label: '千灯纪 · 主世界', dimension: 'minecraft:overworld', bounds: { minX: -1024, maxX: 1535, minZ: -1024, maxZ: 1023 } };
const snapshot = (sequence = 1, observedAt = new Date(at).toISOString()) => ({ schemaVersion: 1, sequence, observedAt, players: [player], maps: [world] });
test('BlueMap compiler exception is confined to its document and not the portal shell', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qd-map-csp-'));
  const service = createWorldMapService({ dataDir: root, publicDir: root, tokenHash: 'f'.repeat(64) });
  await fs.writeFile(path.join(root, 'map.html'), '<!doctype html><title>Portal shell</title>');
  await service.map.write('index.html', Buffer.from('<!doctype html><title>BlueMap</title>'));
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const origin = 'http://127.0.0.1:' + service.server.address().port;
  const shell = await fetch(origin + '/map.html'), terrain = await fetch(origin + '/world-map/');
  assert.equal(shell.status, 200); assert.equal(terrain.status, 200);
  assert.doesNotMatch(shell.headers.get('content-security-policy'), /unsafe-eval/);
  assert.match(terrain.headers.get('content-security-policy'), /script-src 'self' 'unsafe-eval'/);
  assert.match(terrain.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const denied = await fetch(origin + '/api/v1/internal/world-map/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qd-public-map-'));
  let now = at;
  const map = new WorldMap({ dataDir: root, worldMap: { enabled: true } }, { now: () => now });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, map, advance: ms => { now += ms; } };
}
test('map publication is opt-in and separate from game/accounts', async t => {
  const f = await fixture(t);
  const off = new WorldMap({ dataDir: f.root });
  await assert.rejects(off.route({ method: 'GET' }, {}, '/api/v1/world-map', {}), { reason: 'MAP_DISABLED' });
  assert.deepEqual((await f.map.state()).players, []);
  await f.map.acceptState(snapshot());
  assert.equal((await f.map.state()).players[0].x, -4.5);
  assert.deepEqual(await fs.readdir(f.root), ['world-map']);
});
test('stale and disconnected positions never survive as live markers', async t => {
  const f = await fixture(t); await f.map.acceptState(snapshot());
  assert.equal((await f.map.state()).available, true);
  f.advance(MAP_FRESH_MS + 1);
  const old = await f.map.state(); assert.equal(old.available, false); assert.deepEqual(old.players, []); assert.deepEqual(old.maps, [world]);
});
test('restart preserves terrain/state observation time rather than refreshing it', async t => {
  const f = await fixture(t); await f.map.acceptState(snapshot());
  const next = new WorldMap({ dataDir: f.root, worldMap: { enabled: true } }, { now: () => at + MAP_FRESH_MS + 1 });
  const state = await next.state(); assert.equal(state.stale, true); assert.equal(state.observedAt, snapshot().observedAt); assert.equal(state.players.length, 0);
});
test('duplicate acknowledgement and concurrent state uploads keep monotonic sequence', async t => {
  const f = await fixture(t); await f.map.acceptState(snapshot());
  assert.equal((await f.map.acceptState(snapshot())).duplicate, true);
  const results = await Promise.allSettled([f.map.acceptState(snapshot(3)), f.map.acceptState(snapshot(2))]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.reason, 'MAP_STATE_SEQUENCE');
  assert.equal(f.map.stateCache.sequence, 3);
});
test('public state allowlists fields and rejects misleading identity/geometry/time', () => {
  const value = snapshot(); value.secret = 'never'; value.players[0] = { ...player, password: 'never', inventory: [] };
  assert.equal(JSON.stringify(validateMapState(value, at)).includes('never'), false);
  for (const change of [row => { row.players[0].x = NaN; }, row => { row.players[0].name = 'Goddess'; }, row => { row.players.push({ ...player }); }, row => { row.maps[0].dimension = 'minecraft:the_end'; }, row => { row.observedAt = new Date(at + 10000).toISOString(); }, row => { row.observedAt = new Date(at - 60001).toISOString(); }]) {
    const copy = structuredClone(snapshot()); change(copy); assert.throws(() => validateMapState(copy, at));
  }
});
test('public file paths cannot reach private data, hidden files, SQL/PHP or live markers', () => {
  for (const key of ['../portal.sqlite', 'assets/../../accounts.json', '/assets/a.png', 'assets/.hidden.json', 'assets/a\\b.js', 'maps/overworld/live/players.json', 'sql.php', 'state.json', 'config.json', 'assets/code.exe', 'maps/unknown/settings.json']) assert.throws(() => mapFileKey(key));
  for (const key of ['index.html', 'settings.json', 'assets/index-hash.js', 'lang/zh.conf', 'maps/overworld/tiles/0/x-1/z2.prbm.gz']) assert.equal(mapFileKey(key), key);
});
test('map files reject links into neighbouring files', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'outside')); await fs.mkdir(path.join(f.root, 'world-map'));
  try { await fs.symlink(path.join(f.root, 'outside'), path.join(f.root, 'world-map', 'assets'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Host disallows creating the isolated link'); throw error; }
  await assert.rejects(f.map.write('assets/a.png', Buffer.from('bad')), { reason: 'MAP_FILE_LINK' });
  assert.deepEqual(await fs.readdir(path.join(f.root, 'outside')), []);
});
test('real HTTP serves gzip tiles, conditional cache, missing terrain and per-world players', async t => {
  const f = await fixture(t); await f.map.acceptState(snapshot());
  const tile = gzipSync(Buffer.from('a real stored tile body'));
  await f.map.write('maps/overworld/tiles/0/x-1/z2.prbm.gz', tile);
  const server = http.createServer(async (req, res) => {
    try { if (!await f.map.route(req, res, new URL(req.url, 'http://test').pathname, {
      authorize: request => { if (request.headers.authorization !== 'Bearer fixture') throw Object.assign(Error(), { status: 401, reason: 'AUTH' }); },
      json: async req => { const chunks = []; for await (const part of req) chunks.push(part); return JSON.parse(Buffer.concat(chunks)); },
      respond: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
    })) { res.writeHead(404); res.end(); } }
    catch (error) { res.writeHead(error.status || 500); res.end(JSON.stringify({ error: { reason: error.reason } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const get = path => fetch(origin + path);
  const response = await get('/world-map/maps/overworld/tiles/0/x-1/z2.prbm');
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), 'gzip'); assert.equal(await response.text(), gunzipSync(tile).toString());
  assert.equal((await fetch(origin + '/world-map/maps/overworld/tiles/0/x-1/z2.prbm', { headers: { 'If-None-Match': response.headers.get('etag') } })).status, 304);
  const unknownMesh = await get('/world-map/maps/overworld/tiles/0/x0/z0.prbm');
  assert.equal(unknownMesh.status, 204); assert.equal(unknownMesh.headers.get('x-map-tile-state'), 'unknown');
  const unknownImage = await get('/world-map/maps/overworld/tiles/2/x0/z0.png');
  assert.equal(unknownImage.status, 404); assert.equal(unknownImage.headers.get('x-map-tile-state'), 'unknown');
  assert.equal((await get('/world-map/assets/missing.png')).headers.get('x-map-tile-state'), null);
  assert.equal((await (await get('/world-map/maps/overworld/live/players.json')).json()).players[0].name, player.name);
  assert.equal((await (await get('/world-map/maps/nether/live/players.json')).json()).players.length, 0);
  f.advance(MAP_FRESH_MS + 1); assert.equal((await (await get('/world-map/maps/overworld/live/players.json')).json()).players.length, 0);
  const bytes = Buffer.from('small test asset'); const sha = createHash('sha256').update(bytes).digest('hex');
  const put = (headers, body = bytes) => fetch(origin + '/api/v1/internal/world-map/files/assets/test.png', { method: 'PUT', headers, body });
  assert.equal((await put({ 'Content-Type': 'application/octet-stream', 'X-Content-Sha256': sha })).status, 401);
  assert.equal((await put({ Authorization: 'Bearer fixture', 'Content-Type': 'application/octet-stream', 'X-Content-Sha256': 'a'.repeat(64) })).status, 400);
  assert.equal((await put({ Authorization: 'Bearer fixture', 'Content-Type': 'application/octet-stream', 'X-Content-Sha256': sha })).status, 200);
  assert.equal(await (await get('/world-map/assets/test.png')).text(), bytes.toString());
});
test('oversized publication is bounded before storage', async t => {
  const f = await fixture(t), req = Readable.from([]);
  req.method = 'PUT'; req.headers = { 'content-type': 'application/octet-stream', 'content-length': String(MAP_FILE_LIMIT + 1), 'x-content-sha256': 'a'.repeat(64) };
  await assert.rejects(f.map.route(req, {}, '/api/v1/internal/world-map/files/assets/a.png', { authorize() {} }), { status: 413 });
  assert.deepEqual(await fs.readdir(f.root), []);
});
test('readonly commands and parsing preserve absolute coordinates and omit incomplete samples', () => {
  assert.ok(Object.values(readCommands).every(text => text.includes(' run minecraft:data get entity @s ') && !text.includes('say ')));
  const results = { Pos: 'ag_Example has the following entity data: [-4.5d, 64.0d, 9.1d]\n', Dimension: 'ag_Example has the following entity data: "minecraft:overworld"\n', Rotation: 'ag_Example has the following entity data: [20.0f, -5.0f]\n' };
  assert.deepEqual(parseMapObservation(results, [{ name: player.name, uuid }]), [player]);
  assert.equal(parseMapObservation({ ...results, Rotation: 'No entity was found' }, [{ name: player.name, uuid }]).length, 0);
  assert.throws(() => parseMapObservation({ ...results, Pos: 'permission denied' }, []), /MAP_READ_UNRECOGNIZED_Pos/);
  assert.throws(() => parseMapObservation({ ...results, Dimension: 'broken' }, []), /MAP_READ_UNRECOGNIZED_Dimension/);
});
test('map UI does not reuse a stale location and makes coverage explicit', () => {
  const fresh = { ...snapshot(), available: true };
  assert.equal(visiblePlayers(fresh, 'example', at).length, 1);
  assert.equal(visiblePlayers(fresh, '', at + 20001).length, 0);
  assert.equal(visiblePlayers({ ...fresh, available: false }, '', at).length, 0);
  assert.equal(covered(player, [world]), true); assert.equal(covered({ ...player, x: 99999 }, [world]), false);
  assert.equal(positionText(player), 'X -5 · Y 64 · Z 9');
});
