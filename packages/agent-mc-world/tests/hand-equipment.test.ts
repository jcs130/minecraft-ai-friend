import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureHolding } from '../core/placement.ts';
import { skillEquip } from '../core/skills-craft.ts';
import { installInventoryClickSync } from '../core/inventory-click-sync.ts';
import { BowController } from '../core/ranged.ts';
import { Vec3 } from 'vec3';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));

// The server and client use real Prismarine windows, with delayed server snapshots.
function rig(denySwap = false, version = '1.20.6') {
  const registry = require('minecraft-data')(version);
  const Item = require('prismarine-item')(registry);
  const windows = require('prismarine-windows')(version);
  const inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  const server = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  const client = new EventEmitter() as EventEmitter & { write(name: string, packet: any): void };
  let stateId = 10;
  const sent: number[] = [];
  const bot = Object.assign(new EventEmitter(), {
    registry, inventory, currentWindow: null, _client: client, quickBarSlot: 0,
    supportFeature: (f: string) => registry.supportFeature(f),
    getEquipmentDestSlot: (dest: string) => dest === 'off-hand' ? 45 : 36 + bot.quickBarSlot,
    setQuickBarSlot: (slot: number) => { bot.quickBarSlot = slot; },
  }) as unknown as Bot;
  Object.defineProperty(bot, 'heldItem', { get: () => inventory.slots[36 + bot.quickBarSlot] });
  client.on('window_items', p => {
    p.items.forEach((raw: unknown, slot: number) => inventory.updateSlot(slot, Item.fromNotch(raw)));
  });
  client.write = (name, p) => {
    if (name !== 'window_click') return;
    sent.push(p.slot);
    const denied = denySwap && ((p.mode === 2 && p.mouseButton >= 0 && p.mouseButton < 9)
      || (p.slot === 36 && server.selectedItem && server.slots[36]));
    if (!denied) server.acceptClick({ slot: p.slot, mouseButton: p.mouseButton, mode: p.mode,
      item: server.slots[p.slot] });
    setTimeout(() => client.emit('window_items', { windowId: 0, stateId: ++stateId,
      items: server.slots.map((x: unknown) => Item.toNotch(x)), carriedItem: Item.toNotch(server.selectedItem) }), 166);
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
  return { bot, inventory, server, sent, seed };
}

afterEach(() => vi.useRealTimers());

describe('hand material server confirmation', () => {
  it.each([false, true])('bow drawing waits for authoritative 1.21.1 equipment; refused=%s', async denied => {
    vi.useFakeTimers();
    const r = rig(denied, '1.21.1');
    r.seed(9, 'bow'); r.seed(36, 'bread'); r.seed(10, 'arrow');
    const activated: string[] = [], released: string[] = [];
    Object.assign(r.bot, {
      entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62 },
      lookAt: async () => {},
      activateItem: () => { activated.push(r.server.slots[36 + r.bot.quickBarSlot]?.name); },
      deactivateItem: () => { released.push(r.server.slots[36 + r.bot.quickBarSlot]?.name); },
    });
    const bow = new BowController({ getBot: () => r.bot, hasLos: () => true });
    const result = bow.shoot({ id: 7, position: new Vec3(9.8, 64, 0), height: 1.95 });
    await vi.advanceTimersByTimeAsync(165);
    expect(activated).toEqual([]);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject(denied ? { kind: 'blocked', cause: 'equip_timeout' } : { kind: 'released' });
    expect(activated).toEqual(denied ? [] : ['bow']);
    expect(released).toEqual(denied ? [] : ['bow']);
    expect(r.server.selectedItem).toBeNull();
    expect(r.sent).toEqual([9]);
    expect(bow.active).toBe(false);
  });

  it('a cancelled bow swap cannot activate the hand after its late server acknowledgement', async () => {
    vi.useFakeTimers();
    const r = rig(false, '1.21.1');
    r.seed(9, 'bow'); r.seed(36, 'bread'); r.seed(10, 'arrow');
    const activate = vi.fn();
    Object.assign(r.bot, { entity: { position: new Vec3(0, 64, 0) }, activateItem: activate });
    let owned = true;
    const bow = new BowController({ getBot: () => r.bot, hasLos: () => true, leaseValid: () => owned });
    const result = bow.shoot({ id: 7, position: new Vec3(9.8, 64, 0), height: 1.95 }, {});
    await vi.advanceTimersByTimeAsync(100); owned = false;
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ kind: 'blocked', cause: 'lease' });
    expect(activate).not.toHaveBeenCalled();
    expect(r.server.selectedItem).toBeNull();
    expect(bow.active).toBe(false);
  });
  it('waits for the complete material swap before construction can use the hand', async () => {
    vi.useFakeTimers();
    const r = rig();
    let finished = false;
    const result = ensureHolding(r.bot, 'green_bed').then(v => { finished = true; return v; });
    await vi.advanceTimersByTimeAsync(165);
    expect(finished).toBe(false);
    await vi.runAllTimersAsync();
    expect(await result).toBe(true);
    expect(r.server.slots[36 + r.bot.quickBarSlot].name).toBe('green_bed');
    expect(r.server.slots[36].name).toBe('player_head');
    expect(r.server.slots[9]).toBeNull();
    expect(r.server.selectedItem).toBeNull();
  });

  it('stops a refused material swap without picking up or dropping a cursor item', async () => {
    vi.useFakeTimers();
    const r = rig(true);
    const result = ensureHolding(r.bot, 'green_bed');
    const failed = expect(result).rejects.toMatchObject({ source: 'server', code: 'inventory-click-sync' });
    await vi.runAllTimersAsync();
    await failed;
    expect(r.server.slots[36].name).toBe('player_head');
    expect(r.server.slots[9].name).toBe('green_bed');
    expect(r.server.selectedItem).toBeNull();
    expect(r.sent).toEqual([9]);
  });

  it('does not report a named main-hand equip before the server confirms its final slots', async () => {
    vi.useFakeTimers();
    const r = rig();
    let finished = false;
    const result = skillEquip(r.bot, { skill: 'equip', item: 'green_bed', hand: 'main' })
      .then(v => { finished = true; return v; });
    await vi.advanceTimersByTimeAsync(165);
    expect(finished).toBe(false);
    await vi.runAllTimersAsync();
    expect(await result).toContain('手里拿起了');
    expect(r.server.slots[36 + r.bot.quickBarSlot].name).toBe('green_bed');
    expect(r.server.slots[36].name).toBe('player_head');
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
