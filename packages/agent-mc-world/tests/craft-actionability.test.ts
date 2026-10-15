import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Executor } from '../core/executor.ts';
import { skillCraft } from '../core/skills-craft.ts';
import { narrateWorldSegments, snapshotFromBot } from '../core/terrain.ts';
import { precheckStep, precheckSteps, renderPrecheckNotes } from '../core/precheck.ts';

const dependency = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = dependency('prismarine-registry')('1.21.1');
const Item = dependency('prismarine-item')(registry);
const Recipe = dependency('prismarine-recipe')(registry).Recipe;
afterEach(() => vi.useRealTimers());

function rig() {
  vi.useFakeTimers();
  const slots = Array(46).fill(null);
  slots[9] = new Item(registry.itemsByName.mutton.id, 4);
  slots[10] = new Item(registry.itemsByName.melon_slice.id, 37);
  const write = vi.fn(), equip = vi.fn(), craft = vi.fn();
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '1.21.1', _client: Object.assign(new EventEmitter(), { write }),
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    game: { dimension: 'overworld', gameMode: 'survival' }, entities: {}, players: {},
    health: 18, food: 17, time: { timeOfDay: 1000 },
    inventory: { slots, selectedItem: null, items: () => slots.slice(9, 45).filter(Boolean) },
    heldItem: null, currentWindow: null, blockAt: () => null, findBlocks: () => [],
    recipesAll: vi.fn((_id: number) => [] as unknown[]), equip, craft,
  });
  let id = 0;
  const exec = new Executor({ getBot: () => bot as never, nextId: () => ++id,
    report: vi.fn(), busyWith: () => 'existing action',
    log: { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} } as never });
  return { bot, slots, exec, write, equip, craft };
}

describe('verified inventory identities and craft correction', () => {
  it('labels task76 previews as current-stock examples and admits its feasible upstream production', () => {
    const r = rig();
    r.slots.fill(null);
    r.slots[9] = new Item(registry.itemsByName.oak_log.id, 4);
    r.slots[10] = new Item(registry.itemsByName.stick.id, 4);
    r.bot.recipesAll.mockImplementation((id: number) => Recipe.find(id, null));
    const steps = [
      { skill: 'craft', item: 'oak_planks', count: 16 },
      { skill: 'craft', item: 'crafting_table', count: 1, needs: [1] },
      { skill: 'craft', item: 'wooden_axe', count: 1, needs: [2] },
      { skill: 'craft', item: 'torch', count: 8, needs: [2] },
    ] as const;
    const result = r.exec.submitDetailed([...steps] as never, 'append');
    expect(result.accepted).toBe(true);
    expect(result.receipt).toContain('试算(还没动工)');
    expect(result.receipt).toContain('仅按受理时当前已确认库存');
    expect(result.receipt).toContain('未计入前面尚未执行步骤的产出或消耗');
    expect(result.receipt).toContain('配方示例，不是仅允许这些材料');
    expect(result.receipt).toContain('还有 8 条配方缺口一样多');
    expect(r.exec.status().waiting).toHaveLength(1);
    expect(r.craft).not.toHaveBeenCalled();
    const deps = { resolve: () => null, blockAt: () => null, cellsOf: () => null };
    expect(precheckStep(r.bot as never, steps[0], deps)).toBeNull();
    // Explicit new observed stock, not a preflight-generated inventory simulation.
    r.slots[9] = new Item(registry.itemsByName.oak_planks.id, 16);
    expect(precheckStep(r.bot as never, steps[1], deps)).toBeNull();
    r.slots[9].count = 12;
    r.slots[11] = new Item(registry.itemsByName.crafting_table.id, 1);
    expect(precheckStep(r.bot as never, steps[2], deps)).toBeNull();
    expect(precheckStep(r.bot as never, steps[3], deps)?.rule).toBe('craft.short');
    // Actual stock loss is respected, even when the submitted prefix names planks.
    r.slots[9] = null;
    const current = renderPrecheckNotes(precheckSteps(r.bot as never, [...steps] as never, deps));
    expect(current).toContain('第 2 步做工作台还差');
    expect(current).toContain('未计入前面尚未执行步骤');
  });
  it('advises about carried cooked food without replacing an explicit raw-food request', () => {
    const r = rig();
    r.slots[11] = new Item(registry.itemsByName.cooked_mutton.id, 2);
    const result = r.exec.submitDetailed([{ skill: 'eat', item: 'mutton' }], 'append');
    expect(result.accepted).toBe(true);
    expect(result.receipt).toMatch(/已有.*熟羊肉.*仍按点名/s);
    expect(r.exec.status().waiting.at(-1)?.label).toContain('生羊肉');
    expect(r.equip).not.toHaveBeenCalled();
    expect(r.write).not.toHaveBeenCalled();
  });
  it('keeps actual native IDs available alongside Chinese inventory quantities', () => {
    const r = rig();
    const before = snapshotFromBot(r.bot, { scanBlocks: false });
    const parts = narrateWorldSegments(before);
    const identities = parts.find(part => part.key === 'inventoryIds');
    expect(identities?.text).toContain('生羊肉=mutton');
    expect(identities?.text).toContain('西瓜片=melon_slice');
    expect(identities?.text).not.toContain('raw_mutton');
    expect(parts.find(part => part.key === 'gear')?.text).toContain('生羊肉×4');
    r.slots[11] = new Item(registry.itemsByName.mutton.id, 2);
    expect(narrateWorldSegments(snapshotFromBot(r.bot, { scanBlocks: false }))
      .find(part => part.key === 'inventoryIds')?.cmp).toBe(identities?.cmp);
    const unsynced = narrateWorldSegments({ ...before, invSynced: false, inventorySync: { phase: 'quarantined' } });
    expect(unsynced.find(part => part.key === 'inventoryIds')?.text).not.toContain('mutton');
  });

  it('rejects unknown grid IDs as identity errors without declaring known food absent or replacing queued work', () => {
    const r = rig();
    const prior = r.exec.submitDetailed([{ skill: 'chat', text: 'kept offline' }], 'append');
    expect(prior.accepted).toBe(true);
    const queued = r.exec.status().waiting.map(task => task.id);
    const rejected = r.exec.submitDetailed([{ skill: 'craft', grid: [['raw_mutton']], count: 1 }], 'replace');
    expect(rejected.accepted).toBe(false);
    expect(rejected.receipt).toContain('未知物品 ID');
    expect(rejected.receipt).toContain('raw_mutton');
    expect(rejected.receipt).toContain('生羊肉=mutton');
    expect(rejected.receipt).not.toContain('包里 0');
    expect(r.exec.status().waiting.map(task => task.id)).toEqual(queued);
    expect(r.write).not.toHaveBeenCalled();
    expect(r.craft).not.toHaveBeenCalled();
  });

  it('does not send an impossible cooked-food recipe to a crafting grid', async () => {
    const r = rig();
    const result = skillCraft(r.bot as never, { skill: 'craft', item: 'cooked_mutton', count: 1 },
      { aborted: () => false } as never);
    await expect(result).rejects.toThrow(/合成配方表.*smelt/s);
    expect(r.write).not.toHaveBeenCalled();
    expect(r.equip).not.toHaveBeenCalled();
    expect(r.craft).not.toHaveBeenCalled();
    expect(r.slots[9].count).toBe(4);
  });

  it('rejects a later nonexistent recipe before earlier valid crafting consumes materials', () => {
    const r = rig();
    r.slots[11] = new Item(registry.itemsByName.oak_planks.id, 8);
    const stick = registry.itemsByName.stick.id;
    r.bot.recipesAll.mockImplementation((id: number) => id === stick
      ? [{ result: { id: stick, count: 4 }, delta: [{ id: registry.itemsByName.oak_planks.id, count: -2 }], requiresTable: false }]
      : []);
    r.exec.submitDetailed([{ skill: 'chat', text: 'existing offline work' }], 'append');
    const before = r.exec.status();
    const rejected = r.exec.submitDetailed([
      { skill: 'craft', item: 'stick', count: 4 },
      { skill: 'craft', item: 'charcoal', count: 1 },
      { skill: 'craft', item: 'torch', count: 4, needs: [2] },
    ], 'now');
    expect(rejected.accepted).toBe(false);
    expect(rejected.receipt).toMatch(/第 2 步.*合成配方表.*smelt/s);
    expect(r.exec.status().waiting.map(task => task.id)).toEqual(before.waiting.map(task => task.id));
    expect(r.exec.status().running?.id).toBe(before.running?.id);
    expect(r.craft).not.toHaveBeenCalled();
    expect(r.write).not.toHaveBeenCalled();
    expect(r.slots[11].count).toBe(8);
  });

  it('keeps later material prerequisites at execution time instead of rejecting a valid recipe', () => {
    const r = rig(), stick = registry.itemsByName.stick.id;
    r.bot.recipesAll.mockImplementation((id: number) => id === stick
      ? [{ result: { id: stick, count: 4 }, delta: [{ id: registry.itemsByName.oak_planks.id, count: -2 }], requiresTable: false }]
      : []);
    expect(r.exec.submitDetailed([
      { skill: 'collect', block: 'oak_log', count: 1 },
      { skill: 'craft', item: 'stick', count: 4, needs: [1] },
    ], 'append').accepted).toBe(true);
    expect(r.craft).not.toHaveBeenCalled();
  });

  it.each(['missing', 'throws'])('does not treat an unavailable recipe reader as an empty registry (%s)', (state) => {
    const r = rig();
    if (state === 'missing') Object.assign(r.bot, { recipesAll: undefined });
    else r.bot.recipesAll.mockImplementation(() => { throw Error('not synchronized'); });
    expect(r.exec.submitDetailed([
      { skill: 'chat', text: 'offline prefix' },
      { skill: 'craft', item: 'stick', count: 4 },
    ], 'append').accepted).toBe(true);
  });

  it.each([
    { skill: 'craft', grid: [['oak_planks'], ['oak_planks']], count: 1 },
    { skill: 'craft', item: 'netherite_pickaxe', count: 1 },
  ] as const)('preserves explicit custom grids and the separate smithing path', (step) => {
    const r = rig();
    expect(r.exec.submitDetailed([
      { skill: 'chat', text: 'offline prefix' },
      step as never,
    ], 'append').accepted).toBe(true);
  });
});
