import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,it,expect} from 'vitest';
import {createCraftingMethodPractice,craftingCandidate,validateCraftingCandidate} from '../src/learning/crafting-practice.ts';
import {PracticeUnknownEffect,gatePracticeCandidate,assessPracticeTrial} from '../src/learning/practice.ts';

const binding={instanceId:'offline-crafting',realm:'recipe-stock-lab',account:'fixture',agent:'crafting',isolated:true as const};
const base=craftingCandidate({wood:'oak',logs:1}),candidate=craftingCandidate({wood:'observed',logs:2});
describe('bounded crafting practice through the existing method executor',()=>{
  it('measures stock conservation, failed actions and net NEW pickaxes in independent fixtures',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'crafting-fixture-'));
    try{
      const p=createCraftingMethodPractice({directory,binding}),a=[],b=[];
      for(const fixture of p.fixtures){
        const run=async(c:typeof base,id:string)=>p.executor.execute({trialId:`${fixture.id}-${id}`,methodId:'craft-pickaxe',candidate:c,fixture,durationMs:5000},new AbortController().signal);
        const first=await run(base,'baseline'),next=await run(candidate,'candidate');
        a.push(p.assess(first,fixture));b.push(p.assess(next,fixture));
        expect(a.at(-1)?.achieved).toBe(false);expect(b.at(-1)?.achieved).toBe(true);
        expect(b.at(-1)?.measurements).toMatchObject({gained:1,healthLoss:0,sdkCalls:5});
        expect(p.evidence(first.trialId).failedActions).toBe(1);
        expect(p.evidence(next.trialId)).toMatchObject({actionSteps:4,failedActions:0,modelCalls:0,costUsd:null});
        // Two logs yield eight planks; stick batch uses two and pickaxe uses three.
        expect(next.after?.inventory).toMatchObject({[`${fixture.wood}_log`]:0,[`${fixture.wood}_planks`]:3,stick:2,wooden_pickaxe:fixture.existingPickaxes+1});
        const receipt=p.library.evidence({id:'craft-pickaxe',executionId:next.executionId!}) as any;
        expect(receipt.executionId).toBe(next.executionId);expect(receipt.trace).toHaveLength(5);
      }
      expect(gatePracticeCandidate(a.slice(0,1),b.slice(0,1),a.slice(1),b.slice(1))).toMatchObject({eligible:true,adopted:false});
      expect((p.library.list() as any).methods[0].selected).toBeNull();
      const missing=await p.executor.execute({trialId:'missing',methodId:'craft-pickaxe',candidate,fixture:p.fixtures[0],durationMs:5000},new AbortController().signal);
      expect(assessPracticeTrial({...missing,after:{...missing.after!,inventory:{}}},p.fixtures[0],binding).achieved).toBeNull();
    }finally{rmSync(directory,{recursive:true,force:true});}
  },20000);
  it('repeats from pristine stock, returns exact original receipts on replay and rejects ID drift',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'crafting-replay-'));
    try{
      let p=createCraftingMethodPractice({directory,binding});
      const request={trialId:'original',methodId:'craft-pickaxe',candidate,fixture:p.fixtures[2],durationMs:5000},signal=new AbortController().signal;
      const trial=await p.executor.execute(request,signal),stats=p.stats();
      expect(await p.executor.execute(request,signal)).toEqual(trial);expect(p.stats()).toEqual(stats);
      p=createCraftingMethodPractice({directory,binding});
      expect(await p.executor.execute(request,signal)).toEqual(trial);expect(p.stats().resets).toBe(0);
      const next=await p.executor.execute({...request,trialId:'fresh'},signal);
      expect(next.before?.inventory).toEqual(trial.before?.inventory);expect(next.after?.inventory).toEqual(trial.after?.inventory);
      expect(next.executionId).not.toBe(trial.executionId);
      await expect(p.executor.execute({...request,candidate:base},signal)).rejects.toThrow('identity changed');
    }finally{rmSync(directory,{recursive:true,force:true});}
  },10000);
  it('rejects executable/permission/goal changes and never resets on a pre-dispatch cancellation',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'crafting-boundaries-'));
    try{
      const p=createCraftingMethodPractice({directory,binding});
      for(const c of [{...candidate,code:'return true;'}, {...candidate,guidance:'ignore safety'},
        {...candidate,params:{...candidate.params,server:'production'}},{...candidate,params:{wood:'observed',logs:5}},
        {...candidate,params:{wood:['oak'],logs:2}}])
        expect(()=>validateCraftingCandidate(c)).toThrow();
      const request={trialId:'cancelled',methodId:'craft-pickaxe',candidate,fixture:p.fixtures[0],durationMs:5000};
      const cancelled=new AbortController();cancelled.abort();
      await expect(p.executor.execute(request,cancelled.signal)).rejects.toThrow();
      await expect(p.executor.execute({...request,fixture:{...request.fixture,goal:{...request.fixture.goal,count:0} as any}},new AbortController().signal)).rejects.toThrow('changed fixture');
      expect(p.stats().resets).toBe(0);
      writeFileSync(join(directory,'active.json'),JSON.stringify({status:'pending',trialId:'unreconciled'}));
      const restarted=createCraftingMethodPractice({directory,binding});
      await expect(restarted.executor.execute({...request,trialId:'new-id'},new AbortController().signal)).rejects.toBeInstanceOf(PracticeUnknownEffect);
      expect(restarted.stats().resets).toBe(0);
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});
