import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';
import { loadConfig, projectRoot } from '../src/config.mjs';
import { createPortal } from '../src/server.mjs';
import { GameData, freshAuthentication, normalizeInventory, componentText } from '../src/game-data.mjs';
import { pingMinecraft, readVarint } from '../src/minecraft-ping.mjs';
import net from 'node:net';
import http from 'node:http';

const uuidA = '11111111-1111-3111-8111-111111111111';
const uuidB = '22222222-2222-3222-8222-222222222222';
const uuidAdmin = '33333333-3333-3333-8333-333333333333';
const password = 'isolated-test-password-2026';
const fixtureBase = path.resolve(projectRoot, '.local', 'tests');

async function fixture(t, initialPassword = password) {
  const root = path.join(fixtureBase, randomUUID());
  const gameDir = path.join(root, 'game'); const opsDir = path.join(root, 'ops');
  for (const child of ['world/playerdata', 'world/stats', 'plugins/Essentials/userdata', 'plugins/AgentFriend']) await fs.mkdir(path.join(gameDir, child), { recursive: true });
  await fs.mkdir(opsDir, { recursive: true });
  await fs.writeFile(path.join(gameDir, 'usercache.json'), JSON.stringify([{ name: 'ag_Alpha', uuid: uuidA }, { name: 'ag_Beta', uuid: uuidB }, { name: 'Goddess', uuid: uuidAdmin }]));
  await fs.writeFile(path.join(gameDir, 'ops.json'), JSON.stringify([{ name: 'Goddess', uuid: uuidAdmin }]));
  await fs.writeFile(path.join(opsDir, 'agent-eye-pairs.json'), JSON.stringify({ pairs: [{ agent: 'ag_Alpha', eye: 'ag_Alpha_eye' }, { agent: 'ag_Beta' }] }));
  await fs.writeFile(path.join(opsDir, 'auth-heartbeat.json'), JSON.stringify({ ready: true, at: Date.now(), authorizedNames: ['ag_Alpha'] }));
  await fs.writeFile(path.join(gameDir, 'plugins/Essentials/userdata', uuidA + '.yml'), 'ip-address: 10.11.12.13\nmoney: "0"\ntimestamps:\n  login: 1791760000000\n');
  await fs.writeFile(path.join(gameDir, 'world/stats', uuidA + '.json'), JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:deaths': 0, 'minecraft:play_time': 72000 }, 'minecraft:mined': { 'minecraft:stone': 14 } } }));
  const player = { type: 'compound', name: '', value: {
    Health: { type: 'float', value: 18 }, foodLevel: { type: 'int', value: 16 }, XpLevel: { type: 'int', value: 7 }, XpTotal: { type: 'int', value: 82 }, playerGameType: { type: 'int', value: 0 },
    Dimension: { type: 'string', value: 'minecraft:overworld' }, Pos: { type: 'list', value: { type: 'double', value: [1.5, 64, -3.25] } },
    Inventory: { type: 'list', value: { type: 'compound', value: [{ Slot: { type: 'byte', value: 5 }, id: { type: 'string', value: 'minecraft:player_head' }, count: { type: 'int', value: 1 }, components: { type: 'compound', value: { 'minecraft:custom_name': { type: 'string', value: '{"text":"大背包"}' } } } }] } }
  } };
  await fs.writeFile(path.join(gameDir, 'world/playerdata', uuidA + '.dat'), gzipSync(nbt.writeUncompressed(player)));
  const config = loadConfig({ skipLocalConfig: true, emailAuth: { registrationMode: 'username' }, host: '127.0.0.1', port: 0, dataDir: path.join(root, 'data'), serverDir: gameDir, opsDir, agentRegistry: path.join(opsDir, 'agent-eye-pairs.json'), authHeartbeat: path.join(opsDir, 'auth-heartbeat.json'), publicRoster: ['ag_Alpha', 'ag_Beta', 'Goddess'] });
  const game = new GameData(config, 'fixture-salt', async () => ({ online: true, playersOnline: 1, playersMax: 40, sample: [{ name: 'ag_Alpha', uuid: uuidA }], version: 'Paper fixture', observedAt: new Date().toISOString(), source: 'isolated-test-fixture', latencyMs: 1 }));
  const portal = createPortal(config, { game });
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + portal.server.address().port;
  const client = () => {
    let cookie = ''; let csrf = '';
    const request = async (endpoint, method = 'GET', body, overrides = {}) => {
      const headers = { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}), ...overrides };
      const response = await fetch(origin + '/api/v1' + endpoint, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const incomingCookie = response.headers.get('set-cookie'); if (incomingCookie) cookie = incomingCookie.split(';')[0];
      const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data, headers: response.headers };
    };
    return { request, init: () => request('/session'), signup: username => request('/accounts', 'POST', { username, password }), login: username => request('/sessions', 'POST', { username, password }), cookie: () => cookie };
  };
  const admin = client(); await admin.init();
  const setup = await admin.request('/setup', 'POST', { username: 'site-admin', password: initialPassword }); assert.equal(setup.status, 201);
  const roster = await game.roster(); const alpha = roster.find(row => row.name === 'ag_Alpha'); const beta = roster.find(row => row.name === 'ag_Beta');
  t.after(async () => {
    await portal.close();
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(fixtureBase + path.sep), 'Cleanup stays inside the isolated test directory');
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { portal, game, origin, admin, client, alpha, beta, root, gameDir };
}

test('six-character website passwords work for administrator setup, registration, change and login', async t => {
  const f = await fixture(t, 'abc123');
  const user = f.client(); await user.init();
  assert.equal((await user.request('/accounts', 'POST', { username: 'short-user', password: 'def456' })).status, 201);
  assert.equal((await user.request('/account/password', 'POST', { currentPassword: 'def456', newPassword: 'ghi789' })).status, 200);
  await user.request('/session', 'DELETE');
  assert.equal((await user.request('/sessions', 'POST', { username: 'short-user', password: 'ghi789' })).status, 200);
  const rejected = f.client(); await rejected.init();
  assert.equal((await rejected.request('/accounts', 'POST', { username: 'too-short', password: '12345' })).status, 400);
});

test('stale or future authentication heartbeats never assert an online authenticated role', () => {
  const now = Date.now();
  assert.equal(freshAuthentication({ ready: true, at: now - 5001, authorizedNames: ['Alpha'] }, now).fresh, false);
  assert.equal(freshAuthentication({ ready: true, at: now + 5000, authorizedNames: ['Alpha'] }, now).fresh, false);
  assert.equal(freshAuthentication({ ready: false, at: now, authorizedNames: ['Alpha'] }, now).fresh, false);
  assert.equal(freshAuthentication({ ready: true, at: now, authorizedNames: ['Alpha'] }, now).fresh, true);
});
test('a fresh authorized server sample identifies a new join before usercache flush, while conflicts remain blocked', async t => {
  const f = await fixture(t), name = 'ag_NewJoin', uuid = '44444444-4444-3444-8444-444444444444';
  f.game.config.publicRoster = [name];
  f.game.ping = async () => ({ online: true, playersOnline: 1, sample: [{ name, uuid }], observedAt: new Date().toISOString() });
  await fs.writeFile(f.game.config.authHeartbeat, JSON.stringify({ ready: true, at: Date.now(), authorizedNames: [name] })); f.game.cache.clear();
  let row = (await f.game.roster())[0]; assert.equal(row.playerUuid, uuid); assert.equal(row.available, true); assert.equal(row.identitySource, 'minecraft.server-list-ping.authorized-uuid');
  await fs.writeFile(f.game.config.authHeartbeat, JSON.stringify({ ready: true, at: Date.now() - 6000, authorizedNames: [name] })); f.game.cache.clear();
  row = (await f.game.roster())[0]; assert.equal(row.playerUuid, null);
  await fs.writeFile(f.game.config.authHeartbeat, JSON.stringify({ ready: true, at: Date.now(), authorizedNames: [name] }));
  await fs.writeFile(path.join(f.gameDir, 'usercache.json'), JSON.stringify([{ name, uuid: uuidB }])); f.game.cache.clear();
  row = (await f.game.roster())[0]; assert.equal(row.identityConflict, true); assert.equal(row.available, false);
});
test('native custom-name components preserve the real large-backpack name and raw item ID', () => {
  assert.equal(componentText('{"text":"大","extra":[{"text":"背包"}]}'), '大背包');
  const items = normalizeInventory([{ Slot: 33, id: 'minecraft:player_head', count: 1, components: { 'minecraft:custom_name': '{"text":"大背包"}' } }]);
  assert.deepEqual(items.map(i => [i.id, i.name, i.count]), [['minecraft:player_head', '大背包', 1]]);
});
test('server list ping decoder handles fragmented varints and rejects oversized encodings', () => {
  assert.equal(readVarint(Buffer.from([128])), null);
  assert.deepEqual(readVarint(Buffer.from([128, 1])), { value: 128, offset: 2 });
  assert.throws(() => readVarint(Buffer.from([255, 255, 255, 255, 255])));
});
test('server list ping handles fragmented real TCP responses without joining a game', async t => {
  const data = Buffer.from(JSON.stringify({ version: { name: 'Isolated fixture', protocol: 766 }, players: { online: 0, max: 40 } }));
  const encode = n => { const bytes = []; do { const byte = n & 127; n >>>= 7; bytes.push(byte | (n ? 128 : 0)); } while (n); return Buffer.from(bytes); };
  const payload = Buffer.concat([Buffer.from([0]), encode(data.length), data]);
  const frame = Buffer.concat([encode(payload.length), payload]);
  const tcp = net.createServer(socket => { socket.once('data', () => { socket.write(frame.subarray(0, 1)); setImmediate(() => socket.end(frame.subarray(1))); }); });
  await new Promise(resolve => tcp.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => tcp.close(resolve)));
  const status = await pingMinecraft('127.0.0.1', tcp.address().port, 1000);
  assert.equal(status.online, true); assert.equal(status.playersOnline, 0); assert.equal(status.version, 'Isolated fixture');
});
test('public endpoints reveal only public role information, not UUIDs, positions, inventory or IP addresses', async t => {
  const f = await fixture(t); const guest = f.client();
  const roster = await guest.request('/roster');
  assert.equal(roster.status, 200); const text = JSON.stringify(roster.data);
  for (const secret of [uuidA, '10.11.12.13', 'inventory', 'savedPosition']) assert.ok(!text.includes(secret));
  assert.equal((await guest.request(`/agents/${f.alpha.id}/state`)).status, 401);
  assert.equal((await guest.request('/account')).status, 401);
});
test('one-time administrator setup cannot be repeated; normal registration never gets administrator privileges', async t => {
  const f = await fixture(t); const visitor = f.client(); await visitor.init();
  assert.equal((await visitor.request('/setup', 'POST', { username: 'second-admin', password })).status, 403);
  const result = await visitor.signup('Alice'); assert.equal(result.status, 201); assert.equal(result.data.owner.role, 'owner');
  assert.match(result.headers.get('set-cookie'), /HttpOnly/); assert.match(result.headers.get('set-cookie'), /SameSite=Strict/);
  const stored = f.portal.store.ownerByName('alice'); assert.ok(stored.password_hash.startsWith('scrypt$')); assert.ok(!stored.password_hash.includes(password));
  assert.equal((await visitor.signup('ALICE')).status, 409);
});
test('CSRF, foreign origins and DNS-rebinding Host headers are rejected', async t => {
  const f = await fixture(t); const visitor = f.client(); await visitor.init();
  assert.equal((await visitor.request('/accounts', 'POST', { username: 'Eve', password }, { 'X-CSRF-Token': 'incorrect' })).status, 403);
  assert.equal((await visitor.request('/accounts', 'POST', { username: 'Eve', password }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await visitor.request('/accounts', 'POST', { username: 'Eve', password }, { 'X-CSRF-Token': 'é'.repeat(43) })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const request = http.get(f.origin + '/api/v1/server', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(status, 400);
  assert.equal(f.portal.store.ownerByName('Eve'), undefined);
});
test('ordinary owners cannot enumerate or read another owner’s role, even when they know its public ID', async t => {
  const f = await fixture(t); const alice = f.client(); const bob = f.client();
  await alice.init(); const account = await alice.signup('Alice'); await bob.init(); await bob.signup('Bob');
  const bound = await f.admin.request('/admin/bindings', 'POST', { ownerId: account.data.owner.id, agentId: f.alpha.id, confirmedOwnership: true, proof: '隔离夹具：已独立核对原主人身份与角色 UUID' }); assert.equal(bound.status, 201);
  assert.equal((await alice.request(`/agents/${f.alpha.id}/state`)).status, 200);
  assert.equal((await bob.request(`/agents/${f.alpha.id}/state`)).status, 404);
  assert.deepEqual((await bob.request('/agents')).data.agents, []);
  assert.equal((await alice.request('/admin/owners')).status, 403);
  assert.equal((await alice.request(`/agents/${f.beta.id}/state`)).status, 404);
});
test('manual bindings need independent proof, cannot capture reserved accounts or overwrite existing ownership', async t => {
  const f = await fixture(t); const adminId = (await f.admin.request('/session')).data.owner.id;
  const body = { ownerId: adminId, agentId: f.alpha.id, confirmedOwnership: true, proof: '隔离夹具：独立核验已有角色归属' };
  assert.equal((await f.admin.request('/admin/bindings', 'POST', { ...body, proof: '在线' })).status, 400);
  assert.equal((await f.admin.request('/admin/bindings', 'POST', {})).status, 400);
  const reserved = (await f.game.roster()).find(a => a.name === 'Goddess');
  assert.equal((await f.admin.request('/admin/bindings', 'POST', { ...body, agentId: reserved.id })).status, 403);
  assert.equal((await f.admin.request('/admin/bindings', 'POST', body)).status, 201);
  assert.equal((await f.admin.request('/admin/bindings', 'POST', body)).status, 409);
});
test('saved state preserves UUID, custom item names, true zeros and the distinction from live state', async t => {
  const f = await fixture(t); const response = await f.admin.request(`/agents/${f.alpha.id}/state`); const data = response.data;
  assert.equal(response.status, 200); assert.equal(data.agent.playerUuid, uuidA); assert.equal(data.freshness, 'saved');
  assert.equal(data.liveState.available, false); assert.equal(data.connectionEpoch, null); assert.equal(data.stats.deaths, 0);
  assert.equal(data.stats.mobKills, null); assert.equal(data.inventory[0].name, '大背包'); assert.deepEqual(data.savedPosition, [1.5, 64, -3.25]);
  assert.ok(!JSON.stringify(data).includes('10.11.12.13'));
});
test('missing NBT data is unavailable rather than fabricated as a blank inventory or zero vitals', async t => {
  const f = await fixture(t); const response = await f.admin.request(`/agents/${f.beta.id}/state`);
  assert.equal(response.status, 200); assert.equal(response.data.freshness, 'unavailable'); assert.equal(response.data.vitals, null); assert.ok(response.data.unavailableReason);
});
test('client credentials are scoped to one role; inventory needs a separate grant; tokens are hashed at rest', async t => {
  const f = await fixture(t); const created = await f.admin.request('/client-credentials', 'POST', { agentId: f.alpha.id, label: 'fixture-reader', scopes: ['state.read'] });
  assert.equal(created.status, 201); const token = created.data.token; assert.ok(token.startsWith('pat_'));
  const reader = f.client(); const headers = { Authorization: 'Bearer ' + token };
  const read = await reader.request(`/agents/${f.alpha.id}/state`, 'GET', undefined, headers);
  assert.equal(read.status, 200); assert.equal(read.data.inventory, undefined);
  assert.equal((await reader.request(`/agents/${f.beta.id}/state`, 'GET', undefined, headers)).status, 404);
  assert.equal((await reader.request('/account', 'GET', undefined, headers)).status, 403);
  assert.equal((await reader.request(`/agents/${f.alpha.id}/connection-config`, 'GET', undefined, headers)).status, 200);
  assert.equal((await reader.request(`/agents/${f.beta.id}/connection-config`, 'GET', undefined, headers)).status, 404);
  const stored = f.portal.store.db.prepare('SELECT * FROM credentials WHERE id=?').get(created.data.id);
  assert.notEqual(stored.token_hash, token); assert.equal(stored.token_hash.length, 64);
  assert.ok(!JSON.stringify((await f.admin.request('/client-credentials')).data).includes(token));
  assert.equal((await f.admin.request('/client-credentials', 'POST', { agentId: f.alpha.id, label: 'bad', scopes: ['state.read', 'action.execute'] })).status, 400);
});
test('revoking a credential blocks the next authorized read immediately', async t => {
  const f = await fixture(t); const created = await f.admin.request('/client-credentials', 'POST', { agentId: f.alpha.id, label: 'fixture-reader', scopes: ['state.read', 'inventory.read'] });
  const headers = { Authorization: 'Bearer ' + created.data.token }; const reader = f.client();
  assert.equal((await reader.request(`/agents/${f.alpha.id}/state`, 'GET', undefined, headers)).data.inventory[0].name, '大背包');
  assert.equal((await f.admin.request(`/client-credentials/${created.data.id}`, 'DELETE')).status, 200);
  assert.equal((await reader.request(`/agents/${f.alpha.id}/state`, 'GET', undefined, headers)).status, 401);
});
test('website password changes revoke other sessions and client tokens, while keeping the game profile unchanged', async t => {
  const f = await fixture(t); const other = f.client(); await other.init(); await other.login('site-admin');
  const token = (await f.admin.request('/client-credentials', 'POST', { agentId: f.alpha.id, label: 'fixture' })).data.token;
  const changed = await f.admin.request('/account/password', 'POST', { currentPassword: password, newPassword: 'new-isolated-test-password-2026' }); assert.equal(changed.status, 200);
  assert.equal((await other.request('/account')).status, 401);
  assert.equal((await f.client().request(`/agents/${f.alpha.id}/state`, 'GET', undefined, { Authorization: 'Bearer ' + token })).status, 401);
  assert.equal((await f.admin.request(`/agents/${f.alpha.id}/state`)).data.agent.playerUuid, uuidA);
  const fresh = f.client(); await fresh.init(); assert.equal((await fresh.login('site-admin')).status, 401);
  assert.equal((await fresh.request('/sessions', 'POST', { username: 'site-admin', password: 'new-isolated-test-password-2026' })).status, 200);
});
test('sensitive grants require recent website reauthentication', async t => {
  const f = await fixture(t);
  f.portal.store.db.prepare('UPDATE sessions SET verified_at=0 WHERE owner_id IS NOT NULL').run();
  assert.equal((await f.admin.request('/client-credentials', 'POST', { agentId: f.alpha.id, label: 'fixture' })).status, 403);
  assert.equal((await f.admin.request('/account/reauth', 'POST', { password })).status, 200);
  assert.equal((await f.admin.request('/client-credentials', 'POST', { agentId: f.alpha.id, label: 'fixture' })).status, 201);
});
test('missing game bridge does not pretend to create or claim a game account', async t => {
  const f = await fixture(t);
  for (const endpoint of ['/agents', '/agent-claims']) {
    const response = await f.admin.request(endpoint, 'POST', { name: 'ag_New', gamePassword: 'never-record-this-password' });
    assert.equal(response.status, 503); assert.equal(response.data.error.reason, 'AUTH_BRIDGE_NOT_CONNECTED');
  }
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS count FROM claims').get().count, 0);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS count FROM jobs').get().count, 0);
});
test('connection exports contain environment names and original identity, without secrets', async t => {
  const f = await fixture(t); const config = await f.admin.request(`/agents/${f.alpha.id}/connection-config`);
  assert.equal(config.data.playerUuid, uuidA); assert.equal(config.data.readOnly, true);
  assert.equal(config.data.gamePasswordEnv, 'MC_GAME_PASSWORD'); assert.equal(config.data.credentialEnv, 'QD_PORTAL_CLIENT_TOKEN');
  assert.ok(!JSON.stringify(config.data).includes(password));
});
test('private files, shell, RCON and arbitrary proxy routes are not exposed', async t => {
  const f = await fixture(t);
  for (const route of ['/.local/portal.sqlite', '/config.local.json', '/src/server.mjs', '/%2e%2e%5c.local/portal.sqlite', '/api/v1/rcon', '/api/v1/proxy?url=http://127.0.0.1:8088']) {
    const response = await fetch(f.origin + route); assert.equal(response.status, 404, route);
  }
  const css = await fetch(f.origin + '/styles.css'); assert.equal(css.status, 200); assert.match(css.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await f.admin.request('/accounts', 'POST', { username: 'Oversized', password: 'x'.repeat(17000) })).status, 413);
});
test('conflicting case-insensitive names are not silently remapped to a different player UUID', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.gameDir, 'usercache.json'), JSON.stringify([{ name: 'ag_Alpha', uuid: uuidA }, { name: 'AG_ALPHA', uuid: uuidB }]));
  f.game.cache.clear();
  const row = (await f.game.roster()).find(a => a.name.toLowerCase() === 'ag_alpha');
  assert.equal(row.identityConflict, true); assert.equal(row.playerUuid, null); assert.equal(row.available, false);
});
