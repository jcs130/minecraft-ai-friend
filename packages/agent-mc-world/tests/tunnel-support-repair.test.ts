import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Executor, type TaskReport } from '../core/executor.ts';
import type { SkillCall } from '../core/skills.ts';
import { SkillBlocked } from '../core/skill-context.ts';

// Keep the executor, dependency gates and tunnel's physical checks real. Only
// replace placement/movement transport so the test controls server confirmation.
vi.mock('../core/skills-build.ts', async original => ({
  ...await original<typeof import('../core/skills-build.ts')>(),
  skillBuild: async (bot: Bot, call: SkillCall) => (bot as any).confirmBuild(call),
}));
vi.mock('../core/travel.ts', async original => ({
  ...await original<typeof import('../core/travel.ts')>(),
  gotoGoal: async (bot: Bot, goal: { x: number; y: number; z: number }) => {
    (bot as any).moves.push([goal.x, goal.y, goal.z]);
    bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5);
  },
}));

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
const repair: SkillCall = { skill: 'build', material: 'netherrack', anchors: [[1, 63, 0]] };
const tunnel: SkillCall = { skill: 'tunnel', at: [3, 64, 0] };

function rig(mode: 'confirmed' | 'failed' | 'unconfirmed' = 'confirmed') {
  let id = 0, stock = 1; const reports: TaskReport[] = [], cells = new Map<string, string>();
  cells.set('1,63,0', 'air');
  const key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(.5, 64, .5), onGround: true },
    game: { dimension: 'overworld' }, health: 20, food: 20, entities: {}, players: {},
    inventory: { items: () => stock ? [{ name: 'netherrack', count: stock, type: registry.itemsByName.netherrack.id }] : [],
      slots: Array(46).fill(null) }, currentWindow: null, moves: [] as number[][],
    blockAt: (position: Vec3) => {
      const name = cells.get(key(position)) ?? (position.y < 64 ? 'stone' : 'air');
      return { name, type: registry.blocksByName[name].id, stateId: registry.blocksByName[name].defaultState,
        position, boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => ({}) };
    },
    confirmBuild: vi.fn(async () => {
      stock = 0;
      if (mode === 'failed') throw new SkillBlocked('server rejected placement');
      if (mode === 'confirmed') cells.set('1,63,0', 'netherrack');
      return 'placement call returned';
    }),
    dig: vi.fn(), equip: vi.fn(), placeBlock: vi.fn(), setControlState: vi.fn(),
    pathfinder: { stop: vi.fn(), setGoal: vi.fn(), goto: vi.fn() },
  }) as unknown as Bot & { confirmBuild: ReturnType<typeof vi.fn>; moves: number[][] };
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const exec = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never,
    nextId: () => ++id, fleeHealth: () => 0 });
  const stops = [{ at: Date.now(), dimension: 'overworld', cell: { x: 1, y: 64, z: 0 } }];
  Object.assign(exec, { tunnelSupportStops: stops });
  return { exec, bot, cells, reports, stops };
}

afterEach(() => vi.useRealTimers());

it('admits repair then tunnel without declaring a planned support already repaired', async () => {
  vi.useFakeTimers(); const r = rig();
  try {
    expect(r.exec.submitDetailed([repair, { ...tunnel, needs: [1] }], 'append').accepted).toBe(true);
    expect((r.exec as any).tunnelSupportStops).toEqual(r.stops);
    await vi.runAllTimersAsync();
    expect(r.bot.confirmBuild).toHaveBeenCalledOnce();
    expect(r.cells.get('1,63,0')).toBe('netherrack');
    expect(r.bot.moves).toContainEqual([3, 64, 0]);
    expect(r.reports.find(r => r.kind === 'done')?.steps?.map(s => s.outcome)).toEqual(['ok', 'ok']);
  } finally { r.exec.shutdown(); }
});

it('keeps dependency failure from moving onto an unconfirmed repair', async () => {
  vi.useFakeTimers(); const r = rig('failed');
  try {
    expect(r.exec.submitDetailed([repair, { ...tunnel, needs: [1] }], 'append').accepted).toBe(true);
    await vi.runAllTimersAsync();
    expect(r.reports.find(r => r.kind === 'blocked')?.steps?.map(s => s.outcome)).toEqual(['fail', 'skip']);
    expect(r.bot.moves).toEqual([]);
    expect(r.cells.get('1,63,0')).toBe('air');
  } finally { r.exec.shutdown(); }
});

it('rechecks actual footing even when a preceding placement returns without a dependency', async () => {
  vi.useFakeTimers(); const r = rig('unconfirmed');
  try {
    expect(r.exec.submitDetailed([repair, tunnel], 'append').accepted).toBe(true);
    await vi.runAllTimersAsync();
    expect(r.bot.moves).toEqual([]);
    expect(r.cells.get('1,63,0')).toBe('air');
    expect(r.reports.find(r => r.kind === 'blocked')?.steps?.at(-1)).toMatchObject({ outcome: 'fail',
      why: expect.stringContaining('脚下悬空') });
  } finally { r.exec.shutdown(); }
});

it.each([
  ['no repair', []],
  ['preview only', [{ ...repair, dryRun: true }]],
  ['different cell', [{ skill: 'build', material: 'netherrack', anchors: [[1, 62, 0]] }]],
  ['non-support material', [{ skill: 'build', material: 'torch', anchors: [[1, 63, 0]] }]],
  ['unknown material', [{ skill: 'build', material: 'unknown_block', anchors: [[1, 63, 0]] }]],
] as [string, SkillCall[]][])('retains the repeat guard for %s and preserves the existing queue', (_name, prefix) => {
  const r = rig();
  try {
    r.exec.submitDetailed([{ skill: 'wait', ticks: 100 }], 'append');
    const before = r.exec.status();
    const result = r.exec.submitDetailed([...prefix, tunnel], 'replace');
    expect(result).toMatchObject({ accepted: false, rejection: { rule: 'tunnel.support' } });
    expect(r.exec.status().running?.id).toBe(before.running?.id);
    expect(r.exec.status().waiting.map(t => t.id)).toEqual(before.waiting.map(t => t.id));
    expect(r.bot.confirmBuild).not.toHaveBeenCalled();
  } finally { r.exec.shutdown(); }
});

it('does not let a later repair or a repair in another location bypass the guard', () => {
  const r = rig();
  try {
    expect(r.exec.submitDetailed([tunnel, repair], 'append')).toMatchObject({ accepted: false });
    Object.assign(r.exec, { tunnelSupportStops: [...r.stops,
      { at: Date.now(), dimension: 'overworld', cell: { x: 2, y: 64, z: 0 } }] });
    r.cells.set('2,63,0', 'air');
    expect(r.exec.submitDetailed([repair, tunnel], 'append')).toMatchObject({ accepted: false,
      rejection: { rule: 'tunnel.support' } });
  } finally { r.exec.shutdown(); }
});

it.each([
  { skill: 'build', material: 'netherrack', anchors: [[1, 63, 0], [1, 62, 0]] },
  { skill: 'build', material: 'netherrack', shape: 'line', anchors: [[1, 62, 0], [1, 63, 0]] },
  { skill: 'build', material: 'netherrack', on: [{ at: [1, 62, 0], face: 'up' }] },
] as SkillCall[])('recognizes the actual build footprint after an earlier waypoint: %j', planned => {
  const r = rig();
  try {
    expect(r.exec.submitDetailed([
      { skill: 'goto', at: [-1, 64, 0] }, { ...planned, needs: [1] }, { ...tunnel, needs: [2] },
    ], 'append').accepted).toBe(true);
    expect((r.exec as any).tunnelSupportStops).toEqual(r.stops);
  } finally { r.exec.shutdown(); }
});
