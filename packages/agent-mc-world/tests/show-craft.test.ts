import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { afterEach, expect, it, vi } from 'vitest';
import { installMineflayerFixes } from '../core/mineflayer-fixes.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { ShowPacer, withShowPacer } from '../core/show.ts';
import { inventoryClickState, INVENTORY_CLICK_CONFIRM_MS } from '../core/inventory-click-sync.ts';
import { Executor } from '../core/executor.ts';
import { Vec3 } from 'vec3';
import { skillCraft } from '../core/skills-craft.ts';
import { CRAFT_SETTLE_MS } from '../core/inventory.ts';

const mf = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
afterEach(() => vi.useRealTimers());
function craftRig(table = false, inventory = true) {
  vi.useFakeTimers(); vi.setSystemTime(100000);
  const registry = mf('prismarine-registry')('1.21.1');
  const Item = mf('prismarine-item')(registry);
  const clicks: Array<{ slot: number; at: number; stateId: number }> = [];
  let confirm = true;
  const acknowledgements: Array<() => void> = [];
  const client = Object.assign(new EventEmitter(), { write: vi.fn((name: string, packet: any) => {
    if (name !== 'window_click') return;
    clicks.push({ slot: packet.slot, at: Date.now(), stateId: packet.stateId });
    // Fake server owns the full snapshot and crafting result; native inventory
    // plugin owns cursor/slot clicks and the real confirmation barrier consumes packets.
    const acknowledge = () => {
      const w = bot.currentWindow ?? bot.inventory;
      const slots = w.slots.map((item: any) => Item.toNotch(item));
      if (packet.slot === 0) slots[1] = Item.toNotch(null);
      slots[0] = packet.slot !== 0 && w.slots[1] ? raw('oak_planks', 4) : Item.toNotch(null);
      client.emit('window_items', { windowId: w.id, stateId: ++stateId, items: slots, carriedItem: packet.cursorItem });
    };
    if (confirm) queueMicrotask(acknowledge); else acknowledgements.push(acknowledge);
  }) });
  const bot = Object.assign(new EventEmitter(), { registry, version: '1.21.1', _client: client,
    QUICK_BAR_START: 36, supportFeature: (name: string) => registry.supportFeature(name),
    craft: async () => {}, placeBlock: async () => {}, _updateBlockState: () => {},
    entity: { id: 1, position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' },
    clearControlStates() {}, stopDigging() {},
  }) as unknown as Bot;
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  const notes: any[] = [];
  let stateId = 0;
  const raw = (name: string, count = 1) => Item.toNotch(new Item(registry.itemsByName[name].id, count));
  const full = () => {
    const w = bot.currentWindow ?? bot.inventory;
    client.emit('window_items', { windowId: w.id, stateId: ++stateId,
      items: Array.from({ length: w.slots.length }, (_, i) => i === w.inventoryStart ? raw('oak_log', 20) : Item.toNotch(null)),
      carriedItem: Item.toNotch(null) });
  };
  Object.assign(bot, { activateBlock: async () => {
    client.emit('open_window', { windowId: 1, inventoryType: 12, windowTitle: '{"text":"Crafting"}' }); full();
  } });
  installMineflayerFixes(bot, { info() {}, warn() {}, error() {}, debug() {} } as never,
    { write: (note: unknown) => notes.push(note) } as never,
    () => ({ ...MINECRAFT_DEFAULTS.show, inventory }));
  full();
  const recipe = { requiresTable: table, ingredients: [{ id: registry.itemsByName.oak_log.id, count: 1 }],
    result: { id: registry.itemsByName.oak_planks.id, count: 4 } };
  return { bot, client, clicks, recipe, notes, acknowledgements, raw, Item, pauseConfirmation: () => { confirm = false; } };
}

it('paces the real confirmed 2x2 inventory crafting path before its first click', async () => {
  const r = craftRig();
  const operation = r.bot.craft(r.recipe as never, 1);
  await vi.advanceTimersByTimeAsync(0);
  expect(r.clicks).toEqual([]);
  await vi.runAllTimersAsync(); await operation;
  expect(r.clicks[0].at).toBe(100800);
  expect(r.clicks.map(click => click.stateId)).toEqual([-1, -1, -1, -1, -1]);
  expect(r.notes.filter(note => note.event === 'click-barrier').map(note => note.data.previousStateId)).toEqual([1, 2, 3, 4, 5]);
});

it('keeps Java-only inventory-grid crafting zero-wait', async () => {
  const r = craftRig(false, false);
  await r.bot.craft(r.recipe as never, 1);
  expect(r.clicks.every(click => click.at === 100000)).toBe(true);
});

it('paces a confirmed 3x3 window through open, ingredient, result and close', async () => {
  const r = craftRig(true), closed: number[] = [];
  r.bot.on('windowClose', () => closed.push(Date.now()));
  const operation = r.bot.craft(r.recipe as never, 1, {} as never);
  await vi.runAllTimersAsync(); await operation;
  expect(r.clicks.map(click => [click.slot, click.at])).toEqual([
    [10, 100800], [1, 100800], [10, 101200], [0, 102400], [11, 102400],
  ]);
  expect(closed).toEqual([103000]);
  expect(r.bot.inventory.items().find(item => item.name === 'oak_planks')?.count).toBe(4);
});

it.each([['open', 0], ['click', 800], ['result', 1200], ['close', 2400]] as const)
('stops a real craft during %s without late clicks or cleanup', async (_phase, at) => {
  const r = craftRig(), controller = new AbortController();
  const show = new ShowPacer({ ...MINECRAFT_DEFAULTS.show, inventory: true }, {
    bot: r.bot, ctx: { aborted: () => controller.signal.aborted, signal: controller.signal },
  });
  const operation = withShowPacer(r.bot, show, () => r.bot.craft(r.recipe as never, 1));
  const rejected = expect(operation).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(at);
  const sent = r.clicks.length;
  controller.abort(); await rejected;
  await vi.runAllTimersAsync();
  expect(r.clicks).toHaveLength(sent);
  expect(inventoryClickState(r.bot).phase).toBe('ready');
});

it.each(['window', 'respawn', 'end'] as const)('fences real craft %s replacement during ingredient presentation', async replacement => {
  const r = craftRig();
  const operation = r.bot.craft(r.recipe as never, 1), rejected = expect(operation).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(800);
  const sent = r.clicks.length;
  if (replacement === 'window') r.client.emit('open_window', { windowId: 7, inventoryType: 12, windowTitle: 'Replacement' });
  else r.bot.emit(replacement);
  await vi.advanceTimersByTimeAsync(25); await rejected;
  await vi.runAllTimersAsync();
  expect(r.clicks).toHaveLength(sent);
  if (replacement === 'window') expect(r.bot.currentWindow?.id).toBe(7);
});

it('keeps all ten actual craft iterations paced within one bounded budget', async () => {
  const r = craftRig();
  let finishedAt = 0;
  const task = r.bot.craft(r.recipe as never, 10).then(() => { finishedAt = Date.now(); });
  await vi.runAllTimersAsync(); await task;
  const results = r.clicks.filter(click => click.slot === 0);
  expect(results).toHaveLength(10);
  const gaps = results.slice(1).map((click, i) => click.at - results[i].at);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(2);
  expect(gaps.at(-1)).toBeGreaterThan(1000);
  expect(finishedAt - 100000).toBeLessThanOrEqual(12022); // timer rounding, never an instant tail
});

it('retains pending click drain after stop, then keeps an unknown receipt quarantined', async () => {
  const r = craftRig(); r.pauseConfirmation();
  const reports: unknown[] = [];
  let id = 0, drained = false;
  const exec = new Executor({ getBot: () => r.bot, nextId: () => ++id,
    log: { info() {}, warn() {}, error() {}, debug() {} } as never, report: report => reports.push(report) });
  const taskId = exec.enqueueProgram({ name: 'actual crafting owner', cancel() {}, run: async (bot, ctx) => {
    const show = new ShowPacer({ ...MINECRAFT_DEFAULTS.show, inventory: true }, { bot, ctx });
    try { await withShowPacer(bot, show, () => bot.craft(r.recipe as never, 1)); }
    finally { drained = true; }
  } });
  await vi.advanceTimersByTimeAsync(800);
  expect(r.clicks).toHaveLength(1); expect(inventoryClickState(r.bot).phase).toBe('pending');
  const next = exec.submitDetailed([{ skill: 'chat', text: 'after confirmed drain' }], 'afterCheckpoint');
  expect(next.accepted).toBe(true);
  exec.cancelTask(taskId, 'body emergency');
  expect(drained).toBe(false);
  expect(exec.status().waiting).toHaveLength(1);
  expect(exec.status().running).toBeNull();
  await vi.advanceTimersByTimeAsync(INVENTORY_CLICK_CONFIRM_MS);
  expect(drained).toBe(true); expect(inventoryClickState(r.bot).phase).toBe('quarantined');
  expect(r.clicks).toHaveLength(1);
  exec.shutdown();
});

it('fences a delayed native click at dispatch after task revocation', async () => {
  const r = craftRig(), controller = new AbortController();
  r.client.emit('window_items', { windowId: 0, stateId: 50,
    items: Array.from({ length: 46 }, (_, i) => i === 36 ? r.raw('oak_log', 8) : r.Item.toNotch(null)),
    carriedItem: r.Item.toNotch(null) });
  const show = new ShowPacer({ ...MINECRAFT_DEFAULTS.show, inventory: true }, {
    bot: r.bot, ctx: { aborted: () => controller.signal.aborted, signal: controller.signal },
  });
  const operation = withShowPacer(r.bot, show, () => r.bot.craft(r.recipe as never, 1));
  const rejected = expect(operation).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(799); r.bot.lastDigTime = Date.now();
  await vi.advanceTimersByTimeAsync(1);
  expect(inventoryClickState(r.bot).phase).toBe('pending');
  expect(r.clicks).toHaveLength(0);
  controller.abort(); await vi.advanceTimersByTimeAsync(500); await rejected;
  expect(r.clicks).toHaveLength(0);
  expect(inventoryClickState(r.bot).phase).toBe('quarantined');
});

it('shares one budget across the actual skill calling bot.craft once per iteration', async () => {
  const r = craftRig();
  Object.assign(r.bot, { findBlocks: () => [] });
  let finishedAt = 0;
  const task = skillCraft(r.bot, { skill: 'craft', grid: [['oak_log']], count: 10 }, {
    aborted: () => false, showTempo: () => ({ ...MINECRAFT_DEFAULTS.show, inventory: true }),
    diag: { write: (note: unknown) => r.notes.push(note) },
  } as never).then(() => { finishedAt = Date.now(); });
  await vi.runAllTimersAsync(); await task;
  const results = r.clicks.filter(click => click.slot === 0);
  expect(results).toHaveLength(10);
  const gaps = results.slice(1).map((click, i) => click.at - results[i].at);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(2);
  expect(r.notes.filter(note => note.event === 'show-budget-limited')).toHaveLength(1);
  expect(finishedAt - 100000).toBe(12000 + 10 * CRAFT_SETTLE_MS); // presentation plus original receipt settle
});
