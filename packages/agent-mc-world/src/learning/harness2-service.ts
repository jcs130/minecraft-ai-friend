/** Explicit host/model ports for asynchronous, evidence-bound method practice. */
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import type {ToolDef} from '../contracts/host.ts';
import {parseProcedure,procedureHash,procedureId,type ProcedureVersion} from '../../core/support/procedure.ts';
import {Harness2Runner,type Harness2Options,type Harness2Job,type Harness2ModelReply,type Harness2Result} from '../decisions/harness2.ts';
import {createHarness2Monitor} from '../decisions/harness2-monitor.ts';
import type {PracticeCase} from './practice.ts';

export const HARNESS2_PRACTICE_TOOL: Omit<ToolDef,'handler'>={
  name:'mc_practice',tags:['read','write'],
  description:'Improve an explicitly selected saved Minecraft method through Harness² in a separate practice environment. '
    +'help describes capabilities; start returns acceptance immediately, status/result read original measured trials, cancel stops that job. '
    +'result expands candidate source only on demand. Existing game memory stores evidence-linked lessons. '
    +'Practice eligibility never installs a method: validate/save a candidate in the source library, execute it in a suitable real task, '
    +'review actual terminal/net change, then explicitly adopt using mc_script library. No production body control or weight training.',
  parameters:{type:'object',additionalProperties:false,properties:{
    op:{type:'string',enum:['help','start','status','result','cancel']},
    id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,63}$'},
    methodId:{type:'string',pattern:'^[a-z][a-z0-9-]{0,63}$'},
    revision:{type:'string',pattern:'^[a-f0-9]{64}$'},
    task:{type:'string',minLength:1,maxLength:6000},
    params:{type:'object',maxProperties:32},
    mode:{type:'string',enum:['parallel','sequential']},
    k:{type:'integer',minimum:1,maximum:4},
  },required:['op']},
};
const validate=new Ajv({strict:false}).compile(HARNESS2_PRACTICE_TOOL.parameters);
export interface Harness2PracticeOptions {
  directory:string;
  worker:Harness2Options['worker'];
  model:Harness2Options['model'];
  practice:Harness2Options['practice'];
  fixtures:PracticeCase[];
  /** Environment capabilities and limits supplied by the actual practice adapter. */
  capability:string;
  budget:Harness2Job['budget'];
  source():{instanceId:string;scope:Harness2Job['scope']} | null;
  readMethod(id:string,revision:string,signal:AbortSignal):Promise<ProcedureVersion>;
  recall?:Harness2Options['recall']; remember?:Harness2Options['remember'];
  /** One final notification, containing metadata rather than generated source or private context. */
  settled?(event:{id:string;status:'completed'|'failed';eligible:boolean|null;error?:string}):Promise<void>;
}
interface RequestRecord {job:Harness2Job;source:ProcedureVersion;scopeHash:string;error?:string}

/** Parse a complete structured answer; truncated model output is rejected, never repaired into a candidate. */
export function parseHarness2ModelReply(text:string):Harness2ModelReply {
  if(typeof text!=='string'||Buffer.byteLength(text)>40000)throw Error('Harness2 model answer exceeds its artifact budget');
  const fenced=/^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(text);
  const reply=JSON.parse(fenced?fenced[1]:text);
  if(!reply||typeof reply!=='object'||Array.isArray(reply)
    ||Object.keys(reply).some(k=>!['files','choice','experience','notes'].includes(k)))throw Error('Expected Harness2 JSON files, choice or experience');
  return reply;
}

export class Harness2PracticeService {
  private readonly runner:Harness2Runner;
  private readonly records=new Map<string,RequestRecord>();
  private active:{id:string;controller:AbortController;promise:Promise<void>}|null=null;
  private starting=false;
  private closed=false;
  private monitor:ReturnType<typeof createHarness2Monitor>|null=null;
  private monitorIds='';
  private practiceScopeHash:string|null=null;
  constructor(private readonly options:Harness2PracticeOptions) {
    const check=()=>{if(this.source().scopeHash!==this.practiceScopeHash)throw Error('Practice source identity changed; memory delivery withheld');};
    this.runner=new Harness2Runner({...options,
      ...(options.recall?{recall:async(query,signal)=>{check();return options.recall!(query,signal);}}:{}),
      ...(options.remember?{remember:async(result,signal)=>{check();await options.remember!(result,signal);}}:{})});
    const file=join(options.directory,'requests.json');
    if(existsSync(file)){
      const rows=JSON.parse(readFileSync(file,'utf8'));
      if(!Array.isArray(rows)||rows.length>100)throw Error('Invalid practice request index');
      for(const row of rows){procedureId(row.job?.id);parseProcedure(row.source);this.records.set(row.job.id,row);}
    }
  }
  private persist():void {
    mkdirSync(this.options.directory,{recursive:true});
    const file=join(this.options.directory,`requests-${randomUUID()}.tmp`);
    writeFileSync(file,JSON.stringify([...this.records.values()]),{flag:'wx',mode:0o600});
    renameSync(file,join(this.options.directory,'requests.json'));this.monitor=null;
  }
  private source() {
    const source=this.options.source();
    if(!source)throw Error('Current source identity is unavailable; do not use an old world reading');
    return {...source,scopeHash:procedureHash(source.scope)};
  }
  private record(id:unknown):RequestRecord {
    const record=this.records.get(procedureId(id));
    if(!record||record.scopeHash!==this.source().scopeHash)throw Error('No practice job in the current realm/account/agent scope');
    return record;
  }
  snapshot() {
    const source=this.options.source(),scopeHash=source?procedureHash(source.scope):null;
    const jobs=[...this.records.values()].filter(r=>r.scopeHash===scopeHash).map(r=>r.job);
    // Recreate the cached reader only when the explicit job set or identity changes.
    const ids=procedureHash(jobs.map(j=>j.id));
    if(!this.monitor||this.monitorIds!==ids){
      this.monitor=createHarness2Monitor({directory:this.options.directory,jobs});this.monitorIds=ids;
    }
    return this.monitor.snapshot();
  }
  tool(name='mc_practice'):ToolDef {
    return {...HARNESS2_PRACTICE_TOOL,name,readOnlyCall:args=>['help','status','result'].includes(String(args.op)),
      handler:async(args,context)=>{
        try{return {text:JSON.stringify(await this.call(args,context.signal))};}
        catch(error){return {text:error instanceof Error?error.message:String(error),failed:true};}
      }};
  }
  async call(args:Record<string,unknown>,signal?:AbortSignal):Promise<unknown> {
    signal?.throwIfAborted();if(!validate(args))throw Error('Invalid practice parameters: '+new Ajv().errorsText(validate.errors));
    if(args.op==='help')return {available:!this.closed,capability:this.options.capability,budget:this.options.budget,
      fixtures:this.options.fixtures.map(f=>({id:f.id,environmentVersion:f.environmentVersion,goal:f.goal})),
      sourceMethod:'start needs id, methodId, exact revision and a game-only task. Read the saved source method first; private conversation is not input.',
      reuse:'result returns candidate and exact source parent. Validate/save with mc_script, execute a suitable natural task, review actual evidence and adopt explicitly. Practice is not live adoption.'};
    if(args.op==='status'){
      if(args.id!==undefined)this.record(args.id);
      const snapshot=this.snapshot();return args.id===undefined?snapshot:{...snapshot,jobs:snapshot.jobs.filter(j=>j.id===args.id)};
    }
    if(args.op==='result'){
      const row=this.record(args.id),view=this.snapshot().jobs.find(j=>j.id===args.id);
      if(view?.status!=='completed')return {status:view?.status??'unknown',error:row.error??null,result:null};
      const journal=JSON.parse(readFileSync(join(this.options.directory,row.job.id,'journal.json'),'utf8'));
      const result=journal.result as Harness2Result;
      return {status:'completed',result,source:{id:row.source.id,revision:row.source.revision,sourceHash:row.source.sourceHash},
        applicability:this.options.capability,next:'Candidate is isolated and unadopted. Recheck source parent before validate/save; retain the old version and test actual world change before review/adopt.'};
    }
    if(args.op==='cancel'){
      this.record(args.id);
      const active=this.active;
      if(!active||active.id!==args.id)return {cancelRequested:false,status:this.snapshot().jobs.find(j=>j.id===args.id)?.status??'unknown'};
      active.controller.abort();return {cancelRequested:true,settled:false,id:args.id};
    }
    if(this.closed)throw Error('Practice service is stopped');
    if(args.op!=='start'||!args.id||!args.methodId||!args.revision||!args.task)throw Error('start requires id, methodId, revision and task');
    if(this.starting||this.active)throw Error('A method practice job is already pending; inspect or cancel its original id');
    if(this.records.has(String(args.id)))throw Error('Practice job id already exists; inspect the original result, do not replay it');
    if(this.records.size>=100)throw Error('Practice request index full; retain and archive evidence before adding jobs');
    this.starting=true;
    try{
      const source=this.source();
      const method=parseProcedure(await this.options.readMethod(String(args.methodId),String(args.revision),signal??new AbortController().signal));
      signal?.throwIfAborted();if(this.closed)throw Error('Practice service is stopped');
      if(method.id!==args.methodId||method.revision!==args.revision)throw Error('Source method identity mismatch');
      if(Object.keys(method.dependencies).length)throw Error('This practice adapter needs a self-contained method; linked dependencies are not mounted');
      if(this.source().scopeHash!==source.scopeHash)throw Error('Source identity changed while preparing practice');
      const k=Number(args.k??1),holdout=this.options.fixtures.slice(1);
      const job:Harness2Job={id:String(args.id),methodId:method.id,sourceInstanceId:source.instanceId,scope:source.scope,
        task:String(args.task)+'\nPractice capabilities: '+this.options.capability,
        baseline:{code:method.code,params:(args.params??{}) as Record<string,unknown>,guidance:[method.description,...method.conditions].join('\n')},
        train:this.options.fixtures[0],holdout,mode:(args.mode??'parallel') as Harness2Job['mode'],k,budget:{...this.options.budget}};
      if(job.budget.trials<4*k+2*holdout.length)throw Error('Configured trial budget cannot cover this recursion and holdout set');
      const row:RequestRecord={job,source:method,scopeHash:source.scopeHash};
      this.records.set(job.id,row);this.persist();
      const controller=new AbortController();
      this.practiceScopeHash=source.scopeHash;
      const operation=(async()=>{
        let event:Parameters<NonNullable<Harness2PracticeOptions['settled']>>[0];
        try{const result=await this.runner.run(job,controller.signal);event={id:job.id,status:'completed',eligible:result.gate.eligible};}
        catch(error){row.error=error instanceof Error?error.message:String(error);this.persist();event={id:job.id,status:'failed',eligible:null,error:row.error};}
        this.monitor=null;
        try{await this.options.settled?.(event);}catch{/* Notification delivery does not rerun practice or alter its evidence. */}
      })();
      this.active={id:job.id,controller,promise:operation};
      void operation.finally(()=>{if(this.active?.promise===operation)this.active=null;});
      return {accepted:true,id:job.id,terminal:false,adopted:false,capability:this.options.capability,budget:job.budget};
    }finally{this.starting=false;}
  }
  async close():Promise<void>{this.closed=true;this.active?.controller.abort();await this.active?.promise;}
}
