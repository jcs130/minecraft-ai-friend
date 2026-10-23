import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planInventoryOrganization, inventoryOrganizationKey, inventoryOrganizationTotals } from '../core/inventory-organization.ts';
import { skillOrganize } from '../core/skills-organize.ts';
import { parseScoutSteps, parseSteps, SKILL_STEP_SCHEMA } from '../core/skills.ts';
import { installInventoryClickSync, inventoryClickState } from '../core/inventory-click-sync.ts';
import { installInventoryWindowSyncGuard } from '../core/inventory-window-sync.ts';
import { ContainerWindowOwnership } from '../core/container-window-ownership.ts';
import { discardInventorySlotConfirmed, transferInventoryStackConfirmed } from '../core/inventory-transfer.ts';

const mf = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
afterEach(() => vi.useRealTimers());

function rig(version = '1.21.1') {
  vi.useFakeTimers(); vi.setSystemTime(100000);
  const registry = mf('prismarine-registry')(version), Item = mf('prismarine-item')(registry);
  const controller = new AbortController(), clicks: any[] = [], closes: number[] = [], notes: any[] = [];
  let stateId = 0, afterAck: (() => void) | undefined, acknowledge = true, rejectedSlot: number | undefined;
  let authoritative: { items: unknown[]; carriedItem: unknown };
  const client = Object.assign(new EventEmitter(), { write(name: string, packet: any) {
    if (name === 'close_window') closes.push(packet.windowId);
    if (name !== 'window_click') return;
    clicks.push(packet);
    queueMicrotask(() => {
      if (!acknowledge) return;
      if (packet.slot === rejectedSlot) {
        client.emit('window_items', { windowId: (bot.currentWindow ?? bot.inventory).id,
          stateId: ++stateId, ...structuredClone(authoritative) });
        return;
      }
      full(bot.currentWindow ?? bot.inventory, packet.cursorItem);
      afterAck?.();
    });
  } });
  const bot: any = Object.assign(new EventEmitter(), { registry, version, _client: client,
    QUICK_BAR_START: 36, supportFeature: (name: string) => registry.supportFeature(name),
    entity: { id: 1, position: new Vec3(0, 64, 0), yaw: 0, pitch: 0 }, game: { dimension: 'overworld' },
    blockAt: () => ({ name: 'chest', getProperties: () => ({}) }),
  });
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  installInventoryWindowSyncGuard(bot); installInventoryClickSync(bot);
  const full = (win: any, cursor: any = Item.toNotch(win.selectedItem)) => {
    authoritative = structuredClone({ items: win.slots.map((it: any) => Item.toNotch(it)), carriedItem: cursor });
    client.emit('window_items', { windowId: win.id, stateId: ++stateId, ...structuredClone(authoritative) });
  };
  const item = (name: string, count = 1) => new Item(registry.itemsByName[name].id, count);
  const named = (name: string, title: string, count = 1) => Item.fromNotch({ itemCount: count,
    itemId: registry.itemsByName[name].id, addedComponentCount: 1, removedComponentCount: 0, removeComponents: [],
    components: [{ type: 'custom_name', data: { type: 'compound', value: { text: { type: 'string', value: title } } } }] });
  const put = (slot: number, name: string, count = 1, win = bot.currentWindow ?? bot.inventory) => win.updateSlot(slot, item(name, count));
  const open = (inventoryType = 2, title = 'Storage') => {
    const from = bot.currentWindow ?? bot.inventory;
    const player = from.slots.slice(from.inventoryStart, from.inventoryEnd);
    client.emit('open_window', { windowId: 1, inventoryType, windowTitle: title });
    const win = bot.currentWindow;
    player.forEach((it: any, i: number) => win.updateSlot(win.inventoryStart + i, it));
    full(win); return win;
  };
  full(bot.inventory);
  bot.openContainer = async () => {
    const win = open(); win.close = () => bot.closeWindow(win); return win;
  };
  const ctx: any = { taskId: 'organize-test', aborted: () => controller.signal.aborted,
    abortedBy: () => 'organize-test-stop', signal: controller.signal, diag: { write: (entry: any) => notes.push(entry) } };
  return { bot, ctx, item, named, put, full, open, clicks, closes, notes, controller,
    onAck: (callback: () => void) => { afterAck = callback; },
    acknowledge: (enabled: boolean) => { acknowledge = enabled; },
    rejectSlot: (slot: number) => { rejectedSlot = slot; },
    start: (args: any = {}) => skillOrganize(bot, { skill: 'organize', ...args }, ctx),
  };
}

async function complete(operation: Promise<unknown>) { await vi.runAllTimersAsync(); return operation; }

describe('portable organization planner', () => {
  it('does not merge distinct modern components or mutate source data', () => {
    const base = { type: 1, name: 'stone', count: 20, stackSize: 64 };
    const slots = [{ ...base, components: [{ type: 'custom_name', data: 'A' }] },
      { ...base, components: [{ type: 'custom_name', data: 'B' }] }, { ...base, components: [{ data: 'A', type: 'custom_name' }] }, null];
    const original = JSON.stringify(slots), plan = planInventoryOrganization(slots, 0, 4, false);
    expect(plan).toMatchObject({ beforeFree: 1, expectedFree: 2, merges: 1, swaps: 0 });
    expect(plan.moves[0]).toMatchObject({ from: 2, to: 0 });
    expect(JSON.stringify(slots)).toBe(original);
  });
  it('honors a 16-item limit and never invents a default limit for unknown items', () => {
    const stack = { type: 1, name: 'unknown', count: 10 };
    expect(planInventoryOrganization([stack, { ...stack }], 0, 2, false).merges).toBe(0);
    expect(planInventoryOrganization([{ ...stack, stackSize: 16 }, { ...stack, stackSize: 16 }], 0, 2, false))
      .toMatchObject({ merges: 1, expectedFree: 0 });
  });
  it('includes legacy NBT, removals and component-map values in variant identity', () => {
    const stack = { type: 1, name: 'item', count: 1, stackSize: 64 };
    const variants = [stack, { ...stack, nbt: { value: 1n } }, { ...stack, removedComponents: ['custom_name'] },
      { ...stack, componentMap: new Map([['custom_name', 'keepsake']]) }];
    expect(new Set(variants.map(inventoryOrganizationKey)).size).toBe(4);
    expect(planInventoryOrganization(variants, 0, 4).merges).toBe(0);
  });
});

describe('native organization with server-confirmed slots and cursor', () => {
  it.each(['1.21.1', '1.20.6'])('does not reorder unrelated slots after a toss-only rule on %s', async version => {
    const r = rig(version), bag = r.bot.inventory;
    r.put(9, 'player_head'); r.put(15, 'rotten_flesh', 11); r.put(18, 'bread', 14); r.full(bag);
    r.rejectSlot(9);
    const head = inventoryOrganizationKey(bag.slots[9]);
    const operation = r.start({ rules: [{ item: 'rotten_flesh', keep: 0, action: 'toss' }] })
      .then(value => ({ value, error: null }), error => ({ value: null, error }));
    setTimeout(() => r.bot.emit('physicsTick'), 20);
    const result = await complete(operation) as Awaited<typeof operation>;
    expect(result.error).toBeNull();
    expect(result.value).toContain('抛出腐肉×11');
    expect(r.clicks.map(c => [c.slot, c.mode])).toEqual([[15, 4]]);
    expect(inventoryOrganizationKey(bag.slots[9])).toBe(head);
    expect(bag.slots[18].name).toBe('bread'); expect(bag.slots[18].count).toBe(14);
    expect(bag.slots[15]).toBeNull(); expect(bag.selectedItem).toBeNull();
    expect(inventoryClickState(r.bot).phase).toBe('ready');
  });
  it('does not merge unrelated stacks when all disposition rules are already satisfied', async () => {
    const r = rig(); r.put(9, 'stone', 12); r.put(10, 'stone', 12); r.full(r.bot.inventory);
    await complete(r.start({ rules: [{ item: 'rotten_flesh', keep: 0, action: 'toss' }] }));
    expect(r.clicks).toEqual([]);
    expect(r.bot.inventory.slots[9].count).toBe(12); expect(r.bot.inventory.slots[10].count).toBe(12);
  });
  it('previews only explicit disposition unless arrangement was explicitly requested', async () => {
    const r = rig(); r.put(9, 'stone', 12); r.put(10, 'dirt', 8); r.put(11, 'stone', 12); r.full(r.bot.inventory);
    const rules = [{ item: 'rotten_flesh', keep: 0, action: 'toss' }];
    const implicit = JSON.parse(await complete(r.start({ rules, dryRun: true })) as string);
    expect(implicit.plan.moves).toEqual([]); expect(implicit.plan.expectedFree).toBe(implicit.plan.beforeFree);
    const merge = JSON.parse(await complete(r.start({ rules, sort: false, dryRun: true })) as string);
    expect(merge.plan.merges).toBe(1); expect(merge.plan.swaps).toBe(0);
    const sort = JSON.parse(await complete(r.start({ rules, sort: true, dryRun: true })) as string);
    expect(sort.plan.merges).toBe(1); expect(sort.plan.swaps).toBeGreaterThan(0);
    expect(r.clicks).toEqual([]);
  });
  it('stows the selected surplus without then moving an unrelated server shortcut or food', async () => {
    const r = rig(), bag = r.bot.inventory;
    r.put(9, 'player_head'); r.put(10, 'cobblestone', 11); r.put(18, 'bread', 14); r.full(bag);
    r.rejectSlot(9);
    await complete(r.start({ rules: [{ item: 'cobblestone', keep: 0, action: 'stow' }], at: [1, 64, 0] }));
    expect(bag.slots[9].name).toBe('player_head'); expect(bag.slots[18].name).toBe('bread');
    expect(bag.slots[18].count).toBe(14); expect(bag.selectedItem).toBeNull();
    expect(inventoryClickState(r.bot).phase).toBe('ready'); expect(r.closes).toEqual([1]);
    expect(r.clicks.every(c => c.windowId === 1)).toBe(true);
  });
  it.each([false, true])('still executes explicitly selected sort:%s after rules', async sort => {
    const r = rig(), bag = r.bot.inventory;
    r.put(9, 'stone', 12); r.put(10, 'dirt', 8); r.put(11, 'stone', 12); r.full(bag);
    const totals = inventoryOrganizationTotals(bag.slots);
    await complete(r.start({ sort, rules: [{ item: 'rotten_flesh', keep: 0, action: 'toss' }] }));
    expect(r.notes.at(-1).data.merges).toBe(1);
    expect(r.notes.at(-1).data.swaps).toBe(sort ? 1 : 0);
    expect(bag.slots[9].name).toBe(sort ? 'dirt' : 'stone');
    expect(inventoryOrganizationTotals(bag.slots)).toBe(totals); expect(bag.selectedItem).toBeNull();
  });
  it.each(['1.21.1', '1.20.6'])('merges and sorts the main bag on %s without changing quickbar, equipment or totals', async version => {
    const r = rig(version);
    r.put(9, 'dirt', 12); r.put(10, 'stone', 55); r.put(11, 'stone', 15);
    r.put(5, 'iron_helmet'); r.put(36, 'diamond_sword'); r.put(45, 'shield'); r.full(r.bot.inventory);
    const before = inventoryOrganizationTotals(r.bot.inventory.slots), text = await complete(r.start());
    expect(text).toContain('整理完成'); expect(text).toContain('快捷栏保持原位');
    expect(r.bot.inventory.slots.slice(9, 12).map((it: any) => [it.name, it.count]))
      .toEqual([['dirt', 12], ['stone', 64], ['stone', 6]]);
    expect(inventoryOrganizationTotals(r.bot.inventory.slots)).toBe(before);
    expect([r.bot.inventory.slots[5].name, r.bot.inventory.slots[36].name, r.bot.inventory.slots[45].name])
      .toEqual(['iron_helmet', 'diamond_sword', 'shield']);
    expect(r.bot.inventory.selectedItem).toBeNull();
    expect(r.clicks.every(c => c.stateId === -1 && c.windowId === 0)).toBe(true);
    const clicks = r.clicks.length;
    await complete(r.start()); expect(r.clicks).toHaveLength(clicks); // Already organized, no churn.
  });
  it('exchanges occupied slots in a completely full bag, with no spare slot or item loss', async () => {
    const r = rig();
    for (let i = 9; i < 36; i++) r.put(i, i === 9 ? 'stone' : 'dirt', 64);
    r.full(r.bot.inventory);
    const totals = inventoryOrganizationTotals(r.bot.inventory.slots);
    await complete(r.start());
    expect(r.bot.inventory.slots[9].name).toBe('dirt'); expect(r.bot.inventory.slots[35].name).toBe('stone');
    expect(r.bot.inventory.selectedItem).toBeNull();
    expect(inventoryOrganizationTotals(r.bot.inventory.slots)).toBe(totals);
    expect(r.notes.at(-1).data).toMatchObject({ beforeFree: 0, afterFree: 0 });
  });
  it('swaps same-ID custom variants instead of trusting the native legacy merge prediction', async () => {
    const r = rig(), bag = r.bot.inventory;
    bag.updateSlot(9, r.named('paper', 'B', 3)); bag.updateSlot(10, r.named('paper', 'A', 5)); r.full(bag);
    const totals = inventoryOrganizationTotals(bag.slots);
    await complete(r.start());
    expect(inventoryOrganizationTotals(bag.slots)).toBe(totals);
    expect(bag.slots[9].components[0].data.value.text.value).toBe('A');
    expect(bag.slots[10].count).toBe(3); expect(bag.selectedItem).toBeNull();
    expect(r.clicks.map(c => c.slot)).toEqual([10, 9, 10]);
  });
  it('uses the currently open container player slots, leaving its storage contents unchanged', async () => {
    const r = rig(); r.put(9, 'dirt', 9); r.put(10, 'dirt', 9); r.put(36, 'diamond_sword');
    const win = r.open(); r.put(0, 'iron_ingot', 42); r.full(win);
    await complete(r.start());
    expect(r.bot.inventory.slots[9].count).toBe(18);
    expect(win.slots[0].count).toBe(42); expect(r.closes).toEqual([1]);
    expect(r.bot.inventory.slots[36].name).toBe('diamond_sword');
  });
  it('sorts open storage, including custom-named storage, without treating the player bag as storage', async () => {
    const r = rig(); r.put(9, 'diamond', 5);
    const win = r.open(2, '带名字的仓库'); r.put(0, 'stone', 3); r.put(1, 'dirt', 6); r.put(2, 'dirt', 6); r.full(win);
    await complete(r.start({ target: 'open' }));
    expect(win.slots.slice(0, 2).map((it: any) => [it.name, it.count])).toEqual([['dirt', 12], ['stone', 3]]);
    expect(r.bot.inventory.slots[9].count).toBe(5);
  });
  it('previews without clicks and includes the quickbar only when explicitly requested', async () => {
    const r = rig(); r.put(9, 'dirt', 9); r.put(36, 'dirt', 9); r.full(r.bot.inventory);
    const preview = JSON.parse(await complete(r.start({ dryRun: true, includeHotbar: true })) as string);
    expect(preview.plan.merges).toBe(1); expect(r.clicks).toHaveLength(0);
    await complete(r.start({ includeHotbar: true, sort: false }));
    expect(r.bot.inventory.slots[9].count).toBe(18); expect(r.bot.inventory.slots[36]).toBeNull();
  });
  it.each([[2, 'Skill menu'], [13, 'Furnace']])('rejects button menus and workstation slots before clicks', async (type, title) => {
    const r = rig(); r.open(type as number, title as string);
    await expect(r.start({ target: 'open' })).rejects.toThrow(/菜单|输入\/输出/);
    expect(r.clicks).toHaveLength(0);
  });
  it('returns its confirmed cursor on cancellation after pickup, then performs no further actions', async () => {
    const r = rig(); r.put(9, 'dirt', 9); r.put(10, 'dirt', 9); r.full(r.bot.inventory);
    r.onAck(() => { if (r.clicks.length === 1) r.controller.abort(); });
    const operation = r.start(), rejected = expect(operation).rejects.toMatchObject({ by: 'organize-test-stop' });
    await vi.runAllTimersAsync(); await rejected;
    expect(r.clicks.map(c => c.slot)).toEqual([10, 10]);
    expect(r.bot.inventory.selectedItem).toBeNull(); expect(r.bot.inventory.slots[10].count).toBe(9);
  });
  it('stops without cleanup clicks when a window is replaced with another of the same numeric id', async () => {
    const r = rig(), win = r.open(); r.put(0, 'dirt', 9); r.put(1, 'dirt', 9); r.full(win);
    r.onAck(() => { if (r.clicks.length === 1) r.open(); });
    const rejected = expect(r.start({ target: 'open' })).rejects.toThrow(/替换|窗口/);
    await vi.runAllTimersAsync(); await rejected;
    expect(r.bot.currentWindow.id).toBe(1); expect(r.bot.currentWindow).not.toBe(win);
    expect(r.clicks).toHaveLength(1); expect(r.closes).toEqual([]);
  });
  it('does not replay, close or compensate an unacknowledged pickup', async () => {
    const r = rig(), win = r.open(); r.put(0, 'dirt', 9); r.put(1, 'dirt', 9); r.full(win); r.acknowledge(false);
    const ownership = new ContainerWindowOwnership(r.bot, { valid: () => true, scope: () => 'test', onEvent: () => {} });
    ownership.retain(win, 'test');
    const rejected = expect(r.start({ target: 'open' })).rejects.toMatchObject({ code: 'inventory-click-sync' });
    await vi.runAllTimersAsync(); await rejected;
    expect(r.clicks).toHaveLength(1); expect(r.closes).toEqual([]);
    expect(inventoryClickState(r.bot).phase).toBe('quarantined');
    expect(win.selectedItem.count).toBe(9);
    ownership.close(); expect(r.closes).toEqual([]); // Executor task cleanup must preserve the unresolved cursor too.
  });
  it('retains the requested quantity when stowing surplus in a named chest', async () => {
    const r = rig(); r.put(9, 'cobblestone', 64); r.put(10, 'cobblestone', 11); r.put(11, 'dirt', 8); r.full(r.bot.inventory);
    const result = await complete(r.start({ rules: [{ item: 'cobblestone', keep: 64, action: 'stow' }], at: [1, 64, 0] }));
    expect(result).toContain('整理完成');
    expect(r.bot.inventory.items().filter((it: any) => it.name === 'cobblestone').reduce((n: number, it: any) => n + it.count, 0)).toBe(64);
    expect(r.bot.inventory.items().find((it: any) => it.name === 'dirt').count).toBe(8);
  });
  it('stows only the selected custom variant and keeps an exact partial quantity', async () => {
    const r = rig(), bag = r.bot.inventory;
    bag.updateSlot(9, r.named('paper', 'Keep', 10)); bag.updateSlot(10, r.named('paper', 'Other', 8)); r.full(bag);
    const text = await complete(r.start({ rules: [{ item: 'paper', pick: 'Keep', keep: 7, action: 'stow' }], at: [1, 64, 0] }));
    expect(text).toContain('整理完成');
    const variants = r.bot.inventory.items().map((it: any) => [it.components[0].data.value.text.value, it.count]);
    expect(variants).toEqual([['Keep', 7], ['Other', 8]]);
    expect(r.bot.inventory.selectedItem).toBeNull();
  });
  it('keeps the window and cursor when a surplus stow is not acknowledged', async () => {
    const r = rig(), bag = r.bot.inventory;
    bag.updateSlot(9, r.named('paper', 'Keep', 10)); r.full(bag); r.acknowledge(false);
    const rejected = expect(r.start({ rules: [{ item: 'paper', pick: 'Keep', keep: 7, action: 'stow' }], at: [1, 64, 0] }))
      .rejects.toMatchObject({ code: 'inventory-click-sync' });
    await vi.runAllTimersAsync(); await rejected;
    expect(r.clicks).toHaveLength(1); expect(r.closes).toEqual([]);
    expect(r.bot.currentWindow.selectedItem.count).toBe(10);
  });
  it('evaluates overlapping keep rules in order against fresh open-window stock', async () => {
    const r = rig(); r.put(9, 'cobblestone', 30); r.full(r.bot.inventory); const win = r.open();
    await complete(r.start({ into: 'open', rules: [{ item: 'cobblestone', keep: 20, action: 'stow' },
      { item: 'cobblestone', keep: 15, action: 'stow' }] }));
    expect(win.slots.slice(0, win.inventoryStart).filter(Boolean).reduce((n: number, it: any) => n + it.count, 0)).toBe(15);
    expect(r.bot.inventory.items().reduce((n: number, it: any) => n + it.count, 0)).toBe(15);
    expect(r.closes).toEqual([1]);
  });
  it('drops an exact partial source slot while preserving same-ID unselected variants', async () => {
    const r = rig(), bag = r.bot.inventory;
    bag.updateSlot(9, r.named('paper', 'Other', 8)); bag.updateSlot(10, r.named('paper', 'Discard', 10)); r.full(bag);
    await complete(discardInventorySlotConfirmed(r.bot, 10, 3, r.ctx));
    expect(bag.slots[9].count).toBe(8); expect(bag.slots[10].count).toBe(7);
    expect(bag.slots[10].components[0].data.value.text.value).toBe('Discard');
    expect(r.clicks.every(c => c.slot === 10 && c.mode === 4)).toBe(true);
  });
  it('preserves the exact selected components when a partial transfer creates a new stack', async () => {
    const r = rig(), bag = r.bot.inventory;
    bag.updateSlot(9, r.named('paper', 'Memory', 10)); r.full(bag);
    await complete(transferInventoryStackConfirmed(r.bot, bag, 9, 10, 11, 3, r.ctx));
    expect(bag.slots[9].count).toBe(7); expect(bag.slots[10].count).toBe(3);
    expect(inventoryOrganizationKey(bag.slots[9])).toBe(inventoryOrganizationKey(bag.slots[10]));
    expect(bag.selectedItem).toBeNull();
  });
  it('reports only the confirmed partial transfer when the remaining destination slots are full', async () => {
    const r=rig(),bag=r.bot.inventory;
    r.put(9,'paper',10);r.put(10,'paper',63);r.put(11,'dirt',64);r.full(bag);
    const result=transferInventoryStackConfirmed(r.bot,bag,9,10,12,3,r.ctx).catch(e=>e);
    await vi.runAllTimersAsync(); const error=await result;
    expect(error.code).toBe('container-full');
    expect(error.decision).toMatchObject({status:'partial',completed:1,remaining:2,unit:'items'});
    expect(bag.slots[9].count).toBe(9);expect(bag.slots[10].count).toBe(64);
    expect(bag.slots[11].name).toBe('dirt');expect(bag.selectedItem).toBeNull();
  });
});

describe('shared action/scout contract', () => {
  it('exposes the action and preserves false flags; scout is read-only', () => {
    expect(parseSteps([{ skill: 'organize', sort: false, includeHotbar: false }])).toMatchObject({ steps: [{ skill: 'organize', sort: false, includeHotbar: false }] });
    expect(parseScoutSteps([{ skill: 'organize' }])).toMatchObject({ steps: [{ skill: 'organize', dryRun: true }] });
    expect(JSON.stringify(SKILL_STEP_SCHEMA)).toContain('organize');
  });
  it.each([
    { rules: [{ item: 'stone', keep: -1, action: 'toss' }] },
    { rules: [{ item: 'stone', keep: 0, action: 'delete' }] },
    { rules: [{ item: 'stone', keep: 0, action: 'toss', keepAtLeast: 64 }] },
    { rules: [{ item: 'stone', keep: 0, action: 'stow' }], at: [1, 2, 3], into: 'open' },
    { target: 'open', rules: [{ item: 'stone', keep: 0, action: 'toss' }] },
    { sort: 'false' },
  ])('rejects invalid or ambiguous disposition policies atomically: %j', args => {
    expect(parseSteps([{ skill: 'chat', text: 'before' }, { skill: 'organize', ...args }])).toHaveProperty('error');
  });
});
