import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { siteFixture, testPassword } from './helpers.mjs';
import { png, zip, modelFiles } from './appearance-fixtures.mjs';
import { digest, newSecret } from '../src/store.mjs';
import { offlineUuid, seal } from '../src/game-accounts.mjs';
import { identifier } from '../scripts/appearance-worker.mjs';
import { runAgentAppearance } from '../public/agent-appearance.mjs';

const ROOT = '/api/v1/agent-access/appearance';
const uploadHeaders = { 'X-Appearance-Label': encodeURIComponent('自己的日常形象'), 'X-Skin-Variant': 'slim', 'X-Appearance-Consent': 'public-game-appearance' };
async function request(f, route, token, method = 'GET', body, headers = {}) {
  const response = await fetch(f.origin + route, { method, headers: { Authorization: 'Bearer ' + token, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}) });
  return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
async function fixture(t) {
  const worker = 'app_' + newSecret(), f = await siteFixture(t, { appearance: { bridgeEnabled: true, tokenHash: digest(worker) } });
  const key = randomBytes(32), directory = path.join(f.root, 'bridge'), keyFile = path.join(f.root, 'bridge.key');
  await fs.mkdir(path.join(directory, 'results'), { recursive: true }); await fs.writeFile(keyFile, key.toString('hex'));
  Object.assign(f.config.authBridge, { enabled: true, directory, keyFile });
  const heartbeat = () => fs.writeFile(path.join(directory, 'heartbeat.json'), seal(key, 'heartbeat', { ready: true, at: Date.now() }));
  const result = (id, data) => fs.writeFile(path.join(directory, 'results', id + '.json'), seal(key, 'result:' + id, { requestId: id, ...data }));
  await heartbeat();
  return { ...f, worker, heartbeat, result };
}
async function identity(f, username, pool = false) {
  const invite = pool ? (await f.admin.request('/admin/trial-invites', 'POST', { requestId: randomUUID(), clientSecret: newSecret(), count: 1 })).data.invites[0] : (await f.admin.request('/agent-invites', 'POST', {})).data;
  const credentials = { requestId: randomUUID(), username, clientSecret: newSecret() };
  assert.equal((await request(f, '/api/v1/agent-access/register', invite.token, 'POST', credentials)).status, 201);
  const session = await request(f, '/api/v1/agent-access/sessions', null, 'POST', { clientId: credentials.requestId, clientSecret: credentials.clientSecret });
  const token = session.data.token, create = randomUUID(), uuid = offlineUuid(username);
  await f.heartbeat();
  assert.equal((await request(f, '/api/v1/agent-access/activate', token, 'POST', { requestId: create, gamePassword: 'isolated-appearance-password' })).status, 202);
  await f.result(create, { username, playerUuid: uuid, state: 'succeeded' });
  assert.equal((await request(f, '/api/v1/agent-access/status', token)).data.state, 'ready');
  const previous = await f.game.roster(), agent = { ...f.agent, id: digest(uuid).slice(0, 24), name: username, playerUuid: uuid };
  f.game.roster = async () => [...previous, agent];
  return { token, agent, clientId: credentials.requestId, credentials, create, expiresAt: session.data.expiresAt };
}
const upload = (f, who, kind = 'skin', bytes = png(), extra = {}) => request(f, ROOT + '/' + kind, who.token, 'POST', bytes, { ...uploadHeaders, 'Content-Type': kind === 'skin' ? 'image/png' : 'application/zip', ...extra });
const poll = (f, results = []) => request(f, '/api/v1/internal/appearance/poll', f.worker, 'POST', { at: Date.now(), ready: true, results });

test('an invited Agent can upload its own skin and YSM without a website session, and verify the actual job receipt', async t => {
  const f = await fixture(t), who = await identity(f, 'ag_MyLooks');
  const skin = await upload(f, who); assert.equal(skin.status, 201); assert.equal(skin.data.subject.username, who.agent.name);
  assert.equal((await request(f, skin.data.assets[0].image, who.token)).data.equals(png()), true);
  const model = await upload(f, who, 'ysm', zip(modelFiles())); assert.equal(model.status, 201);
  const asset = model.data.assets.find(a => a.kind === 'ysm'), id = randomUUID();
  const queued = await request(f, ROOT + '/apply', who.token, 'POST', { requestId: id, assetId: asset.id, texture: 'default', playerUuid: f.uuid, username: 'Goddess' });
  assert.equal(queued.status, 202); assert.equal(queued.data.state, 'queued'); assert.equal(queued.data.subject.playerUuid, who.agent.playerUuid);
  assert.equal((await request(f, ROOT + '/apply', who.token, 'POST', { requestId: id, assetId: asset.id, texture: 'default' })).data.id, id);
  const task = (await poll(f)).data.requests[0]; assert.equal(task.playerUuid, who.agent.playerUuid);
  const receipt = { id: task.id, playerUuid: task.playerUuid, sha256: task.sha256, state: 'applied', identifier: identifier(task), texture: task.texture, reason: 'YSM_BOUND', message: '原模型、贴图、角色绑定和网页转换已核对', webAvailable: false };
  assert.equal((await poll(f, [receipt])).status, 400);
  assert.equal((await poll(f, [{ ...receipt, webAvailable: true }])).status, 200);
  const final = await request(f, queued.data.query, who.token); assert.equal(final.data.state, 'applied'); assert.equal(final.data.result.webAvailable, true);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM appearance_jobs').get().n, 1);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM appearance_assets WHERE player_uuid=?').get(f.uuid).n, 0);
});

test('self-service credentials cannot read or change another body, bypass consent, or invoke the appearance worker', async t => {
  const f = await fixture(t), one = await identity(f, 'ag_LookOne'), two = await identity(f, 'ag_LookTwo');
  const other = (await upload(f, two)).data.assets[0], job = await request(f, ROOT + '/apply', two.token, 'POST', { requestId: randomUUID(), assetId: other.id });
  assert.equal((await request(f, ROOT + '/assets/' + other.id, one.token)).status, 404);
  assert.equal((await request(f, ROOT + '/assets/' + other.id, one.token, 'DELETE')).status, 404);
  assert.equal((await request(f, ROOT + '/apply', one.token, 'POST', { requestId: randomUUID(), assetId: other.id })).status, 404);
  assert.equal((await request(f, job.data.query, one.token)).status, 404);
  assert.equal((await upload(f, one, 'skin', png(), { 'X-Appearance-Consent': '' })).status, 400);
  assert.equal((await request(f, ROOT, one.token, 'GET', null, { Cookie: 'web=credential' })).status, 403);
  assert.equal((await request(f, ROOT, one.token, 'GET', null, { Origin: f.origin })).status, 403);
  assert.equal((await request(f, '/api/v1/internal/appearance/poll', one.token, 'POST', { at: Date.now(), ready: true, results: [] })).status, 401);
  await f.admin.request('/agent-invites/' + f.portal.store.db.prepare('SELECT invite_id FROM agent_clients WHERE id=?').get(one.clientId).invite_id, 'DELETE');
  assert.equal((await request(f, ROOT, one.token)).status, 401);
});

test('old role clients opt into appearance management with a single-role PAT; existing read-only tokens stay read-only', async t => {
  const f = await fixture(t), owner = f.portal.store.ownerByName('fixture-admin');
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, f.uuid, 'isolated owner proof', Date.now());
  const create = scopes => f.admin.request('/client-credentials', 'POST', { label: '我的客户端', agentId: f.agent.id, expiresInDays: 2, scopes });
  const read = await create(['state.read']); assert.equal((await request(f, ROOT, read.data.token)).status, 403);
  const granted = await create(['state.read', 'appearance.write']); assert.equal(granted.status, 201);
  assert.equal((await request(f, ROOT, granted.data.token)).status, 200);
  assert.equal((await upload(f, { token: granted.data.token })).status, 201);
  const next = f.client(); await next.init(); await next.request('/accounts', 'POST', { username: 'NextOwner', password: testPassword });
  f.portal.store.db.prepare('UPDATE ownerships SET owner_id=? WHERE agent_uuid=?').run(f.portal.store.ownerByName('NextOwner').id, f.uuid);
  assert.equal((await request(f, ROOT, granted.data.token)).status, 403);
  assert.equal((await create(['state.read', 'appearance.write'])).data.error.reason, 'APPEARANCE_OWNER_REQUIRED');
});

test('trial roles have independent storage and keep assets, queued changes and API identity when claimed', async t => {
  const f = await fixture(t), one = await identity(f, 'ag_PoolLook', true), two = await identity(f, 'ag_PoolOther', true);
  const pool = f.portal.store.db.prepare('SELECT owner_id FROM agent_clients WHERE id=?').get(one.clientId).owner_id;
  // Isolated quota fixture: another role has consumed its full allowance.
  f.portal.store.db.prepare("INSERT INTO appearance_assets(id,owner_id,player_uuid,kind,label,variant,sha256,metadata,bytes,created_at) VALUES(?,?,?,'skin','quota fixture','slim',?, '{}',zeroblob(33554432),?)").run(randomUUID(), pool, two.agent.playerUuid, '0'.repeat(64), Date.now());
  const uploaded = await upload(f, one); assert.equal(uploaded.status, 201); assert.equal(uploaded.data.limits.quotaScope, 'trial_role');
  const id = randomUUID(); assert.equal((await request(f, ROOT + '/apply', one.token, 'POST', { requestId: id, assetId: uploaded.data.assets[0].id })).status, 202);
  const visitor = f.client(); await visitor.init(); await visitor.request('/accounts', 'POST', { username: 'MyAppearanceOwner', password: testPassword });
  const claim = randomUUID(); await f.heartbeat();
  assert.equal((await visitor.request('/agent-claims', 'POST', { requestId: claim, username: one.agent.name })).status, 202);
  await f.result(claim, { username: one.agent.name, playerUuid: one.agent.playerUuid, state: 'succeeded' });
  assert.equal((await visitor.request('/jobs/' + claim)).data.state, 'succeeded');
  const owner = f.portal.store.ownerByName('MyAppearanceOwner');
  assert.equal(f.portal.store.db.prepare('SELECT owner_id FROM appearance_assets WHERE player_uuid=?').get(one.agent.playerUuid).owner_id, owner.id);
  assert.equal(f.portal.store.db.prepare('SELECT owner_id FROM appearance_jobs WHERE id=?').get(id).owner_id, owner.id);
  assert.equal(f.portal.store.db.prepare('SELECT owner_id FROM appearance_assets WHERE player_uuid=?').get(two.agent.playerUuid).owner_id, pool);
  const after = await request(f, ROOT, one.token); assert.equal(after.status, 200); assert.equal(after.data.jobs[0].state, 'queued');
  assert.equal((await poll(f)).data.requests[0].id, id);
  assert.equal((await request(f, '/api/v1/agent-access/status', one.token)).data.state, 'ready');
});

test('the local helper uses the original trial identity and a lost apply response never repeats the operation', async t => {
  const f = await fixture(t), who = await identity(f, 'ag_SelfShape', true);
  const identityFile = path.join(f.root, 'identity.json'), skin = path.join(f.root, 'skin.png');
  await fs.writeFile(identityFile, JSON.stringify({ schemaVersion: 1, portal: f.origin, username: who.agent.name, clientId: who.clientId, clientSecret: who.credentials.clientSecret, gameRequestId: who.create, gamePassword: 'isolated-appearance-password', token: who.token, expiresAt: who.expiresAt }));
  await fs.writeFile(skin, png());
  const args = ['skin', '--identity-file', identityFile, '--file', skin, '--variant', 'slim', '--public'], output = [];
  let calls = 0;
  const lostResponse = async (url, opts) => {
    const response = await fetch(url, opts);
    if (url.endsWith('/appearance/apply') && opts.method === 'POST') { calls++; throw Error('isolated response interruption'); }
    return response;
  };
  assert.equal(await runAgentAppearance(args, line => output.push(line), { fetcher: lostResponse }), 2);
  assert.match(output.at(-1), /结果待确认/);
  assert.equal(await runAgentAppearance(args, line => output.push(line), { fetcher: lostResponse }), 2);
  assert.equal(calls, 1); assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM appearance_jobs').get().n, 1);
  const task = (await poll(f)).data.requests[0];
  assert.equal((await poll(f, [{ id: task.id, playerUuid: task.playerUuid, sha256: task.sha256, state: 'applied', identifier: identifier(task), reason: 'SKIN_BOUND', message: '原版皮肤签名和本人绑定已核实' }])).status, 200);
  assert.equal(await runAgentAppearance(['status', '--identity-file', identityFile], line => output.push(line)), 0);
  assert.match(output.at(-1), /已核实应用/);
  const all = output.join('\n'); assert.ok(!all.includes(who.token) && !all.includes(who.credentials.clientSecret) && !all.includes('isolated-appearance-password'));
  assert.equal((await fs.stat(identityFile + '.appearance.json')).isFile(), true);
  await assert.rejects(fs.stat(identityFile + '.appearance.json.lock'), { code: 'ENOENT' });
});

test('the PAT helper requires public consent and rejects an unrelated local file before any upload', async t => {
  const f = await fixture(t), owner = f.portal.store.ownerByName('fixture-admin');
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, f.uuid, 'isolated owner proof', Date.now());
  const credential = (await f.admin.request('/client-credentials', 'POST', { label: '外观工具', agentId: f.agent.id, expiresInDays: 2, scopes: ['state.read', 'appearance.write'] })).data;
  const file = path.join(f.root, 'private-pat.txt'), source = path.join(f.root, 'not-a-model.zip');
  await fs.writeFile(file, credential.token); await fs.writeFile(source, 'deliberately unrelated local content');
  const args = ['ysm', '--token-file', file, '--portal', f.origin, '--file', source]; let uploads = 0;
  const fetcher = (url, opts) => { if (opts.method === 'POST') uploads++; return fetch(url, opts); };
  await assert.rejects(runAgentAppearance(args, () => {}, { fetcher }), /--public/);
  await assert.rejects(runAgentAppearance([...args, '--public'], () => {}, { fetcher }), /文件格式不符/);
  assert.equal(uploads, 0); assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM appearance_assets').get().n, 0);
});
