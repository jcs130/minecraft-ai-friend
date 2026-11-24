import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mineflayer from 'mineflayer';
import { endMinecraftBot } from '../core/bot-end.ts';
import { Bridge, MAX_RECONNECT_ATTEMPTS } from '../core/bridge.ts';

describe('endMinecraftBot', () => {
  it('prefers quit and does not throw when the bot is missing or incomplete', () => {
    const quit = vi.fn();
    endMinecraftBot({ quit }, 'reason-a');
    expect(quit).toHaveBeenCalledWith('reason-a');

    const end = vi.fn();
    endMinecraftBot({ end }, 'reason-b');
    expect(end).toHaveBeenCalledWith('reason-b');

    const clientEnd = vi.fn();
    endMinecraftBot({ _client: { end: clientEnd } }, 'reason-c');
    expect(clientEnd).toHaveBeenCalledWith('reason-c');

    expect(() => endMinecraftBot(undefined)).not.toThrow();
    expect(() => endMinecraftBot({})).not.toThrow();
    expect(() => endMinecraftBot({ quit: 'not-a-function' as never })).not.toThrow();
  });

  it('swallows quit failures and still tries the underlying client', () => {
    const clientEnd = vi.fn();
    endMinecraftBot({
      quit: () => { throw new Error('quit unavailable'); },
      _client: { end: clientEnd },
    }, 'reason-d');
    expect(clientEnd).toHaveBeenCalledWith('reason-d');
  });
});

describe('bridge login cleanup without quit', () => {
  const bridges: Bridge[] = [];
  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((b) => b.stop()));
    vi.restoreAllMocks();
  });

  it('does not crash the engine when a status failure leaves a bot without quit, and stops after bounded reconnects', async () => {
    vi.useFakeTimers();
    try {
      const bots: EventEmitter[] = [];
      const makeBot = () => {
        const bot = Object.assign(new EventEmitter(), {
          _client: Object.assign(new EventEmitter(), { end: vi.fn() }),
          loadPlugin() {},
          // Status ping can fail before Mineflayer attaches quit.
        });
        bots.push(bot);
        return bot;
      };
      const create = vi.spyOn(mineflayer, 'createBot').mockImplementation(() => makeBot() as never);
      const log = { info: vi.fn(), warn: vi.fn(), error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
      const onDisconnect = vi.fn();
      const bridge = new Bridge({
        host: 'example.test', port: 25565, username: 'tester', version: '1.21.1',
        viewerPort: 0, log: log as never, onSpawn() {}, onDisconnect,
      });
      bridges.push(bridge);
      Object.assign(bridge, { installSpawnGear() {} });
      expect(() => bridge.start()).not.toThrow();
      expect(typeof (bots[0] as { quit?: unknown }).quit).toBe('undefined');
      for (let i = 0; i < MAX_RECONNECT_ATTEMPTS + 1; i++) {
        const bot = bots[i];
        expect(bot).toBeTruthy();
        expect(() => bot!.emit('end', 'Connection closed before the server sent a status response')).not.toThrow();
        await vi.advanceTimersByTimeAsync(60_000);
      }
      const warnings = log.warn.mock.calls.map((c) => String(c[0]));
      expect(warnings.some((m) => m.includes('停止自动重连'))).toBe(true);
      expect(create.mock.calls.length).toBe(MAX_RECONNECT_ATTEMPTS + 1);
      expect(bridge.connectionState).toMatchObject({ phase: 'stopped', ready: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not advertise or schedule a reconnect when autoReconnect is false', async () => {
    vi.useFakeTimers();
    try {
      const bot = Object.assign(new EventEmitter(), {
        _client: Object.assign(new EventEmitter(), { end: vi.fn() }),
        loadPlugin() {},
        quit() {},
      });
      const create = vi.spyOn(mineflayer, 'createBot').mockReturnValue(bot as never);
      const log = { info: vi.fn(), warn: vi.fn(), error() {}, debug() {}, trace() {}, emit() {}, child() { return this; } };
      const onDisconnect = vi.fn();
      const bridge = new Bridge({
        host: 'example.test', port: 25565, username: 'tester', version: '1.21.1',
        viewerPort: 0, autoReconnect: false, log: log as never, onSpawn() {}, onDisconnect,
      });
      bridges.push(bridge);
      Object.assign(bridge, { installSpawnGear() {} });
      bridge.start();
      bot.emit('end', 'Unable to connect to lobby: An internal server connection error occurred.');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onDisconnect).toHaveBeenCalledTimes(1);
      expect(onDisconnect.mock.calls[0][1]).toBe(false);
      expect(create).toHaveBeenCalledTimes(1);
      const warnings = log.warn.mock.calls.map((c) => String(c[0]));
      expect(warnings.some((m) => m.includes('自动重连已关闭'))).toBe(true);
      expect(log.info.mock.calls.map((c) => String(c[0])).some((m) => /后重连/.test(m))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
