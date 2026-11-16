/** Completed-trajectory JitRL. Host owns the evaluator; this book owns evidence,
 * discounted returns, revision selection and bounded retrieval. No model/body loop. */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { GameMemoryContext, GameMemoryScope } from './game-memory.ts';
import { experienceHash, operationActionHash, operationScopeKey, operationObservation, type OperationExperience, type OperationObservation } from './operation-experience.ts';
import { reweightJitRl } from './jitrl.ts';

const id = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().min(1).max(128).regex(/^[\w.:/@-]+$/);
const text = (max:number) => z.string().trim().min(1).max(max);
const revision = z.number().int().min(0);
// The advertised input and the executable validator must share one contract.
// Opaque `input: object` tools otherwise leave constrained decoders no fields
// to generate, even after prose help has described the correct arguments.
const evaluationSchemas = {
  trajectory_get: z.strictObject({episodeId:id,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(16).default(8)}),
  trajectory_score: z.strictObject({episodeId:id,expectedScoreRevision:revision,evaluator:z.strictObject({id:key,model:text(160).nullable(),version:key}),critique:text(1800),
    rewards:z.array(z.strictObject({experienceId:id,value:z.number().min(-1).max(1).nullable(),reason:text(800)})).max(128),
    offset:z.number().int().min(0).max(128).default(0),finalize:z.boolean().default(true)}),
  trajectory_review: z.strictObject({episodeId:id,expectedScoreRevision:revision,select:revision.nullable(),reason:text(1000)}),
};
export type TrajectoryEvaluationOperation = keyof typeof evaluationSchemas;
/** Public, fresh JSON Schema for on-demand or task-scoped SDK/MCP tools. */
export function trajectoryEvaluationInputSchema(operation:TrajectoryEvaluationOperation):Record<string,unknown> {
  const schema=evaluationSchemas[operation];
  if(!schema)throw Error('Unknown trajectory evaluation operation');
  const {$schema,...input}=schema.toJSONSchema({io:'input'});
  return input;
}
const metric = z.discriminatedUnion('kind', [
  z.strictObject({kind:z.literal('inventory'),item:key,target:z.number().positive().max(10000)}),
  z.strictObject({kind:z.enum(['food','health']),target:z.number().positive().max(10000)}),
  z.strictObject({kind:z.literal('distance'),target:z.number().positive().max(10000),destination:z.tuple([z.number(),z.number(),z.number()])}),
]);
const beginSchema=z.strictObject({taskKey:key, phase:key, goal:z.strictObject({id:key,revision:key,description:text(4000)}),
  method:z.strictObject({id:key,revision:key,parentRevision:key.nullable()}).optional(),
  gamma:z.number().min(0).max(1).default(.95),criterion:metric.optional(),
  conditions:z.record(key,z.union([z.number(),z.boolean(),z.null()])).refine(v=>Object.keys(v).length<=12).default({}),
  actor:key, taskId:key, assignmentId:key});
type Contract=z.infer<typeof beginSchema>;
type Step={experienceId:string; physicalId:string; snapshot:OperationExperience|null};
type Score={revision:number; parentRevision:number|null; digest:string; at:string; evaluator:{id:string;model:string|null;version:string};
  critique:string; rewards:Array<{experienceId:string;value:number|null;reason:string}>;
  returns:Array<{experienceId:string;return:number|null;normalized:number|null;horizon:number}>;
  nativeOutcome:{value:number|null;delta:number|null;reason:string}; source:'reflective-estimate';};
type Episode={schema:'agent-mc-trajectory/v1';id:string;scopeKey:string;createdAt:string;updatedAt:string;revision:number;
  contract:Contract;contractHash:string;run:string|null;dimension:string|null;steps:Step[];
  state:'open'|'closed';ending:null|{at:string;outcome:'completed'|'blocked'|'cancelled'|'unknown';note:string};
  scores:Score[];activeScore:number|null;reviews:Array<{at:string;revision:number|null;reason:string}>;
  scoringDraft?:{baseRevision:number;evaluator:Score['evaluator'];critique:string;rewards:Array<Score['rewards'][number]|null>};};
type EpisodeIndex={id:string;taskKey:string;phase:string;goalId:string;goalRevision:string;criterionHash:string;conditionsHash:string;
  state:Episode['state'];activeScore:number|null;updatedAt:string;steps:number;scoringRevision:number};

/** Unknown rewards taint their predecessors, rather than becoming zeros. */
export function discountedTrajectoryReturns(rewards:readonly (number|null)[],gamma:number) {
  if(!Number.isFinite(gamma)||gamma<0||gamma>1||rewards.length>128||rewards.some(r=>r!==null&&(!Number.isFinite(r)||r< -1||r>1)))throw Error('Invalid trajectory rewards/gamma');
  let value:number|null=0,normalizer=0;
  const rows:Array<{return:number|null;normalized:number|null;horizon:number}>=[];
  for(let i=rewards.length-1;i>=0;i--){
    value=rewards[i]===null||gamma!==0&&value===null?null:rewards[i]!+gamma*(value??0);
    normalizer=1+gamma*normalizer;
    rows.unshift({return:value,normalized:value===null?null:value/normalizer,horizon:rewards.length-i});
  }
  return rows;
}
const clamp=(x:number)=>Math.max(-1,Math.min(1,x));
function nativeOutcome(e:Episode):Score['nativeOutcome'] {
  const c=e.contract.criterion,a=e.steps[0]?.snapshot?.before,b=e.steps.at(-1)?.snapshot?.after;
  if(!c)return {value:null,delta:null,reason:'no-native-objective-metric'};
  if(e.ending?.outcome==='unknown'||e.ending?.outcome==='cancelled'||!a||!b||!a.dimension||a.dimension!==b.dimension)
    return {value:null,delta:null,reason:'incomplete-or-cross-dimension-outcome'};
  let delta:number|null=null;
  if(c.kind==='inventory'&&a.inventory&&b.inventory)delta=(b.inventory[c.item]??0)-(a.inventory[c.item]??0);
  if(c.kind==='food'&&a.food!==null&&b.food!==null)delta=b.food-a.food;
  if(c.kind==='health'&&a.health!==null&&b.health!==null)delta=b.health-a.health;
  if(c.kind==='distance'&&a.position&&b.position){const d=(p:NonNullable<typeof a.position>)=>Math.hypot(p.x-c.destination[0],p.y-c.destination[1],p.z-c.destination[2]);delta=d(a.position)-d(b.position);}
  return {value:delta===null?null:clamp(delta/c.target),delta,reason:delta===null?'missing-native-measurement':'whole-trajectory-net-change-not-causal-attribution'};
}
const physical=(r:OperationExperience)=>experienceHash([r.scopeKey,r.run,r.execution?.kind??'dispatch',r.execution?.id??r.id]);
const terminal=(r:OperationExperience)=>r.dispatch==='rejected'||r.dispatch==='returned'&&r.execution?.terminal===true;
const trusted=(r:OperationExperience)=>r.dispatch==='returned'&&r.execution?.terminal===true&&['completed','partial','blocked'].includes(r.execution.phase);
function comparable(x:OperationObservation|null,y:OperationObservation|null) {
  if(!x||!y||!x.dimension||x.dimension!==y.dimension)return false;
  return x.health!==null&&y.health!==null&&Math.abs(x.health-y.health)<=4&&x.food!==null&&y.food!==null&&Math.abs(x.food-y.food)<=4
    &&x.position&&y.position&&Math.hypot(x.position.x-y.position.x,x.position.y-y.position.y,x.position.z-y.position.z)<=16;
}

export const TRAJECTORY_OPERATIONS=['trajectory_help','trajectory_begin','trajectory_append','trajectory_close','trajectory_get',
  'trajectory_list','trajectory_score','trajectory_review','trajectory_rank','trajectory_recall','trajectory_use'] as const;
export const TRAJECTORY_READ_OPERATIONS=['trajectory_help','trajectory_get','trajectory_list','trajectory_recall'] as const;
export class JitRlTrajectoryBook {
  constructor(private readonly directory:string,private readonly getExperience:(scope:GameMemoryScope,id:string)=>OperationExperience){}
  private folder(scope:GameMemoryScope){return join(this.directory,'jitrl-trajectories',operationScopeKey(scope));}
  private path(scope:GameMemoryScope,episodeId:string){return join(this.folder(scope),id.parse(episodeId)+'.json');}
  private read(scope:GameMemoryScope,episodeId:string):Episode {
    const s=readFileSync(this.path(scope,episodeId),'utf8');if(Buffer.byteLength(s)>2_000_000)throw Error('Trajectory exceeds storage budget');
    const e=JSON.parse(s) as Episode;if(e.schema!=='agent-mc-trajectory/v1'||e.id!==episodeId||e.scopeKey!==operationScopeKey(scope))throw Error('Trajectory identity mismatch');return e;
  }
  private write(path:string,value:unknown){const s=JSON.stringify(value);if(Buffer.byteLength(s)>2_000_000)throw Error('Trajectory exceeds storage budget');
    mkdirSync(join(path,'..'),{recursive:true});const tmp=path+'.'+randomUUID()+'.tmp';
    try{writeFileSync(tmp,s,{flag:'wx',mode:0o600});renameSync(tmp,path);}finally{if(existsSync(tmp))unlinkSync(tmp);}}
  private index(scope:GameMemoryScope):EpisodeIndex[]{
    const path=join(this.folder(scope),'recent.json');
    return existsSync(path)?JSON.parse(readFileSync(path,'utf8')).slice(0,128):[];
  }
  private save(scope:GameMemoryScope,e:Episode){e.updatedAt=new Date().toISOString();this.write(this.path(scope,e.id),e);
    const row:EpisodeIndex={id:e.id,taskKey:e.contract.taskKey,phase:e.contract.phase,goalId:e.contract.goal.id,goalRevision:e.contract.goal.revision,
      criterionHash:experienceHash(e.contract.criterion),conditionsHash:experienceHash(e.contract.conditions),state:e.state,
      activeScore:e.activeScore,updatedAt:e.updatedAt,steps:e.steps.length,scoringRevision:e.scores.length};
    this.write(join(this.folder(scope),'recent.json'),[row,...this.index(scope).filter(x=>x.id!==e.id)].slice(0,128));}
  private brief(e:Episode){return {protocol:e.schema,episodeId:e.id,revision:e.revision,state:e.state,taskKey:e.contract.taskKey,
    phase:e.contract.phase,goal:e.contract.goal,taskId:e.contract.taskId,assignmentId:e.contract.assignmentId,steps:e.steps.length,
    scoringRevision:e.scores.length,activeScore:e.activeScore,ending:e.ending,nativeOutcome:e.state==='closed'?nativeOutcome(e):null,
    next:e.state==='open'?'append original operation IDs, then close after native terminals':'read complete steps, score each one, review before reuse',goalVerified:false};}
  help(){return {protocol:'agent-mc-trajectory/v1',operations:{
    trajectory_begin:'requestId + input:{taskKey,phase,goal:{id,revision,description},actor,taskId,assignmentId,method?:{id,revision,parentRevision},gamma?:0..1,criterion?:{kind:inventory|food|health|distance,target,item?,destination?},conditions?:numeric/boolean/null facts}. Bind goal before actions; changed goal starts another episode.',
    trajectory_append:'input:{episodeId,expectedRevision,experienceIds:[exact operation IDs]}. Up to 128 steps. Original physical task counted once; pending is not complete.',
    trajectory_close:'input:{episodeId,expectedRevision,outcome:completed|blocked|cancelled|unknown,note}. Freeze full native trajectory; waits for original terminals. No action replay.',
    trajectory_get:'input:{episodeId,offset?:0,limit?:8}. Paginated complete steps and latest score; follow nextOffset. Provenance and native outcomes are evidence; score is interpretation.',
    trajectory_score:'input:{episodeId,expectedScoreRevision,evaluator:{id,model:null|string,version},critique,rewards:[{experienceId,value:-1..1|null,reason}],offset?:0,finalize?:true}. Score EVERY step against the original goal and whole timeline. Long trajectories: submit pages with offset and finalize:false; finish with rewards:[],finalize:true. Only complete coverage creates a revision. Keep reasons concise. Unknown stays null; a draft is never reused.',
    trajectory_review:'input:{episodeId,expectedScoreRevision,select:revision|null,reason}. Explicitly adopt a complete reviewed score, or null to withdraw. Old revisions never multiply samples. No automatic body/code/skill promotion.',
    trajectory_rank:'requestId + input:{taskKey,phase,goalId,goalRevision,criterion?,conditions?,candidates:[{id,prior,ready,tool,args}],beta?:0..2}. Uses adopted multi-step returns in comparable scenes, not immediate rewards. Persisted decision links exact score revisions and original execution IDs. Replayed/expired advice must not drive a new action.',
    trajectory_recall:'input:{taskKey,goalId,goalRevision,limit?:3}. Compact historical episode/net-return summaries for the exact objective identity and revision. No complete history in the stable prefix.',
    trajectory_use:'input:{decisionId,experienceId}. Bind a real operation to an unexpired ranked action. Original terminal and measured change are recorded; this does not award another score or prove improvement. Retry the same IDs after native completion, never replay the action.',
    trajectory_list:'input:{limit?:8,offset?:0}. Bounded recent episode index.'},
    semantics:'G[t]=r[t]+gamma*G[t+1]. Store raw G and geometric-normalized G for bounded policy updates. Native net change and reflective reward stay separate. Null/cancellation cannot become success. Scoring again is not another physical sample. No inference/body calls in core.',
    schemas:{begin:beginSchema.toJSONSchema(),...Object.fromEntries(Object.keys(evaluationSchemas).map(op=>[op,trajectoryEvaluationInputSchema(op as TrajectoryEvaluationOperation)]))},goalVerified:false};}
  execute(args:Record<string,unknown>,ctx:GameMemoryContext):Record<string,unknown>{
    const input=(args.input??{}) as Record<string,unknown>,op=String(args.operation);
    if(op==='trajectory_help')return this.help();
    if(op==='trajectory_list'||op==='trajectory_recall'){
      const q=z.strictObject({limit:z.number().int().min(1).max(op==='trajectory_recall'?3:20).default(op==='trajectory_recall'?3:8),offset:z.number().int().min(0).default(0),taskKey:key.optional(),goalId:key.optional(),goalRevision:key.optional()}).parse(input);
      if(op==='trajectory_recall'&&(!q.taskKey||!q.goalId||!q.goalRevision))throw Error('Recall requires exact taskKey, goalId and goalRevision');
      const rows=this.index(ctx.scope).filter(e=>(!q.taskKey||e.taskKey===q.taskKey)&&(!q.goalId||e.goalId===q.goalId)&&(!q.goalRevision||e.goalRevision===q.goalRevision));
      const page=rows.slice(q.offset,q.offset+q.limit);
      return {protocol:'agent-mc-trajectory/v1',entries:op==='trajectory_list'?page:page.map(row=>{
        const e=this.read(ctx.scope,row.id);return {...this.brief(e),
          score:e.activeScore===null?null:{revision:e.activeScore,critique:e.scores[e.activeScore-1]?.critique.slice(0,600),initialReturn:e.scores[e.activeScore-1]?.returns[0]??null}};}),
        nextOffset:q.offset+q.limit<rows.length?q.offset+q.limit:null,total:rows.length,scannedWindow:128,currentWorldVerified:false,benefitVerified:false};
    }
    if(op==='trajectory_begin'){
      const requestId=key.parse(args.requestId),contract=beginSchema.parse(input),episodeId=experienceHash([operationScopeKey(ctx.scope),requestId]),path=this.path(ctx.scope,episodeId);
      if(existsSync(path)){const old=this.read(ctx.scope,episodeId);if(experienceHash(contract)!==experienceHash(old.contract))throw Error('Trajectory requestId conflict');return {...this.brief(old),replayed:true};}
      const now=new Date().toISOString(),e:Episode={schema:'agent-mc-trajectory/v1',id:episodeId,scopeKey:operationScopeKey(ctx.scope),createdAt:now,updatedAt:now,revision:0,
        contract,contractHash:experienceHash(contract),run:null,dimension:ctx.dimension??null,steps:[],state:'open',ending:null,scores:[],activeScore:null,reviews:[]};
      this.save(ctx.scope,e);return {...this.brief(e),replayed:false};
    }
    if(op==='trajectory_rank')return this.rank(args.requestId,input,ctx);
    if(op==='trajectory_use')return this.use(input,ctx);
    const episodeId=id.parse(input.episodeId),e=this.read(ctx.scope,episodeId);
    if(op==='trajectory_get'){
      const q=evaluationSchemas.trajectory_get.parse(input);
      const rows=e.steps.slice(q.offset,q.offset+q.limit).map((s,i)=>({index:q.offset+i,experienceId:s.experienceId,
        evidence:s.snapshot??this.getExperience(ctx.scope,s.experienceId)}));
      const latest=e.scores.at(-1);
      return {...this.brief(e),contract:e.contract,contractHash:e.contractHash,steps:rows,nextOffset:q.offset+q.limit<e.steps.length?q.offset+q.limit:null,
        scoringDraft:e.scoringDraft?{baseRevision:e.scoringDraft.baseRevision,evaluator:e.scoringDraft.evaluator,
          covered:e.scoringDraft.rewards.filter(r=>r!==null).length,missing:e.scoringDraft.rewards.flatMap((r,i)=>r===null?[i]:[])}:null,
        latestScore:latest?{...latest,rewards:latest.rewards.slice(q.offset,q.offset+q.limit),returns:latest.returns.slice(q.offset,q.offset+q.limit)}:null,
        scoreHistory:e.scores.map(s=>({revision:s.revision,parentRevision:s.parentRevision,digest:s.digest,evaluator:s.evaluator,at:s.at})),reviews:e.reviews};
    }
    if(op==='trajectory_append'){
      const q=z.strictObject({episodeId:id,expectedRevision:revision,experienceIds:z.array(id).min(1).max(128)}).parse(input);
      if(e.state!=='open')throw Error('Trajectory closed; start a new goal/version, do not rewrite history');
      if(q.experienceIds.every(id=>e.steps.some(s=>s.experienceId===id)))return {...this.brief(e),deduplicated:true};
      if(q.expectedRevision!==e.revision)throw Error('Trajectory revision conflict; read original episode');
      for(const experienceId of q.experienceIds){
        if(e.steps.some(s=>s.experienceId===experienceId))continue;
        const r=this.getExperience(ctx.scope,experienceId);
        if(r.kind!=='operation'||r.scopeKey!==e.scopeKey||Date.parse(r.at)<Date.parse(e.createdAt))throw Error('Operation predates goal binding or belongs to another identity');
        if(e.run!==null&&e.run!==r.run)throw Error('Run changed: close interrupted trajectory and start a new one');
        if(e.steps.length&&Date.parse(r.at)<Date.parse(this.getExperience(ctx.scope,e.steps.at(-1)!.experienceId).at))throw Error('Trajectory must preserve actual action order');
        const physicalId=physical(r);if(e.steps.some(s=>s.physicalId===physicalId))continue;
        if(e.steps.length>=128)throw Error('Trajectory step budget reached; close this segment explicitly');
        e.run=r.run;e.steps.push({experienceId,physicalId,snapshot:null});
      }
      e.revision++;this.save(ctx.scope,e);return this.brief(e);
    }
    if(op==='trajectory_close'){
      const q=z.strictObject({episodeId:id,expectedRevision:revision,outcome:z.enum(['completed','blocked','cancelled','unknown']),note:text(1000)}).parse(input);
      if(e.state==='closed'){if(e.ending?.outcome!==q.outcome||e.ending.note!==q.note)throw Error('Closed trajectory outcome conflict');return {...this.brief(e),deduplicated:true};}
      if(e.revision!==q.expectedRevision)throw Error('Trajectory revision conflict');
      if(e.steps.length<2&&q.outcome!=='unknown'&&q.outcome!=='cancelled')throw Error('Multi-step evaluation needs at least two physical operations');
      const rows=e.steps.map(s=>this.getExperience(ctx.scope,s.experienceId));
      const pending=rows.filter(r=>!terminal(r));if(pending.length&&q.outcome!=='unknown'&&q.outcome!=='cancelled')return {...this.brief(e),pending:true,pendingExperienceIds:pending.map(r=>r.id)};
      e.steps.forEach((s,i)=>{if(physical(rows[i]!)!==s.physicalId)throw Error('Physical execution identity changed');s.snapshot=rows[i]!;});
      e.state='closed';e.ending={at:new Date().toISOString(),outcome:q.outcome,note:q.note};e.revision++;
      this.save(ctx.scope,e);return this.brief(e);
    }
    if(op==='trajectory_score'){
      const q=evaluationSchemas.trajectory_score.parse(input);
      if(e.state!=='closed')throw Error('Evaluate only a closed trajectory');
      if(e.steps.length<2)throw Error('Scoring needs a complete multi-step trajectory');
      let rewards=q.rewards;
      const paged=!q.finalize||q.offset>0||q.rewards.length===0||e.scoringDraft!==undefined;
      if(paged){
        if(q.expectedScoreRevision!==e.scores.length)throw Error('Score revision conflict; read previous evaluation');
        const draft=e.scoringDraft??{baseRevision:e.scores.length,evaluator:q.evaluator,critique:q.critique,rewards:e.steps.map(()=>null)};
        if(draft.baseRevision!==e.scores.length||experienceHash(draft.evaluator)!==experienceHash(q.evaluator))throw Error('Scoring draft belongs to another evaluator/version');
        for(let i=0;i<q.rewards.length;i++){
          const at=q.offset+i,r=q.rewards[i]!;
          if(r.experienceId!==e.steps[at]?.experienceId)throw Error('Evaluation must cover every original step in order');
          draft.rewards[at]=r;
        }
        draft.critique=q.critique;
        if(!q.finalize){e.scoringDraft=draft;this.save(ctx.scope,e);return {...this.brief(e),draft:true,
          covered:draft.rewards.filter(r=>r!==null).length,missing:draft.rewards.flatMap((r,i)=>r===null?[i]:[]),adopted:false};}
        if(draft.rewards.some(r=>r===null))throw Error('Scoring draft has missing steps; read and complete coverage');
        rewards=draft.rewards as Score['rewards'];
      }
      const digest=experienceHash([q.evaluator,q.critique,rewards,e.contractHash]);
      if(e.scores.at(-1)?.digest===digest)return {...this.brief(e),deduplicated:true};
      if(q.expectedScoreRevision!==e.scores.length)throw Error('Score revision conflict; read previous evaluation');
      if(e.scores.length>=16)throw Error('Scoring revision budget reached; retain counterexample and new execution evidence');
      if(rewards.length!==e.steps.length||rewards.some((r,i)=>r.experienceId!==e.steps[i]?.experienceId))throw Error('Evaluation must cover every original step in order');
      for(let i=0;i<rewards.length;i++)if((!trusted(e.steps[i]!.snapshot!)||['unknown','cancelled'].includes(e.ending!.outcome))&&rewards[i]!.value!==null)
        throw Error('Unknown, rejected or cancelled effects must retain null reward');
      const returns=discountedTrajectoryReturns(rewards.map(r=>r.value),e.contract.gamma).map((r,i)=>({experienceId:e.steps[i]!.experienceId,...r}));
      const score:Score={revision:e.scores.length+1,parentRevision:e.scores.at(-1)?.revision??null,digest,at:new Date().toISOString(),evaluator:q.evaluator,
        critique:q.critique,rewards,returns,nativeOutcome:nativeOutcome(e),source:'reflective-estimate'};
      delete e.scoringDraft;
      e.scores.push(score);this.save(ctx.scope,e);return {...this.brief(e),score:{revision:score.revision,parentRevision:score.parentRevision,digest:score.digest,
        initialReturn:score.returns[0],nativeOutcome:score.nativeOutcome},adopted:false,benefitVerified:false};
    }
    if(op==='trajectory_review'){
      const q=evaluationSchemas.trajectory_review.parse(input);
      if(q.expectedScoreRevision!==e.scores.length)throw Error('Score revision conflict');
      const selected=q.select===null?null:e.scores[q.select-1];if(q.select!==null&&!selected)throw Error('Unknown score revision');
      if(selected&&selected.returns.some(r=>r.return===null))throw Error('Incomplete returns cannot be adopted');
      // A measured zero/negative final outcome cannot be rewritten as a positive
      // trajectory by an optimistic critic. Individual preparatory steps may differ.
      if(selected?.nativeOutcome.value!==null&&selected?.nativeOutcome.value!==undefined&&selected.nativeOutcome.value<=0&&(selected.returns[0]?.return??0)>0)
        throw Error('Positive initial return conflicts with measured nonpositive net outcome; revise scores or withdraw');
      if(e.activeScore===q.select&&e.reviews.some(r=>r.revision===q.select&&r.reason===q.reason))return {...this.brief(e),deduplicated:true};
      e.activeScore=q.select;e.reviews.push({at:new Date().toISOString(),revision:q.select,reason:q.reason});this.save(ctx.scope,e);
      return {...this.brief(e),adopted:q.select!==null,benefitVerified:false};
    }
    throw Error('Unknown trajectory operation');
  }
  private rank(requestId:unknown,input:Record<string,unknown>,ctx:GameMemoryContext):Record<string,unknown>{
    if(Buffer.byteLength(JSON.stringify(input))>16384)throw Error('Candidate input exceeds 16 KiB budget');
    const q=z.strictObject({taskKey:key,phase:key,goalId:key,goalRevision:key,criterion:metric.optional(),conditions:z.record(key,z.union([z.number(),z.boolean(),z.null()])).refine(v=>Object.keys(v).length<=12).default({}),
      candidates:z.array(z.strictObject({id:key,prior:z.number().min(0).max(1),ready:z.boolean(),tool:key,args:z.record(z.string(),z.unknown())})).min(2).max(12),beta:z.number().min(0).max(2).default(.5)}).parse(input);
    const decisionId=experienceHash([operationScopeKey(ctx.scope),key.parse(requestId)]);
    const path=join(this.folder(ctx.scope),'decision-'+decisionId+'.json'),inputHash=experienceHash(q);
    const observation=operationObservation(ctx.observation?.());
    if(existsSync(path)){
      const old=JSON.parse(readFileSync(path,'utf8'));
      if(old.inputHash!==inputHash)throw Error('Trajectory rank requestId conflict; never refresh old advice silently');
      return {...old.result,replayed:true,expired:Date.now()-Date.parse(old.result.at)>30000||!comparable(old.observation,observation)};
    }
    if(!observation?.position||!observation.dimension||observation.health===null||observation.food===null)throw Error('Ranking requires a fresh observation');
    const candidates=q.candidates.map(c=>({id:c.id,actionHash:operationActionHash(c.tool,c.args),prior:c.prior,ready:c.ready}));
    if(Math.abs(candidates.reduce((s,c)=>s+c.prior,0)-1)>.02||new Set(candidates.map(c=>c.actionHash)).size!==candidates.length||new Set(candidates.map(c=>c.id)).size!==candidates.length||!candidates.some(c=>c.ready&&c.prior>0))throw Error('Distinct available candidates and complete probability mass required');
    const evidence:Array<{id:string;actionHash:string;value:number;episodeId:string;scoreRevision:number;step:number;return:number}>=[];
    const physicalIds=new Set<string>();
    const matches=this.index(ctx.scope).filter(e=>e.activeScore!==null&&e.taskKey===q.taskKey&&e.phase===q.phase&&e.goalId===q.goalId&&e.goalRevision===q.goalRevision
      &&e.criterionHash===experienceHash(q.criterion)&&e.conditionsHash===experienceHash(q.conditions)&&Date.now()-Date.parse(e.updatedAt)<=30*86400000).slice(0,8);
    for(const row of matches){
      const e=this.read(ctx.scope,row.id);
      const score=e.scores[e.activeScore!-1]!;
      for(let i=0;i<e.steps.length;i++){
        const step=e.steps[i]!,r=step.snapshot!,g=score.returns[i]!;
        if(g.normalized===null||physicalIds.has(step.physicalId)||!candidates.some(c=>c.ready&&c.actionHash===r.actionHash)
          ||!comparable(r.before,observation))continue;
        physicalIds.add(step.physicalId);evidence.push({id:step.physicalId,actionHash:r.actionHash!,value:g.normalized,
          episodeId:e.id,scoreRevision:score.revision,step:i,return:g.return!});
        if(evidence.length>=32)break;
      }
      if(evidence.length>=32)break;
    }
    const ranked=reweightJitRl(candidates,evidence,q.beta),sorted=[...ranked.candidates].sort((a,b)=>b.posterior-a.posterior);
    const result={protocol:'agent-mc-trajectory/v1',decisionId,at:new Date().toISOString(),expired:false,
      baseChoice:[...ranked.candidates].sort((a,b)=>b.prior-a.prior)[0]!.id,suggestedChoice:sorted[0]!.id,...ranked,evidence,
      valueSource:'adopted-multi-step-reflective-return',episodeReadLimit:8,goalVerified:false,bodyDispatched:false,inferenceCalls:0};
    this.write(path,{inputHash,result,observation:{...observation,inventory:null}});return result;
  }
  private use(input:Record<string,unknown>,ctx:GameMemoryContext):Record<string,unknown>{
    const q=z.strictObject({decisionId:id,experienceId:id}).parse(input);
    const decision=JSON.parse(readFileSync(join(this.folder(ctx.scope),'decision-'+q.decisionId+'.json'),'utf8'));
    const r=this.getExperience(ctx.scope,q.experienceId);
    if(r.scopeKey!==operationScopeKey(ctx.scope)||r.kind!=='operation'||Date.parse(r.at)<Date.parse(decision.result.at)
      ||Date.parse(r.at)-Date.parse(decision.result.at)>30000||!comparable(r.before,decision.observation))throw Error('Operation is outside decision identity, state or validity window');
    const candidate=decision.result.candidates.find((c:{actionHash:string})=>c.actionHash===r.actionHash);
    if(!candidate)throw Error('Actual action does not match a ranked candidate');
    const path=join(this.folder(ctx.scope),'use-'+physical(r)+'.json');
    if(existsSync(path)){
      const old=JSON.parse(readFileSync(path,'utf8'));
      if(old.decisionId!==q.decisionId)throw Error('Physical operation already linked to another decision');
      if(old.terminal)return {...old,deduplicated:true};
    }
    const result={protocol:'agent-mc-trajectory/v1',...q,run:r.run,execution:r.execution,terminal:terminal(r),
      candidateId:candidate.id,followedAdvice:candidate.id===decision.result.suggestedChoice,
      changedFromPrior:candidate.id!==decision.result.baseChoice,
      scoreEvidence:decision.result.evidence,before:r.before,after:r.after,benefitVerified:false,goalVerified:false,
      next:terminal(r)?'Evaluate the complete new trajectory; a single terminal is not a learning benefit':'Reconcile this original operation after its terminal; do not replay'};
    this.write(path,result);return result;
  }
}
