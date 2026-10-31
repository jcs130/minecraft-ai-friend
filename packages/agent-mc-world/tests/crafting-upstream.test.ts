/** Opt-in real Google optimizer. Model proposals remain an explicitly scripted fixture. */
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {Harness2Runner} from '../src/decisions/harness2.ts';
import {createCraftingMethodPractice,craftingCandidate} from '../src/learning/crafting-practice.ts';
const worker=process.env.HARNESS2_TEST_WORKER;
describe.skipIf(!worker)('real pinned Google optimizer + stock crafting fixture',()=>{
  it('keeps held-out inputs private, retains original results and resumes without effects',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'crafting-google-'));
    try{
      const p=createCraftingMethodPractice({directory:join(directory,'practice'),binding:{instanceId:'crafting-lab',realm:'stock-lab',account:'fixture',agent:'fixture',isolated:true}});
      let calls=0;
      const model={id:'scripted-crafting-test/v1',generate:async(request:any)=>{
        calls++;expect(JSON.stringify(request)).not.toMatch(/holdout-birch|holdout-spruce-existing/);
        if(request.stage.startsWith('experience.'))return {};
        return {files:{'skills/minecraft-method/scripts/params.json':'{"wood":"observed","logs":2}'}};
      }};
      const job={id:'crafting-google',methodId:'pickaxe',sourceInstanceId:'reference-only',scope:{realm:'reference',account:'fixture',agent:'fixture'},
        task:'Acquire one new wooden_pickaxe at an existing workbench. Edit only params.json wood and logs. Immutable driver; deterministic stock fixture, not a live server.',
        baseline:craftingCandidate({wood:'oak',logs:1}),train:p.fixtures[0],holdout:p.fixtures.slice(1),mode:'parallel' as const,k:1,
        budget:{modelCalls:6,trials:8,wallMs:120000,trialMs:5000,contextBytes:600000}};
      const runner=new Harness2Runner({directory:join(directory,'jobs'),worker:JSON.parse(worker!),model,practice:p.executor});
      const result=await runner.run(job),stats=p.stats();
      expect(result.gate).toMatchObject({eligible:true,adopted:false});expect(result.trials).toBe(8);expect(calls).toBe(4);
      expect(result.train.baseline.achieved).toBe(false);expect(result.holdout.every(p=>p.candidate.achieved===true)).toBe(true);
      for(const id of result.evidenceRefs){const e=p.evidence(id);expect(e.trial.executionId).toBeTruthy();expect(e.costUsd).toBeNull();}
      expect(await runner.run(job)).toEqual(result);expect(p.stats()).toEqual(stats);expect(calls).toBe(4);
      expect(JSON.stringify((p.library.list() as any).methods)).toContain('"selected":null');
    }finally{rmSync(directory,{recursive:true,force:true});}
  },120000);
});
