import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { installMineflayerFixes } from '../core/mineflayer-fixes.ts';

const mf = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
afterEach(() => vi.useRealTimers());

function rig(version: string, product = 'torch', noOutputRoom = false, oldGrid = false) {
  vi.useFakeTimers();
  const registry = mf('prismarine-registry')(version);
  const Item = mf('prismarine-item')(registry);
  const windows = mf('prismarine-windows')(version);
  const server = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
  const clicks: Array<{ slot: number; button: number }> = [];
  const notes: any[] = [];
  let revision = 0, pickupAdded = false;
  const make = (name: string, count = 1) => new Item(registry.itemsByName[name].id, count);
  const resultCount = product === 'torch' ? 4 : 1;
  const recipe = product === 'torch'
    ? { requiresTable: false, inShape: [[{ id: registry.itemsByName.coal.id }], [{ id: registry.itemsByName.stick.id }]],
      result: { id: registry.itemsByName.torch.id, count: 4 } }
    : { requiresTable: false, inShape: [[{ id: registry.itemsByName.oak_planks.id }, { id: registry.itemsByName.oak_planks.id }],
      [{ id: registry.itemsByName.oak_planks.id }, { id: registry.itemsByName.oak_planks.id }]],
      result: { id: registry.itemsByName.crafting_table.id, count: 1 } };
  const plan = new Map<number, number>();
  recipe.inShape.forEach((row, y) => row.forEach((cell, x) => plan.set(1 + x + y * 2, cell.id)));
  const resultReady = () => [...plan].every(([slot, id]) => server.slots[slot]?.type === id);
  const updateResult = () => server.updateSlot(0, resultReady() ? make(product, resultCount) : null);
  const client = Object.assign(new EventEmitter(), { write: vi.fn((name: string, packet: any) => {
    if (name !== 'window_click') return;
    clicks.push({ slot: packet.slot, button: packet.mouseButton });
    const takingResult = packet.slot === 0 && server.slots[0];
    server.acceptClick({ slot: packet.slot, mouseButton: packet.mouseButton, mode: packet.mode,
      item: server.slots[packet.slot] });
    if (takingResult) for (const slot of plan.keys()) {
      const item = server.slots[slot];
      server.updateSlot(slot, item.count > 1 ? make(item.name, item.count - 1) : null);
    }
    // A delayed crop pickup arrives after the grid placement, not during the
    // source click's acknowledgement. A retained source stack blocks this slot.
    if (!pickupAdded && packet.slot > 0 && packet.slot < 5 && !server.slots[9]) {
      server.updateSlot(9, make('wheat_seeds', 3));
      pickupAdded = true;
    }
    updateResult();
    queueMicrotask(full);
  }) });
  const bot = Object.assign(new EventEmitter(), {
    registry, version, _client: client, QUICK_BAR_START: 36,
    supportFeature: (name: string) => registry.supportFeature(name),
    craft: async () => {}, placeBlock: async () => {}, _updateBlockState() {},
    entity: { id: 1, position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' },
  }) as unknown as Bot;
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  function full() {
    client.emit('window_items', { windowId: 0, stateId: ++revision,
      items: server.slots.map((item: unknown) => Item.toNotch(item)), carriedItem: Item.toNotch(server.selectedItem) });
  }
  for (let slot = 9; slot < 45; slot++) server.updateSlot(slot, make('stone_pickaxe'));
  if (!oldGrid) {
    server.updateSlot(9, make(product === 'torch' ? 'coal' : 'oak_planks', product === 'torch' ? 13 : 5));
    if (product === 'torch') server.updateSlot(10, make('stick', 4));
    if (!noOutputRoom) server.updateSlot(11, make(product, product === 'torch' ? 22 : 1));
  } else server.updateSlot(1, make('coal'));
  updateResult();
  installMineflayerFixes(bot, { info() {}, warn() {}, error() {}, debug() {} } as never,
    { write: (note: unknown) => notes.push(note) } as never);
  full();
  const count = (name: string) => server.slots.slice(9, 45)
    .filter((item: any) => item?.name === name).reduce((sum: number, item: any) => sum + item.count, 0);
  return { bot, server, recipe, clicks, count, notes, pickupAdded: () => pickupAdded };
}

it.each(['1.20.6', '1.21.1'])('retains ingredient return capacity in a full bag with a delayed pickup (%s)', async version => {
  const r = rig(version);
  const task = r.bot.craft(r.recipe as never, 1).catch((error: Error) => error);
  await vi.runAllTimersAsync(); expect(await task).toBeUndefined();
  expect(r.count('coal')).toBe(12);
  expect(r.count('stick')).toBe(3);
  expect(r.count('torch')).toBe(26);
  expect(r.server.selectedItem).toBeNull();
  expect(r.bot.inventory.selectedItem).toBeNull();
  expect(r.server.items()).toHaveLength(36);
  expect(r.pickupAdded()).toBe(false);
  expect(r.clicks.some(c => c.slot < 0)).toBe(false);
});

it('refills a multi-cell grid from a small source without losing either source or output', async () => {
  const r = rig('1.21.1', 'crafting_table');
  const task = r.bot.craft(r.recipe as never, 1).catch((error: Error) => error);
  await vi.runAllTimersAsync(); expect(await task).toBeUndefined();
  expect(r.count('oak_planks')).toBe(1);
  expect(r.count('crafting_table')).toBe(2);
  expect(r.server.selectedItem).toBeNull();
  expect(r.server.items()).toHaveLength(36);
});

it('returns confirmed ingredients without taking an output that cannot fit', async () => {
  const r = rig('1.21.1', 'torch', true);
  const task = r.bot.craft(r.recipe as never, 1).catch((error: Error) => error);
  await vi.runAllTimersAsync();
  expect(await task).toBeInstanceOf(Error);
  expect((await task as Error).message).toContain('背包容量不足');
  expect(r.count('coal')).toBe(13);
  expect(r.count('stick')).toBe(4);
  expect(r.count('torch')).toBe(0);
  expect(r.server.selectedItem).toBeNull();
  expect(r.server.slots.slice(1, 5).every((item: unknown) => item === null)).toBe(true);
  expect(r.clicks.some(c => c.slot === 0 || c.slot < 0)).toBe(false);
});

it('leaves an existing grid stack in place when a full bag cannot receive it', async () => {
  const r = rig('1.21.1', 'torch', false, true);
  const task = r.bot.craft(r.recipe as never, 1).catch((error: Error) => error);
  await vi.runAllTimersAsync();
  expect(await task).toBeInstanceOf(Error);
  expect((await task as Error).message).toMatch(/合成格.*空间/);
  expect(r.server.slots[1]).toMatchObject({ name: 'coal', count: 1 });
  expect(r.server.selectedItem).toBeNull();
  expect(r.bot.inventory.selectedItem).toBeNull();
  expect(r.clicks).toHaveLength(0);
});
