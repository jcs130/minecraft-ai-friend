import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { clearOffHandConfirmed, equipSlotConfirmed, unequipSlotConfirmed } from '../core/equipment.ts';
import { skillEquip } from '../core/skills-craft.ts';
import { installInventoryClickSync, INVENTORY_CLICK_CONFIRM_MS } from '../core/inventory-click-sync.ts';

const require = createRequire(import.meta.url);
const dependency = (name: string) => require(require.resolve(name, { paths: [require.resolve('mineflayer')] }));

function equipmentServer(options: { denySwap?: boolean; denyPickup?: boolean; silent?: boolean; version?: string } = {}) {
  const registry = require('minecraft-data')(options.version ?? '1.20.6');
  const Item = dependency('prismarine-item')(registry);
  const windows = dependency('prismarine-windows')(registry.version.minecraftVersion);
  const inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  const server = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  const client = new EventEmitter() as EventEmitter & { write(name: string, packet: Record<string, any>): void };
  const bot = Object.assign(new EventEmitter(), {
    registry, inventory, currentWindow: null, _client: client,
    supportFeature: (feature: string) => registry.supportFeature(feature),
    getEquipmentDestSlot: (dest: string) => ({ head: 5, torso: 6, legs: 7, feet: 8, 'off-hand': 45 })[dest],
    equip: async () => { throw new Error('Modern equipment must use confirmed clicks'); },
    unequip: async () => { throw new Error('Modern equipment must use confirmed clicks'); },
    clickWindow: async () => {},
  }) as unknown as Bot;
  let stateId = 40;
  const sent: number[] = [];
  const full = () => client.emit('window_items', { windowId: 0, stateId: ++stateId,
    items: server.slots.map((item: unknown) => Item.toNotch(item)), carriedItem: Item.toNotch(server.selectedItem) });
  client.on('window_items', packet => {
    packet.items.forEach((raw: unknown, slot: number) => inventory.updateSlot(slot, Item.fromNotch(raw)));
  });
  client.write = (name, packet) => {
    if (name !== 'window_click') return;
    sent.push(packet.slot);
    const denied = packet.slot === 45 && (options.denyPickup || (options.denySwap && server.slots[45] && server.selectedItem));
    if (!denied) server.acceptClick({ slot: packet.slot, mouseButton: packet.mouseButton, mode: packet.mode,
      item: server.slots[packet.slot] });
    if (!options.silent) setTimeout(full, 166);
  };
  bot.clickWindow = async (slot, mouseButton, mode) => {
    const changed = inventory.acceptClick({ slot, mouseButton, mode, item: inventory.slots[slot] });
    client.write('window_click', { windowId: 0, stateId, slot, mouseButton, mode,
      changedSlots: changed.map((location: number) => ({ location, item: Item.toNotch(inventory.slots[location]) })),
      cursorItem: Item.toNotch(inventory.selectedItem) });
  };
  const seed = (slot: number, name: string) => {
    inventory.updateSlot(slot, new Item(registry.itemsByName[name].id, 1));
    server.updateSlot(slot, new Item(registry.itemsByName[name].id, 1));
  };
  installInventoryClickSync(bot);
  return { bot, inventory, server, seed, sent };
}

afterEach(() => vi.useRealTimers());

describe('equipment server confirmation', () => {
  it('returns armor to inventory only after server pickup and cursor recovery are confirmed', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer();
    rig.seed(5, 'iron_helmet');
    let finished = false;
    const remove = unequipSlotConfirmed(rig.bot, 'head').then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(165);
    expect(finished).toBe(false);
    expect(rig.server.slots[5]).toBeNull();
    await vi.runAllTimersAsync(); await remove;
    expect(finished).toBe(true);
    expect(rig.server.items().map((item: { name: string }) => item.name)).toContain('iron_helmet');
    expect(rig.server.selectedItem).toBeNull();
    expect(rig.sent).not.toContain(-999);
  });

  it('finishes a shield swap only after pickup, placement and cursor return are confirmed', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer();
    rig.seed(9, 'shield'); rig.seed(45, 'totem_of_undying');
    let finished = false;
    const equip = skillEquip(rig.bot, { skill: 'equip', item: 'shield', hand: 'off' }).then(text => { finished = true; return text; });
    await vi.advanceTimersByTimeAsync(331);
    expect(finished).toBe(false);
    expect(rig.sent).toEqual([9, 45]);
    await vi.runAllTimersAsync();
    expect(await equip).toContain('盾牌挂上了副手');
    expect(rig.server.slots[45].name).toBe('shield');
    expect(rig.server.slots[9].name).toBe('totem_of_undying');
    expect(rig.server.selectedItem).toBeNull();
  });

  it('a denied offhand swap rolls back after 166ms and never reports success or sends the next click', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer({ denySwap: true });
    rig.seed(9, 'shield'); rig.seed(45, 'player_head');
    const equip = skillEquip(rig.bot, { skill: 'equip', item: 'shield', hand: 'off' });
    const failed = expect(equip).rejects.toMatchObject({ source: 'server', code: 'inventory-click-sync' });
    await vi.advanceTimersByTimeAsync(332);
    expect(rig.inventory.slots[45].name).toBe('player_head');
    await vi.runAllTimersAsync(); await failed;
    expect(rig.sent).toEqual([9, 45]);
    expect(rig.server.slots[45].name).toBe('player_head');
    expect(rig.server.selectedItem.name).toBe('shield');
  });

  it('clears a shortcut into storage before equipping a shield without dropping either item', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer({ denySwap: true });
    rig.seed(9, 'shield'); rig.seed(45, 'player_head');
    const clear = skillEquip(rig.bot, { skill: 'equip', hand: 'off' });
    await vi.runAllTimersAsync();
    expect(await clear).toContain('副手腾空了');
    expect(rig.server.slots[45]).toBeNull();
    const equip = skillEquip(rig.bot, { skill: 'equip', item: 'shield', hand: 'off' });
    await vi.runAllTimersAsync(); await equip;
    expect(rig.server.slots[45].name).toBe('shield');
    expect(rig.server.items().map((item: { name: string }) => item.name)).toContain('player_head');
    expect(rig.server.selectedItem).toBeNull();
    expect(rig.sent).not.toContain(-999);
  });

  it('a refused offhand pickup cannot report the hand empty', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer({ denyPickup: true });
    rig.seed(45, 'player_head');
    const clear = clearOffHandConfirmed(rig.bot);
    const failed = expect(clear).rejects.toMatchObject({ source: 'server', code: 'inventory-click-sync' });
    await vi.runAllTimersAsync(); await failed;
    expect(rig.server.slots[45].name).toBe('player_head');
    expect(rig.sent).toEqual([45]);
  });

  it('a silent server leaves optimistic local state unconfirmed and preserves the cursor', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer({ silent: true });
    rig.seed(9, 'iron_helmet');
    const equip = equipSlotConfirmed(rig.bot, rig.inventory.slots[9], 'head');
    const failed = expect(equip).rejects.toMatchObject({ source: 'server', code: 'inventory-click-sync' });
    await vi.advanceTimersByTimeAsync(INVENTORY_CLICK_CONFIRM_MS); await failed;
    expect(rig.server.slots[5]).toBeNull();
    expect(rig.server.selectedItem.name).toBe('iron_helmet');
    expect(rig.sent).toEqual([9]);
  });

  it('legacy native success still requires the equipment slot to contain the requested item', async () => {
    const rig = equipmentServer({ version: '1.16.5' });
    rig.seed(9, 'iron_helmet');
    rig.bot.equip = async () => {};
    await expect(equipSlotConfirmed(rig.bot, rig.inventory.slots[9], 'head')).rejects.toMatchObject({ source: 'server' });
    expect(rig.server.slots[5]).toBeNull();
  });
});
