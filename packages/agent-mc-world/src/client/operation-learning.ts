import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { OperationExperienceBook, operationScopeKey, type OperationAttribution, type OperationDecision, type OperationObservation } from '../../core/operation-experience.ts';
import { GameMemoryBook } from '../../core/game-memory.ts';
import type { GameMemoryScope } from '../../core/game-memory.ts';
import type { ExecutionReceipt, ToolDef, ToolOutcome, WorldRequestFacts } from './contracts.ts';

type Pending = { id: string; scope: GameMemoryScope; started: number };
/** Shared SDK/MCP collector. Recording failures never turn a dispatched body operation into a retryable RPC error. */
export class ClientOperationLearning {
  private readonly book: OperationExperienceBook;
  private readonly notebook:GameMemoryBook;
  private readonly pending = new Map<string, Pending>();
  private readonly early = new Map<string, {receipt:ExecutionReceipt;sample:OperationObservation|null;scopeKey:string|null}>();
  private failures=0;
  constructor(dataDir:string,private readonly run:string,private readonly facts:()=>WorldRequestFacts|null,
    private readonly fallbackScope:()=>GameMemoryScope) { this.book=new OperationExperienceBook(join(dataDir,'minecraft-memory')); this.notebook=new GameMemoryBook(join(dataDir,'minecraft-memory')); }
  private scope() { return this.facts()?.experience?.scope ?? this.fallbackScope(); }
  private sample(scope?:GameMemoryScope) { const e=this.facts()?.experience;return e&&(!scope||operationScopeKey(scope)===operationScopeKey(e.scope))?e.observation:null; }
  private safe<T>(fn:()=>T):T|null {try{return fn();}catch{this.failures++;return null;}}
  status(){return {recordingFailures:this.failures,pendingExecutions:this.pending.size,protocol:'agent-mc-experience/v1'};}
  recordDecision(value:OperationDecision) {return this.safe(()=>this.book.decision(this.scope(),this.run,value,this.sample()));}
  validateMemoryRefs(refs:string[]){
    if(!Array.isArray(refs)||refs.length>8)throw new Error('Select at most eight exact shared memory revisions');
    for(const reference of refs){const m=/^mc-memory:([a-f0-9-]{36}):(\d+)$/.exec(reference);
      if(!m)throw new Error('Expected mc-memory:<note-id>:<revision> from recall/get');
      this.notebook.execute({action:'get',id:m[1],revision:Number(m[2])},{scope:this.scope(),dimension:'*'});
    }
  }
  recall(query:string){
    if(!query.trim())return [];
    return this.safe(()=>{
      const scope=this.scope(),ctx={scope,dimension:'*'};
      const hits=this.notebook.execute({action:'search',kind:'lesson',query:query.slice(0,200),limit:3,dimension:'*'},ctx).entries as {id:string}[];
      return hits.map(hit=>{const row=this.notebook.execute({action:'get',id:hit.id},ctx).entry as {id:string;revision:number;summary:string;content:string};
        return {reference:`mc-memory:${row.id}:${row.revision}`,summary:row.summary,content:row.content.slice(0,900),truncated:row.content.length>900,
          trust:'historical-agent-interpretation',currentWorldVerified:false};});
    })??[];
  }
  begin(tool:ToolDef,args:Record<string,unknown>,requestId:string,attribution?:OperationAttribution):Pending|null {
    // Inspection, notebook maintenance and repeated battlefield sampling are not physical trials.
    if (tool.name.endsWith('_memory') || tool.name.endsWith('_choose')) return null;
    const script = tool.name.endsWith('_script');
    const active = script ? args.validate!==true&&(args.code!==undefined||args.procedure!==undefined)
      : tool.name.endsWith('_combat_tactic') ? args.choice!==undefined
      : tool.name.endsWith('_photo') && ['read','list','status','scene','capabilities','help'].includes(String(args.action)) ? false : tool.tags?.includes('act');
    if(!active)return null;
    const candidate = (args.choice as {candidate?:{procedure?:{handle?:unknown;revision?:unknown}}}|undefined)?.candidate;
    const reference = (script ? args.procedure : candidate?.procedure) as {handle?:unknown;revision?:unknown}|undefined;
    const own = typeof reference?.handle==='string' ? /^mem:mc-method\/([a-z][a-z0-9-]{0,63})\/([a-f0-9]{64})$/.exec(reference.handle) : null;
    const method = own&&reference?.revision===own[2] ? {id:own[1],revision:own[2]}
      : script&&typeof args.code==='string' ? {id:typeof args.name==='string'?args.name:'inline-script',revision:createHash('sha256').update(args.code).digest('hex')} : undefined;
    return this.safe(()=>{const scope=this.scope();const row=this.book.begin(scope,this.run,requestId,tool.name,args,this.sample(),
      {...attribution,...(!attribution?.method&&method?{method}:{})});
      return {id:row.id,scope,started:performance.now()};});
  }
  finish(p:Pending|null,outcome:ToolOutcome|null) {
    if(!p)return null;
    return this.safe(()=>{
      let row=this.book.finish(p.scope,p.id,outcome,this.sample(p.scope),performance.now()-p.started);
      if(outcome?.execution){const e=outcome.execution,key=`${e.kind}:${e.id}`;
        const early=this.early.get(key); if(early?.receipt.terminal){row=this.book.terminal(p.scope,p.id,early.receipt,
          early.scopeKey===operationScopeKey(p.scope)?early.sample:null);this.early.delete(key);}
        else if(!e.terminal)this.pending.set(key,p);
      }
      return {id:row.id,protocol:row.schema,dispatch:row.dispatch,goalVerified:false};
    });
  }
  execution(receipt:ExecutionReceipt){
    if(!receipt.terminal)return;
    this.safe(()=>{const key=`${receipt.kind}:${receipt.id}`,p=this.pending.get(key),e=this.facts()?.experience;
      const scopeKey=e?operationScopeKey(e.scope):null;
      const sample=e&&(!p||scopeKey===operationScopeKey(p.scope))?e.observation:null;
      if(p){this.book.terminal(p.scope,p.id,receipt,sample);this.pending.delete(key);}
      else {this.early.set(key,{receipt,sample,scopeKey});if(this.early.size>256)this.early.delete(this.early.keys().next().value!);}
    });
  }
}
