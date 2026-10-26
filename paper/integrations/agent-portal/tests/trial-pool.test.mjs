import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { siteFixture, testPassword } from './helpers.mjs';
import { newSecret, verifyPassword } from '../src/store.mjs';
import { offlineUuid, seal } from '../src/game-accounts.mjs';
import { trialPoolOwnerId, isTrialAgent } from '../src/trial-pool.mjs';

async function machine(f, endpoint, method = 'GET', body, token) {
  const response = await fetch(f.origin + '/api/v1/agent-access/' + endpoint, { method, headers: {
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const batchBody = (count = 20) => ({ requestId: randomUUID(), clientSecret: newSecret(), count });
async function exchange(f, invite, name, direct = false) {
  const body = { requestId: randomUUID(), username: name, clientSecret: newSecret() };
  const result = direct ? { status: 201, data: await f.portal.agentAccess.register(invite.token, body) } : await machine(f, 'register', 'POST', body, invite.token);
  assert.equal(result.status, 201); assert.equal(result.data.ownership, 'experience_pool');
  const credentials = { clientId: body.requestId, clientSecret: body.clientSecret };
  const login = direct ? { status: 200, data: f.portal.agentAccess.login(credentials) } : await machine(f, 'sessions', 'POST', credentials);
  assert.equal(login.status, 200);
  return { body, token: login.data.token };
}
async function connected(t) {
  const f = await siteFixture(t), key = randomBytes(32), directory = path.join(f.root, 'bridge'), keyFile = path.join(f.root, 'bridge.key');
  await fs.mkdir(path.join(directory, 'results'), { recursive: true }); await fs.writeFile(keyFile, key.toString('hex'));
  Object.assign(f.config.authBridge, { enabled: true, directory, keyFile });
  const heartbeat = () => fs.writeFile(path.join(directory, 'heartbeat.json'), seal(key, 'heartbeat', { ready: true, at: Date.now() }));
  const result = (id, data) => fs.writeFile(path.join(directory, 'results', id + '.json'), seal(key, 'result:' + id, { requestId: id, ...data }));
  await heartbeat(); return { ...f, result, heartbeat };
}

test('twenty single-use trial invitations recover the same batch and bypass no owner login', async t => {
  const f = await siteFixture(t), body = batchBody();
  const responses = await Promise.all([1, 2].map(() => f.admin.request('/admin/trial-invites', 'POST', body)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
  assert.deepEqual(responses[0].data.invites, responses[1].data.invites);
  const invites = responses[0].data.invites;
  assert.equal(invites.length, 20); assert.equal(new Set(invites.map(i => i.token)).size, 20);
  assert.ok(invites.every(i => /^qdi_[A-Za-z0-9_-]{43}$/.test(i.token)));
  assert.match(invites[0].onboarding.prompt, /体验池/); assert.match(invites[0].onboarding.prompt, /portal bind/);
  const pool = f.portal.store.ownerById(trialPoolOwnerId(f.portal.store));
  assert.equal(pool.role, 'owner'); assert.equal(await verifyPassword(testPassword, pool.password_hash), false);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM sessions WHERE owner_id=?').get(pool.id).n, 0);
  // The normal per-owner limit is five; these are twenty independent invitations.
  // Exercise six through HTTP, then the same domain methods for the remaining
  // roles: twenty visitors are not twenty registrations from one source IP.
  // The production 12/minute address throttle must remain unchanged.
  for (let i = 0; i < 20; i++) await exchange(f, invites[i], 'ag_pool' + i, i >= 6);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients WHERE owner_id=?').get(pool.id).n, 20);
  const rows = JSON.stringify(f.portal.store.db.prepare('SELECT * FROM agent_invites').all()) + JSON.stringify(f.portal.store.db.prepare('SELECT * FROM agent_trial_batches').all());
  assert.ok(!rows.includes(body.clientSecret)); assert.ok(!rows.includes(invites[0].token));
  assert.equal((await machine(f, 'register', 'POST', { requestId: randomUUID(), username: 'ag_reuse', clientSecret: newSecret() }, invites[0].token)).data.error.reason, 'INVITE_USED');
  assert.equal((await f.admin.request('/admin/trial-invites', 'POST', { ...body, clientSecret: newSecret() })).data.error.reason, 'TRIAL_BATCH_CONFLICT');
});

test('ordinary owners and machine clients cannot issue trial batches; revoked invites cannot be exchanged', async t => {
  const f = await siteFixture(t), owner = f.client(); await owner.init();
  await owner.request('/accounts', 'POST', { username: 'TrialVisitor', password: testPassword });
  assert.equal((await owner.request('/admin/trial-invites', 'POST', batchBody())).status, 403);
  const issued = await f.admin.request('/admin/trial-invites', 'POST', batchBody(2));
  const [one, two] = issued.data.invites;
  assert.equal((await f.admin.request('/agent-invites')).data.invites.length, 2);
  assert.equal((await owner.request('/agent-invites/' + two.id, 'DELETE')).status, 404);
  assert.equal((await f.admin.request('/agent-invites/' + two.id, 'DELETE')).status, 200);
  assert.equal((await machine(f, 'register', 'POST', { requestId: randomUUID(), username: 'ag_revoked', clientSecret: newSecret() }, two.token)).status, 401);
  const agent = await exchange(f, one, 'ag_trial');
  const denied = await fetch(f.origin + '/api/v1/admin/trial-invites', { method: 'POST', headers: { Authorization: 'Bearer ' + agent.token, 'Content-Type': 'application/json' }, body: JSON.stringify(batchBody()) });
  assert.ok([401, 403].includes(denied.status));
  assert.equal((await machine(f, 'status', 'GET', undefined, agent.token)).data.ownership, 'experience_pool');
});

test('trial custody moves only after authenticated game proof and keeps the original API identity and receipt', async t => {
  const f = await connected(t), issued = await f.admin.request('/admin/trial-invites', 'POST', batchBody(1));
  const agent = await exchange(f, issued.data.invites[0], 'ag_TrialBody'), uuid = offlineUuid(agent.body.username), creation = randomUUID();
  await f.heartbeat();
  assert.equal((await machine(f, 'activate', 'POST', { requestId: creation, gamePassword: 'isolated-trial-game-password' }, agent.token)).status, 202);
  await f.result(creation, { username: agent.body.username, state: 'succeeded', playerUuid: uuid });
  assert.equal((await machine(f, 'status', 'GET', undefined, agent.token)).data.state, 'ready');
  f.game.roster = async () => [f.agent, { ...f.agent, id: 'c'.repeat(24), name: agent.body.username, playerUuid: uuid }];
  assert.ok(isTrialAgent(f.portal.store, uuid));
  const publicRole = (await f.admin.request('/roster')).data.agents.find(a => a.name === agent.body.username);
  assert.equal(publicRole.experiencePool, true); assert.equal(publicRole.claimable, true);
  const visitor = f.client(); await visitor.init(); await visitor.request('/accounts', 'POST', { username: 'RealTrialOwner', password: testPassword });
  const owner = f.portal.store.ownerByName('RealTrialOwner'), id = randomUUID();
  await f.heartbeat();
  const claim = await visitor.request('/agent-claims', 'POST', { username: agent.body.username, requestId: id });
  assert.equal(claim.status, 202); assert.match(claim.data.nextCommand, /^\/portal bind /);
  assert.deepEqual(f.portal.store.ownedUuids(owner.id), []);
  await f.result(id, { username: agent.body.username, state: 'succeeded', playerUuid: f.uuid });
  assert.notEqual((await visitor.request('/jobs/' + id)).data.state, 'succeeded');
  assert.deepEqual(f.portal.store.ownedUuids(owner.id), []);
  await f.result(id, { username: agent.body.username, state: 'succeeded', playerUuid: uuid });
  assert.equal((await visitor.request('/jobs/' + id)).data.state, 'succeeded');
  assert.deepEqual(f.portal.store.ownedUuids(owner.id), [uuid]);
  assert.equal(isTrialAgent(f.portal.store, uuid), false);
  assert.equal(f.portal.store.db.prepare('SELECT owner_id FROM agent_clients WHERE id=?').get(agent.body.requestId).owner_id, owner.id);
  const status = await machine(f, 'status', 'GET', undefined, agent.token);
  assert.equal(status.data.state, 'ready'); assert.equal(status.data.ownership, 'website_account'); assert.equal(status.data.job.id, creation);
  assert.equal((await visitor.request('/agent-invites')).data.invites[0].agent, agent.body.username);
  assert.equal((await visitor.request('/jobs/' + id)).data.state, 'succeeded');
  await f.heartbeat();
  assert.equal((await f.admin.request('/agent-claims', 'POST', { username: agent.body.username, requestId: randomUUID() })).data.error.reason, 'ALREADY_OWNED');
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs WHERE operation=?').get('create').n, 1);
});
