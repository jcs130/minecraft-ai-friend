import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { precheckStep, type PrecheckDeps } from '../core/precheck.ts';
import { useOnce, useProbeAt } from '../core/skills-interact.ts';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.21.1');
const Item = req('prismarine-item')(registry);
const Block = req('prismarine-block')(registry);
const at: [number, number, number] = [-503, 70, -449];
const cell = { x: at[0], y: at[1], z: at[2] };

function block(name: string, properties: Record<string, number> = {}) {
  const definition = registry.blocksByName[name];
  for (let id = definition.minStateId; id <= definition.maxStateId; id++) {
    const value = Block.fromStateId(id, 0);
    if (Object.entries(properties).every(([key, expected]) => String(value.getProperties()[key]) === String(expected))) {
      value.position = new Vec3(...at);
      return value;
    }
  }
  throw new Error(`No registered state for ${name}`);
}

function rig(target = 'composter', level = 0) {
  const seeds = new Item(registry.itemsByName.wheat_seeds.id, 20);
  seeds.slot = 36;
  const slots = Array(46).fill(null);
  slots[36] = seeds;
  let current = block(target, target === 'composter' ? { level } : {});
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(-502.5, 70, -449.5), onGround: true },
    game: { dimension: 'overworld' }, entities: {}, players: {},
    heldItem: seeds, currentWindow: null,
    inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean), selectedItem: null },
    equip: vi.fn(async (item: typeof seeds) => { bot.heldItem = item; }),
    blockAt: vi.fn(() => current),
    _client: Object.assign(new EventEmitter(), { write: vi.fn() }),
    activateBlock: vi.fn(async () => {
      bot._client.write('block_place', { hand: 0, location: new Vec3(...at), sequence: 1 });
      seeds.count--;
      current = block('composter', { level: level + 1 });
    }),
    pathfinder: { goto: vi.fn(), stop: vi.fn(), setGoal: vi.fn() },
  });
  const deps: PrecheckDeps = { resolve: () => cell, blockAt: () => current, cellsOf: () => null };
  return { bot: bot as unknown as Bot, fake: bot, seeds, slots, deps,
    setBlock(value: typeof current) { current = value; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('does not classify the captured wheat-seed composter interaction as planting', () => {
  const r = rig();
  expect(precheckStep(r.bot, { skill: 'use', item: 'wheat_seeds', at, times: 16 }, r.deps)).toBeNull();
  expect(r.fake.activateBlock).not.toHaveBeenCalled();
});

it('executes the explicitly requested composter click without redirecting it to farmland', async () => {
  const r = rig();
  const work = useOnce(r.bot, { skill: 'use', item: 'wheat_seeds', at }, { aborted: () => false } as never)
    .then(value => ({ value, error: null }), error => ({ value: '', error }));
  await vi.runAllTimersAsync();
  const result = await work;
  expect(result.error).toBeNull();
  expect(result.value).toMatch(/堆肥桶/);
  expect(r.fake.activateBlock).toHaveBeenCalledTimes(1);
  expect(r.fake.activateBlock.mock.calls[0][0].position).toEqual(new Vec3(...at));
  expect(r.seeds.count).toBe(19);
  expect(r.fake.pathfinder.goto).not.toHaveBeenCalled();
});

it('records consumed seeds even when the random compost level does not increase', () => {
  const r = rig('composter', 2);
  const probe = useProbeAt(r.bot, 'wheat_seeds', cell, 'composter');
  expect(probe).not.toBeNull();
  r.seeds.count--;
  const result = probe!.read();
  expect(result.met).toBe(true);
  expect(result.actual).toContain('level 2 → 2');
  expect(result.actual).toContain('20 → 19');
  expect(result.actual).not.toContain('产出骨粉');
});

it('does not report composting success when neither the block nor inventory changes', async () => {
  const r = rig('composter', 7);
  r.fake.activateBlock.mockImplementation(async () => {});
  const work = useOnce(r.bot, { skill: 'use', item: 'wheat_seeds', at }, { aborted: () => false } as never)
    .then(value => ({ value, error: null }), error => ({ value: '', error }));
  await vi.runAllTimersAsync();
  expect((await work).error?.message).toContain('level 7 → 7');
  expect(r.fake.activateBlock).toHaveBeenCalledTimes(1);
  expect(r.seeds.count).toBe(20);
});

it('reads ready compost collection from actual bone-meal gain and level reset', () => {
  const r = rig('composter', 8);
  const probe = useProbeAt(r.bot, null, cell, 'composter');
  expect(probe).not.toBeNull();
  r.slots[9] = new Item(registry.itemsByName.bone_meal.id, 1);
  r.setBlock(block('composter', { level: 0 }));
  expect(probe!.read()).toMatchObject({ met: true, actual: expect.stringContaining('level 8 → 0') });
});

it('keeps an unloaded target unknown even when the inventory count changes', () => {
  const r = rig();
  const probe = useProbeAt(r.bot, 'wheat_seeds', cell, 'composter');
  r.seeds.count--;
  r.fake.blockAt.mockImplementation(() => null as never);
  expect(probe!.read()).toMatchObject({ met: false, actual: expect.stringContaining('(读不到)') });
});

it('keeps non-soil planting rejected and does not send a use packet', async () => {
  const r = rig('stone');
  expect(precheckStep(r.bot, { skill: 'use', item: 'wheat_seeds', at }, r.deps))
    .toMatchObject({ level: 'hard', rule: 'use.seedWrongBlock' });
  await expect(useOnce(r.bot, { skill: 'use', item: 'wheat_seeds', at }, { aborted: () => false } as never))
    .rejects.toThrow('没有发送使用');
  expect(r.fake.activateBlock).not.toHaveBeenCalled();
});
