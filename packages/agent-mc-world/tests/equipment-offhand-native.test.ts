import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { afterEach, expect, it, vi } from 'vitest';
import { equipSlotConfirmed } from '../core/equipment.ts';
import { clickInventoryConfirmed, installInventoryClickSync, inventoryClickState } from '../core/inventory-click-sync.ts';
import { installInventoryWindowSyncGuard } from '../core/inventory-window-sync.ts';

const require = createRequire(import.meta.url), mf = createRequire(require.resolve('mineflayer'));
function nativeServer(version: string, denyNumberSwap = false, rejectPostEquip = false, protectedHotbar: number | null = null) {
  const registry = require('minecraft-data')(version), Item = mf('prismarine-item')(registry);
  const windows = mf('prismarine-windows')(version), server = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  let stateId = 0;
  const clicks: any[] = [];
  const client = Object.assign(new EventEmitter(), { write: (_name: string, _packet: unknown) => {} });
  const bot = Object.assign(new EventEmitter(), { registry, version, _client: client, QUICK_BAR_START: 36,
    supportFeature: (name: string) => registry.supportFeature(name),
    getEquipmentDestSlot: (name: string) => name === 'off-hand' ? 45 : 5,
  }) as unknown as Bot;
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  bot.quickBarSlot = 0;
  const full = () => client.emit('window_items', { windowId: 0, stateId: ++stateId,
    items: server.slots.map((item: unknown) => Item.toNotch(item)), carriedItem: Item.toNotch(server.selectedItem) });
  // Exercise the real pinned native prediction/packet path, with a server that
  // rejects occupied cursor swaps but accepts the ordinary number-key action.
  client.write = (name: string, packet: any) => {
    if (name !== 'window_click') return;
    clicks.push(structuredClone(packet));
    const cursorSwap = packet.slot === 45 && packet.mode === 0 && server.slots[45] && server.selectedItem;
    const unnecessaryCleanup = rejectPostEquip && server.slots[45]?.name === 'shield' && packet.slot !== 45;
    const protectedSwap = packet.mode === 2 && packet.mouseButton !== 40 && packet.mouseButton === protectedHotbar;
    const denied = denyNumberSwap && packet.mode === 2 && (packet.slot === 45 || packet.mouseButton === 40);
    if (!cursorSwap && !unnecessaryCleanup && !protectedSwap && !denied) {
      if (packet.mode === 2 && packet.mouseButton === 40) {
        // Independent server-side F-key behavior; the pinned client prediction
        // does not implement this protocol action yet.
        const source = server.slots[packet.slot], offhand = server.slots[45];
        server.updateSlot(packet.slot, offhand); server.updateSlot(45, source);
      } else {
        server.acceptClick({ slot: packet.slot, mouseButton: packet.mouseButton, mode: packet.mode, item: server.slots[packet.slot] });
      }
    }
    setTimeout(full, 50);
  };
  const notes: any[] = [];
  installInventoryWindowSyncGuard(bot); installInventoryClickSync(bot, { write: (note: unknown) => notes.push(note) } as never);
  const seed = (slot: number, name: string, custom = false) => {
    const item = new Item(registry.itemsByName[name].id, 1);
    if (custom) item.customName = { type: 'string', value: 'Named backpack' };
    server.updateSlot(slot, item);
  };
  const raw = () => server.slots.map((item: unknown) => Item.toNotch(item));
  return { bot, server, clicks, full, seed, raw, notes };
}
afterEach(() => vi.useRealTimers());

it.each(['1.20.6', '1.21.1'])('swaps a stored item directly with offhand without touching a protected unrelated hotbar on %s', async version => {
  vi.useFakeTimers(); const r = nativeServer(version, false, false, 0);
  for (let slot = 9; slot < 45; slot++) r.seed(slot, 'stone');
  r.seed(36, 'player_head', true); r.seed(22, 'trident'); r.seed(45, 'shield');
  r.bot.quickBarSlot = 6; r.full();
  const before = structuredClone(r.raw()); let error: unknown;
  const operation = equipSlotConfirmed(r.bot, r.bot.inventory.slots[22]!, 'off-hand').catch(e => { error = e; });
  await vi.runAllTimersAsync(); await operation;
  expect(error).toBeUndefined();
  expect(r.clicks).toHaveLength(1);
  expect(r.clicks[0]).toMatchObject({ slot: 22, mode: 2, mouseButton: 40 });
  const after = r.raw();
  expect(after[22]).toEqual(before[45]); expect(after[45]).toEqual(before[22]);
  for (let slot = 0; slot < before.length; slot++) if (![22, 45].includes(slot)) expect(after[slot]).toEqual(before[slot]);
  expect(after.map(x => JSON.stringify(x)).sort()).toEqual(before.map(x => JSON.stringify(x)).sort());
  expect(r.bot.quickBarSlot).toBe(6); expect(r.bot.inventory.selectedItem).toBeNull();
  expect(inventoryClickState(r.bot).phase).toBe('ready');
});

it('does not fall back through a hotbar or cursor when a direct offhand exchange is denied', async () => {
  vi.useFakeTimers(); const r = nativeServer('1.21.1', true);
  r.seed(22, 'trident'); r.seed(45, 'shield'); r.seed(36, 'player_head', true); r.full();
  const before = structuredClone(r.raw());
  const operation = equipSlotConfirmed(r.bot, r.bot.inventory.slots[22]!, 'off-hand');
  const rejected = expect(operation).rejects.toMatchObject({ code: 'inventory-click-sync' });
  await vi.runAllTimersAsync(); await rejected;
  expect(r.clicks).toHaveLength(1);
  expect(r.clicks[0]).toMatchObject({ slot: 22, mouseButton: 40, mode: 2 });
  expect(r.raw()).toEqual(before); expect(r.bot.inventory.selectedItem).toBeNull();
  expect(inventoryClickState(r.bot).phase).toBe('ready'); // The denial already included its complete server frame.
  await vi.runAllTimersAsync(); expect(r.clicks).toHaveLength(1);
});

it('records authoritative before/expected/actual stack differences without custom item data', async () => {
  vi.useFakeTimers(); const r = nativeServer('1.21.1', false, false, 0);
  r.seed(22, 'trident'); r.seed(36, 'player_head', true); r.full();
  const operation = clickInventoryConfirmed(r.bot, 22, 0, 2, r.bot.inventory);
  const rejected = expect(operation).rejects.toMatchObject({ code: 'inventory-click-sync' });
  await vi.runAllTimersAsync(); await rejected;
  const data = r.notes.findLast(n => n.event === 'click-reconciled').data;
  expect(data).toMatchObject({ mode: 2, button: 0, mismatchedSlots: [22, 36], omittedSlotDetails: 0 });
  expect(data.slotDetails.map((s: any) => s.slot)).toEqual([22, 36]);
  const [source, hotbar] = data.slotDetails;
  expect(source.before).toMatchObject({ itemId: r.bot.registry.itemsByName.trident.id, count: 1 });
  expect(source.actual).toEqual(source.before);
  expect(source.expected).toEqual(hotbar.before);
  expect(hotbar.actual).toEqual(hotbar.before);
  expect(hotbar.expected).toEqual(source.before);
  expect(source.before.identitySha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(r.notes)).not.toContain('Named backpack');
});

it('finishes at confirmed offhand placement instead of issuing a refused post-goal hotbar restoration', async () => {
  vi.useFakeTimers(); const r = nativeServer('1.21.1', false, true);
  for (let slot = 9; slot < 45; slot++) r.seed(slot, 'stone');
  r.server.updateSlot(40, null); r.seed(11, 'shield'); r.seed(45, 'player_head', true); r.full();
  const before = structuredClone(r.raw()); let error: unknown;
  const operation = equipSlotConfirmed(r.bot, r.bot.inventory.slots[11]!, 'off-hand').catch(e => { error = e; });
  await vi.runAllTimersAsync(); await operation;
  expect(error).toBeUndefined(); expect(r.server.slots[45]?.name).toBe('shield');
  expect(r.raw()[11]).toEqual(before[45]); expect(r.server.slots[40]).toBeNull();
  expect(r.clicks.map(p => p.slot)).toEqual([11]);
  expect(r.server.selectedItem).toBeNull(); expect(inventoryClickState(r.bot).phase).toBe('ready');
});

it.each(['1.20.6', '1.21.1'])('replaces an occupied offhand without ever carrying a cursor stack on %s', async version => {
  vi.useFakeTimers(); const r = nativeServer(version);
  r.seed(9, 'shield'); r.seed(45, 'player_head', true); r.seed(36, 'diamond_sword'); r.full();
  const original = structuredClone(r.raw());
  let error: unknown;
  const operation = equipSlotConfirmed(r.bot, r.bot.inventory.slots[9]!, 'off-hand').catch(e => { error = e; });
  await vi.runAllTimersAsync(); await operation;
  expect(error).toBeUndefined();
  expect(r.server.slots[45]?.name).toBe('shield');
  expect(r.raw()[9]).toEqual(original[45]);
  expect(r.server.slots[37]).toBeNull();
  expect(r.raw()[36]).toEqual(original[36]);
  expect(r.server.selectedItem).toBeNull(); expect(r.bot.inventory.selectedItem).toBeNull();
  expect(r.clicks.every(p => p.mode === 2 && p.cursorItem.itemCount === 0)).toBe(true);
  expect(r.clicks).toHaveLength(1);
  expect(r.raw().map(x => JSON.stringify(x)).sort()).toEqual(original.map(x => JSON.stringify(x)).sort());
  expect(r.bot.quickBarSlot).toBe(0);
  expect(inventoryClickState(r.bot).phase).toBe('ready');
});

it('uses one confirmed number-key swap for a hotbar source, even with a full inventory', async () => {
  vi.useFakeTimers(); const r = nativeServer('1.21.1');
  for (let slot = 9; slot < 45; slot++) r.seed(slot, 'stone');
  r.seed(40, 'shield'); r.seed(45, 'player_head', true); r.full();
  const before = structuredClone(r.raw());
  let error: unknown;
  const operation = equipSlotConfirmed(r.bot, r.bot.inventory.slots[40]!, 'off-hand').catch(e => { error = e; });
  await vi.runAllTimersAsync(); await operation;
  expect(error).toBeUndefined();
  expect(r.clicks).toHaveLength(1); expect(r.clicks[0]).toMatchObject({ slot: 45, mouseButton: 4, mode: 2 });
  const after = r.raw(); expect(after[40]).toEqual(before[45]); expect(after[45]).toEqual(before[40]);
  for (let slot = 0; slot < before.length; slot++) if (slot !== 40 && slot !== 45) expect(after[slot]).toEqual(before[slot]);
  expect(r.server.selectedItem).toBeNull();
});

it('preserves every item and the selected hotbar while replacing offhand with a full inventory', async () => {
  vi.useFakeTimers(); const r = nativeServer('1.21.1');
  for (let slot = 9; slot < 45; slot++) r.seed(slot, 'stone');
  r.seed(9, 'shield'); r.seed(45, 'player_head', true); r.full();
  const before = structuredClone(r.raw());
  let error: unknown;
  const operation = equipSlotConfirmed(r.bot, r.bot.inventory.slots[9]!, 'off-hand').catch(e => { error = e; });
  await vi.runAllTimersAsync(); await operation;
  expect(error).toBeUndefined();
  const after = r.raw(); expect(after[9]).toEqual(before[45]); expect(after[45]).toEqual(before[9]);
  for (let slot = 0; slot < before.length; slot++) if (![9, 45].includes(slot)) expect(after[slot]).toEqual(before[slot]);
  expect(after.map(x => JSON.stringify(x)).sort()).toEqual(before.map(x => JSON.stringify(x)).sort());
  expect(r.clicks).toHaveLength(1); expect(r.clicks.every(p => p.mode === 2)).toBe(true);
  expect(r.server.selectedItem).toBeNull();
});

it('stops a refused number-key swap without a cursor stack, retry, drop or false success', async () => {
  vi.useFakeTimers(); const r = nativeServer('1.21.1', true);
  r.seed(40, 'shield'); r.seed(45, 'player_head', true); r.full();
  const before = structuredClone(r.raw());
  const operation = equipSlotConfirmed(r.bot, r.bot.inventory.slots[40]!, 'off-hand');
  const rejected = expect(operation).rejects.toMatchObject({ source: 'server', code: 'inventory-click-sync',
    message: expect.stringContaining('服务端已返回完整库存状态') });
  await vi.runAllTimersAsync(); await rejected;
  expect(r.raw()).toEqual(before); expect(r.server.selectedItem).toBeNull();
  expect(r.clicks).toHaveLength(1); expect(r.clicks[0].mode).toBe(2);
  expect(inventoryClickState(r.bot).phase).toBe('ready'); // Failure is terminal; no second identical snapshot is required.
  await vi.runAllTimersAsync(); expect(r.clicks).toHaveLength(1);
});
