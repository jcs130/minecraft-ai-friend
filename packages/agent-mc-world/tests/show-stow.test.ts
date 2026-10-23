import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { skillStow } from '../core/skills-container.ts';
import { Aborted } from '../core/skill-context.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { InventoryClickSyncError } from '../core/inventory-click-sync.ts';

const mf = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
afterEach(() => vi.useRealTimers());

// Real Mineflayer windows/deposit/close and production stow/batch/accounting.
// Only the server packets, nearby container port and task context are fake.
function rig(enabled = true, count = 3) {
  vi.useFakeTimers(); vi.setSystemTime(100000);
  const registry = mf('prismarine-registry')('1.21.1'), Item = mf('prismarine-item')(registry);
  const controller = new AbortController(), notes: any[] = [], events: string[] = [];
  const clicks: any[] = [], closes: number[] = [], deposits: number[] = [];
  let stateId = 0, afterDeposit: (() => void) | undefined, secondFailure: Error | undefined;
  const client = Object.assign(new EventEmitter(), { write(name: string, packet: any) {
    if (name === 'close_window') closes.push(packet.windowId);
    if (name !== 'window_click') return;
    clicks.push({ ...packet, at: Date.now() });
    queueMicrotask(() => {
      const win = bot.currentWindow;
      client.emit('window_items', { windowId: win.id, stateId: ++stateId,
        items: win.slots.map((item: any) => Item.toNotch(item)), carriedItem: packet.cursorItem });
    });
  } });
  const bot: any = Object.assign(new EventEmitter(), { registry, version: '1.21.1', _client: client,
    QUICK_BAR_START: 36, supportFeature: (name: string) => registry.supportFeature(name),
    entity: { id: 1, position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' },
    blockAt: () => ({ name: 'chest', getProperties: () => ({}) }),
  });
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  const names = ['oak_log', 'cobblestone', 'dirt'].slice(0, count);
  const raw = (name: string) => Item.toNotch(new Item(registry.itemsByName[name].id, 1));
  const full = (win: any, stock = true) => client.emit('window_items', { windowId: win.id, stateId: ++stateId,
    items: Array.from({ length: win.slots.length }, (_, i) => stock && names[i - win.inventoryStart]
      ? raw(names[i - win.inventoryStart]) : Item.toNotch(null)), carriedItem: Item.toNotch(null) });
  full(bot.inventory);
  bot.openContainer = async () => {
    client.emit('open_window', { windowId: 1, inventoryType: 2, windowTitle: '{"text":"Chest"}' });
    const win = bot.currentWindow; full(win);
    const deposit = win.deposit.bind(win);
    win.deposit = async (...args: any[]) => {
      deposits.push(args[0]);
      if (deposits.length === 2 && secondFailure) { controller.abort(); throw secondFailure; }
      await deposit(...args);
      afterDeposit?.();
    };
    return win;
  };
  const steps = names.map(item => ({ skill: 'stow' as const, item, count: 1, at: [1, 64, 0] }));
  const absorb = vi.fn((_index: number, _text: string, _ok: boolean) => { events.push('absorb'); });
  const ctx: any = { aborted: () => controller.signal.aborted, abortedBy: () => 'stow-test-stop',
    signal: controller.signal, showTempo: () => enabled ? MINECRAFT_DEFAULTS.show : null,
    diag: { write: (note: any) => { notes.push(note); events.push(note.event); } },
    batch: { index: 0, steps, absorb },
  };
  return { bot, ctx, controller, notes, events, clicks, closes, deposits, absorb,
    start: () => skillStow(bot, steps[0] as never, ctx),
    afterDeposit: (callback: () => void) => { afterDeposit = callback; },
    secondFailure: (error: Error) => { secondFailure = error; },
    replace: () => {
      client.emit('open_window', { windowId: 7, inventoryType: 2, windowTitle: 'Replacement' });
      full(bot.currentWindow, false);
    },
  };
}

it('records genuinely confirmed stow batch entries in the uninterrupted path', async () => {
  const r = rig(), operation = r.start();
  await vi.runAllTimersAsync(); await operation;
  expect(r.notes.filter(n => n.event === 'stow-done').map(n => [n.data.status, n.data.confirmed]))
    .toEqual([['confirmed', 1], ['confirmed', 1], ['confirmed', 1]]);
  expect(r.absorb.mock.calls.map(c => [c[0], c[2]])).toEqual([[1, true], [2, true]]);
  expect(r.closes).toEqual([1]);
});

it.each(['click', 'close', 'disabled'] as const)('retains observed batch receipts before propagating %s cancellation', async phase => {
  const r = rig(phase !== 'disabled', phase === 'close' ? 2 : 3);
  if (phase === 'disabled') r.afterDeposit(() => { if (r.deposits.length === 2) r.controller.abort(); });
  const operation = r.start().catch(error => { r.events.push('rejected'); throw error; });
  const rejection = expect(operation).rejects.toMatchObject({ by: 'stow-test-stop' });
  if (phase !== 'disabled') {
    await vi.advanceTimersByTimeAsync(phase === 'click' ? 1200 : 1600);
    expect(r.deposits).toHaveLength(2);
    r.controller.abort();
  }
  await vi.runAllTimersAsync(); await rejection;
  expect(r.deposits).toHaveLength(2); // Third planned transfer never starts.
  expect(r.closes).toEqual([1]);
  const done = r.notes.filter(n => n.event === 'stow-done');
  expect(done.map(n => [n.data.deposited, n.data.confirmed, n.data.status])).toEqual([[1, 0, 'none'], [1, 0, 'none']]);
  expect(r.absorb).toHaveBeenCalledTimes(1);
  expect(r.absorb.mock.calls[0]).toEqual([1, expect.stringContaining('没来得及对账'), true]);
  expect(r.events.indexOf('absorb')).toBeLessThan(r.events.indexOf('rejected'));
});

it('preserves the original native cancellation and does not invent a completed second deposit', async () => {
  const r = rig(false), original = new Aborted('native-deposit-stop');
  r.secondFailure(original);
  const operation = r.start().catch(error => error);
  await vi.runAllTimersAsync(); expect(await operation).toBe(original);
  expect(r.deposits).toHaveLength(2);
  expect(r.absorb.mock.calls[0]).toEqual([1, expect.any(String), false]);
  expect(r.notes.filter(n => n.event === 'stow-none').map(n => n.data.deposited)).toEqual([0]);
  expect(r.notes.find(n => n.event === 'stow-done').data).toMatchObject({ deposited: 1, confirmed: 0, status: 'none' });
});

it('keeps an unknown transfer unconfirmed when cancellation reaches the close boundary', async () => {
  const r = rig(false, 2);
  r.secondFailure(new InventoryClickSyncError('unknown native receipt', 'quarantined'));
  const rejection = expect(r.start()).rejects.toMatchObject({ by: 'stow-test-stop' });
  await vi.runAllTimersAsync(); await rejection;
  expect(r.absorb.mock.calls[0]).toEqual([1, expect.stringContaining('unknown native receipt'), false]);
  expect(r.notes.filter(n => n.event === 'stow-none')[0].data)
    .toMatchObject({ deposited: 0, confirmed: 0, status: 'none', failure: 'unknown native receipt' });
  expect(r.deposits).toHaveLength(2);
});

it('records interrupted observations without closing or transferring into a replacement window', async () => {
  const r = rig(), operation = r.start();
  const rejection = expect(operation).rejects.toBeInstanceOf(Aborted);
  await vi.advanceTimersByTimeAsync(1200);
  r.replace(); await vi.runAllTimersAsync(); await rejection;
  expect(r.deposits).toHaveLength(2);
  expect(r.closes).toEqual([]);
  expect(r.bot.currentWindow.id).toBe(7);
  expect(r.clicks.every(click => click.windowId === 1)).toBe(true);
  expect(r.notes.filter(n => n.event === 'stow-done').map(n => [n.data.status, n.data.confirmed]))
    .toEqual([['timeout', 0], ['timeout', 0]]);
  expect(r.absorb.mock.calls[0]).toEqual([1, expect.stringContaining('包里没回灌确认'), true]);
});
