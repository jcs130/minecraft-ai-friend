import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { siteFixture, testPassword } from './helpers.mjs';
import { seal, unseal, offlineUuid } from '../src/game-accounts.mjs';

async function connected(t) {
  const f = await siteFixture(t), key = randomBytes(32), directory = path.join(f.root, 'bridge'), keyFile = path.join(f.root, 'bridge.key');
  await fs.mkdir(path.join(directory, 'results'), { recursive: true }); await fs.writeFile(keyFile, key.toString('hex'));
  Object.assign(f.config.authBridge, { enabled: true, directory, keyFile });
  await fs.writeFile(path.join(directory, 'heartbeat.json'), seal(key, 'heartbeat', { ready: true, at: Date.now() }));
  const result = async (id, data) => fs.writeFile(path.join(directory, 'results', id + '.json'), seal(key, 'result:' + id, { requestId: id, ...data }));
  return { ...f, key, directory, result };
}

test('encrypted local IPC authenticates ciphertext and request identity without storing plaintext game passwords', () => {
  const key = randomBytes(32), value = { password: 'not-saved-as-plaintext' }, encrypted = seal(key, 'request:one', value);
  assert.ok(!encrypted.includes(value.password)); assert.deepEqual(unseal(key, 'request:one', encrypted), value);
  assert.throws(() => unseal(key, 'request:two', encrypted)); assert.throws(() => unseal(randomBytes(32), 'request:one', encrypted));
});

test('website create waits for authenticated bridge receipt, persists stable identity, and never repeats a job', async t => {
  const f = await connected(t), id = randomUUID(), password = 'new-game-password-test';
  const created = await f.admin.request('/agents', 'POST', { username: 'ag_NewWeb', requestId: id, gamePassword: password });
  assert.equal(created.status, 202); assert.equal(created.data.state, 'pending');
  const request = await fs.readFile(path.join(f.directory, 'requests', id + '.json'), 'utf8');
  assert.ok(!request.includes(password)); assert.equal(unseal(f.key, 'request:' + id, request).username, 'ag_NewWeb');
  assert.ok(!JSON.stringify(f.portal.store.db.prepare('SELECT * FROM account_jobs').all()).includes(password));
  assert.equal(f.portal.store.ownedUuids(f.portal.store.ownerByName('fixture-admin').id).length, 0);
  const uuid = offlineUuid('ag_NewWeb');
  await f.result(id, { username: 'ag_NewWeb', state: 'succeeded', playerUuid: uuid });
  const completed = await f.admin.request('/jobs/' + id); assert.equal(completed.data.state, 'succeeded');
  assert.equal(f.portal.store.ownedUuids(f.portal.store.ownerByName('fixture-admin').id)[0], uuid);
  const repeated = await f.admin.request('/agents', 'POST', { username: 'ag_NewWeb', requestId: id, gamePassword: 'different-password' });
  assert.equal(repeated.data.state, 'succeeded'); assert.equal(await fs.readFile(path.join(f.directory, 'requests', id + '.json'), 'utf8'), request);
});

test('published game password rules match the existing server policy without imposing character-class requirements', async t => {
  const f = await connected(t), owner = f.portal.store.ownerByName('fixture-admin');
  const invalid = ['', 'short', 'a'.repeat(65), 'abc def', 'abc\tdef', 'abc\ndef', 'abc\u00a0def', '123456', '12345678', 'PASSWORD', 'QwErTy'];
  for (const gamePassword of invalid) {
    await assert.rejects(f.portal.accounts.start(owner, 'create', { username: 'ag_Policy', requestId: randomUUID(), gamePassword }), { status: 400, reason: 'INVALID_GAME_PASSWORD' });
  }
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 0, 'invalid passwords must not create a bridge job');
  const valid = ['abcdef', 'a'.repeat(64), '自主冒险角色', '654321', 'word-!'];
  for (const [index, gamePassword] of valid.entries()) {
    const requestId = randomUUID();
    const result = await f.portal.accounts.start(owner, 'create', { username: 'ag_Policy' + index, requestId, gamePassword });
    assert.equal(result.state, 'pending');
    const encrypted = await fs.readFile(path.join(f.directory, 'requests', requestId + '.json'), 'utf8');
    assert.equal(unseal(f.key, 'request:' + requestId, encrypted).password, gamePassword, 'do not trim or rewrite the chosen password');
  }
});

test('game claim requires a game proof receipt; other website accounts cannot poll or overwrite it', async t => {
  const f = await connected(t), id = randomUUID();
  const claim = await f.admin.request('/agent-claims', 'POST', { username: 'ag_Alpha', requestId: id });
  assert.equal(claim.status, 202); assert.match(claim.data.nextCommand, /^\/portal bind /);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM ownerships').get().n, 0);
  const user = f.client(); await user.init(); await user.request('/accounts', 'POST', { username: 'other-user', password: testPassword });
  assert.equal((await user.request('/jobs/' + id)).status, 404);
  await f.result(id, { username: 'ag_Alpha', state: 'succeeded', playerUuid: f.uuid });
  assert.equal((await f.admin.request('/jobs/' + id)).data.state, 'succeeded');
  assert.equal((await user.request('/agent-claims', 'POST', { username: 'ag_Alpha', requestId: randomUUID() })).status, 409);
});

test('stale heartbeat, forged receipts and unknown outcomes fail closed and never write ownership', async t => {
  const f = await connected(t), id = randomUUID();
  await f.admin.request('/agents', 'POST', { username: 'ag_Unknown', requestId: id, gamePassword: 'game-test-password' });
  await f.result(id, { username: 'ag_Different', state: 'succeeded', playerUuid: f.uuid });
  assert.equal((await f.admin.request('/jobs/' + id)).data.state, 'unknown');
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM ownerships').get().n, 0);
  await f.result(id, { username: 'ag_Unknown', state: 'succeeded', playerUuid: f.uuid });
  assert.equal((await f.admin.request('/jobs/' + id)).data.state, 'unknown', 'correct name cannot bind a different UUID');
  await f.result(id, { username: 'ag_Unknown', state: 'unknown' });
  assert.equal((await f.admin.request('/jobs/' + id)).data.state, 'unknown');
  await fs.writeFile(path.join(f.directory, 'heartbeat.json'), seal(f.key, 'heartbeat', { ready: true, at: Date.now() - 6000 }));
  assert.equal((await f.admin.request('/game-capabilities')).data.ready, false);
  assert.equal((await f.admin.request('/agents', 'POST', { username: 'ag_Later', requestId: randomUUID(), gamePassword: 'game-test-password' })).status, 503);
});


test('administrator-managed historical test bindings do not consume the normal self-service creation quota', async t => {
  const f = await connected(t), owner = f.portal.store.ownerByName('fixture-admin');
  for (let i = 0; i < 8; i++) f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, randomUUID(), 'Isolated archived QA binding', Date.now());
  const created = await f.admin.request('/agents', 'POST', { username: 'ag_AdminNew', requestId: randomUUID(), gamePassword: 'admin-new-game-password' });
  assert.equal(created.status, 202);
  const ordinary = f.client(); await ordinary.init(); await ordinary.request('/accounts', 'POST', { username: 'QuotaUser', password: testPassword });
  const other = f.portal.store.ownerByName('QuotaUser');
  for (let i = 0; i < 5; i++) f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(other.id, randomUUID(), 'Isolated quota binding', Date.now());
  assert.equal((await ordinary.request('/agents', 'POST', { username: 'ag_TooMany', requestId: randomUUID(), gamePassword: 'ordinary-game-password' })).data.error.reason, 'AGENT_LIMIT');
});

test('parallel creation cannot consume the same final ordinary-owner quota slot twice', async t => {
  const f = await connected(t), user = f.client(); await user.init();
  await user.request('/accounts', 'POST', { username: 'ConcurrentOwner', password: testPassword });
  const owner = f.portal.store.ownerByName('ConcurrentOwner');
  for (let i = 0; i < 4; i++) f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, randomUUID(), 'Isolated existing role', Date.now());
  const results = await Promise.all(['ag_LastOne', 'ag_LastTwo'].map(username => user.request('/agents', 'POST', { username, requestId: randomUUID(), gamePassword: 'isolated-quota-password' })));
  assert.deepEqual(results.map(row => row.status).sort(), [202, 409]);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs WHERE owner_id=?').get(owner.id).n, 1);
});
