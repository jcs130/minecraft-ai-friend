/** Dedicated connected client -> existing mc_script executor/library. No copied game executor. */
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ToolOutcome,WorldRequestFacts} from '../contracts/host.ts';
import {procedureHash,procedureId,type ProcedureReference,type ProcedureReceipt} from '../../core/support/procedure.ts';
import {assessPracticeTrial,validatePracticeCandidate,validatePracticeCase,PracticeUnknownEffect,
  type PracticeCandidate,type PracticeCase,type PracticeExecutionPort,type PracticeSnapshot,type PracticeTrial} from './practice.ts';

export interface PracticeClientPort {
  readonly toolPrefix:string;
  status():{phase:string;run:string;facts:unknown;connection?:{ready:boolean;phase:string}|null};
  call(name:string,args:Record<string,unknown>,options?:{requestId?:string;signal?:AbortSignal}):Promise<ToolOutcome>;
}
export interface ClientPracticeControl {
  /** Trusted dedicated-server control. The candidate never receives this capability. */
  reset(fixture:PracticeCase,signal:AbortSignal):Promise<{snapshotId:string;environmentVersion:string;settled:true}>;
  /** Confirm original tasks/keys have stopped. A stop dispatch alone is insufficient. */
  settle(original:{trialId:string;runId:number|null;executionId:string|null},signal:AbortSignal):Promise<'settled'|'unknown'>;
}
export interface ClientPracticeOptions {
  directory:string;client:PracticeClientPort;control:ClientPracticeControl;
  fixtures:PracticeCase[];agent:string;
  validate?(candidate:PracticeCandidate):void;
}
const OBSERVE=`return {health:await bot.read('health'),dimension:await bot.read('game.dimension'),position:await bot.read('entity.position'),items:await bot.inventory.items()};`;

export function createClientMethodPractice(options:ClientPracticeOptions) {
  const directory=resolve(options.directory),fixtures=structuredClone(options.fixtures),client=options.client;
  if(typeof options.control?.reset!=='function'||typeof options.control?.settle!=='function'||typeof options.agent!=='string'||!options.agent.trim())throw Error('Explicit dedicated reset, cleanup and Agent binding required');
  if(fixtures.length<2||fixtures.length>9)throw Error('Supply a fixed training fixture and independent holdouts');
  fixtures.forEach(validatePracticeCase);
  if(new Set(fixtures.map(f=>f.id)).size!==fixtures.length||new Set(fixtures.map(f=>f.snapshotId)).size!==fixtures.length)throw Error('Distinct fixed practice snapshots required');
  const identity=()=>{
    const status=client.status(),facts=status.facts as WorldRequestFacts|null,scope=facts?.experience?.scope;
    if(status.phase!=='started'||status.connection?.ready===false||!scope)throw Error('Dedicated practice client must be connected with observed scope');
    const generation=facts?.decisionStability?.route?.generation;
    if(!Number.isSafeInteger(generation))throw Error('Dedicated practice client must expose its observed connection generation');
    return {instanceId:`${status.run}:${generation}`,realm:scope.realm,account:scope.account,agent:options.agent,isolated:true as const};
  };
  const binding=identity(),check=()=>{if(procedureHash(identity())!==procedureHash(binding))throw new PracticeUnknownEffect();};
  mkdirSync(directory,{recursive:true});
  const active=join(directory,'active.json');let busy=false;
  const write=(path:string,value:unknown)=>{const temp=join(directory,randomUUID()+'.tmp');writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(temp,path);};
  const script=async(args:Record<string,unknown>,requestId:string,signal?:AbortSignal)=>{
    check();const reply=await client.call(`${client.toolPrefix}_script`,args,{requestId,signal});
    if(reply.failed)throw Error('Dedicated script operation failed; inspect its original receipt');return reply;
  };
  const inspect=async(runId:number,signal?:AbortSignal)=>JSON.parse((await script({runId,waitMs:1000},randomUUID(),signal)).text);
  const run=async(args:Record<string,unknown>,id:string,signal:AbortSignal,onRun?:(value:{id:number;procedure?:{executionId?:string}})=>void)=>{
    const started=await client.call(`${client.toolPrefix}_script`,{...args,waitMs:0},{requestId:id,signal});
    const runId=started.execution?.evidence?.localId;
    if(!Number.isSafeInteger(runId)||Number(runId)<1)throw new PracticeUnknownEffect();
    onRun?.({id:Number(runId)});
    for(;;){
      signal.throwIfAborted();check();
      const value=await inspect(Number(runId),signal);
      onRun?.({...value,id:Number(runId)});
      if(value.status!=='running')return {...value,id:Number(runId)};
    }
  };
  const observe=async(fixture:PracticeCase,id:string,signal:AbortSignal):Promise<PracticeSnapshot>=>{
    const observation=await run({code:OBSERVE,durationMs:5000},id,signal);
    let value=observation.result;
    if(observation.resultTruncated===true){
      const values=[];
      for(const call of [1,2,3,4]){
        const detail=JSON.parse((await script({runId:observation.id,call},randomUUID(),signal)).text);
        if(detail.trace?.method!=='mineflayer'||!Object.hasOwn(detail.trace.result??{},'value'))throw new PracticeUnknownEffect();
        values.push(detail.trace.result.value);
      }
      value={health:values[0],dimension:values[1],position:values[2],items:values[3]};
    }
    if(observation.status!=='completed'||!value||!Array.isArray(value.items))throw new PracticeUnknownEffect();
    // Complete received inventory gives explicit zero for every registered fixture goal, never absence-as-zero.
    const inventory:Record<string,number>=Object.fromEntries(fixtures.filter(f=>f.goal.kind==='inventory-gain').map(f=>[(f.goal as {item:string}).item,0]));
    for(const item of value.items){
      if(typeof item?.name!=='string'||!Number.isSafeInteger(item.count)||item.count<0)throw new PracticeUnknownEffect();
      inventory[item.name]=(inventory[item.name]??0)+item.count;
    }
    if(typeof value.health!=='number'||!Number.isFinite(value.health))throw new PracticeUnknownEffect();
    return {at:Date.now(),instanceId:binding.instanceId,snapshotId:fixture.snapshotId,environmentVersion:fixture.environmentVersion,
      health:value.health,dimension:typeof value.dimension==='string'?value.dimension:null,position:value.position??null,inventory};
  };
  const port:PracticeExecutionPort={binding:structuredClone(binding),async execute(original,signal){
    const request=structuredClone(original);procedureId(request.methodId);
    if(!Number.isInteger(request.durationMs)||request.durationMs<1000||request.durationMs>120000)throw Error('Method duration must be 1000..120000ms');
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(request.trialId))throw Error('Invalid original trial ID');
    validatePracticeCandidate(request.candidate);options.validate?.(request.candidate);signal.throwIfAborted();check();
    if(!fixtures.some(f=>procedureHash(f)===procedureHash(request.fixture)))throw Error('Unconfigured or changed practice snapshot');
    if(busy)throw new PracticeUnknownEffect();
    const file=join(directory,`${request.trialId}.json`),requestHash=procedureHash({...request,binding});
    if(existsSync(active)&&JSON.parse(readFileSync(active,'utf8')).status!=='settled')throw new PracticeUnknownEffect();
    if(existsSync(file)){const prior=JSON.parse(readFileSync(file,'utf8'));if(prior.requestHash!==requestHash)throw Error('Trial identity changed');return prior.trial;}
    busy=true;let runId:number|null=null,executionId:string|null=null,dispatch=false;
    const pending=()=>write(active,{status:'pending',trialId:request.trialId,requestHash,runId,executionId,executeRequestId:`${request.trialId}:execute`});
    pending();
    const trial:PracticeTrial={trialId:request.trialId,caseId:request.fixture.id,candidateHash:procedureHash(request.candidate),binding,
      reference:null,executionId:null,reviewId:null,startedAt:Date.now(),endedAt:Date.now(),completed:false,cleanup:'settled',before:null,after:null};
    const phaseSignal=AbortSignal.any([signal,AbortSignal.timeout(request.durationMs+15000)]);
    try{
      const validation=await run({code:request.candidate.code,validate:true,durationMs:5000},`${request.trialId}:validate`,phaseSignal);
      if(validation.status!=='validated')throw Error('Candidate syntax validation failed');
      const listing=JSON.parse((await script({library:{op:'list',query:request.methodId,limit:20}},randomUUID(),phaseSignal)).text);
      const parent=listing.methods.find((v:{id:string})=>v.id===request.methodId)?.revision??null;
      const saved=JSON.parse((await script({library:{op:'save',id:request.methodId,parent,code:request.candidate.code,
        description:request.candidate.guidance.slice(0,800)||'Dedicated practice candidate',conditions:['Dedicated practice; explicit review before live reuse.'],validationRunId:validation.id}},`${request.trialId}:save`,phaseSignal)).text);
      trial.reference=saved.reference as ProcedureReference;
      dispatch=true;
      const reset=await options.control.reset(request.fixture,phaseSignal);
      if(reset.settled!==true||reset.snapshotId!==request.fixture.snapshotId||reset.environmentVersion!==request.fixture.environmentVersion)throw new PracticeUnknownEffect();
      trial.before=await observe(request.fixture,`${request.trialId}:before`,phaseSignal);trial.startedAt=Date.now();
      const execution=await run({procedure:trial.reference,params:request.candidate.params,durationMs:request.durationMs},`${request.trialId}:execute`,phaseSignal,value=>{
        runId=value.id;executionId=value.procedure?.executionId??executionId;pending();
      });
      runId=execution.id;executionId=execution.procedure?.executionId??null;
      if(!executionId)throw new PracticeUnknownEffect();
      if(await options.control.settle({trialId:request.trialId,runId,executionId},AbortSignal.timeout(5000))!=='settled')throw new PracticeUnknownEffect();
      trial.endedAt=Date.now();trial.executionId=executionId;trial.completed=execution.status==='completed';
      const receipt=JSON.parse((await script({library:{op:'evidence',id:request.methodId,executionId}},`${request.trialId}:evidence`,phaseSignal)).text) as ProcedureReceipt;
      if(receipt.executionId!==executionId||receipt.root.revision!==trial.reference!.revision||!Array.isArray(receipt.trace))throw new PracticeUnknownEffect();
      // Canonical receipt summaries omit args/results. Expand durable calls by ORIGINAL execution UUID.
      const trace=[] as Array<{call:number;method:string;args?:{steps?:unknown[]};result?:{done?:boolean;steps?:Array<{outcome:string}>}}>;
      for(const entry of receipt.trace as Array<{call:number;method:string}>){
        const expanded=JSON.parse((await script({library:{op:'evidence',id:request.methodId,executionId,call:entry.call}},randomUUID(),phaseSignal)).text);
        if(expanded.executionId!==executionId||expanded.root?.revision!==trial.reference!.revision||expanded.trace?.call!==entry.call||expanded.trace?.method!==entry.method)throw new PracticeUnknownEffect();
        trace.push(expanded.trace);
      }
      trial.sdkCalls=receipt.trace.length;
      trial.after=await observe(request.fixture,`${request.trialId}:after`,phaseSignal);
      trial.endedAt=trial.after.at;
      const assessment=assessPracticeTrial(trial,request.fixture,binding);
      const review=JSON.parse((await script({library:{op:'review',id:request.methodId,revision:trial.reference!.revision,executionId,
        outcome:assessment.achieved===null?'unknown':assessment.achieved?'achieved':'not-achieved',assessment:`Independent dedicated-server observation: ${assessment.reason}`,
        context:`${request.fixture.environmentVersion}/${request.fixture.snapshotId}; not live adoption`,measurements:assessment.measurements,
        counterexamples:['Fixed dedicated-server cases do not prove general survival.']}},`${request.trialId}:review`,phaseSignal)).text);
      trial.reviewId=review.id;
      write(file,{schema:'agent-mc.client-practice/v1',evidenceKind:'connected-minecraft-client',requestHash,trial,assessment,receipt,trace,
        actionSteps:trace.filter(r=>r.method==='do').reduce((n,r)=>n+(r.args?.steps?.length??0),0),
        failedActions:trace.filter(r=>r.method==='do'&&r.result?.done!==true).length});
      write(active,{status:'settled',trialId:request.trialId,requestHash});return structuredClone(trial);
    }catch(error){
      // Cancel the dedicated client's current method, then independently settle. Preserve pending on any ambiguity.
      if(dispatch){try{check();await client.call(`${client.toolPrefix}_script`,{stop:true},{requestId:`${request.trialId}:cancel`});await options.control.settle({trialId:request.trialId,runId,executionId},AbortSignal.timeout(5000));}catch{/* pending is retained; never stop a replacement body */}}
      else write(active,{status:'settled',trialId:request.trialId,requestHash,reason:'pre-dispatch-preparation-failed'});
      throw error;
    }finally{busy=false;}
  }};
  return {executor:port,fixtures:structuredClone(fixtures)};
}
