import { EventEmitter } from 'node:events';
import mineflayer from 'mineflayer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bridge } from '../core/bridge.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bridges: Bridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map(b => b.stop()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function scopedLoginRig() {
  const dir = mkdtempSync(join(tmpdir(), 'login-reconnect-')), configFile = join(dir, 'accounts.json');
  writeFileSync(configFile, JSON.stringify({ enabled: true, accounts: [{ server: 'example.test:25565', username: 'tester',
    credentialEnv: 'AGENT_MC_RECONNECT_FIXTURE', command: 'login', timeoutMs: 1000 }] }));
  vi.stubEnv('AGENT_MC_RECONNECT_FIXTURE', 'private-reconnect-fixture');
  const bots = Array.from({ length: 3 }, () => {
    const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), loadPlugin() {},
      chat: vi.fn(), quit: vi.fn(), entity: { position: { x: 0, y: 64, z: 0 } } });
    bot.quit.mockImplementation((reason?: string) => { bot.emit('end', reason); });
    return bot;
  });
  const create = vi.spyOn(mineflayer, 'createBot');
  for (const bot of bots) create.mockReturnValueOnce(bot as never);
  const log = { info: vi.fn(), warn() {}, error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
  const onSpawn = vi.fn(), onDisconnect = vi.fn();
  const bridge = new Bridge({ host: 'example.test', port: 25565, username: 'tester', version: '1.21.1', viewerPort: 0,
    loginConfigFile: () => configFile, log: log as never, onSpawn, onDisconnect });
  bridges.push(bridge); Object.assign(bridge, { installSpawnGear() {} });
  const message = (index: number, text: string) => bots[index]!.emit('message', { toString: () => text }, 'system');
  return { bridge, bots, create, log, onSpawn, onDisconnect, message,
    close: async () => { await bridge.stop(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('login readiness', () => {
  it('preserves the missing-prompt diagnosis in the actual disconnect and connection state',async()=>{
    vi.useFakeTimers();const r=scopedLoginRig();
    try{
      r.bridge.start();r.bots[0]!.emit('spawn');await vi.advanceTimersByTimeAsync(1000);
      expect(r.bridge.connectionState).toMatchObject({phase:'retrying',ready:false,serverLogin:{reason:'request-not-detected'}});
      expect(r.bots[0]!.chat).not.toHaveBeenCalled();
      expect(r.bots[0]!.quit).toHaveBeenCalledWith(expect.stringContaining('未识别到服务器登录提示'));
      expect(r.onDisconnect).toHaveBeenLastCalledWith(expect.stringContaining('尚未提交密码'),true,0);
      expect(JSON.stringify(r.log.info.mock.calls)).not.toContain('private-reconnect-fixture');
    }finally{await r.close();vi.useRealTimers();}
  });
  it('owns respawn dispatch and cancels it when the connection stops', async () => {
    vi.useFakeTimers();
    const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), loadPlugin() {}, quit() {},
      health: 20, respawn: vi.fn(), entity: { position: { x: 0, y: 64, z: 0 } } });
    const create = vi.spyOn(mineflayer, 'createBot').mockReturnValue(bot as never);
    const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
    const onRespawn = vi.fn();
    const bridge = new Bridge({ host: 'example.test', port: 25565, username: 'tester', version: '1.21.1', viewerPort: 0,
      log: log as never, onSpawn() {}, onRespawn, onDisconnect() {} });
    bridges.push(bridge); Object.assign(bridge, { installSpawnGear() {} });
    try {
      bridge.start(); bot.emit('spawn');
      expect(create.mock.calls[0]![0]).toMatchObject({ respawn: false });
      bot.health = 0; bot.emit('death');
      await vi.advanceTimersByTimeAsync(3999);
      expect(bot.respawn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(bot.respawn).toHaveBeenCalledOnce();
      bot.health = 20; bot.emit('spawn');
      expect(onRespawn).toHaveBeenCalledOnce();
      bot.health = 0; bot.emit('death');
      await bridge.stop(); await vi.advanceTimersByTimeAsync(5000);
      bot.emit('death'); await vi.advanceTimersByTimeAsync(5000);
      expect(bot.respawn).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('keeps the real network error through end and retry, then clears it only after usable spawn', async () => {
    vi.useFakeTimers();
    const makeBot = () => Object.assign(new EventEmitter(), { _client: new EventEmitter(), loadPlugin() {}, quit() {},
      entity: { position: { x: 0, y: 64, z: 0 } } });
    const first = makeBot(), second = makeBot(), onDisconnect = vi.fn();
    vi.spyOn(mineflayer, 'createBot').mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);
    const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
    const bridge = new Bridge({ host: 'example.test', port: 25565, username: 'tester', version: '1.20.6', viewerPort: 0,
      log: log as never, onSpawn() {}, onDisconnect });
    bridges.push(bridge); Object.assign(bridge, { installSpawnGear() {} });
    try {
      bridge.start();
      first.emit('error', Object.assign(new Error('connect ETIMEDOUT 203.0.113.5:25565'), { code: 'ETIMEDOUT' }));
      first.emit('end', 'socketClosed');
      expect(onDisconnect).toHaveBeenCalledWith('网络:connect ETIMEDOUT 203.0.113.5:25565', true, 0);
      expect(bridge.connectionState).toMatchObject({ phase: 'retrying', ready: false,
        failure: '网络:connect ETIMEDOUT 203.0.113.5:25565' });
      await vi.advanceTimersByTimeAsync(3000);
      expect(bridge.connectionState.phase).toBe('connecting');
      expect(bridge.connectionState.failure).toContain('ETIMEDOUT');
      first.emit('error', new Error('late old connection error'));
      expect(bridge.connectionState.failure).toContain('ETIMEDOUT');
      second.emit('spawn');
      expect(bridge.connectionState).toMatchObject({ phase: 'online', failure: null, ready: true });
      await bridge.stop(); second.emit('error', new Error('late stopped connection error'));
      expect(bridge.connectionState).toMatchObject({ phase: 'stopped', failure: null, ready: false });
    } finally { vi.useRealTimers(); }
  });
  it('retains a translated kick instead of replacing it with the following generic close', () => {
    const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), loadPlugin() {}, quit() {} });
    vi.spyOn(mineflayer, 'createBot').mockReturnValue(bot as never);
    const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
    const onDisconnect = vi.fn();
    const bridge = new Bridge({ host: 'example.test', port: 25565, username: 'tester', version: '1.20.6', viewerPort: 0,
      log: log as never, onSpawn() {}, onDisconnect });
    bridges.push(bridge); bridge.start();
    bot.emit('kicked', { translate: 'multiplayer.disconnect.not_whitelisted' });
    bot.emit('end', 'socketClosed');
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(bridge.connectionState.failure).toBe('被服务器断开(白名单):multiplayer.disconnect.not_whitelisted');
  });
  it.each(['MC_AUTH_FAILED wrong password', 'MC_AUTH_2FA required'])
  ('stops after explicit rejected authentication instead of resending credentials: %s', async receipt => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'login-failed-')), configFile = join(dir, 'accounts.json');
    writeFileSync(configFile, JSON.stringify({ enabled: true, accounts: [{ server: 'localhost:25565', username: 'tester',
      credentialEnv: 'UNUSED_TEST_CREDENTIAL', command: 'login' }] }));
    const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), loadPlugin() {}, quit: vi.fn(() => bot.emit('end', 'auth failed')) });
    const create = vi.spyOn(mineflayer, 'createBot').mockReturnValue(bot as never), onDisconnect = vi.fn();
    const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
    const bridge = new Bridge({ host: 'localhost', port: 25565, username: 'tester', version: '1.20.6', viewerPort: 0,
      loginConfigFile: () => configFile, log: log as never, onSpawn() {}, onDisconnect });
    bridges.push(bridge);
    try {
      bridge.start(); bot.emit('message', { toString: () => receipt }, 'system');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bot.quit).toHaveBeenCalledOnce(); expect(onDisconnect).toHaveBeenCalledWith('连接关闭:auth failed', false, 0);
      expect(create).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('retries missing final authorization with increasing backoff and submits once per new connection', async () => {
    vi.useFakeTimers();
    const r = scopedLoginRig();
    try {
      r.bridge.start(); r.bots[0]!.emit('spawn');
      r.message(0, 'MC_AUTH_LOGIN'); r.message(0, 'MC_AUTH_LOGIN repeated');
      await vi.advanceTimersByTimeAsync(0);
      expect(r.bots[0]!.chat).toHaveBeenCalledTimes(1);
      r.message(0, 'MC_AUTH_PASSWORD_OK');
      expect(r.bridge.connected).toBe(false); expect(r.onSpawn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(r.bridge.connectionState).toMatchObject({ phase: 'retrying', ready: false, reconnects: 1,
        serverLogin: { reason: 'confirmation-timeout' } });
      expect(r.onDisconnect).toHaveBeenLastCalledWith(expect.stringContaining('确认超时'), true, 0);
      expect(r.bots[0]!.listenerCount('message')).toBe(0);
      r.message(0, 'MC_AUTH_SUCCESS stale');
      await vi.advanceTimersByTimeAsync(2999); expect(r.create).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(r.create).toHaveBeenCalledTimes(2);
      r.bots[1]!.emit('spawn'); r.message(1, 'MC_AUTH_LOGIN'); r.message(1, 'MC_AUTH_LOGIN repeated');
      await vi.advanceTimersByTimeAsync(0);
      expect(r.bots[1]!.chat).toHaveBeenCalledTimes(1);
      expect(r.bridge.connectionState).toMatchObject({ phase: 'connecting', ready: false, reconnects: 1 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(r.onDisconnect).toHaveBeenLastCalledWith(expect.stringContaining('确认超时'), true, 1);
      expect(r.bridge.connectionState).toMatchObject({ phase: 'retrying', reconnects: 2 });
      await vi.advanceTimersByTimeAsync(9999); expect(r.create).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1); expect(r.create).toHaveBeenCalledTimes(3);
      r.bots[2]!.emit('spawn');
      expect(r.bridge.connected).toBe(false);
      r.message(2, 'MC_AUTH_STATE {"username":"tester","authorized":true,"status":"authenticated"}');
      expect(r.bridge.connectionState).toMatchObject({ phase: 'online', ready: true, reconnects: 0, failure: null });
      expect(r.onSpawn).toHaveBeenCalledOnce();
      expect(JSON.stringify(r.log.info.mock.calls)).not.toContain('private-reconnect-fixture');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(r.create).toHaveBeenCalledTimes(3); expect(r.bots[2]!.quit).not.toHaveBeenCalled();
    } finally { await r.close(); vi.useRealTimers(); }
  });
  it('cancels an authorization-timeout reconnect when manually stopped', async () => {
    vi.useFakeTimers(); const r = scopedLoginRig();
    try {
      r.bridge.start(); await vi.advanceTimersByTimeAsync(1000);
      expect(r.bridge.connectionState.phase).toBe('retrying');
      await r.bridge.stop(); await vi.advanceTimersByTimeAsync(120_000);
      expect(r.create).toHaveBeenCalledOnce();
      expect(r.bridge.connectionState).toMatchObject({ phase: 'stopped', ready: false });
    } finally { await r.close(); vi.useRealTimers(); }
  });
  it('disposes the old login timeout after a kick and waits for the new body to authorize', async () => {
    vi.useFakeTimers(); const r = scopedLoginRig();
    try {
      r.bridge.start(); r.bots[0]!.emit('kicked', 'null'); r.bots[0]!.emit('end', 'socketClosed');
      expect(r.onDisconnect).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(3000);
      expect(r.create).toHaveBeenCalledTimes(2); expect(r.bots[0]!.quit).not.toHaveBeenCalled();
      r.message(0, 'MC_AUTH_SUCCESS stale'); r.bots[0]!.emit('spawn');
      expect(r.bridge.connected).toBe(false);
      r.message(1, 'MC_AUTH_SUCCESS'); r.bots[1]!.emit('spawn');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(r.bridge.connectionState).toMatchObject({ phase: 'online', ready: true });
      expect(r.create).toHaveBeenCalledTimes(2); expect(r.onSpawn).toHaveBeenCalledOnce();
    } finally { await r.close(); vi.useRealTimers(); }
  });
  it.each([undefined, 90_000])('passes the keepalive timeout to the protocol client (%s)', keepAliveTimeoutMs => {
    const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), loadPlugin() {}, quit() {} });
    const create = vi.spyOn(mineflayer, 'createBot').mockReturnValue(bot as never);
    const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
    const bridge = new Bridge({ host: 'localhost', port: 25565, username: 'tester', version: '1.20.6',
      viewerPort: 0, keepAliveTimeoutMs, log: log as never, onSpawn() {}, onDisconnect() {} });
    bridges.push(bridge); bridge.start();
    expect(create.mock.calls[0]![0]).toMatchObject({ checkTimeoutInterval: keepAliveTimeoutMs ?? 60_000 });
  });
  it.each(['spawn-first', 'auth-first'])('requires both real spawn and configured authentication: %s', async order => {
    const dir = mkdtempSync(join(tmpdir(), 'login-ready-'));
    const configFile = join(dir, 'accounts.json');
    writeFileSync(configFile, JSON.stringify({ enabled: true, accounts: [{ server: 'localhost:25565', username: 'tester',
      credentialEnv: 'UNUSED_TEST_CREDENTIAL', command: 'login', requestMarkers: ['AUTH_LOGIN'],
      successMarkers: ['AUTH_SUCCESS'], failureMarkers: ['AUTH_FAILED'] }] }));
    const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), loadPlugin() {}, quit() {},
      entity: { position: { x: 0, y: 64, z: 0 } } });
    vi.spyOn(mineflayer, 'createBot').mockReturnValue(bot as never);
    const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
    const onSpawn = vi.fn();
    const bridge = new Bridge({ host: 'localhost', port: 25565, username: 'tester', version: '1.20.6', viewerPort: 0,
      log: log as never, loginConfigFile: () => configFile, onSpawn, onDisconnect() {} });
    bridges.push(bridge); Object.assign(bridge, { installSpawnGear() {} });
    const auth = () => bot.emit('message', { toString: () => 'AUTH_SUCCESS' }, 'system');
    try {
      bridge.start();
      if (order === 'spawn-first') bot.emit('spawn'); else auth();
      expect(bridge.bot).toBeNull(); expect(onSpawn).not.toHaveBeenCalled();
      if (order === 'spawn-first') auth(); else bot.emit('spawn');
      expect(bridge.connected).toBe(true); expect(onSpawn).toHaveBeenCalledOnce();
      await bridge.stop(); auth(); bot.emit('spawn');
      expect(bridge.bot).toBeNull(); expect(bridge.connectionState.spawnReceived).toBe(false);
      expect(onSpawn).toHaveBeenCalledOnce();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('receives login messages before spawn without exposing the temporary entity as an operable body', () => {
    const bot = Object.assign(new EventEmitter(), {
      _client: new EventEmitter(), loadPlugin() {}, quit() {},
      entity: { position: { x: 0, y: -4207, z: 0 } },
    });
    vi.spyOn(mineflayer, 'createBot').mockReturnValue(bot as never);
    const seen: string[] = [];
    const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
    const bridge = new Bridge({ host: 'localhost', port: 25565, username: 'tester', version: '1.20.6', viewerPort: 0,
      log: log as never, onSpawn() {}, onDisconnect() {},
      onBotCreated: live => live.on('message', message => { seen.push(message.toString()); }) });
    bridges.push(bridge);
    Object.assign(bridge, { installSpawnGear() {} });
    bridge.start();
    bot.emit('message', { toString: () => 'Authentication required' }, 'system');
    expect(seen).toEqual(['Authentication required']);
    expect(bridge.bot).toBeNull();
    expect(bridge.connected).toBe(false);
    bot.emit('spawn');
    expect(bridge.bot).toBe(bot);
    expect(bridge.connected).toBe(true);
    bot.emit('end', 'Disconnected');
    expect(bridge.bot).toBeNull();
    bot.emit('spawn');
    expect(bridge.connected).toBe(false);
  });
});
