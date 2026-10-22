import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createPortal } from '../src/server.mjs';
import { loadConfig, projectRoot } from '../src/config.mjs';
import { buildSnapshot } from '../src/cloud-source.mjs';

const uuid = '11111111-1111-3111-8111-111111111111', token = 'srv_' + 'f'.repeat(43);
function snapshot(sequence = 1) {
  return { schemaVersion: 1, sequence, observedAt: new Date().toISOString(), summary: { version: 'Paper 1.21.1 fixture', online: true, playersOnline: 1, playersMax: 40, authHealthy: true },
    roster: [{ name: 'ag_Alpha', playerUuid: uuid, available: true, kind: 'agent', isReserved: false, online: true, authenticated: true, statusObservedAt: new Date().toISOString() }],
    players: [{ name: 'ag_Alpha', growth: { rank: '黑铁 II', gradeIndex: 4, level: 21, fame: 48, completed: 3, profession: 'warrior' } }],
    states: { [uuid]: { freshness: 'saved', inventory: [{ slot: 5, id: 'minecraft:player_head', name: '大背包', count: 1 }], savedPosition: [1, 64, 3], progress: { profession: { combat: 'warrior' } } } },
    events: [{ id: 'a'.repeat(64), kind: 'quest', playerName: 'ag_Alpha', title: '完成营地补给', body: '', occurredAt: '2026-10-20T00:00:00+08:00', timePrecision: 'day', source: 'AgentFriend.guild.everDone' }] };
}
async function fixture(t) {
  const base = path.resolve(projectRoot, '.local/tests'), root = path.join(base, 'cloud-' + randomUUID());
  const config = loadConfig({ host: '127.0.0.1', port: 0, sourceMode: 'cloud', dataDir: root, serverDir: path.join(root, 'MUST_NOT_READ_GAME_FILES'), cloudSync: { enabled: true, tokenHash: createHash('sha256').update(token).digest('hex') }, authBridge: { enabled: false } });
  let portal;
  async function start() { portal = createPortal(config); await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve)); }
  await start();
  const origin = () => 'http://127.0.0.1:' + portal.server.address().port;
  const put = (body, credential = token, headers = {}) => fetch(origin() + '/api/v1/internal/snapshot', { method: 'PUT', headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const get = async route => (await fetch(origin() + '/api/v1/' + route)).json();
  function client() {
    let cookie = '', csrf;
    return async (route, method = 'GET', body) => {
      const response = await fetch(origin() + '/api/v1/' + route, { method, headers: { Cookie: cookie, ...(method !== 'GET' ? { Origin: origin(), 'X-CSRF-Token': csrf || '', 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const incoming = response.headers.get('set-cookie'); if (incoming) cookie = incoming.split(';')[0];
      const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken; return { status: response.status, data };
    };
  }
  const admin = client(); await admin('session'); assert.equal((await admin('setup', 'POST', { username: 'cloud-admin', password: 'abc123' })).status, 201);
  t.after(async () => { await portal.close(); assert.ok(path.resolve(root).startsWith(base + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return { get portal() { return portal; }, put, get, admin, client, origin, restart: async () => { await portal.close(); await start(); } };
}

test('cloud ingress is separate from browsers and client credentials, with no implicit game authority', async t => {
  const f = await fixture(t);
  assert.equal((await f.put(snapshot(), 'pat_' + 'f'.repeat(43))).status, 401);
  assert.equal((await f.put(snapshot(), token, { Origin: f.origin() })).status, 403);
  assert.equal((await fetch(f.origin() + '/api/v1/agents', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  assert.equal((await f.get('game-capabilities')).ready, false);
  assert.equal((await f.get('server')).online, null);
});

test('real outbound HTTP ingestion exposes public growth/events while keeping original UUID, inventory and position private', async t => {
  const f = await fixture(t); assert.equal((await f.put(snapshot())).status, 200);
  const publicData = [await f.get('roster'), await f.get('world/players'), await f.get('world/events')];
  const text = JSON.stringify(publicData);
  for (const hidden of [uuid, 'inventory', 'savedPosition', 'minecraft:player_head']) assert.ok(!text.includes(hidden));
  assert.equal(publicData[1].players[0].growth.rank, '黑铁 II'); assert.equal(publicData[2].total, 1);
  const id = publicData[0].agents[0].id;
  const other = f.client(); await other('session'); await other('accounts', 'POST', { username: 'cloud-user', password: 'abcdef' });
  assert.equal((await other(`agents/${id}/state`)).status, 404);
  const saved = await f.admin(`agents/${id}/state`); assert.equal(saved.status, 200); assert.equal(saved.data.inventory[0].name, '大背包');
  assert.deepEqual(saved.data.savedPosition, [1, 64, 3]);
});

test('snapshot replay, late arrival and malformed events cannot overwrite committed projections', async t => {
  const f = await fixture(t), first = snapshot();
  assert.equal((await f.put(first)).status, 200);
  assert.equal((await (await f.put(first)).json()).duplicate, true);
  const changed = structuredClone(first); changed.summary.version = 'replacement';
  const conflict = await f.put(changed); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.currentSequence, 1);
  const late = snapshot(2); late.observedAt = new Date(Date.parse(first.observedAt) - 1000).toISOString(); assert.equal((await f.put(late)).status, 409);
  const invalid = snapshot(2); invalid.events[0].kind = 'chat'; assert.equal((await f.put(invalid)).status, 400);
  assert.equal((await f.get('server')).version, first.summary.version);
  assert.equal((await f.get('world/events')).total, 1);
});

test('credentials, mismatched private bodies and reserved account profiles are rejected before persistence', async t => {
  const f = await fixture(t), secret = snapshot(); secret.states[uuid].account = { password: 'not-allowed' };
  assert.equal((await f.put(secret)).status, 400);
  const wrong = snapshot(); wrong.states['22222222-2222-3222-8222-222222222222'] = {};
  assert.equal((await f.put(wrong)).status, 400);
  const admin = snapshot(); admin.roster[0].isReserved = true; assert.equal((await f.put(admin)).status, 400);
  assert.equal(f.portal.cloud.read(), null);
});

test('cloud process restart retains accounts, original role IDs, saved items and public history; offline source becomes unknown', async t => {
  const f = await fixture(t); await f.put(snapshot());
  const id = (await f.get('roster')).agents[0].id;
  await f.restart();
  assert.equal((await f.get('roster')).agents[0].id, id);
  assert.equal((await f.admin(`agents/${id}/state`)).data.inventory[0].count, 1);
  assert.equal((await f.get('world/events')).total, 1);
  f.portal.store.db.prepare('UPDATE server_snapshot SET observed_at=? WHERE id=1').run(Date.now() - 60000);
  assert.equal((await f.get('server')).online, null); assert.equal((await f.get('roster')).agents[0].online, null);
  assert.equal((await f.admin(`agents/${id}/state`)).data.inventory[0].name, '大背包');
});

test('home producer strips raw source fields and never synchronizes privileged inventories', async () => {
  const row = snapshot().roster[0];
  const game = { roster: async () => [row, { ...row, name: 'Goddess', playerUuid: '33333333-3333-3333-8333-333333333333', isReserved: true }], serverSummary: async () => ({ online: true, rawPluginConfig: 'private' }),
    playerState: async () => ({ ...snapshot().states[uuid], rawEssentialsConfig: 'private' }) };
  const world = { players: async () => ({ players: snapshot().players }), events: async () => ({ events: snapshot().events, pages: 1 }) };
  const value = await buildSnapshot(game, world, 2);
  assert.equal(Object.keys(value.states).length, 1); assert.ok(!JSON.stringify(value).includes('rawPluginConfig')); assert.ok(!JSON.stringify(value).includes('rawEssentialsConfig'));
});
