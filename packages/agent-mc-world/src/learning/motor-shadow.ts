/** Explicit, local inference alongside live play. No control port and no teacher/future targets. */
import { readFile, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { normalizeDimension } from '../../core/escape.ts';
import { MOTOR_PROTOCOL, MOTOR_VERSION, MOTOR_ACTIONS, loadMotorPolicy, type MotorPolicy, type MotorObservation } from '../motor/policy.ts';
import type { GameplayRecord } from './assessment.ts';
export interface MotorShadowOptions { policyFile:string; sha256:string; experimentId:string; targetMaxAgeMs?:number }
export class MotorPolicyShadow {
  private target:GameplayRecord|null=null;
  private latestActionAt=-Infinity;
  private run=`shadow-${randomUUID()}`;
  private evaluated=0;
  private missingTarget=0;
  private missingObservation=0;
  private failures=0;
  private times:number[]=[];
  private actions:Record<string,number>={};
  private lastAt:string|null=null;
  private constructor(private readonly options:MotorShadowOptions,private readonly infer:(o:MotorObservation)=>number,
    private readonly append:(row:GameplayRecord)=>Promise<void>){}
  static async load(options:MotorShadowOptions,append:(row:GameplayRecord)=>Promise<void>) {
    if(!/^[a-f0-9]{64}$/.test(options.sha256)||!/^[\w:./@#-]{1,160}$/.test(options.experimentId)
      ||(options.targetMaxAgeMs!==undefined&&(!Number.isInteger(options.targetMaxAgeMs)||options.targetMaxAgeMs<1000||options.targetMaxAgeMs>120000)))throw Error('Invalid explicit motor shadow configuration');
    if((await stat(options.policyFile)).size>16*1024*1024)throw Error('Oversized motor policy');
    const bytes=await readFile(options.policyFile);
    if(bytes.length>16*1024*1024||createHash('sha256').update(bytes).digest('hex')!==options.sha256)throw Error('Motor shadow policy hash mismatch');
    const model=JSON.parse(bytes.toString('utf8')) as MotorPolicy;
    if(model.goalMode!=='final-target')throw Error('Shadow requires an independent final-target policy');
    return new MotorPolicyShadow(options,loadMotorPolicy(model),append);
  }
  observeOperation(row:GameplayRecord) {
    if(row.kind!=='operation')return;
    if(this.target?.sourceId===row.sourceId) {
      if(row.terminal===true||row.dispatch!=='returned'||!['accepted','running'].includes(row.phase??''))this.target=null;
      return;
    }
    if(!row.operations.some(x=>['goto','move','control','flight','surface','collect','attack','craft','cast','interact','place','dig'].includes(x)))return;
    const at=Date.parse(row.at);if(at<this.latestActionAt)return;this.latestActionAt=at;this.target=null;
    if(!row.operations.includes('goto')||!row.operations.every(x=>['goto','look'].includes(x))||row.terminal===true||row.dispatch!=='returned'
      ||!row.executionId||!['accepted','running'].includes(row.phase??'')||!row.intents.some(x=>x.skill==='goto'&&(x.at||x.toward)))return;
    this.target=row;
  }
  async observe(row:GameplayRecord,now=Date.now()) {
    if(row.kind!=='observation')return;
    const target=this.target,o=row.observation;
    if(!target||target.scopeKey!==row.scopeKey||now-Date.parse(target.at)>(this.options.targetMaxAgeMs??30000)
      ||Date.parse(row.at)<Date.parse(target.at)||!target.before?.dimension||!o?.dimension
      ||normalizeDimension(target.before.dimension)!==normalizeDimension(o.dimension)){this.missingTarget++;return;}
    const goal=target.intents.filter(x=>x.skill==='goto').map(x=>x.at??x.toward).find(Boolean);
    if(!goal||!o?.position||!o.velocity||typeof o.yaw!=='number'||typeof o.onGround!=='boolean'||o.voxels?.length!==245
      ||o.voxels.filter(x=>x&1).length<221||now-Date.parse(o.at)>1000||Date.parse(o.at)>now+50){this.missingObservation++;return;}
    try {
      const input:MotorObservation={protocol:MOTOR_PROTOCOL,minecraftVersion:MOTOR_VERSION,tick:null,position:o.position,
        velocity:o.velocity,yaw:o.yaw,onGround:o.onGround,goal,goalMode:'final-target',voxels:o.voxels};
      const started=performance.now(),index=this.infer(input),elapsed=performance.now()-started,action=MOTOR_ACTIONS[index]?.name;
      if(!action)throw Error('Invalid motor policy output');
      const featureHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const id=createHash('sha256').update(JSON.stringify([this.run,row.id,target.sourceId,this.options.sha256])).digest('hex');
      const proposal:GameplayRecord={...row,id,sourceId:id,revision:id,sourceHash:id,previousRevision:null,kind:'policy-shadow',run:this.run,
        operations:['goto'],intents:[{skill:'goto',at:goal}],requestId:target.requestId,executionId:null,
        phase:null,terminal:null,dispatch:null,before:null,after:null,
        policy:{layer:'motor',source:'learned',policyId:'motor-mlp',revision:this.options.sha256,mode:'shadow',
          experimentId:this.options.experimentId,episodeId:target.sourceId,action,baselineAction:null,selectedSource:null,
          candidateProbability:0,featureHash,inputRef:row.id,inferenceMs:elapsed},
        boundary:'shadow-proposal-only-no-body-dispatch',
        assessment:{label:'unknown',reasons:['counterfactual-outcome-unobserved'],signals:[],trainingUse:'shadow-review',goalVerified:false}};
      await this.append(proposal);
      this.evaluated++;this.lastAt=o.at;this.times.push(elapsed);if(this.times.length>1024)this.times.shift();this.actions[action]=(this.actions[action]??0)+1;
    }catch {this.failures++;}
  }
  status() {
    const values=[...this.times].sort((a,b)=>a-b),q=(p:number)=>values.length?values[Math.floor((values.length-1)*p)]:null;
    return {mode:'shadow',policyId:'motor-mlp',revision:this.options.sha256,experimentId:this.options.experimentId,evaluated:this.evaluated,
      missingTarget:this.missingTarget,missingObservation:this.missingObservation,failures:this.failures,lastAt:this.lastAt,
      inferenceMs:{sampleSize:values.length,p50:q(.5),p95:q(.95)},proposedActions:{...this.actions},
      baselineActionsKnown:false,agreementRate:null,executedActions:0,goalSuccessRate:null,bodyControlCalls:0};
  }
}
