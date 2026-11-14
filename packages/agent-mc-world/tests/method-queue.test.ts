import {expect,it,vi} from 'vitest';
import {methodHarness,methodEnded} from './method-harness.ts';

it('hands a method group over from an existing body program only when now is explicit',async()=>{
 const r=methodHarness('1.21.1');let cancel=0,entered=false,release!:()=>void;
 try{
  r.exec.enqueueProgram({name:'long journey owner',run:async()=>{entered=true;await new Promise<void>(resolve=>{release=resolve;});},cancel(){cancel++;release?.();}});
  await vi.waitFor(()=>expect(entered).toBe(true));
  const queued=r.runner.start({name:'append remains default',code:'return await mc.do([{skill:"chat",text:"late"}]);'});
  await vi.waitFor(()=>expect(r.exec.status().waiting.length).toBeGreaterThan(0));
  expect(r.said).toEqual([]);expect(cancel).toBe(0);
  r.runner.stop('cancel only pending method');await methodEnded(r,queued.id);expect(cancel).toBe(0);
  const now=r.runner.start({name:'explicit route handoff',code:'return await mc.do([{skill:"chat",text:"handoff confirmed"}],{queue:"now"});'});
  expect(await methodEnded(r,now.id)).toMatchObject({status:'completed',result:{accepted:true,done:true}});
  // Executor cancellation and final cleanup may both invoke idempotent release.
  expect(cancel).toBeGreaterThan(0);expect(r.said).toEqual(['handoff confirmed']);
 }finally{release?.();r.close();}
});

it.each(['{queue:"invented"}','{queue:"now",force:true}','"now"','null'])('rejects invalid queue options %s before any action',async option=>{
 const r=methodHarness('1.21.1');try{
  const run=r.runner.start({name:'invalid handoff',code:`return await mc.do([{skill:"chat",text:"must not send"}],${option});`});
  expect(await methodEnded(r,run.id)).toMatchObject({status:'failed'});expect(r.said).toEqual([]);expect(r.exec.currentTask).toBeNull();
 }finally{r.close();}
});
