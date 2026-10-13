import { expect, it } from 'vitest';
import { parseGoalPlan, GOAL_PLAN_SCHEMA } from '../core/goal-plan.ts';
import Ajv from 'ajv';

it('accepts the unused null criterion returned by public plans without weakening verification', () => {
  const verify = { source: 'inventory', item: 'rail', count: '>=1' };
  const plan = [{ do: 'collect rail', verify, judgment: null }, { do: 'read receipt', verify: null, judgment: 'server receipt' }];
  expect(new Ajv({ strict: false }).compile(GOAL_PLAN_SCHEMA)(plan)).toBe(true);
  expect(parseGoalPlan(plan)).toMatchObject({ steps: [{ state: 'pending', evidence: null }, { state: 'pending', evidence: null }] });
  for (const criteria of [{ verify, judgment: 'also this' }, { verify: null, judgment: null }, { verify: {}, judgment: null }]) {
    expect(parseGoalPlan([{ do: 'invalid', ...criteria }])).toHaveProperty('error');
  }
});
