import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installInventoryWindowSyncGuard, inventoryReadConfirmed } from '../core/inventory-window-sync.ts';
import { clickInventoryConfirmed, installInventoryClickSync, inventoryClickState,
  INVENTORY_CLICK_CONFIRM_MS } from '../core/inventory-click-sync.ts';
import { snapshotFromBot, narrateWorld, snapshotFingerprint } from '../core/terrain.ts';
import { renderBagReadout, renderStoredItemReadout, bagStamp } from '../core/readouts.ts';
import { methodHarness } from './method-harness.ts';
import { installDeathLifecycle } from '../core/death-lifecycle.ts';
import { Bridge } from '../core/bridge.ts';

const require = createRequire(import.meta.url);
const mf = createRequire(require.resolve('mineflayer'));

/** Exercise the pinned Mineflayer inventory plugin, including its private close closure. */
function rig(version = '1.20.6') {
  const registry = require('minecraft-data')(version);
  const Item = mf('prismarine-item')(registry);
  const write = vi.fn();
  const client = Object.assign(new EventEmitter(), { write });
  const bot = Object.assign(new EventEmitter(), { registry, version, _client: client,
    QUICK_BAR_START: 36, supportFeature: (f: string) => registry.supportFeature(f),
  }) as unknown as Bot;
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  const notes: any[] = [];
  installInventoryWindowSyncGuard(bot, { write: (note: unknown) => notes.push(note) } as never);
  installInventoryClickSync(bot);
  let stateId = 0;
  const raw = (name: string, count = 1) => Item.toNotch(new Item(registry.itemsByName[name].id, count));
  const full = (id: number, length: number, slots: Record<number, unknown> = {}, cursor = Item.toNotch(null)) => {
    const items = Array.from({ length }, (_, i) => slots[i] ?? Item.toNotch(null));
    client.emit('window_items', { windowId: id, stateId: ++stateId, items, carriedItem: cursor });
  };
  const open = (id = 1) => {
    client.emit('open_window', { windowId: id, inventoryType: 2, windowTitle: '{"text":"Test"}' });
    return bot.currentWindow!;
  };
  const slot = (id: number, index: number, item = Item.toNotch(null)) =>
    client.emit('set_slot', { windowId: id, stateId: ++stateId, slot: index, item });
  full(0, 46, { 9: raw('oak_log', 8), 36: raw('stone_pickaxe') });
  return { bot, client, write, full, open, raw, slot, notes };
}

afterEach(() => vi.useRealTimers());

it.each([true, false])('uses real 1.21.1 inventory packets for episode freshness, inventory-before-spawn=%s', beforeSpawn => {
  const r = rig('1.21.1');
  Object.assign(r.bot, { entity: {} });
  mf('mineflayer/lib/plugins/health.js')(r.bot, { respawn: false });
  const lifecycle = installDeathLifecycle(r.bot, 4000, () => true);
  const synced = () => Reflect.get(Bridge.prototype, 'invSynced', { _invSynced: true, _bot: r.bot });
  expect(synced()).toBe(true);
  r.client.emit('update_health', { health: 0, food: 4, foodSaturation: 0 });
  expect(synced()).toBe(false);
  expect(r.bot.inventory.slots[9]?.name).toBe('oak_log'); // Old cached inventory is still present.
  r.full(0, 46, { 9: r.raw('oak_log', 8) });
  expect(synced()).toBe(false); // Even a full old-life packet cannot refresh the new life.
  r.client.emit('respawn', {});
  if (beforeSpawn) r.full(0, 46); // Actual server snapshot clears the old stacks.
  r.client.emit('update_health', { health: 20, food: 20, foodSaturation: 5 });
  expect(synced()).toBe(beforeSpawn);
  r.full(0, 46);
  expect(synced()).toBe(true);
  expect(r.bot.inventory.items()).toEqual([]);
  lifecycle.dispose();
});

describe('inventory read recovery', () => {
  it('unlocks when a partial container is followed by a complete server snapshot', () => {
    const r = rig(), w = r.open();
    r.full(w.id, w.inventoryStart);
    expect(inventoryReadConfirmed(r.bot)).toBe(false);
    r.full(w.id, w.slots.length, { [w.inventoryStart]: r.raw('oak_log', 7) });
    expect(inventoryReadConfirmed(r.bot)).toBe(true);
    expect(r.bot.inventory.slots[9]?.count).toBe(7); // available before closing
    expect(w.slots[w.inventoryStart]?.slot).toBe(w.inventoryStart);
    r.bot.closeWindow(w);
    expect(r.bot.inventory.slots[9]?.count).toBe(7);
    expect(inventoryReadConfirmed(r.bot)).toBe(true);
  });

  it('unlocks only after every player slot has actually arrived, counting empty slots too', () => {
    const r = rig(), w = r.open(); r.full(w.id, w.inventoryStart);
    for (let slot = w.inventoryStart; slot < w.inventoryEnd - 1; slot++) r.slot(w.id, slot);
    r.slot(w.id, w.inventoryStart); // duplicate is not extra coverage
    expect(inventoryReadConfirmed(r.bot)).toBe(false);
    r.slot(w.id, w.inventoryEnd - 1);
    expect(inventoryReadConfirmed(r.bot)).toBe(true);
  });

  it.each(['bot', 'window'])('preserves missing player slots when closed via %s', way => {
    const r = rig(), w = r.open(); r.full(w.id, w.inventoryStart);
    if (way === 'bot') r.bot.closeWindow(w);
    else (w as any).close(); // Mineflayer uses its private closeWindow closure here
    expect(r.bot.inventory.slots[9]?.name).toBe('oak_log');
    expect(r.bot.inventory.slots[9]?.count).toBe(8);
    expect(r.bot.inventory.slots[36]?.name).toBe('stone_pickaxe');
    expect(inventoryReadConfirmed(r.bot)).toBe(false);
    r.full(0, 46, { 9: r.raw('oak_log', 8) });
    expect(inventoryReadConfirmed(r.bot)).toBe(true);
  });

  it('copies confirmed player slots on server close without erasing unobserved slots', () => {
    const r = rig(), w = r.open(); r.full(w.id, w.inventoryStart + 1, { [w.inventoryStart]: r.raw('oak_log', 6) });
    r.client.emit('close_window', { windowId: w.id });
    expect(r.bot.currentWindow).toBeNull();
    expect(r.bot.inventory.slots[9]?.count).toBe(6);
    expect(r.bot.inventory.slots[36]?.name).toBe('stone_pickaxe');
    expect(inventoryReadConfirmed(r.bot)).toBe(false);
  });

  it('does not inherit coverage or late data from a closed window with the same numeric ID', () => {
    const r = rig(), old = r.open(3); r.full(old.id, old.slots.length);
    r.bot.closeWindow(old);
    r.full(old.id, old.slots.length); // late closed-window packet
    const current = r.open(3);
    expect(current).not.toBe(old);
    expect(inventoryReadConfirmed(r.bot)).toBe(false);
    r.full(current.id, current.inventoryStart);
    expect(inventoryReadConfirmed(r.bot)).toBe(false);
  });

  it('makes a synchronous windowOpen reader/closer see the received player slots', () => {
    const r = rig(), w = r.open();
    r.bot.once('windowOpen', window => {
      expect(inventoryReadConfirmed(r.bot)).toBe(true);
      expect(r.bot.inventory.slots[9]?.count).toBe(5);
      (window as any).close();
    });
    r.full(w.id, w.slots.length, { [w.inventoryStart]: r.raw('oak_log', 5) });
    expect(r.bot.currentWindow).toBeNull();
    expect(r.bot.inventory.slots[9]?.count).toBe(5);
  });

  it('does not overwrite a newer full player snapshot when a partial container later closes', () => {
    const r = rig(), w = r.open(); r.full(w.id, w.inventoryStart);
    r.full(0, 46, { 9: r.raw('oak_log', 3) });
    expect(inventoryReadConfirmed(r.bot)).toBe(true);
    r.bot.closeWindow(w);
    expect(inventoryReadConfirmed(r.bot)).toBe(true);
    expect(r.bot.inventory.slots[9]?.count).toBe(3);
  });

  it('cannot inherit a previous connection\'s confirmation', () => {
    const a = rig(); const w = a.open(); a.full(w.id, w.inventoryStart);
    const b = rig();
    expect(inventoryReadConfirmed(a.bot)).toBe(false);
    expect(inventoryReadConfirmed(b.bot)).toBe(true);
  });
});

describe('failed inventory click recovery', () => {
  it.each(['cursor', 'slot'] as const)('confirms a fresh complete server frame when its delayed %s packet completes the expected click', async delayed => {
    const r = rig('1.21.1');
    const operation = clickInventoryConfirmed(r.bot, 9, 0, 0);
    await Promise.resolve();
    expect(r.write.mock.calls.filter(([name]) => name === 'window_click')).toHaveLength(1);
    r.full(0, 46, delayed === 'slot' ? { 9: r.raw('oak_log', 8) } : {},
      delayed === 'cursor' ? undefined : r.raw('oak_log', 8));
    expect(inventoryClickState(r.bot).phase).toBe('pending');
    if (delayed === 'cursor') r.slot(-1, -1, r.raw('oak_log', 8));
    else r.slot(0, 9);
    const afterPacket = inventoryClickState(r.bot).phase;
    // Also settle the pre-fix promise so the regression fails without a leaked timer.
    r.full(0, 46, {}, r.raw('oak_log', 8));
    await operation;
    expect(afterPacket).toBe('ready');
    expect(inventoryReadConfirmed(r.bot)).toBe(true);
    expect(r.bot.inventory.selectedItem?.count).toBe(8);
    expect(r.write.mock.calls.filter(([name]) => name === 'window_click')).toHaveLength(1);
  });

  it('does not confirm a cursor update against an old full frame or an unmatched cursor', async () => {
    const r = rig('1.21.1');
    const operation = clickInventoryConfirmed(r.bot, 9, 0, 0);
    await Promise.resolve();
    r.slot(-1, -1, r.raw('oak_log', 8));
    expect(inventoryClickState(r.bot).phase).toBe('pending'); // Full frame predates dispatch.
    r.full(0, 46);
    r.slot(-1, -1, r.raw('oak_log', 7));
    expect(inventoryClickState(r.bot).phase).toBe('pending');
    r.full(0, 46, {}, r.raw('oak_log', 8));
    await operation;
    expect(inventoryClickState(r.bot).phase).toBe('ready');
  });

  it('accepts a fresh full snapshot after a sent crafting click times out while native result-slot wait remains pending', async () => {
    vi.useFakeTimers(); const r = rig();
    // Placing into a crafting input makes native Mineflayer wait for updateSlot:0.
    // A server denial can leave that result slot unchanged forever.
    r.bot.inventory.selectedItem = mf('prismarine-item')(r.bot.registry).fromNotch(r.raw('oak_log', 1));
    const operation = clickInventoryConfirmed(r.bot, 1, 0, 0);
    const failed = expect(operation).rejects.toMatchObject({ code: 'inventory-click-sync' });
    await vi.advanceTimersByTimeAsync(INVENTORY_CLICK_CONFIRM_MS); await failed;
    expect(inventoryClickState(r.bot).phase).toBe('quarantined');
    const sent = r.write.mock.calls.filter(([name]) => name === 'window_click').length;
    r.full(0, 20, { 9: r.raw('oak_log', 8) }); // partial is not recovery
    expect(inventoryClickState(r.bot).phase).toBe('quarantined');
    r.full(0, 46, { 9: r.raw('oak_log', 8) }, r.raw('oak_log', 1));
    expect(inventoryClickState(r.bot).phase).toBe('ready');
    expect(inventoryReadConfirmed(r.bot)).toBe(true);
    expect(r.bot.inventory.selectedItem?.count).toBe(1);
    expect(r.bot.inventory.slots[1]).toBeNull();
    expect(r.write.mock.calls.filter(([name]) => name === 'window_click')).toHaveLength(sent);
    // A later native completion cannot overturn the failed result or issue a retry.
    r.slot(0, 0, r.raw('oak_planks', 4)); await Promise.resolve();
    expect(inventoryClickState(r.bot).phase).toBe('ready');
  });

  it('does not release a delayed unsent native click or accept an incomplete snapshot', async () => {
    vi.useFakeTimers(); const r = rig(); r.bot.lastDigTime = Date.now() + 5000;
    const operation = clickInventoryConfirmed(r.bot, 36, 0, 0);
    const failed = expect(operation).rejects.toMatchObject({ code: 'inventory-click-sync' });
    await vi.advanceTimersByTimeAsync(INVENTORY_CLICK_CONFIRM_MS); await failed;
    r.full(0, 46, { 36: r.raw('stone_pickaxe') });
    expect(inventoryClickState(r.bot).phase).toBe('quarantined');
    expect(r.write.mock.calls.some(([name]) => name === 'window_click')).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.write.mock.calls.some(([name]) => name === 'window_click')).toBe(false);
    expect(inventoryClickState(r.bot).phase).toBe('ready');
    expect(r.bot.inventory.slots[36]?.name).toBe('stone_pickaxe');
  });
});

describe('inventory synchronization readouts', () => {
  it.each([
    ['initial', '首次完整背包'], ['partial', '槽位数据尚不完整'],
    ['pending', '上一笔背包操作正在等待'], ['quarantined', '上一笔背包操作结果未知'],
  ] as const)('gives accurate %s information across bag, stock and scene', (phase, expected) => {
    const r = methodHarness();
    try {
      const snapshot = snapshotFromBot(r.bot, { scanBlocks: false, invSynced: false });
      snapshot.inventorySync = { phase, reason: phase === 'quarantined' ? '服务器未确认本次点击' : undefined };
      for (const text of [renderBagReadout(snapshot), renderStoredItemReadout(snapshot, [], 'oak_log'), narrateWorld(snapshot)]) {
        expect(text).toContain(expected);
        expect(text).not.toContain('物品栏还在从服务器同步');
        expect(text).not.toContain('包里什么都没有');
      }
    } finally { r.close(); }
  });

  it('derives a real click quarantine in fresh snapshots instead of describing an empty bag', async () => {
    vi.useFakeTimers(); const r = rig(), scene = methodHarness();
    try {
      r.bot.inventory.selectedItem = mf('prismarine-item')(r.bot.registry).fromNotch(r.raw('oak_log', 1));
      Object.assign(r.bot, { entity: scene.bot.entity, game: scene.bot.game, entities: {}, players: {},
        health: 20, food: 20, time: { timeOfDay: 1000 }, blockAt: scene.bot.blockAt });
      const operation = clickInventoryConfirmed(r.bot, 1, 0, 0);
      const failed = expect(operation).rejects.toMatchObject({ code: 'inventory-click-sync' });
      await vi.advanceTimersByTimeAsync(INVENTORY_CLICK_CONFIRM_MS); await failed;
      const snapshot = snapshotFromBot(r.bot, { scanBlocks: false });
      expect(snapshot.invSynced).toBe(false);
      expect(snapshot.inventorySync?.phase).toBe('quarantined');
      expect(renderBagReadout(snapshot)).toContain('结果未知');
      r.full(0, 46, { 9: r.raw('oak_log', 8) });
      expect(snapshotFromBot(r.bot, { scanBlocks: false }).invSynced).toBe(true);
    } finally { scene.close(); }
  });

  it('refreshes a previously read bag and scene when a pending click becomes quarantined', () => {
    const r = methodHarness();
    try {
      const snapshot = snapshotFromBot(r.bot, { scanBlocks: false, invSynced: false });
      snapshot.inventorySync = { phase: 'pending' };
      const bag = bagStamp(snapshot), scene = snapshotFingerprint(snapshot);
      snapshot.inventorySync = { phase: 'quarantined', reason: '确认超时' };
      expect(bagStamp(snapshot)).not.toBe(bag);
      expect(snapshotFingerprint(snapshot)).not.toBe(scene);
      const failedBag = bagStamp(snapshot);
      snapshot.inventorySync.reason = '连接结束';
      expect(bagStamp(snapshot)).not.toBe(failedBag);
    } finally { r.close(); }
  });
});
