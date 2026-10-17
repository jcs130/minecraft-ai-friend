import type { GameplayRecord } from './assessment.ts';
import type { PolicySource } from '../../core/policy-evidence.ts';

/** Supplied by an explicit task evaluator, never synthesized from RPC/method completion. */
export interface PolicyGoalWitness {
  scopeKey:string; sourceId:string; executionId:string; success:boolean;
  evaluatorId:string; evaluatorRevision:string; evidenceRefs:string[];
}
const sources:PolicySource[]=['rule','learned','human','unknown'];
const empty=()=>Object.fromEntries(sources.map(k=>[k,0])) as Record<PolicySource,number>;
const fraction=(a:number,b:number)=>b?a/b:null;
function wilson(success:number,total:number) {
  if(!total)return null;
  const z=1.96,p=success/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,h=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;
  return [Math.max(0,c-h),Math.min(1,c+h)];
}
/** Count only unique operations; shadow recommendations never enter adoption/execution denominators. */
export function summarizePolicyUsage(records:Iterable<GameplayRecord>, options:{scopeKey:string;from:string;to:string}, witnesses:PolicyGoalWitness[]=[]) {
  const start=Date.parse(options.from),end=Date.parse(options.to);
  if(!/^[a-f0-9]{64}$/.test(options.scopeKey)||!Number.isFinite(start)||!Number.isFinite(end)||start>end)throw Error('Explicit scope and time window required');
  const latest=new Map<string,GameplayRecord>(),conflicts=new Set<string>();
  let shadow=0;
  const shadowIds=new Set<string>();
  for(const row of records) {
    if(row.scopeKey!==options.scopeKey)throw Error('Mixed game scopes');
    if(Date.parse(row.at)<start||Date.parse(row.at)>end)continue;
    if(row.kind==='policy-shadow'){if(!shadowIds.has(row.id)){shadow++;shadowIds.add(row.id);}continue;}
    if(row.kind!=='operation')continue;
    const old=latest.get(row.sourceId);
    if(!old||row.revision===old.revision||row.previousRevision===old.revision||Date.parse(row.updatedAt)>Date.parse(old.updatedAt))latest.set(row.sourceId,row);
    else if(Date.parse(row.updatedAt)===Date.parse(old.updatedAt)&&old.previousRevision!==row.revision)conflicts.add(row.sourceId);
  }
  const count=empty(),admitted=empty(),started=empty(),completed=empty(),terminal=empty(),progress=empty(),selected=empty();
  const verified=empty(),success=empty();
  const byVersion:Record<string,{source:string;layer:string;policyId:string|null;revision:string|null;operations:number;started:number;completed:number;terminal:number;goalVerified:number;goalSuccesses:number}>={};
  let unknownSelection=0,overrides=0,unmeasured=0,startEvidenceUnknown=0;
  const linkedWitnesses=new Map<string,PolicyGoalWitness|null>();
  for(const w of witnesses) {
    if(w.scopeKey!==options.scopeKey||typeof w.success!=='boolean'||!w.executionId||!w.evaluatorId||!w.evaluatorRevision||!w.evidenceRefs?.length)throw Error('Incomplete task evaluator evidence');
    const old=linkedWitnesses.get(w.sourceId);
    // Conflicting evaluator results remain unknown, independent of event ordering.
    if(old===undefined)linkedWitnesses.set(w.sourceId,w);
    else if(old===null||old.success!==w.success||old.executionId!==w.executionId)linkedWitnesses.set(w.sourceId,null);
  }
  for(const [id,row] of latest) {
    if(conflicts.has(id))continue;
    const p=row.policy;
    // A shadow tag accidentally attached to an operation is not proof of real provenance.
    const source=p&&p.mode!=='shadow'?p.source:'unknown';
    count[source]++;
    if(p?.selectedSource&&p.selectedSource!=='unknown'&&p.mode!=='shadow'){selected[p.selectedSource]++;if(source!=='unknown'&&p.selectedSource!==source)overrides++;}else unknownSelection++;
    const accepted=row.dispatch==='returned';
    const receipt=accepted&&!!row.executionId&&!!row.phase&&row.phase!=='unknown';
    if(receipt)admitted[source]++;
    // Failure/cancellation may occur during preflight; they do not prove that execution started.
    const began=receipt&&['running','completed','partial'].includes(row.phase??'');
    if(began)started[source]++;
    else if(receipt&&['failed','blocked','cancelled'].includes(row.phase??''))startEvidenceUnknown++;
    if(receipt&&row.terminal===true){terminal[source]++;if(row.phase==='completed')completed[source]++;}
    if(began&&['positive','mixed'].includes(row.assessment.label))progress[source]++;
    const key=JSON.stringify([source,p?.layer??'unknown',p?.policyId??null,p?.revision??null]);
    const version=byVersion[key]??={source,layer:p?.layer??'unknown',policyId:p?.policyId??null,revision:p?.revision??null,operations:0,started:0,completed:0,terminal:0,goalVerified:0,goalSuccesses:0};
    version.operations++;if(began)version.started++;if(began&&row.terminal===true&&row.phase==='completed')version.completed++;
    if(receipt&&row.terminal===true)version.terminal++;
    const w=linkedWitnesses.get(id);
    if(receipt&&row.terminal===true&&w&&w.executionId===row.executionId){verified[source]++;version.goalVerified++;if(w.success){success[source]++;version.goalSuccesses++;}}else unmeasured++;
  }
  const operationCount=Object.values(count).reduce((a,b)=>a+b,0),known=operationCount-count.unknown;
  return {protocol:'agent-mc-policy-usage/v1',scopeKey:options.scopeKey,from:options.from,to:options.to,
    operationCount,shadowRecommendations:shadow,conflictingOperations:conflicts.size,startEvidenceUnknown,policyAttributionCoverage:fraction(known,operationCount),
    submitted:count,selected,unknownSelection,admitted,started,terminal,completed,progressWitnessed:progress,overrides,
    // Missing provenance cannot masquerade as a 0% learned/rule share of all real actions.
    submittedShare:Object.fromEntries(sources.map(s=>[s,s!=='unknown'&&count.unknown?null:fraction(count[s],operationCount)])),
    submittedKnownSourceShare:Object.fromEntries(sources.filter(s=>s!=='unknown').map(s=>[s,fraction(count[s],known)])),
    startedShare:Object.fromEntries(sources.map(s=>[s,s!=='unknown'&&started.unknown?null:fraction(started[s],Object.values(started).reduce((a,b)=>a+b,0))])),
    completionRate:Object.fromEntries(sources.map(s=>[s,fraction(completed[s],terminal[s])])),
    goalVerified:verified,goalSuccesses:success,goalSuccessRate:Object.fromEntries(sources.map(s=>[s,fraction(success[s],verified[s])])),
    goalSuccessWilson95:Object.fromEntries(sources.map(s=>[s,wilson(success[s],verified[s])])),unmeasuredGoalOperations:unmeasured,
    byVersion:Object.values(byVersion).map(v=>({...v,completionRate:fraction(v.completed,v.terminal),goalSuccessRate:fraction(v.goalSuccesses,v.goalVerified),goalSuccessWilson95:wilson(v.goalSuccesses,v.goalVerified)})),causalComparison:false,
    meaning:'controller S1/S2 is not policy provenance; suggestions, admission, execution completion and verified goal success are separate; compare matched tasks/cohorts before claiming improvement'};
}

/** Bounded monitoring window. Source revisions replace each other instead of inflating call counts. */
export class PolicyUsageWindow {
  private rows=new Map<string,GameplayRecord>();
  private conflicts=new Map<string,GameplayRecord>();
  private evicted=0;
  private observedFrom=new Date().toISOString();
  constructor(private readonly scopeKey:string,private readonly maxRows=50000) {
    if(!Number.isSafeInteger(maxRows)||maxRows<1)throw Error('Invalid policy window bound');
  }
  observe(row:GameplayRecord) {
    if(row.scopeKey!==this.scopeKey)throw Error('Mixed policy monitor scopes');
    if(!['operation','policy-shadow'].includes(row.kind))return;
    if(Date.parse(row.at)<Date.now()-3600000)return;
    const key=row.kind==='operation'?row.sourceId:row.id;
    const old=this.rows.get(key);
    if(old) {
      if(row.revision===old.revision||old.previousRevision===row.revision||Date.parse(row.updatedAt)<Date.parse(old.updatedAt))return;
      if(row.previousRevision!==old.revision&&Date.parse(row.updatedAt)===Date.parse(old.updatedAt)) {
        this.conflicts.set(key,{...row,before:null,after:null,observation:null,intents:[],effects:[],decision:null});return;
      }
    }
    // Keep metadata only; grids/inventories are already stored in the archive.
    this.rows.delete(key);this.rows.set(key,{...row,before:null,after:null,observation:null,intents:[],effects:[],decision:null});
    while(this.rows.size>this.maxRows){const first=this.rows.keys().next().value!;this.rows.delete(first);this.conflicts.delete(first);this.evicted++;}
  }
  status(now=Date.now()) {
    const from=new Date(now-3600000).toISOString();
    for(const [key,row] of this.rows)if(Date.parse(row.at)<now-3600000){this.rows.delete(key);this.conflicts.delete(key);}
    return {...summarizePolicyUsage([...this.rows.values(),...this.conflicts.values()],{scopeKey:this.scopeKey,from,to:new Date(now).toISOString()}),
      observedFrom:this.observedFrom,shadowObservedFrom:this.observedFrom,shadowHistory:'current-recorder-process-only',capacityEvictions:this.evicted,
      coverage:this.evicted?'bounded-incomplete':'source-snapshot-and-live-revisions'};
  }
}
