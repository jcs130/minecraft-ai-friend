import { afterEach, expect, it, vi } from 'vitest';
import type { SkillCall } from '../core/skills.ts';
import type { RouteProbe } from '../core/skill-context.ts';
import type { TaskReport } from '../core/executor.ts';
import { preferExistingRoute, walkOnlyPath } from '../core/travel.ts';
import { methodHarness } from './method-harness.ts';

const route = (status: RouteProbe['status'] = 'complete', extra: Partial<RouteProbe> = {}): RouteProbe =>
  ({ profile: 'walk', status, steps: status === 'noPath' ? 0 : 12, place: 0, breaks: 0, endDist: 0, visited: 10, ...extra });
afterEach(() => vi.useRealTimers());

it.each([
  { probes: [route()], expected: { walkOnly: true, evidence: 'complete' } },
  { probes: [route('partial', { endDist: 20 })], expected: { walkOnly: true, evidence: 'partial' } },
  { probes: [route('timeout')], expected: { walkOnly: true, evidence: 'unconfirmed' } },
  { probes: [route('noPath', { visited: undefined })], expected: { walkOnly: true, evidence: 'unconfirmed' } },
  { probes: null, expected: { walkOnly: true, evidence: 'unconfirmed' } },
  { probes: [route('complete', { breaks: 1 })], expected: { walkOnly: true, evidence: 'unconfirmed' } },
  { probes: [route('noPath')], expected: { walkOnly: false, evidence: 'no-path' } },
])('distinguishes route proof from an incomplete or unavailable search: %j', ({ probes, expected }) => {
  expect(preferExistingRoute(probes)).toEqual(expected);
});

function rig(probes: RouteProbe[] | null = [route()]) {
  vi.useFakeTimers();
  const h = methodHarness('1.21.1'), reports: TaskReport[] = [], choices: unknown[] = [], calls: Array<{ dig: boolean; scaffold: number[]; goal: any }> = [];
  const scaffold = [h.bot.registry.itemsByName.dirt.id];
  const movements = { canDig: true, scafoldingBlocks: scaffold };
  const sample = vi.fn((_at: unknown, _goal: unknown, profiles?: readonly RouteProbe['profile'][]) =>
    probes?.filter(p => !profiles || profiles.includes(p.profile)) ?? null);
  Object.assign(h.exec as any, { opts: { ...(h.exec as any).opts, probeRoutes: sample,
    report: (report: TaskReport) => reports.push(report), diag: { write: (value: unknown) => choices.push(value) } } });
  let run = async (goal: any) => {
    h.bot.entity.position.set(goal.x + .5, goal.y ?? h.bot.entity.position.y, goal.z + .5);
  };
  Object.assign(h.bot.pathfinder, { movements, isMoving: () => false,
    goto: vi.fn(async (goal: any) => {
      h.bot.pathfinder.goal = goal;
      calls.push({ dig: movements.canDig, scaffold: [...movements.scafoldingBlocks], goal });
      await run(goal);
    }) });
  return { ...h, reports, movements, scaffold, choices, calls, sample, run: (f: typeof run) => { run = f; } };
}
async function finish(r: ReturnType<typeof rig>) {
  for (let i = 0; i < 100 && !r.reports.length; i++) await vi.advanceTimersByTimeAsync(20);
  expect(r.reports).toHaveLength(1);
}

it('uses a complete existing route even if a cheaper digging route was also supplied', async () => {
  const r = rig([route('complete', { steps: 30 }), { ...route('complete', { steps: 3, breaks: 2 }), profile: 'style' }]);
  try {
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }]); await finish(r);
    expect(r.calls.map(c => [c.dig, c.scaffold])).toEqual([[false, []]]);
    expect(r.sample.mock.calls[0][2]).toEqual(['walk']);
    expect(r.reports[0]).toMatchObject({ kind: 'done', text: expect.stringContaining('沿现有通路') });
    expect(r.movements.canDig).toBe(true); expect(r.movements.scafoldingBlocks).toBe(r.scaffold);
  } finally { r.close(); }
});

it('permits configured terrain abilities after a bounded noPath search, without claiming terrain was changed', async () => {
  const r = rig([route('noPath')]);
  try {
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }]); await finish(r);
    expect(r.calls.map(c => c.dig)).toEqual([true]);
    expect(r.reports[0].text).toContain('不代表这些动作实际发生');
  } finally { r.close(); }
});

it.each(['NoPath', 'empty-noPath'] as const)('retries at most once with configured abilities after owned %s', async kind => {
  const r = rig(null);
  try {
    r.run(async goal => {
      if (r.calls.length === 1) {
        if (kind === 'empty-noPath') { r.bot.emit('path_update', { status: 'noPath', path: [] }); return; }
        throw Object.assign(new Error('No path to the goal'), { name: 'NoPath' });
      }
      r.bot.entity.position.set(goal.x + .5, goal.y, goal.z + .5);
    });
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }]); await finish(r);
    expect(r.calls.map(c => c.dig)).toEqual([false, true]);
    expect(r.reports[0].kind).toBe('done');
    expect(r.bot.listenerCount('path_update')).toBe(0);
    expect(r.choices).toContainEqual(expect.objectContaining({ event: 'route-choice', data: expect.objectContaining({ evidence: 'execution-no-path' }) }));
  } finally { r.close(); }
});

it.each(['Timeout', 'PathStopped', 'GoalChanged', 'Error'])('does not turn %s into permission to dig', async name => {
  const r = rig([route('timeout')]);
  try {
    r.run(async () => { r.bot.pathfinder.goal = null; throw Object.assign(new Error(name), { name }); });
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }]); await finish(r);
    expect(r.calls.map(c => c.dig)).toEqual([false]);
    expect(r.reports[0].kind).toBe('blocked');
    expect(r.movements.canDig).toBe(true); expect(r.movements.scafoldingBlocks).toBe(r.scaffold);
    expect(r.bot.listenerCount('path_update')).toBe(0);
  } finally { r.close(); }
});

it('keeps explicit walkOnly strict and does not loop on a failed fallback', async () => {
  for (const strict of [true, false]) {
    const r = rig(null);
    try {
      r.run(async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); });
      r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0], walkOnly: strict }]); await finish(r);
      expect(r.calls.map(c => c.dig)).toEqual(strict ? [false] : [false, true]);
      expect(r.reports[0].kind).toBe('blocked');
    } finally { r.close(); }
  }
});

it('selects each actual long-travel leg from its new start instead of probing the far destination first', async () => {
  const r = rig();
  try {
    r.sample.mockImplementation((at: any) => [route(at.x === 48 ? 'complete' : 'noPath')]);
    r.exec.submitDetailed([{ skill: 'goto', at: [130, 64, 0] }]); await finish(r);
    expect(r.calls.map(c => [c.goal.x, c.dig])).toEqual([[48, false], [130, true]]);
    expect((r.sample.mock.calls[0][0] as any).x).toBe(48);
    expect(r.sample.mock.calls[0][1]).toBe(r.calls[0].goal);
    expect(r.reports[0].kind).toBe('done');
  } finally { r.close(); }
});

it('preserves another no-dig lease instead of treating fallback as permission to override it', async () => {
  const r = rig(null), release = walkOnlyPath(r.bot as never);
  try {
    r.run(async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); });
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }]); await finish(r);
    expect(r.calls.map(c => c.dig)).toEqual([false]);
    expect(r.movements.canDig).toBe(false); expect(r.movements.scafoldingBlocks).toEqual([]);
    release(); expect(r.movements.canDig).toBe(true); expect(r.movements.scafoldingBlocks).toBe(r.scaffold);
  } finally { release(); r.close(); }
});

it('does not turn cancellation followed by a late NoPath into a new digging attempt', async () => {
  const r = rig(null); let reject!: (error: Error) => void;
  try {
    r.run(() => new Promise((_resolve, fail) => { reject = fail; }));
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }]);
    await vi.advanceTimersByTimeAsync(20); expect(r.calls).toHaveLength(1);
    r.exec.shutdown(); reject(Object.assign(new Error('No path'), { name: 'NoPath' }));
    await vi.advanceTimersByTimeAsync(20);
    expect(r.calls.map(c => c.dig)).toEqual([false]);
    expect(r.movements.canDig).toBe(true); expect(r.movements.scafoldingBlocks).toBe(r.scaffold);
    expect(r.bot.listenerCount('path_update')).toBe(0);
  } finally { r.close(); }
});

it('prefers a newly observed existing route over an earlier failed search, without adding retries', async () => {
  const r = rig(null);
  try {
    r.sample.mockImplementation(() => r.calls.length ? [route()] : null);
    r.run(async goal => {
      if (r.calls.length === 1) throw Object.assign(new Error('No path'), { name: 'NoPath' });
      r.bot.entity.position.set(goal.x + .5, goal.y, goal.z + .5);
    });
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }]); await finish(r);
    expect(r.calls.map(c => c.dig)).toEqual([false, false]);
    expect(r.reports[0].kind).toBe('done');
  } finally { r.close(); }
});
