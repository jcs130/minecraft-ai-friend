import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Executor, type SkillCall, type TaskReport } from '../core/executor.ts';
import type { RouteProbe } from '../core/skill-context.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function routeRig() {
  const bot = Object.assign(new EventEmitter(), {
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) },
    game: { dimension: 'overworld' },
    inventory: { items: () => [] },
    blockAt: () => null,
    chat() {},
    clearControlStates() {},
    pathfinder: {
      stop() {}, setGoal() {},
      async goto() { throw new Error('找不到可行路线'); },
    },
  });
  const reports: TaskReport[] = [];
  const probeTarget = vi.fn(() => ({ kind: 'noStand' as const }));
  const probes: RouteProbe[] = [
    { profile: 'style', status: 'noPath', steps: 0, place: 0, breaks: 0, endDist: 48, visited: 5 },
  ];
  let nextId = 0;
  const exec = new Executor({
    getBot: () => bot as never,
    report: report => reports.push(report),
    nextId: () => ++nextId,
    log: { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} } as never,
    // The far destination is outside the loaded scene; only the failed leg can be probed.
    probeRoutes: target => target.x >= 200 ? null : probes,
    probeTarget,
  });
  return { bot, exec, reports, probeTarget };
}

async function untilReport(reports: TaskReport[], count: number) {
  for (let elapsed = 0; reports.length < count && elapsed < 3_000; elapsed += 10) {
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(reports).toHaveLength(count);
}

describe('long travel diagnostic scope', () => {
  it('a failed horizontal leg cannot diagnose occupancy at its synthetic height or condemn the final destination', async () => {
    const { bot, exec, reports, probeTarget } = routeRig();
    const step: SkillCall = { skill: 'goto', at: [250, 104, 0] };
    expect(exec.submitDetailed([step]).accepted).toBe(true);
    await untilReport(reports, 1);
    expect(reports[0].kind).toBe('blocked');
    expect(reports[0].text).toContain('长途最终目标 (250, 104, 0)');
    expect(reports[0].text).toContain('尚未核实最终目标的落脚条件');
    expect(reports[0].text).not.toContain('站不进人');
    expect(probeTarget).not.toHaveBeenCalled();

    // A fresh departure must not inherit an occupancy diagnosis from the failed leg.
    bot.entity.position = new Vec3(-12.5, 70, 0.5);
    expect(exec.submitDetailed([step]).accepted).toBe(true);
    await untilReport(reports, 2);
  });

  it('a local destination with measured no standing space still returns that diagnosis', async () => {
    const { exec, reports } = routeRig();
    expect(exec.submitDetailed([{ skill: 'goto', at: [10, 64, 0] }]).accepted).toBe(true);
    await untilReport(reports, 1);
    expect(reports[0].kind).toBe('blocked');
    expect(reports[0].text).toContain('目标那一格站不进人');
    expect(reports[0].text).not.toContain('尚未核实最终目标');
  });
});
