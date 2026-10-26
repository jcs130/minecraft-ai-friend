import { describe, expect, it } from 'vitest';
import { parseGoalPlan } from '../core/goal-plan.ts';
import { parseGoal } from '../core/world.ts';

describe('recoverable goal probe contract errors', () => {
  it('rejects the live position alias loop and returns an accepted complete shape', () => {
    const bad = parseGoalPlan([{ do: 'reach the entrance', verify: {
      source: 'position', at: [-1181, 66, -1554], equals: true,
    } }]);
    if (!('error' in bad)) throw new Error('Invalid aliases were accepted');
    expect(bad.error).toContain('不属于 position 的字段: at, equals');
    expect(bad.error).toContain('position 只收 source, region, dimension');
    const example = JSON.parse(bad.error.match(/结构示例[^：]*：(\{[^\n]+?\})。/)![1]);
    expect(example).toMatchObject({ source: 'position', dimension: 'minecraft:overworld' });
    const repaired = parseGoalPlan([{ do: 'reach the entrance', verify: {
      ...example, region: [[-1191, 56, -1564], [-1171, 76, -1544]],
    } }]);
    expect(repaired).toMatchObject({ steps: [{ state: 'pending', evidence: null }] });
  });

  it('explains dropped-item evidence and keeps server state as explicit host judgment', () => {
    const bad = parseGoalPlan([{ do: 'claim the commission', verify: {
      source: 'item', key: 'commission:phase', field: 'status',
    } }]);
    if (!('error' in bad)) throw new Error('Unsupported server-state probe was accepted');
    expect(bad.error).toContain('item 统计区域内的掉落物');
    expect(bad.error).toContain('改用 judgment，删除 verify');
    const example = JSON.parse(bad.error.match(/结构示例[^：]*：(\{[^\n]+?\})。/)![1]);
    expect(parseGoalPlan([{ do: 'inspect dropped arrows', verify: example }]))
      .toMatchObject({ steps: [{ state: 'pending', evidence: null }] });
    expect(parseGoalPlan([{ do: 'claim the commission', judgment: 'check the actual server claim receipt' }]))
      .toMatchObject({ steps: [{ state: 'pending', evidence: null, judgment: expect.any(String) }] });
  });

  it('identifies the actual revise path through the public operation parser', () => {
    const result = parseGoal({ revise: { slot: 1, expectedRevision: 1, text: 'reach the entrance',
      reason: 'the previous route was blocked', plan: [{ do: 'arrive', verify: {
        source: 'position', dimension: 'minecraft:overworld',
      } }],
    } });
    expect(result).toMatchObject({ error: expect.stringContaining('revise.plan[0].verify[0].region') });
    if ('error' in result) expect(result.error).not.toContain('add.plan');
  });

  it.each(['constructor', '__proto__', 'receipt', null])('returns a repairable error for source %s', source => {
    expect(() => parseGoalPlan([{ do: 'check', verify: { source } }])).not.toThrow();
    expect(parseGoalPlan([{ do: 'check', verify: { source } }]))
      .toMatchObject({ error: expect.stringContaining('source 只收 block/inventory/blueprint/position/entity/item/status') });
  });
});
