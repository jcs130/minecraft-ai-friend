import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { siteFixture, testPassword } from './helpers.mjs';
import { newSecret, digest } from '../src/store.mjs';
import { offlineUuid } from '../src/game-accounts.mjs';
import { runAgentAccess, portalOrigin } from '../public/agent-register.mjs';
import { CloudGame, CloudWorld } from '../src/cloud-source.mjs';

async function machine(f, endpoint, method = 'GET', body, token, extra = {}) {
  const response = await fetch(f.origin + '/api/v1/agent-access/' + endpoint, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, headers: response.headers, data: await response.json() };
}
async function invitation(f, name, browser = f.admin) {
  const value = await browser.request('/agent-invites', 'POST', { label: 'Isolated Agent invitation', ...(name ? { username: name } : {}) });
  assert.equal(value.status, 201); return value.data;
}
async function registered(f, name = 'ag_Invite', browser = f.admin) {
  const invite = await invitation(f, name, browser), body = { requestId: randomUUID(), username: name, clientSecret: newSecret() };
  const registration = await machine(f, 'register', 'POST', body, invite.token); assert.equal(registration.status, 201);
  const login = await machine(f, 'sessions', 'POST', { clientId: body.requestId, clientSecret: body.clientSecret }); assert.equal(login.status, 200);
  return { invite, body, token: login.data.token, clientId: body.requestId };
}

test('invites are single use, hash-only, owner-scoped, and do not create website owners or game accounts', async t => {
  const f = await siteFixture(t), invite = await invitation(f, 'ag_Invite');
  assert.match(invite.token, /^qdi_[A-Za-z0-9_-]{43}$/);
  const list = await f.admin.request('/agent-invites');
  assert.equal(list.data.invites[0].state, 'available'); assert.ok(!JSON.stringify(list.data).includes(invite.token));
  assert.ok(!JSON.stringify(f.portal.store.db.prepare('SELECT * FROM agent_invites').all()).includes(invite.token));
  const body = { requestId: randomUUID(), username: 'ag_Invite', clientSecret: newSecret(), role: 'admin', ownerId: 'attacker', scopes: ['admin'] };
  const first = await machine(f, 'register', 'POST', body, invite.token);
  assert.equal(first.status, 201); assert.equal(first.data.registrationOnly, true); assert.equal(first.data.ownership, 'inviter');
  const again = await machine(f, 'register', 'POST', body, invite.token);
  assert.equal(again.status, 200); assert.equal(again.data.duplicate, true);
  assert.equal(f.portal.store.countOwners(), 1);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 0);
  assert.equal(f.portal.store.db.prepare('SELECT owner_id FROM agent_clients').get().owner_id, f.portal.store.ownerByName('fixture-admin').id);
  assert.ok(!JSON.stringify(f.portal.store.db.prepare('SELECT * FROM agent_clients').all()).includes(body.clientSecret));
  const reused = await machine(f, 'register', 'POST', { ...body, requestId: randomUUID() }, invite.token);
  assert.equal(reused.status, 409); assert.equal(reused.data.error.reason, 'INVITE_USED');
  const tamper = await machine(f, 'register', 'POST', { ...body, clientSecret: newSecret() }, invite.token);
  assert.equal(tamper.data.error.reason, 'REGISTRATION_CONFLICT');
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 1);
});

test('a revoked or expired invitation cannot register, including a replay of a formerly valid exchange', async t => {
  const f = await siteFixture(t), one = await registered(f), two = await invitation(f, 'ag_Expired');
  await f.admin.request('/agent-invites/' + one.invite.id, 'DELETE');
  assert.equal((await machine(f, 'register', 'POST', one.body, one.invite.token)).status, 401);
  assert.equal((await machine(f, 'status', 'GET', undefined, one.token)).status, 401);
  assert.equal((await machine(f, 'sessions', 'POST', { clientId: one.clientId, clientSecret: one.body.clientSecret })).status, 401);
  f.portal.store.db.prepare('UPDATE agent_invites SET expires_at=? WHERE id=?').run(Date.now() - 1, two.id);
  assert.equal((await machine(f, 'register', 'POST', { requestId: randomUUID(), username: 'ag_Expired', clientSecret: newSecret() }, two.token)).status, 401);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 1);
});

test('existing players, managers and every eye suffix are protected; rejected names do not consume an invite', async t => {
  const f = await siteFixture(t), invite = await invitation(f);
  const before = await f.game.roster();
  for (const username of ['ag_Alpha', 'ag_neko_eye', 'ag_MyEye', 'ag_Goddess', 'ag_live', 'Goddess', 'AG_Upper']) {
    const result = await machine(f, 'register', 'POST', { requestId: randomUUID(), username, clientSecret: newSecret() }, invite.token);
    assert.ok([400, 403, 409].includes(result.status), username);
  }
  assert.equal((await f.admin.request('/agent-invites')).data.invites[0].state, 'available');
  assert.deepEqual(await f.game.roster(), before);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 0);
});

test('an archived historical test name stays retired without denying an unrelated ordinary Agent', async t => {
  const f = await siteFixture(t), owner = f.portal.store.ownerByName('fixture-admin');
  f.portal.store.db.prepare('INSERT INTO archived_test_roles VALUES(?,?,?,?,?,?,?)').run(randomUUID(), 'ag_OldTest', owner.id, 'isolated archive', Date.now(), Date.now(), 'test');
  assert.equal((await f.admin.request('/agent-invites', 'POST', { label: 'old role', username: 'ag_OldTest' })).data.error.reason, 'RETIRED_TEST_ACCOUNT');
  const invite = await invitation(f);
  assert.equal((await machine(f, 'register', 'POST', { requestId: randomUUID(), username: 'ag_OldTest', clientSecret: newSecret() }, invite.token)).data.error.reason, 'RETIRED_TEST_ACCOUNT');
  assert.equal((await registered(f, 'ag_RealNew')).clientId.length, 36);
});

test('an invitation can be restricted to an exact name, and simultaneous exchanges consume it only once', async t => {
  const f = await siteFixture(t), invite = await invitation(f, 'ag_Named');
  const body = { requestId: randomUUID(), username: 'ag_Other', clientSecret: newSecret() };
  assert.equal((await machine(f, 'register', 'POST', body, invite.token)).data.error.reason, 'INVITE_NAME_MISMATCH');
  const results = await Promise.all([body, { ...body, requestId: randomUUID() }].map(row => machine(f, 'register', 'POST', { ...row, username: 'ag_Named' }, invite.token)));
  assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 1);
});

test('machine credentials cannot use browser, owner, claim, password or admin authority, even for an admin invitation', async t => {
  const f = await siteFixture(t), c = await registered(f);
  for (const endpoint of ['/account', '/agents', '/admin/owners', '/agent-invites', '/client-credentials']) {
    assert.ok([401, 403].includes((await f.admin.request(endpoint, 'GET', undefined, { Authorization: 'Bearer ' + c.token })).status), endpoint);
  }
  for (const endpoint of ['/agent-claims', '/game-password', '/admin/bindings', '/agents']) {
    assert.ok([401, 403].includes((await f.admin.request(endpoint, 'POST', {}, { Authorization: 'Bearer ' + c.token })).status), endpoint);
  }
  assert.equal((await machine(f, 'status', 'GET', undefined, c.token, { Origin: f.origin })).data.error.reason, 'AGENT_CLIENT_REQUIRED');
  assert.equal((await machine(f, 'status', 'GET', undefined, c.token, { Cookie: 'unrelated=browser' })).status, 403);
  const noCsrf = await fetch(f.origin + '/api/v1/agent-invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
});

test('invites can be issued by an ordinary owner but cannot be listed or revoked by a different owner', async t => {
  const f = await siteFixture(t), other = f.client(); await other.init();
  await other.request('/accounts', 'POST', { username: 'OrdinaryOwner', password: testPassword });
  const invite = await invitation(f, 'ag_Mine', other);
  assert.equal((await f.admin.request('/agent-invites')).data.invites.length, 0);
  assert.equal((await f.admin.request('/agent-invites/' + invite.id, 'DELETE')).status, 404);
  assert.equal((await other.request('/agent-invites')).data.invites.length, 1);
});

test('reserved registrations count toward the normal five-Agent quota and cannot be bypassed with another invitation', async t => {
  const f = await siteFixture(t), user = f.client(); await user.init();
  await user.request('/accounts', 'POST', { username: 'QuotaOwner', password: testPassword });
  for (let i = 0; i < 5; i++) await registered(f, 'ag_Quota' + i, user);
  const result = await user.request('/agent-invites', 'POST', { label: 'one too many' });
  assert.equal(result.status, 409); assert.equal(result.data.error.reason, 'AGENT_LIMIT');
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 5);
});

test('login rejects wrong secrets, rotates sessions, expires reliably, and logout leaves registration intact', async t => {
  const f = await siteFixture(t), c = await registered(f);
  assert.equal((await machine(f, 'sessions', 'POST', { clientId: c.clientId, clientSecret: newSecret() })).status, 401);
  const login = await machine(f, 'sessions', 'POST', { clientId: c.clientId, clientSecret: c.body.clientSecret });
  assert.equal(login.status, 200); assert.notEqual(login.data.token, c.token);
  assert.equal((await machine(f, 'status', 'GET', undefined, c.token)).status, 401);
  assert.equal((await machine(f, 'status', 'GET', undefined, login.data.token)).status, 200);
  const table = JSON.stringify(f.portal.store.db.prepare('SELECT * FROM agent_access_sessions').all());
  assert.ok(!table.includes(login.data.token));
  assert.equal((await machine(f, 'session', 'DELETE', undefined, login.data.token)).status, 200);
  assert.equal((await machine(f, 'status', 'GET', undefined, login.data.token)).status, 401);
  const again = await machine(f, 'sessions', 'POST', { clientId: c.clientId, clientSecret: c.body.clientSecret });
  f.portal.store.db.prepare('UPDATE agent_access_sessions SET expires_at=? WHERE id_hash=?').run(Date.now() - 1, digest(again.data.token));
  assert.equal((await machine(f, 'status', 'GET', undefined, again.data.token)).status, 401);
});

test('game bridge absence is explicit: API registration succeeds but no game job or ownership is invented', async t => {
  const f = await siteFixture(t, { sourceMode: 'cloud' }), c = await registered(f);
  const status = await machine(f, 'status', 'GET', undefined, c.token);
  assert.equal(status.data.state, 'not_created'); assert.equal(status.data.game.ready, false); assert.equal(status.data.gameAccountCreated, false);
  const activate = await machine(f, 'activate', 'POST', { requestId: randomUUID(), gamePassword: 'safe-game-password' }, c.token);
  assert.equal(activate.status, 503); assert.equal(activate.data.error.reason, 'CLOUD_AUTH_BRIDGE_PENDING');
  assert.equal((await machine(f, 'state', 'GET', undefined, c.token)).status, 409);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 0);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM ownerships').get().n, 0);
});

test('a verified account receipt binds only the invited new UUID to the inviter and pending requests are never replayed', async t => {
  const f = await siteFixture(t), c = await registered(f), id = randomUUID(); let dispatched = 0;
  f.portal.accounts.remote = { capabilities: async () => ({ ready: true }), writeRequest: async () => { dispatched++; }, readResult: async () => ({ requestId: id, username: c.body.username, playerUuid: offlineUuid(c.body.username), state: 'waiting' }) };
  const first = await machine(f, 'activate', 'POST', { requestId: id, gamePassword: 'isolated-game-password' }, c.token);
  assert.equal(first.status, 202); assert.equal(first.data.state, 'pending'); assert.equal(dispatched, 1);
  assert.equal((await machine(f, 'activate', 'POST', { requestId: id, gamePassword: 'changed-password' }, c.token)).status, 202);
  assert.equal((await machine(f, 'activate', 'POST', { requestId: randomUUID(), gamePassword: 'another-game-password' }, c.token)).status, 409);
  assert.equal(dispatched, 1); assert.equal(f.portal.store.ownedUuids(f.portal.store.ownerByName('fixture-admin').id).length, 0);
  f.portal.accounts.remote.readResult = async () => ({ requestId: id, username: c.body.username, playerUuid: offlineUuid(c.body.username), state: 'succeeded' });
  const status = await machine(f, 'status', 'GET', undefined, c.token);
  assert.equal(status.data.state, 'ready'); assert.equal(status.data.gameAccountCreated, true);
  assert.deepEqual(f.portal.store.ownedUuids(f.portal.store.ownerByName('fixture-admin').id), [offlineUuid(c.body.username)]);
  assert.equal(dispatched, 1);
});

test('an uncertain account dispatch is queried rather than replayed and cannot expose another invited character', async t => {
  const f = await siteFixture(t), one = await registered(f, 'ag_First'), two = await registered(f, 'ag_Second'); let calls = 0;
  const id = randomUUID();
  f.portal.accounts.remote = { capabilities: async () => ({ ready: true }), writeRequest: async () => { calls++; throw Error('simulated uncertain dispatch'); }, readResult: async () => ({ requestId: id, username: 'ag_First', state: 'unknown' }) };
  const first = await machine(f, 'activate', 'POST', { requestId: id, gamePassword: 'isolated-game-password' }, one.token);
  assert.equal(first.data.error.reason, 'ACCOUNT_RESULT_UNKNOWN');
  assert.equal((await machine(f, 'status', 'GET', undefined, one.token)).data.state, 'unknown');
  assert.equal((await machine(f, 'activate', 'POST', { requestId: id, gamePassword: 'isolated-game-password' }, one.token)).data.state, 'unknown');
  assert.equal(calls, 1);
  const second = await machine(f, 'status', 'GET', undefined, two.token);
  assert.equal(second.data.username, 'ag_Second'); assert.equal(second.data.job, null); assert.ok(!JSON.stringify(second.data).includes(id));
});

test('simultaneous activation creates only one request, and pre-dispatch process interruption is recoverable', async t => {
  const f = await siteFixture(t), c = await registered(f); let calls = 0;
  f.portal.accounts.remote = { capabilities: async () => ({ ready: true }), writeRequest: async () => { calls++; }, readResult: async id => ({ requestId: id, username: c.body.username, state: 'waiting' }) };
  f.portal.store.db.prepare('UPDATE agent_clients SET game_request_id=? WHERE id=?').run(randomUUID(), c.clientId);
  assert.equal((await machine(f, 'status', 'GET', undefined, c.token)).data.state, 'not_created');
  const values = await Promise.all([1, 2].map(() => machine(f, 'activate', 'POST', { requestId: randomUUID(), gamePassword: 'isolated-game-password' }, c.token)));
  assert.deepEqual(values.map(row => row.status).sort(), [202, 409]); assert.equal(calls, 1);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 1);
});

test('wrong-login throttling, disabled enrollment, and malformed inputs fail without creating any game state', async t => {
  const f = await siteFixture(t), id = randomUUID();
  for (let i = 0; i < 12; i++) assert.equal((await machine(f, 'sessions', 'POST', { clientId: id, clientSecret: newSecret() })).status, 401);
  assert.equal((await machine(f, 'sessions', 'POST', { clientId: id, clientSecret: newSecret() })).status, 429);
  f.config.agentAccess.enabled = false;
  assert.equal((await f.admin.request('/agent-invites', 'POST', { label: 'disabled' })).data.error.reason, 'AGENT_ACCESS_DISABLED');
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 0);
});

test('the standalone helper persists identity before exchange and recovers a lost response without leaking credentials', async t => {
  const f = await siteFixture(t), invite = await invitation(f, 'ag_Helper');
  const file = path.join(f.root, 'private', 'identity.json'), invitationFile = path.join(f.root, 'invite.txt'), outputs = [];
  await fs.writeFile(invitationFile, invite.token);
  const args = ['register', '--portal', f.origin, '--username', 'ag_Helper', '--invite-file', invitationFile, '--identity-file', file];
  const original = globalThis.fetch;
  globalThis.fetch = async (...values) => { const result = await original(...values); assert.ok(await fs.readFile(file, 'utf8')); await result.arrayBuffer(); throw Error('Lost register response'); };
  try { await assert.rejects(runAgentAccess(args, line => outputs.push(line)), /RESULT_UNKNOWN/); } finally { globalThis.fetch = original; }
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(await runAgentAccess(args, line => outputs.push(line)), 0);
  assert.equal(JSON.parse(outputs[0]).duplicate, true);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 1);
  assert.equal(await runAgentAccess(['login', '--identity-file', file], line => outputs.push(line)), 0);
  const logged = JSON.parse(await fs.readFile(file, 'utf8')); assert.equal(logged.clientId, saved.clientId); assert.equal(logged.gamePassword, saved.gamePassword);
  assert.equal(await runAgentAccess(['activate', '--identity-file', file], line => outputs.push(line)), 2);
  assert.equal(JSON.parse(outputs.at(-1)).state, 'awaiting_game_bridge');
  for (const secret of [invite.token, logged.clientSecret, logged.gamePassword, logged.token]) assert.ok(!outputs.join('\n').includes(secret));
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 0);
  assert.equal(await runAgentAccess(['logout', '--identity-file', file], line => outputs.push(line)), 0);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).token, undefined);
});

test('helper validates transport and identity target; discovery pins its exact public helper hash', async t => {
  for (const value of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/?key=secret', 'https://example.com/api', 'https://example.com/#token']) assert.throws(() => portalOrigin(value));
  assert.equal(portalOrigin('https://mc.kangqiang.site/'), 'https://mc.kangqiang.site');
  const f = await siteFixture(t), caps = await (await fetch(f.origin + '/api/v1/agent-access')).json();
  const helper = await fetch(f.origin + caps.helper.url); assert.match(helper.headers.get('content-type'), /javascript/);
  assert.equal(digest(Buffer.from(await helper.arrayBuffer())), caps.helper.sha256);
  assert.equal((await fetch(f.origin + caps.help)).status, 200);
});

test('archived test identities cannot reappear from a later snapshot; an Eye and its real Agent remain visible', async t => {
  const f = await siteFixture(t), owner = f.portal.store.ownerByName('fixture-admin'), oldUuid = randomUUID();
  f.portal.store.db.prepare('INSERT INTO archived_test_roles VALUES(?,?,?,?,?,?,?)').run(oldUuid, 'ag_OldTest', owner.id, 'isolated cleanup', Date.now(), Date.now(), 'test');
  const rows = [{ name: 'ag_OldTest', playerUuid: oldUuid, kind: 'agent' }, { name: 'ag_NEKO', playerUuid: randomUUID(), kind: 'agent' }, { name: 'ag_neko_eye', playerUuid: randomUUID(), kind: 'observer' }];
  const source = { read: () => ({ stale: false, value: { roster: rows, players: rows.map(row => ({ name: row.name, growth: { level: 1 } })) } }) };
  const game = new CloudGame(f.config, f.portal.store, source), world = new CloudWorld(f.config, game, f.portal.store, source);
  assert.deepEqual((await game.roster()).map(row => row.name), ['ag_NEKO', 'ag_neko_eye']);
  assert.deepEqual((await world.players()).players.map(row => row.name), ['ag_NEKO', 'ag_neko_eye']);
});
