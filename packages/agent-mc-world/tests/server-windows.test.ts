import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOrphanWindowClose, serverWindows } from '../core/orphan-windows.ts';
import { readOpenWindow, renderWindowReadout, spendingRisk } from '../core/window-readout.ts';

afterEach(() => vi.useRealTimers());

function rig() {
  const writes: Array<{ name: string; packet: any }> = [];
  const client = Object.assign(new EventEmitter(), {
    state: 'play',
    write(name: string, packet: unknown) { writes.push({ name, packet }); },
  });
  const bot: any = { currentWindow: null, _client: client,
    closeWindow(w: any) { client.write('close_window', { windowId: w.id }); bot.currentWindow = null; } };
  // Minimal mineflayer stand-in: open_window creates a window for known 9xN types only.
  client.on('open_window', (p: any) => {
    if (typeof p.inventoryType === 'number' && p.inventoryType >= 0 && p.inventoryType <= 5) {
      const rows = p.inventoryType + 1;
      bot.currentWindow = { id: p.windowId, title: p.windowTitle, inventoryStart: rows * 9, slots: [] as any[] };
    }
  });
  client.on('close_window', () => { bot.currentWindow = null; });
  client.on('window_items', (p: any) => {
    if (bot.currentWindow?.id === p.windowId) bot.currentWindow.slots = p.items;
  });
  return { writes, client, bot };
}

describe('server window tracking', () => {
  it('still closes unexplained window_items when no command was sent', () => {
    vi.useFakeTimers();
    const { writes, client, bot } = rig();
    const dispose = installOrphanWindowClose(bot, { graceMs: 200 });
    client.emit('window_items', { windowId: 3, items: Array(81).fill(null) });
    vi.advanceTimersByTime(200);
    expect(writes).toEqual([{ name: 'close_window', packet: { windowId: 3 } }]);
    expect(serverWindows(bot)!.current()).toBeNull();
    dispose();
  });

  it('adopts an items-only plugin GUI that follows a player command so it can be read', () => {
    vi.useFakeTimers();
    const { writes, client, bot } = rig();
    const dispose = installOrphanWindowClose(bot, { graceMs: 200 });
    client.write('chat_command', { command: 'rtp' });
    const items = Array(27 + 36).fill(null);
    items[13] = { name: 'grass_block', count: 1, customName: '主世界野外' };
    client.emit('window_items', { windowId: 5, items });
    vi.advanceTimersByTime(250);
    expect(writes.filter((w) => w.name === 'close_window')).toEqual([]);
    expect(bot.currentWindow?.id).toBe(5);
    expect(serverWindows(bot)!.current()).toMatchObject({ id: 5, adopted: true });
    dispose();
  });

  it('records an open_window mineflayer cannot model and close() releases it', () => {
    vi.useFakeTimers();
    const { writes, client, bot } = rig();
    const dispose = installOrphanWindowClose(bot, { graceMs: 200 });
    client.write('chat_command', { command: 'menu' });
    client.emit('open_window', { windowId: 7, inventoryType: 99, windowTitle: '||主菜单||' });
    vi.advanceTimersByTime(400);
    expect(bot.currentWindow).toBeNull();
    expect(serverWindows(bot)!.current()).toMatchObject({ id: 7, opened: true });
    expect(readOpenWindow(bot).state).toBe('server-only');
    expect(serverWindows(bot)!.close()).toBe(7);
    expect(writes.at(-1)).toEqual({ name: 'close_window', packet: { windowId: 7 } });
    expect(serverWindows(bot)!.current()).toBeNull();
    dispose();
  });

  it('forgets a window the server closes and restores write on dispose', () => {
    const { client, bot } = rig();
    const original = client.write;
    const dispose = installOrphanWindowClose(bot, { graceMs: 200 });
    expect(client.write).not.toBe(original);
    client.emit('open_window', { windowId: 2, inventoryType: 2, windowTitle: 'x' });
    client.emit('close_window', { windowId: 2 });
    expect(serverWindows(bot)!.current()).toBeNull();
    dispose();
    expect(client.write).toBe(original);
  });
});

describe('window readout', () => {
  it('lists container slots with names and lore, not player slots', () => {
    const lore = (t: string) => ({ type: 'compound', value: { text: { type: 'string', value: t } } });
    const bot: any = { currentWindow: { id: 4, title: '||主菜单||', inventoryStart: 9, slots: [
      null, { name: 'clock', count: 1, customName: '随机传送',
        componentMap: new Map([['lore', { data: [lore('传送到野外'), lore('免费')] }]]) },
      ...Array(7).fill(null), { name: 'dirt', count: 5 },
    ] } };
    const r = readOpenWindow(bot);
    expect(r.state).toBe('tracked');
    expect(r.slots).toEqual([{ slot: 1, id: 'clock', count: 1, name: '随机传送', lore: ['传送到野外', '免费'] }]);
    expect(renderWindowReadout(r)).toContain('#1 随机传送（clock×1）：传送到野外 / 免费');
  });

  it('flags spending options', () => {
    expect(spendingRisk({ slot: 1, id: 'x', count: 1, name: '购买礼包', lore: [] })).toBe('购买');
    expect(spendingRisk({ slot: 1, id: 'x', count: 1, name: '觉醒灵根', lore: ['点击觉醒'] })).toBeNull();
    expect(spendingRisk({ slot: 1, id: 'x', count: 1, name: 'VIP', lore: ['价格: 30 点券'] })).not.toBeNull();
  });
});
