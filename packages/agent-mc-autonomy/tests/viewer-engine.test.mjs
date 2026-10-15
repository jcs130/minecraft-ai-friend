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

  const [{ MinecraftWorld, Bridge, MINECRAFT_DEFAULTS }, { TacticalMinecraftWorld }] = await Promise.all([
    load('agent-mc-world/extension'), load('agent-mc-world/tactics'),
  ]);
  const directory = mkdtempSync(join(tmpdir(), 'mc-viewer-engine-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const consumer = join(directory, 'consumer');
  mkdirSync(join(consumer, 'node_modules', 'prismarine-nbt'), { recursive: true });
  writeFileSync(join(consumer, 'package.json'), '{}');
  // Only NBT presentation is fake; engine and bridge resolve through the actual
  // core package's export map, including in the isolated packed-consumer run.
  writeFileSync(join(consumer, 'node_modules', 'prismarine-nbt', 'index.js'), 'exports.simplify = value => value;');
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
  const fixture = {
    prepare: async options => {
      calls.push(['prepare', options]);
      return { registrySha256: 'registry', attach: options => {
        calls.push(['attach', options]);
        const view = { url: 'http://viewer.invalid/',
          status: () => ({ viewer: { available: true, reason: 'READY' }, selfPlayer: { uuid: 'body-id' } }),
          activeViewers: () => 1,
          listen: async () => { calls.push(['listen', view]); },
          close: async () => { calls.push(['view-close', view]); },
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
    stateFile: join(directory, 'viewer.json'), agentStateFile: join(directory, 'agent.json'), session: 'test-session', port: 0 };
  writeFileSync(config.catalogFile, JSON.stringify({ packs: [{ id: 'fixture', assetDirectory: 'assets', registrySha256: 'registry' }] }));
  const options = { cfg: { ...structuredClone(MINECRAFT_DEFAULTS), username: 'FixtureBody' },
    extension: { config } };
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
  for (const hook of ['extensionSpawn', 'extensionRealm', 'extensionCombatReport', 'disposeExtension'])
    assert.equal(viewer[hook], normal[hook], `tactical hook lost: ${hook}`);

  const host = { log: { warn: message => calls.push(['warn', message]) } };
  assert.equal(await viewer.start(host), 'core-started');
  assert.deepEqual(calls.find(call => call[0] === 'core-start'), ['core-start', viewer, host]);
  let coreBot;
  const bridge = viewer.createBridge({ host: 'game.invalid', port: 0,
    onBotCreated: bot => { coreBot = bot; calls.push(['core-bot', bot]); } });
  assert.ok(bridge instanceof Bridge);
  const bot = Object.assign(new EventEmitter(), { version: options.cfg.version, entity: {}, _client: { uuid: 'body-id' } });
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  bridge.opts.onBotCreated(bot); await flush();
  assert.equal(coreBot, bot);
  assert.equal(calls.find(call => call[0] === 'attach')[1].bot, bot);
  assert.equal(calls.find(call => call[0] === 'stream')[1], bot);
  assert.equal(JSON.parse(readFileSync(config.stateFile)).available, true);
  assert.equal(intervals.size, 1);

  bridge.opts.onBotCreated(bot); await flush();
  assert.equal(views.length, 2);
  assert.ok(calls.findIndex(call => call[0] === 'view-close' && call[1] === views[0])
    < calls.findIndex(call => call[0] === 'listen' && call[1] === views[1]));
  assert.equal(intervals.size, 1);
  await viewer.stop();
  assert.equal(intervals.size, 0);
  assert.equal(JSON.parse(readFileSync(config.stateFile)).reason, 'STOPPED');
  assert.ok(calls.some(call => call[0] === 'core-stop' && call[1] === viewer));
  bridge.opts.onBotCreated(bot); await flush();
  assert.equal(views.length, 2); // A late bot callback cannot attach after explicit stop.

  // The optional renderer failing still reaches the normal game startup path.
  fixture.prepare = async () => { throw Error('fake renderer unavailable'); };
  assert.equal(await viewer.start(host), 'core-started');
  assert.equal(JSON.parse(readFileSync(config.stateFile)).reason, 'VIEWER_PREPARE_FAILED');
  assert.ok(calls.some(call => call[0] === 'warn'));
  bridge.opts.onBotCreated(bot); await flush();
  assert.equal(views.length, 2);
  stopFailure = true;
  await assert.rejects(viewer.stop(), /fake core stop failure/);
  assert.equal(JSON.parse(readFileSync(config.stateFile)).reason, 'STOPPED');
  assert.equal(intervals.size, 0);
});
