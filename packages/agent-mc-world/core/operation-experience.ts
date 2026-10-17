/** Game-only operational evidence. No inference, scheduler or automatic skill activation. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutionReceipt, ToolOutcome } from '../src/contracts/host.ts';
import type { GameMemoryScope, GameMemoryContext } from './game-memory.ts';
import { GameMemoryBook } from './game-memory.ts';

export type OperationObservation = {
  at: string; dimension: string | null; position: { x: number; y: number; z: number } | null;
  health: number | null; food: number | null; inventory: Record<string, number> | null;
};
/** Project physical stacks into new operation evidence; never alter raw snapshots or saved history. */
export function operationInventory(stacks: readonly { name: string; count: number }[], synced: boolean): Record<string, number> | null {
  if (!synced) return null;
  const totals = new Map<string, number>();
  for (const stack of stacks) totals.set(stack.name, (totals.get(stack.name) ?? 0) + stack.count);
  return Object.fromEntries(totals);
}
export type OperationAttribution = {
  controller?: 'system1' | 'system2' | 'human' | 'unknown'; sessionId?: string; decisionId?: string;
  method?: { id: string; revision: string }; memoryRefs?: string[];
};
export type OperationDecision = {
  id: string; category: string; selected: string | null; status: string;
  candidates: { id: string; ready: boolean | null; probability?: number | null }[];
  model?: string | null; elapsedMs?: number | null; inputTokens?: number | null; outputTokens?: number | null;
  sessionId?: string; contextHash?: string;
  recalledMemoryRefs?: string[];
};
export type OperationExperience = {
  schema: 'agent-mc-experience/v1'; id: string; scopeKey: string; run: string; requestId: string;
  at: string; updatedAt: string; kind: 'decision' | 'operation'; tool: string; operations: string[];
  inputHash: string; parameters: Record<string,unknown>[]; attribution: OperationAttribution; decision: OperationDecision | null;
  before: OperationObservation | null; after: OperationObservation | null;
  execution: Pick<ExecutionReceipt, 'kind' | 'id' | 'phase' | 'terminal'> | null;
  dispatch: 'pending' | 'returned' | 'rejected' | 'unknown'; elapsedMs: number | null;
  goalVerified: false;
  stepEffects?: Array<{ step: number; skill: string; status: string; at: number[] | null;
    changed: { target: boolean | null; inventory: boolean | null; position: boolean | null; window: boolean | null };
    coverage: 'client-visible-only'; goalVerified: false }>;
};
export function operationStepEffects(receipt?: ExecutionReceipt): NonNullable<OperationExperience['stepEffects']> {
  const steps = receipt?.evidence?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 16).flatMap(step => {
    const e = step?.observedEffect;
    if (!Number.isSafeInteger(step?.step) || !e || e.schema !== 'agent-mc-observed-effect/v1'
        || e.coverage !== 'client-visible-only' || e.goalVerified !== false
        || typeof e.skill !== 'string' || !/^[a-z_]{1,50}$/.test(e.skill)
        || !['changed','unchanged','unknown'].includes(e.status) || !e.changed) return [];
    const value = (key: string) => typeof e.changed[key] === 'boolean' ? e.changed[key] : null;
    return [{ step: step.step, skill: e.skill, status: e.status,
      at: Array.isArray(e.at) && e.at.length === 3 && e.at.every(Number.isFinite) ? e.at : null,
      changed: { target: value('target'), inventory: value('inventory'), position: value('position'), window: value('window') },
      coverage: 'client-visible-only' as const, goalVerified: false as const }];
  });
}
export const experienceHash = (v: unknown): string => createHash('sha256').update(stable(v)).digest('hex');
function stable(v: unknown): string {
  if (v === undefined) return 'null';
  if (!v || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => JSON.stringify(k) + ':' + stable(x)).join(',') + '}';
}
export const operationScopeKey = (s: GameMemoryScope) => experienceHash([s.realm, s.account, s.agent]);
function bounded(v: unknown, name: string, max = 256): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f]/.test(v)) throw new Error(`Invalid ${name}`);
  return v;
}
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const name = (v: unknown) => typeof v === 'string' && /^[\w:./@-]{1,120}$/.test(v) ? v : null;
export function operationObservation(v: OperationObservation | null | undefined, now = Date.now()): OperationObservation | null {
  if (!v || !Number.isFinite(Date.parse(v.at)) || now - Date.parse(v.at) > 5000 || Date.parse(v.at) > now + 1000) return null;
  const p = v.position;
  return { at: v.at, dimension: name(v.dimension), position: p && [p.x,p.y,p.z].every(n => number(n) !== null) ? {x:p.x,y:p.y,z:p.z} : null,
    health: count(v.health), food: count(v.food), inventory: v.inventory ? Object.fromEntries(Object.entries(v.inventory).slice(0,128)
      .filter(([k,v]) => name(k) && Number.isSafeInteger(v) && v >= 0)) : null };
}
export function operationNames(args: Record<string, unknown>): string[] {
  const steps = Array.isArray(args.steps) ? args.steps : [(args.choice as {candidate?:unknown})?.candidate??args];
  return [...new Set(steps.slice(0,64).flatMap(s => s && typeof s === 'object'
    ? [name(s.skill), name(s.operation), name(s.spell), name(s.kind)].filter((x): x is string => !!x) : []))];
}
function parameters(args:Record<string,unknown>):Record<string,unknown>[] {
  const steps=Array.isArray(args.steps)?args.steps:[(args.choice as {candidate?:unknown})?.candidate??args];
  return steps.slice(0,16).map(s=>{
    if(!s||typeof s!=='object')return {};
    const result:Record<string,unknown>={};
    for(const key of ['skill','operation','spell','kind','item','block','recipe','mode']) if(name(s[key]))result[key]=s[key];
    for(const key of ['durationMs','count','targetId','distance','yawDeg','pitchDeg']) if(number(s[key])!==null)result[key]=s[key];
    for(const key of ['at','toward']) if(Array.isArray(s[key])&&s[key].length===3&&s[key].every((v:unknown)=>number(v)!==null))result[key]=s[key];
    if(Array.isArray(s.keys))result.keys=s.keys.filter((k:unknown)=>['forward','back','left','right','jump','sneak','sprint'].includes(String(k))).slice(0,7);
    if(typeof s.land==='boolean')result.land=s.land;
    return result;
  });
}
function attribution(v: OperationAttribution = {}): OperationAttribution {
  const controller = v.controller ?? 'unknown';
  if (!['system1','system2','human','unknown'].includes(controller)) throw new Error('Invalid controller');
  if (v.memoryRefs && (!Array.isArray(v.memoryRefs) || v.memoryRefs.length > 12)) throw new Error('At most 12 memory references');
  return { controller, ...(v.sessionId ? {sessionId:bounded(v.sessionId,'sessionId')} : {}),
    ...(v.decisionId ? {decisionId:bounded(v.decisionId,'decisionId')} : {}),
    ...(v.method ? {method:{id:bounded(v.method.id,'method',180),revision:bounded(v.method.revision,'revision',128)}} : {}),
    ...(v.memoryRefs ? {memoryRefs:[...new Set(v.memoryRefs.map(x => bounded(x,'memoryRef',180)))]} : {}) };
}
function normalizedDecision(v: OperationDecision): OperationDecision {
  if (!Array.isArray(v.candidates) || v.candidates.length > 32) throw new Error('At most 32 decision candidates');
  const candidates = v.candidates.map(c => ({id:bounded(c.id,'candidate',120),ready:typeof c.ready === 'boolean' ? c.ready : null,
    probability: count(c.probability) !== null && c.probability! <= 1 ? c.probability! : null}));
  if (new Set(candidates.map(c => c.id)).size !== candidates.length) throw new Error('Duplicate decision candidates');
  if (v.selected !== null && !candidates.some(c => c.id === v.selected)) throw new Error('Unknown selected candidate');
  return { id:bounded(v.id,'decisionId'), category:bounded(v.category,'category',80), selected:v.selected, status:bounded(v.status,'status',80), candidates,
    model: v.model ? bounded(v.model,'model',160) : null, elapsedMs:count(v.elapsedMs), inputTokens:count(v.inputTokens), outputTokens:count(v.outputTokens),
    ...(v.sessionId ? {sessionId:bounded(v.sessionId,'sessionId')} : {}),
    ...(v.contextHash && /^[a-f0-9]{64}$/.test(v.contextHash) ? {contextHash:v.contextHash} : {}),
    ...(v.recalledMemoryRefs ? {recalledMemoryRefs:v.recalledMemoryRefs.slice(0,12).map(x=>bounded(x,'recalledMemoryRef',180))} : {}) };
}

/** One immutable identity per run/request; rows update atomically. A bounded recent index never deletes evidence files. */
export class OperationExperienceBook {
  constructor(private readonly directory: string) {}
  private folder(scope: GameMemoryScope) {
    for (const v of [scope.realm,scope.account,scope.agent]) bounded(v,'scope',500);
    return join(this.directory, 'operations', operationScopeKey(scope));
  }
  private write(file: string, value: unknown) {
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > 256_000) throw new Error('Experience size limit');
    const tmp = file + '.' + randomUUID() + '.tmp';
    try { writeFileSync(tmp,bytes,{flag:'wx',mode:0o600}); renameSync(tmp,file); }
    finally { if (existsSync(tmp)) unlinkSync(tmp); }
  }
  private save(scope: GameMemoryScope, row: OperationExperience, fresh = false) {
    const dir = this.folder(scope); mkdirSync(dir,{recursive:true});
    this.write(join(dir,row.id+'.json'),row);
    if (fresh) {
      const path = join(dir,'recent.json');
      const ids: string[] = existsSync(path) ? JSON.parse(readFileSync(path,'utf8')) : [];
      this.write(path,[...ids.filter(id=>id!==row.id),row.id].slice(-1024));
    }
    return structuredClone(row);
  }
  get(scope: GameMemoryScope, id: string): OperationExperience {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid experience ID');
    const file = join(this.folder(scope),id+'.json');
    if (!existsSync(file)) throw new Error('Experience not found in this game scope');
    const row = JSON.parse(readFileSync(file,'utf8')) as OperationExperience;
    if (row.schema !== 'agent-mc-experience/v1' || row.id !== id || row.scopeKey !== operationScopeKey(scope)) throw new Error('Experience identity mismatch');
    return row;
  }
  private recent(scope:GameMemoryScope,input:Record<string,unknown>){
    const file = join(this.folder(scope),'recent.json');
    const ids: string[] = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : [];
    const rows = ids.slice().reverse().map(id=>this.get(scope,id)).filter(r =>
      (!input.run || r.run===input.run) && (!input.kind || r.kind===input.kind)
      && (!input.operation || r.operations.includes(String(input.operation)) || r.decision?.category===input.operation)
      && (!input.controller || r.attribution.controller===input.controller));
    return {ids,rows};
  }
  list(scope: GameMemoryScope, input: Record<string,unknown> = {}) {
    const limit = input.limit ?? 8, offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || Number(limit)<1 || Number(limit)>20 || !Number.isInteger(offset) || Number(offset)<0 || Number(offset)>1024) throw new Error('limit 1..20, offset 0..1024');
    const {ids,rows}=this.recent(scope,input);
    return {window:'latest-1024-records',retained:ids.length,total:rows.length, nextOffset:Number(offset)+Number(limit)<rows.length ? Number(offset)+Number(limit) : null,
      entries:rows.slice(Number(offset),Number(offset)+Number(limit)), historical:true, goalVerified:false};
  }
  begin(scope: GameMemoryScope, run: string, requestId: string, tool: string, args: Record<string,unknown>, before: OperationObservation | null, meta?: OperationAttribution) {
    bounded(run,'run'); bounded(requestId,'requestId'); bounded(tool,'tool',120);
    const a = attribution(meta), inputHash = experienceHash([tool,args,a]), id=experienceHash([operationScopeKey(scope),run,requestId]);
    const file = join(this.folder(scope),id+'.json');
    if (existsSync(file)) {
      const old = this.get(scope,id); if (old.inputHash !== inputHash) throw new Error('Experience request ID conflict'); return old;
    }
    const at=new Date().toISOString();
    return this.save(scope,{schema:'agent-mc-experience/v1',id,scopeKey:operationScopeKey(scope),run,requestId,at,updatedAt:at,
      kind:'operation',tool,operations:operationNames(args),inputHash,parameters:parameters(args),attribution:a,decision:null,
      before:operationObservation(before),after:null,execution:null,dispatch:'pending',elapsedMs:null,goalVerified:false},true);
  }
  decision(scope: GameMemoryScope, run: string, value: OperationDecision, before: OperationObservation | null) {
    const decision=normalizedDecision(value);
    const row=this.begin(scope,run,`decision:${decision.id}`, 'host-decision', {},before,{controller:'system1',sessionId:decision.sessionId,decisionId:decision.id});
    if (row.decision) {if(experienceHash(row.decision)!==experienceHash(decision)) throw new Error('Decision ID conflict');return row;}
    return this.save(scope,{...row,kind:'decision',decision,before:null,after:row.before,dispatch:'returned',elapsedMs:decision.elapsedMs??null,updatedAt:new Date().toISOString()});
  }
  finish(scope: GameMemoryScope, id: string, outcome: ToolOutcome | null, after: OperationObservation | null, elapsedMs: number) {
    const row=this.get(scope,id);
    if (row.dispatch !== 'pending') return row;
    const raw=outcome?.execution;
    const execution = raw ? {kind:raw.kind,id:raw.id,phase:raw.phase,terminal:raw.terminal} : null;
    const admission=(outcome?.meta?.receipt as {accepted?:boolean}|undefined)?.accepted;
    const stepEffects = operationStepEffects(outcome?.execution);
    return this.save(scope,{...row,...(!row.execution?.terminal && stepEffects.length ? {stepEffects} : {}),dispatch:!outcome?'unknown':outcome.failed||admission===false?'rejected':'returned',execution:row.execution?.terminal?row.execution:execution,
      after:row.execution?.terminal?row.after:operationObservation(after),elapsedMs:count(elapsedMs),updatedAt:new Date().toISOString()});
  }
  terminal(scope: GameMemoryScope, id: string, receipt: ExecutionReceipt, after: OperationObservation | null) {
    const row=this.get(scope,id);
    if (row.execution?.terminal) return row;
    if (row.execution && (row.execution.id!==receipt.id || row.execution.kind!==receipt.kind)) throw new Error('Execution identity mismatch');
    const stepEffects = operationStepEffects(receipt);
    return this.save(scope,{...row,...(stepEffects.length ? {stepEffects} : {}),execution:{kind:receipt.kind,id:receipt.id,phase:receipt.phase,terminal:receipt.terminal},
      after:operationObservation(after),updatedAt:new Date().toISOString()});
  }
  async query(args: Record<string,unknown>, ctx: GameMemoryContext, notebook: GameMemoryBook): Promise<Record<string,unknown>> {
    const input=(args.input??{}) as Record<string,unknown>;
    if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Experience input must be an object');
    if (args.operation==='help' || !args.operation) return {protocol:'agent-mc-experience/v1',operations:{
      list:'input:{operation?,controller?,kind?,run?,limit:1..20,offset?}; recent 1024 rows, exact get retains older rows',
      get:'input:{id}; exact scope-bound evidence',stats:'input:{operation?,controller?,run?}; bounded window, not model accuracy',
      reflect:'requestId + input:{ids:[1..8 exact IDs],summary,lesson,conditions,counterexample,verdict:helpful|harmful|unclear}; attributed notebook lesson; no automatic activation'},
      privacy:'No prompts, model prose, code, chat or raw arguments. Hashes and allowlisted observations/choice metadata only.',
      meaning:'RPC return, choice probability, execution completion and goal success are different. Unknown effects are never replayed.',
      next:'Search mc_memory lessons before acting; pass decisionId, exact method revision and memoryRefs in agent-mc/v1 attribution. Use bounded methods and discover server abilities from real help.'};
    if (args.operation==='get') return {entry:this.get(ctx.scope,String(input.id)),historical:true};
    if (args.operation==='list') return this.list(ctx.scope,input);
    if (args.operation==='stats') {
      const {rows}=this.recent(ctx.scope,input);
      const counts:Record<string,number>={}; for(const r of rows){const key=r.kind==='decision'?`decision:${r.decision?.status}`:`operation:${r.execution?.phase??r.dispatch}`;counts[key]=(counts[key]??0)+1;}
      return {window:'latest-1024-records',sampleSize:rows.length,from:rows.at(-1)?.at??null,to:rows[0]?.at??null,counts,
        measuredPairs:rows.filter(r=>r.kind==='operation'&&r.before&&r.after).length,goalSuccessRate:null,modelAccuracy:null,masteryVerified:false};
    }
    if (args.operation!=='reflect') throw new Error('Unknown experience operation');
    const requestId=bounded(args.requestId,'reflection requestId',128);
    if (!Array.isArray(input.ids)||input.ids.length<1||input.ids.length>8||new Set(input.ids).size!==input.ids.length) throw new Error('Use 1..8 unique evidence IDs');
    const rows=input.ids.map(id=>this.get(ctx.scope,String(id)));
    if (!['helpful','harmful','unclear'].includes(String(input.verdict))) throw new Error('Invalid verdict');
    if (input.verdict==='helpful' && !rows.some(r=>r.kind==='operation'&&r.dispatch==='returned'&&r.execution?.terminal&&r.execution.phase==='completed'&&r.before&&r.after))
      throw new Error('Helpful review needs a completed operation and measured before/after; advice or RPC acceptance is insufficient');
    const body={ids:input.ids,summary:bounded(input.summary,'summary',180),lesson:bounded(input.lesson,'lesson',1800),
      conditions:bounded(input.conditions,'conditions',600),counterexample:bounded(input.counterexample,'counterexample',600),verdict:input.verdict};
    const reviewId=experienceHash([operationScopeKey(ctx.scope),requestId]), digest=experienceHash(body), reference=`mc-experience:${reviewId}`;
    const dir=this.folder(ctx.scope);mkdirSync(dir,{recursive:true});const file=join(dir,`review-${reviewId}.json`);
    const old=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
    if(old&&old.digest!==digest)throw new Error('Reflection request ID conflict');
    if(old?.receipt)return {...old.receipt,duplicate:true};
    this.write(file,{digest,body,status:'pending'});
    // Recover a local save after process loss before receipt publication. Never repeat a remote model request.
    const found=notebook.execute({action:'search',kind:'lesson',query:reviewId,dimension:'*',limit:20},ctx).entries as {id:string;source:{reference?:string}}[];
    const match=found.find(e=>e.source.reference===reference);
    const saved=match?notebook.execute({action:'get',id:match.id},ctx):notebook.execute({action:'remember',kind:'lesson',summary:body.summary,
      content:JSON.stringify({reviewId,...body,attribution:'Agent interpretation of core observations; causality and mastery unverified',
        evidence:rows.map(r=>({id:r.id,run:r.run,requestId:r.requestId,phase:r.execution?.phase??r.dispatch,method:r.attribution.method??null,decisionId:r.attribution.decisionId??null}))}),
      tags:['operation-experience',...new Set(rows.flatMap(r=>r.operations).map(n=>n.slice(0,48)))].slice(0,12),
      source:{kind:'agent_note',speaker:ctx.scope.agent,reference}},ctx);
    const entry=saved.entry as {id:string;revision:number};
    const receipt={saved:true,note:{id:entry.id,revision:entry.revision},reviewId,verdict:body.verdict,masteryVerified:false,goalVerified:false,
      next:'Search/get this lesson at the next applicable scene; record adoption via memoryRefs and evaluate new outcomes. Remote sync is explicit.'};
    this.write(file,{digest,body,receipt});return receipt;
  }
}
