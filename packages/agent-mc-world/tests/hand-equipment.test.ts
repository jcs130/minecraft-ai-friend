import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureHolding } from '../core/placement.ts';
import { skillEquip } from '../core/skills-craft.ts';
import { installInventoryClickSync } from '../core/inventory-click-sync.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));

// The server and client use real Prismarine windows, with delayed server snapshots.
function rig(denySwap = false) {
  const registry = require('minecraft-data')('1.20.6');
  const Item = require('prismarine-item')(registry);
  const windows = require('prismarine-windows')('1.20.6');
  const inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  const server = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  const client = new EventEmitter() as EventEmitter & { write(name: string, packet: any): void };
  let stateId = 10;
  const sent: number[] = [];
  const bot = Object.assign(new EventEmitter(), {
    registry, inventory, currentWindow: null, _client: client, quickBarSlot: 0,
    supportFeature: (f: string) => registry.supportFeature(f),
    getEquipmentDestSlot: () => 36 + bot.quickBarSlot,
    setQuickBarSlot: (slot: number) => { bot.quickBarSlot = slot; },
  }) as unknown as Bot;
  Object.defineProperty(bot, 'heldItem', { get: () => inventory.slots[36 + bot.quickBarSlot] });
  client.on('window_items', p => {
    p.items.forEach((raw: unknown, slot: number) => inventory.updateSlot(slot, Item.fromNotch(raw)));
  });
  client.write = (name, p) => {
    if (name !== 'window_click') return;
    sent.push(p.slot);
    const denied = denySwap && p.slot === 36 && server.selectedItem && server.slots[36];
    if (!denied) server.acceptClick({ slot: p.slot, mouseButton: p.mouseButton, mode: p.mode,
      item: server.slots[p.slot] });
    setTimeout(() => client.emit('window_items', { windowId: 0, stateId: ++stateId,
      items: server.slots.map((x: unknown) => Item.toNotch(x)), carriedItem: Item.toNotch(server.selectedItem) }), 166);
  };
  bot.clickWindow = async (slot, mouseButton, mode) => {
    const changed = inventory.acceptClick({ slot, mouseButton, mode, item: inventory.slots[slot] });
    client.write('window_click', { windowId: 0, stateId, slot, mouseButton, mode,
      changedSlots: changed.map((location: number) => ({ location, item: Item.toNotch(inventory.slots[location]) })),
      cursorItem: Item.toNotch(inventory.selectedItem) });
  };
  // Native moveSlotItem resolves from optimistic clicks, before those snapshots.
  bot.equip = async item => {
    const source = (item as { slot: number }).slot;
    await bot.clickWindow(source, 0, 0);
    await bot.clickWindow(36, 0, 0);
    if (inventory.selectedItem) await bot.clickWindow(source, 0, 0);
  };
  const seed = (slot: number, name: string) => {
    inventory.updateSlot(slot, new Item(registry.itemsByName[name].id, 1));
    server.updateSlot(slot, new Item(registry.itemsByName[name].id, 1));
  };
  seed(9, 'green_bed'); seed(36, 'player_head');
  installInventoryClickSync(bot);
  return { bot, inventory, server, sent };
}

afterEach(() => vi.useRealTimers());

describe('hand material server confirmation', () => {
  it('waits for the complete material swap before construction can use the hand', async () => {
    vi.useFakeTimers();
    const r = rig();
    let finished = false;
    const result = ensureHolding(r.bot, 'green_bed').then(v => { finished = true; return v; });
    await vi.advanceTimersByTimeAsync(165);
    expect(finished).toBe(false);
    await vi.runAllTimersAsync();
    expect(await result).toBe(true);
    expect(r.server.slots[36].name).toBe('green_bed');
    expect(r.server.slots[9].name).toBe('player_head');
    expect(r.server.selectedItem).toBeNull();
  });

  it('stops a refused material swap without returning or dropping its cursor', async () => {
    vi.useFakeTimers();
    const r = rig(true);
    const result = ensureHolding(r.bot, 'green_bed');
    const failed = expect(result).rejects.toMatchObject({ source: 'server', code: 'inventory-click-sync' });
    await vi.runAllTimersAsync();
    await failed;
    expect(r.server.slots[36].name).toBe('player_head');
    expect(r.server.selectedItem.name).toBe('green_bed');
    expect(r.sent).toEqual([9, 36]);
  });

  it('does not report a named main-hand equip before the server confirms its final slots', async () => {
    vi.useFakeTimers();
    const r = rig();
    let finished = false;
    const result = skillEquip(r.bot, { skill: 'equip', item: 'green_bed', hand: 'main' })
      .then(v => { finished = true; return v; });
    await vi.advanceTimersByTimeAsync(331);
    expect(finished).toBe(false);
    await vi.runAllTimersAsync();
    expect(await result).toContain('手里拿起了');
    expect(r.server.slots[36].name).toBe('green_bed');
    expect(r.server.selectedItem).toBeNull();
    expect(r.sent).not.toContain(-999);
  });

  it('selects a material already in the hotbar without moving inventory or adding a server wait', async () => {
    const r = rig();
    r.inventory.updateSlot(38, r.inventory.slots[9]);
    r.inventory.updateSlot(9, null);
    r.server.updateSlot(38, r.server.slots[9]);
    r.server.updateSlot(9, null);
    expect(await ensureHolding(r.bot, 'green_bed')).toBe(true);
    expect(r.bot.quickBarSlot).toBe(2);
    expect(r.bot.heldItem?.name).toBe('green_bed');
    expect(r.sent).toEqual([]);
    expect(r.server.slots[36].name).toBe('player_head');
  });
});
