import { describe, expect, it } from 'vitest';
import { parseGoalPlan, recordGoalJudgment, reopenGoalJudgment } from '../core/goal-plan.ts';
import { parseGoal } from '../core/world.ts';

describe('recoverable goal probe contract errors', () => {
  it('does not send a completed four-step plan to a nonexistent fifth step or overwrite a mistaken judgment', () => {
    const plan = parseGoalPlan(Array.from({ length: 4 }, (_, i) => ({ do: `Stage ${i + 1}`, judgment: 'Host receipt required' })));
    if ('error' in plan) throw Error(plan.error);
    for (let step = 1; step <= 4; step++) expect(recordGoalJudgment(plan, step, `Reported stage ${step}`, step).ok).toBe(true);
    const before = structuredClone(plan);
    expect(recordGoalJudgment(plan, 5, 'Equipment update', 10)).toEqual({ ok: false, error: '没有第 5 个里程碑' });
    for (const step of [1, 4]) {
      const outcome = recordGoalJudgment(plan, step, 'Correction with newer evidence', 11);
      expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('没有下一步') });
      if ('error' in outcome) {
        expect(outcome.error).not.toContain('当前应处理第 5 步');
        for (const op of ['reopen', 'revise', 'done']) expect(outcome.error).toContain(op);
      }
    }
    expect(plan).toEqual(before);
    expect(reopenGoalJudgment(plan, 4)).toMatchObject({ ok: true, completed: 3 });
    expect(recordGoalJudgment(plan, 4, 'New verified source for the host judgment', 12).ok).toBe(true);
  });

  it('reports both independent failures from the live revision instead of spending a model turn per error', () => {
    const plan = [
      { do: 'start the dungeon', verify: [{ source: 'status', field: 'dungeon_active', equals: true }] },
      { do: 'clear rooms and return', judgment: 'check observed room-clear receipts' },
      { do: 'claim the reward', verify: [{ source: 'item', item: 'emerald', equals: true }] },
    ];
    const before = JSON.stringify(plan);
    const result = parseGoalPlan(plan, 'revise.plan');
    if (!('error' in result)) throw new Error('Invalid revision was accepted');
    expect(result.error).toContain('revise.plan[0].verify[0].field 只收 health/food/oxygen/burning');
    expect(result.error).toContain('revise.plan[2].verify[0] 有不属于 item 的字段: equals');
    expect(result.error).toContain('没有装备、任务或副本状态字段');
    expect(result.error).toContain('不能证明领取奖励的历史动作');
    expect(result.error).toContain('本次计划未采用任何部分');
    expect(result).not.toHaveProperty('steps');
    expect(JSON.stringify(plan)).toBe(before);
  });

  it('reports structural and probe failures together, with one contract hint per source', () => {
    const result = parseGoalPlan([
      { do: '', judgment: 'check original evidence', unsupported: true },
      { do: 'check status', verify: [
        { source: 'status', field: 'armor', equals: '>=10' },
        { source: 'status', field: 'dungeon_active', equals: true },
      ] },
    ]);
    if (!('error' in result)) throw new Error('Invalid plan was accepted');
    expect(result.error).toContain('add.plan[0] 有未知字段: unsupported');
    expect(result.error).toContain('add.plan[0].do 不能空');
    expect(result.error).toContain('add.plan[1].verify[0].field');
    expect(result.error).toContain('add.plan[1].verify[1].field');
    expect(result.error.match(/status 只收 source, field, equals/g)).toHaveLength(1);
  });

  it('bounds multi-error receipts without accepting a partial plan', () => {
    const result = parseGoalPlan(Array.from({ length: 12 }, (_, index) => ({
      do: `check ${index}`, verify: { source: 'status', field: 'unsupported', equals: true },
    })));
    if (!('error' in result)) throw new Error('Invalid plan was accepted');
    expect(result.error.match(/\.verify\[0\]\.field/g)).toHaveLength(8);
    expect(result.error).toContain('另有 4 处错误');
    expect(result.error.match(/status 只收 source, field, equals/g)).toHaveLength(1);
    expect(result).not.toHaveProperty('steps');
  });

  it('does not weaken observable dropped-item limits to make a reward plan pass', () => {
    const result = parseGoalPlan([{ do: 'claim reward', verify: [{
      source: 'item', item: 'emerald', count: '>=2', dimension: 'minecraft:overworld',
      region: [[-440, 0, 660], [-410, 20, 690]],
    }] }], 'revise.plan');
    if (!('error' in result)) throw new Error('Unobservable item region accepted');
    expect(result.error).toContain('共 20181 格');
    expect(result.error).toContain('4096');
    expect(result.error).toContain('不能证明领取奖励的历史动作');
  });

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
