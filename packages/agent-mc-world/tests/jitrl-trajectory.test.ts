import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GameMemoryBook,GAME_MEMORY_TOOL,type GameMemoryContext} from '../core/game-memory.ts';
import {GameMemoryService} from '../core/game-memory-service.ts';
import {OperationExperienceBook,type OperationObservation} from '../core/operation-experience.ts';
import {discountedTrajectoryReturns,trajectoryEvaluationInputSchema} from '../core/jitrl-trajectory.ts';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import {inspectToolCall} from '../src/contracts/call-capability.ts';

let dir:string,ctx:GameMemoryContext,operations:OperationExperienceBook,service:GameMemoryService;
const scope={realm:'test-world',account:'learner',agent:'test-agent'};
const sample=(arrows=0):OperationObservation=>({at:new Date().toISOString(),dimension:'overworld',position:{x:0,y:64,z:0},health:20,food:20,inventory:{arrow:arrows}});
const candidates=[{id:'prepare',prior:.45,ready:true,tool:'mc_act',args:{steps:[{skill:'interact',targetId:1}]}},
  {id:'detour',prior:.55,ready:true,tool:'mc_act',args:{steps:[{skill:'interact',targetId:2}]}}];
const criterion={kind:'inventory',item:'arrow',target:32};
const contract={taskKey:'supply',phase:'acquire',goal:{id:'arrows',revision:'v1',description:'Acquire and retain 32 usable arrows'},
  criterion,actor:'worker',taskId:'supply-1',assignmentId:'assignment-1',gamma:.95};
const call=(operation:string,input:Record<string,unknown>={},requestId?:string)=>service.execute({action:'experience',operation,input,...(requestId?{requestId}:{})},ctx);
const rank=(requestId:string,extra:Record<string,unknown>={})=>call('trajectory_rank',{taskKey:'supply',phase:'acquire',goalId:'arrows',goalRevision:'v1',criterion,candidates,beta:2,...extra},requestId);
const advance=()=>vi.setSystemTime(Date.now()+10);
function op(requestId:string,before=0,after=32,action=candidates[0]!,phase='completed',run='run-1',physicalId=requestId){
  advance();const row=operations.begin(scope,run,requestId,action.tool,action.args,sample(before));
  operations.finish(scope,row.id,{text:'',execution:{kind:'task',id:physicalId,phase:phase as 'completed',terminal:phase!=='accepted',goalCompleted:false}},sample(after),5);
  return row.id;
}
async function episode(name='e',net=32){
  const begin=await call('trajectory_begin',contract,name);
  const ids=[op(name+'-prepare',0,0),op(name+'-finish',0,net,candidates[1])];
  const appended=await call('trajectory_append',{episodeId:begin.episodeId,expectedRevision:0,experienceIds:ids});
  await call('trajectory_close',{episodeId:begin.episodeId,expectedRevision:appended.revision,outcome:'completed',note:'Native operation terminals; task acceptance is separate'});
  return {id:begin.episodeId as string,ids};
}
const score=(e:{id:string;ids:string[]},values:(number|null)[],previous=0)=>call('trajectory_score',{episodeId:e.id,expectedScoreRevision:previous,
  evaluator:{id:'critic',model:'test-model',version:'rubric-v1'},critique:`Full trajectory reviewed; revision ${previous+1}`,
  rewards:e.ids.map((experienceId,i)=>({experienceId,value:values[i],reason:'Evidence from this step and subsequent native outcome'}))});
const adopt=(id:string,revision=1)=>call('trajectory_review',{episodeId:id,expectedScoreRevision:revision,select:revision,reason:'Reviewed full timeline, rewards and measured net change'});
it('publishes executable evaluation contracts for constrained tool calls, not opaque objects',async()=>{
  const validate=new AjvJsonSchemaValidator();
  const get=validate.getValidator(trajectoryEvaluationInputSchema('trajectory_get'));
  expect(get({}).valid).toBe(false);
  expect(get({episodeId:'a'.repeat(64),offset:0,limit:8}).valid).toBe(true);
  const scoreSchema=trajectoryEvaluationInputSchema('trajectory_score');
  const check=validate.getValidator(scoreSchema);
  expect(check({episodeId:'a'.repeat(64),expectedScoreRevision:0}).valid).toBe(false);
  expect(check({episodeId:'a'.repeat(64),expectedScoreRevision:0,evaluator:{id:'critic',model:null,version:'v1'},critique:'Unknown native outcome',rewards:[{experienceId:'b'.repeat(64),value:null,reason:'No verified terminal'}]}).valid).toBe(true);
  const help=await call('trajectory_help');
  expect((help.schemas as any).trajectory_score).toEqual(scoreSchema);
  (scoreSchema.properties as any).rewards={};
  expect((trajectoryEvaluationInputSchema('trajectory_score').properties as any).rewards.items).toBeTruthy();
});
beforeEach(()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-16T00:00:00Z'));
  dir=mkdtempSync(join(tmpdir(),'multi-jitrl-'));ctx={scope,dimension:'overworld',observation:()=>sample()};
  operations=new OperationExperienceBook(dir);service=new GameMemoryService(new GameMemoryBook(dir),dir);
});
afterEach(()=>{vi.useRealTimers();rmSync(dir,{recursive:true,force:true});});

describe('multi-step returns and iterative selection',()=>{
  it('credits delayed outcomes to preparation and preserves raw cumulative return',()=>{
    expect(discountedTrajectoryReturns([0,0,1],.9)).toEqual([
      {return:.81,normalized:.81/2.71,horizon:3},{return:.9,normalized:.9/1.9,horizon:2},{return:1,normalized:1,horizon:1}]);
    expect(discountedTrajectoryReturns([1,1,1],1)[0]).toMatchObject({return:3,normalized:1});
    expect(discountedTrajectoryReturns([0,null,1],.9).map(r=>r.return)).toEqual([null,null,1]);
    expect(discountedTrajectoryReturns([1,null],0).map(r=>r.return)).toEqual([1,null]);
  });
  it('revises scoring without inventing an extra execution, then changes a held-out choice',async()=>{
    const e=await episode();await score(e,[-.3,.1]);await adopt(e.id);
    const first=await rank('first',{candidates:[candidates[0],{...candidates[1],args:{steps:[{skill:'interact',targetId:3}]}}]});
    expect(first).toMatchObject({suggestedChoice:'detour',sampleSize:1});
    await score(e,[0,1],1);
    expect(await rank('unreviewed',{candidates:[candidates[0],{...candidates[1],args:{steps:[{skill:'interact',targetId:3}]}}]})).toMatchObject({suggestedChoice:'detour',sampleSize:1});
    await adopt(e.id,2);
    service=new GameMemoryService(new GameMemoryBook(dir),dir);
    const second=await rank('second',{candidates:[candidates[0],{...candidates[1],args:{steps:[{skill:'interact',targetId:3}]}}]});
    expect(second).toMatchObject({baseChoice:'detour',suggestedChoice:'prepare',sampleSize:1,goalVerified:false,bodyDispatched:false});
    expect((second.evidence as any[])[0]).toMatchObject({scoreRevision:2,return:.95,step:0});
    const page=await call('trajectory_get',{episodeId:e.id,limit:1});
    expect(page).toMatchObject({scoringRevision:2,activeScore:2,nextOffset:1,nativeOutcome:{delta:32,value:1}});
    expect((page.scoreHistory as any[])[1].parentRevision).toBe(1);
    expect((page.latestScore as any).rewards).toHaveLength(1);
  });
  it('retains a new counterexample and lowers the action value in the next iteration',async()=>{
    const good=await episode('good');await score(good,[0,1]);await adopt(good.id);
    const before=await rank('before');
    const bad=await episode('bad',0);await score(bad,[-.8,-.8]);await adopt(bad.id);
    const after=await rank('after');
    expect((after.candidates as any[])[0].q).toBeLessThan((before.candidates as any[])[0].q);
    expect(after.sampleSize).toBe(4);
  });
  it('detects take/return loops despite successful tools and rejects optimistic adoption',async()=>{
    const b=await call('trajectory_begin',contract,'loop');
    const ids=[op('take',0,32),op('return',32,0,candidates[1])];
    await call('trajectory_append',{episodeId:b.episodeId,expectedRevision:0,experienceIds:ids});
    await call('trajectory_close',{episodeId:b.episodeId,expectedRevision:1,outcome:'completed',note:'Both tools completed'});
    const e={id:b.episodeId as string,ids};await score(e,[1,1]);
    await expect(adopt(e.id)).rejects.toThrow('nonpositive net outcome');
    await score(e,[-.2,-1],1);await adopt(e.id,2);
    expect(await call('trajectory_get',{episodeId:e.id})).toMatchObject({nativeOutcome:{delta:0,value:0},activeScore:2,goalVerified:false});
  });
  it('binds actual reuse to the ranked action and waits for the original terminal',async()=>{
    const e=await episode();await score(e,[0,1]);await adopt(e.id);
    const decision=await rank('use');const experienceId=op('reuse',0,0,candidates[0],'accepted');
    expect(await call('trajectory_use',{decisionId:decision.decisionId,experienceId})).toMatchObject({terminal:false,benefitVerified:false});
    operations.terminal(scope,experienceId,{kind:'task',id:'reuse',phase:'completed',terminal:true,goalCompleted:false},sample(32));
    expect(await call('trajectory_use',{decisionId:decision.decisionId,experienceId})).toMatchObject({terminal:true,after:{inventory:{arrow:32}},benefitVerified:false});
    expect(await call('trajectory_use',{decisionId:decision.decisionId,experienceId})).toMatchObject({deduplicated:true});
    await expect(call('trajectory_use',{decisionId:decision.decisionId,experienceId:op('other',0,1,{...candidates[0],args:{steps:[{skill:'eat'}]}})})).rejects.toThrow('does not match');
  });
});

describe('evidence and lifecycle boundaries',()=>{
  it('records an explicit initial withdrawal so an uncertain review can finish',async()=>{
    const e=await episode();await score(e,[null,null]);
    const input={episodeId:e.id,expectedScoreRevision:1,select:null,reason:'Missing outcome evidence; do not adopt'};
    await call('trajectory_review',input);
    expect(await call('trajectory_get',{episodeId:e.id})).toMatchObject({activeScore:null,reviews:[{revision:null,reason:input.reason}]});
    expect(await call('trajectory_review',input)).toMatchObject({deduplicated:true});
  });
  it('stages long scoring output in pages and adopts only a complete finalized revision',async()=>{
    const e=await episode(),common={episodeId:e.id,expectedScoreRevision:0,evaluator:{id:'critic',model:null,version:'v1'},critique:'Full outcome reconciled'};
    await call('trajectory_score',{...common,offset:0,finalize:false,rewards:[{experienceId:e.ids[0],value:0,reason:'Preparation'}]});
    await expect(call('trajectory_score',{...common,rewards:[],finalize:true})).rejects.toThrow('missing steps');
    expect(await rank('draft')).toMatchObject({sampleSize:0});
    service=new GameMemoryService(new GameMemoryBook(dir),dir);
    expect(await call('trajectory_get',{episodeId:e.id})).toMatchObject({scoringRevision:0,scoringDraft:{covered:1,missing:[1]}});
    await call('trajectory_score',{...common,offset:1,finalize:false,rewards:[{experienceId:e.ids[1],value:1,reason:'Delayed gain'}]});
    await call('trajectory_score',{...common,rewards:[],finalize:true});await adopt(e.id);
    expect(await call('trajectory_get',{episodeId:e.id})).toMatchObject({scoringRevision:1,activeScore:1,scoringDraft:null});
  });
  it('rejects an invalid page before saving it, identifies its exact step and preserves prior pages across restart',async()=>{
    const begin=await call('trajectory_begin',contract,'page-repair'),episodeId=begin.episodeId;
    const ids=[op('first'),op('second'),op('cancel',0,0,candidates[1],'cancelled')];
    await call('trajectory_append',{episodeId,expectedRevision:0,experienceIds:ids});
    await call('trajectory_close',{episodeId,expectedRevision:1,outcome:'completed',note:'One cancelled effect in the run'});
    const common={episodeId,expectedScoreRevision:0,evaluator:{id:'critic',model:null,version:'v1'},critique:'Raw outcomes checked'};
    const reward=(index:number,value:number|null)=>({experienceId:ids[index],value,reason:'Reviewed original outcome'});
    const page=(offset:number,rewards:unknown[])=>call('trajectory_score',{...common,offset,finalize:false,rewards});
    await page(0,[reward(0,1)]);
    await expect(page(1,[reward(1,0),reward(2,1)])).rejects.toMatchObject({feedback:{
      issue:'null_reward_required',index:2,experienceId:ids[2],expectedValue:null,missing:[1,2],
      next:{operation:'trajectory_score',offset:1,finalize:false}}});
    service=new GameMemoryService(new GameMemoryBook(dir),dir);
    expect(await call('trajectory_get',{episodeId,offset:2})).toMatchObject({steps:[{experienceId:ids[2],requiredRewardValue:null}],
      scoringDraft:{covered:1,missing:[1,2]}});
    await page(1,[reward(1,0),reward(2,null)]);
    // Re-open a real stored draft with a value that the previous version accepted.
    const file=join(dir,'jitrl-trajectories',readdirSync(join(dir,'jitrl-trajectories'))[0]!,episodeId+'.json');
    const legacy=JSON.parse(readFileSync(file,'utf8'));legacy.scoringDraft.rewards[2].value=1;
    writeFileSync(file,JSON.stringify(legacy));
    const finalize=()=>call('trajectory_score',{...common,rewards:[],finalize:true});
    await expect(finalize()).rejects.toMatchObject({feedback:{index:2,experienceId:ids[2],next:{offset:2},missing:[]}});
    await page(2,[reward(2,null)]);
    expect(await finalize()).toMatchObject({scoringRevision:1,adopted:false});
  });
  it('does not close acceptance as success; native completion can reconcile the same episode',async()=>{
    const b=await call('trajectory_begin',contract,'pending'),ids=[op('p',0,32,candidates[0],'accepted'),op('p2')];
    await call('trajectory_append',{episodeId:b.episodeId,expectedRevision:0,experienceIds:ids});
    expect(await call('trajectory_close',{episodeId:b.episodeId,expectedRevision:1,outcome:'completed',note:'done'})).toMatchObject({pending:true,state:'open'});
    operations.terminal(scope,ids[0]!,{kind:'task',id:'p',phase:'completed',terminal:true,goalCompleted:false},sample(32));
    expect(await call('trajectory_close',{episodeId:b.episodeId,expectedRevision:1,outcome:'completed',note:'done'})).toMatchObject({state:'closed'});
  });
  it('keeps interrupted and cancelled outcomes unknown and ineligible for reuse',async()=>{
    const b=await call('trajectory_begin',contract,'cancel'),ids=[op('cancel1'),op('cancel2',0,32,candidates[1],'cancelled')];
    await call('trajectory_append',{episodeId:b.episodeId,expectedRevision:0,experienceIds:ids});
    await call('trajectory_close',{episodeId:b.episodeId,expectedRevision:1,outcome:'cancelled',note:'Operator cancelled'});
    const e={id:b.episodeId as string,ids};await expect(score(e,[1,1])).rejects.toThrow('null reward');
    await score(e,[null,null]);await expect(adopt(e.id)).rejects.toThrow('Incomplete');
    expect(await rank('cancelled')).toMatchObject({sampleSize:0});
  });
  it('deduplicates IDs and physical executions and enforces chronology/run/goal binding',async()=>{
    const old=op('old');advance();const b=await call('trajectory_begin',contract,'binding');
    await expect(call('trajectory_append',{episodeId:b.episodeId,expectedRevision:0,experienceIds:[old]})).rejects.toThrow('predates');
    const first=op('first');await call('trajectory_append',{episodeId:b.episodeId,expectedRevision:0,experienceIds:[first]});
    expect(await call('trajectory_append',{episodeId:b.episodeId,expectedRevision:0,experienceIds:[first]})).toMatchObject({deduplicated:true,steps:1});
    const duplicate=op('retry',0,32,candidates[0],'completed','run-1','first');
    expect(await call('trajectory_append',{episodeId:b.episodeId,expectedRevision:1,experienceIds:[duplicate]})).toMatchObject({steps:1});
    await expect(call('trajectory_append',{episodeId:b.episodeId,expectedRevision:2,experienceIds:[op('new-run',0,32,candidates[0],'completed','run-2')]})).rejects.toThrow('Run changed');
    await expect(call('trajectory_begin',{...contract,goal:{...contract.goal,revision:'v2'}},'binding')).rejects.toThrow('conflict');
  });
  it('requires every step and optimistic concurrency, with idempotent score retries',async()=>{
    const e=await episode();await expect(score({...e,ids:e.ids.slice(0,1)},[0])).rejects.toThrow();
    await expect(score({...e,ids:[...e.ids].reverse()},[0,1])).rejects.toThrow('every original step');
    await score(e,[0,1]);expect(await score(e,[0,1])).toMatchObject({deduplicated:true,scoringRevision:1});
    await expect(score(e,[0,.5],0)).rejects.toThrow('revision conflict');
    await expect(call('trajectory_review',{episodeId:e.id,expectedScoreRevision:0,select:1,reason:'review'})).rejects.toThrow('revision conflict');
  });
  it.each([{goalId:'another'},{goalRevision:'v2'},{phase:'combat'},{taskKey:'explore'},{conditions:{water:true}},
    {criterion:{kind:'food',target:1}}])('does not transfer across different semantics: %j',async extra=>{
    const e=await episode();await score(e,[0,1]);await adopt(e.id);expect(await rank('different',extra)).toMatchObject({sampleSize:0});
  });
  it('isolates identities and stale/distant worlds; withdrawal removes reused scores',async()=>{
    const e=await episode();await score(e,[0,1]);await adopt(e.id);
    ctx={...ctx,scope:{...scope,account:'other'}};expect(await rank('other')).toMatchObject({sampleSize:0});
    ctx={scope,dimension:'overworld',observation:()=>({...sample(),position:{x:100,y:64,z:0}})};expect(await rank('far')).toMatchObject({sampleSize:0});
    ctx.observation=()=>sample();await call('trajectory_review',{episodeId:e.id,expectedScoreRevision:1,select:null,reason:'Counterevidence invalidates evaluator assumptions'});
    expect(await rank('withdrawn')).toMatchObject({sampleSize:0});
  });
  it('retains decision expiry on replay and refuses future/invalid observation time',async()=>{
    const d=await rank('r');vi.setSystemTime(Date.now()+31000);
    expect(await rank('r')).toMatchObject({decisionId:d.decisionId,replayed:true,expired:true});
    await expect(call('trajectory_use',{decisionId:d.decisionId,experienceId:op('late')})).rejects.toThrow('validity');
    ctx.observation=()=>({...sample(),at:'invalid'});await expect(rank('bad')).rejects.toThrow('fresh');
    ctx.observation=()=>({...sample(),at:new Date(Date.now()+10000).toISOString()});await expect(rank('future')).rejects.toThrow('fresh');
  });
  it('exposes local/background learning through real public capability validation',async()=>{
    const tool={...GAME_MEMORY_TOOL,handler:async()=>''};
    expect(tool.trajectoryLearning?.protocol).toBe('agent-mc-trajectory/v1');
    expect(inspectToolCall(tool,tool.name,{action:'experience',operation:'trajectory_score',input:{}})).toMatchObject({valid:true,backgroundLearning:true,requiresBody:false});
    expect(inspectToolCall(tool,tool.name,{action:'experience',operation:'trajectory_get',input:{}})).toMatchObject({readOnly:true,requiresBody:false});
    expect(await call('trajectory_help')).toHaveProperty('schemas.begin');
  });
  it('indexes summaries without embedding action data and paginates full evidence',async()=>{
    const e=await episode();await score(e,[0,1]);await adopt(e.id);
    const listing=await call('trajectory_list');expect((listing.entries as any[])[0]).not.toHaveProperty('steps.0');
    expect(await call('trajectory_recall',{taskKey:'supply',goalId:'arrows',goalRevision:'v1'})).toMatchObject({total:1,currentWorldVerified:false,benefitVerified:false});
    const walk=(p:string):string[]=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):e.name==='recent.json'?[join(p,e.name)]:[]);
    expect(walk(dir).some(p=>readFileSync(p,'utf8').includes('"taskKey":"supply"'))).toBe(true);
  });
});
