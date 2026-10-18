import { afterEach, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import type { TaskReport } from '../core/executor.ts';

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const r of rigs.splice(0)) r.close(); vi.useRealTimers(); });
function rig() { const r = methodHarness('1.21.1'); rigs.push(r); return r; }
const receipt = '任务#218没做成：脚前缺支撑\n[现场历史] ' + '旧位置、旧背包。'.repeat(100);
function report(r: ReturnType<typeof rig>, id = 218) {
  (r.world as any).onTaskReport({ kind: 'blocked', taskId: id, text: receipt,
    steps: [{ step: 1, outcome: 'fail', why: '脚前缺支撑，尚未抵达' }] } satisfies TaskReport);
}
const textOf = (value: unknown): string => typeof value === 'string' ? value : String((value as any).text);

it('keeps current work prominent without repeating a full old failure; recalls its exact evidence by id', async () => {
  vi.useFakeTimers(); const r = rig(); report(r);
  r.exec.submitDetailed([{ skill: 'control', keys: ['sneak'], durationMs: 2000, mode: 'ground' }], 'append');
  await vi.advanceTimersByTimeAsync(1);
  const queue = r.world.tools().find(tool => tool.name === 'mc_queue')!;
  const ctx = { role: 'test', log: r.host.log, round: 1 };
  const compact = textOf(await queue.handler({}, ctx));
  expect(compact).toContain('[队列]'); expect(compact).toContain('任务#218');
  expect(compact).toContain('历史终态'); expect(compact).toContain('脚前缺支撑');
  expect(compact).not.toContain('旧位置、旧背包。'.repeat(4));
  expect(compact.length).toBeLessThan(receipt.length / 2);
  // Expansion in the same turn must not be mistaken for the same query.
  const full = textOf(await queue.handler({ taskId: 218 }, ctx));
  expect(full).toContain(receipt);
  expect(textOf(await queue.handler({ detail: 'full' }, ctx))).toContain(receipt);
  expect(r.exec.status().running).not.toBeNull();
});

it('can recall an earlier failure after a later task finishes, without replacing the latest terminal', async () => {
  const r = rig(); report(r);
  (r.world as any).onTaskReport({ kind: 'done', taskId: 219, text: '任务#219实际抵达' });
  const read = (args: Record<string, unknown> = {}) => (r.world as any).queueReadout(args).text;
  expect(read()).toContain('任务#219'); expect(read()).not.toContain('任务#218');
  expect(read({ taskId: 218 })).toContain(receipt);
  expect(read({ taskId: 999 })).toContain('尚无终态或已超出');
  expect(read({ taskId: '218' })).toContain('必须是正整数');
  expect(read()).toContain('任务#219');
});

it('bounds historical receipt retention and never invents outcomes for an evicted task', () => {
  const r = rig();
  for (let id = 1; id <= 65; id++) report(r, id);
  expect((r.world as any).taskReadouts.size).toBe(64);
  expect((r.world as any).queueReadout({ taskId: 1 }).text).toContain('不能据此判定成功或失败');
  expect((r.world as any).queueReadout({ taskId: 2 }).text).toContain(receipt);
});
