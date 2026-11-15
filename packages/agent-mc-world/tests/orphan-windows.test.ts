import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOrphanWindowClose } from '../core/orphan-windows.ts';
import { installWindowTitleUnwrap } from '../core/window-protocol.ts';

afterEach(() => vi.useRealTimers());

describe('orphan window_items', () => {
  it('closes a window id that never received open_window', () => {
    vi.useFakeTimers();
    const writes: Array<{ name: string; packet: unknown }> = [];
    const client = Object.assign(new EventEmitter(), {
      state: 'play',
      write(name: string, packet: unknown) { writes.push({ name, packet }); },
    });
    const bot = { currentWindow: null as { id: number } | null, _client: client };
    const closed: number[] = [];
    const dispose = installOrphanWindowClose(bot, { graceMs: 200, onClose: (info) => closed.push(info.windowId) });
    client.emit('window_items', { windowId: 3, items: Array(81).fill(null) });
    vi.advanceTimersByTime(199);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual([{ name: 'close_window', packet: { windowId: 3 } }]);
    expect(closed).toEqual([3]);
    dispose();
  });

  it('does not close a normal DeluxeMenus window that sends open_window in time', () => {
    vi.useFakeTimers();
    const writes: Array<{ name: string; packet: unknown }> = [];
    const client = Object.assign(new EventEmitter(), {
      state: 'play',
      write(name: string, packet: unknown) { writes.push({ name, packet }); },
    });
    const bot = { currentWindow: null as { id: number } | null, _client: client };
    const dispose = installOrphanWindowClose(bot, { graceMs: 200 });
    client.emit('window_items', { windowId: 1, items: Array(72).fill(null) });
    client.emit('open_window', { windowId: 1, inventoryType: 3, windowTitle: '||主菜单||' });
    bot.currentWindow = { id: 1 };
    vi.advanceTimersByTime(500);
    expect(writes).toEqual([]);
    dispose();
  });
});

describe('window title unwrap hook', () => {
  it('rewrites anonymous NBT titles before later listeners read them', () => {
    const client = new EventEmitter() as EventEmitter & { prependListener: EventEmitter['prependListener'] };
    const bot = { _client: client };
    const seen: unknown[] = [];
    const dispose = installWindowTitleUnwrap(bot);
    client.on('open_window', (packet: { windowTitle?: unknown }) => seen.push(packet.windowTitle));
    const raw = {
      type: 'compound',
      value: {
        text: { type: 'string', value: '' },
        extra: { type: 'list', value: { type: 'compound', value: [
          { text: { type: 'string', value: '||' } },
          { text: { type: 'string', value: '主菜单' } },
          { text: { type: 'string', value: '||' } },
        ] } },
      },
    };
    client.emit('open_window', { windowId: 1, inventoryType: 3, windowTitle: raw });
    expect(seen).toEqual(['||主菜单||']);
    dispose();
  });
});
