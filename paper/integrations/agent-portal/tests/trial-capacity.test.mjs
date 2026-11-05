import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { siteFixture } from './helpers.mjs';
import { digest, newSecret } from '../src/store.mjs';
import { Store } from '../src/store.mjs';
import { GameAccounts, offlineUuid, seal, unseal } from '../src/game-accounts.mjs';
import { AgentAccess } from '../src/agent-access.mjs';
import { diagnoseTrialCapacity } from '../scripts/trial-capacity.mjs';
import { runAgentAccess } from '../public/agent-register.mjs';
import { CloudAccounts } from '../src/cloud-accounts.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';

const identity = name => ({ requestId: randomUUID(), username: name, clientSecret: newSecret() });
const fixture = t => siteFixture(t, { agentAccess: { enabled: true, publicSignup: true } });
const register = (f, value) => f.portal.agentAccess.publicRegister(value, digest('isolated-network:' + value.requestId));
const capacityError = error => error.reason === 'TRIAL_POOL_FULL';
const context = (f, value, access = f.portal.agentAccess) => {
  const login = access.login({ clientId: value.requestId, clientSecret: value.clientSecret });
  return access.authorize({ headers: { authorization: 'Bearer ' + login.token } });
};
const activation = () => ({ requestId: randomUUID(), gamePassword: 'isolated-original-password' });
const age = f => f.portal.store.db.prepare('UPDATE agent_clients SET created_at=?').run(Date.now() - 24 * 3600000);
function inviteSeats(f, count) {
  const pool = f.portal.agentAccess.pool, owner = f.portal.store.ownerByName('fixture-admin');
  const invites = [];
  while (count) {
    const size = Math.min(20, count);
    invites.push(...pool.issue(owner, { requestId: randomUUID(), clientSecret: newSecret(), count: size }).invites);
    count -= size;
  }
  return invites;
}
function bridge(f) {
  const requests = [], replies = new Map();
  const remote = { capabilities: async () => ({ ready: true }),
    writeRequest: async (id, request) => { requests.push({ id, request }); },
    readResult: async id => {
      if (!replies.has(id)) throw Object.assign(Error('not received'), { code: 'ENOENT' });
      return replies.get(id);
    } };
  f.portal.accounts.remote = remote;
  return { requests, replies, remote };
}
function anotherWorker(t, f, remote) {
  const store = new Store(f.config.dataDir), accounts = new GameAccounts(f.config, store, f.game, remote);
  const access = new AgentAccess(f.config, store, f.game, accounts);
  t.after(() => store.close());
  return { store, accounts, access };
}
async function concurrentWorkers(t, f, tasks) {
  const workers = tasks.map(task => new Worker(new URL('./fixtures/trial-capacity-worker.mjs', import.meta.url), { workerData: { config: f.config, ...task } }));
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  const results = workers.map(worker => new Promise((resolve, reject) => {
    worker.on('message', message => { if (message.results) resolve(message.results); });
    worker.on('error', reject);
    worker.on('exit', code => { if (code !== 0) reject(Error('capacity worker exited: ' + code)); });
  }));
  await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
    worker.once('message', message => message.ready ? resolve() : reject(Error('worker not ready')));
    worker.once('error', reject);
  })));
  for (const worker of workers) worker.postMessage('go');
  return (await Promise.all(results)).flat();
}

test('SIG-1: 100 abandoned registrations stop holding seats after 24 hours without deleting identities', async t => {
  const f = await fixture(t), db = f.portal.store.db;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const values = Array.from({ length: 100 }, (_, i) => identity('ag_Abandon' + i));
  // Execute the real registration method against a private SQLite database.
  // Distinct synthetic network hashes model different sources without touching
  // production, forging proxy headers, or weakening HTTP/network throttles.
  for (const value of values) await register(f, value);
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 100);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 0);
  const before = db.prepare('SELECT * FROM agent_clients ORDER BY id').all();
  const newcomer = identity('ag_Newcomer');
  await assert.rejects(register(f, newcomer), capacityError);
  t.mock.timers.tick(24 * 3600000 - 1);
  await assert.rejects(register(f, newcomer), capacityError);
  t.mock.timers.tick(1);
  assert.equal((await register(f, newcomer)).duplicate, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 101);
  assert.deepEqual(db.prepare('SELECT * FROM agent_clients WHERE id<>? ORDER BY id').all(newcomer.requestId), before);
  assert.equal((await register(f, values[0])).duplicate, true, 'a lost registration response recovers the original identity');
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_public_registrations').get().n, 101, 'retry does not consume another network allowance');
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 0);
});

test('expiry cannot be renewed by retries or login; an expired identity must reacquire a seat before dispatch', async t => {
  const f = await fixture(t), value = identity('ag_Returning'), b = bridge(f);
  await register(f, value); age(f);
  const original = f.portal.store.db.prepare('SELECT * FROM agent_clients WHERE id=?').get(value.requestId);
  const invites = inviteSeats(f, 100), request = activation();
  assert.equal((await register(f, value)).duplicate, true);
  const auth = context(f, value);
  assert.equal((await f.portal.agentAccess.status(auth)).trialCapacity.state, 'registration_released');
  await assert.rejects(f.portal.agentAccess.activate(auth, request), capacityError);
  assert.equal(b.requests.length, 0);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 0);
  assert.deepEqual(f.portal.store.db.prepare('SELECT * FROM agent_clients WHERE id=?').get(value.requestId), original);
  await assert.rejects(register(f, { ...value, clientSecret: newSecret() }), { reason: 'REGISTRATION_CONFLICT' });
  await assert.rejects(register(f, identity(value.username)), { reason: 'AGENT_NAME_RESERVED' });
  f.portal.agentAccess.revoke(f.portal.store.ownerByName('fixture-admin'), invites[0].id);
  const result = await f.portal.agentAccess.activate(context(f, value), request);
  assert.equal(result.id, request.requestId);
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].request.password, request.gamePassword);
  assert.equal(b.requests[0].request.username, value.username);
  assert.equal(f.portal.agentAccess.pool.capacity().used, 100);
});

test('independent SQLite connections compete for one seat across activation, signup and invitation issuance', async t => {
  const f = await fixture(t), values = [identity('ag_RaceA'), identity('ag_RaceB')], b = bridge(f);
  for (const value of values) await register(f, value);
  age(f); inviteSeats(f, 99);
  const worker = anotherWorker(t, f, b.remote);
  const results = await Promise.allSettled([
    f.portal.agentAccess.activate(context(f, values[0]), activation()),
    worker.access.activate(context(f, values[1], worker.access), activation()),
    register(f, identity('ag_RaceNew')),
    Promise.resolve().then(() => worker.access.pool.issue(f.portal.store.ownerByName('fixture-admin'), { requestId: randomUUID(), clientSecret: newSecret(), count: 1 })),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  for (const result of results.filter(row => row.status === 'rejected')) assert.equal(result.reason.reason, 'TRIAL_POOL_FULL');
  assert.equal(f.portal.agentAccess.pool.capacity().used, 100);
  assert.ok(b.requests.length <= 1);
});

test('parallel worker threads cannot overbook 100 seats during a 120-registration burst', async t => {
  const f = await fixture(t);
  const tasks = Array.from({ length: 4 }, (_, i) => ({ action: 'register',
    values: Array.from({ length: 30 }, (_, j) => identity('ag_Burst' + i + '_' + j)) }));
  const results = await concurrentWorkers(t, f, tasks);
  assert.equal(results.filter(row => row.ok).length, 100);
  assert.deepEqual(results.filter(row => !row.ok).map(row => row.reason), Array(20).fill('TRIAL_POOL_FULL'));
  assert.equal(f.portal.agentAccess.pool.capacity().used, 100);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 100);
});

test('parallel activation workers reacquire exactly one final seat for expired registrations', async t => {
  const f = await fixture(t), values = Array.from({ length: 6 }, (_, i) => identity('ag_FinalSeat' + i));
  for (const value of values) await register(f, value);
  age(f); inviteSeats(f, 99);
  const results = await concurrentWorkers(t, f, values.map(value => ({ action: 'activate',
    values: [{ clientId: value.requestId, clientSecret: value.clientSecret, request: activation() }] })));
  assert.equal(results.filter(row => row.ok).length, 1);
  assert.deepEqual(results.filter(row => !row.ok).map(row => row.reason), Array(5).fill('TRIAL_POOL_FULL'));
  assert.equal(f.portal.agentAccess.pool.capacity().used, 100);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 1);
});

test('a failed job insert rolls back its client pointer and seat before any bridge write', async t => {
  const f = await fixture(t), value = identity('ag_Atomic'), b = bridge(f), request = activation(), db = f.portal.store.db;
  await register(f, value); age(f);
  db.exec("CREATE TEMP TRIGGER fixture_fail_insert BEFORE INSERT ON account_jobs BEGIN SELECT RAISE(ABORT,'isolated insert failure'); END");
  await assert.rejects(f.portal.agentAccess.activate(context(f, value), request), /isolated insert failure/);
  assert.equal(db.prepare('SELECT game_request_id FROM agent_clients').get().game_request_id, null);
  assert.equal(f.portal.agentAccess.pool.capacity().used, 0); assert.equal(b.requests.length, 0);
  db.exec('DROP TRIGGER fixture_fail_insert');
  await f.portal.agentAccess.activate(context(f, value), request);
  assert.equal(b.requests.length, 1); assert.equal(f.portal.agentAccess.pool.capacity().used, 1);
});

test('same-client activation is atomic across workers, including a status read during asynchronous preflight', async t => {
  const f = await fixture(t), value = identity('ag_TwoWorkers'), b = bridge(f);
  await register(f, value);
  const other = anotherWorker(t, f, b.remote);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { entered = resolve; });
  const roster = f.game.roster;
  let reads = 0;
  f.game.roster = async () => { if (++reads === 1) { entered(); await gate; } return roster(); };
  const firstId = activation(), secondId = activation();
  const first = f.portal.agentAccess.activate(context(f, value), firstId);
  await waiting;
  assert.equal((await other.access.status(context(f, value, other.access))).state, 'not_created');
  const second = await other.access.activate(context(f, value, other.access), secondId);
  assert.equal(second.id, secondId.requestId);
  release();
  await assert.rejects(first, { reason: 'ACCOUNT_REQUEST_PENDING' });
  assert.equal(b.requests.length, 1);
  assert.equal(f.portal.store.db.prepare('SELECT game_request_id FROM agent_clients').get().game_request_id, secondId.requestId);
  assert.equal(f.portal.agentAccess.pool.capacity().used, 1);
});

test('simultaneous retries of the same activation ID return one durable job without another dispatch', async t => {
  const f = await fixture(t), value = identity('ag_SameRequest'), b = bridge(f), request = activation();
  await register(f, value); age(f);
  const other = anotherWorker(t, f, b.remote);
  const contexts = [context(f, value), context(f, value, other.access)];
  const results = await Promise.all([
    f.portal.agentAccess.activate(contexts[0], request), other.access.activate(contexts[1], request),
  ]);
  assert.deepEqual(results.map(result => result.id), [request.requestId, request.requestId]);
  assert.equal(b.requests.length, 1);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 1);
  assert.equal(f.portal.agentAccess.pool.capacity().used, 1);
});

test('unknown dispatch survives worker restart and expiry, and late success retains the original request and password', async t => {
  const f = await fixture(t), value = identity('ag_Unknown'), b = bridge(f), request = activation();
  await register(f, value);
  const write = b.remote.writeRequest;
  b.remote.writeRequest = async (...args) => { await write(...args); throw Error('connection lost after write'); };
  await assert.rejects(f.portal.agentAccess.activate(context(f, value), request), { reason: 'ACCOUNT_RESULT_UNKNOWN' });
  age(f);
  f.portal.store.db.prepare('UPDATE account_jobs SET expires_at=0').run();
  const other = anotherWorker(t, f, b.remote);
  assert.equal(other.access.pool.capacity().states.creation_unknown, 1);
  assert.equal((await other.access.activate(context(f, value, other.access), request)).state, 'unknown');
  await assert.rejects(other.access.activate(context(f, value, other.access), activation()), { reason: 'ACCOUNT_REQUEST_PENDING' });
  assert.equal(b.requests.length, 1);
  b.replies.set(request.requestId, { requestId: request.requestId, username: value.username, playerUuid: offlineUuid(value.username), state: 'succeeded' });
  assert.equal((await other.access.status(context(f, value, other.access))).state, 'ready');
  assert.equal(other.access.pool.capacity().states.created, 1);
  assert.equal((await other.access.activate(context(f, value, other.access), activation())).id, request.requestId);
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].request.password, request.gamePassword);
});

test('encrypted late receipt and verified claiming release only pool custody, preserving identity and gameplay fixtures', async t => {
  const f = await fixture(t), value = identity('ag_Preserved'), request = activation(), key = randomBytes(32);
  const db = f.portal.store.db, access = f.portal.agentAccess, accounts = f.portal.accounts;
  const keyFile = path.join(f.root, 'isolated-cloud.key');
  await fs.writeFile(keyFile, key.toString('hex'));
  f.config.cloudAccounts.keyFile = keyFile;
  const remote = new CloudAccounts(f.config, f.portal.store); accounts.remote = remote;
  const poll = results => remote.poll({ heartbeat: { ready: true, at: Date.now() }, results });
  await poll([]); await register(f, value);
  await access.activate(context(f, value), request);
  const original = db.prepare('SELECT * FROM agent_clients WHERE id=?').get(value.requestId);
  const encrypted = db.prepare('SELECT request FROM account_outbox WHERE id=?').get(request.requestId).request;
  assert.equal(unseal(key, 'request:' + request.requestId, encrypted).password, request.gamePassword);
  assert.ok(!encrypted.includes(request.gamePassword));
  assert.equal((await poll([])).requests.length, 1);
  age(f); db.prepare('UPDATE account_jobs SET expires_at=0 WHERE id=?').run(request.requestId);
  assert.equal((await access.status(context(f, value))).state, 'unknown');
  assert.equal(access.pool.capacity().used, 1);
  const uuid = offlineUuid(value.username), files = {
    'player-fixture.dat': Buffer.from('synthetic player NBT fixture: inventory, ender chest, UUID=' + uuid),
    'growth-fixture.json': Buffer.from(JSON.stringify({ uuid, profession: 'warrior', fame: 48, level: 21 })),
  };
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(f.config.serverDir, name), bytes);
  await poll([{ id: request.requestId, envelope: seal(key, 'result:' + request.requestId,
    { requestId: request.requestId, username: value.username, playerUuid: uuid, state: 'succeeded' }) }]);
  assert.equal((await access.status(context(f, value))).state, 'ready');
  assert.equal(access.pool.capacity().states.created, 1);
  f.game.roster = async () => [{ ...f.agent, name: value.username, playerUuid: uuid }];
  const owner = f.portal.store.ownerByName('fixture-admin'), claimId = randomUUID();
  await accounts.start(owner, 'claim', { requestId: claimId, username: value.username });
  assert.equal(access.pool.capacity().used, 1, 'requesting a claim is not ownership proof');
  await poll([{ id: claimId, envelope: seal(key, 'result:' + claimId,
    { requestId: claimId, username: value.username, playerUuid: uuid, state: 'succeeded' }) }]);
  await accounts.job(owner, claimId);
  assert.equal(access.pool.capacity().used, 0); assert.equal(access.pool.capacity().states.claimed, 1);
  const after = db.prepare('SELECT * FROM agent_clients WHERE id=?').get(value.requestId);
  for (const field of ['id', 'name', 'normalized', 'expected_uuid', 'secret_hash', 'game_request_id', 'revoked_at']) assert.equal(after[field], original[field]);
  assert.equal(after.owner_id, owner.id);
  assert.equal((await access.status(context(f, value))).job.id, request.requestId);
  assert.equal(db.prepare("SELECT count(*) AS n FROM account_jobs WHERE operation='create'").get().n, 1);
  assert.equal(db.prepare('SELECT request FROM account_outbox WHERE id=?').get(request.requestId).request, encrypted);
  for (const [name, bytes] of Object.entries(files)) assert.deepEqual(await fs.readFile(path.join(f.config.serverDir, name)), bytes);
});

test('API revocation, detached historical jobs and failed receipts never release possible game bodies', async t => {
  const f = await fixture(t), b = bridge(f), db = f.portal.store.db;
  const values = ['Pending', 'Unknown', 'Failed', 'Created'].map(name => identity('ag_' + name));
  for (const [i, value] of values.entries()) {
    await register(f, value);
    const request = activation();
    await f.portal.agentAccess.activate(context(f, value), request);
    if (i === 1) db.prepare("UPDATE account_jobs SET state='unknown' WHERE id=?").run(request.requestId);
    if (i === 2) {
      b.replies.set(request.requestId, { requestId: request.requestId, username: value.username, state: 'failed', reason: 'ACCOUNT_EXISTS' });
      await f.portal.agentAccess.status(context(f, value));
      db.prepare('UPDATE agent_clients SET game_request_id=NULL WHERE id=?').run(value.requestId);
    }
    if (i === 3) {
      b.replies.set(request.requestId, { requestId: request.requestId, username: value.username, playerUuid: offlineUuid(value.username), state: 'succeeded' });
      await f.portal.agentAccess.status(context(f, value));
    }
  }
  age(f);
  db.prepare('UPDATE agent_clients SET revoked_at=?').run(Date.now());
  const report = f.portal.agentAccess.pool.capacity();
  assert.equal(report.used, 4);
  assert.equal(report.states.creating, 1); assert.equal(report.states.creation_unknown, 1);
  assert.equal(report.states.creation_failed_review, 1); assert.equal(report.states.created, 1);
  inviteSeats(f, 96);
  await assert.rejects(register(f, identity('ag_NoExtra')), capacityError);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 4);
  assert.equal(db.prepare('SELECT count(*) AS n FROM ownerships').get().n, 1);
});

test('a missing client pointer cannot replay a historical pending, unknown or successful creation', async t => {
  const f = await fixture(t), b = bridge(f), db = f.portal.store.db;
  for (const state of ['pending', 'unknown', 'succeeded', 'failed']) {
    const value = identity('ag_D_' + state), request = activation();
    await register(f, value);
    await f.portal.agentAccess.activate(context(f, value), request);
    db.prepare('UPDATE account_jobs SET state=? WHERE id=?').run(state, request.requestId);
    db.prepare('UPDATE agent_clients SET game_request_id=NULL WHERE id=?').run(value.requestId);
    assert.equal((await f.portal.agentAccess.status(context(f, value))).state, 'unknown');
    await assert.rejects(f.portal.agentAccess.activate(context(f, value), activation()), { reason: 'TRIAL_IDENTITY_REVIEW_REQUIRED' });
  }
  assert.equal(b.requests.length, 4);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_jobs').get().n, 4);
});

test('expired invitation registrations release only their reservation; preflight rejection leaves no job', async t => {
  const f = await fixture(t), value = identity('ag_Invited'), invite = inviteSeats(f, 1)[0];
  await f.portal.agentAccess.register(invite.token, value);
  age(f);
  assert.equal(f.portal.agentAccess.pool.capacity().used, 0);
  const b = bridge(f);
  b.remote.capabilities = async () => ({ ready: false });
  await assert.rejects(f.portal.agentAccess.activate(context(f, value), activation()), { reason: 'AUTH_BRIDGE_NOT_CONNECTED' });
  assert.equal(f.portal.agentAccess.pool.capacity().used, 0);
  assert.equal(f.portal.store.db.prepare('SELECT game_request_id FROM agent_clients').get().game_request_id, null);
  b.remote.capabilities = async () => ({ ready: true });
  await f.portal.agentAccess.activate(context(f, value), activation());
  assert.equal(f.portal.agentAccess.pool.capacity().used, 1);
});

test('capacity diagnostics open an existing database read-only and emit no credential material', async t => {
  const f = await fixture(t), value = identity('ag_Diagnostic');
  await register(f, value); context(f, value); age(f);
  const db = f.portal.store.db;
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const file = path.join(f.config.dataDir, 'portal.sqlite'), before = await fs.readFile(file);
  const summary = diagnoseTrialCapacity(file), detail = diagnoseTrialCapacity(file, { details: true });
  assert.equal(summary.states.registration_released, 1); assert.equal(summary.used, 0);
  assert.equal(summary.clients, undefined); assert.equal(detail.clients[0].username, value.username);
  for (const secret of [value.clientSecret, digest(value.clientSecret), db.prepare('SELECT address_hash FROM agent_public_registrations').get().address_hash]) assert.ok(!JSON.stringify(detail).includes(secret));
  assert.deepEqual(await fs.readFile(file), before);
  assert.throws(() => diagnoseTrialCapacity(path.join(f.root, 'absent.sqlite')));
  await assert.rejects(fs.stat(path.join(f.root, 'absent.sqlite')), { code: 'ENOENT' });
});

test('join-plugin resumes the same saved identity after an explicit full-pool activation rejection', async t => {
  const f = await fixture(t), file = path.join(f.root, 'identity.json'), output = [];
  const args = ['join-plugin', '--portal', f.origin, '--username', 'ag_ResumePool', '--identity-file', file];
  await runAgentAccess(args, line => output.push(JSON.parse(line)), { maxWaitMs: 5 });
  const original = JSON.parse(await fs.readFile(file, 'utf8'));
  age(f); const invites = inviteSeats(f, 100), b = bridge(f);
  assert.equal(await runAgentAccess(args, line => output.push(JSON.parse(line)), { maxWaitMs: 5 }), 2);
  assert.equal(output.at(-1).state, 'awaiting_trial_capacity');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).joinActivationAttempted, false);
  assert.equal(b.requests.length, 0);
  f.portal.agentAccess.revoke(f.portal.store.ownerByName('fixture-admin'), invites[0].id);
  b.remote.writeRequest = async (id, request) => {
    b.requests.push({ id, request });
    b.replies.set(id, { requestId: id, username: original.username, playerUuid: offlineUuid(original.username), state: 'succeeded' });
  };
  assert.equal(await runAgentAccess(args, line => output.push(JSON.parse(line)), { maxWaitMs: 100, pollIntervalMs: 1 }), 0);
  assert.equal(output.at(-1).state, 'ready');
  const after = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const key of ['clientId', 'clientSecret', 'username', 'gameRequestId', 'gamePassword']) assert.equal(after[key], original[key]);
  assert.equal(b.requests.length, 1);
});
