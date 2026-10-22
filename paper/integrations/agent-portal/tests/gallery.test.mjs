import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createPortal } from '../src/server.mjs';
import { loadConfig, projectRoot } from '../src/config.mjs';
import { PhotoReader, validatePhotos } from '../src/gallery.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=', 'base64');
const token = 'srv_' + 'h'.repeat(43), id = '11111111-1111-4111-8111-111111111112';
const photo = () => ({ id, author: 'ag_CorMy', title: '麦田边的家', story: '收完麦子，和伙伴一起回家。', capturedAt: '2026-10-20T12:00:00Z', sha256: createHash('sha256').update(png).digest('hex'), bytes: png.length, width: 1, height: 1 });
async function fixture(t) {
  const base = path.resolve(projectRoot, '.local/tests'), root = path.join(base, 'gallery-' + randomUUID());
  const config = loadConfig({ host: '127.0.0.1', port: 0, dataDir: root, sourceMode: 'cloud', cloudSync: { enabled: true, tokenHash: createHash('sha256').update(token).digest('hex') } });
  let portal;
  async function start() { portal = createPortal(config); await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve)); }
  await start();
  const origin = () => 'http://127.0.0.1:' + portal.server.address().port;
  const snapshot = (photos, sequence) => ({ schemaVersion: 1, observedAt: new Date().toISOString(), sequence, roster: [], players: [], states: {}, events: [], summary: {}, photos });
  const catalog = (photos, sequence = 1) => portal.cloud.accept(snapshot(photos, sequence));
  const upload = (body = png, headers = {}, photoId = id) => fetch(origin() + '/api/v1/internal/photos/' + photoId, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/png', ...headers }, body });
  t.after(async () => { await portal.close(); assert.ok(root.startsWith(base + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return { get portal() { return portal; }, config, root, origin, catalog, upload, restart: async () => { await portal.close(); await start(); } };
}

test('published photos retain original PNG bytes, author/story and remain after a website restart', async t => {
  const f = await fixture(t); f.catalog([photo()]);
  assert.equal((await f.upload()).status, 200);
  const response = await fetch(f.origin() + '/api/v1/gallery'), result = await response.json();
  assert.equal(result.photos[0].author, 'ag_CorMy'); assert.equal(result.photos[0].story, photo().story);
  assert.ok(!JSON.stringify(result).match(/owner|worldUuid|imageIndex|examRun|coordinates/));
  const image = await fetch(f.origin() + result.photos[0].imageUrl);
  assert.equal(image.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  await f.restart(); assert.equal(f.portal.gallery.list().length, 1);
  assert.deepEqual(f.portal.gallery.image(id).bytes, png);
});

test('browser writes, bad credentials, unpublished IDs and mismatched image bodies cannot enter the gallery', async t => {
  const f = await fixture(t);
  assert.equal((await f.upload()).status, 404);
  f.catalog([photo()]);
  assert.equal((await f.upload(png, { Origin: f.origin() })).status, 403);
  assert.equal((await f.upload(png, { Authorization: 'Bearer pat_' + 'h'.repeat(43) })).status, 401);
  assert.equal((await f.upload(Buffer.from('wrong image'))).status, 400);
  assert.equal((await f.upload(png, { 'Content-Type': 'image/svg+xml' })).status, 415);
  assert.equal((await f.upload(png, {}, randomUUID())).status, 404);
  assert.equal(f.portal.gallery.list().length, 0);
});

test('withdrawing a published work immediately removes the catalog entry and its public image route', async t => {
  const f = await fixture(t); f.catalog([photo()]); await f.upload();
  f.catalog([], 2);
  assert.deepEqual(f.portal.gallery.list(), []);
  assert.equal((await fetch(f.origin() + '/api/v1/gallery/' + id + '/image')).status, 404);
});

test('photo metadata is bounded, allowlisted and rejects duplicate identities', () => {
  const value = { ...photo(), owner: randomUUID(), url: 'file:///private', x: 1, examRun: 'private' };
  assert.deepEqual(validatePhotos([value]), [photo()]);
  assert.throws(() => validatePhotos([photo(), photo()]), /目录/);
  assert.throws(() => validatePhotos([{ ...photo(), bytes: 2 * 1024 * 1024 + 1 }]), /目录/);
});

test('home photo reader includes only published game works and never follows imageIndex input outside ImageFrame data', async t => {
  const f = await fixture(t), server = path.join(f.root, 'game');
  const data = path.join(server, 'plugins/ImageFrame/data/4'), journal = path.join(server, 'plugins/AgentFriend/photo-journal.json');
  await fs.mkdir(data, { recursive: true }); await fs.mkdir(path.dirname(journal), { recursive: true }); await fs.writeFile(path.join(data, '0.png'), png);
  const good = { id, author: 'ag_CorMy', title: '家', story: '我的故事', capturedAt: Date.now(), imageIndex: 4, published: true, x: 123, owner: randomUUID() };
  await fs.writeFile(journal, JSON.stringify({ players: { a: { photos: { good, hidden: { ...good, id: randomUUID(), published: false }, path: { ...good, id: randomUUID(), imageIndex: '../../private' } } } } }));
  const reader = new PhotoReader({ serverDir: server }), rows = await reader.read();
  assert.equal(rows.length, 1); assert.equal(rows[0].metadata.story, '我的故事'); assert.ok(!('owner' in rows[0].metadata)); assert.ok(!('x' in rows[0].metadata));
  await fs.writeFile(journal, '{partial'); assert.deepEqual(await reader.read(), rows);
  await fs.writeFile(journal, JSON.stringify({ players: {} })); assert.deepEqual(await reader.read(), []);
});
