import http from 'node:http';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { siteFixture } from './helpers.mjs';

// Actual one-second PCM audio, generated locally; not a vocal song or real
// adopted client material. No production account or OSS is accessed.
export function wav(seconds = 1) {
  const rate = 8000, samples = rate * seconds, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 1000), 44 + i * 2);
  return data;
}
export const descriptor = (bytes, mime = 'audio/wav') => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime });
export const metadata = { title: '隔离验证音轨', lyrics: '这是隔离测试，不是正式歌曲。\n<script>test()</script>', lyricsFormat: 'plain', aiGenerated: true, hasVocals: false, sourceTrackId: 'isolated-audio' };

export async function musicFixture(t) {
  const files = new Map(), requests = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-oss-object-acl,x-oss-forbid-overwrite,x-oss-meta-sha256,range');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://localhost'), id = url.pathname.slice(1);
    requests.push({ method: req.method, authorization: req.headers.authorization, cookie: req.headers.cookie, range: req.headers.range });
    if (!/^[a-f0-9]{64}$/.test(id) || url.searchParams.get('grant') !== 'isolated-grant') { res.writeHead(403); res.end(); return; }
    if (req.method === 'PUT') {
      if (files.has(id)) { res.writeHead(409); res.end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      files.set(id, { bytes: Buffer.concat(chunks), sha256: req.headers['x-oss-meta-sha256'], mime: req.headers['content-type'] });
      res.writeHead(200); res.end(); return;
    }
    const file = files.get(id);
    if (!file) { res.writeHead(404); res.end(); return; }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : file.bytes.length - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${file.bytes.length}`, 'Content-Type': file.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' }); res.end(file.bytes.subarray(start, end + 1));
    } else { res.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.bytes.length, 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' }); res.end(file.bytes); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const objects = {
    origin,
    prepare: async b => ({ uploadUrl: origin + '/' + b.objectId + '?grant=isolated-grant', headers: { 'Content-Type': b.mime, 'x-oss-meta-sha256': b.sha256, 'x-oss-object-acl': 'private', 'x-oss-forbid-overwrite': 'true' }, expiresInSeconds: 300 }),
    head: async b => { const file = files.get(b.objectId); return file ? { bytes: file.bytes.length, sha256: file.sha256, etag: 'isolated-etag' } : null; },
    open: async b => Readable.from(files.get(b.objectId).bytes),
    playback: async b => origin + '/' + b.objectId + '?grant=isolated-grant',
  };
  const f = await siteFixture(t, { music: { enabled: true }, sceneStorage: { enabled: true, bucket: 'isolated-bucket', region: 'oss-cn-hongkong', roleName: 'isolated-role', prefix: 'photo-scenes/' } }, { musicObjects: objects });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); });
  const owner = f.portal.store.ownerByName('fixture-admin');
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, f.uuid, 'isolated music role', Date.now());
  const token = (await f.admin.request('/client-credentials', 'POST', { label: 'isolated music', agentId: f.agent.id, scopes: ['state.read', 'music.write'] })).data.token;
  const api = async (route = '', method = 'GET', body, authority = token) => {
    const response = await fetch(f.origin + '/api/v1/self/music' + route, { method, headers: { Authorization: 'Bearer ' + authority, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : null, response };
  };
  return { ...f, owner, token, api, objects, files, objectRequests: requests, objectOrigin: origin };
}
