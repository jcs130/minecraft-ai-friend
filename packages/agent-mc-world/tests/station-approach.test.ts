import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { skillTakeAt } from '../core/skills-container.ts';
import { installInventoryClickSync } from '../core/inventory-click-sync.ts';
import { installInventoryWindowSyncGuard } from '../core/inventory-window-sync.ts';

const mf = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const at: [number, number, number] = [-472, 71, -493];
const feet = new Vec3(-469.4014728125587, 71, -490.39156806691796);

// Native inventory/window protocol and withdraw/close operations. Only the server
// packet source and a reachable chest are simulated; no game or model is started.
function rig(version = '1.21.1') {
  const registry = mf('prismarine-registry')(version), Item = mf('prismarine-item')(registry);
  let stateId = 0, windowId = 0;
  const item = () => new Item(registry.itemsByName.iron_chestplate.id, 1);
  const full = (win: any) => client.emit('window_items', { windowId: win.id, stateId: ++stateId,
    items: win.slots.map((it: any) => Item.toNotch(it)), carriedItem: Item.toNotch(win.selectedItem) });
  const client = Object.assign(new EventEmitter(), { write(name: string, packet: any) {
    if (name !== 'window_click') return;
    queueMicrotask(() => { assert.equal(bot.currentWindow?.id, packet.windowId); full(bot.currentWindow); });
  } });
  const goto = vi.fn(async () => { throw Error('Unnecessary approach: the chest is already within interaction reach'); });
  const bot: any = Object.assign(new EventEmitter(), { registry, version, _client: client,
    QUICK_BAR_START: 36, supportFeature: (name: string) => registry.supportFeature(name),
    entity: { id: 1, position: feet.clone(), height: 1.8 }, game: { dimension: 'overworld' },
    blockAt: (pos: Vec3) => ({ name: 'chest', position: pos, getProperties: () => ({ type: 'single' }) }),
    pathfinder: { goal: null, goto, setGoal() {}, isMoving: () => false },
  });
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  installInventoryWindowSyncGuard(bot); installInventoryClickSync(bot); full(bot.inventory);
  const open = vi.fn(async () => {
    const prior = bot.inventory.slots.slice(bot.inventory.inventoryStart, bot.inventory.inventoryEnd);
    client.emit('open_window', { windowId: ++windowId, inventoryType: 2, windowTitle: '{"text":"Chest"}' });
    const win = bot.currentWindow;
    prior.forEach((it: any, index: number) => win.updateSlot(win.inventoryStart + index, it));
    win.updateSlot(0, item()); full(win); return win;
  });
  bot.openContainer = open;
  const ctx: any = { aborted: () => false };
  return { bot, ctx, goto, open };
}

it.each(['1.21.1', '1.20.6'])('withdraws at the observed reachable distance without requiring a two-block landing (%s)', async version => {
  const r = rig(version);
  expect(feet.distanceTo(new Vec3(...at).offset(0.5, 0.5, 0.5))).toBeLessThan(4);
  const result = await skillTakeAt(r.bot, { skill: 'take', at, item: 'iron_chestplate', count: 1 }, r.ctx);
  expect(r.goto).not.toHaveBeenCalled(); expect(r.open).toHaveBeenCalledTimes(1);
  expect(r.bot.inventory.items().filter((it: any) => it.name === 'iron_chestplate').reduce((n: number, it: any) => n + it.count, 0)).toBe(1);
  expect(r.bot.currentWindow).toBeNull(); expect(result).toContain('取出铁胸甲×1');
});

it('still honours cancellation before opening a reachable container', async () => {
  const r = rig(); r.ctx.aborted = () => true;
  await expect(skillTakeAt(r.bot, { skill: 'take', at, item: 'iron_chestplate', count: 1 }, r.ctx)).rejects.toThrow();
  expect(r.open).not.toHaveBeenCalled(); expect(r.bot.inventory.items()).toEqual([]);
});

it('does not claim an item gain when a reachable native container cannot be opened', async () => {
  const r = rig(); r.open.mockRejectedValueOnce(Error('Server window denied'));
  await expect(skillTakeAt(r.bot, { skill: 'take', at, item: 'iron_chestplate', count: 1 }, r.ctx)).rejects.toThrow('Server window denied');
  expect(r.goto).not.toHaveBeenCalled(); expect(r.bot.inventory.items()).toEqual([]);
});
