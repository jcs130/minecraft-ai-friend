import { describe,it,expect } from 'vitest';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { selectPolicyProposal,normalizePolicyEvidence } from '../src/learning/rollout.ts';
import { summarizePolicyUsage,PolicyUsageWindow } from '../src/learning/policy-statistics.ts';
import { MotorPolicyShadow } from '../src/learning/motor-shadow.ts';
import { gameplayFromExperience,type GameplayRecord } from '../src/learning/assessment.ts';
import { encodeGameplay,decodeGameplay } from '../src/learning/archive.ts';
import { FEATURE_COUNT,MOTOR_ACTIONS,MOTOR_PROTOCOL } from '../src/motor/policy.ts';
import { OperationExperienceBook } from '../core/operation-experience.ts';

const scope='a'.repeat(64),now=Date.now(),at=new Date(now).toISOString();
const baseline={source:'rule' as const,policyId:'pathfinder',revision:'baseline-1',action:'walk'};
const candidate={source:'learned' as const,policyId:'motor',revision:'candidate-1',action:'jump'};
const policy={source:'learned' as const,layer:'motor' as const,policyId:'motor',revision:'candidate-1',mode:'canary' as const,
  selectedSource:'learned' as const,experimentId:'trial-1',episodeId:'episode-1',candidateProbability:.1};
const observation={at,dimension:'minecraft:overworld',position:{x:0,y:64,z:0},health:20,food:20,inventory:{}};
const raw=(patch:any={})=>({schema:'agent-mc-experience/v1',id:'b'.repeat(64),scopeKey:scope,run:'run-1',at,updatedAt:at,
  kind:'operation',tool:'mc_do',operations:['goto'],parameters:[{skill:'goto',at:[5,64,0]}],attribution:{controller:'system1',policy},
  dispatch:'returned',execution:{kind:'task',id:'execution-1',phase:'completed',terminal:true},before:observation,
  after:{...observation,position:{x:5,y:64,z:0}},elapsedMs:100,...patch});
const project=(r:any)=>gameplayFromExperience(r,scope,createHash('sha256').update(JSON.stringify(r)).digest('hex'));
const window={scopeKey:scope,from:new Date(now-10000).toISOString(),to:new Date(now+10000).toISOString()};

describe('incremental learned policy rollout and evidence',()=>{
  it('assigns one reproducible cohort per episode, and never dispatches a proposal',()=>{
    const req={scopeKey:scope,experimentId:'trial',episodeId:'ep',mode:'canary' as const,candidateFraction:.1,baseline,candidate,eligible:true};
    const chosen=selectPolicyProposal(req);
    for(let i=0;i<10;i++)expect(selectPolicyProposal(req)).toEqual(chosen);
    expect(chosen.requiresHostDispatch).toBe(true);
    expect(selectPolicyProposal({...req,mode:'active'}).selectedSource).toBe('learned');
    for(const patch of [{mode:'shadow'},{eligible:false},{stopRequested:true},{candidate:null},{candidateFraction:0}] as const)
      expect(selectPolicyProposal({...req,...patch})).toMatchObject({selectedSource:'rule'});
    const share=Array.from({length:1000},(_,i)=>selectPolicyProposal({...req,episodeId:`ep-${i}`}).selectedSource).filter(x=>x==='learned').length;
    expect(share).toBeGreaterThan(65);expect(share).toBeLessThan(135);
  });
  it('rejects invalid fractions/provenance and strips unrecognized metadata',()=>{
    expect(()=>selectPolicyProposal({scopeKey:scope,experimentId:'a',episodeId:'b',mode:'canary',candidateFraction:2,baseline,candidate,eligible:true})).toThrow();
    expect(normalizePolicyEvidence({...policy,credentials:'PRIVATE'} as any)).not.toHaveProperty('credentials');
    expect(()=>normalizePolicyEvidence({...policy,candidateProbability:NaN})).toThrow();
    expect(()=>normalizePolicyEvidence({...policy,action:'private prompt with whitespace'})).toThrow();
  });
  it('retains provenance and nullable fields through the actual operation book and FlatBuffers',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'mc-policy-book-'));
    try{
      const book=new OperationExperienceBook(dir),gameScope={realm:'test',account:'test',agent:'test'};
      const entry=book.begin(gameScope,'run','req','mc_do',{skill:'goto'},null,{controller:'system2',policy:{...policy,private:'PRIVATE'} as any});
      expect(entry.attribution.policy).not.toHaveProperty('private');
      const restored=decodeGameplay(encodeGameplay(project(raw())));
      expect(restored.policy).toMatchObject(policy);expect(restored.policy!.featureHash).toBeNull();
      expect(Buffer.from(encodeGameplay(restored)).includes(Buffer.from('PRIVATE'))).toBe(false);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it('separates shadow, selection, admission, start, completion and goal verification',()=>{
    const accepted=project(raw({execution:{kind:'task',id:'execution-1',phase:'accepted',terminal:false}}));
    const completed=project(raw({updatedAt:new Date(now+1).toISOString()}));completed.previousRevision=accepted.revision;
    const shadow={...completed,id:'c'.repeat(64),sourceId:'c'.repeat(64),kind:'policy-shadow'};
    const stats=summarizePolicyUsage([completed,accepted,completed,shadow],window);
    expect(stats).toMatchObject({operationCount:1,shadowRecommendations:1,started:{learned:1},completed:{learned:1}});
    expect(stats.goalSuccessRate.learned).toBeNull();
    const witnesses=[{scopeKey:scope,sourceId:completed.sourceId,executionId:'execution-1',success:true,evaluatorId:'reach',evaluatorRevision:'v1',evidenceRefs:['server-position:1']}];
    expect(summarizePolicyUsage([completed],window,witnesses).goalSuccessRate.learned).toBe(1);
    expect(summarizePolicyUsage([completed],window,[{...witnesses[0],executionId:'wrong'}]).goalSuccessRate.learned).toBeNull();
    expect(summarizePolicyUsage([completed],window,[...witnesses,{...witnesses[0],success:false}]).goalSuccessRate.learned).toBeNull();
  });
  it('does not infer learned/rule provenance from S1/S2 or count rejected/unknown/cancelled actions as successful',()=>{
    const rows=['system1','system2'].map((controller,i)=>project(raw({id:String(i+1).repeat(64),attribution:{controller}})));
    expect(summarizePolicyUsage(rows,window)).toMatchObject({submitted:{unknown:2},policyAttributionCoverage:0,submittedShare:{rule:null,learned:null,unknown:1}});
    for(const phase of ['cancelled','failed','blocked','unknown']) {
      const r=project(raw({execution:{kind:'task',id:'execution-1',phase,terminal:true}}));
      expect(summarizePolicyUsage([r],window).completed.learned).toBe(0);
    }
    const rejected=project(raw({dispatch:'rejected'}));
    expect(summarizePolicyUsage([rejected],window).started.learned).toBe(0);
    expect(()=>summarizePolicyUsage([{...rows[0],scopeKey:'c'.repeat(64)}],window)).toThrow(/scope/);
  });
  it('quarantines conflicting revisions and reports bounded window truncation',()=>{
    const r=project(raw()),other={...r,revision:'d'.repeat(64),phase:'failed'};
    expect(summarizePolicyUsage([r,other],window)).toMatchObject({operationCount:0,conflictingOperations:1});
    const conflictStore=new PolicyUsageWindow(scope);conflictStore.observe(r);conflictStore.observe(other);
    expect(conflictStore.status(now)).toMatchObject({operationCount:0,conflictingOperations:1});
    const store=new PolicyUsageWindow(scope,1);store.observe(r);store.observe({...r,sourceId:'e'.repeat(64)});
    expect(store.status(now)).toMatchObject({capacityEvictions:1,coverage:'bounded-incomplete',operationCount:1});
    expect(summarizePolicyUsage([],window).submittedShare.learned).toBeNull();
  });
  it('runs a real local policy only against fresh live targets, without executed action or outcome labels',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'mc-motor-shadow-'));
    try{
      const model={protocol:MOTOR_PROTOCOL,minecraftVersion:'1.21.1',featureCount:FEATURE_COUNT,actionNames:MOTOR_ACTIONS.map(a=>a.name),
        goalMode:'final-target',layers:[{weight:MOTOR_ACTIONS.map(()=>Array(FEATURE_COUNT).fill(0)),bias:MOTOR_ACTIONS.map((_,i)=>i===4?1:0)}],
        training:{method:'test-only',datasetSha256:'f'.repeat(64),deploymentApproved:false}};
      const file=join(dir,'model.json');await writeFile(file,JSON.stringify(model));
      const sha256=createHash('sha256').update(await readFile(file)).digest('hex'),frames:GameplayRecord[]=[];
      const opts={policyFile:file,sha256,experimentId:'test-shadow'};
      const shadow=await MotorPolicyShadow.load(opts,async row=>{frames.push(decodeGameplay(encodeGameplay(row)));});
      const target=project(raw({execution:{kind:'task',id:'execution-1',phase:'running',terminal:false}}));
      const sample={...target,kind:'observation',observation:{at,dimension:'overworld',position:[0,64,0],velocity:[0,0,0],yaw:0,onGround:true,
        health:20,food:20,inventory:null,voxels:Array(245).fill(1)}} as GameplayRecord;
      await shadow.observe(sample,now);expect(frames).toHaveLength(0);
      shadow.observeOperation(target);await shadow.observe(sample,now);expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({kind:'policy-shadow',executionId:null,policy:{mode:'shadow',action:MOTOR_ACTIONS[4].name,inputRef:sample.id,baselineAction:null},assessment:{label:'unknown'}});
      expect(shadow.status()).toMatchObject({evaluated:1,executedActions:0,goalSuccessRate:null,bodyControlCalls:0});
      await shadow.observe({...sample,observation:{...sample.observation!,dimension:'minecraft:the_nether'}},now);expect(frames).toHaveLength(1);
      await shadow.observe({...sample,observation:{...sample.observation!,dimension:null}},now);expect(frames).toHaveLength(1);
      await shadow.observe(sample,now+2000);expect(frames).toHaveLength(1);
      shadow.observeOperation(project(raw()));await shadow.observe(sample,now);expect(frames).toHaveLength(1);
      await expect(MotorPolicyShadow.load({...opts,sha256:'0'.repeat(64)},async()=>{})).rejects.toThrow(/hash/);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
