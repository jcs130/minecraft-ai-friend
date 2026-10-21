import { describe, expect, it } from 'vitest';
import { methodEnded, methodHarness } from './method-harness.ts';
import { prepareWorkRoutine } from '../core/work-routines.ts';
import { classifyWake, WAKE_ACTIVE_GOAL } from '../src/client/context-budget.ts';

describe('work method event scheduling',()=>{
  it('archives complete substep receipts without a per-cell model wake and still flushes danger and final results',async()=>{
    const r=methodHarness();
    try {
      const chat=r.bot.chat.bind(r.bot);
      r.bot.chat=text=>{
        chat(text);
        if(text==='first') (r.world as any).onTaskReport({kind:'reflex',text:'test environmental danger',hurt:true});
      };
      const request=prepareWorkRoutine('restock',{dimension:'overworld',chest:[1,64,0],items:[{item:'bread',count:1}]});
      // Use harmless chat substeps to exercise the actual executor/report path without a server.
      const run=r.runner.start({...request,code:`
        await mc.do([{skill:'chat',text:'first'}]);
        await mc.do([{skill:'chat',text:'second'}]);
        return {schema:'agent-mc.work/v1',outcome:'completed',goalCompleted:true,remaining:[],inventoryDelta:{}};`});
      expect((await methodEnded(r,run.id)).status).toBe('completed');
      const delivered=r.host.events.map((event,i)=>({event,options:r.host.pushOpts[i]}));
      const substeps=delivered.filter(row=>row.event.type==='minecraft.task'&&row.event.execution?.kind==='task');
      expect(substeps).toHaveLength(2);
      expect(substeps.every(row=>row.options?.trigger==='piggyback')).toBe(true);
      expect(substeps.every(row=>!classifyWake({...row.event,trigger:row.options?.trigger}, {wakeOn:WAKE_ACTIVE_GOAL}).wake)).toBe(true);
      expect(substeps.every(row=>row.event.execution?.terminal&&row.event.execution.evidence)).toBe(true);
      expect(delivered.find(row=>row.event.text==='test environmental danger')?.options?.trigger).toBe('flush');
      const terminal=delivered.find(row=>row.event.type==='minecraft.method');
      expect(terminal?.options?.trigger).toBe('flush');
      expect(classifyWake({...terminal!.event,trigger:terminal!.options?.trigger}, {wakeOn:WAKE_ACTIVE_GOAL}))
        .toEqual({wake:true,category:'task'});
      expect(classifyWake({...terminal!.event,trigger:terminal!.options?.trigger}).wake).toBe(false);
      expect(terminal?.event.meta).toMatchObject({work:{goalCompleted:true,outcome:'completed'}});
      expect(terminal?.event.blobs?.some(blob=>blob.name==='work-run.json')).toBe(true);
    } finally {r.close();}
  });

  it('does not change task wake policy for an ordinary agent-authored script',async()=>{
    const r=methodHarness();
    try {
      const run=r.runner.start({name:'ordinary script',code:`await mc.do([{skill:'chat',text:'normal task'}]);`});
      expect((await methodEnded(r,run.id)).status).toBe('completed');
      const index=r.host.events.findIndex(event=>event.type==='minecraft.task'&&event.execution?.kind==='task');
      expect(index).toBeGreaterThanOrEqual(0);expect(r.host.pushOpts[index]?.trigger).toBe('flush');
    } finally {r.close();}
  });
});
