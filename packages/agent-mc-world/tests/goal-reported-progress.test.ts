import { expect, it } from 'vitest';
import { applyGoal, goalLine, MinecraftWorld, parseGoal, type GoalTable } from '../core/world.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';

const stamp = { day: null, realTime: '2026-10-21T08:00:00Z', at: 100 };
const plan = [{ do: 'inspect the actual crop receipts', judgment: 'crop observations, not a declared counter' }];

function fixture(blueprint?: string) {
  const table: GoalTable = { list: [] };
  const apply = (args: Record<string, unknown>) => {
    const op = parseGoal(args);
    if ('error' in op) throw new Error(op.error);
    return applyGoal(table, op, stamp);
  };
  apply({ add: { text: 'Maintain the farm', plan, kind: 'plant', target: 'wheat',
    current: 3, total: 12, unit: 'crops', ...(blueprint ? { blueprint } : {}) } });
  const revision = { slot: 1, expectedRevision: 1, text: 'Crop count has changed; inspect maturity',
    plan, reason: 'New dated crop observations' };
  return { table, apply, revision };
}

it('lets an explicit revision correct the recorded count without certifying the project', () => {
  const { table, apply, revision } = fixture();
  const identity = { slot: table.list[0].slot, at: table.list[0].at, realTime: table.list[0].realTime };
  const receipt = JSON.parse(apply({ revise: { ...revision, progress: { current: 13 } } }));
  expect(table.list[0]).toMatchObject({ ...identity, revision: 2, kind: 'plant', target: 'wheat',
    progress: { current: 13, total: 12, unit: 'crops' } });
  expect(receipt).toMatchObject({ hostAuthored: true, goalCompleted: false,
    before: { progress: { current: 3, total: 12, unit: 'crops' } },
    after: { progress: { current: 13, total: 12, unit: 'crops' } } });
  expect(table.list[0].plan.steps[0]).toMatchObject({ state: 'pending', evidence: null });
  expect(goalLine(table.list[0])).toContain('登记进度:13/12 crops');
  expect(goalLine(table.list[0])).toContain('非实时观测');
  expect(apply({ done: 1 })).toContain('还不能结案');
  const committed = structuredClone(table);
  expect(apply({ revise: { ...revision, progress: { current: 99 } } })).toContain('未修订');
  expect(table).toEqual(committed);
});

it('preserves omitted reports, supports an explicit unknown total, and can clear the report', () => {
  const { table, apply, revision } = fixture();
  apply({ revise: revision });
  expect(table.list[0].progress).toEqual({ current: 3, total: 12, unit: 'crops' });
  apply({ revise: { ...revision, expectedRevision: 2, progress: { current: 9, total: null, unit: null } } });
  expect(table.list[0].progress).toEqual({ current: 9, total: null, unit: null });
  apply({ revise: { ...revision, expectedRevision: 3, progress: null } });
  expect(table.list[0].progress).toBeNull();
  expect(goalLine(table.list[0])).not.toContain('登记进度');
});

it.each([
  {}, { current: -1 }, { current: NaN }, { current: Infinity }, { current: '13' },
  { current: 13, total: -1 }, { current: 13, total: Infinity },
  { current: 13, unit: 7 }, { current: 13, verified: true },
])('rejects invalid reports atomically: %j', progress => {
  const { table, revision } = fixture();
  const before = structuredClone(table);
  expect(parseGoal({ revise: { ...revision, progress } })).toHaveProperty('error');
  expect(table).toEqual(before);
});

it('does not introduce a second counter for blueprint goals', () => {
  const { table, apply, revision } = fixture('farm');
  const before = structuredClone(table);
  expect(apply({ revise: { ...revision, progress: { current: 13 } } })).toContain('蓝图');
  expect(table).toEqual(before);
});

it('advertises the correction on the same public mc_goal tool', () => {
  const world = new MinecraftWorld({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS) });
  const tool = world.tools().find(t => t.name === 'mc_goal')!;
  const revision = (tool.parameters as any).properties.revise;
  expect(revision.properties.progress.properties.current.minimum).toBe(0);
  expect(revision.properties.progress.description).toContain('非实时');
});
