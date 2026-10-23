import { describe, expect, it } from 'vitest';
import { goalClosureMetadata } from '../core/goal-metrics.ts';
import { parseGoalPlan } from '../core/goal-plan.ts';

describe('goal closure metadata', () => {
  it('requires fresh mechanical verdicts for every milestone and preserves identity across attempts', () => {
    const plan = parseGoalPlan([{ do: 'collect material', verify: { source: 'inventory', item: 'stone', count: '>=1' } }]);
    if ('error' in plan) throw new Error(plan.error);
    const goal = { slot: 1, at: 1000, realTime: '1970-01-01T00:00:01Z', plan };
    const pending = goalClosureMetadata(goal, 'done', 2000);
    expect(pending.outcome).toBe('unknown');
    plan.steps[0].state = 'verified';
    plan.steps[0].evidence = { observedAt: 1999, verdict: 'ok', connectionGeneration: 1, realm: 'test', dimension: 'overworld', results: [] };
    const verified = goalClosureMetadata(goal, 'done', 2000);
    expect(verified).toMatchObject({ outcome: 'success', verified_by: 'environment', task_id: pending.task_id });
    expect(goalClosureMetadata(goal, 'drop', 2000).outcome).toBe('unknown');
    expect(goalClosureMetadata(goal, 'done', 4000).outcome).toBe('unknown');
    expect(JSON.stringify(verified)).not.toContain('collect material');
  });
  it('does not turn a model judgment into an environment verdict', () => {
    const plan = parseGoalPlan([{ do: 'understand information', judgment: 'check the server reply' }]);
    if ('error' in plan) throw new Error(plan.error);
    plan.steps[0].state = 'judged';
    plan.steps[0].evidence = { judgedAt: 1999, note: 'model completion claim' };
    expect(goalClosureMetadata({ slot: 1, at: 1000, realTime: 'test', plan }, 'done', 2000).outcome).toBe('unknown');
  });
});
