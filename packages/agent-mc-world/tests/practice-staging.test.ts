import {expect,it} from 'vitest';
import {createPracticeCandidateStager,PracticeStagingError} from '../src/learning/practice-staging.ts';
import {methodHarness,methodEnded} from './method-harness.ts';
const scope={realm:'fixture',account:'agent',agent:'test'};
it('stages through the real script validation/library contract and preserves the old source without body actions or adoption',async()=>{
  const r=methodHarness();
  try{const tool=r.world.tools().find(t=>t.name==='mc_script')!;
    const call=async(args:Record<string,unknown>)=>{const reply=await tool.handler(args,{role:'harness2-practice',log:r.host.log});return typeof reply==='string'?{text:reply}:reply;};
    const code='return await mc.state();';await call({code,validate:true});const run=await methodEnded(r,r.runner.read().at(-1)!.id);
    await call({library:{op:'save',id:'staging-source',code,description:'Observe',conditions:['Loaded world'],parent:null,validationRunId:run.id}});
    const source=JSON.parse((await call({library:{op:'read',id:'staging-source'}})).text);
    const position=r.bot.entity.position.clone();
    const stage=createPracticeCandidateStager({scope:()=>scope,call});
    const staged=await stage({jobId:'fixture-job',jobHash:'a'.repeat(64),scope,source,candidate:{code:'return 1;',params:{},guidance:'Revised source'}},new AbortController().signal);
    expect(staged).toMatchObject({parent:source.revision,staged:true,adopted:false,changedRunningProgram:false,liveOutcomeVerified:false});
    const current=JSON.parse((await call({library:{op:'read',id:source.id}})).text);
    expect(current.parent).toBe(source.revision);expect(current.code).toBe('return 1;');
    expect(JSON.parse((await call({library:{op:'read',id:source.id,revision:source.revision}})).text).code).toBe(code);
    expect(r.bot.entity.position).toEqual(position);
    expect(JSON.parse((await call({library:{op:'list'}})).text).methods[0].selected).toBeNull();
    await expect(stage({jobId:'again',jobHash:'b'.repeat(64),scope,source,candidate:{code:'return 2;',params:{},guidance:''}},new AbortController().signal)).rejects.toMatchObject({writeAttempted:false});
  }finally{r.close();}
});
it('rejects scope changes before touching any library port',async()=>{
  let calls=0;const stage=createPracticeCandidateStager({scope:()=>({...scope,account:'other'}),call:async()=>{calls++;throw Error('should not execute');}});
  await expect(stage({jobId:'x',jobHash:'a'.repeat(64),scope,source:{} as any,candidate:{code:'return 1;',params:{},guidance:''}},new AbortController().signal)).rejects.toMatchObject({message:'Practice staging scope changed',writeAttempted:false});
  expect(calls).toBe(0);
});
