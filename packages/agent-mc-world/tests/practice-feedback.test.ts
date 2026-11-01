import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {summarizePracticeTrace} from '../src/learning/practice-feedback.ts';
import {createCraftingMethodPractice,craftingCandidate} from '../src/learning/crafting-practice.ts';

describe('measured feedback sent to the optimizer',()=>{
  it('uses original per-step reasons, distinguishes requested steps from failed groups and ignores narrative success',()=>{
    const feedback=summarizePracticeTrace([
      {call:1,method:'inventory.items',result:[{name:'oak_log',count:2}]},
      {call:2,method:'do',args:{steps:[{skill:'craft'},{skill:'craft'}]},result:{done:false,steps:[
        {step:1,outcome:'ok'},{step:2,outcome:'fail',why:'Missing planks',detail:{text:'private long detail'}}]}},
      {call:3,method:'do',args:{steps:[{skill:'craft'}]},result:{done:false,kind:'rejected',receipt:'Workbench unavailable'}},
      {call:4,method:'read',error:'Observation unavailable'},
    ]);
    expect(feedback).toMatchObject({actionSteps:3,failedActions:2,truncated:false,failures:[
      {call:2,step:2,skill:'craft',outcome:'fail',why:'Missing planks'},
      {call:3,step:null,outcome:'rejected',why:'Workbench unavailable'},
      {call:4,outcome:'sdk-error',why:'Observation unavailable'},
    ]});
    expect(summarizePracticeTrace([{call:1,method:'do',args:{steps:[{}]},result:{done:false,success:true}}]).failedActions).toBe(1);
  });
  it('keeps real core sandbox failure feedback alongside independent before/after inventory',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'practice-feedback-'));
    try{
      const p=createCraftingMethodPractice({directory,binding:{instanceId:'lab',realm:'lab',account:'fixture',agent:'test',isolated:true}});
      const trial=await p.executor.execute({trialId:'failure-feedback',methodId:'pickaxe',candidate:craftingCandidate({wood:'oak',logs:1}),fixture:p.fixtures[0],durationMs:5000},new AbortController().signal);
      expect(trial.feedback?.failedActions).toBe(1);expect(trial.feedback?.actionSteps).toBeGreaterThan(0);
      expect(trial.feedback?.failures.length).toBeGreaterThan(0);expect(trial.executionId).toBeTruthy();
      expect(trial.before?.inventory?.wooden_pickaxe).toBe(0);expect(trial.after?.inventory?.wooden_pickaxe).toBe(0);
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
  it('bounds hostile game reason text while marking omitted detail',()=>{
    const trace=Array.from({length:30},(_,call)=>({call,method:'do',args:{steps:[{}]},result:{done:false,receipt:'x'.repeat(1000)}}));
    const feedback=summarizePracticeTrace(trace);expect(feedback.failures).toHaveLength(16);
    expect(feedback.failedActions).toBe(30);expect(feedback.truncated).toBe(true);expect(feedback.failures[0].why).toHaveLength(400);
  });
});
