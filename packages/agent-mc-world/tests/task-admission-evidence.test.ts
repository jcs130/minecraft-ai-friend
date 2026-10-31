import { afterEach, expect, it, vi } from 'vitest';
import { readSkillHelp } from '../core/skills.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.restoreAllMocks());
it('returns correlated no-effect admission and ends only this decision turn, preserving the task terminal', async () => {
  const r = methodHarness();
  try {
    vi.spyOn(r.exec, 'submit').mockImplementation((_steps, _mode, _wrote, onDecision) => {
      onDecision?.(false, undefined, false, { kind:'repeat', rule:'task.no-observed-effect', review: {
        protocol:'agent-mc-no-effect-plan-review/v1',planHash:'a'.repeat(64),completedNoopTasks:2,
        firstTaskId:41,latestTaskId:42,observedAt:Date.now(),observation:'unchanged',goalVerified:false,
      } });
      return 'Prior task completed with noop; identical selection was not dispatched';
    });
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({steps:[{skill:'pickup',item:'phantom_membrane'}]}, {role:'test',log:r.host.log});
    expect(result).toMatchObject({failed:true,endsTurn:true,data:{status:'blocked',goal_completed:false,
      next_safe_read:{tool:'mc_queue',arguments:{taskId:42,detail:true}}},meta:{admission:{kind:'repeat',rule:'task.no-observed-effect',review:{latestTaskId:42}}}});
    expect(result).not.toHaveProperty('execution');
  } finally { r.close(); }
});

it('rejects invalid coordinates before replacing, navigating or dispatching any earlier step', async () => {
  const r = methodHarness();
  try {
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }], 'append');
    const before = r.exec.status(), submit = vi.spyOn(r.exec, 'submit');
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ queue: 'replace', steps: [
      { skill: 'goto', at: [10, 64, 10] },
      { skill: 'observe', mode: 'voxels', bounds: [-8, -6, -8, -9, 3, 4], needs: [1] },
    ] }, { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ failed: true, meta: { admission: {
      accepted: false, dispatched: false, kind: 'correction', rule: 'arguments.steps',
    } } });
    expect(result).not.toHaveProperty('execution');
    expect((result as { text: string }).text).toContain('bounds');
    expect(submit).not.toHaveBeenCalled();
    expect(r.exec.status().running?.id).toBe(before.running?.id);
    expect(r.exec.status().waiting.map(t => t.id)).toEqual(before.waiting.map(t => t.id));
  } finally { r.close(); }
});

it('returns machine admission correction for invalid queue selection before any executor call', async () => {
  const r = methodHarness();
  try {
    const submit = vi.spyOn(r.exec, 'submit');
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({
      queue: 'invented', steps: [{ skill: 'goto', at: [10, 64, 10] }],
    }, { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ failed: true, meta: { admission: { accepted: false,
      dispatched: false, kind: 'correction', rule: 'arguments.queue' } } });
    expect(submit).not.toHaveBeenCalled();
  } finally { r.close(); }
});

it('returns native recipe rejection and exact cooking help without altering queued work', async () => {
  const r = methodHarness();
  try {
    Object.assign(r.bot, { recipesAll: vi.fn(() => []), craft: vi.fn() });
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }], 'append');
    const before = r.exec.status();
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({
      queue: 'now', steps: [{ skill: 'craft', item: 'cooked_chicken', count: 1 }],
    }, { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ failed: true, meta: { admission: {
      accepted: false, rule: 'craft.invalid', kind: 'correction',
      recovery: [{ tool: 'mc_help', arguments: { skill: 'smelt' }, text: (readSkillHelp({ skill: 'smelt' }) as { text: string }).text }],
    } } });
    expect(r.exec.status().waiting.map(t => t.id)).toEqual(before.waiting.map(t => t.id));
    expect(r.exec.status().running?.id).toBe(before.running?.id);
    expect((r.bot as any).craft).not.toHaveBeenCalled();
  } finally { r.close(); }
});

it('keeps ordinary admission unchanged and does not attach rejection evidence to accepted work', async () => {
  const r = methodHarness();
  try {
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({
      steps: [{ skill: 'goto', at: [8, 64, 0] }], queue: 'append',
    }, { role: 'test', log: r.host.log });
    expect(result).not.toHaveProperty('failed');
    expect(result).not.toHaveProperty('meta.admission');
  } finally { r.close(); }
});

it.each([
  { steps: [{ skill: 'toss', item: 'dirt', count: 18 }, { skill: 'toss', item: 'wheat_seeds', count: 7 }] },
  { steps: [{ skill: 'toss', item: 'dirt', count: 18 }, { skill: 'pickup', item: 'iron_pickaxe' }] },
])('admits caller-selected discards without requiring a storage trip', async ({ steps }) => {
  const r = methodHarness();
  try {
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ steps }, { role: 'test', log: r.host.log });
    expect(result).not.toHaveProperty('failed');
    expect(result).not.toHaveProperty('meta.admission');
    expect(result).toHaveProperty('execution');
  } finally { r.close(); }
});
