import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {afterEach, expect, it, vi} from 'vitest';
import {skillCraft} from '../core/skills-craft.ts';
import {precheckStep} from '../core/precheck.ts';
import {Executor, type TaskReport} from '../core/executor.ts';
import {Vec3} from 'vec3';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('prismarine-registry')('1.21.1');
const Item = require('prismarine-item')(registry);
const Recipe = require('prismarine-recipe')(registry).Recipe;
afterEach(() => vi.useRealTimers());
function rig(stock: Record<string, number>) {
  const slots = Array(46).fill(null);
  Object.entries(stock).forEach(([name, count], i) => {slots[9 + i] = new Item(registry.itemsByName[name].id, count);});
  const bot = Object.assign(new EventEmitter(), {registry, version: '1.21.1',
    _client: new EventEmitter(), inventory: {slots, selectedItem: null, items: () => slots.filter(Boolean)},
    currentWindow: null, findBlocks: () => [], recipesAll: (id: number) => Recipe.find(id, null),
    craft: vi.fn(async () => {}), game: {dimension: 'overworld'}});
  return {bot, slots};
}
const ctx = {aborted: () => false};
it.each(['crafting_table', 'iron_ingot', 'netherite_pickaxe'])('owned %s is not evidence of a new craft', async item => {
  const r = rig({[item]: 3}), before = r.slots.slice();
  await expect(skillCraft(r.bot as never, {skill: 'craft', item, count: 1}, ctx as never)).rejects.toThrow(/未现场/);
  expect(r.bot.craft).not.toHaveBeenCalled(); expect(r.slots).toEqual(before);
});
it('an explicit has expectation cannot turn an unperformed craft into executor success', async () => {
  vi.useFakeTimers();
  const r = rig({netherite_pickaxe: 1}), reports: TaskReport[] = [];
  Object.assign(r.bot, {entity: {id: 1, position: new Vec3(.5, 64, .5), onGround: true},
    health: 20, food: 20, entities: {}, players: {},
    blockAt: (position: Vec3) => ({name: 'air', stateId: 0, position, boundingBox: 'empty', getProperties: () => ({})}),
    setControlState: vi.fn(), pathfinder: {stop: vi.fn(), setGoal: vi.fn(), isMoving: () => false}});
  const log = {child() {return this;}, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {}};
  const exec = new Executor({getBot: () => r.bot as never, report: report => reports.push(report),
    nextId: () => 1, fleeHealth: () => 0, log: log as never});
  try {
    expect(exec.submitDetailed([{skill: 'craft', item: 'netherite_pickaxe', count: 1,
      expect: {has: {item: 'netherite_pickaxe', count: 1}}}], 'append').accepted).toBe(true);
    await vi.runAllTimersAsync();
    expect(reports.at(-1)?.kind).toBe('blocked');
    expect(reports.at(-1)?.steps?.[0].outcome).toBe('fail');
    expect(r.bot.craft).not.toHaveBeenCalled(); expect(r.slots[9].count).toBe(1);
  } finally {exec.shutdown();}
});
it('precheck reports missing ingredients even when the requested output is already owned', () => {
  const r = rig({crafting_table: 2});
  expect(precheckStep(r.bot as never, {skill: 'craft', item: 'crafting_table', count: 1},
    {resolve: () => null, blockAt: () => null, cellsOf: () => null})).toMatchObject({rule: 'craft.short'});
});
it('existing stock plus a real inventory gain succeeds and consumes ingredients', async () => {
  const r = rig({oak_planks: 8, oak_log: 1});
  r.bot.craft.mockImplementation(async () => {r.slots[9].count += 4; r.slots[10] = null;});
  const result = await skillCraft(r.bot as never, {skill: 'craft', item: 'oak_planks', count: 4}, ctx as never);
  expect(r.bot.craft).toHaveBeenCalledOnce(); expect(r.slots[9].count).toBe(12);
  expect(result).toContain('4'); expect(r.slots[10]).toBeNull();
});
it('a craft call with no new output remains blocked even if stock already satisfies has', async () => {
  vi.useFakeTimers();
  const r = rig({oak_planks: 8, oak_log: 1});
  const result = expect(skillCraft(r.bot as never, {skill: 'craft', item: 'oak_planks', count: 4}, ctx as never))
    .rejects.toThrow(/没|未|多/);
  await vi.runAllTimersAsync(); await result;
  expect(r.bot.craft).toHaveBeenCalledOnce(); expect(r.slots[9].count).toBe(8);
});
