import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const packageDirectory = resolve(process.env.AGENT_MC_WORLD_PACKAGE
  || fileURLToPath(new URL('../../agent-mc-world/', import.meta.url)));
const integrations = process.env.AGENT_MC_AUTONOMY_INTEGRATIONS
  ? pathToFileURL(resolve(process.env.AGENT_MC_AUTONOMY_INTEGRATIONS) + '/').href
  : new URL('../src/agent_mc_autonomy/integrations/', import.meta.url).href;
const require = createRequire(join(packageDirectory, 'package.json'));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function fixture(t) {
  const forbidden = () => { throw Error('Network, services and child processes are forbidden'); };
  for (const [object, methods] of [
    [net.Socket.prototype, ['connect']], [net.Server.prototype, ['listen']],
    [tls, ['connect']], [http, ['request', 'get']], [https, ['request', 'get']],
    [childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
    [workerThreads, ['Worker']], [globalThis, ['fetch']],
  ]) for (const method of methods) t.mock.method(object, method, forbidden);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const { MinecraftWorld, MINECRAFT_DEFAULTS } = await import(pathToFileURL(require.resolve('agent-mc-world/extension')).href);
  const directory = fs.mkdtempSync(join(tmpdir(), 'mc-viewer-persistence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const consumer = join(directory, 'consumer');
  fs.mkdirSync(join(consumer, 'node_modules', 'prismarine-nbt'), { recursive: true });
  fs.writeFileSync(join(consumer, 'package.json'), '{}');
  fs.writeFileSync(join(consumer, 'node_modules', 'prismarine-nbt', 'index.js'), 'exports.simplify = value => value;');
  fs.symlinkSync(dirname(require.resolve('agent-mc-world/package.json')), join(consumer, 'node_modules', 'agent-mc-world'), 'junction');
  const moduleUrl = new URL('viewer-engine.mjs', integrations); moduleUrl.searchParams.set('package', consumer);
  const { createEngine } = await import(moduleUrl.href);
  const timers = new Set(), views = [], warnings = [], calls = [];
  t.mock.method(globalThis, 'setInterval', callback => {
    const timer = { callback, unref() {} }; timers.add(timer); return timer;
  });
  t.mock.method(globalThis, 'clearInterval', timer => timers.delete(timer));
  t.mock.method(MinecraftWorld.prototype, 'start', async () => { calls.push('game-start'); return 'started'; });
  t.mock.method(MinecraftWorld.prototype, 'stop', async function() { calls.push('game-stop'); this.disposeExtension(); });
  const control = { listen: async () => {}, close: async () => {} };
  globalThis.__viewerPersistenceFixture = {
    prepare: async () => ({ registrySha256: 'registry', attach: () => {
      const view = { url: 'http://fixture.invalid/', revision: 0,
        status: () => ({ viewer: { available: true, reason: `READY-${view.revision}` } }),
        listen: () => { calls.push(['listen', view]); return control.listen(view); },
        close: () => { calls.push(['close', view]); return control.close(view); },
      };
      views.push(view); return view;
    } }),
  };
  t.after(() => { delete globalThis.__viewerPersistenceFixture; });
  for (const [file, source] of Object.entries({
    'tools/native-world-preview-host.mjs': 'export const prepareNativeWorldPreviewHost = () => globalThis.__viewerPersistenceFixture.prepare();',
    'host/viewer-pack-selection.mjs': 'export const selectViewerPack = (packs, cfg) => ({ available: true, pack: packs[0], minecraftVersion: cfg.minecraftVersion });',
    'host/vanilla-native-stream.mjs': 'export const observeVanillaNativeStream = () => ({close(){}}); export const vanillaPlayerPresentation = () => ({});',
  })) {
    const path = join(directory, file); fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, source);
  }
  const config = { rendererDirectory: directory, catalogFile: join(directory, 'catalog.json'),
    stateFile: join(directory, 'viewer.json'), session: 'fixture-session', port: 0 };
  fs.writeFileSync(config.catalogFile, JSON.stringify({ packs: [{ id: 'fixture', registrySha256: 'registry', assetDirectory: 'assets' }] }));
  const host = { log: { warn: message => warnings.push(message) } };
  const options = { cfg: { ...structuredClone(MINECRAFT_DEFAULTS), username: 'FixtureBody' }, extension: { config } };
  const engines = [];
  const engine = () => { const value = createEngine(options); engines.push(value); return value; };
  t.after(async () => { for (const value of engines) await value.stop(); });
  const connect = value => {
    const bot = Object.assign(new EventEmitter(), { version: options.cfg.version, entity: {}, _client: { uuid: 'body-id' } });
    value.createBridge({ host: 'game.invalid', port: 0 }).opts.onBotCreated(bot); return bot;
  };
  const read = () => JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
  const tick = () => { for (const timer of [...timers]) timer.callback(); };
  return { directory, config, host, engine, connect, read, tick, timers, views, warnings, calls, control };
}

test('transient publish failure preserves complete target, deduplicates diagnostics, and latest update recovers', async t => {
  const f = await fixture(t), value = f.engine();
  await value.start(f.host); f.connect(value); await flush();
  const original = fs.readFileSync(f.config.stateFile, 'utf8'), rename = fs.renameSync, temporary = [];
  let fail = true;
  t.mock.method(fs, 'renameSync', (from, to) => {
    temporary.push(from);
    assert.equal(JSON.parse(fs.readFileSync(from, 'utf8')).session, 'fixture-session');
    if (fail) throw Object.assign(Error('private pathname and payload'), { code: 'EPERM' });
    rename(from, to);
  }); syncBuiltinESMExports();
  f.views[0].revision = 1;
  assert.doesNotThrow(f.tick);
  f.views[0].revision = 2;
  for (let i = 0; i < 50; i++) assert.doesNotThrow(f.tick);
  assert.equal(fs.readFileSync(f.config.stateFile, 'utf8'), original);
  assert.equal(f.warnings.length, 1);
  assert.match(f.warnings[0], /EPERM/); assert.doesNotMatch(f.warnings[0], /private/);
  assert.equal(f.calls.filter(c => c === 'game-stop').length, 0);
  fail = false; f.tick();
  assert.equal(f.read().reason, 'READY-2');
  assert.ok(f.warnings.some(message => /recover/i.test(message)));
  // Repeated failure/recovery flaps are bounded by the diagnostic cooldown.
  for (let i = 0; i < 20; i++) { fail = true; f.tick(); fail = false; f.tick(); }
  assert.equal(f.warnings.length, 2);
  assert.equal(new Set(temporary).size, temporary.length);
  assert.deepEqual(fs.readdirSync(f.directory).filter(name => name.endsWith('.tmp')), []);
});

test('permanent write/rename errors cannot reject startup, events, or stop and only owned temps are cleaned', async t => {
  const f = await fixture(t), value = f.engine(), other = f.engine();
  fs.writeFileSync(f.config.stateFile, JSON.stringify({ reason: 'OLD', updated_at: 'old' }));
  const foreign = f.config.stateFile + '.tmp'; fs.writeFileSync(foreign, 'other writer');
  const write = fs.writeFileSync, open = fs.openSync, names = [];
  let code = 'EACCES', writeFailure = false;
  t.mock.method(fs, 'openSync', (path, ...args) => {
    names.push(path); return open(path, ...args);
  });
  t.mock.method(fs, 'writeFileSync', (path, ...args) => {
    if (typeof path === 'number' && writeFailure) {
      write(path, '{'); // Partial owned temp must never become a target snapshot.
      throw Object.assign(Error('private'), { code: 'ENOSPC' });
    }
    return write(path, ...args);
  });
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(Error('private'), { code }); });
  syncBuiltinESMExports();
  assert.equal(await value.start(f.host), 'started');
  assert.equal(await other.start(f.host), 'started');
  const bot = f.connect(value); f.connect(other); await flush();
  for (code of ['EACCES', 'EBUSY', 'EIO']) { f.tick(); await flush(); }
  writeFailure = true; f.tick(); await flush();
  assert.doesNotThrow(() => bot.emit('end')); await flush();
  await value.stop(); await other.stop();
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.read(), { reason: 'OLD', updated_at: 'old' });
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'other writer');
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(fs.readdirSync(f.directory).filter(name => name.endsWith('.tmp')), ['viewer.json.tmp']);
  assert.ok(f.warnings.every(message => !message.includes('private')));
  assert.ok(f.warnings.some(message => message.includes('write:ENOSPC')));
});

for (const outcome of ['resolve', 'reject']) test(`dispose and reconnect drain obsolete ${outcome} listeners without late publication`, async t => {
  const f = await fixture(t), value = f.engine();
  await value.start(f.host);
  const pending = deferred(); f.control.listen = () => pending.promise;
  const oldBot = f.connect(value); await flush();
  f.connect(value); await flush();
  assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === 'listen').length, 1);
  assert.doesNotThrow(() => oldBot.emit('end'));
  f.control.listen = async () => {};
  if (outcome === 'reject') pending.reject(Error('obsolete listener failed'));
  else pending.resolve();
  await flush();
  assert.equal(f.timers.size, 1);
  assert.equal(f.read().reason, 'READY-0');
  const closes = f.calls.findIndex(c => Array.isArray(c) && c[0] === 'close' && c[1] === f.views[0]);
  const listens = f.calls.findIndex(c => Array.isArray(c) && c[0] === 'listen' && c[1] === f.views[1]);
  assert.ok(closes >= 0 && closes < listens);
  const staleTick = [...f.timers][0].callback;
  value.disposeExtension(); await flush();
  const disposed = fs.readFileSync(f.config.stateFile, 'utf8');
  staleTick(); await flush();
  assert.equal(f.timers.size, 0);
  assert.equal(fs.readFileSync(f.config.stateFile, 'utf8'), disposed);
  await value.stop();
  const before = fs.readFileSync(f.config.stateFile, 'utf8');
  oldBot.emit('end'); staleTick(); await flush();
  assert.equal(fs.readFileSync(f.config.stateFile, 'utf8'), before);
});

test('exclusive temp creation failure never deletes a file the recorder did not create', async t => {
  const f = await fixture(t), value = f.engine();
  let foreign;
  t.mock.method(fs, 'openSync', path => {
    foreign = path;
    fs.writeFileSync(path, 'foreign collision');
    throw Object.assign(Error('private'), { code: 'EEXIST' });
  }); syncBuiltinESMExports();
  assert.equal(await value.start(f.host), 'started');
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'foreign collision');
  assert.ok(f.warnings.some(message => message.includes('write:EEXIST')));
});
