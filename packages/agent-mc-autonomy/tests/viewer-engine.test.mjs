import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import childProcess from 'node:child_process';
import workerThreads from 'node:worker_threads';

// Explicit overrides let this same probe run against wheel-installed autonomy
// and a packed core consumer, without importing either package's private files.
const packageDirectory = resolve(process.env.AGENT_MC_WORLD_PACKAGE
  || fileURLToPath(new URL('../../agent-mc-world/', import.meta.url)));
const integrations = process.env.AGENT_MC_AUTONOMY_INTEGRATIONS
  ? pathToFileURL(resolve(process.env.AGENT_MC_AUTONOMY_INTEGRATIONS) + '/').href
  : new URL('../src/agent_mc_autonomy/integrations/', import.meta.url).href;
const require = createRequire(join(packageDirectory, 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)).href);

test('viewer preserves the default tactical engine and same-body lifecycle', async t => {
  const forbidden = () => { throw Error('Network, services and child processes are forbidden'); };
  for (const [object, methods] of [
    [net.Socket.prototype, ['connect']], [net.Server.prototype, ['listen']],
    [tls, ['connect']], [http, ['request', 'get']], [https, ['request', 'get']],
    [childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
    [workerThreads, ['Worker']], [globalThis, ['fetch']],
  ]) for (const method of methods) t.mock.method(object, method, forbidden);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  const [{ MinecraftWorld, Bridge, MINECRAFT_DEFAULTS, nativeGuiPresented }, { TacticalMinecraftWorld }] = await Promise.all([
    load('agent-mc-world/extension'), load('agent-mc-world/tactics'),
  ]);
  const directory = mkdtempSync(join(tmpdir(), 'mc-viewer-engine-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const consumer = join(directory, 'consumer');
  mkdirSync(join(consumer, 'node_modules'), { recursive: true });
  writeFileSync(join(consumer, 'package.json'), '{}');
  // A strict consumer installs only the public core. NBT belongs to its
  // declared Mineflayer dependency; do not hide a hoisting bug with a root stub.
  assert.throws(() => createRequire(join(consumer, 'package.json')).resolve('prismarine-nbt'), { code: 'MODULE_NOT_FOUND' });
  symlinkSync(dirname(require.resolve('agent-mc-world/package.json')), join(consumer, 'node_modules', 'agent-mc-world'), 'junction');
  const moduleUrl = new URL('viewer-engine.mjs', integrations);
  moduleUrl.searchParams.set('package', consumer);
  const { createEngine } = await import(moduleUrl.href);
  const calls = [], views = [], intervals = new Set();
  t.mock.method(globalThis, 'setInterval', callback => {
    const timer = { callback, unref() {} }; intervals.add(timer); return timer;
  });
  t.mock.method(globalThis, 'clearInterval', timer => intervals.delete(timer));
  // Fake the core service boundary, retaining real constructors/tools/tactics and
  // the viewer's actual start/createBridge/stop composition.
  t.mock.method(MinecraftWorld.prototype, 'start', async function(host) {
    calls.push(['core-start', this, host]); return 'core-started';
  });
  let stopFailure = false;
  t.mock.method(MinecraftWorld.prototype, 'stop', async function() {
    calls.push(['core-stop', this]); this.disposeExtension();
    if (stopFailure) throw Error('fake core stop failure');
  });
  let attachFailure = false, listenFailure = false;
  const fixture = {
    prepare: async options => {
      calls.push(['prepare', options]);
      return { registrySha256: 'registry', attach: options => {
        calls.push(['attach', options]);
        if (attachFailure) throw Error('fixture attach failed');
        const view = { url: 'http://viewer.invalid/', clients: 1, ended: false, ready: true, playerUuid: 'body-id', statusReads: 0,
          world: { epoch: 1, error: null, dimension: {}, pose: {} }, server: { listening: false },
          status: () => { view.statusReads++; return { viewer: { available: view.ready, reason: 'READY', state: 'snapshot', epoch: view.world.epoch },
            identity: { confirmed: true, playerUuid: view.playerUuid, epoch: view.world.epoch },
            connection: { ended: view.ended }, selfPlayer: { uuid: view.playerUuid, name: 'FixtureBody', entityId: 1 },
            presentation: { available: true, playerUuid: view.playerUuid, nativeState: { available: true } } }; },
          activeViewers: () => view.clients,
          listen: async () => { calls.push(['listen', view]); if (listenFailure) throw Error('fixture listen failed'); view.server.listening = true; },
          close: async () => { calls.push(['view-close', view]); view.server.listening = false; },
        };
        views.push(view); return view;
      } };
    },
    observe: (bot, registry, version) => {
      calls.push(['stream', bot, registry, version]);
      return { close: () => calls.push(['stream-close', bot]) };
    },
  };
  globalThis.__viewerEngineFixture = fixture;
  t.after(() => { delete globalThis.__viewerEngineFixture; });
  for (const [file, source] of Object.entries({
    'tools/native-world-preview-host.mjs': 'export const prepareNativeWorldPreviewHost = options => globalThis.__viewerEngineFixture.prepare(options);',
    'host/viewer-pack-selection.mjs': 'export const selectViewerPack = (packs, cfg) => ({ available: true, pack: packs[0], minecraftVersion: cfg.minecraftVersion });',
    'host/vanilla-native-stream.mjs': 'export const observeVanillaNativeStream = (...args) => globalThis.__viewerEngineFixture.observe(...args); export const vanillaPlayerPresentation = bot => ({ uuid: bot._client.uuid });',
  })) {
    const path = join(directory, file); mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, source);
  }
  const config = { rendererDirectory: directory, catalogFile: join(directory, 'catalog.json'),
    defaultAppearance: 'bundled:yui-ysm',
    selectionScope: 'a'.repeat(24),
    stateFile: join(directory, 'viewer.json'), agentStateFile: join(directory, 'agent.json'), session: 'test-session', port: 0 };
  writeFileSync(config.catalogFile, JSON.stringify({ packs: [{ id: 'fixture', assetDirectory: 'assets', registrySha256: 'registry' }] }));
  const options = { cfg: { ...structuredClone(MINECRAFT_DEFAULTS), username: 'FixtureBody' },
    extension: { config } };
  const tacticalDispose = t.mock.method(TacticalMinecraftWorld.prototype, 'disposeExtension');
  const normal = new TacticalMinecraftWorld(options), viewer = createEngine(options);
  t.after(() => { normal.disposeExtension(); viewer.disposeExtension(); });
  assert.deepEqual(viewer.tools().map(tool => tool.name), normal.tools().map(tool => tool.name));
  assert.ok(viewer instanceof TacticalMinecraftWorld);
  for (const name of ['mc_combat_tactic', 'mc_do', 'mc_script', 'mc_scout']) {
    const actual = viewer.tools().find(tool => tool.name === name);
    const expected = normal.tools().find(tool => tool.name === name);
    assert.ok(actual && expected, `missing required tool ${name}`);
    assert.ok(actual.parameters);
    assert.deepEqual(actual.parameters, expected.parameters);
  }
  const tactic = viewer.tools().find(tool => tool.name === 'mc_combat_tactic');
  const battlefield = await tactic.handler({ battlefield: true }, { role: 'host-decision' });
  assert.equal(battlefield.meta.protocol, 'agent-mc-tactics/v1');
  assert.equal(battlefield.meta.frame, null); // Disconnected sampling cannot return invented facts.
  for (const hook of ['extensionSpawn', 'extensionRealm', 'extensionCombatReport'])
    assert.equal(viewer[hook], normal[hook], `tactical hook lost: ${hook}`);

  const host = { log: { warn: message => calls.push(['warn', message]) } };
  assert.equal(await viewer.start(host), 'core-started');
  assert.equal(calls.find(call => call[0] === 'prepare')[1].defaultAppearance, 'bundled:yui-ysm');
  assert.equal(calls.find(call => call[0] === 'prepare')[1].selectionScope, config.selectionScope);
  assert.deepEqual(calls.find(call => call[0] === 'core-start'), ['core-start', viewer, host]);
  let coreBot;
  const bridge = viewer.createBridge({ host: 'game.invalid', port: 0,
    onBotCreated: bot => { coreBot = bot; calls.push(['core-bot', bot]); } });
  assert.ok(bridge instanceof Bridge);
  const bot = Object.assign(new EventEmitter(), { version: options.cfg.version, username: 'FixtureBody',
    entity: { id: 1, position: { x: 0, y: 64, z: 0 } }, inventory: { slots: [] }, _client: { uuid: 'body-id' } });
  // Fake only the established game connection; the bridge's actual viewer
  // accessors must bind the same presentation used by the core visual tool.
  let connectedBot = bot;
  Object.defineProperty(bridge, 'bot', { get: () => connectedBot });
  assert.equal(bridge.viewerUrl, null);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  bridge.opts.onBotCreated(bot); await flush();
  assert.equal(coreBot, bot);
  assert.equal(calls.find(call => call[0] === 'attach')[1].bot, bot);
  assert.equal(calls.find(call => call[0] === 'stream')[1], bot);
  assert.equal(JSON.parse(readFileSync(config.stateFile)).available, true);
  assert.equal(intervals.size, 1);
  assert.equal(nativeGuiPresented(bot), true);
  const active = views[0];
  assert.equal(bridge.viewerUrl, active.url, 'core photography must see the actual same-body viewer');
  assert.equal(bridge.viewerKind, 'modern');
  connectedBot = null; assert.equal(bridge.viewerUrl, null);
  connectedBot = Object.assign({}, bot); assert.equal(bridge.viewerUrl, null);
  connectedBot = bot;
  active.server.listening = false; assert.equal(bridge.viewerUrl, null);
  active.server.listening = true;
  const publish = () => { for (const timer of intervals) timer.callback(); };
  const initialReads = active.statusReads;
  for (let i = 0; i < 100; i++) assert.equal(nativeGuiPresented(bot), true);
  assert.equal(active.statusReads, initialReads, 'pacing must not rebuild full viewer status');
  for (const [key, value] of [['ready', false], ['ended', true], ['playerUuid', 'foreign']]) {
    const before = active[key]; active[key] = value;
    publish();
    assert.equal(nativeGuiPresented(bot), false, `stale presentation admitted: ${key}`);
    active[key] = before; publish();
  }
  for (const [owner, key, value] of [[active, 'clients', 0], [active.world, 'error', 'ended'],
    [active.world, 'pose', null], [active.server, 'listening', false], [bot, 'username', 'foreign'],
    [bot._client, 'uuid', 'foreign'], [bot, '_client', { uuid: 'body-id' }],
    [bot, 'entity', { id: 1, position: { x: 0, y: 64, z: 0 } }],
    [bot.entity, 'id', 2], [bot.entity, 'isValid', false], [bot.inventory, 'slots', null]]) {
    const before = owner[key]; owner[key] = value;
    assert.equal(nativeGuiPresented(bot), false, `current state not checked: ${key}`);
    owner[key] = before; assert.equal(nativeGuiPresented(bot), true);
  }
  const now = Date.now(), clock = t.mock.method(Date, 'now', () => now + 1501);
  assert.equal(nativeGuiPresented(bot), false, 'admission expires if publication stops');
  clock.mock.restore(); publish();
  assert.equal(nativeGuiPresented(Object.assign(new EventEmitter(), { entity: { id: 1 } })), false);
  active.world.epoch++; assert.equal(nativeGuiPresented(bot), false); // revoke before next full admission
  publish(); assert.equal(nativeGuiPresented(bot), true); // new operations bind the current epoch
  bridge.opts.onBotCreated(bot);
  assert.equal(nativeGuiPresented(bot), false); // old binding revoked before replacement listen
  assert.equal(bridge.viewerUrl, null, 'obsolete capture binding is revoked before replacement listen');
  await flush();
  assert.equal(views.length, 2);
  assert.ok(calls.findIndex(call => call[0] === 'view-close' && call[1] === views[0])
    < calls.findIndex(call => call[0] === 'listen' && call[1] === views[1]));
  assert.equal(intervals.size, 1);
  await viewer.stop();
  assert.equal(bridge.viewerUrl, null);
  assert.equal(bridge.viewerKind, null);
  assert.equal(nativeGuiPresented(bot), false);
  assert.equal(intervals.size, 0);
  assert.equal(JSON.parse(readFileSync(config.stateFile)).reason, 'STOPPED');
  assert.ok(calls.some(call => call[0] === 'core-stop' && call[1] === viewer));
  assert.ok(tacticalDispose.mock.calls.some(call => call.this === viewer));
  bridge.opts.onBotCreated(bot); await flush();
  assert.equal(views.length, 2); // A late bot callback cannot attach after explicit stop.

  await viewer.start(host);
  listenFailure = true;
  bridge.opts.onBotCreated(bot); await flush();
  assert.equal(nativeGuiPresented(bot), false);
  assert.equal(intervals.size, 0);
  assert.equal(JSON.parse(readFileSync(config.stateFile)).reason, 'VIEWER_LISTEN_FAILED');
  assert.ok(calls.some(call => call[0] === 'view-close' && call[1] === views.at(-1)));
  listenFailure = false; attachFailure = true;
  bridge.opts.onBotCreated(bot); await flush();
  assert.equal(nativeGuiPresented(bot), false);
  assert.equal(JSON.parse(readFileSync(config.stateFile)).reason, 'VIEWER_ATTACH_FAILED');
  attachFailure = false;
  const viewCount = views.length;

  // The optional renderer failing still reaches the normal game startup path.
  fixture.prepare = async () => { throw Error('fake renderer unavailable'); };
  assert.equal(await viewer.start(host), 'core-started');
  assert.equal(JSON.parse(readFileSync(config.stateFile)).reason, 'VIEWER_PREPARE_FAILED');
  assert.ok(calls.some(call => call[0] === 'warn'));
  bridge.opts.onBotCreated(bot); await flush();
  assert.equal(views.length, viewCount);
  stopFailure = true;
  await assert.rejects(viewer.stop(), /fake core stop failure/);
  assert.equal(JSON.parse(readFileSync(config.stateFile)).reason, 'STOPPED');
  assert.equal(intervals.size, 0);
});
