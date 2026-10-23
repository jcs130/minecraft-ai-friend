import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { expect, it } from 'vitest';
import { skillStow } from '../core/skills-container.ts';
import { skillOrganize } from '../core/skills-organize.ts';
import { installInventoryClickSync, inventoryClickState } from '../core/inventory-click-sync.ts';
import { installInventoryWindowSyncGuard } from '../core/inventory-window-sync.ts';

const mf = createRequire(createRequire(import.meta.url).resolve('mineflayer'));

// Actual Mineflayer deposit/close, complete native slot/cursor acknowledgements,
// and production stow/organize. Only server packets and nearby chests are fake.
function rig(capacity = 44) {
  const registry = mf('prismarine-registry')('1.21.1'), Item = mf('prismarine-item')(registry);
  const notes: any[] = [], opens: number[] = [], deposits: number[][] = [];
  let stateId = 0, windowId = 0;
  const item = (name: string, count: number) => new Item(registry.itemsByName[name].id, count);
  const full = (win: any) => client.emit('window_items', { windowId: win.id, stateId: ++stateId,
    items: win.slots.map((it: any) => Item.toNotch(it)), carriedItem: Item.toNotch(win.selectedItem) });
  const client = Object.assign(new EventEmitter(), { write(name: string, packet: any) {
    if (name !== 'window_click') return;
    queueMicrotask(() => {
      const win = bot.currentWindow;
      assert.equal(win?.id, packet.windowId);
      full(win);
    });
  } });
  const bot: any = Object.assign(new EventEmitter(), { registry, version: '1.21.1', _client: client,
    QUICK_BAR_START: 36, supportFeature: (name: string) => registry.supportFeature(name),
    entity: { id: 1, position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' },
    blockAt: (at: Vec3) => ({ name: 'chest', position: at, getProperties: () => ({ type: 'single' }) }),
    findBlocks: () => [new Vec3(1, 64, 0), new Vec3(2, 64, 0)],
  });
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  installInventoryWindowSyncGuard(bot); installInventoryClickSync(bot);
  bot.inventory.updateSlot(9, item('wheat_seeds', 64));
  bot.inventory.updateSlot(10, item('wheat_seeds', 64));
  bot.inventory.updateSlot(11, item('wheat_seeds', 2));
  full(bot.inventory);
  const stock = () => bot.inventory.items().filter((it: any) => it.name === 'wheat_seeds')
    .reduce((n: number, it: any) => n + it.count, 0);
  bot.openContainer = async (block: any) => {
    const prior = bot.inventory.slots.slice(bot.inventory.inventoryStart, bot.inventory.inventoryEnd);
    client.emit('open_window', { windowId: ++windowId, inventoryType: 2, windowTitle: '{"text":"Chest"}' });
    const win = bot.currentWindow;
    prior.forEach((it: any, i: number) => win.updateSlot(win.inventoryStart + i, it));
    if (block.position.x === 1) {
      for (let i = 0; i < win.inventoryStart; i++) win.updateSlot(i, item('cobblestone', 64));
      win.updateSlot(0, item('wheat_seeds', 64 - capacity));
    }
    full(win); opens.push(block.position.x);
    const deposit = win.deposit.bind(win), close = win.close.bind(win);
    win.deposit = async (...args: any[]) => { deposits.push([block.position.x, args[2]]); return deposit(...args); };
    win.close = () => {
      // A full destination can leave a cursor remainder. The fake server returns
      // it on close and acknowledges all slots; the fixture never loses items.
      const held = win.selectedItem;
      if (held) {
        let left = held.count;
        for (let slot = win.inventoryStart; slot < win.inventoryEnd && left; slot++) {
          const stack = win.slots[slot];
          if (stack && (stack.type !== held.type || stack.count >= stack.stackSize)) continue;
          const n = Math.min(left, stack ? stack.stackSize - stack.count : held.stackSize);
          win.updateSlot(slot, item(held.name, (stack?.count ?? 0) + n)); left -= n;
        }
        assert.equal(left, 0); win.selectedItem = null; full(win);
      }
      close();
    };
    return win;
  };
  const controller = new AbortController();
  const ctx: any = { taskId: 'partial-stow', aborted: () => false, signal: controller.signal,
    diag: { write: (note: any) => notes.push(note) } };
  return { bot, ctx, stock, notes, opens, deposits };
}

it.each(['stow', 'organize'] as const)('preserves the explicit reserve through %s after a partially committed full destination', async mode => {
  const r = rig();
  const text = mode === 'organize'
    ? await skillOrganize(r.bot, { skill: 'organize', rules: [{ item: 'wheat_seeds', keep: 32, action: 'stow' }] }, r.ctx)
    : await skillStow(r.bot, { skill: 'stow', item: 'wheat_seeds', count: 98 }, r.ctx);
  expect(r.stock()).toBe(32);
  expect(r.opens).toEqual([1, 2]);
  expect(r.deposits[0]).toEqual([1, 64]);
  expect(r.deposits.filter(([chest]) => chest === 2).reduce((sum, [, count]) => sum + count, 0)).toBe(54);
  expect(r.notes.filter(n => n.event === 'stow-done').map(n => n.data))
    .toMatchObject([{ deposited: 44, confirmed: 44, chestDelta: 44, status: 'confirmed' },
      { deposited: 54, confirmed: 54, chestDelta: 54, status: 'confirmed' }]);
  expect(text).toContain('共存进小麦种子×98');
  expect(r.bot.inventory.selectedItem).toBeNull();
  expect(inventoryClickState(r.bot).phase).toBe('ready');
});

it('retains a partial receipt with a single explicitly selected full chest', async () => {
  const r = rig();
  const text = await skillStow(r.bot, { skill: 'stow', item: 'wheat_seeds', count: 98, at: [1, 64, 0] }, r.ctx);
  expect(r.stock()).toBe(86);
  expect(r.opens).toEqual([1]);
  expect(text).toContain('小麦种子×44');
  expect(text).toContain('剩下的没存进去');
  expect(r.notes.find(n => n.event === 'stow-done').data).toMatchObject({ deposited: 44, confirmed: 44 });
});

it('can continue past a completely full chest without inventing a partial transfer', async () => {
  const r = rig(0);
  await skillStow(r.bot, { skill: 'stow', item: 'wheat_seeds', count: 98 }, r.ctx);
  expect(r.stock()).toBe(32);
  expect(r.notes.find(n => n.event === 'stow-none').data).toMatchObject({ deposited: 0, confirmed: 0, chestDelta: 0 });
});
