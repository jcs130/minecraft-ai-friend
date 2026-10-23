import {mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,it,expect} from 'vitest';
import {assessPracticeTrial,gatePracticeCandidate,MethodPracticeExecutor,PracticeUnknownEffect,type PracticeTrial} from '../src/learning/practice.ts';
import {Harness2Runner,type Harness2Job} from '../src/decisions/harness2.ts';
import {createHarness2Monitor} from '../src/decisions/harness2-monitor.ts';
import {physicsPractice,STEP_CODE} from './harness2-fixture.ts';
import {procedureHash} from '../core/support/procedure.ts';
import {GameMemoryBook} from '../core/game-memory.ts';
import {createPracticeGameMemory} from '../src/learning/practice-memory.ts';

const fresh=()=>mkdtempSync(join(tmpdir(),'mc-harness2-'));
describe('isolated method practice',()=>{
  it('measures actual collision physics, retains failures, versions and exact receipts, without selecting a live skill',async()=>{
    const dir=fresh();
    try{
      const p=physicsPractice(dir),signal=new AbortController().signal;
      const run=async(code:string,fixture=p.fixtures[0])=>p.executor.execute({trialId:procedureHash({code,fixture}),methodId:'practice-walk',candidate:{code,params:{},guidance:'Bounded walking'},fixture,durationMs:10000},signal);
      const base=await run('return 42;');
      const candidate=await run(STEP_CODE);
      const a=assessPracticeTrial(base,p.fixtures[0],p.executor.binding),b=assessPracticeTrial(candidate,p.fixtures[0],p.executor.binding);
      expect(a.achieved).toBe(false);expect(b.achieved,JSON.stringify(b)).toBe(true);
      const holdout=await run(STEP_CODE,p.fixtures[1]);
      expect(assessPracticeTrial(holdout,p.fixtures[1],p.executor.binding).achieved).toBe(true);
      const listing=p.library.list() as any;
      expect(listing.methods[0].selected).toBeNull();expect(listing.methods[0].latestReview.outcome).toBe('achieved');
      expect(p.library.evidence({id:'practice-walk',executionId:base.executionId})).toMatchObject({root:base.reference,status:'completed'});
      expect(p.library.evidence({id:'practice-walk',reviewId:base.reviewId})).toMatchObject({outcome:'not-achieved'});
      expect(p.stats().ticks).toBeGreaterThan(20);expect(p.stats().heldKeys).toBe(0);
      expect(holdout.reference).toEqual(candidate.reference);
    }finally{rmSync(dir,{recursive:true,force:true});}
  },20000);
  it('keeps stale, mismatched and absent measurements unknown; completion alone cannot pass',async()=>{
    const dir=fresh();try{
      const p=physicsPractice(dir),fixture=p.fixtures[0];
      const trial=await p.executor.execute({trialId:'base',methodId:'practice-read',candidate:{code:'return true;',params:{},guidance:''},fixture,durationMs:3000},new AbortController().signal);
      const check=(edit:Partial<PracticeTrial>)=>assessPracticeTrial({...structuredClone(trial),...edit},fixture,p.executor.binding);
      expect(check({after:null}).achieved).toBeNull();
      expect(check({after:{...trial.after!,health:null}}).achieved).toBeNull();
      expect(check({after:{...trial.after!,at:trial.endedAt-10000}}).reason).toBe('stale-observation');
      expect(check({after:{...trial.after!,snapshotId:'another'}}).reason).toBe('binding-mismatch');
      expect(check({executionId:null}).achieved).toBeNull();
      const missing=assessPracticeTrial({...trial,before:{...trial.before!,inventory:{}},after:{...trial.after!,inventory:{}}},
        {...fixture,goal:{kind:'inventory-gain',item:'bread',count:1,maxHealthLoss:0}},p.executor.binding);
      expect(missing.measurements.gained).toBeNull();expect(missing.achieved).toBeNull();
    }finally{rmSync(dir,{recursive:true,force:true});}
  },10000);
  it('blocks another trial after unknown cleanup, even if the method returned',async()=>{
    const dir=fresh();try{
      const p=physicsPractice(dir);let calls=0;
      const executor=new MethodPracticeExecutor({binding:p.executor.binding,library:p.library,host:{call:()=>{calls++;return null;}},
        reset:async()=>{},observe:async f=>({at:Date.now(),instanceId:p.executor.binding.instanceId,snapshotId:f.snapshotId,environmentVersion:f.environmentVersion,dimension:null,position:null,health:20,inventory:null}),settle:async()=> 'unknown'});
      const request={trialId:'unknown',methodId:'practice-unknown',candidate:{code:'await mc.state();',params:{},guidance:''},fixture:p.fixtures[0],durationMs:3000};
      await expect(executor.execute(request,new AbortController().signal)).rejects.toBeInstanceOf(PracticeUnknownEffect);
      const count=calls;await expect(executor.execute({...request,trialId:'another'},new AbortController().signal)).rejects.toBeInstanceOf(PracticeUnknownEffect);expect(calls).toBe(count);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('requires measured improvement over the original and a successful independent fixture',()=>{
    const a=(achieved:boolean|null)=>({achieved,reason:'measured' as const,measurements:{distance:null,gained:null,healthLoss:null,elapsedMs:null}});
    expect(gatePracticeCandidate([a(false)],[a(true)],[a(false)],[a(true)])).toMatchObject({eligible:true,adopted:false});
    expect(gatePracticeCandidate([a(true)],[a(true)],[a(true)],[a(true)]).eligible).toBe(false);
    expect(gatePracticeCandidate([a(false)],[a(true)],[a(false)],[a(false)]).eligible).toBe(false);
    expect(gatePracticeCandidate([a(false)],[a(true)],[a(null)],[a(true)]).reason).toBe('incomplete-evidence');
  });
});

/** A local protocol fixture, not a reimplementation or test of Google's optimizer. */
function fakeWorker(directory:string){
  const file=join(directory,'worker.mjs');
  writeFileSync(file,`import{createInterface}from'node:readline';const rl=createInterface({input:process.stdin});let init,id=0,waiting=new Map();
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');const rpc=(op,value)=>new Promise(r=>{waiting.set(++id,r);send({type:'rpc',id,op,...value});});
rl.on('line',async line=>{const v=JSON.parse(line);if(init){waiting.get(v.id)?.(v.value);waiting.delete(v.id);return;}init=v;
const runId='minecraft-oc-agg1/'+v.job.id+'/base1';const base=await rpc('trial',{runId,candidate:v.job.baseline});
await rpc('trial',{runId,candidate:v.job.baseline});
const reply=await rpc('model',{label:'inv1.a1',mission:'Only game metadata',files:{'task.md':v.job.task}});
const candidate={...v.job.baseline,code:reply.files['skills/minecraft-method/scripts/run.js']};
const chosenRunId='minecraft-oc-agg1/'+v.job.id+'/agg1';await rpc('trial',{runId:chosenRunId,candidate});
send({type:'done',result:{upstreamRevision:v.revision,candidate,selectedRunId:chosenRunId}});rl.close();});`);
  return file;
}
export function fixtureJob(fixtures:ReturnType<typeof physicsPractice>['fixtures']):Harness2Job{
  return{id:'walk-experiment',methodId:'harness-walk',sourceInstanceId:'cormy-production',scope:{realm:'live-server',account:'Cormy',agent:'cormy'},
    task:'Reach the public target from mc.state().target on a loaded flat grid. Release held keys. Use the supplied bot primitives.',
    baseline:{code:'return 42;',params:{},guidance:'Bounded walking'},train:fixtures[0],holdout:[fixtures[1]],mode:'parallel',k:1,
    budget:{modelCalls:10,trials:6,wallMs:60000,trialMs:10000,contextBytes:300000}};
}
describe('host bridge lifecycle',()=>{
  it('runs an injected model through the real method port, journals metadata, and resumes without effects or model calls',async()=>{
    const dir=fresh();try{
      const p=physicsPractice(join(dir,'methods'));let calls=0,memories=0;
      const options={directory:dir,worker:{command:process.execPath,script:fakeWorker(dir),workspace:dir},practice:p.executor,
        model:{id:'fixture',generate:async()=>{calls++;return{files:{'skills/minecraft-method/scripts/run.js':STEP_CODE}};}},remember:async()=>{memories++;}};
      const job=fixtureJob(p.fixtures),runner=new Harness2Runner(options),result=await runner.run(job);
      expect(result.gate).toMatchObject({eligible:true,adopted:false});expect(result.trials).toBe(4);expect(calls).toBe(1);expect(memories).toBe(1);
      const before=p.stats();expect(await new Harness2Runner(options).run(job)).toEqual(result);expect(p.stats()).toEqual(before);expect(calls).toBe(1);
      const journal=readFileSync(join(dir,job.id,'journal.json'),'utf8');
      expect(JSON.parse(journal).status).toBe('completed');expect(journal).not.toContain('Only game metadata');
      const view=createHarness2Monitor({directory:dir,jobs:[job]}).snapshot().jobs[0];
      expect(view).toMatchObject({status:'completed',phase:'settled',memory:'stored',modelCalls:1,trials:4,
        result:{eligible:true,adopted:false},usage:{inputTokens:null,outputTokens:null,cachedTokens:null}});
      expect(view.timeline.filter(t=>t.role==='baseline')).toHaveLength(2);
      expect(view.timeline.filter(t=>t.group==='holdout')).toHaveLength(2);
      expect(JSON.stringify(view)).not.toContain('return 42');
      await expect(runner.run({...job,task:'changed'})).rejects.toThrow('identity/configuration changed');
      expect(await new Harness2Runner(options).run(job)).toEqual(result);
    }finally{rmSync(dir,{recursive:true,force:true});}
  },30000);
  it('rejects the production realm and does not dispatch an incomplete prior job',async()=>{
    const dir=fresh();try{
      const p=physicsPractice(join(dir,'methods'));let calls=0;
      const options={directory:dir,worker:{command:process.execPath,script:fakeWorker(dir),workspace:dir},practice:p.executor,model:{id:'fixture',generate:async()=>{calls++;throw Error('offline');}}};
      const job=fixtureJob(p.fixtures);
      await expect(new Harness2Runner(options).run({...job,scope:{...job.scope,realm:p.executor.binding.realm}})).rejects.toThrow('separate instance and realm');
      await expect(new Harness2Runner(options).run(job)).rejects.toThrow();
      const before=p.stats();await expect(new Harness2Runner(options).run(job)).rejects.toThrow('incomplete');expect(p.stats()).toEqual(before);expect(calls).toBe(1);
    }finally{rmSync(dir,{recursive:true,force:true});}
  },10000);
  it('aborts an unresponsive model, preserves original evidence and never retries it on resume',async()=>{
    const dir=fresh();try{
      const p=physicsPractice(join(dir,'methods')),controller=new AbortController();let calls=0;
      const options={directory:dir,worker:{command:process.execPath,script:fakeWorker(dir),workspace:dir},practice:p.executor,
        model:{id:'unresponsive-fixture',generate:async()=>{calls++;setTimeout(()=>controller.abort(),30);return new Promise<never>(()=>{});}}};
      const job=fixtureJob(p.fixtures);
      await expect(new Harness2Runner(options).run(job,controller.signal)).rejects.toThrow();
      const journal=JSON.parse(readFileSync(join(dir,job.id,'journal.json'),'utf8'));
      expect(journal.trials).toBe(1);expect(journal.modelCalls).toBe(1);expect(journal.status).toBe('failed');
      const stats=p.stats();await expect(new Harness2Runner(options).run(job)).rejects.toThrow('incomplete');expect(p.stats()).toEqual(stats);expect(calls).toBe(1);
    }finally{rmSync(dir,{recursive:true,force:true});}
  },10000);
  it('freezes recalled game lessons per job and writes interpreted lessons to the existing scoped notebook once',async()=>{
    const dir=fresh();try{
      const p=physicsPractice(join(dir,'methods')),book=new GameMemoryBook(join(dir,'memory'));
      const context={scope:{realm:'live-server',account:'Cormy',agent:'cormy'},dimension:null};
      const memory=createPracticeGameMemory({call:async args=>book.execute(args,context)});
      let recalls=0;
      const options={directory:dir,worker:{command:process.execPath,script:fakeWorker(dir),workspace:dir},practice:p.executor,
        model:{id:'fixture',generate:async()=>({files:{'skills/minecraft-method/scripts/run.js':STEP_CODE}})},
        recall:async()=>{recalls++;return memory.recall('walking',new AbortController().signal);},remember:memory.remember};
      const job=fixtureJob(p.fixtures),runner=new Harness2Runner(options),result=await runner.run(job);
      const signal=new AbortController().signal;
      await memory.remember(result,signal);
      const notes=book.execute({action:'search',tags:['harness2'],limit:20},context) as any;
      expect(notes.total).toBe(1);expect(notes.entries[0].currentWorldVerified).toBe(false);
      const recalled=await memory.recall('practice',signal);
      expect(recalled).toHaveLength(1);expect(recalled[0].lesson).toContain('isolated practice; eligible=true');
      expect(await new Harness2Runner(options).run(job)).toEqual(result);expect(recalls).toBe(1);
      expect(book.execute({action:'search',tags:['harness2'],limit:20},{...context,scope:{...context.scope,agent:'other'}})).toMatchObject({total:0});
    }finally{rmSync(dir,{recursive:true,force:true});}
  },10000);
  it('binds a fresh evidence book independently while keeping the original book resumable',async()=>{
    const dir=fresh();try{
      const p=physicsPractice(join(dir,'methods'));let calls=0;
      const options={directory:join(dir,'book-a'),worker:{command:process.execPath,script:fakeWorker(dir),workspace:dir},practice:p.executor,
        model:{id:'fixture',generate:async()=>{calls++;return{files:{'skills/minecraft-method/scripts/run.js':STEP_CODE}};}}};
      const job=fixtureJob(p.fixtures),first=await new Harness2Runner(options).run(job);
      const second=await new Harness2Runner({...options,directory:join(dir,'book-b')}).run(job);
      expect(second.jobHash).not.toBe(first.jobHash);expect(calls).toBe(2);
      expect(await new Harness2Runner(options).run(job)).toEqual(first);expect(calls).toBe(2);
    }finally{rmSync(dir,{recursive:true,force:true});}
  },10000);
});
