import { describe, expect, it } from 'vitest';
import { methodHarness, methodEnded } from './method-harness.ts';

describe('program task result evidence', () => {
  it('distinguishes a completed operation from its unmet world postcondition through the real executor', async () => {
    const r = methodHarness();
    try {
      r.set(1, 64, 0, 'stone');
      const tool = r.world.tools().find(t => t.name === 'mc_script')!;
      const help = await tool.handler({ api: 'mc.do' }, { role: 'main', log: r.host.log });
      expect(help).toContain('outcome,why');
      const run = r.runner.start({ name: 'operation-versus-goal', code: `
        const dispatched = await mc.do([{skill:'chat',text:'/custom-operation'}]);
        const checked = await mc.do([{skill:'chat',text:'/checked-operation',expect:{block:'torch',at:[1,64,0]}}]);
        return {dispatched,checked};` });
      const result = await methodEnded(r, run.id);
      const checked = (result.result as { checked: { accepted: boolean; receipt: string } }).checked;
      expect(checked.accepted, checked.receipt).toBe(true);
      expect(result).toMatchObject({ status: 'completed', result: {
        dispatched: { accepted: true, done: true, kind: 'done', steps: [{ step: 1, outcome: 'ok', why: null }] },
        checked: { accepted: true, done: false, kind: 'blocked', steps: [{ step: 1, outcome: 'fail', why: expect.any(String) }] },
      } });
      expect(r.said).toEqual(['/custom-operation', '/checked-operation']);
      const summary = r.runner.inspect(run.id) as { trace: Array<{ steps: unknown[] }> };
      expect(summary.trace.map(t => t.steps)).toMatchObject([
        [{ step: 1, outcome: 'ok', why: null }],
        [{ step: 1, outcome: 'fail', why: expect.any(String) }],
      ]);
      const expanded = r.runner.inspect(run.id, 2) as { trace: { result: { steps: unknown[]; receipt: string } } };
      expect(expanded.trace.result.steps).toEqual(summary.trace[1].steps);
      expect(expanded.trace.result.receipt).toContain('石头');
    } finally { r.close(); }
  });

  it('keeps long per-step summaries bounded while retaining the full call for inspection', async () => {
    const r = methodHarness();
    try {
      const run = r.runner.start({ name: 'long-group', code: `
        return await mc.do(Array.from({length:10},(_,i)=>({skill:'chat',text:'step '+i})));` });
      expect((await methodEnded(r, run.id)).status).toBe('completed');
      expect(r.runner.inspect(run.id)).toMatchObject({ trace: [{ stepCount: 10, stepsTruncated: true,
        steps: Array.from({length:8},(_,i)=>({step:i+1,outcome:'ok',why:null})) }] });
      const expanded = r.runner.inspect(run.id, 1) as { trace: { result: { steps: unknown[] } } };
      expect(expanded.trace.result.steps).toHaveLength(10);
    } finally { r.close(); }
  });
});
