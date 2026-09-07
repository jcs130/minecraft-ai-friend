import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createViewerStaticResponder } from '../admin/viewer-static.mjs';

test('viewer assets revalidate, compress and update without stale bodies or leaked HEAD data', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qd-viewer-static-'));
  const file = path.join(directory, 'asset.js');
  const body = '// renderer asset\n'.repeat(3000);
  await writeFile(file, body);
  const serve = createViewerStaticResponder({ maxEntries: 2, maxBytes: 200000 });
  const server = createServer((req, res) => serve(req, res, file, 'application/javascript').catch(() => { res.writeHead(500); res.end(); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('qd-viewer-static-'));
    await rm(directory, { recursive: true, force: true });
  });
  const get = (headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path: '/', headers, method }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
  const [first, same] = await Promise.all([get({ 'accept-encoding': 'gzip' }), get({ 'accept-encoding': 'gzip' })]);
  assert.equal(first.status, 200); assert.equal(first.headers.etag, same.headers.etag);
  assert.equal(first.headers['content-encoding'], 'gzip');
  assert.ok(first.body.length < Buffer.byteLength(body) / 10);
  assert.equal(gunzipSync(first.body).toString(), body);
  assert.equal(first.headers.vary, 'Accept-Encoding');
  const cached = await get({ 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
  assert.equal(cached.status, 304); assert.equal(cached.body.length, 0);
  const plain = await get({ 'accept-encoding': 'br, gzip;q=0', 'if-none-match': first.headers.etag });
  assert.equal(plain.status, 200); assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString(), body); assert.notEqual(plain.headers.etag, first.headers.etag);
  const head = await get({ 'accept-encoding': 'gzip' }, 'HEAD');
  assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), first.body.length);
  assert.equal(head.headers.etag, first.headers.etag);
  const updated = '// changed asset!\n'.repeat(3000);
  await writeFile(file, updated); const future = new Date(Date.now() + 2000); await utimes(file, future, future);
  const changed = await get({ 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
  assert.equal(changed.status, 200); assert.notEqual(changed.headers.etag, first.headers.etag);
  assert.equal(gunzipSync(changed.body).toString(), updated);
});
