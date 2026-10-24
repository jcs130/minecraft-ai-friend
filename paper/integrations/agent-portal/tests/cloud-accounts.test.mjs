import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { siteFixture, testPassword } from './helpers.mjs';
import { digest } from '../src/store.mjs';
import { seal, unseal, offlineUuid } from '../src/game-accounts.mjs';
import { accountSyncOnce } from '../scripts/sync-accounts.mjs';
import { CloudGame } from '../src/cloud-source.mjs';
import { GameData } from '../src/game-data.mjs';

test('verified Bedrock presence persists separately from ownership and never overwrites another UUID',async t=>{
 const f=await bridge(t);await f.heartbeat();
 const playerUuid='00000000-0000-0000-0009-00000d9f9c7b',state={watch:[],bedrockAttemptAt:Date.now(),bedrockObservation:{observedAt:Date.now(),players:[{name:'.Example',playerUuid,source:'Geyser.live-session'}]}};
 f.settings.bedrock={enabled:true};await accountSyncOnce(f.settings,state);
 const entries=JSON.parse(await fs.readFile(f.settings.portalIdentitiesFile,'utf8')).identities;
 assert.equal(entries[0].uuid,playerUuid);assert.equal(entries[0].kind,'player');assert.equal(entries[0].source,'Geyser.live-session');
 assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM ownerships').get().n,0);
 state.bedrockObservation.players[0].playerUuid='00000000-0000-0000-0009-00000d9f9c7c';await accountSyncOnce(f.settings,state);
 assert.equal(JSON.parse(await fs.readFile(f.settings.portalIdentitiesFile,'utf8')).identities[0].uuid,playerUuid);
});

async function bridge(t) {
  const token = 'acc_' + randomBytes(32).toString('base64url'), remoteKey = randomBytes(32), localKey = randomBytes(32);
  const f = await siteFixture(t, { sourceMode: 'cloud', cloudAccounts: { enabled: true, tokenHash: digest(token), keyFile: '' } });
  const remoteKeyFile = path.join(f.root, 'remote.key'), localKeyFile = path.join(f.root, 'local.key'), tokenFile = path.join(f.root, 'worker.token'), directory = path.join(f.root, 'private-game-bridge');
  await fs.mkdir(path.join(directory, 'requests'), { recursive: true }); await fs.mkdir(path.join(directory, 'results'));
  await fs.writeFile(remoteKeyFile, remoteKey.toString('hex')); await fs.writeFile(localKeyFile, localKey.toString('hex')); await fs.writeFile(tokenFile, token);
  f.config.cloudAccounts.keyFile = remoteKeyFile;
  const settings = { endpoint: f.origin + '/api/v1/internal/accounts/poll', localKeyFile, remoteKeyFile, tokenFile, bridgeDirectory: directory, stateFile: path.join(f.root, 'worker-state.json'), portalIdentitiesFile: path.join(f.root, 'verified-identities.json') };
  const heartbeat = async (at = Date.now(), ready = true) => fs.writeFile(path.join(directory, 'heartbeat.json'), seal(localKey, 'heartbeat', { at, ready }));
  const poll = async (body, headers = {}) => fetch(settings.endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { ...f, token, remoteKey, localKey, directory, settings, heartbeat, poll };
}

test('cloud registration crosses an encrypted outbound worker, waits for verified UUID and survives duplicate delivery', async t => {
  const f = await bridge(t), id = randomUUID(), state = { watch: [] }, password = 'isolated-agent-password';
  assert.equal((await f.admin.request('/game-capabilities')).data.ready, false);
  assert.equal((await f.admin.request('/agents', 'POST', { username: 'ag_NewCloud', requestId: id, gamePassword: password })).status, 503);
  await f.heartbeat(); await accountSyncOnce(f.settings, state);
  assert.equal((await f.admin.request('/game-capabilities')).data.ready, true);
  const created = await f.admin.request('/agents', 'POST', { username: 'ag_NewCloud', requestId: id, gamePassword: password });
  assert.equal(created.status, 202); assert.equal(created.data.state, 'pending');
  const outbox = f.portal.store.db.prepare('SELECT * FROM account_outbox WHERE id=?').get(id);
  assert.ok(!outbox.request.includes(password)); assert.ok(!JSON.stringify(f.portal.store.db.prepare('SELECT * FROM account_jobs').all()).includes(password));
  assert.equal((await accountSyncOnce(f.settings, state)).delivered, 1);
  const localFile = path.join(f.directory, 'requests', id + '.json'), before = await fs.readFile(localFile, 'utf8');
  assert.equal(unseal(f.localKey, 'request:' + id, before).password, password);
  assert.equal((await accountSyncOnce(f.settings, state)).delivered, 0);
  assert.equal(await fs.readFile(localFile, 'utf8'), before);
  assert.equal(f.portal.store.ownedUuids(f.portal.store.ownerByName('fixture-admin').id).length, 0);
  const playerUuid = offlineUuid('ag_NewCloud');
  await fs.writeFile(path.join(f.directory, 'results', id + '.json'), seal(f.localKey, 'result:' + id, { requestId: id, username: 'ag_NewCloud', playerUuid, state: 'succeeded' }));
  await accountSyncOnce(f.settings, state);
  assert.equal((await f.admin.request('/jobs/' + id)).data.state, 'succeeded');
  assert.deepEqual(f.portal.store.ownedUuids(f.portal.store.ownerByName('fixture-admin').id), [playerUuid]);
  assert.deepEqual(JSON.parse(await fs.readFile(f.settings.portalIdentitiesFile, 'utf8')).identities, [{ name: 'ag_NewCloud', uuid: playerUuid }]);
  const home = new GameData({ ...f.config, authHeartbeat: path.join(f.root, 'absent-heartbeat'), agentRegistry: path.join(f.root, 'absent-pairs'), publicRoster: [], includeKnownPlayers: false, portalIdentitiesFile: f.settings.portalIdentitiesFile }, f.portal.store.salt);
  home.status = async () => ({ sample: [], observedAt: new Date().toISOString() });
  assert.equal((await home.roster())[0].playerUuid, playerUuid, 'Registered offline roles remain in later outbound snapshots');
  const game = new CloudGame(f.config, f.portal.store, { read: () => null }); game.portalIdentities = f.game.portalIdentities;
  const roster = await game.roster(); assert.equal(roster[0].name, 'ag_NewCloud'); assert.equal(roster[0].playerUuid, playerUuid); assert.equal(roster[0].online, null);
  assert.equal((await game.playerState(roster[0])).freshness, 'unavailable', 'A new registration is not invented gameplay data');
  const repeated = await f.admin.request('/agents', 'POST', { username: 'ag_NewCloud', requestId: id, gamePassword: 'some-different-password' });
  assert.equal(repeated.data.state, 'succeeded'); assert.equal(await fs.readFile(localFile, 'utf8'), before);
});

test('a claim command appears only after the home worker proves local delivery', async t => {
  const f = await bridge(t), state = { watch: [] }; await f.heartbeat(); await accountSyncOnce(f.settings, state);
  const id = randomUUID();
  const created = await f.admin.request('/agent-claims', 'POST', { username: 'ag_Alpha', requestId: id });
  assert.equal(created.status, 202); assert.equal(created.data.delivery, 'queued'); assert.equal(created.data.nextCommand, undefined);
  await accountSyncOnce(f.settings, state);
  assert.equal((await f.admin.request('/jobs/' + id)).data.nextCommand, undefined, 'Sending HTTP data is not local delivery');
  await accountSyncOnce(f.settings, state);
  const delivered = await f.admin.request('/jobs/' + id);
  assert.equal(delivered.data.delivery, 'delivered'); assert.match(delivered.data.nextCommand, /^\/portal bind /);
});

test('world publisher, browser requests and other owners cannot read or forge account jobs', async t => {
  const f = await bridge(t), state = { watch: [] }; await f.heartbeat(); await accountSyncOnce(f.settings, state);
  const id = randomUUID(); await f.admin.request('/agents', 'POST', { username: 'ag_Private', requestId: id, gamePassword: 'private-game-password' });
  const body = { heartbeat: { ready: true, at: Date.now() }, results: [] };
  assert.equal((await f.poll(body, { Authorization: 'Bearer srv_' + randomBytes(32).toString('base64url') })).status, 401);
  assert.equal((await f.poll(body, { Origin: f.origin })).status, 403);
  const user = f.client(); await user.init(); await user.request('/accounts', 'POST', { username: 'other-owner', password: testPassword });
  assert.equal((await user.request('/jobs/' + id)).status, 404); assert.deepEqual((await user.request('/account-jobs')).data.jobs, []);
  const wrong = seal(f.remoteKey, 'result:' + id, { requestId: id, username: 'ag_Private', state: 'succeeded', playerUuid: f.uuid });
  assert.equal((await f.poll({ ...body, results: [{ id, envelope: wrong }] })).status, 400);
  assert.equal((await f.admin.request('/jobs/' + id)).data.state, 'pending');
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM ownerships').get().n, 0);
});

test('stale login bridge never dispatches a new request; expired undispatched work fails without replay', async t => {
  const f = await bridge(t), state = { watch: [] }; await f.heartbeat(); await accountSyncOnce(f.settings, state);
  const id = randomUUID(); await f.admin.request('/agents', 'POST', { username: 'ag_Expired', requestId: id, gamePassword: 'expired-game-password' });
  f.portal.store.db.prepare('UPDATE account_jobs SET expires_at=? WHERE id=?').run(Date.now() - 1, id);
  await f.heartbeat(Date.now() - 6000); const cycle = await accountSyncOnce(f.settings, state);
  assert.equal(cycle.ready, false); assert.equal(cycle.delivered, 0);
  assert.equal((await f.admin.request('/jobs/' + id)).data.reason, 'ACCOUNT_REQUEST_EXPIRED');
  assert.deepEqual(await fs.readdir(path.join(f.directory, 'requests')), []);
  assert.equal((await f.admin.request('/game-capabilities')).data.ready, false);
});

test('a connection loss after dispatch recovers the same request and preserves local terminal receipts', async t => {
  const f = await bridge(t), state = { watch: [] }; await f.heartbeat(); await accountSyncOnce(f.settings, state);
  const id = randomUUID(); await f.admin.request('/agents', 'POST', { username: 'ag_Recover', requestId: id, gamePassword: 'recover-game-password' });
  await accountSyncOnce(f.settings, state);
  const file = path.join(f.directory, 'requests', id + '.json'), before = await fs.readFile(file, 'utf8');
  await assert.rejects(accountSyncOnce(f.settings, state, async () => { throw Error('isolated lost response'); }));
  const recovered = { watch: [] }; assert.equal((await accountSyncOnce(f.settings, recovered)).delivered, 0);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  const receipt = { requestId: id, username: 'ag_Recover', state: 'unknown' };
  await fs.writeFile(path.join(f.directory, 'results', id + '.json'), seal(f.localKey, 'result:' + id, receipt));
  await accountSyncOnce(f.settings, recovered); assert.equal((await f.admin.request('/jobs/' + id)).data.state, 'unknown');
  assert.equal(await fs.readFile(file, 'utf8'), before, 'Unknown actions are queried, never rewritten');
});
