import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { clearOffHandConfirmed, equipHandConfirmed, equipSlotConfirmed, unequipSlotConfirmed } from '../core/equipment.ts';
import { skillEquip } from '../core/skills-craft.ts';
import { installInventoryClickSync, INVENTORY_CLICK_CONFIRM_MS } from '../core/inventory-click-sync.ts';

const require = createRequire(import.meta.url);
const dependency = (name: string) => require(require.resolve(name, { paths: [require.resolve('mineflayer')] }));

function equipmentServer(options: { denySwap?: boolean; denyPickup?: boolean; denyHandSwap?: boolean; denyAnyHandSwap?: boolean; silent?: boolean; version?: string } = {}) {
  const registry = require('minecraft-data')(options.version ?? '1.20.6');
  const Item = dependency('prismarine-item')(registry);
  const windows = dependency('prismarine-windows')(registry.version.minecraftVersion);
  const inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  const server = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  const client = new EventEmitter() as EventEmitter & { write(name: string, packet: Record<string, any>): void };
  const bot = Object.assign(new EventEmitter(), {
    registry, inventory, currentWindow: null, _client: client,
    supportFeature: (feature: string) => registry.supportFeature(feature),
    quickBarSlot: 8,
    getEquipmentDestSlot: (dest: string) => dest === 'hand' ? 36 + bot.quickBarSlot
      : ({ head: 5, torso: 6, legs: 7, feet: 8, 'off-hand': 45 })[dest],
    setQuickBarSlot: (index: number) => { bot.quickBarSlot = index; },
    equip: async () => { throw new Error('Modern equipment must use confirmed clicks'); },
    unequip: async () => { throw new Error('Modern equipment must use confirmed clicks'); },
    clickWindow: async () => {},
  }) as unknown as Bot;
  let stateId = 40;
  const sent: number[] = [];
  const cursorHistory: (string | null)[] = [];
  Object.defineProperty(bot, 'heldItem', { get: () => inventory.slots[36 + bot.quickBarSlot] });
  const full = () => client.emit('window_items', { windowId: 0, stateId: ++stateId,
    items: server.slots.map((item: unknown) => Item.toNotch(item)), carriedItem: Item.toNotch(server.selectedItem) });
  client.on('window_items', packet => {
    packet.items.forEach((raw: unknown, slot: number) => inventory.updateSlot(slot, Item.fromNotch(raw)));
  });
  client.write = (name, packet) => {
    if (name !== 'window_click') return;
    sent.push(packet.slot);
    const denied = (packet.slot === 45 && options.denyPickup)
      || (options.denySwap && server.slots[45] && ((packet.slot === 45 && server.selectedItem)
        || (packet.mode === 2 && (packet.slot === 45 || packet.mouseButton === 40))))
      || (options.denyAnyHandSwap && packet.mode === 2 && packet.mouseButton >= 0 && packet.mouseButton < 9)
      || (options.denyHandSwap && ((packet.mode === 2 && packet.mouseButton === 8)
        || (packet.mode === 0 && packet.slot === 44)));
    if (!denied) {
      if (packet.mode === 2 && packet.mouseButton === 40) {
        const source = server.slots[packet.slot], offhand = server.slots[45];
        server.updateSlot(packet.slot, offhand); server.updateSlot(45, source);
      } else server.acceptClick({ slot: packet.slot, mouseButton: packet.mouseButton, mode: packet.mode,
        item: server.slots[packet.slot] });
    }
    cursorHistory.push(server.selectedItem?.name ?? null);
    if (!options.silent) setTimeout(full, 166);
  };
  bot.clickWindow = async (slot, mouseButton, mode) => {
    const before = inventory.slots.map((item: unknown) => Item.toNotch(item));
    const nativeChanged = inventory.acceptClick({ slot, mouseButton, mode, item: inventory.slots[slot] });
    const changed = nativeChanged ?? inventory.slots.flatMap((item: unknown, index: number) =>
      JSON.stringify(Item.toNotch(item)) === JSON.stringify(before[index]) ? [] : [index]);
    client.write('window_click', { windowId: 0, stateId, slot, mouseButton, mode,
      changedSlots: changed.map((location: number) => ({ location, item: Item.toNotch(inventory.slots[location]) })),
      cursorItem: Item.toNotch(inventory.selectedItem) });
  };
  const seed = (slot: number, name: string, count = 1) => {
    inventory.updateSlot(slot, new Item(registry.itemsByName[name].id, count));
    server.updateSlot(slot, new Item(registry.itemsByName[name].id, count));
  };
  installInventoryClickSync(bot);
  return { bot, inventory, server, seed, sent, cursorHistory };
}

afterEach(() => vi.useRealTimers());

describe('equipment server confirmation', () => {
  it.each(['1.21.1', '1.20.6'])('stops cancelled %s hand selection after the original cursor ACK without dispatching a new swap', async version => {
    vi.useFakeTimers();
    const rig = equipmentServer({ version });
    rig.seed(10, 'iron_sword'); rig.seed(12, 'cobblestone', 4);
    rig.inventory.selectedItem = rig.inventory.slots[12]; rig.inventory.updateSlot(12, null);
    rig.server.selectedItem = rig.server.slots[12]; rig.server.updateSlot(12, null);
    let active = true;
    const operation = equipHandConfirmed(rig.bot, rig.inventory.slots[10], () => {
      if (!active) throw Error('Original task cancelled');
    });
    const stopped = expect(operation).rejects.toThrow('Original task cancelled');
    await vi.advanceTimersByTimeAsync(50);
    expect(rig.sent).toEqual([9]); // the already-dispatched cursor return still awaits its ACK
    active = false;
    await vi.runAllTimersAsync(); await stopped;
    expect(rig.sent).toEqual([9]); // late ACK must not authorize the cancelled task's next click
    expect(rig.server.slots[10].name).toBe('iron_sword');
    expect(rig.server.slots[44]).toBeNull();
    expect(rig.server.selectedItem).toBeNull();
    const next = equipHandConfirmed(rig.bot, rig.inventory.slots[10]);
    await vi.runAllTimersAsync(); await next;
    expect(rig.sent).toEqual([9, 10]); // a new explicit operation can use the confirmed inventory
    expect(rig.server.slots[44].name).toBe('iron_sword');
  });

  it('does not select a hotbar weapon after cancellation during cursor recovery', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer({ version: '1.21.1' });
    rig.seed(36, 'iron_sword'); rig.seed(12, 'cobblestone', 4);
    rig.inventory.selectedItem = rig.inventory.slots[12]; rig.inventory.updateSlot(12, null);
    rig.server.selectedItem = rig.server.slots[12]; rig.server.updateSlot(12, null);
    rig.bot.setQuickBarSlot = vi.fn();
    let active = true;
    const operation = equipHandConfirmed(rig.bot, rig.inventory.slots[36], () => {
      if (!active) throw Error('Original task cancelled');
    });
    const stopped = expect(operation).rejects.toThrow('Original task cancelled');
    await vi.advanceTimersByTimeAsync(50); active = false;
    await vi.runAllTimersAsync(); await stopped;
    expect(rig.sent).toEqual([9]); expect(rig.bot.setQuickBarSlot).not.toHaveBeenCalled();
  });

  it('changes main-hand stacks in a full 1.21.1 inventory without borrowing the cursor', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer({ version: '1.21.1' });
    for (let slot = 9; slot < 45; slot++) rig.seed(slot, 'cobblestone', 64);
    rig.seed(9, 'torch', 64); rig.seed(44, 'torch', 11);
    const equip = equipHandConfirmed(rig.bot, rig.inventory.slots[9]);
    await vi.runAllTimersAsync();
    await equip;
    expect(rig.cursorHistory.every(item => item === null)).toBe(true);
    expect(rig.inventory.selectedItem).toBeNull();
    expect(rig.server.selectedItem).toBeNull();
    expect(rig.server.slots[44]).toMatchObject({ name: 'torch', count: 64 });
    expect(rig.server.slots[9]).toMatchObject({ name: 'torch', count: 11 });
    expect(rig.server.items()).toHaveLength(36);
    expect(rig.sent).not.toContain(-999);
  });

  it('keeps a refused main-hand swap unconfirmed without cursor or follow-up clicks', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer({ version: '1.21.1', denyAnyHandSwap: true });
    rig.seed(9, 'torch', 64); rig.seed(44, 'stone_pickaxe');
    const equip = equipHandConfirmed(rig.bot, rig.inventory.slots[9]);
    const failed = expect(equip).rejects.toMatchObject({ source: 'server', code: 'inventory-click-sync' });
    await vi.runAllTimersAsync(); await failed;
    expect(rig.server.slots[44].name).toBe('stone_pickaxe');
    expect(rig.server.slots[9]).toMatchObject({ name: 'torch', count: 64 });
    expect(rig.cursorHistory.every(item => item === null)).toBe(true);
    expect(rig.sent).toHaveLength(1);
  });

  it.each(['1.21.1', '1.20.6'])('equips into an empty %s hotbar slot without moving a protected selected shortcut', async version => {
    vi.useFakeTimers();
    const rig = equipmentServer({ version, denyHandSwap: true });
    rig.seed(9, 'iron_sword'); rig.seed(44, 'player_head'); rig.seed(36, 'bread', 3);
    const operation = equipHandConfirmed(rig.bot, rig.inventory.slots[9]);
    await vi.advanceTimersByTimeAsync(165);
    expect(rig.bot.quickBarSlot).toBe(8); // do not select the optimistic destination before its ACK
    await vi.runAllTimersAsync(); await operation;
    expect(rig.server.slots[44].name).toBe('player_head');
    expect(rig.server.slots[36]).toMatchObject({ name: 'bread', count: 3 });
    expect(rig.server.slots[37].name).toBe('iron_sword');
    expect(rig.bot.quickBarSlot).toBe(1);
    expect(rig.bot.heldItem?.name).toBe('iron_sword');
    expect(rig.sent).toEqual([9]);
    expect(rig.cursorHistory.every(item => item === null)).toBe(true);
  });

  it.each(['1.21.1', '1.20.6'])('preserves a selected named shortcut when the %s hotbar is full', async version => {
    vi.useFakeTimers();
    const rig = equipmentServer({ version, denyHandSwap: true });
    for (let slot = 9; slot < 45; slot++) rig.seed(slot, 'cobblestone', 64);
    rig.seed(29, 'iron_sword'); rig.seed(44, 'player_head'); rig.seed(37, 'stick', 9);
    for (const window of [rig.inventory, rig.server]) {
      for (let slot = 36; slot < 45; slot++) {
        if (slot !== 37) window.slots[slot].customName = 'Inventory shortcut';
      }
    }
    const operation = equipHandConfirmed(rig.bot, rig.inventory.slots[29]);
    // Capture a rejection immediately so the old implementation is a clean failing regression.
    const result = operation.then(() => null, error => error);
    await vi.advanceTimersByTimeAsync(165);
    expect(rig.bot.quickBarSlot).toBe(8);
    await vi.runAllTimersAsync();
    expect(await result).toBeNull();
    expect(rig.bot.quickBarSlot).toBe(1);
    expect(rig.server.slots[37].name).toBe('iron_sword');
    expect(rig.server.slots[29]).toMatchObject({ name: 'stick', count: 9 });
    expect(rig.server.slots[44].name).toBe('player_head');
    expect(rig.server.items()).toHaveLength(36);
    expect(rig.cursorHistory.every(item => item === null)).toBe(true);
    expect(rig.sent).toEqual([29]);
  });

  it.each(['denied', 'cancelled'])('keeps one full-hotbar swap isolated when it is %s', async outcome => {
    vi.useFakeTimers();
    const rig = equipmentServer({ version: '1.21.1', denyAnyHandSwap: outcome === 'denied' });
    for (let slot = 9; slot < 45; slot++) rig.seed(slot, 'cobblestone', 64);
    rig.seed(29, 'iron_sword'); rig.seed(44, 'player_head');
    rig.inventory.slots[44].customName = 'Inventory shortcut';
    let active = true;
    const operation = equipHandConfirmed(rig.bot, rig.inventory.slots[29], () => {
      if (!active) throw Error('Original task cancelled');
    });
    const result = operation.then(() => null, error => error);
    await vi.advanceTimersByTimeAsync(50);
    if (outcome === 'cancelled') active = false;
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(Error);
    expect(rig.bot.quickBarSlot).toBe(8);
    expect(rig.server.slots[44].name).toBe('player_head');
    expect(rig.server.slots[29].name).toBe(outcome === 'denied' ? 'iron_sword' : 'cobblestone');
    expect(rig.server.slots[36].name).toBe(outcome === 'denied' ? 'cobblestone' : 'iron_sword');
    expect(rig.server.items()).toHaveLength(36);
    expect(rig.cursorHistory.every(item => item === null)).toBe(true);
    expect(rig.sent).toEqual([29]);
  });

  it('does not select a confirmed spare hotbar slot when the original task was cancelled during its ACK', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer({ version: '1.21.1', denyHandSwap: true });
    rig.seed(9, 'iron_sword'); rig.seed(44, 'player_head');
    let active = true;
    const operation = equipHandConfirmed(rig.bot, rig.inventory.slots[9], () => {
      if (!active) throw Error('Original task cancelled');
    });
    const stopped = expect(operation).rejects.toThrow('Original task cancelled');
    await vi.advanceTimersByTimeAsync(50); active = false;
    await vi.runAllTimersAsync(); await stopped;
    expect(rig.bot.quickBarSlot).toBe(8);
    expect(rig.server.slots[44].name).toBe('player_head');
    expect(rig.server.slots[36].name).toBe('iron_sword');
    expect(rig.sent).toEqual([9]);
  });

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

  it('finishes a direct shield swap only after the server slot and cursor snapshot is confirmed', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer();
    rig.seed(9, 'shield'); rig.seed(45, 'totem_of_undying');
    let finished = false;
    const equip = skillEquip(rig.bot, { skill: 'equip', item: 'shield', hand: 'off' }).then(text => { finished = true; return text; });
    await vi.advanceTimersByTimeAsync(165);
    expect(finished).toBe(false);
    expect(rig.sent).toEqual([9]);
    await vi.runAllTimersAsync();
    expect(await equip).toContain('盾牌挂上了副手');
    expect(rig.server.slots[45].name).toBe('shield');
    expect(rig.server.slots[9].name).toBe('totem_of_undying');
    expect(rig.server.slots[36]).toBeNull();
    expect(rig.server.selectedItem).toBeNull();
  });

  it('a denied offhand swap preserves server state and never reports success or sends the next click', async () => {
    vi.useFakeTimers();
    const rig = equipmentServer({ denySwap: true });
    rig.seed(9, 'shield'); rig.seed(45, 'player_head');
    const equip = skillEquip(rig.bot, { skill: 'equip', item: 'shield', hand: 'off' });
    const failed = expect(equip).rejects.toMatchObject({ source: 'server', code: 'inventory-click-sync' });
    await vi.advanceTimersByTimeAsync(332);
    expect(rig.inventory.slots[45].name).toBe('player_head');
    await vi.runAllTimersAsync(); await failed;
    expect(rig.sent).toEqual([9]);
    expect(rig.server.slots[45].name).toBe('player_head');
    expect(rig.server.selectedItem).toBeNull();
    expect(rig.server.slots[9].name).toBe('shield');
    expect(rig.server.slots[36]).toBeNull();
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
