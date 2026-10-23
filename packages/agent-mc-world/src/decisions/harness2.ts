/** Optional Harness2 host service. Explicit run, injected model, isolated executor. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { procedureHash, procedureId } from '../../core/support/procedure.ts';
import { assessPracticeTrial, gatePracticeCandidate, validatePracticeCandidate, validatePracticeCase,
  type PracticeCandidate, type PracticeCase, type PracticeExecutionPort, type PracticeTrial, type PracticeAssessment } from '../learning/practice.ts';

export const HARNESS2_REVISION = '1cfe254e8d25b15f37048c3730134686abe60335';
export const HARNESS2_SCHEMA = 'agent-mc.harness2/v1';
export interface Harness2ModelRequest {
  id: string; stage: string; mission: string; files: Record<string,string>;
}
export interface Harness2ModelReply {
  /** Only the three declared method files are editable. Omitted files inherit. */
  files?: Record<string,string>;
  choice?: string;
  experience?: { cue: string; lesson: string; evidence: string; confidence?: string };
  notes?: string;
  usage?: { inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null };
}
export interface Harness2Job {
  id: string; methodId: string; sourceInstanceId: string;
  scope: { realm: string; account: string; agent: string };
  /** Game-only instructions. Never pass a host conversation, secrets or private persona. */
  task: string; baseline: PracticeCandidate; train: PracticeCase; holdout: PracticeCase[];
  /** Retrieved from canonical game memory by the host, not a second authoritative notebook. */
  lessons?: Array<{ cue: string; lesson: string; evidenceRefs: string[] }>;
  mode: 'parallel' | 'sequential'; k: number;
  /** success preserves the original gate; balanced also evaluates equal-success SDK work savings. */
  objective?:'success'|'balanced';
  budget: { modelCalls: number; trials: number; wallMs: number; trialMs: number; contextBytes: number };
}
export interface Harness2Result {
  schema: typeof HARNESS2_SCHEMA; jobId: string; jobHash: string; upstreamRevision: string;
  modelCalls: number; trials: number; selected: PracticeCandidate | null;
  selectedTrialId: string | null; selectedReference: PracticeTrial['reference'];
  train: { baseline: PracticeAssessment; candidate: PracticeAssessment | null };
  holdout: Array<{ caseId: string; baseline: PracticeAssessment; candidate: PracticeAssessment }>;
  gate: { eligible: boolean; reason: string; adopted: false };
  experience: NonNullable<Harness2ModelReply['experience']> | null;
  /** Every exact trial remains in the metadata journal and scoped MethodLibrary. */
  evidenceRefs: string[]; adopted: false;
  comparison?:import('../learning/harness-evaluation.ts').PracticeFrontier;
  optimizationUsage?:{modelCalls:number;trials:number;inputTokens:number|null;cachedTokens:number|null;outputTokens:number|null};
}
export interface Harness2Options {
  directory: string;
  /** Explicit Linux Python, or `wsl` plus --exec Python prefix arguments. No shell expansion. */
  worker: { command: string; args?: string[]; script?: string; workspace: string };
  model: { id: string; generate(request: Harness2ModelRequest, signal: AbortSignal): Promise<Harness2ModelReply> };
  practice: PracticeExecutionPort;
  /** Optional retrieval from existing game memory, snapshotted once per job for stable resume. */
  recall?(query: string,signal: AbortSignal): Promise<NonNullable<Harness2Job['lessons']>>;
  /** Optional explicit bridge into the host's existing game-memory system. No auto-adoption. */
  remember?(result: Harness2Result, signal: AbortSignal): Promise<void>;
}
interface RpcRecord { kind: 'model' | 'trial'; phase: 'pending' | 'returned'; hash: string; value?: unknown;
  startedAt?: number; endedAt?: number; caseId?: string; group?: 'train' | 'holdout'; role?: 'baseline' | 'candidate' }
export type Harness2Phase = 'preparing' | 'propose' | 'probe' | 'compose' | 'select' | 'reflect' | 'holdout' | 'remember' | 'settled';
export interface Harness2Progress {
  scopeHash: string; configurationHash: string; startedAt: number; updatedAt: number; endedAt: number | null; phase: Harness2Phase;
  budget: Harness2Job['budget']; mode: Harness2Job['mode']; k: number;
}
interface Journal {
  schema: typeof HARNESS2_SCHEMA; jobHash: string; status: 'running' | 'completed' | 'blocked' | 'failed';
  modelCalls: number; trials: number; rpc: Record<string,RpcRecord>; result?: Harness2Result;
  reason?: string; memory: 'pending' | 'stored' | 'disabled';
  progress?: Harness2Progress;
  failure?:{kind:'model'|'trial'|'protocol';stage:string;category:string};
}

function abortable<T>(work: Promise<T>,signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolveWork,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('Harness2 operation cancelled'));};
    signal.addEventListener('abort',abort,{once:true});
    work.then(value=>{signal.removeEventListener('abort',abort);resolveWork(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
    if(signal.aborted)abort();
  });
}

/** Package-resident worker, hashed in both source and installed builds. */
export function harness2WorkerPath(): string {
  return fileURLToPath(new URL('../../bridges/harness2/worker.py',import.meta.url));
}
function validateJob(job: Harness2Job): void {
  procedureId(job.id); procedureId(job.methodId); validatePracticeCandidate(job.baseline); validatePracticeCase(job.train);
  if (!job.sourceInstanceId || !job.scope || !Object.values(job.scope).every(s=>typeof s==='string' && s.length>0 && s.length<=200)
    || typeof job.task !== 'string' || !job.task.trim() || job.task.length>6000
    || !['parallel','sequential'].includes(job.mode) || !Number.isInteger(job.k) || job.k<1 || job.k>4) throw Error('Invalid bounded Harness2 job');
  if(job.objective!==undefined&&!['success','balanced'].includes(job.objective))throw Error('Invalid practice objective');
  if (!Array.isArray(job.holdout) || job.holdout.length<1 || job.holdout.length>8) throw Error('At least one independent held-out fixture is required');
  const cases = [job.train,...job.holdout]; cases.forEach(validatePracticeCase);
  if (new Set(cases.map(c=>c.id)).size!==cases.length || new Set(cases.map(c=>c.snapshotId)).size!==cases.length
    || cases.some(c=>c.environmentVersion!==job.train.environmentVersion)) throw Error('Practice fixtures must be distinct and use one environment version');
  const b = job.budget;
  if (!b || !Object.values(b).every(Number.isInteger) || b.modelCalls<1 || b.modelCalls>40 || b.trials<4*job.k+2*job.holdout.length
    || b.trials>48 || b.wallMs<1000 || b.wallMs>3600000 || b.trialMs<1000 || b.trialMs>120000
    || b.contextBytes<10000 || b.contextBytes>1000000) throw Error('Invalid explicit Harness2 budget');
  if (job.lessons && (!Array.isArray(job.lessons) || job.lessons.length>8 || job.lessons.some(l=>
    !l || typeof l.cue!=='string' || l.cue.length>400 || typeof l.lesson!=='string' || l.lesson.length>1600
    || !Array.isArray(l.evidenceRefs) || !l.evidenceRefs.length || l.evidenceRefs.length>8
    || l.evidenceRefs.some(r=>typeof r!=='string'||r.length>256)))) throw Error('Lessons require bounded canonical evidence references');
}

export class Harness2Runner {
  private running = false;
  constructor(private readonly options: Harness2Options) {}
  async run(job: Harness2Job, signal?: AbortSignal): Promise<Harness2Result> {
    validateJob(job);
    job=structuredClone(job);
    const configurationHash=procedureHash(job);
    const binding = structuredClone(this.options.practice.binding);
    if (binding.isolated!==true || binding.instanceId===job.sourceInstanceId
      || binding.realm===job.scope.realm) throw Error('Practice requires a separate instance and realm from the source Agent');
    signal?.throwIfAborted();
    if (this.running) throw Error('A Harness2 job is already running');
    const directory = join(resolve(this.options.directory),job.id); mkdirSync(directory,{recursive:true});
    const inputHash = procedureHash({job,binding,model:this.options.model.id,upstream:HARNESS2_REVISION});
    let jobHash=inputHash,ownsJournal=false;
    const journalFile = join(directory,'journal.json'), lockFile = join(directory,'run.lock');
    const lock = openSync(lockFile,'wx'); this.running = true;
    let journal: Journal = {schema:HARNESS2_SCHEMA,jobHash,status:'running',modelCalls:0,trials:0,rpc:{},memory:this.options.remember?'pending':'disabled'};
    const save = () => {
      if(journal.progress) journal.progress.updatedAt=Date.now();
      const temp=join(directory,`${randomUUID()}.tmp`); writeFileSync(temp,JSON.stringify(journal),{flag:'wx',mode:0o600}); renameSync(temp,journalFile);
    };
    let child: ReturnType<typeof spawn> | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort(Error('Harness2 cancelled'));
    signal?.addEventListener('abort',abort,{once:true}); if (signal?.aborted) abort();
    const timer = setTimeout(()=>controller.abort(Error('Harness2 wall budget exhausted')),job.budget.wallMs);
    let fatal = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let queue: Promise<unknown> = Promise.resolve();
    try {
      const contextFile=join(directory,'game-context.json');
      let evidenceId:string;
      if(existsSync(contextFile)) {
        const context=JSON.parse(readFileSync(contextFile,'utf8'));
        if(context.inputHash!==inputHash)throw Error('Job identity/configuration changed; use a new job ID');
        if(typeof context.evidenceId!=='string'||!/^[a-f0-9-]{36}$/.test(context.evidenceId))throw Error('Practice evidence identity unavailable; preserve the original context');
        evidenceId=context.evidenceId;
        job.lessons=context.lessons;
      } else {
        if(existsSync(journalFile))throw Error('Existing evidence has no matching context; explicit reconciliation required');
        const lessons=this.options.recall?await abortable(this.options.recall(job.task,controller.signal),controller.signal):[];
        job.lessons=[...(job.lessons??[]),...lessons].slice(0,8);validateJob(job);
        evidenceId=randomUUID();
        writeFileSync(contextFile,JSON.stringify({inputHash,evidenceId,lessons:job.lessons}),{flag:'wx',mode:0o600});
      }
      validateJob(job);
      // A fresh evidence book cannot silently reuse another book's upstream rollout cache.
      jobHash=procedureHash({job,binding,model:this.options.model.id,upstream:HARNESS2_REVISION,evidenceId});
      journal.jobHash=jobHash;
      if (existsSync(journalFile)) {
        const prior=JSON.parse(readFileSync(journalFile,'utf8')) as Journal;
        if (prior.schema!==HARNESS2_SCHEMA || prior.jobHash!==jobHash) throw Error('Job identity/configuration changed; preserve the previous evidence and use a new job ID');
        journal=prior; ownsJournal=true;
        if (journal.status==='completed' && journal.result) return structuredClone(journal.result);
        // A crashed or interrupted job never replays a model call, reset or physical trial.
        journal.status='blocked'; journal.reason='explicit-reconciliation-required'; save();
        throw Error('Previous job is incomplete; inspect original evidence before explicitly starting a new job');
      }
      journal.progress={scopeHash:procedureHash(job.scope),configurationHash,startedAt:Date.now(),updatedAt:Date.now(),endedAt:null,
        phase:'preparing',budget:job.budget,mode:job.mode,k:job.k};
      ownsJournal=true;save();
      heartbeat=setInterval(()=>{try{if(ownsJournal&&journal.status==='running')save();}
        catch{controller.abort(Error('Experiment journal is unavailable'));}},5000); heartbeat.unref();
      const execute = async (label: string,candidate: PracticeCandidate,fixture: PracticeCase) => {
        controller.signal.throwIfAborted(); if (fatal) throw Error('Job stopped'); validatePracticeCandidate(candidate);
        const trialId=procedureHash({jobHash,label}), hash=procedureHash({candidate,fixture});
        const previous=journal.rpc[trialId];
        if(previous){
          if(previous.kind!=='trial'||previous.hash!==hash||previous.phase!=='returned')throw Error('Duplicate or unresolved original trial');
          return structuredClone(previous.value) as {trial:PracticeTrial;assessment:PracticeAssessment};
        }
        if (journal.trials>=job.budget.trials) throw Error('Practice trial budget exhausted');
        journal.trials++;
        const startedAt=Date.now(), group=label.startsWith('holdout:')?'holdout':'train';
        const role=group==='holdout'?(label.endsWith(':baseline')?'baseline':'candidate')
          :label.split('/').at(-1)?.startsWith('base')?'baseline':'candidate';
        if(journal.progress)journal.progress.phase=group==='holdout'?'holdout':'probe';
        journal.rpc[trialId]={kind:'trial',phase:'pending',hash,startedAt,caseId:fixture.id,group,role}; save();
        try {
          const trial=await abortable(this.options.practice.execute({trialId,methodId:job.methodId,candidate,fixture,durationMs:job.budget.trialMs},controller.signal),controller.signal);
          if (trial.trialId!==trialId || trial.candidateHash!==procedureHash(candidate) || procedureHash(trial.binding)!==procedureHash(binding)
            || trial.caseId!==fixture.id || trial.cleanup!=='settled') throw Error('Practice evidence identity mismatch');
          const assessment=assessPracticeTrial(trial,fixture,binding);
          journal.rpc[trialId]={...journal.rpc[trialId],phase:'returned',endedAt:Date.now(),value:{trial,assessment}}; save();
          return {trial,assessment};
        } catch (error) { fatal=true; journal.status='blocked'; journal.reason='trial-effect-or-cleanup-unknown'; save(); controller.abort(); throw error; }
      };
      const baselineTrials: Array<{trial:PracticeTrial;assessment:PracticeAssessment}>=[];
      const byRun=new Map<string,{trial:PracticeTrial;assessment:PracticeAssessment}>();
      const rpc = async (message: any): Promise<unknown> => {
        if (fatal) throw Error('Job stopped'); controller.signal.throwIfAborted();
        if (message.op==='trial') {
          const value=await execute(`probe:${message.runId}`,message.candidate,job.train);
          byRun.set(message.runId,value);
          if (String(message.runId).split('/').at(-1)?.startsWith('base')) baselineTrials.push(value);
          return value;
        }
        if (message.op!=='model') throw Error('Unknown Harness2 operation');
        const request: Harness2ModelRequest={id:procedureHash({jobHash,label:message.label}),stage:message.label,mission:message.mission,files:message.files};
        if (Buffer.byteLength(JSON.stringify(request))>job.budget.contextBytes) throw Error('Model context byte budget exhausted');
        if(journal.rpc[request.id])throw Error('Duplicate model invocation is not authorized');
        if (journal.modelCalls>=job.budget.modelCalls) throw Error('Model call budget exhausted');
        journal.modelCalls++;
        const label=String(message.label);
        if(journal.progress)journal.progress.phase=label.startsWith('select.')?'select':label.startsWith('experience.')?'reflect'
          :label.startsWith('agg')?'compose':'propose';
        journal.rpc[request.id]={kind:'model',phase:'pending',hash:procedureHash(request),startedAt:Date.now()}; save();
        const reply=await abortable(this.options.model.generate(request,controller.signal),controller.signal);
        controller.signal.throwIfAborted();
        if (!reply || Buffer.byteLength(JSON.stringify(reply))>40000) throw Error('Invalid bounded model reply');
        // Only counts/hashes persist here. The worker stores validated game-method artifacts, never raw model prose/thoughts.
        const usage=reply.usage;
        const metadata=usage ? Object.fromEntries(['inputTokens','outputTokens','cachedTokens'].map(k=>{
          const v=usage[k as keyof typeof usage]; return [k,Number.isSafeInteger(v)&&Number(v)>=0?v:null]; })) : null;
        journal.rpc[request.id]={...journal.rpc[request.id],phase:'returned',endedAt:Date.now(),value:{usage:metadata,replyHash:procedureHash(reply)}}; save();
        return reply;
      };
      child=spawn(this.options.worker.command,[...(this.options.worker.args??[]),this.options.worker.script??harness2WorkerPath()],{
        stdio:['pipe','pipe','pipe'],windowsHide:true,
        // Models stay in the host. Never forward model credentials into the optimizer worker.
        env:Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(?:PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|WSLENV|LANG|HOME)$/i.test(k))) as NodeJS.ProcessEnv,
      });
      let stderrBytes=0;
      child.stderr!.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;}); // Never persist arbitrary subprocess output.
      const stop=()=>{child?.stdin?.end(); child?.kill();};
      controller.signal.addEventListener('abort',stop,{once:true});
      let done: any;
      const finished=new Promise<void>((resolveFinished,reject)=>{
        child!.once('error',()=>reject(Error('Harness2 worker could not start')));
        child!.once('close',code=>code===0&&done?resolveFinished():reject(Error(`Harness2 worker stopped (${code}; ${stderrBytes} diagnostic bytes)`)));
      });
      const lines=createInterface({input:child.stdout!,crlfDelay:Infinity});
      child.stdin!.on('error',()=>{});
      let protocolError=false;
      lines.on('line',line=>{
        try {
          if (Buffer.byteLength(line)>2_000_000) throw Error('Worker frame too large');
          const message=JSON.parse(line);
          if (message.type==='done') { done=message.result; return; }
          if (message.type!=='rpc' || !Number.isSafeInteger(message.id)) throw Error('Invalid worker frame');
          // One dedicated body, serial probes. Concurrent upstream candidates do not become concurrent physical actions.
          queue=queue.then(async()=>{
            try { const value=await rpc(message); if (!child!.stdin!.destroyed) child!.stdin!.write(JSON.stringify({id:message.id,value})+'\n'); }
            catch(error) {
              const reason=error instanceof Error?error.message:'';
              journal.failure={kind:message.op==='trial'?'trial':message.op==='model'?'model':'protocol',
                stage:String(message.label??message.runId??'rpc').slice(0,100),
                category:error instanceof SyntaxError?'invalid-model-json':/HTTP \d{3}/.test(reason)?reason.match(/HTTP \d{3}/)![0]
                  :/budget/.test(reason)?'budget-exhausted':/Expected Harness2|Invalid bounded model|artifact/.test(reason)?'invalid-model-artifact':'port-failure'};
              // Optional prose reflection is not a candidate or a physical trial. Preserve its
              // failure and continue to independent evaluation with NO_ENTRY, never fake a lesson.
              const requestId=procedureHash({jobHash,label:message.label}),pending=journal.rpc[requestId];
              if(message.op==='model'&&String(message.label).startsWith('experience.')&&!controller.signal.aborted&&pending?.kind==='model'
                &&!Object.values(journal.rpc).some(r=>r.kind==='trial'&&r.phase==='pending')){
                journal.rpc[requestId]={...pending,phase:'returned',endedAt:Date.now(),value:{usage:null,reflectionUnavailable:true}};save();
                if(!child!.stdin!.destroyed)child!.stdin!.write(JSON.stringify({id:message.id,value:{notes:'Reflection unavailable; no reusable experience entry.'}})+'\n');
                return;
              }
              save();fatal=true;if(!controller.signal.aborted)controller.abort();
            }
          });
        } catch { protocolError=true; controller.abort(); }
      });
      child.stdin!.write(JSON.stringify({job,revision:HARNESS2_REVISION,workspace:this.options.worker.workspace,jobHash})+'\n');
      try { await finished; await queue; controller.signal.throwIfAborted(); }
      finally {
        if(!done&&!controller.signal.aborted)controller.abort();
        await queue;
        lines.close(); controller.signal.removeEventListener('abort',stop);
      }
      if (fatal || protocolError || !done || done.upstreamRevision!==HARNESS2_REVISION || !baselineTrials.length) throw Error('Incomplete Harness2 evidence');
      const chosen=byRun.get(done.selectedRunId);
      const selected: PracticeCandidate|null=done.candidate??null;
      if (selected) validatePracticeCandidate(selected);
      if (!selected || !chosen || chosen.trial.candidateHash!==procedureHash(selected)) throw Error('Selected candidate has no exact practice execution');
      const holdout: Harness2Result['holdout']=[];
      for (const fixture of job.holdout) {
        const base=await execute(`holdout:${fixture.id}:baseline`,job.baseline,fixture);
        const candidate=await execute(`holdout:${fixture.id}:candidate`,selected,fixture);
        holdout.push({caseId:fixture.id,baseline:base.assessment,candidate:candidate.assessment});
      }
      const base=baselineTrials[0].assessment;
      const gate=gatePracticeCandidate([base],[chosen.assessment],holdout.map(v=>v.baseline),holdout.map(v=>v.candidate),job.objective);
      // All reference probes must be known; differing baseline outcomes are an unstable fixture.
      if (baselineTrials.some(v=>v.assessment.achieved===null || v.assessment.achieved!==base.achieved)) {
        gate.eligible=false; gate.reason='unstable-baseline';
      }
      const experience=done.experience??null;
      const result: Harness2Result={schema:HARNESS2_SCHEMA,jobId:job.id,jobHash,upstreamRevision:HARNESS2_REVISION,
        modelCalls:journal.modelCalls,trials:journal.trials,selected,selectedTrialId:chosen.trial.trialId,selectedReference:chosen.trial.reference,
        train:{baseline:base,candidate:chosen.assessment},holdout,gate,experience,
        evidenceRefs:Object.entries(journal.rpc).filter(([,r])=>r.kind==='trial'&&r.phase==='returned').map(([id])=>id),adopted:false};
      const {evaluatePracticeVariants}=await import('../learning/harness-evaluation.ts');
      const cohort=procedureHash({scope:job.scope,train:job.train,holdout:job.holdout});
      result.comparison=evaluatePracticeVariants({id:'baseline',revision:procedureHash(job.baseline),cohort,train:[base],holdout:holdout.map(v=>v.baseline)},
        [{id:job.id,revision:procedureHash(selected),cohort,train:[chosen.assessment],holdout:holdout.map(v=>v.candidate)}]);
      const models=Object.values(journal.rpc).filter(r=>r.kind==='model'&&r.phase==='returned');
      const total=(key:string)=>{const values=models.map(r=>(r.value as {usage?:Record<string,unknown>})?.usage?.[key]);
        return values.length&&values.every(v=>Number.isSafeInteger(v)&&Number(v)>=0)?values.reduce<number>((sum,v)=>sum+Number(v),0):null;};
      result.optimizationUsage={modelCalls:journal.modelCalls,trials:journal.trials,inputTokens:total('inputTokens'),cachedTokens:total('cachedTokens'),outputTokens:total('outputTokens')};
      // A host memory failure cannot cause a repeated game trial on restart.
      journal.result=result; journal.status='completed';
      if(journal.progress){journal.progress.phase=this.options.remember?'remember':'settled';journal.progress.endedAt=Date.now();}save();
      if (this.options.remember) { try { await abortable(this.options.remember(structuredClone(result),controller.signal),controller.signal); journal.memory='stored'; save(); } catch { /* pending: host can retry memory delivery by jobHash, without replaying practice */ } }
      if(journal.progress)journal.progress.phase='settled';save();
      return structuredClone(result);
    } catch (error) {
      if (ownsJournal && journal.jobHash===jobHash && journal.status==='running') {
        const unknown=Object.values(journal.rpc).some(r=>r.kind==='trial'&&r.phase==='pending');
        if(journal.progress&&!unknown)journal.progress.endedAt=Date.now();
        journal.status=unknown?'blocked':'failed'; journal.reason=unknown?'trial-effect-or-cleanup-unknown':controller.signal.aborted?'cancelled-or-budget-exhausted':'worker-or-model-failure'; save();
      }
      throw error;
    } finally {
      if(heartbeat)clearInterval(heartbeat);
      clearTimeout(timer); signal?.removeEventListener('abort',abort); child?.stdin?.end(); child?.kill();
      closeSync(lock); unlinkSync(lockFile); this.running=false;
    }
  }
}
