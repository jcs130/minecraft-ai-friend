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

it('explains that replacing pending work leaves a running action intact, and verifies explicit preemption',async()=>{
  vi.useFakeTimers();const r=rig();
  const first=r.exec.submitDetailed([{skill:'control',keys:['sneak'],durationMs:2000,mode:'ground'}],'append');
  await vi.advanceTimersByTimeAsync(1);
  const waiting=r.exec.submitDetailed([{skill:'chat',text:'after motion'}],'replace');
  expect(waiting.receipt).toContain(`当前任务#${first.taskId}仍会继续`);
  expect(waiting.receipt).toContain('queue:"now"');
  expect(r.said).toEqual([]);
  const immediate=r.exec.submitDetailed([{skill:'chat',text:'explicit takeover'}],'now');
  await vi.advanceTimersByTimeAsync(100);
  expect(immediate.receipt).not.toContain('仍会继续');
  expect(r.said).toEqual(['explicit takeover','after motion']);
});

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

it('keeps successful-step limitations in both compact queue forms without replaying the command',async()=>{
  vi.useFakeTimers();const r=rig();
  r.exec.submitDetailed([
    {skill:'server_travel',command:'/example list',at:[0,64,0],within:16},
    {skill:'server_travel',command:'/example stash',at:[0,64,0],within:16},
  ],'append');
  await vi.advanceTimersByTimeAsync(100);
  const queue=r.world.tools().find(t=>t.name==='mc_queue')!;
  const result=await queue.handler({},{role:'test',log:r.host.log,round:1}) as any;
  expect(result.text).toContain('命令未发送');
  expect(result.data.last.evidence.steps).toMatchObject([
    {detail:{text:expect.stringContaining('chat.text')}},
    {detail:{text:expect.stringContaining('chat.text')}},
  ]);
  expect(result.data.goalCompleted).toBe(false);expect(r.said).toEqual([]);
});

it('exposes historical native failure/effect evidence independently of task prose and sampling clocks',async()=>{
  const r=rig();(r.world as any).onTaskReport({kind:'blocked',taskId:300,text:'details '.repeat(1000),steps:[{step:1,outcome:'fail',why:'permission denied',
    decision:{status:'blocked',reason:'protection-denied',completed:0,remaining:1,unit:'cells',retryable:false,retry_after:null,continue_when:null,next_safe_read:{tool:'mc_queue',arguments:{}}},
    observedEffect:{schema:'agent-mc-observed-effect/v1',status:'unchanged',changed:{position:false,inventory:false,target:null,window:false},before:{at:'old',target:null,inventory:null,position:[1,2,3]},after:{at:'new',target:null,inventory:null,position:[1,2,3]},skill:'tunnel',dimension:'minecraft:overworld',at:null,coverage:'client-visible-only',goalVerified:false}}]});
  const queue=r.world.tools().find(t=>t.name==='mc_queue')!;const result=await queue.handler({taskId:300},{role:'test',log:r.host.log,round:3}) as any;
  expect(result.data.protocol).toBe('agent-mc/task-queue-read/v1');expect(result.data.goalCompleted).toBe(false);
  expect(result.data.last.historical).toBe(true);expect(result.data.last.evidence.steps[0]).toMatchObject({decision:{status:'blocked'},observedEffect:{status:'unchanged',changed:{position:false,inventory:false}}});
  expect(result.text).toContain('[任务读数结构]');expect(result.text).toContain('permission denied');
});
