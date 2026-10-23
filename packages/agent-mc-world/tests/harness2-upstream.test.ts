/** Explicit integration against the installed, pinned upstream; never invokes a game LLM. */
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,it,expect} from 'vitest';
import {Harness2Runner,HARNESS2_REVISION,type Harness2Job,type Harness2ModelRequest} from '../src/decisions/harness2.ts';
import {physicsPractice,STEP_CODE} from './harness2-fixture.ts';

const configured=process.env.HARNESS2_TEST_WORKER;
describe.skipIf(!configured)('pinned Google Harness2 + core physics integration',()=>{
  it('executes propose/probe/compose, independently gates, reflects and resumes, in both recursion modes',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'harness2-upstream-'));
    const summaries:any[]=[];
    try{
      const worker=JSON.parse(configured!);
      for(const mode of ['parallel','sequential'] as const){
        const p=physicsPractice(join(directory,mode,'methods'));let modelCalls=0,remembered=0;
        const stages:string[]=[];let rejectedOnce=false;
        const model={id:'deterministic-game-patch-fixture',generate:async(request:Harness2ModelRequest)=>{
          modelCalls++;stages.push(request.stage);
          if(request.stage.startsWith('select.'))return{choice:Object.keys(request.files).find(n=>/^candidates\/[A-Z]+\.md$/.test(n))!.split('/')[1].split('.')[0]};
          if(request.stage.startsWith('experience.'))return{experience:{cue:'Walking to a public target on supported flat ground',lesson:'Read the target, steer from measured position, release keys in finally.',evidence:'Measured practice positions reached the target while the read-only baseline stayed still.',confidence:'Limited to the supplied isolated flat-grid fixtures'}};
          if(!rejectedOnce){
            rejectedOnce=true;
            return mode==='parallel'?{files:{'skills/minecraft-method/scripts/params.json':'INVALID JSON'}}:{files:{'guardrails.md':'Must never be written'}};
          }
          return{files:{'skills/minecraft-method/scripts/run.js':STEP_CODE,'skills/minecraft-method/scripts/params.json':'{}',
            'skills/minecraft-method/SKILL.md':'---\nname: minecraft-method\ndescription: Agent-revised measured target walking\n---\nRead actual position and release keys in finally; flat practice only.'}};
        }};
        const job:Harness2Job={id:`upstream-${mode}`,methodId:`upstream-${mode}`,sourceInstanceId:'cormy-production',scope:{realm:'live',account:'Cormy',agent:'cormy'},
          task:'Walk to mc.state().target. The snapshot.position is observed. Use await bot.look(yaw,pitch), setControlState, waitForTicks and clearControlStates; Java 1.21.1 flat supported practice terrain.',
          baseline:{code:'return (await mc.state()).snapshot.position;',params:{},guidance:'A bounded method; release keys when finished.'},train:p.fixtures[0],holdout:[p.fixtures[1]],mode,k:2,
          budget:{modelCalls:12,trials:10,wallMs:180000,trialMs:10000,contextBytes:600000}};
        const runner=new Harness2Runner({directory:join(directory,mode),worker,model,practice:p.executor,remember:async()=>{remembered++;}});
        const started=new Date().toISOString(),result=await runner.run(job);
        expect(result.upstreamRevision).toBe(HARNESS2_REVISION);expect(result.gate).toMatchObject({eligible:true,adopted:false});
        expect(result.trials).toBe(10);expect(modelCalls).toBe(9);expect(remembered).toBe(1);expect(result.experience?.lesson).toContain('measured position');
        expect(stages.some(s=>s.endsWith('.a2'))).toBe(true);
        expect(stages.some(s=>s.startsWith('experience.'))).toBe(true);expect(stages.some(s=>s.startsWith('select.'))).toBe(true);
        const before=p.stats();expect(await runner.run(job)).toEqual(result);expect(p.stats()).toEqual(before);expect(modelCalls).toBe(9);
        const methods=p.library.list() as any;expect(methods.methods[0].selected).toBeNull();
        summaries.push({started,ended:new Date().toISOString(),mode,realModelApiCalls:0,scriptedHostModelCalls:modelCalls,stats:p.stats(),result});
      }
      if(process.env.HARNESS2_TEST_REPORT){
        const path=process.env.HARNESS2_TEST_REPORT;mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,JSON.stringify({upstreamRevision:HARNESS2_REVISION,summaries},null,2));
      }
    }finally{rmSync(directory,{recursive:true,force:true});}
  },400000);
});
