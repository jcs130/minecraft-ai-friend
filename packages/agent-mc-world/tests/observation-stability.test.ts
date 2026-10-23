import { describe, expect, it } from 'vitest';
import type { WorldRequestFacts } from '../src/contracts/host.ts';
import { assessObservationStability } from '../src/decisions/observation-stability.ts';

function facts(): WorldRequestFacts {
  return { text: '', snapshotTypes: [], parts: [{ key: 'body', text: 'health20 pose0' },
    { key: 'place', text: 'standing facing north' }, { key: 'queue', text: '[]' }],
    decisionStability: { sampledAtMs: 10000, identity: ['world', 'account', 1], dimension: 'overworld',
      position: [0, 64, 0], health: 20, food: 20,
      guards: { body: ['dry', null], place: ['plains', 'stone'], clock: ['day', false] } } };
}
const assess = (a: WorldRequestFacts, b: WorldRequestFacts) => assessObservationStability(a, b, { now: 11000 });
describe('bounded host decision stability across Minecraft adapters', () => {
  it('tolerates pose and one ordinary health/food tick without treating them as identical', () => {
    const a = facts(), b = facts(); b.decisionStability!.position = [.6, 64.5, .6];
    b.decisionStability!.health = 19; b.decisionStability!.food = 19;
    b.parts = [{ key: 'body', text: 'health19 pose.6' }, { key: 'place', text: 'standing facing east' }, { key: 'queue', text: '[]' }];
    expect(assess(a, b)).toMatchObject({ verdict: 'stable', unsafe: [], changed: [] });
    expect(assess(a, b).tolerated).toContain('pose');
  });
  it.each(['health-loss', 'critical-health', 'unknown-health', 'identity', 'dimension', 'stale', 'air-loss', 'unknown-queue', 'lost-typed-sample'])
    ('rejects %s without a body dispatch', change => {
      const a = facts(), b = facts();
      if (change === 'health-loss') b.decisionStability!.health = 18;
      if (change === 'critical-health') { a.decisionStability!.health = 7; b.decisionStability!.health = 6; }
      if (change === 'unknown-health') b.decisionStability!.health = null;
      if (change === 'identity') b.decisionStability!.identity = ['world', 'other', 1];
      if (change === 'dimension') b.decisionStability!.dimension = 'nether';
      if (change === 'stale') b.decisionStability!.sampledAtMs = 100;
      if (change === 'air-loss') b.decisionStability!.guards = { body: ['water', 10] };
      if (change === 'unknown-queue') b.parts = [...b.parts!.filter(p => p.key !== 'queue'), { key: 'queue', text: '[{"phase":"unknown"}]' }];
      if (change === 'lost-typed-sample') delete b.decisionStability;
      expect(assess(a, b).verdict).toBe('unsafe');
    });
  it('rechecks a large movement and changed inventory without authorizing action', () => {
    const a = facts(), b = facts(); b.decisionStability!.position = [2, 64, 0];
    b.parts = [...b.parts!, { key: 'inventory', text: 'bread x3' }];
    expect(assess(a, b)).toMatchObject({ verdict: 'recheck', unsafe: [], changed: ['position', 'facts:inventory'] });
  });
  it('never guesses the meaning of a changed opaque body reading', () => {
    const a = facts(), b = facts(); delete a.decisionStability; delete b.decisionStability;
    b.parts = [{ key: 'body', text: 'drowning' }];
    expect(assess(a, b).unsafe).toContain('facts:body');
  });
});
