import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { loadConfig, projectRoot } from '../src/config.mjs';
import { GameData } from '../src/game-data.mjs';
import { buildSnapshot } from '../src/cloud-source.mjs';
import { createPortal } from '../src/server.mjs';

const camera = { name: 'ag_PhotoLens', uuid: 'ff58a81b-f033-3b74-a7cf-58ac4e798bb0' };
const human = { name: 'Alice', uuid: '11111111-1111-3111-8111-111111111111' };
const agent = { name: 'ag_Alpha', uuid: '22222222-2222-3222-8222-222222222222' };
const eye = { name: 'AlphaEye', uuid: '33333333-3333-3333-8333-333333333333' };
const policy = 'photo-observer-excluded-v1';
const encode = n => {
  const bytes = [];
  do { const byte = n & 127; n >>>= 7; bytes.push(byte | (n ? 128 : 0)); } while (n);
  return Buffer.from(bytes);
};

async function fixture(t) {
  const root = path.join(projectRoot, '.local/tests', 'photo-count-' + randomUUID());
  await fs.mkdir(path.join(root, 'game'), { recursive: true });
  const config = loadConfig({ skipLocalConfig: true, host: '127.0.0.1', port: 0,
    serverDir: path.join(root, 'game'), opsDir: root, dataDir: path.join(root, 'cloud'),
    authHeartbeat: path.join(root, 'heartbeat.json'), agentRegistry: path.join(root, 'pairs.json'),
    portalIdentitiesFile: path.join(root, 'identities.json'), publicRoster: [], hiddenPlayers: [], includeKnownPlayers: true,
    sourceMode: 'cloud', authBridge: { enabled: false },
    cloudSync: { enabled: true, tokenHash: createHash('sha256').update('srv_' + 'f'.repeat(43)).digest('hex') } });
  await fs.writeFile(path.join(config.serverDir, 'usercache.json'), JSON.stringify([human, agent, eye, camera]));
  await fs.writeFile(config.agentRegistry, JSON.stringify({ pairs: [{ agent: agent.name, eye: eye.name }] }));
  let players = {}, portal;
  const tcp = net.createServer(socket => socket.once('data', () => {
    const json = Buffer.from(JSON.stringify({ version: { name: 'isolated', protocol: 767 }, players }));
    const body = Buffer.concat([Buffer.from([0]), encode(json.length), json]);
    socket.end(Buffer.concat([encode(body.length), body]));
  }));
  await new Promise(resolve => tcp.listen(0, '127.0.0.1', resolve));
  const game = new GameData({ ...config, sourceMode: 'local', gameHost: '127.0.0.1', gamePort: tcp.address().port }, 'test');
  async function start() {
    portal = createPortal(config); await portal.ready;
    await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  }
  await start();
  t.after(async () => {
    await portal.close(); await new Promise(resolve => tcp.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const get = async route => (await fetch(`http://127.0.0.1:${portal.server.address().port}/api/v1/${route}`)).json();
  const put = body => fetch(`http://127.0.0.1:${portal.server.address().port}/api/v1/internal/snapshot`, {
    method: 'PUT', headers: { Authorization: 'Bearer srv_' + 'f'.repeat(43), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { game, get, put, get portal() { return portal; },
    async restart() { await portal.close(); await start(); },
    async scenario({ total, sample, cameraOnline = false, heartbeatAge = 0 }) {
      players = { online: total, max: 40, ...(sample === undefined ? {} : { sample: sample.map(row => ({ name: row.name, id: row.uuid })) }) };
      await fs.writeFile(config.authHeartbeat, JSON.stringify({ ready: true, at: Date.now() - heartbeatAge,
        authorizedNames: [human.name, agent.name, eye.name, ...(cameraOnline ? [camera.name] : [])] }));
      game.cache.clear();
    },
    async snapshot(sequence = 1) {
      const world = { players: async () => ({ players: [human, agent, eye, camera].map(row => ({ name: row.name, growth: { level: 1 } })) }),
        events: async () => ({ events: [], pages: 1 }) };
      return buildSnapshot(game, world, sequence);
    }
  };
}

// The actual camera state is deliberately separate from the published sample.
// Authorization is a proxy fact, not proof of admission to the pinged backend.
const scenarios = [
  { title: 'omitted sample, camera online', total: 4, cameraOnline: true, expected: null },
  { title: 'empty sample, camera online', total: 4, sample: [], cameraOnline: true, expected: null },
  { title: 'partial sample misses online camera', total: 4, sample: [human, agent], cameraOnline: true, expected: null },
  { title: 'empty sample, camera offline', total: 3, sample: [], expected: null },
  { title: 'partial sample, camera offline', total: 3, sample: [human], expected: null },
  { title: 'partial sample proves camera online', total: 4, sample: [camera, human], cameraOnline: true, expected: 3 },
  { title: 'full sample with camera', total: 4, sample: [human, agent, eye, camera], cameraOnline: true, expected: 3 },
  { title: 'full sample without camera keeps human, Agent and Eye', total: 3, sample: [human, agent, eye], expected: 3 },
  { title: 'zero connections needs no camera guess', total: 0, sample: [], expected: 0 },
  { title: 'camera is the only connection', total: 1, sample: [camera], cameraOnline: true, expected: 0 },
  { title: 'UUID identifies renamed camera', total: 4, sample: [{ ...camera, name: 'RenamedCamera' }], expected: 3 },
  { title: 'case-insensitive name identifies camera without UUID', total: 4, sample: [{ name: camera.name.toUpperCase() }], expected: 3 },
  { title: 'repeated camera evidence is deducted once', total: 4, sample: [camera, camera], expected: 3 },
  { title: 'duplicate UUIDs are not a complete sample', total: 3, sample: [human, human, agent], expected: null },
  { title: 'duplicate names are not a complete sample', total: 3, sample: [human, { ...agent, name: human.name }, eye], expected: null },
  { title: 'anonymous zero UUIDs do not establish completeness', total: 1, sample: [{ name: 'Anonymous Player', uuid: '00000000-0000-0000-0000-000000000000' }], expected: null },
  { title: 'stale authorization cannot supply missing evidence', total: 4, sample: [], cameraOnline: true, heartbeatAge: 6000, expected: null },
  { title: 'proxy authentication can precede backend entry', total: 3, sample: [human, agent, eye], cameraOnline: true, expected: 3 },
  { title: 'sample contradicting zero count is unknown', total: 0, sample: [camera], expected: null },
  { title: 'negative connection total is unknown', total: -1, sample: [], expected: null },
  { title: 'missing total is unknown even with camera evidence', sample: [camera], expected: null }
];

for (const scenario of scenarios) test(`home → filtered snapshot → cloud restart: ${scenario.title}`, async t => {
  const f = await fixture(t); await f.scenario(scenario);
  const home = await f.game.serverSummary();
  const snapshot = await f.snapshot();
  assert.ok(!snapshot.roster.some(row => row.name === camera.name));
  assert.ok(!snapshot.players.some(row => row.name === camera.name));
  assert.ok(!Object.hasOwn(snapshot.states, camera.uuid));
  assert.equal(snapshot.roster.find(row => row.name === agent.name).eye, eye.name, 'internal Eye pairing survives');
  assert.equal((await f.put(snapshot)).status, 200);
  assert.equal((await (await f.put(snapshot)).json()).duplicate, true);
  const cloud = await f.get('server');
  await f.restart();
  const restored = await f.get('server');
  for (const [stage, summary] of Object.entries({ home, snapshot: snapshot.summary, cloud, restored })) {
    assert.equal(summary.playersOnline, scenario.expected, stage);
    assert.equal(summary.playerCountPolicy, policy, stage);
    assert.equal(typeof summary.playersOnlineUnavailableReason, scenario.expected === null ? 'string' : 'object', stage);
    assert.equal(summary.rosterCount, 3, stage);
    assert.equal(summary.agentCount, 1, stage);
  }
  assert.deepEqual((await f.get('roster')).agents.map(row => row.name).sort(), [human.name, agent.name].sort());
  assert.deepEqual((await f.get('world/players')).players.map(row => row.name).sort(), [human.name, agent.name].sort());
  assert.equal((await (await f.put(snapshot)).json()).duplicate, true, 'restart preserves exact snapshot replay');
});

function legacy(rows, count = 4) {
  return { schemaVersion: 1, sequence: 1, observedAt: new Date().toISOString(),
    summary: { online: true, playersOnline: count, rosterCount: rows.length, agentCount: rows.filter(row => row.kind === 'agent').length },
    roster: rows, players: [], states: {}, events: [] };
}
const legacyRow = (row, kind, online = true) => ({ name: row.name, playerUuid: row.uuid, kind, online, available: true });

test('successive online, offline and unknown snapshots do not carry a previous deduction forward', async t => {
  const f = await fixture(t); let sequence = 0;
  for (const scenario of [
    { total: 4, sample: [camera], cameraOnline: true, expected: 3 },
    { total: 3, sample: [human, agent, eye], expected: 3 },
    { total: 3, sample: [], expected: null },
    { total: 4, sample: [camera], cameraOnline: true, expected: 3 }
  ]) {
    await f.scenario(scenario);
    const snapshot = await f.snapshot(++sequence);
    assert.equal((await f.put(snapshot)).status, 200);
    assert.equal((await f.game.serverSummary()).playersOnline, scenario.expected);
    assert.equal((await f.get('server')).playersOnline, scenario.expected);
    await f.restart();
    assert.equal((await f.get('server')).playersOnline, scenario.expected);
  }
});

test('legacy unfiltered roster deducts one camera connection even with UUID aliases; disk and replay remain unchanged', async t => {
  const f = await fixture(t);
  const old = legacy([legacyRow(human, 'player'), legacyRow(agent, 'agent'), legacyRow(eye, 'observer'),
    legacyRow(camera, 'agent'), legacyRow({ ...camera, name: 'RenamedCamera' }, 'agent')]);
  assert.equal((await f.put(old)).status, 200);
  const before = f.portal.cloud.read();
  for (let repeat = 0; repeat < 2; repeat++) {
    const summary = await f.get('server');
    assert.deepEqual([summary.playersOnline, summary.rosterCount, summary.agentCount], [3, 3, 1]);
    assert.equal(f.portal.cloud.read().payload, before.payload);
    assert.equal(f.portal.cloud.read().body_hash, before.body_hash);
    assert.equal((await (await f.put(old)).json()).duplicate, true);
    await f.restart();
  }
});

test('unversioned filtered snapshots and false/unknown legacy camera presence cannot assert an exact count', async t => {
  const f = await fixture(t); let sequence = 0;
  for (const rows of [[], [legacyRow(camera, 'agent', false)], [legacyRow(camera, 'agent', null)]]) {
    const old = legacy(rows); old.sequence = ++sequence;
    assert.equal((await f.put(old)).status, 200);
    const summary = await f.get('server');
    assert.equal(summary.playersOnline, null);
    assert.ok(summary.playersOnlineUnavailableReason);
    assert.equal((await (await f.put(old)).json()).duplicate, true);
  }
});

test('buildSnapshot normalizes legacy counts before discarding the camera and cloud does not deduct twice', async t => {
  const f = await fixture(t), rows = [legacyRow(human, 'player'), legacyRow(camera, 'agent')];
  const original = legacy(rows, 2);
  const game = { roster: async () => rows, serverSummary: async () => original.summary,
    playerState: async () => ({ freshness: 'saved' }) };
  const world = { players: async () => ({ players: [] }), events: async () => ({ events: [], pages: 1 }) };
  const snapshot = await buildSnapshot(game, world, 1);
  assert.equal((await f.put(snapshot)).status, 200);
  assert.deepEqual(snapshot.roster.map(row => row.name), [human.name]);
  assert.deepEqual([snapshot.summary.playersOnline, (await f.get('server')).playersOnline], [1, 1]);
  assert.equal(original.summary.playersOnline, 2, 'never rewrite the old input');
  // Even if an adapter still includes an internal camera row, the explicit
  // count policy takes precedence; it is not another raw connection total.
  const marked = { ...original, sequence: 2, observedAt: new Date().toISOString(), summary: { ...snapshot.summary } };
  assert.equal((await f.put(marked)).status, 200);
  assert.deepEqual((await Promise.all([f.get('server'), f.get('server')])).map(row => row.playersOnline), [1, 1]);
  const relay = await buildSnapshot({ ...game, serverSummary: async () => snapshot.summary }, world, 3);
  assert.equal((await f.put(relay)).status, 200);
  await f.restart();
  const restored = await f.get('server');
  assert.deepEqual([restored.playersOnline, restored.rosterCount, restored.agentCount], [1, 1, 0]);
});

test('stale cloud snapshots and stale local ping cannot claim a current count', async t => {
  const f = await fixture(t); await f.scenario({ total: 4, sample: [camera] });
  assert.equal((await f.put(await f.snapshot())).status, 200);
  f.portal.store.db.prepare('UPDATE server_snapshot SET observed_at=? WHERE id=1').run(Date.now() - 60000);
  const summary = await f.get('server');
  assert.equal(summary.playersOnline, null); assert.ok(summary.playersOnlineUnavailableReason);
  for (const change of [{ observedAt: new Date(Date.now() - 6000).toISOString() },
    { observedAt: new Date(Date.now() + 10000).toISOString() }, { observedAt: undefined }, { online: null }]) {
    f.game.status = async () => ({ online: true, playersOnline: 4, sample: [camera], observedAt: new Date().toISOString(), ...change });
    assert.equal((await f.game.serverSummary()).playersOnline, null);
  }
});

test('invalid count policy cannot replace or alter a committed snapshot', async t => {
  const f = await fixture(t); await f.scenario({ total: 4, sample: [camera] });
  const good = await f.snapshot(); assert.equal((await f.put(good)).status, 200);
  const saved = f.portal.cloud.read();
  for (const change of [{ playerCountPolicy: 'future-unknown-policy' }, { playersOnline: -1 },
    { playersOnline: 1.5 }, { playersOnline: '3' }, { playersOnline: null, playersOnlineUnavailableReason: null },
    { playersOnline: 3, playersOnlineUnavailableReason: 'conflicting' }]) {
    const bad = structuredClone(good); bad.sequence = 2; Object.assign(bad.summary, change);
    const response = await f.put(bad);
    assert.equal(response.status, 400); assert.equal((await response.json()).error.reason, 'SNAPSHOT_COUNT');
    assert.equal(f.portal.cloud.read().body_hash, saved.body_hash);
  }
  assert.equal((await (await f.put(good)).json()).duplicate, true);
});
