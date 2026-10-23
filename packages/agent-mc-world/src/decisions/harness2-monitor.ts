/** Read-only, bounded projection of explicitly configured experiments. No directory discovery or model/body calls. */
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { procedureHash, procedureId } from '../../core/support/procedure.ts';
import type { Harness2Job, Harness2Phase } from './harness2.ts';

export const EXPERIMENTS_SCHEMA = 'agent-mc.experiments/v1';
export interface ExperimentAssessment {
  achieved: boolean | null;
  measurements: { distance: number | null; gained: number | null; healthLoss: number | null; elapsedMs: number | null; sdkCalls?:number|null };
}
export interface ExperimentView {
  id: string; methodId: string; status: 'not-started' | 'running' | 'completed' | 'blocked' | 'failed' | 'unknown';
  phase: Harness2Phase | null; stale: boolean; startedAt: number | null; updatedAt: number | null; endedAt: number | null;
  mode: 'parallel' | 'sequential'; k: number; budget: Harness2Job['budget'];
  modelCalls: number | null; trials: number | null; memory: 'pending' | 'stored' | 'disabled' | 'unknown';
  failure:{kind:'model'|'trial'|'protocol';stage:string;category:string}|null;
  usage: { inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null; returnedCalls: number; usageSamples: number };
  timeline: Array<{ id: string; kind: 'model' | 'trial'; phase: 'pending' | 'returned'; startedAt: number | null; endedAt: number | null;
    caseId: string | null; group: 'train' | 'holdout' | null; role: 'baseline' | 'candidate' | null; assessment: ExperimentAssessment | null }>;
  result: { eligible: boolean | null; adopted: false; evidenceCount: number | null;
    train: { baseline: ExperimentAssessment | null; candidate: ExperimentAssessment | null };
    holdout: Array<{ caseId: string; baseline: ExperimentAssessment | null; candidate: ExperimentAssessment | null }> } | null;
}
export interface ExperimentsSnapshot {
  schema: typeof EXPERIMENTS_SCHEMA; sampledAt: number; enabled: boolean; scope: 'isolated-practice-only'; jobs: ExperimentView[];
}
const phases: Harness2Phase[]=['preparing','propose','probe','compose','select','reflect','holdout','remember','settled'];
const count=(v:unknown):number|null=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):null;
const number=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const time=(v:unknown)=>typeof v==='number'&&v>0&&Number.isSafeInteger(v)?v:null;
function assessment(v:any):ExperimentAssessment|null {
  if(!v||typeof v!=='object')return null;
  return {achieved:typeof v.achieved==='boolean'?v.achieved:null,measurements:{distance:number(v.measurements?.distance),
    gained:number(v.measurements?.gained),healthLoss:number(v.measurements?.healthLoss),elapsedMs:number(v.measurements?.elapsedMs),sdkCalls:count(v.measurements?.sdkCalls)}};
}
/** One cached reader per host. Multiple browser pages share the same two-second file sample. */
export function createHarness2Monitor(options:{directory:string;jobs:readonly Harness2Job[];enabled?:boolean;now?:()=>number}) {
  if(options.jobs.length>100)throw Error('At most 100 explicit monitored jobs');
  const jobs=structuredClone(options.jobs), root=resolve(options.directory), now=options.now??Date.now;
  for(const j of jobs){procedureId(j.id);procedureId(j.methodId);}
  if(new Set(jobs.map(j=>j.id)).size!==jobs.length)throw Error('Duplicate monitored job ID');
  let cached:ExperimentsSnapshot|undefined;
  return {snapshot():ExperimentsSnapshot {
    const at=now();if(cached&&at>=cached.sampledAt&&at-cached.sampledAt<2000)return structuredClone(cached);
    const views=jobs.map((job):ExperimentView=>{
      const view:ExperimentView={id:job.id,methodId:job.methodId,status:'not-started',phase:null,stale:false,startedAt:null,updatedAt:null,endedAt:null,
        mode:job.mode,k:job.k,budget:structuredClone(job.budget),modelCalls:null,trials:null,memory:'unknown',failure:null,
        usage:{inputTokens:null,outputTokens:null,cachedTokens:null,returnedCalls:0,usageSamples:0},timeline:[],result:null};
      const file=join(root,job.id,'journal.json');let j:any;
      try{if(statSync(file).size>2_000_000)throw Error('Oversized journal');j=JSON.parse(readFileSync(file,'utf8'));}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')view.status='unknown';return view;}
      // Old or differently scoped journals cannot be presented as this Agent's experiment.
      if(j.schema!=='agent-mc.harness2/v1'||j.progress?.scopeHash!==procedureHash(job.scope)
        ||j.progress?.configurationHash!==procedureHash(job))return {...view,status:'unknown'};
      const p=j.progress;
      view.startedAt=time(p.startedAt);view.updatedAt=time(p.updatedAt);view.endedAt=time(p.endedAt);
      view.stale=j.status==='running'&&(!view.updatedAt||at-view.updatedAt>20000||at<view.updatedAt);
      view.status=view.stale?'unknown':['running','completed','blocked','failed'].includes(j.status)?j.status:'unknown';
      view.phase=phases.includes(p.phase)?p.phase:null;
      // Budget comes from this run, not a subsequently edited configuration.
      if(p.budget&&Object.keys(job.budget).every(k=>count(p.budget[k])!==null))view.budget=Object.fromEntries(Object.keys(job.budget).map(k=>[k,p.budget[k]])) as Harness2Job['budget'];
      if(['parallel','sequential'].includes(p.mode))view.mode=p.mode;if(Number.isInteger(p.k)&&p.k>=1&&p.k<=4)view.k=p.k;
      view.modelCalls=count(j.modelCalls);view.trials=count(j.trials);
      view.memory=['pending','stored','disabled'].includes(j.memory)?j.memory:'unknown';
      if(j.failure&&['model','trial','protocol'].includes(j.failure.kind)&&typeof j.failure.stage==='string'
        &&typeof j.failure.category==='string'&&/^[\w -]{1,80}$/.test(j.failure.category))
        view.failure={kind:j.failure.kind,stage:j.failure.stage.slice(0,100),category:j.failure.category};
      const cases=new Set([job.train.id,...job.holdout.map(f=>f.id)]);
      const entries=Object.entries(j.rpc??{}).slice(0,88).filter(([id,r]:any)=>/^[a-f0-9]{64}$/.test(id)&&['model','trial'].includes(r?.kind)&&['pending','returned'].includes(r.phase));
      view.timeline=entries.map(([id,r]:any)=>({id,kind:r.kind,phase:r.phase,startedAt:time(r.startedAt),endedAt:time(r.endedAt),
        caseId:cases.has(r.caseId)?r.caseId:null,group:['train','holdout'].includes(r.group)?r.group:null,
        role:['baseline','candidate'].includes(r.role)?r.role:null,assessment:r.kind==='trial'&&r.phase==='returned'?assessment(r.value?.assessment):null}));
      const models=entries.map(([,r])=>r as any).filter(r=>r.kind==='model'&&r.phase==='returned');
      view.usage.returnedCalls=models.length;view.usage.usageSamples=models.filter(r=>r.value?.usage).length;
      for(const k of ['inputTokens','outputTokens','cachedTokens'] as const){
        const values=models.map(r=>count(r.value?.usage?.[k]));view.usage[k]=values.length&&values.every(v=>v!==null)?values.reduce<number>((sum,v)=>sum+v!,0):null;
      }
      if(j.status==='completed'&&j.result?.jobId===job.id&&j.result?.jobHash===j.jobHash){const r=j.result;
        view.result={eligible:typeof r.gate?.eligible==='boolean'?r.gate.eligible:null,adopted:false,evidenceCount:Array.isArray(r.evidenceRefs)?r.evidenceRefs.length:null,
          train:{baseline:assessment(r.train?.baseline),candidate:assessment(r.train?.candidate)},
          holdout:job.holdout.map(f=>{const row=Array.isArray(r.holdout)?r.holdout.find((v:any)=>v.caseId===f.id):null;
            return {caseId:f.id,baseline:assessment(row?.baseline),candidate:assessment(row?.candidate)};})};
      }
      return view;
    });
    cached={schema:EXPERIMENTS_SCHEMA,sampledAt:at,enabled:options.enabled!==false,scope:'isolated-practice-only',jobs:views};
    return structuredClone(cached);
  }};
}
