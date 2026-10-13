import { describe, expect, it, vi } from 'vitest';
import { coordinateGoalPlan, parseGoalPlan, type GoalProbeContext } from '../core/goal-plan.ts';

const dimension = 'minecraft:overworld';
// A travel destination recorded in live play: 51 x 33 x 61 cells, no block scan.
const region = [[-610, 40, -510], [-560, 72, -450]];

function context(): GoalProbeContext {
  const unexpected = () => { throw new Error('Position verification must not read world contents'); };
  return {
    observedAt: 1000, connectionGeneration: 1, realm: 'test', dimension,
    position: vi.fn(() => [-580, 64, -470] as const),
    world: { cell: vi.fn(unexpected), inventory: unexpected, site: unexpected, mark: unexpected },
    status: unexpected, entities: unexpected, items: unexpected,
  };
}

describe('position goal regions', () => {
  it('verifies a large travel region without scanning blocks and regresses after leaving', () => {
    const plan = parseGoalPlan([{ do: 'reach the destination', verify: {
      source: 'position', region: [...region].reverse(), dimension,
    } }]);
    if ('error' in plan) throw new Error(plan.error);
    const ctx = context();
    expect(coordinateGoalPlan(plan, ctx)).toMatchObject({ completed: 1, ready: true });
    expect(plan.steps[0].evidence).toMatchObject({ verdict: 'ok', dimension, observedAt: 1000 });
    const outside = coordinateGoalPlan(plan, { ...ctx, observedAt: 2000, position: () => [-559.9, 64, -470] });
    expect(outside).toMatchObject({ completed: 0, ready: false });
    expect(outside.transitions).toContainEqual(expect.objectContaining({ kind: 'regress' }));
    expect(plan.steps[0].evidence).toMatchObject({ verdict: 'bad', observedAt: 2000 });
    expect(ctx.world.cell).not.toHaveBeenCalled();
  });

  it('requires matching dimension even when coordinates are inside a large region', () => {
    const plan = parseGoalPlan([{ do: 'arrive', verify: { source: 'position', region, dimension } }]);
    if ('error' in plan) throw new Error(plan.error);
    const ctx = context();
    expect(coordinateGoalPlan(plan, { ...ctx, dimension: 'minecraft:the_nether' }))
      .toMatchObject({ completed: 0, ready: false });
    expect(plan.steps[0].evidence).toMatchObject({ verdict: 'unknown' });
    expect(ctx.position).not.toHaveBeenCalled();
  });

  it.each([
    { source: 'entity', type: 'zombie', count: 0 },
    { source: 'item', item: 'stone', count: 0 },
  ])('keeps the observable region cap and unknown counts for $source', probe => {
    const oversized = parseGoalPlan([{ do: 'check region', verify: { ...probe, region, dimension } }]);
    expect(oversized).toMatchObject({ error: expect.stringContaining('4096') });
    const plan = parseGoalPlan([{ do: 'check region', verify: {
      ...probe, region: [[0, 0, 0], [15, 15, 15]], dimension,
    } }]);
    if ('error' in plan) throw new Error(plan.error);
    const ctx = context();
    ctx.world.cell = () => null;
    expect(coordinateGoalPlan(plan, ctx)).toMatchObject({ completed: 0, ready: false });
    expect(plan.steps[0].evidence).toMatchObject({ verdict: 'unknown' });
  });

  it('still rejects malformed, nonfinite and dimensionless position regions', () => {
    for (const invalid of [
      { region }, { region, dimension: '' },
      { region: [region[0]], dimension },
      { region: [[0, 0, NaN], region[1]], dimension },
      { region: [region[0], [Infinity, 0, 0]], dimension },
      { region: [['0', 0, 0], region[1]], dimension },
    ]) {
      expect(parseGoalPlan([{ do: 'arrive', verify: { source: 'position', ...invalid } }]))
        .toHaveProperty('error');
    }
  });
});
