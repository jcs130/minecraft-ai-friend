import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {Harness2PracticeService,parseHarness2ModelReply} from '../src/learning/harness2-service.ts';
import {physicsPractice,STEP_CODE} from './harness2-fixture.ts';
import {procedureHash,PROCEDURE_SCHEMA} from '../core/support/procedure.ts';
import {GameMemoryBook} from '../core/game-memory.ts';
import {createPracticeGameMemory} from '../src/learning/practice-memory.ts';
import {PracticeStagingError} from '../src/learning/practice-staging.ts';
const directories:string[]=[];
afterEach(()=>{for(const d of directories.splice(0))rmSync(d,{recursive:true,force:true});});
function rig() {
  const directory=mkdtempSync(join(tmpdir(),'mc-practice-service-'));directories.push(directory);
  const p=physicsPractice(join(directory,'methods'));
  const body={schema:PROCEDURE_SCHEMA,id:'walk-method',adapter:'minecraft-method/v1',description:'Walk on supported flat ground',
    conditions:['Flat isolated fixture only'],code:'return (await mc.state()).snapshot.position;',dependencies:{},parent:null,
    author:{kind:'agent' as const,role:'model-fixture'},createdAt:new Date().toISOString()};
  const base={...body,sourceHash:createHash('sha256').update(body.code).digest('hex')},source={...base,revision:procedureHash(base)};
  const script=join(directory,'worker.mjs');
  writeFileSync(script,`import{createInterface}from'node:readline';const rl=createInterface({input:process.stdin});let init,id=0;const pending=new Map();
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');const rpc=(op,v)=>new Promise(r=>{pending.set(++id,r);send({type:'rpc',id,op,...v});});
rl.on('line',async line=>{const v=JSON.parse(line);if(init){pending.get(v.id)?.(v.value);pending.delete(v.id);return;}init=v;
await rpc('trial',{runId:'lab/base1',candidate:v.job.baseline});const patch=await rpc('model',{label:'inv1.a1',mission:'game task',files:{'task.md':v.job.task}});
const candidate={...v.job.baseline,code:patch.files['skills/minecraft-method/scripts/run.js']};await rpc('trial',{runId:'lab/agg1',candidate});
send({type:'done',result:{upstreamRevision:v.revision,candidate,selectedRunId:'lab/agg1'}});rl.close();});`);
  let scope={realm:'live-fixture',account:'test-player',agent:'test-agent'},calls=0;
  let done!:()=>void;const settled=new Promise<void>(resolve=>{done=resolve;});
  const options={directory:join(directory,'jobs'),worker:{command:process.execPath,script,workspace:directory},practice:p.executor,fixtures:p.fixtures,
    capability:'isolated flat collision physics only',budget:{modelCalls:8,trials:6,wallMs:30000,trialMs:5000,contextBytes:300000},
    model:{id:'scripted-fixture',generate:async()=>{calls++;return {files:{'skills/minecraft-method/scripts/run.js':STEP_CODE}};}},
    source:()=>({instanceId:'live-test-body',scope}),readMethod:async()=>source,settled:async()=>done()};
  const args={op:'start',id:'experiment-one',methodId:source.id,revision:source.revision,task:'Reach the public fixture target'};
  return {directory,p,options,args,source,settled,changeScope:()=>scope={...scope,account:'another-player'},calls:()=>calls};
}
describe('explicit host method practice service',()=>{
  it('compares a completed cohort and stages its exact source once across restart without another trial or model call',async()=>{
    const r=rig();let staged=0;
    const options={...r.options,stageCandidate:async(request:any)=>{staged++;expect(request.source.revision).toBe(r.source.revision);expect(request.candidate.code).toBe(STEP_CODE);
      return {staged:true,reference:{handle:'mem:fixture/candidate',revision:'f'.repeat(64)},adopted:false};}};
    const service=new Harness2PracticeService(options);await service.call(r.args);await r.settled;
    const comparison=await service.call({op:'compare',ids:[r.args.id]}) as any;
    expect(comparison.adopted).toBe(false);expect(comparison.frontier).toContain(r.args.id);
    const stats=r.p.stats(),first=await service.call({op:'stage',id:r.args.id});await service.close();
    const restored=new Harness2PracticeService(options);expect(await restored.call({op:'stage',id:r.args.id})).toEqual(first);
    expect(staged).toBe(1);expect(r.calls()).toBe(1);expect(r.p.stats()).toEqual(stats);expect(restored.context().jobs[0]?.staged).toBe(true);await restored.close();
  },20000);
  it('distinguishes a known pre-write staging rejection from an unknown acknowledgement',async()=>{
    const r=rig();let attempts=0;
    const service=new Harness2PracticeService({...r.options,stageCandidate:async()=>{attempts++;throw new PracticeStagingError('Parent changed',false);}});
    await service.call(r.args);await r.settled;
    await expect(service.call({op:'stage',id:r.args.id})).rejects.toThrow('Parent changed');
    await expect(service.call({op:'stage',id:r.args.id})).rejects.toThrow('Parent changed');expect(attempts).toBe(2);await service.close();
    const restored=new Harness2PracticeService({...r.options,stageCandidate:async()=>{throw Error('acknowledgement lost');}});
    await expect(restored.call({op:'stage',id:r.args.id})).rejects.toThrow('acknowledgement lost');
    await expect(restored.call({op:'stage',id:r.args.id})).rejects.toThrow('result is unknown');await restored.close();
  },20000);
  it('recalls an attributed cue index for paraphrased tasks with the original confidence boundary and evidence',async()=>{
    const r=rig(),book=new GameMemoryBook(join(r.directory,'memory')),scope={realm:'lab',account:'fixture',agent:'fixture'};
    const memory=createPracticeGameMemory({call:async args=>book.execute(args,{scope,dimension:null})});
    const signal=new AbortController().signal;
    await memory.remember({jobHash:'a'.repeat(64),jobId:'walk-comparison',upstreamRevision:'fixture',evidenceRefs:['trial:original'],selectedReference:null,
      gate:{eligible:false,reason:'not-improved',adopted:false},experience:{cue:'Supported flat walk',lesson:'The candidate did not improve the measured target outcome.',evidence:'trial:original',confidence:'Only two flat fixtures; no water or combat.'}},signal);
    const recalled=await memory.recall('TraverseUnknownPlatformVariant987',signal);
    expect(recalled).toHaveLength(1);expect(recalled[0].evidenceRefs).toEqual(['trial:original']);
    expect(recalled[0].lesson).toContain('cue index, relevance unverified');expect(recalled[0].lesson).toContain('no water or combat');
    expect(recalled[0].lesson).toContain('eligible=false');
  });
  it('returns acceptance, measures real physics, exposes complete candidate on demand, and restart never replays effects',async()=>{
    const r=rig(),service=new Harness2PracticeService(r.options);
    expect(await service.call(r.args)).toMatchObject({accepted:true,terminal:false,adopted:false});
    await expect(service.call(r.args)).rejects.toThrow(/already pending|already exists/);
    await r.settled;
    const snapshot=await service.call({op:'status'}) as any;
    expect(snapshot.jobs[0]).toMatchObject({status:'completed',trials:4,result:{eligible:true,adopted:false}});
    expect(JSON.stringify(snapshot)).not.toContain(STEP_CODE);
    const expanded=await service.call({op:'result',id:r.args.id}) as any;
    expect(expanded.result.selected.code).toBe(STEP_CODE);expect(expanded.source.revision).toBe(r.source.revision);
    expect(r.p.stats().heldKeys).toBe(0);expect(r.p.library.list()).toMatchObject({methods:[{selected:null}]});
    const stats=r.p.stats();await service.close();
    const restored=new Harness2PracticeService(r.options);
    expect((await restored.call({op:'status'}) as any).jobs).toEqual(snapshot.jobs);
    await expect(restored.call(r.args)).rejects.toThrow('already exists');expect(r.p.stats()).toEqual(stats);expect(r.calls()).toBe(1);
    r.changeScope();await expect(restored.call({op:'result',id:r.args.id})).rejects.toThrow('scope');
    expect((await restored.call({op:'status'}) as any).jobs).toEqual([]);await restored.close();
  },20000);
  it('rejects mismatched source, unsupported parameters and shutdown during method resolution before accepting a job',async()=>{
    const r=rig(),service=new Harness2PracticeService(r.options);
    await expect(service.call({...r.args,unexpected:true})).rejects.toThrow('Invalid practice parameters');
    await expect(service.call({...r.args,revision:'0'.repeat(64)})).rejects.toThrow('identity mismatch');
    let release!:(v:typeof r.source)=>void;
    const delayed=new Harness2PracticeService({...r.options,directory:join(r.directory,'delayed'),readMethod:()=>new Promise(r=>release=r)});
    const operation=delayed.call(r.args);await delayed.close();release(r.source);
    await expect(operation).rejects.toThrow('stopped');expect(r.calls()).toBe(0);expect(r.p.stats().resets).toBe(0);await service.close();
  });
  it('aborts the original model operation and preserves its failed journal without a fresh execution id retry',async()=>{
    const r=rig();let entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve);
    const service=new Harness2PracticeService({...r.options,model:{id:'cancel-fixture',generate:async(_request,signal)=>{
      entered();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}}});
    await service.call(r.args);await ready;
    expect(await service.call({op:'cancel',id:r.args.id})).toMatchObject({cancelRequested:true,settled:false});await r.settled;await service.close();
    const journal=JSON.parse(readFileSync(join(r.options.directory,r.args.id,'journal.json'),'utf8'));
    expect(journal.status).toBe('failed');expect(journal.modelCalls).toBe(1);expect(r.p.stats().heldKeys).toBe(0);
    await expect(service.call(r.args)).rejects.toThrow('stopped');
  },15000);
  it('parses complete JSON artifacts and rejects truncation, provider prose and unknown contract fields',()=>{
    expect(parseHarness2ModelReply('```json\n{"choice":"A"}\n```')).toEqual({choice:'A'});
    for(const text of ['{"files":','candidate A','[]','{"shell":"rm"}'])expect(()=>parseHarness2ModelReply(text)).toThrow();
  });
});
