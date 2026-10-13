import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { invItemNamed, noSuchItem } from '../core/inventory.ts';
import { equipNamed, skillEquip } from '../core/skills-craft.ts';
import { useOnce } from '../core/skills-interact.ts';
import { precheckStep, precheckSteps, type PrecheckDeps } from '../core/precheck.ts';
import { Executor, type TaskReport } from '../core/executor.ts';
import { parseSteps, type SkillCall } from '../core/skills.ts';

const require = createRequire(import.meta.url);
const dependency = createRequire(require.resolve('mineflayer'));
const registry = dependency('prismarine-registry')('1.20.6');
const Item = dependency('prismarine-item')(registry);
const Block = dependency('prismarine-block')(registry);
const AT: [number, number, number] = [1, 63, 0];

function state(name: string, properties: Record<string, string | number | boolean>) {
  const definition = registry.blocksByName[name];
  for (let id = definition.minStateId; id <= definition.maxStateId; id++) {
    const block = Block.fromStateId(id, 0);
    if (Object.entries(properties).every(([key, value]) => String(block.getProperties()[key]) === String(value))) {
      block.position = new Vec3(...AT);
      return block;
    }
  }
  throw new Error(`No native ${name} state for ${JSON.stringify(properties)}`);
}

function rig(name = 'water_bucket', offhand = false) {
  const stack = new Item(registry.itemsByName[name].id, 1);
  const slots = Array(46).fill(null);
  slots[offhand ? 45 : 36] = stack;
  const sent: string[] = [];
  let block = state('water', { level: 0 });
  const equip = vi.fn(async (item: Bot['heldItem']) => { bot.heldItem = item; });
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(0.5, 64, 0.5), onGround: true },
    game: { dimension: 'overworld' }, health: 20, food: 20, entities: {}, players: {},
    inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean), selectedItem: null },
    heldItem: offhand ? null : stack, equip,
    _client: Object.assign(new EventEmitter(), { write: vi.fn() }),
    blockAt: (_at: Vec3) => block,
    chat: (text: string) => { sent.push(text); },
    setControlState: vi.fn(),
    pathfinder: { stop: vi.fn(), setGoal: vi.fn(), goto: vi.fn() },
  }) as unknown as Bot;
  const deps: PrecheckDeps = { resolve: () => ({ x: AT[0], y: AT[1], z: AT[2] }),
    blockAt: () => block, cellsOf: () => null };
  const reports: TaskReport[] = [];
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  let next = 0;
  const exec = new Executor({ getBot: () => bot, report: report => reports.push(report),
    log: log as never, nextId: () => ++next, fleeHealth: () => 0 });
  return { bot, stack, equip, deps, reports, sent, exec,
    setBlock: (value: typeof block) => { block = value; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('coordinate intent at collection admission', () => {
  it.each([{ at: [1, 64, 0] }, { at: [[1, 64, 0]] }])('rejects the entire batch instead of collecting a different block for %j', ({ at }) => {
    const parsed = parseSteps([{ skill: 'goto', at: [0, 64, 0] },
      { skill: 'collect', block: 'dirt', count: 1, at }]);
    expect(parsed).toEqual({ error: expect.stringContaining('第 2 步 collect 不支持 at') });
    expect(parsed).not.toHaveProperty('steps');
    expect('error' in parsed && parsed.error).toContain('excavate');
  });

  it('retains unlocated collection and exact excavation, including null fields from the flat schema', () => {
    expect(parseSteps([{ skill: 'collect', block: 'dirt', count: 2, at: null }]))
      .toEqual({ steps: [{ skill: 'collect', block: 'dirt', count: 2 }] });
    const exact = { skill: 'excavate', shape: 'box', anchors: [[1, 64, 0], [1, 64, 0]] };
    const parsed = parseSteps([exact]);
    expect(parsed).toMatchObject({ steps: [exact] });
  });
});

describe('item selection feedback follows the execution contract', () => {
  it.each(['use', 'equip'] as const)('rejects a localized label before %s and reports the real ID', async skill => {
    const r = rig();
    const call = { skill, item: '水桶', ...(skill === 'use' ? { at: AT } : {}) } as SkillCall;
    const note = precheckStep(r.bot, call, r.deps);
    expect(note).toMatchObject({ level: 'hard', rule: `${skill}.noStock` });
    expect(note!.text).toContain('未命中当前库存');
    expect(note!.text).toContain('water_bucket');
    expect(note!.text).not.toContain('包里没有水桶');
    expect(invItemNamed(r.bot, '水桶')).toBeUndefined();
    const work = skill === 'use'
      ? useOnce(r.bot, call as Extract<SkillCall, { skill: 'use' }>, { aborted: () => false } as never)
      : skillEquip(r.bot, call as Extract<SkillCall, { skill: 'equip' }>);
    await expect(work).rejects.toThrow('未命中当前库存');
    expect(r.equip).not.toHaveBeenCalled();
    expect(r.bot.pathfinder.goto).not.toHaveBeenCalled();
    expect(r.stack.count).toBe(1);
    expect(precheckStep(r.bot, { ...call, item: 'water_bucket' } as SkillCall, r.deps)).toBeNull();
    expect(await equipNamed(r.bot, 'water_bucket')).toBe('water_bucket');
    expect(r.bot.heldItem).toBe(r.stack);
  });

  it('distinguishes a real missing item from a label mismatch, including offhand stock', () => {
    const r = rig('water_bucket', true);
    expect(precheckStep(r.bot, { skill: 'equip', item: '水桶' }, r.deps)?.text).toContain('water_bucket');
    expect(precheckStep(r.bot, { skill: 'equip', item: 'water_bucket' }, r.deps)).toBeNull();
    expect(noSuchItem(r.bot, 'iron_pickaxe').message).toContain('包里没有铁镐');
    expect(noSuchItem(r.bot, 'iron_pickaxe').message).not.toContain('未命中当前库存');
  });

  it('still selects a custom instance whose exact name is the localized label', async () => {
    const r = rig();
    r.stack.customName = '水桶';
    expect(precheckStep(r.bot, { skill: 'use', item: '水桶', at: AT }, r.deps)).toBeNull();
    expect(await equipNamed(r.bot, '水桶')).toBe('water_bucket');
    expect(r.bot.heldItem).toBe(r.stack);
  });

  it('reports an equip then bare block click without rewriting the steps or holding a soft warning as an error', () => {
    const r = rig();
    const steps: SkillCall[] = [{ skill: 'equip', item: 'water_bucket' }, { skill: 'use', at: AT }];
    const before = structuredClone(steps);
    const notes = precheckSteps(r.bot, steps, r.deps);
    expect(notes).toEqual(expect.arrayContaining([expect.objectContaining({ index: 1,
      note: expect.objectContaining({ level: 'soft', rule: 'use.clearsEquippedHand',
        text: expect.stringContaining('item:"water_bucket"') }) })]));
    expect(steps).toEqual(before);
    expect(r.bot.heldItem).toBe(r.stack);
    expect(precheckSteps(r.bot, [{ skill: 'equip', item: 'water_bucket' },
      { skill: 'use', item: 'water_bucket', at: AT }], r.deps)).toEqual([]);
  });
});
