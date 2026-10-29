import {createHash} from 'node:crypto';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ordered=(v:any):any=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'
  ?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,ordered(v[k])])):v;
export function readOnlyToolResult(spec:any,value:any):boolean {
  const result=value?.structuredContent??value;
  if(result?.execution&&['task','method'].includes(result.execution.kind))return false;
  const tags=spec?._meta?.['agent-mc/v1']?.tags??spec?.tags;
  const explicit=result?.meta?.readAccess?.protocol==='agent-mc-read-access/v1'&&result.meta.readAccess.readOnly===true;
  if(Array.isArray(tags)&&tags.some(t=>['act','write','speak'].includes(t)))return explicit;
  return explicit||spec?.annotations?.readOnlyHint===true||Array.isArray(tags)&&tags.includes('read');
}
export interface ReadProgressEvidence {
  kind:'readOnly';run:string;requestId:string;selectorHash:string;revision:string;
  attempts:number;streak:number;repetitive:boolean;newInformation:boolean;knownIdle:true;at:number;
}
/** Metadata-only information progress. No tool-name whitelist, inferred goal
 * success, body dispatch, retry permission, model call or memory adoption. */
export class ReadProgressBook {
  private entries=new Map<string,{revision:string;requestId:string;attempts:number;at:number}>();
  private scope:string|null=null;private scene:string|null=null;private streak=0;
  constructor(private options:{limit?:number;window?:number;ttlMs?:number;now?:()=>number}={}){
    for(const key of ['limit','window','ttlMs'] as const){const value=options[key];
      if(value!==undefined&&(!Number.isSafeInteger(value)||value<1))throw new Error('Invalid read-progress bound: '+key);}
  }
  reset(){this.entries.clear();this.scope=null;this.scene=null;this.streak=0;}
  observe(input:{goalId:string;run:string;requestId:string;spec:any;args:unknown;result:any;execution:any;scene?:any}):ReadProgressEvidence|null {
    const e=input.execution,now=(this.options.now??Date.now)();
    if(!input.goalId||!input.requestId||!input.spec?.name||e?.protocol!=='agent-mc-execution-state/v1'||e.scope!=='runtime-receipts'
      ||!/^[a-f0-9]{64}$/.test(e.revision??'')||e.run!==input.run||e.phase!=='started'||e.activeCount!==0||e.detachedCount!==0
      ||e.pendingCalls!==0||e.pendingTactics!==0){this.entries.clear();this.streak=0;return null;}
    const scope=input.run+':'+input.goalId+':'+e.revision;
    if(scope!==this.scope){this.entries.clear();this.streak=0;this.scene=null;this.scope=scope;}
    if(input.scene){const {identity,dimension,position,health,food,guards}=input.scene;
      const scene=digest(ordered({identity,dimension,position,health,food,guards}));
      if(this.scene!==scene){this.entries.clear();this.streak=0;this.scene=scene;}}
    const s=input.result?.structuredContent??input.result;
    if(!readOnlyToolResult(input.spec,input.result)||input.result?.isError||!s||typeof s!=='object'||Array.isArray(s)||s.failed===true){this.streak=0;return null;}
    for(const[k,v]of this.entries)if(now-v.at>(this.options.ttlMs??900000))this.entries.delete(k);
    const {experience:_experience,...meta}=s.meta??{};
    const selectorHash=digest(ordered({tool:input.spec.name,args:input.args}));
    const revision=digest(ordered({text:s.text,data:s.data,meta,events:s.events}));
    const previous=this.entries.get(selectorHash);if(previous?.requestId===input.requestId)return null;
    const same=previous?.revision===revision,attempts=same?previous.attempts+1:1;
    this.streak=same?this.streak+1:0;this.entries.delete(selectorHash);this.entries.set(selectorHash,{revision,requestId:input.requestId,attempts,at:now});
    while(this.entries.size>(this.options.limit??32))this.entries.delete(this.entries.keys().next().value!);
    return{kind:'readOnly',run:input.run,requestId:input.requestId,selectorHash,revision,attempts,streak:this.streak,
      repetitive:this.streak>=(this.options.window??4),newInformation:!same,knownIdle:true,at:now};
  }
  snapshot(){return{scope:this.scope,knownQueries:this.entries.size,repeatedReadStreak:this.streak};}
}
