import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPortal } from '../src/server.mjs';
import { loadConfig, projectRoot } from '../src/config.mjs';
import { publicMedia } from '../src/public-media.mjs';
import reviewedMedia from '../src/public-media-assets.json' with { type: 'json' };

test('promotional media configuration is an allowlist, never a remote fetch or private file path', () => {
  assert.deepEqual(publicMedia({ publicMedia: { video: 'https://private/intro.mp4', poster: '../portal.sqlite', character: '/etc/key.png' } }), {});
  assert.deepEqual(publicMedia({ publicMedia: { video: 'intro-v5.mp4', poster: 'intro.jpg', portrait: 'cormy-standing.png', credit: '可米' } }), { video: '/media/intro-v5.mp4', poster: '/media/intro.jpg', portrait: '/media/cormy-standing.png', credit: '可米' });
});

test('external promotional links accept only HTTPS Bilibili video pages and short links without credentials or tracking parameters', () => {
  assert.equal(publicMedia({ publicMedia: { videoLink: 'https://b23.tv/Ppfd3Ne', videoTitle: '一起冒险' } }).videoLink, 'https://b23.tv/Ppfd3Ne');
  assert.equal(publicMedia({ publicMedia: { videoLink: 'https://www.bilibili.com/video/BV13fnW6CEzi/' } }).videoLink, 'https://www.bilibili.com/video/BV13fnW6CEzi/');
  for (const videoLink of ['javascript:alert(1)', 'http://b23.tv/Ppfd3Ne', 'https://b23.tv@internal/secret', 'https://b23.tv.evil.example/Ppfd3Ne', 'https://www.bilibili.com/redirect?url=secret', 'https://b23.tv/Ppfd3Ne#private']) assert.equal(publicMedia({ publicMedia: { videoLink } }).videoLink, undefined);
});

test('selected video streams support phone range playback and HEAD, while private and unselected files stay inaccessible', async t => {
  const base = path.resolve(projectRoot, '.local/tests'), root = path.join(base, 'media-' + randomUUID());
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  const bytes = Buffer.from('a-small-isolated-video-fixture');
  await fs.writeFile(path.join(root, 'media/intro.mp4'), bytes); await fs.writeFile(path.join(root, 'media/unselected.png'), bytes);
  const portal = createPortal(loadConfig({ skipLocalConfig: true, sourceMode: 'cloud', host: '127.0.0.1', port: 0, dataDir: root, publicMedia: { video: 'intro.mp4' } }));
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + portal.server.address().port;
  t.after(async () => { await portal.close(); assert.ok(root.startsWith(base + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const partial = await fetch(origin + '/media/intro.mp4', { headers: { Range: 'bytes=0-1' } });
  assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-type'), 'video/mp4'); assert.equal(partial.headers.get('content-range'), `bytes 0-1/${bytes.length}`); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(0, 2));
  const suffix = await fetch(origin + '/media/intro.mp4', { headers: { Range: 'bytes=-3' } }); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-3));
  const head = await fetch(origin + '/media/intro.mp4', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(bytes.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const invalid = await fetch(origin + '/media/intro.mp4', { headers: { Range: 'bytes=999-1000' } }); assert.equal(invalid.status, 416);
  assert.equal((await fetch(origin + '/media/unselected.png')).status, 404);
  assert.equal((await fetch(origin + '/media/portal.sqlite')).status, 404);
  const scene = await fetch(origin + '/assets/scenes/lantern-village.webp');
  assert.equal(scene.status, 200); assert.equal(scene.headers.get('content-type'), 'image/webp');
});

test('reviewed public media redirects GET, Range and HEAD to immutable OSS without a local video or proxy fetch', async t => {
  const base = path.resolve(projectRoot, '.local/tests'), root = path.join(base, 'media-oss-' + randomUUID());
  const video = reviewedMedia.find(row => row.filename === 'intro-v8-720-bgm.mp4');
  const portal = createPortal(loadConfig({ skipLocalConfig: true, sourceMode: 'cloud', host: '127.0.0.1', port: 0, dataDir: root,
    downloads: { baseUrl: 'https://public-assets.example/releases/' }, publicMedia: { objectStorage: true, video: video.filename } }));
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + portal.server.address().port;
  t.after(async () => { await portal.close(); assert.ok(root.startsWith(base + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  for (const options of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-31' } }]) {
    const response = await fetch(origin + '/media/' + video.filename, { ...options, redirect: 'manual' });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), 'https://public-assets.example/releases/' + video.sha256 + '/' + video.filename);
    assert.equal(response.headers.get('x-checksum-sha256'), video.sha256);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  const page = await fetch(origin + '/');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /media-src 'self' https:\/\/public-assets\.example;/);
  assert.match(csp, /script-src 'self';/); assert.match(csp, /connect-src 'self';/);
  assert.equal((await fetch(origin + '/media/' + reviewedMedia.find(row => row.filename !== video.filename).filename, { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(origin + '/media/portal.sqlite', { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(origin + '/media/https:%2f%2finternal%2fsecret.mp4', { redirect: 'manual' })).status, 404);
});

test('OSS media is explicitly enabled and cannot inject an origin or bypass HTTPS configuration', () => {
  for (const publicMedia of [{ objectStorage: 'true' }, { objectStorage: true }]) {
    assert.throws(() => loadConfig({ skipLocalConfig: true, publicMedia }), /Public media object storage/);
  }
  assert.throws(() => loadConfig({ skipLocalConfig: true, publicMedia: { objectStorage: true }, downloads: { baseUrl: 'http://untrusted.example/' } }), /HTTPS/);
  assert.throws(() => loadConfig({ skipLocalConfig: true, publicMedia: { objectStorage: true }, downloads: { baseUrl: 'https://public.example/;script-src/' } }), /HTTPS/);
});
