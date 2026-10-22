import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { projectRoot } from '../src/config.mjs';
import { siteFixture, jpegFixture, testPassword } from './helpers.mjs';
import { jpegSize } from '../src/live.mjs';
import { captureCanvas, installCaptureHook } from '../src/capture-canvas.mjs';

async function channel(f, visibility = 'public') {
  const result = await f.admin.request('/admin/live-channels', 'POST', { title: '探索日常', playerName: 'ag_Alpha', visibility });
  assert.equal(result.status, 201); return result.data;
}
const publish = (f, c, suffix, options = {}) => fetch(`${f.origin}/api/v1/live/${c.id}/${suffix}`, { ...options,
  headers: { Authorization: 'Bearer ' + c.publisherToken, ...options.headers } });
const put = (f, c, epoch, seq = 1, bytes = jpegFixture()) => publish(f, c, 'frame', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'X-Stream-Epoch': epoch, 'X-Frame-Sequence': String(seq) }, body: bytes });

test('legacy member channels migrate without broadening access or losing publisher hashes', async t => {
  const base = path.resolve(projectRoot, '.local/tests'), root = path.join(base, 'migration-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  let store;
  t.after(async () => { store?.close(); assert.ok(path.resolve(root).startsWith(base + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const old = new DatabaseSync(path.join(root, 'portal.sqlite'));
  old.exec("CREATE TABLE live_channels(id TEXT PRIMARY KEY,title TEXT,player_name TEXT,visibility TEXT,publisher_hash TEXT,created_at INTEGER); INSERT INTO live_channels VALUES('old','旧频道','ag_Alpha','members','saved-hash',123)");
  old.close(); store = new Store(root);
  const migrated = store.db.prepare('SELECT * FROM live_channels').get();
  assert.equal(migrated.visibility, 'owner'); assert.equal(migrated.player_uuid, null);
  assert.equal(migrated.publisher_hash, 'saved-hash'); assert.equal(migrated.created_at, 123);
});

test('live ingress admits bounded JPEG sizes and refuses HTML, SVG and oversized dimensions', () => {
  assert.deepEqual(jpegSize(jpegFixture()), { width: 1280, height: 720 });
  assert.throws(() => jpegSize(Buffer.from('<svg><script>bad</script></svg>')));
  assert.throws(() => jpegSize(jpegFixture(65535, 720)));
  assert.throws(() => jpegSize(jpegFixture(1, 1)));
  assert.throws(() => jpegSize(jpegFixture().subarray(0, 19)));
});

test('only an administrator can create a publisher; raw publisher token is not stored or listed', async t => {
  const f = await siteFixture(t), user = f.client(); await user.init();
  await user.request('/accounts', 'POST', { username: 'viewer-user', password: testPassword });
  assert.equal((await user.request('/admin/live-channels', 'POST', { title: 'bad', playerName: 'ag_Alpha', visibility: 'public' })).status, 403);
  const c = await channel(f); assert.match(c.publisherToken, /^pub_/);
  const text = JSON.stringify(f.portal.store.db.prepare('SELECT * FROM live_channels').all());
  assert.ok(!text.includes(c.publisherToken));
  const list = await user.request('/live'); assert.equal(list.data.channels[0].available, false);
  assert.ok(!JSON.stringify(list.data).includes('publisher_hash'));
  assert.equal((await fetch(`${f.origin}/api/v1/live/${c.id}/frame`, { method: 'PUT', body: 'fake' })).status, 401);
});

test('real HTTP publishing enforces stream epoch, sequence, rate and stale-frame cutoff', async t => {
  const f = await siteFixture(t), c = await channel(f);
  assert.equal((await fetch(`${f.origin}/api/v1/live/${c.id}/frame`)).status, 503);
  const opened = await (await publish(f, c, 'open', { method: 'POST' })).json();
  assert.equal((await put(f, c, 'old-epoch')).status, 409);
  assert.equal((await put(f, c, opened.epoch)).status, 200);
  const frame = await fetch(`${f.origin}/api/v1/live/${c.id}/frame`);
  assert.equal(frame.status, 200); assert.equal(frame.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await frame.arrayBuffer()), jpegFixture());
  assert.equal((await put(f, c, opened.epoch)).status, 409);
  assert.equal((await put(f, c, opened.epoch, 2)).status, 429);
  assert.equal((await publish(f, c, 'open', { method: 'POST' })).status, 409);
  const active = f.portal.live.frames.get(c.id); active.at = Date.now() - 9000;
  assert.equal((await fetch(`${f.origin}/api/v1/live/${c.id}/frame`)).status, 503);
  assert.equal((await f.admin.request('/live')).data.channels[0].available, false);
});

test('owner-only pictures require the bound role owner or administrator; publisher rotation revokes old access immediately', async t => {
  const f = await siteFixture(t), c = await channel(f, 'owner');
  const opened = await (await publish(f, c, 'open', { method: 'POST' })).json();
  await put(f, c, opened.epoch);
  assert.equal((await fetch(`${f.origin}/api/v1/live/${c.id}/frame`)).status, 401);
  assert.equal((await fetch(`${f.origin}/api/v1/live`).then(r => r.json())).channels.length, 0);
  assert.equal((await f.admin.request('/live')).data.channels.length, 1);
  const rotated = await f.admin.request(`/admin/live-channels/${c.id}/publisher`, 'POST', {});
  assert.equal(rotated.status, 200); assert.equal((await put(f, c, opened.epoch, 2)).status, 401);
  assert.equal((await f.admin.request('/live')).data.channels[0].available, false);
  assert.equal((await f.admin.request(`/admin/live-channels/${c.id}`, 'DELETE')).status, 200);
  assert.equal((await fetch(`${f.origin}/api/v1/live/${c.id}/frame`)).status, 404);
});

test('capture reads only canvas pixels; readiness rejects stale connections and unmeshed/unknown worlds', t => {
  const dom = new JSDOM('<canvas id="viewer-canvas"></canvas><div>private chat and inventory</div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window;
  const canvas = w.document.querySelector('canvas'); canvas.width = 1280; canvas.height = 720;
  let reads = 0; canvas.toDataURL = () => { reads++; return 'data:image/jpeg;base64,TEST_CANVAS_ONLY'; };
  w.eval(`window.captureForTest = ${captureCanvas.toString()}`);
  assert.equal(w.captureForTest().available, false);
  w.__lanternRenderer = { minecraftVersion: '1.21.1', chunkLoading: { meshed: 1 }, viewMode: 'first' };
  w.__qdLiveTransport = { open: true, at: Date.now() };
  assert.equal(w.captureForTest().jpeg, 'data:image/jpeg;base64,TEST_CANVAS_ONLY'); assert.equal(reads, 1);
  assert.ok(!JSON.stringify(w.captureForTest()).includes('private'));
  w.__qdLiveTransport.at = Date.now() - 6000; assert.equal(w.captureForTest().reason, 'VIEWER_DISCONNECTED');
  w.__qdLiveTransport.at = Date.now(); w.__lanternRenderer.chunkLoading.meshed = 0; assert.equal(w.captureForTest().reason, 'WORLD_NOT_READY');
  w.__lanternRenderer.minecraftVersion = 'unknown'; assert.equal(w.captureForTest().available, false);
});

test('capture browser alone keeps WebGL drawing buffers and retains native WebSocket constants', t => {
  const dom = new JSDOM('<canvas></canvas>', { url: 'http://127.0.0.1:7793', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window; const attributes = [];
  w.HTMLCanvasElement.prototype.getContext = (_kind, options) => { attributes.push(options); return {}; };
  w.eval(`(${installCaptureHook.toString()})('http://127.0.0.1:7793')`);
  w.document.querySelector('canvas').getContext('webgl2', { alpha: false });
  w.document.querySelector('canvas').getContext('2d', { alpha: true });
  assert.equal(attributes[0].preserveDrawingBuffer, true); assert.equal(attributes[0].alpha, false);
  assert.equal(attributes[1].preserveDrawingBuffer, undefined); assert.equal(w.WebSocket.OPEN, 1);
});

test('owners manage only their verified role stream and that stream is selected before public channels', async t => {
  const f = await siteFixture(t), alice = f.client(), bob = f.client();
  for (const [client, name] of [[alice, 'Alice'], [bob, 'Bob']]) { await client.init(); await client.request('/accounts', 'POST', { username: name, password: testPassword }); }
  const owner = f.portal.store.ownerByName('Alice');
  await f.admin.request('/admin/bindings', 'POST', { ownerId: owner.id, agentId: f.agent.id, proof: 'Isolated independently verified role ownership', confirmedOwnership: true });
  const created = await alice.request('/live-channels', 'POST', { title: '我的冒险', playerName: 'ag_Alpha', visibility: 'owner' });
  assert.equal(created.status, 201); const id = created.data.id;
  const list = await alice.request('/live'); assert.equal(list.data.defaultChannelId, id); assert.equal(list.data.channels[0].isOwn, true);
  assert.equal((await bob.request('/live')).data.channels.length, 0);
  assert.equal((await bob.request(`/live-channels/${id}/publisher`, 'POST', {})).status, 404);
  assert.equal((await bob.request(`/live-channels/${id}`, 'DELETE')).status, 404);
  assert.equal((await bob.request(`/live/${id}/frame`)).status, 404);
  assert.equal((await bob.request('/live-channels', 'POST', { title: '伪造直播', playerName: 'ag_Alpha', visibility: 'public' })).status, 404);
  assert.equal((await alice.request(`/live-channels/${id}/publisher`, 'POST', {})).status, 200);
});
