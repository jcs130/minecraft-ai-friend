import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { musicFixture, wav, metadata, descriptor } from './music-fixtures.mjs';
import { siteFixture } from './helpers.mjs';
import { uploadFromFiles } from '../scripts/upload-music.mjs';
import { newSecret, digest } from '../src/store.mjs';
import { offlineUuid, seal } from '../src/game-accounts.mjs';
import { createMusicObjectStorage } from '../src/music-object-storage.mjs';
import { uploadMusic } from '../public/music-client.mjs';

async function ready(f, patch = {}) {
  const created = (await f.api('', 'POST', { ...metadata, ...patch, requestId: randomUUID() })).data;
  const bytes = wav(), prepared = (await f.api('/' + created.id + '/audio', 'POST', { ...descriptor(bytes), requestId: randomUUID() })).data;
  assert.equal((await fetch(prepared.upload.uploadUrl, { method: 'PUT', headers: prepared.upload.headers, body: bytes })).status, 200);
  const result = await f.api('/' + created.id + '/complete', 'POST', { uploadId: prepared.uploadId });
  assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
}

test('music is opt-in; disabled instances keep existing image contract and schema', async t => {
  const f = await siteFixture(t);
  assert.equal((await fetch(f.origin + '/api/v1/music/capabilities').then(r => r.json())).enabled, false);
  assert.equal((await fetch(f.origin + '/api/v1/music')).status, 503);
  assert.equal(f.portal.store.db.prepare("SELECT name FROM sqlite_master WHERE name='music_works'").get(), undefined);
});

test('draft, direct upload, actual byte verification, private preview, explicit publication and Range seek', async t => {
  const f = await musicFixture(t), work = await ready(f);
  assert.equal(work.published, false); assert.equal(work.audio.durationSeconds, 1);
  assert.equal((await fetch(f.origin + '/api/v1/music/' + work.id)).status, 404);
  assert.equal((await fetch(f.origin + '/api/v1/music/' + work.id + '/audio')).status, 404);
  const privateAudio = await f.api('/' + work.id + '/audio'); assert.equal(privateAudio.status, 307);
  assert.equal(privateAudio.response.headers.get('cache-control'), 'private, no-store');
  const published = await f.api('/' + work.id + '/publication', 'PUT', { requestId: randomUUID(), published: true, expectedRevision: work.revision });
  assert.equal(published.status, 200);
  const publicList = await fetch(f.origin + '/api/v1/music').then(r => r.json());
  assert.equal(publicList.total, 1); assert.equal(publicList.works[0].author, f.agent.name);
  assert.equal('lyrics' in publicList.works[0], false); assert.equal('uploadId' in publicList.works[0], false);
  assert.equal(JSON.stringify(publicList).includes('isolated-grant'), false);
  const full = await fetch(f.origin + '/api/v1/music/' + work.id).then(r => r.json()); assert.equal(full.lyrics, metadata.lyrics);
  const stream = await fetch(f.origin + full.audio.url, { redirect: 'manual' });
  const ranged = await fetch(stream.headers.get('location'), { headers: { Range: 'bytes=100-199' } });
  assert.equal(ranged.status, 206); assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), wav().subarray(100, 200));
  assert.ok(f.objectRequests.every(row => !row.authorization && !row.cookie));
});

test('same request is idempotent across lost responses; stale publish replay cannot undo withdrawal', async t => {
  const f = await musicFixture(t), body = { ...metadata, requestId: randomUUID() };
  const [first, second] = await Promise.all([f.api('', 'POST', body), f.api('', 'POST', body)]);
  assert.equal(first.data.id, second.data.id); assert.equal((await f.api()).data.total, 1);
  const changed = await f.api('', 'POST', { ...body, title: 'another title' }); assert.equal(changed.status, 409); assert.ok(changed.data.error.nextAction);
  const draft = first.data;
  assert.equal((await f.api('/' + draft.id + '/publication', 'PUT', { requestId: randomUUID(), published: true, expectedRevision: draft.revision })).data.error.reason, 'MUSIC_NOT_READY');
  const work = await ready(f), publication = { requestId: randomUUID(), published: true, expectedRevision: work.revision };
  const pub = (await f.api('/' + work.id + '/publication', 'PUT', publication)).data;
  const withdrawal = await f.api('/' + work.id + '/publication', 'PUT', { requestId: randomUUID(), published: false, expectedRevision: pub.revision }); assert.equal(withdrawal.status, 200);
  const replay = await f.api('/' + work.id + '/publication', 'PUT', publication);
  assert.equal(replay.data.published, false); assert.equal(replay.data.replayed, true);
  assert.equal((await fetch(f.origin + '/api/v1/music/' + work.id + '/audio')).status, 404);
  assert.equal((await f.api('/' + work.id + '/publication', 'PUT', { ...publication, requestId: randomUUID() })).data.error.reason, 'MUSIC_REVISION');
});

test('CSRF, explicit PAT scope, current ownership, expired/revoked credentials and role selection', async t => {
  const f = await musicFixture(t), route = '/self/music?agentId=' + f.agent.id, body = { ...metadata, requestId: randomUUID() };
  assert.equal((await f.admin.request(route, 'POST', body, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await f.admin.request(route, 'POST', body)).status, 201);
  assert.equal((await f.admin.request('/self/music')).data.error.reason, 'MUSIC_ROLE_REQUIRED');
  const read = (await f.admin.request('/client-credentials', 'POST', { label: 'read only', agentId: f.agent.id, scopes: ['state.read', 'photos.write'] })).data.token;
  assert.equal((await f.api('', 'POST', { ...body, requestId: randomUUID() }, read)).status, 403);
  const credential = f.portal.store.db.prepare('SELECT id FROM credentials WHERE scopes LIKE ?').get('%music.write%');
  f.portal.store.db.prepare('UPDATE credentials SET expires_at=? WHERE id=?').run(Date.now() - 1, credential.id);
  assert.equal((await f.api()).status, 401);
  f.portal.store.db.prepare('UPDATE credentials SET expires_at=?,revoked_at=? WHERE id=?').run(Date.now() + 60000, Date.now(), credential.id);
  assert.equal((await f.api()).status, 401);
  f.portal.store.db.prepare('UPDATE credentials SET revoked_at=NULL WHERE id=?').run(credential.id);
  f.portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(f.uuid);
  assert.equal((await f.api()).data.error.reason, 'MUSIC_OWNER_REQUIRED');
});

test('actual SHA, MIME, unsupported content and missing upload are rejected; keys cannot poison photo assets', async t => {
  const f = await musicFixture(t);
  for (const mode of ['missing', 'hash', 'mime', 'malformed']) {
    const bytes = mode === 'malformed' ? Buffer.alloc(128, 3) : wav();
    const created = (await f.api('', 'POST', { ...metadata, requestId: randomUUID() })).data;
    const prepared = (await f.api('/' + created.id + '/audio', 'POST', { ...descriptor(bytes, mode === 'mime' ? 'audio/mpeg' : 'audio/wav'), requestId: randomUUID() })).data;
    const binding = JSON.parse(f.portal.store.db.prepare('SELECT binding FROM music_works WHERE id=?').get(created.id).binding);
    assert.notEqual(binding.objectId, descriptor(bytes).sha256);
    if (mode !== 'missing') {
      await fetch(prepared.upload.uploadUrl, { method: 'PUT', headers: prepared.upload.headers, body: bytes });
      if (mode === 'hash') f.files.get(binding.objectId).bytes[100] ^= 1;
    }
    const finished = await f.api('/' + created.id + '/complete', 'POST', { uploadId: prepared.uploadId });
    assert.equal(finished.status, mode === 'missing' ? 409 : 422, JSON.stringify(finished.data));
    const current = (await f.api('/' + created.id)).data;
    assert.notEqual(current.state, 'ready'); assert.equal(current.published, false);
  }
});

test('Node client upload example persists private receipts, resumes unknown PUT and never widens image auth', async t => {
  const f = await musicFixture(t), dir = path.join(f.root, 'client-private'); await fs.mkdir(dir);
  const tokenFile = path.join(dir, 'token.txt'), audioFile = path.join(dir, 'audio.wav'), manifestFile = path.join(dir, 'work.json'), receiptFile = path.join(dir, 'receipt.json');
  await fs.writeFile(tokenFile, f.token); await fs.writeFile(audioFile, wav());
  await fs.writeFile(manifestFile, JSON.stringify({ origin: f.origin, metadata, audioFile, mime: 'audio/wav', publish: true }));
  const first = await uploadFromFiles({ tokenFile, manifestFile, receiptFile }), second = await uploadFromFiles({ tokenFile, manifestFile, receiptFile });
  assert.equal(first.id, second.id); assert.equal(first.published, true); assert.equal((await f.api()).data.total, 1);
  const receipt = await fs.readFile(receiptFile, 'utf8'); assert.ok(!receipt.includes(f.token)); assert.ok(!receipt.includes('isolated-grant')); assert.ok(!receipt.includes(metadata.lyrics));
});

test('all advertised audio codecs are verified from real encoded synthetic fixtures', async t => {
  const f = await musicFixture(t), samples = JSON.parse(await fs.readFile(new URL('fixtures/music-audio.json', import.meta.url), 'utf8')).samples;
  for (const sample of samples) {
    const bytes = Buffer.from(sample.base64, 'base64'), work = (await f.api('', 'POST', { ...metadata, requestId: randomUUID(), title: 'codec ' + sample.extension })).data;
    const prepared = (await f.api('/' + work.id + '/audio', 'POST', { ...descriptor(bytes, sample.mime), requestId: randomUUID() })).data;
    await fetch(prepared.upload.uploadUrl, { method: 'PUT', headers: prepared.upload.headers, body: bytes });
    const completed = await f.api('/' + work.id + '/complete', 'POST', { uploadId: prepared.uploadId });
    assert.equal(completed.status, 200, JSON.stringify(completed.data)); assert.equal(completed.data.audio.mime, sample.mime); assert.ok(completed.data.audio.durationSeconds > 0);
  }
});

test('existing qda identity publishes only its own canonical role without a new credential', async t => {
  const f = await musicFixture(t), key = randomBytes(32), dir = path.join(f.root, 'bridge'), keyFile = path.join(f.root, 'bridge.key');
  await fs.mkdir(path.join(dir, 'results'), { recursive: true }); await fs.writeFile(keyFile, key.toString('hex')); Object.assign(f.config.authBridge, { enabled: true, directory: dir, keyFile });
  await fs.writeFile(path.join(dir, 'heartbeat.json'), seal(key, 'heartbeat', { ready: true, at: Date.now() }));
  const invite = (await f.admin.request('/admin/trial-invites', 'POST', { requestId: randomUUID(), clientSecret: newSecret(), count: 1 })).data.invites[0];
  const credentials = { requestId: randomUUID(), username: 'ag_MusicQA', clientSecret: newSecret() };
  const access = async (route, token, body) => { const response = await fetch(f.origin + '/api/v1/agent-access/' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; };
  assert.equal((await access('register', invite.token, credentials)).status, 201);
  const session = await access('sessions', 'none', { clientId: credentials.requestId, clientSecret: credentials.clientSecret }); assert.equal(session.status, 200);
  const token = session.data.token, job = randomUUID(), uuid = offlineUuid(credentials.username);
  assert.equal((await access('activate', token, { requestId: job, gamePassword: 'isolated-music-password' })).status, 202);
  await fs.writeFile(path.join(dir, 'results', job + '.json'), seal(key, 'result:' + job, { requestId: job, username: credentials.username, playerUuid: uuid, state: 'succeeded' }));
  assert.equal((await access('status', token)).data.state, 'ready');
  f.game.roster = async () => [f.agent, { ...f.agent, id: digest(uuid).slice(0, 24), name: credentials.username, playerUuid: uuid }];
  const work = await f.api('', 'POST', { ...metadata, requestId: randomUUID(), author: 'Goddess', authorUuid: f.uuid }, token);
  assert.equal(work.status, 201); assert.equal(work.data.author, credentials.username);
  const foreign = await ready(f);
  for (const suffix of ['', '/audio']) assert.equal((await f.api('/' + foreign.id + suffix, 'GET', undefined, token)).status, 404);
  f.portal.store.db.prepare('UPDATE agent_access_sessions SET revoked_at=? WHERE client_id=?').run(Date.now(), credentials.requestId);
  assert.equal((await f.api('', 'GET', undefined, token)).status, 401);
});

test('ownership is rechecked after a delayed verification; new owner cannot be bypassed', async t => {
  const f = await musicFixture(t), bytes = wav(), work = (await f.api('', 'POST', { ...metadata, requestId: randomUUID() })).data;
  const prepared = (await f.api('/' + work.id + '/audio', 'POST', { ...descriptor(bytes), requestId: randomUUID() })).data;
  await fetch(prepared.upload.uploadUrl, { method: 'PUT', headers: prepared.upload.headers, body: bytes });
  let release, started; const block = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; }), open = f.objects.open;
  f.objects.open = async (...args) => { started(); await block; return open(...args); };
  const completing = f.api('/' + work.id + '/complete', 'POST', { uploadId: prepared.uploadId }); await entered;
  f.portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(f.uuid); release();
  assert.equal((await completing).status, 403); assert.equal(f.portal.store.db.prepare('SELECT state FROM music_works WHERE id=?').get(work.id).state, 'uploading');
});

test('lost PUT response resumes the same work and completed upload; audio credentials never leave the app', async t => {
  const f = await musicFixture(t), state = {}, bytes = wav(); let lose = true;
  const api = async (...args) => { const result = await f.api(...args); if (result.status >= 400) throw Error(result.data.error.reason); return result.data; };
  const options = { api, state, save: async () => {}, metadata, descriptor: descriptor(bytes), audio: bytes, allowLoopback: true,
    put: async (...args) => { assert.equal(args[1].headers.Authorization, undefined); const response = await fetch(...args); if (lose) { lose = false; throw Error('isolated lost response'); } return response; } };
  await assert.rejects(uploadMusic(options), /未确认完成/); const id = state.workId;
  const resumed = await uploadMusic(options); assert.equal(resumed.id, id); assert.equal(resumed.state, 'ready'); assert.equal((await f.api()).data.total, 1);
  const replay = await f.api('/' + id + '/complete', 'POST', { uploadId: state.uploadId }); assert.equal(replay.data.replayed, true);
});

test('OSS adapter uses existing prefix, temporary credential factory, immutable uploads and long playback TTL', async () => {
  const calls = [], client = { asyncSignatureUrl: async (key, options) => { calls.push({ key, options }); return 'https://isolated.invalid/audio'; }, head: async () => ({ res: { headers: { 'content-length': '100', 'x-oss-meta-sha256': 'f'.repeat(64), etag: 'etag' } } }), getStream: async (key, options) => { calls.push({ key, options }); return { stream: 'fixture-stream' }; } };
  const objects = createMusicObjectStorage({ enabled: true, bucket: 'isolated-bucket', region: 'oss-cn-hongkong', roleName: 'existing-role', prefix: 'photo-scenes/' }, { clientFactory: () => client });
  const binding = { objectId: 'a'.repeat(64), sha256: 'f'.repeat(64), mime: 'audio/mpeg', extension: 'mp3' };
  const lease = await objects.prepare(binding); assert.equal(lease.headers['x-oss-object-acl'], 'private'); assert.equal(lease.headers['x-oss-forbid-overwrite'], 'true'); assert.equal(calls.at(-1).options.expires, 300);
  assert.match(calls.at(-1).key, /^photo-scenes\/assets\/[a-f0-9]{64}$/); assert.equal((await objects.head(binding)).bytes, 100);
  await objects.open(binding, 'etag'); assert.equal(calls.at(-1).options.headers['If-Match'], 'etag');
  await objects.playback(binding); assert.equal(calls.at(-1).options.expires, 3600); assert.equal(calls.at(-1).options.response['content-type'], 'audio/mpeg'); assert.match(calls.at(-1).options.response['content-disposition'], /^inline/);
  await assert.rejects(objects.prepare({ ...binding, objectId: '../outside' }), /MUSIC_OBJECT_KEY/);
});
