import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ children: [] as any[], engines: [] as any[] }));
vi.mock('node:child_process', () => ({ fork: vi.fn(() => {
  const child = new EventEmitter() as any;
  Object.assign(child, { connected: true, exitCode: null, killed: false, pid: 123, stdout: null, stderr: null, sent: [] });
  child.send = (message: any) => {
    child.sent.push(message);
    if (message.t === 'req') void Promise.resolve().then(() => {
      child.emit('message', { t: 'rep', id: message.id, ok: true, value: null });
      if (message.req.kind === 'shutdown') {
        child.exitCode = 0;
        child.connected = false;
        child.emit('exit', 0);
      }
    });
  };
  child.kill = () => { child.killed = true; child.exitCode = 0; child.emit('exit', 0); };
  state.children.push(child);
  return child;
}) }));
vi.mock('../core/tactical-world.ts', () => ({ TacticalMinecraftWorld: class {
  start = vi.fn(async () => {});
  stop = vi.fn(async () => {});
  constructor(readonly options: any) { state.engines.push(this); }
  console() { return {}; }
  envPromptRuntimeVars() { return {}; }
  requestFacts() { return null; }
} }));
vi.mock('../core/support/child-signals.ts', () => ({ installChildSignalOwnership: vi.fn() }));

import { MinecraftWorldProxy } from '../core/proxy.ts';
import { MINECRAFT_DEFAULTS, type MinecraftConfigSection } from '../core/config.ts';
import { SERVER_PROFILE_FIELDS } from '../core/server-profiles.ts';
import type { EngineRequest, MainToChild } from '../core/engine-ipc.ts';
import { FakeHost } from './method-host.ts';

const connectionKeys = [
  ...SERVER_PROFILE_FIELDS, 'provider', 'profilesFolder', 'javaClient', 'loginConfirmation',
  'autoReconnect', 'keepAliveTimeoutMs', 'viewDistance', 'deathRespawnDelayMs',
  'server', 'servers', 'activeServer', 'serverSafety', 'memoryAgentId',
] as const;
const nestedKeys = {
  local: ['serverDir'], client: ['username', 'auth', 'profilesFolder'],
  player: ['username', 'auth', 'profilesFolder'], miningLimits: ['hardStopOnWarning', 'warningKeywords'],
} as const;
function connectionOf(cfg: MinecraftConfigSection) {
  const value = cfg as unknown as Record<string, any>;
  return {
    ...Object.fromEntries(connectionKeys.map(key => [key, value[key]])),
    ...Object.fromEntries(Object.entries(nestedKeys).map(([group, keys]) => [group,
      Object.fromEntries(keys.map(key => [key, value[group]?.[key]])),
    ])),
  };
}
function fixture(): MinecraftConfigSection {
  const cfg = structuredClone(MINECRAFT_DEFAULTS) as unknown as MinecraftConfigSection;
  cfg.client.enabled = false;
  cfg.local.startWithWorld = false;
  cfg.local.serverDir = '';
  cfg.memoryAgentId = 'owner-A';
  cfg.profilesFolder = 'profiles-A';
  cfg.loginConfirmation = 'mc-auth-success';
  cfg.server = 'profileA';
  cfg.miningLimits = { hardStopOnWarning: false, warningKeywords: ['base-warning'] };
  const servers = {
    profileA: {
      host: 'a.example.test', port: 1234, version: '1.21.1', username: 'ag_A', auth: 'offline' as const,
      loginConfigFile: 'login-A.json', loginConfirmation: 'mc-auth-success', fakeHost: 'handshake-A.test',
      publicDnsFallback: false, connectAddresses: ['192.0.2.1'], dohResolvers: ['https://dns-A.test/resolve'],
      connectTimeoutMs: 1111, maxReconnectAttempts: 2, viewerAssetsDir: 'assets-A',
      safety: { publicChat: false, commands: { mode: 'allowlist' as const, allow: ['list'] }, warningKeywords: ['A-warning'] },
    },
    profileB: {
      host: 'b.example.test', port: 4321, version: '1.21.1', username: 'ag_B', auth: 'microsoft' as const,
      loginConfigFile: 'login-B.json', loginConfirmation: 'plugin', safety: { publicChat: true },
    },
  };
  cfg.servers = servers;
  return cfg;
}
function rawB(base: MinecraftConfigSection): MinecraftConfigSection {
  const next = structuredClone(base);
  Object.assign(next, {
    host: 'raw-b.example.test', port: 9999, version: '26.2', username: 'raw_B', auth: 'microsoft',
    provider: 'java-client', profilesFolder: 'profiles-B', loginConfigFile: 'raw-login-B.json', loginConfirmation: 'plugin',
    fakeHost: 'raw-handshake-B.test', publicDnsFallback: true, connectAddresses: ['192.0.2.2'],
    dohResolvers: ['https://dns-B.test/resolve'], connectTimeoutMs: 9999, maxReconnectAttempts: 99,
    viewerAssetsDir: 'assets-B', memoryAgentId: 'owner-B', server: 'profileB', activeServer: 'profileB',
    serverSafety: { publicChat: true }, autoReconnect: false, keepAliveTimeoutMs: 99, viewDistance: 20,
    deathRespawnDelayMs: 99,
  });
  next.local.serverDir = 'changed-B-directory';
  next.local.javaPath = 'hot-java-path';
  next.client.username = 'observer_B'; next.client.auth = 'microsoft'; next.client.profilesFolder = 'observer-profiles-B';
  next.player.username = 'player_B'; next.player.auth = 'microsoft'; next.player.profilesFolder = 'player-profiles-B';
  next.miningLimits = { ...next.miningLimits, hardStopOnWarning: false, warningKeywords: ['raw-B-warning'] };
  next.world.tickSec = 9;
  next.client.width += 1;
  return next;
}
const registryCases = ['switched', 'empty', 'removed', 'invalid', 'missing'] as const;
function changeRegistry(next: MinecraftConfigSection, kind: typeof registryCases[number]) {
  if (kind === 'empty') next.servers = {};
  if (kind === 'removed') delete next.servers!.profileA;
  if (kind === 'invalid') next.servers!.profileA.host = '';
  if (kind === 'missing') delete next.servers;
}

let sendDescriptor: PropertyDescriptor | undefined;
let replacedSend = false;
beforeEach(() => { vi.stubEnv('AGENT_MC_SERVER', ''); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (replacedSend) {
    if (sendDescriptor) Object.defineProperty(process, 'send', sendDescriptor);
    else delete process.send;
    replacedSend = false;
  }
  vi.useRealTimers();
  state.children.length = 0;
  state.engines.length = 0;
});

async function childIpc() {
  vi.resetModules();
  const listeners = new Map<string, (...args: any[]) => void>();
  vi.spyOn(process, 'on').mockImplementation(((event: string, listener: (...args: any[]) => void) => {
    listeners.set(event, listener);
    return process;
  }) as typeof process.on);
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  const replies = new Map<number, (reply: any) => void>();
  sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
  replacedSend = true;
  Object.defineProperty(process, 'send', { configurable: true, writable: true, value: (message: any) => {
    if (message.t === 'rep') { replies.get(message.id)?.(message); replies.delete(message.id); }
    return true;
  } });
  await import('../core/engine-child.ts');
  const receive = (message: MainToChild) => listeners.get('message')!(message);
  let id = 0;
  return {
    request: (req: EngineRequest) => new Promise<any>(resolve => {
      const requestId = ++id;
      replies.set(requestId, resolve);
      receive({ t: 'req', id: requestId, req });
    }),
    config: (cfg: MinecraftConfigSection) => receive({ t: 'cast', cast: { kind: 'config', cfg } }),
  };
}
function initRequest(cfg: MinecraftConfigSection): EngineRequest {
  return { kind: 'init', init: { cfg, timezone: 'UTC', botName: 'Fixture', dataDir: null } };
}

describe('World-start configuration snapshot in parent', () => {
  it.each(registryCases)('keeps A through %s registry hot changes and child recovery; explicit stop/start selects B', async kind => {
    vi.useFakeTimers();
    const cfg = fixture(), proxy = new MinecraftWorldProxy({ cfg }), host = new FakeHost();
    // An environment selection may differ from the saved selection at startup.
    cfg.server = 'profileB';
    vi.stubEnv('AGENT_MC_SERVER', 'profileA');
    try {
      await proxy.start(host);
      const first = state.children[0], initial = first.sent.find((m: any) => m.req?.kind === 'init').req.init.cfg;
      const original = structuredClone(connectionOf(initial));
      const displayed = proxy.envPromptVars();
      expect(initial).toMatchObject({ host: 'a.example.test', port: 1234, username: 'ag_A', activeServer: 'profileA',
        loginConfigFile: 'login-A.json', loginConfirmation: 'mc-auth-success' });
      expect(displayed['minecraft.world']).toContain('a.example.test:1234');
      expect(displayed['minecraft.version']).toBe('1.21.1');
      const next = rawB(cfg), savedB = structuredClone(next.servers!.profileB);
      // In-place edits must not alias the startup profile's arrays or policy.
      next.servers!.profileA.connectAddresses![0] = '192.0.2.99';
      next.servers!.profileA.safety!.commands!.allow!.push('pay');
      changeRegistry(next, kind);
      Object.assign(cfg, next);
      if (kind === 'missing') delete cfg.servers;
      vi.stubEnv('AGENT_MC_SERVER', 'profileB');
      await vi.advanceTimersByTimeAsync(1000);
      const hot = first.sent.find((m: any) => m.cast?.kind === 'config').cast.cfg;
      expect(connectionOf(hot)).toEqual(original);
      expect(hot.world.tickSec).toBe(9);
      expect(hot.client.width).toBe(next.client.width);
      expect(hot.local.javaPath).toBe('hot-java-path');
      expect(proxy.envPromptVars()).toEqual(displayed);
      first.connected = false; first.exitCode = 1; first.emit('exit', 1);
      await vi.advanceTimersByTimeAsync(3100);
      expect(state.children).toHaveLength(2);
      const recovered = state.children[1].sent.find((m: any) => m.req?.kind === 'init').req.init.cfg;
      expect(connectionOf(recovered)).toEqual(original);
      expect(recovered.world.tickSec).toBe(9);
      expect(proxy.envPromptVars()).toEqual(displayed);
      await proxy.stop();
      await vi.advanceTimersByTimeAsync(10000);
      expect(state.children).toHaveLength(2);
      cfg.servers = { profileB: savedB }; cfg.server = 'profileB';
      await proxy.start(host);
      const fresh = state.children[2].sent.find((m: any) => m.req?.kind === 'init').req.init.cfg;
      expect(fresh).toMatchObject({ host: 'b.example.test', port: 4321, username: 'ag_B', activeServer: 'profileB',
        loginConfigFile: 'login-B.json', loginConfirmation: 'plugin', memoryAgentId: 'owner-B' });
      expect(proxy.envPromptVars()['minecraft.world']).toContain('b.example.test:4321');
    } finally { await proxy.stop(); }
  });

  it('accepts the live config proxy used by a host adapter without selecting a profile', async () => {
    const cfg = fixture();
    cfg.server = ''; cfg.servers = {};
    cfg.host = 'fixture.invalid'; cfg.username = 'ag_fixture';
    const proxy = new MinecraftWorldProxy({ cfg: new Proxy(cfg, {}) });
    try {
      await proxy.start(new FakeHost());
      expect(state.children[0].sent.find((m: any) => m.req?.kind === 'init').req.init.cfg.host).toBe('fixture.invalid');
    } finally { await proxy.stop(); }
  });

  it.each(['unknown', 'config-only', 'invalid'])('rejects %s startup selection before fork', async kind => {
    const cfg = fixture(), proxy = new MinecraftWorldProxy({ cfg });
    if (kind === 'unknown') cfg.server = 'unknown';
    if (kind === 'config-only') cfg.servers!.profileA.selectable = false;
    if (kind === 'invalid') cfg.servers!.profileA.host = '';
    await expect(proxy.start(new FakeHost())).rejects.toThrow(/Unknown|config-only|Invalid/);
    expect(state.children).toHaveLength(0);
    await proxy.stop();
  });
});

describe('engine-child startup snapshot over mocked IPC', () => {
  it.each(registryCases)('retains every connection/account/policy field for %s registry casts but merges hot settings', async kind => {
    vi.useFakeTimers();
    const ipc = await childIpc(), initial = fixture();
    // Parent startup selection wins over saved selection and a later process env.
    initial.server = 'profileB'; initial.activeServer = 'profileA';
    vi.stubEnv('AGENT_MC_SERVER', 'profileB');
    expect(await ipc.request(initRequest(initial))).toMatchObject({ ok: true });
    const engine = state.engines[0], cfg = engine.options.cfg as MinecraftConfigSection;
    const original = structuredClone(connectionOf(cfg));
    expect(cfg).toMatchObject({ host: 'a.example.test', port: 1234, username: 'ag_A', activeServer: 'profileA',
      loginConfigFile: 'login-A.json', loginConfirmation: 'mc-auth-success' });
    // The child snapshot must not alias the original IPC object, either.
    initial.servers!.profileA.connectAddresses![0] = '192.0.2.99';
    initial.servers!.profileA.safety!.commands!.allow!.push('pay');
    const next = rawB(initial);
    changeRegistry(next, kind);
    ipc.config(next);
    expect(connectionOf(cfg)).toEqual(original);
    expect(cfg.world.tickSec).toBe(9);
    expect(cfg.client.width).toBe(next.client.width);
    expect(cfg.local.javaPath).toBe('hot-java-path');
    ipc.config({ ...next, servers: {}, server: 'unknown', loginConfigFile: 'another-login.json', loginConfirmation: 'plugin' });
    expect(connectionOf(cfg)).toEqual(original);
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(await ipc.request({ kind: 'shutdown' })).toMatchObject({ ok: true });
    const stoppedCfg = structuredClone(cfg);
    ipc.config({ ...next, world: { ...next.world, tickSec: 42 } });
    expect(cfg).toEqual(stoppedCfg);
    expect(await ipc.request(initRequest(next))).toMatchObject({ ok: false, error: 'Engine stopped' });
    expect(state.engines).toHaveLength(1);
    expect(engine.stop).toHaveBeenCalledTimes(1);
  });

  it('pins absent selection, transport and policy values when profiles are introduced after a plain startup', async () => {
    vi.useFakeTimers();
    const ipc = await childIpc(), initial = fixture();
    delete initial.servers; delete initial.server; delete initial.profilesFolder;
    delete initial.fakeHost; delete initial.connectAddresses;
    expect(await ipc.request(initRequest(initial))).toMatchObject({ ok: true });
    const cfg = state.engines[0].options.cfg as MinecraftConfigSection;
    const original = structuredClone(connectionOf(cfg));
    ipc.config(rawB(fixture()));
    expect(connectionOf(cfg)).toEqual(original);
    expect(cfg.activeServer).toBeUndefined();
    expect(cfg.serverSafety).toBeUndefined();
    expect(cfg.fakeHost).toBeUndefined();
    expect(cfg.profilesFolder).toBeUndefined();
    expect(cfg.world.tickSec).toBe(9);
    await ipc.request({ kind: 'shutdown' });
  });
});
