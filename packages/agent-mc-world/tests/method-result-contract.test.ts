import { describe, expect, it } from 'vitest';
import { methodHarness, methodEnded } from './method-harness.ts';

describe('program task result evidence', () => {
  it('runs the live Mindcraft code shape under action ownership while keeping standalone documentation read-only',async()=>{
    const r=methodHarness('1.21.1');
    try{
      const tool=r.world.tools().find(t=>t.name==='mc_script')!;
      const args={api:'mindcraft',name:'note_origin',params:{},durationMs:10000,waitMs:5000,code:'const self=bot.entity; const p=self.position; if (!Object.isFrozen(self)) throw Error("mutable entity"); return {x:p.x,y:p.y,z:p.z};'};
      expect(tool.readOnlyCall?.({api:'mindcraft'})).toBe(true);
      expect(tool.readOnlyCall?.(args)).toBe(false);
      expect(tool.learningCall?.(args)).toBe(false);
      const out=await tool.handler(args,{role:'main',log:r.host.log});
      expect(out).toMatchObject({execution:{kind:'method',phase:'completed',terminal:true}});
      const id=(out as any).execution.evidence.localId;
      expect(r.runner.read(id)[0].result).toMatchObject({x:expect.any(Number),y:expect.any(Number),z:expect.any(Number)});
      for(const mix of [{api:'index'}, {stop:true},{find:{names:['stone']}},{routine:{op:'list'}}]){
        expect(await tool.handler({...args,...mix},{role:'main',log:r.host.log})).toMatchObject({failed:true});
      }
    }finally{r.close();}
  });
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
      expect(expanded.trace.result.steps).toMatchObject(summary.trace[1].steps);
      expect(expanded.trace.result.steps[0]).toMatchObject({ detail: { text: expect.stringContaining('石头'), truncated: false } });
      expect(summary.trace[1].steps[0]).toMatchObject({detail:{text:expect.stringContaining('石头'),truncated:false}});
      expect(expanded.trace.result.receipt).toContain('石头');
    } finally { r.close(); }
  });

  it('keeps an unsent travel command visible to the program and its compact inspection', async () => {
    const r=methodHarness('1.21.1');
    try {
      const run=r.runner.start({code:`return await mc.do([{skill:'server_travel',command:'/example inventory list',at:[0,64,0],within:16}]);`});
      const result=await methodEnded(r,run.id);
      expect(result).toMatchObject({status:'completed',result:{steps:[{outcome:'ok',detail:{text:expect.stringContaining('命令未发送')}}]}});
      expect(r.runner.inspect(run.id)).toMatchObject({trace:[{steps:[{detail:{text:expect.stringContaining('chat.text')}}]}]});
      expect(r.said).toEqual([]);
    }finally{r.close();}
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
