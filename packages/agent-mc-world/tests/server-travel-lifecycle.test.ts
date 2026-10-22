import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import type { TaskReport } from '../core/executor.ts';
import { parseSteps, readSkillHelp, SKILL_STEP_SCHEMA } from '../core/skills.ts';
import { methodHarness } from './method-harness.ts';

const rigs: ReturnType<typeof methodHarness>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const r of rigs.splice(0)) r.close(); vi.useRealTimers(); });
function rig() {
  const r = methodHarness('1.21.1'); rigs.push(r);
  const reports: TaskReport[] = [];
  (r.exec as any).opts.report = (report: TaskReport) => reports.push(report);
  return { ...r, reports };
}
const travel = { skill: 'server_travel' as const, command: '/home', at: [10, 64, 10] as [number, number, number], within: 3 };
const idleBody = { skill: 'control' as const, keys: ['sneak' as const], durationMs: 2000, mode: 'ground' as const };

describe('server travel task lifecycle', () => {
  it.each([
    ['relative current cell', ['~', '~', '~']],
    ['absolute current cell', [0, 64, 0]],
  ])('reports an unsent command when arrival already holds: %s', async (_name, at) => {
    const r = rig();
    const parsed = parseSteps([{ skill: 'server_travel', command: '/example join', at, within: 5 }]);
    if (!('steps' in parsed)) throw new Error(JSON.stringify(parsed));
    const task = r.exec.submitDetailed(parsed.steps, 'append');
    await vi.advanceTimersByTimeAsync(100);
    expect(r.said).toEqual([]);
    const report = r.reports.find(report => report.taskId === task.taskId)!;
    expect(report.kind).toBe('done');
    expect(report.text).toContain('命令未发送');
    expect(report.text).toContain('chat');
  });

  it('exposes command dispatch versus arrival in default schema and on-demand help', () => {
    for (const text of [SKILL_STEP_SCHEMA.description, (readSkillHelp({ skill: 'server_travel' }) as { text: string }).text]) {
      expect(text).toContain('命令未发送');
      expect(text).toContain('chat');
    }
  });

  it.each([undefined, 'minecraft:the_nether'])('owns only its dispatched transition (%s) and continues its following steps', async dimension => {
    const r = rig();
    r.bot.chat = vi.fn(text => {
      r.said.push(text);
      if (text !== '/home') return;
      r.bot.game.dimension = 'the_nether';
      expect(r.exec.cancelForDimensionChange('overworld', 'the_nether')).toContain('正在核验落点');
      // A dimension event alone cannot finish the task before position arrives.
      expect(r.reports.some(report => report.kind === 'done')).toBe(false);
      setTimeout(() => { r.bot.entity.position = new Vec3(10.5, 64, 10.5); }, 100);
    });
    const first = r.exec.submitDetailed([{ ...travel, ...(dimension ? { dimension } : {}) },
      { skill: 'chat', text: 'arrival step' }], 'append');
    const oldWorld = r.exec.submitDetailed([idleBody], 'append');
    await vi.advanceTimersByTimeAsync(500);
    expect(r.reports.filter(report => report.taskId === first.taskId).map(report => report.kind), JSON.stringify(r.reports)).toEqual(['done']);
    expect(r.reports.filter(report => report.taskId === oldWorld.taskId).map(report => report.kind)).toEqual(['cancelled']);
    expect(r.said).toEqual(['/home', 'arrival step']);
    expect(r.exec.status().running).toBeNull();
  });

  it('does not count equal coordinates in a different dimension as an arrival', async () => {
    const r = rig(); r.bot.entity.position = new Vec3(10.5, 64, 10.5);
    r.bot.chat = vi.fn(() => {});
    const task = r.exec.submitDetailed([{ ...travel, dimension: 'the_nether' }], 'append');
    await vi.advanceTimersByTimeAsync(6100);
    expect(r.bot.chat).toHaveBeenCalledWith('/home');
    expect(r.reports.filter(report => report.taskId === task.taskId).map(report => report.kind)).toEqual(['blocked']);
    expect(r.reports[0].text).toContain('6 秒内没有抵达');
  });

  it('never continues destination steps after a travel timeout and releases its transition scope', async () => {
    const r = rig(); r.bot.chat = vi.fn(text => r.said.push(text));
    const task = r.exec.submitDetailed([travel, { skill: 'chat', text: 'must not execute' }], 'append');
    await vi.advanceTimersByTimeAsync(6100);
    expect(r.said).toEqual(['/home']);
    const report = r.reports.find(report => report.taskId === task.taskId)!;
    expect(report.kind).toBe('blocked'); expect(report.steps?.[1].outcome).toBe('skip');
    const next = r.exec.submitDetailed([idleBody], 'append');
    await vi.advanceTimersByTimeAsync(100);
    r.exec.cancelForDimensionChange('overworld', 'the_nether');
    await vi.advanceTimersByTimeAsync(500);
    expect(r.reports.find(report => report.taskId === next.taskId)?.kind).toBe('cancelled');
  });

  it('still cancels a transition to a dimension that the travel did not request', async () => {
    const r = rig();
    r.bot.chat = vi.fn(() => {
      r.bot.game.dimension = 'the_end';
      r.exec.cancelForDimensionChange('overworld', 'the_end');
      r.bot.entity.position = new Vec3(10.5, 64, 10.5);
    });
    const task = r.exec.submitDetailed([{ ...travel, dimension: 'the_nether' }], 'append');
    await vi.advanceTimersByTimeAsync(500);
    expect(r.reports.filter(report => report.taskId === task.taskId).map(report => report.kind)).toEqual(['cancelled']);
  });

  it('does not exempt a queued travel step or an unrelated active task', async () => {
    const r = rig();
    const active = r.exec.submitDetailed([idleBody], 'append');
    const queued = r.exec.submitDetailed([travel], 'append');
    await vi.advanceTimersByTimeAsync(20);
    r.exec.cancelForDimensionChange('overworld', 'the_nether');
    await vi.advanceTimersByTimeAsync(500);
    expect(r.reports.filter(report => [active.taskId, queued.taskId].includes(report.taskId)).map(report => report.kind)).toEqual(['cancelled', 'cancelled']);
    expect(r.said).toEqual([]);
  });

  it('revokes the transition scope before the following step', async () => {
    const r = rig();
    r.bot.chat = vi.fn(() => {
      r.bot.game.dimension = 'the_nether';
      r.exec.cancelForDimensionChange('overworld', 'the_nether');
      r.bot.entity.position = new Vec3(10.5, 64, 10.5);
    });
    const task = r.exec.submitDetailed([travel, idleBody], 'append');
    await vi.advanceTimersByTimeAsync(100);
    expect(r.exec.status().running?.stepIndex).toBe(1);
    r.exec.cancelForDimensionChange('the_nether', 'overworld');
    await vi.advanceTimersByTimeAsync(500);
    expect(r.reports.filter(report => report.taskId === task.taskId).map(report => report.kind)).toEqual(['cancelled']);
  });

  it('publishes the optional destination through the same parser and help contract', () => {
    expect(parseSteps([{ ...travel, dimension: 'the_nether' }])).toMatchObject({ steps: [{ ...travel, dimension: 'the_nether' }] });
    expect(readSkillHelp({ skill: 'server_travel' })).toHaveProperty('text', expect.stringContaining('落点维度'));
  });
});
