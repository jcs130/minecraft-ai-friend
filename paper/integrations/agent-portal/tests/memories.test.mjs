import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { siteFixture, jpegFixture as minimalJpeg, testPassword } from './helpers.mjs';
import { Store, newSecret } from '../src/store.mjs';
import { Memories } from '../src/memories.mjs';
import { offlineUuid } from '../src/game-accounts.mjs';
import { projectRoot } from '../src/config.mjs';

const metadata = (extra = {}) => ({ requestId: randomUUID(), title: '并肩应战', story: '可米和小鱼一起面对怪物。只记录这一刻，不推断战果。', participants: ['ag_CorMy', 'LittleFish0510'], credit: '玩家分享', redrawType: 'ai', ...extra });
// The live-ingress fixture is only 23 bytes. Include a padding byte so it
// meets the reusable static-image header validator's minimum of 24 bytes.
const jpegFixture = (...args) => { const bytes = minimalJpeg(...args); return Buffer.concat([bytes.subarray(0, -2), Buffer.from([0]), bytes.subarray(-2)]); };
async function draft(f, client = f.admin, body = metadata()) {
  const result = await client.request('/memories', 'POST', body);
  assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
}
async function images(f, post, client = f.admin) {
  for (const kind of ['original', 'redraw']) {
    const response = await client.binary('/memories/' + post.id + '/images/' + kind, 'PUT', jpegFixture(1280, 720), 'image/jpeg');
    assert.equal(response.status, 200, await response.clone().text()); post = await response.json();
  }
  return post;
}
async function published(f, client = f.admin, body) {
  const post = await images(f, await draft(f, client, body), client);
  const result = await client.request('/memories/' + post.id + '/publish', 'POST', { confirmPublic: true, revision: post.revision });
  assert.equal(result.status, 200); return result.data;
}

test('a new memory is a private draft and does not replace game photography or publish images', async t => {
  const f = await siteFixture(t), post = await images(f, await draft(f));
  assert.equal(post.state, 'draft'); assert.equal(post.publishedAt, null);
  assert.equal((await (await fetch(f.origin + '/api/v1/memories')).json()).total, 0);
  assert.equal((await fetch(f.origin + '/api/v1/memories/' + post.id)).status, 404);
  assert.equal((await fetch(f.origin + post.images.original.url)).status, 404);
  assert.equal((await f.admin.request('/memories/mine')).data.items.length, 1);
  assert.equal((await f.admin.request('/gallery')).data.photos.length, 0);
});

test('publication requires two images, explicit public consent and the exact preview revision', async t => {
  const f = await siteFixture(t), first = await draft(f), endpoint = '/memories/' + first.id + '/publish';
  assert.equal((await f.admin.request(endpoint, 'POST', { revision: first.revision })).data.error.reason, 'MEMORY_CONFIRM_PUBLIC');
  assert.equal((await f.admin.request(endpoint, 'POST', { revision: first.revision, confirmPublic: true })).data.error.reason, 'MEMORY_IMAGES_REQUIRED');
  const ready = await images(f, first);
  assert.equal((await f.admin.request(endpoint, 'POST', { revision: first.revision, confirmPublic: true })).data.error.reason, 'MEMORY_REVISION');
  const result = await f.admin.request(endpoint, 'POST', { revision: ready.revision, confirmPublic: true });
  assert.equal(result.data.state, 'public');
  const again = await f.admin.request(endpoint, 'POST', { revision: ready.revision, confirmPublic: true });
  assert.equal(again.data.revision, result.data.revision); assert.equal(again.data.publishedAt, result.data.publishedAt);
});

test('public original and redraw preserve their bytes, labels and authorship without leaking private owner IDs', async t => {
  const f = await siteFixture(t), post = await published(f);
  const detail = await (await fetch(f.origin + '/api/v1/memories/' + post.id)).json();
  assert.equal(detail.originalLabel, '游戏原图'); assert.equal(detail.redrawLabel, 'AI重绘');
  assert.deepEqual(detail.participants, ['ag_CorMy', 'LittleFish0510']); assert.equal(detail.canManage, false);
  assert.equal(detail.participantSource, 'author-provided'); assert.equal(detail.happenedAt, null);
  assert.equal(detail.credit, '玩家分享');
  assert.ok(!JSON.stringify(detail).includes(f.portal.store.ownerByName('fixture-admin').id));
  assert.ok(!('owner_id' in detail)); assert.ok(!('actor_uuid' in detail));
  for (const kind of ['original', 'redraw']) {
    const response = await fetch(f.origin + detail.images[kind].url);
    assert.equal(response.headers.get('content-type'), 'image/jpeg'); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpegFixture(1280, 720));
    const head = await fetch(f.origin + detail.images[kind].url, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
});

test('request IDs make a lost creation response recoverable and reject conflicting content', async t => {
  const f = await siteFixture(t), body = metadata();
  const first = await draft(f, f.admin, body);
  const second = await f.admin.request('/memories', 'POST', body);
  assert.equal(second.status, 200); assert.equal(second.data.id, first.id); assert.equal(second.data.duplicate, true);
  assert.equal((await f.admin.request('/memories', 'POST', { ...body, title: '不同稿件' })).data.error.reason, 'MEMORY_REQUEST_CONFLICT');
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM memory_posts').get().n, 1);
});

test('another account and a named participant cannot inspect, edit or publish a private draft', async t => {
  const f = await siteFixture(t), post = await draft(f), other = f.client(); await other.init();
  await other.request('/accounts', 'POST', { username: 'LittleFish0510', password: testPassword });
  assert.equal((await other.request('/memories/mine')).data.total, 0);
  for (const [suffix, method, body] of [['', 'GET'], ['', 'PUT', metadata({ revision: post.revision })], ['/publish', 'POST', { confirmPublic: true, revision: post.revision }], ['/withdraw', 'POST', {}]]) {
    assert.equal((await other.request('/memories/' + post.id + suffix, method, body)).status, 404);
  }
  assert.equal((await other.binary('/memories/' + post.id + '/images/redraw', 'PUT', jpegFixture(), 'image/jpeg')).status, 404);
});

test('published images cannot silently change, and withdrawal hides new image and story requests without deleting the archive', async t => {
  const f = await siteFixture(t), post = await published(f), endpoint = '/memories/' + post.id;
  assert.equal((await f.admin.request(endpoint, 'PUT', metadata({ revision: post.revision }))).data.error.reason, 'MEMORY_WITHDRAW_FIRST');
  assert.equal((await f.admin.binary(endpoint + '/images/redraw', 'PUT', jpegFixture(), 'image/jpeg')).status, 409);
  const result = await f.admin.request(endpoint + '/withdraw', 'POST', {}); assert.equal(result.data.state, 'draft');
  assert.equal((await fetch(f.origin + '/api/v1' + endpoint)).status, 404);
  assert.equal((await fetch(f.origin + post.images.redraw.url)).status, 404);
  assert.equal((await f.admin.request('/memories')).data.total, 0);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM memory_images WHERE post_id=?').get(post.id).n, 2);
});

test('invalid metadata, impossible dates, forged types and oversized images are rejected', async t => {
  const f = await siteFixture(t);
  for (const changes of [{ title: '' }, { title: 'x'.repeat(101) }, { story: 'x'.repeat(4001) }, { participants: ['../../secret'] }, { participants: Array(9).fill('ag_Many') }, { happenedAt: '2026-02-30' }, { requestId: 'bad-id' }]) {
    assert.equal((await f.admin.request('/memories', 'POST', metadata(changes))).status, 400);
  }
  const post = await draft(f);
  const put = (bytes, type) => f.admin.binary('/memories/' + post.id + '/images/original', 'PUT', bytes, type);
  assert.equal((await put(Buffer.from('<svg><script>bad()</script></svg>'), 'image/svg+xml')).status, 400);
  assert.equal((await put(jpegFixture(), 'image/png')).status, 415);
  assert.equal((await put(jpegFixture(6000, 720), 'image/jpeg')).status, 400);
  assert.equal((await put(Buffer.alloc(4 * 1024 * 1024 + 1), 'image/jpeg')).status, 413);
});

test('stale edits are refused and an identical image upload is idempotent', async t => {
  const f = await siteFixture(t), post = await images(f, await draft(f));
  const response = await f.admin.binary('/memories/' + post.id + '/images/redraw', 'PUT', jpegFixture(1280, 720), 'image/jpeg');
  assert.equal((await response.json()).revision, post.revision);
  const edit = await f.admin.request('/memories/' + post.id, 'PUT', metadata({ title: '新的题目', revision: post.revision }));
  assert.equal(edit.status, 200);
  assert.equal((await f.admin.request('/memories/' + post.id, 'PUT', metadata({ revision: post.revision }))).data.error.reason, 'MEMORY_REVISION');
});

test('public pagination and participant filters exclude drafts and do not duplicate records', async t => {
  const f = await siteFixture(t), owner = f.portal.store.ownerByName('fixture-admin'), context = { owner };
  for (let i = 0; i < 15; i++) {
    const post = f.portal.memories.create(context, metadata({ title: '回忆 ' + i, participants: i % 2 ? ['ag_CorMy'] : ['LittleFish0510'] }));
    for (const kind of ['original', 'redraw']) f.portal.memories.upload(post.id, kind, context, jpegFixture(), 'image/jpeg');
    if (i < 14) f.portal.memories.publish(post.id, context, { confirmPublic: true, revision: f.portal.memories.detail(post.id, context).revision });
  }
  const first = (await f.admin.request('/memories')).data, second = (await f.admin.request('/memories?offset=12')).data;
  assert.equal(first.total, 14); assert.equal(first.items.length, 12); assert.equal(first.nextOffset, 12);
  assert.equal(second.items.length, 2); assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 14);
  const filtered = (await f.admin.request('/memories?participant=ag_cormy')).data;
  assert.equal(filtered.total, 7); assert.ok(filtered.items.every(row => row.participants.includes('ag_CorMy')));
  assert.equal((await f.admin.request('/memories?offset=-1')).status, 400);
});

test('the database retains original bytes, drafts and publication history across a fresh store process', async t => {
  const root = path.join(projectRoot, '.local', 'tests', 'memory-persist-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  let store = new Store(root), service = new Memories(store);
  const owner = store.createOwner('memory-owner', 'not-a-real-password-hash');
  const context = { owner }, first = service.create(context, metadata());
  service.upload(first.id, 'original', context, jpegFixture(), 'image/jpeg'); store.close();
  store = new Store(root); service = new Memories(store);
  assert.equal(service.detail(first.id, context).state, 'draft');
  assert.deepEqual(service.image(first.id, 'original', context).bytes, jpegFixture());
  assert.equal(store.db.prepare('pragma integrity_check').get().integrity_check, 'ok'); store.close();
  t.after(async () => { assert.ok(root.startsWith(path.join(projectRoot, '.local', 'tests') + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
});

test('browser writes require same-origin CSRF and a browser session, never a read-only PAT', async t => {
  const f = await siteFixture(t), post = await draft(f);
  assert.equal((await fetch(f.origin + '/api/v1/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata()) })).status, 403);
  assert.equal((await f.admin.request('/memories', 'POST', metadata(), { Authorization: 'Bearer pat_' + newSecret() })).status, 403);
  assert.equal((await f.admin.request('/memories/' + post.id + '/withdraw', 'POST', {}, { Origin: 'https://unrelated.example' })).status, 403);
});

async function machine(f, endpoint, token, method = 'GET', body, extra = {}) {
  const response = await fetch(f.origin + '/api/v1/agent-access/memories' + endpoint, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
async function actor(f, name) {
  const owner = f.portal.store.ownerByName('fixture-admin');
  const invite = f.portal.agentAccess.issue(owner, { label: 'isolated memory API', username: name }), clientSecret = newSecret(), clientId = randomUUID();
  await f.portal.agentAccess.register(invite.token, { requestId: clientId, username: name, clientSecret });
  const token = f.portal.agentAccess.login({ clientId, clientSecret }).token;
  // Explicit isolated game-bridge receipt. No real account is created.
  const jobId = randomUUID(), uuid = offlineUuid(name);
  f.portal.store.db.prepare('INSERT INTO account_jobs VALUES(?,?,?,?,?,?,?,?,?)').run(jobId, owner.id, 'create', name, 'succeeded', '{}', Date.now(), Date.now() + 3600000, uuid);
  f.portal.store.db.prepare('UPDATE agent_clients SET game_request_id=? WHERE id=?').run(jobId, clientId);
  f.portal.accounts.job = async () => ({ id: jobId, state: 'succeeded' });
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, uuid, 'isolated-receipt', Date.now());
  return { token, name, uuid, clientId };
}

test('an Agent submits only as its verified game identity, ignoring forged body authors and owner IDs', async t => {
  const f = await siteFixture(t), one = await actor(f, 'ag_Writer'), two = await actor(f, 'ag_Other');
  f.game.roster = async () => [one, two].map(row => ({ name: row.name, playerUuid: row.uuid, kind: 'agent' }));
  const result = await machine(f, '', one.token, 'POST', metadata({ publisher: 'Goddess', actor_uuid: two.uuid, owner_id: 'forged' }));
  assert.equal(result.status, 201); assert.equal(result.data.publisher, 'ag_Writer');
  assert.equal((await machine(f, '/mine', one.token)).data.items.length, 1);
  assert.equal((await machine(f, '/mine', two.token)).data.items.length, 0);
  assert.equal((await machine(f, '/' + result.data.id, two.token)).status, 404);
  assert.equal((await machine(f, '/' + result.data.id + '/withdraw', two.token, 'POST', {})).status, 404);
  assert.equal((await machine(f, '/mine', one.token, 'GET', undefined, { Cookie: 'browser=1' })).status, 403);
  assert.equal((await machine(f, '', one.token, 'GET', undefined, { Origin: f.origin })).status, 403);
  f.portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(one.uuid);
  assert.equal((await machine(f, '/mine', one.token)).data.error.reason, 'AGENT_IDENTITY_UNCONFIRMED');
});

test('uncreated or revoked Agent API sessions cannot submit memories or fall through to owner APIs', async t => {
  const f = await siteFixture(t), one = await actor(f, 'ag_Blocked');
  f.portal.store.db.prepare('UPDATE agent_clients SET game_request_id=NULL WHERE id=?').run(one.clientId);
  assert.equal((await machine(f, '', one.token, 'POST', metadata())).data.error.reason, 'GAME_ACCOUNT_NOT_READY');
  f.portal.store.db.prepare('UPDATE agent_clients SET revoked_at=? WHERE id=?').run(Date.now(), one.clientId);
  assert.equal((await machine(f, '/mine', one.token)).status, 401);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM memory_posts').get().n, 0);
});

test('the Agent API completes upload, authenticated draft preview, public publication and withdrawal using one request identity', async t => {
  const f = await siteFixture(t), one = await actor(f, 'ag_Artist');
  f.game.roster = async () => [{ name: one.name, playerUuid: one.uuid, kind: 'agent' }];
  let post = (await machine(f, '', one.token, 'POST', metadata())).data;
  for (const kind of ['original', 'redraw']) {
    const response = await fetch(f.origin + '/api/v1/agent-access/memories/' + post.id + '/images/' + kind, { method: 'PUT', headers: { Authorization: 'Bearer ' + one.token, 'Content-Type': 'image/jpeg' }, body: jpegFixture() });
    assert.equal(response.status, 200); post = await response.json();
  }
  assert.ok(post.images.original.url.startsWith('/api/v1/agent-access/memories/'));
  const preview = await fetch(f.origin + post.images.original.url, { headers: { Authorization: 'Bearer ' + one.token } });
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), jpegFixture());
  const result = await machine(f, '/' + post.id + '/publish', one.token, 'POST', { confirmPublic: true, revision: post.revision });
  assert.equal(result.data.state, 'public');
  assert.equal((await (await fetch(f.origin + '/api/v1/memories/' + post.id)).json()).publisher, one.name);
  assert.equal((await machine(f, '/' + post.id + '/withdraw', one.token, 'POST', {})).data.state, 'draft');
  assert.equal((await fetch(f.origin + '/api/v1/memories/' + post.id)).status, 404);
});
