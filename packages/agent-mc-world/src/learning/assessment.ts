/** Observable outcome signals, not causal proof or automatic policy/skill adoption. */
import { experienceHash } from '../../core/operation-experience.ts';
export const GAMEPLAY_PROTOCOL = 'agent-mc-gameplay/v1';
export type Point = [number, number, number];
export type GameObservation = {
  at: string; dimension: string | null; position: Point | null; velocity?: Point | null; yaw?: number | null;
  onGround?: boolean | null; health: number | null; food: number | null; oxygen?: number | null;
  inventory: Record<string, number> | null; voxels?: number[]; stateIds?: number[];
  controls?: string[]; controlsKnown?: boolean; coverage?: string;receivedAt?:string|null;worldAt?:string|null;
};
export type GameIntent = { skill?: string; operation?: string; item?: string; kind?: string; mode?: string; block?:string;recipe?:string;spell?:string;
  count?: number; durationMs?: number; targetId?: number; distance?:number; yawDeg?:number; pitchDeg?:number; keys?:string[]; land?:boolean; at?: Point; toward?: Point };
export type Assessment = { label: 'positive'|'negative'|'mixed'|'unknown'; reasons: string[];
  signals: { name: string; value: number | null }[]; trainingUse: string; goalVerified: false };
export type GameEffect = { step:number;skill:string;status:string;at:Point|null;target:boolean|null;inventory:boolean|null;position:boolean|null;window:boolean|null };
export type GameDecision = { category:string|null;selected:string|null;status:string|null;candidates:{id:string;ready:boolean|null;probability:number|null}[];
  model:string|null;elapsedMs:number|null;inputTokens:number|null;outputTokens:number|null;recalledMemoryRefs:string[];contextHash:string|null };
export type GameplayRecord = {
  protocol: typeof GAMEPLAY_PROTOCOL; id: string; sourceId: string; revision: string; scopeKey: string; run: string;
  at: string; updatedAt: string; kind: string; tool: string | null; operations: string[]; intents: GameIntent[];
  controller: string; sessionId: string | null; decisionId: string | null; methodId: string | null; methodRevision: string | null;
  memoryRefs: string[]; phase: string | null; terminal: boolean | null; dispatch: string | null; elapsedMs: number | null;
  before: GameObservation | null; after: GameObservation | null; observation: GameObservation | null;
  assessment: Assessment; sourceHash: string; previousRevision: string | null; boundary: string | null; executionId: string | null;
  effects:GameEffect[];decision:GameDecision|null;requestId:string|null;
};
const numeric = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const token = (x: unknown, max=160): string | null => typeof x === 'string' && !['__proto__','constructor','prototype'].includes(x) && new RegExp(`^[\\w:./@#-]{1,${max}}$`).test(x) ? x : null;
const point = (x: any): Point | null => Array.isArray(x) && x.length === 3 && x.every(numeric) ? [...x] as Point
  : x && [x.x,x.y,x.z].every(numeric) ? [x.x,x.y,x.z] : null;
const date = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x));
export function sanitizeGameObservation(value: any): GameObservation | null {
  if (!value || !date(value.at)) return null;
  const inventory = value.inventory && typeof value.inventory === 'object' && !Array.isArray(value.inventory)
    ? Object.fromEntries(Object.entries(value.inventory).slice(0,256).filter(([k,v]) => token(k) && Number.isSafeInteger(v) && Number(v)>=0)) as Record<string,number> : null;
  const grid = (x:any, max:number,min=0) => Array.isArray(x) && x.length===245 && x.every((v:any)=>Number.isInteger(v)&&v>=min&&v<=max) ? [...x] : [];
  return { at:value.at,dimension:token(value.dimension),position:point(value.position),velocity:point(value.velocity),
    yaw:numeric(value.yaw)?value.yaw:null,onGround:typeof value.onGround==='boolean'?value.onGround:null,
    health:numeric(value.health)&&value.health>=0?value.health:null,food:numeric(value.food)&&value.food>=0?value.food:null,
    oxygen:numeric(value.oxygen)&&value.oxygen>=0?value.oxygen:null,inventory,voxels:grid(value.voxels,15),stateIds:grid(value.stateIds,2**31-1,-1),
    controls:Array.isArray(value.controls)?value.controls.filter((x:any)=>['forward','back','left','right','jump','sneak','sprint'].includes(x)).slice(0,7):[],
    controlsKnown:value.controlsKnown===true,coverage:token(value.coverage)??'client-state-only',
    receivedAt:date(value.receivedAt)?value.receivedAt:null,worldAt:date(value.worldAt)?value.worldAt:null };
}
function intent(value:any):GameIntent {
  const out:GameIntent={};
  for(const key of ['skill','operation','item','kind','mode','block','recipe','spell'] as const) { const v=token(value?.[key]);if(v)out[key]=v; }
  for(const key of ['count','durationMs','targetId','distance','yawDeg','pitchDeg'] as const)if(numeric(value?.[key]))out[key]=value[key];
  if(Array.isArray(value?.keys))out.keys=value.keys.filter((x:any)=>['forward','back','left','right','jump','sneak','sprint'].includes(x)).slice(0,7);
  if(typeof value?.land==='boolean')out.land=value.land;
  for(const key of ['at','toward'] as const){const v=point(value?.[key]);if(v)out[key]=v;}
  return out;
}
const distance=(a:Point,b:Point)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export function assessGameplay(row: Pick<GameplayRecord,'kind'|'before'|'after'|'at'|'updatedAt'|'operations'|'intents'|'terminal'|'phase'|'dispatch'> & {effects?:GameEffect[]}):Assessment {
  const reasons:string[]=[],signals:Assessment['signals']=[];
  const result=(label:Assessment['label'],trainingUse:string):Assessment=>({label,reasons,signals,trainingUse,goalVerified:false});
  const signal=(name:string,value:number|null)=>signals.push({name,value});
  if(row.kind!=='operation'){reasons.push('context-not-a-physical-trial');return result('unknown','context-only');}
  if(row.dispatch==='unknown'||row.phase==='unknown'){reasons.push('execution-effect-unknown');return result('unknown','exclude-ambiguous');}
  if(row.dispatch==='rejected'&&!row.phase){reasons.push('interface-or-admission-rejection');return result('unknown','interface-recovery');}
  if(row.terminal!==true){reasons.push('no-terminal-evidence');return result('unknown','context-only');}
  if(row.phase==='cancelled'){reasons.push('cancellation-is-not-failure');return result('unknown','context-only');}
  const progressEligible=['completed','partial','blocked','failed'].includes(row.phase??'');
  const before=row.before,after=row.after;
  if(row.effects?.length) {
    signal('observedTargetChanges',row.effects.filter(x=>x.target===true).length);
    signal('observedInventoryChanges',row.effects.filter(x=>x.inventory===true).length);
  }
  const comparable=!!before&&!!after&&!!before.dimension&&before.dimension===after.dimension
    && Math.abs(Date.parse(before.at)-Date.parse(row.at))<=5000 && Math.abs(Date.parse(after.at)-Date.parse(row.updatedAt))<=5000
    && Date.parse(after.at)>=Date.parse(before.at)-1000;
  let harm=false,benefit=false;
  if(!comparable)reasons.push('missing-stale-or-cross-dimension-observations');
  if(comparable){
    const delta=(key:'health'|'food')=>before![key]!==null&&after![key]!==null?after![key]!-before![key]!:null;
    const health=delta('health'),food=delta('food');signal('healthDelta',health);signal('foodDelta',food);
    harm=health!==null&&health<-.01;
    if(harm)reasons.push('health-loss-observed-cause-unverified');
    if(row.operations.includes('eat')&&food!==null&&food>0&&progressEligible){benefit=true;reasons.push('food-restored');}
    const movement=row.operations.some(x=>['goto','move','control','flight','surface'].includes(x));
    const target=movement?row.intents.map(x=>x.at??x.toward).find(Boolean):undefined;
    if(movement&&before!.position&&after!.position){
      signal('displacement',distance(before!.position,after!.position));
      if(target){const initial=distance(before!.position,target),remaining=distance(after!.position,target);signal('targetDistanceBefore',initial);signal('targetDistanceAfter',remaining);
        if(initial-remaining>.25&&progressEligible){benefit=true;reasons.push(remaining<=1?'declared-operation-target-reached':'declared-operation-target-progress');}
      } else reasons.push('movement-without-declared-target');
    }
    const resource=row.operations.some(x=>['craft','smelt','collect','pickup','take'].includes(x));
    const item=resource?row.intents.map(x=>x.item).find(Boolean):undefined;
    if(item&&before!.inventory&&after!.inventory){const amount=(after!.inventory[item]??0)-(before!.inventory[item]??0);signal('intendedItemDelta',amount);
      if(amount>0&&progressEligible){benefit=true;reasons.push('intended-item-gain-observed');}}
    // Ingredient loss, equipment changes and stationarity alone are never negative labels.
  }
  const failed=['failed','blocked'].includes(row.phase??'');
  if(failed)reasons.push('operation-ended-unsuccessfully-not-proof-of-a-bad-model-choice');
  if(row.phase==='partial')reasons.push('operation-only-partly-completed');
  if(benefit&&(harm||failed||row.phase==='partial'))return result('mixed','contrast-review');
  if(benefit)return result('positive','progress-review');
  if(failed)return result('negative','recovery-review');
  if(harm)return result('unknown','risk-analysis');
  reasons.push(row.operations.every(x=>['chat','observe','probe','look','find'].includes(x))?'information-or-social-action-not-scored-by-movement':'no-objective-progress-witness');
  return result('unknown','context-only');
}
/** Accept only the existing safe operation contract; never serialize raw arguments, chat or method code. */
export function gameplayFromExperience(raw:any,expectedScope:string,sourceHash:string,previousRevision:string|null=null):GameplayRecord {
  if(raw?.schema!=='agent-mc-experience/v1'||raw.scopeKey!==expectedScope||!/^[a-f0-9]{64}$/.test(expectedScope)
    ||!/^[a-f0-9]{64}$/.test(raw.id)||!date(raw.at)||!date(raw.updatedAt)||!/^[a-f0-9]{64}$/.test(sourceHash))throw Error('Invalid scoped operation source');
  const meta=raw.attribution??{},execution=raw.execution??{};
  const row:GameplayRecord={protocol:GAMEPLAY_PROTOCOL,id:'',sourceId:raw.id,revision:sourceHash,sourceHash,scopeKey:expectedScope,
    run:token(raw.run)??'unknown',at:raw.at,updatedAt:raw.updatedAt,kind:raw.kind==='operation'?'operation':'decision',tool:token(raw.tool),
    operations:Array.isArray(raw.operations)?raw.operations.map((x:any)=>token(x)).filter(Boolean).slice(0,64):[],
    intents:Array.isArray(raw.parameters)?raw.parameters.slice(0,16).map(intent):[],
    controller:['system1','system2','human'].includes(meta.controller)?meta.controller:'unknown',sessionId:token(meta.sessionId,256),decisionId:token(meta.decisionId,256),
    methodId:token(meta.method?.id,180),methodRevision:token(meta.method?.revision),
    memoryRefs:Array.isArray(meta.memoryRefs)?meta.memoryRefs.filter((x:any)=>typeof x==='string'&&/^mc-memory:[a-f0-9-]{36}:\d+$/.test(x)).slice(0,12):[],
    executionId:token(execution.id,256),phase:token(execution.phase),terminal:typeof execution.terminal==='boolean'?execution.terminal:null,
    dispatch:['pending','returned','rejected','unknown'].includes(raw.dispatch)?raw.dispatch:null,
    elapsedMs:numeric(raw.elapsedMs)&&raw.elapsedMs>=0?raw.elapsedMs:null,before:sanitizeGameObservation(raw.before),after:sanitizeGameObservation(raw.after),
    observation:null,previousRevision,boundary:null,assessment:null!,requestId:token(raw.requestId,256),
    effects:(Array.isArray(raw.stepEffects)?raw.stepEffects:[]).slice(0,16).flatMap((e:any)=>{
      const skill=token(e?.skill);if(!skill||!Number.isSafeInteger(e.step)||e.step<0||!['changed','unchanged','unknown'].includes(e.status)||e.coverage!=='client-visible-only')return [];
      return [{step:e.step,skill,status:e.status,at:point(e.at),...Object.fromEntries(['target','inventory','position','window'].map(key=>[key,typeof e.changed?.[key]==='boolean'?e.changed[key]:null]))}] as GameEffect[];
    }),decision:null};
  if(raw.decision&&row.kind==='decision'){
    const d=raw.decision;
    row.decision={category:token(d.category),selected:token(d.selected),status:token(d.status),model:token(d.model),
      candidates:(Array.isArray(d.candidates)?d.candidates:[]).slice(0,32).flatMap((c:any)=>{const id=token(c?.id);return id?[{id,ready:typeof c.ready==='boolean'?c.ready:null,probability:numeric(c.probability)&&c.probability>=0&&c.probability<=1?c.probability:null}]:[];}),
      elapsedMs:numeric(d.elapsedMs)&&d.elapsedMs>=0?d.elapsedMs:null,inputTokens:numeric(d.inputTokens)&&d.inputTokens>=0?d.inputTokens:null,outputTokens:numeric(d.outputTokens)&&d.outputTokens>=0?d.outputTokens:null,
      recalledMemoryRefs:Array.isArray(d.recalledMemoryRefs)?d.recalledMemoryRefs.filter((x:any)=>typeof x==='string'&&/^mc-memory:[a-f0-9-]{36}:\d+$/.test(x)).slice(0,12):[],
      contextHash:typeof d.contextHash==='string'&&/^[a-f0-9]{64}$/.test(d.contextHash)?d.contextHash:null};
  }
  row.assessment=assessGameplay(row);row.id=experienceHash([expectedScope,raw.id,sourceHash]);return row;
}
