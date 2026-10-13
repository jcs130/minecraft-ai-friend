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
});

describe('login readiness', () => {
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
