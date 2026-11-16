import { createHash } from 'node:crypto';
import { GameMemoryBook, type GameMemoryContext, type MemoryCandidate } from './game-memory.ts';

export const SCENE_KNOWLEDGE_PROTOCOL = 'agent-mc-scenes/v1';
export interface SceneKnowledgeCard {
  title:string; scenes:string[]; when:string; guidance:string; verify:string; counterexamples:string; author:string;
  sources:{reference:string;observedAt:string;excerpt:string}[];
}
const TAG='scene-guide';
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Expected scene object');return v as Record<string,unknown>;};
const text=(v:unknown,n:string,max:number)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`${n}: 1..${max} characters`);return v.trim();};
const keys=(v:Record<string,unknown>,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Unknown scene field; read scene/help');};
export function validateSceneCard(value:unknown):SceneKnowledgeCard {
  const v=obj(value);keys(v,['title','scenes','when','guidance','verify','counterexamples','author','sources']);
  if(!Array.isArray(v.scenes)||!v.scenes.length||v.scenes.length>8)throw Error('scenes: 1..8 model-defined labels');
  if(!Array.isArray(v.sources)||!v.sources.length||v.sources.length>6)throw Error('sources: 1..6 dated original references/excerpts');
  const sources=v.sources.map(raw=>{const s=obj(raw);keys(s,['reference','observedAt','excerpt']);const at=text(s.observedAt,'observedAt',40);
    if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(at)||!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now())throw Error('observedAt must be a past ISO timestamp');
    return {reference:text(s.reference,'reference',240),observedAt:new Date(at).toISOString(),excerpt:text(s.excerpt,'excerpt',500)};});
  const card={title:text(v.title,'title',160),scenes:[...new Set(v.scenes.map(x=>text(x,'scene',40)))],when:text(v.when,'when',600),
    guidance:text(v.guidance,'guidance',2400),verify:text(v.verify,'verify',600),counterexamples:text(v.counterexamples,'counterexamples',600),author:text(v.author,'author',100),sources};
  if(JSON.stringify(card).length>5700)throw Error('Scene card exceeds 5700 characters; split by applicability and keep sources');return card;
}
/** Uses the existing scoped revision ledger; never calls a model, executes a body or promotes a hypothesis. */
export class SceneKnowledgeLibrary {
  constructor(private readonly book:GameMemoryBook){}
  private read(id:unknown,revision:unknown,ctx:GameMemoryContext){
    const entry=this.book.execute({action:'get',id,...(revision===undefined?{}:{revision})},ctx).entry as MemoryCandidate;
    if(entry.kind!=='method'||!entry.tags.includes(TAG))throw Error('Not a scene guide');const stored=JSON.parse(entry.content);
    if(stored.protocol!==SCENE_KNOWLEDGE_PROTOCOL)throw Error('Unknown scene protocol');return {entry,card:validateSceneCard(stored.card)};
  }
  execute(args:Record<string,unknown>,ctx:GameMemoryContext):Record<string,unknown>{
    const op=args.operation??'help',input=obj(args.input??{}),boundary={protocol:SCENE_KNOWLEDGE_PROTOCOL,trust:'model-organized-guidance',
      currentWorldVerified:false,referencesVerified:false,benefitVerified:false,bodyDispatched:false,
      meaning:'Historical model classification, not current skills or permission. Check original dated sources and current server prerequisites. Use experience/rank and feedback for measured comparisons.'};
    if(op==='help')return {...boundary,operations:{
      upsert:{input:{id:'optional existing guide id',expectedRevision:'required on update',card:{title:'short title',scenes:['caller-defined labels'],when:'conditions',guidance:'source-grounded methods/skill combinations',verify:'observable terminal/net-change criteria',counterexamples:'failed conditions or unknown',author:'actual agent/model',sources:[{reference:'receipt/document id',observedAt:'ISO timestamp',excerpt:'original excerpt'}]}}},
      recall:{input:{query:'current task or scene terms',limit:'1..3 default 2',maxChars:'600..6000 default 2400'}},
      list:{input:{query:'optional',offset:'default 0',limit:'1..20'}},get:{input:{id:'guide id',revision:'optional'}},archive:{input:{id:'guide id',expectedRevision:'current revision'}}},
      lifecycle:'Read actual server data -> model classifies -> save versioned candidate -> task-local recall -> check prerequisites -> rank executable alternatives -> actual terminal -> feedback/revise. Saving is not learning benefit.'};
    if(op==='upsert'){
      keys(input,['id','expectedRevision','card']);const card=validateSceneCard(input.card);if(input.id!==undefined)this.read(input.id,undefined,ctx);
      else if(input.expectedRevision!==undefined&&input.expectedRevision!==0)throw Error('New expectedRevision must be omitted or 0');
      const content=JSON.stringify({protocol:SCENE_KNOWLEDGE_PROTOCOL,card});
      const r=this.book.execute({action:input.id?'revise':'remember',...(input.id?{id:input.id,expectedRevision:input.expectedRevision}:{}),kind:'method',summary:card.title,
        content,tags:[TAG,...card.scenes],source:{kind:'agent_note',speaker:card.author,reference:card.sources[0].reference,observedAt:card.sources[0].observedAt}},ctx),e=r.entry as MemoryCandidate;
      return {...boundary,id:e.id,revision:e.revision,contentHash:createHash('sha256').update(content).digest('hex'),saved:r.saved,written:r.written??true,
        next:{action:'scene',operation:'get',input:{id:e.id,revision:e.revision}}};
    }
    if(op==='get'||op==='archive'){
      keys(input,op==='get'?['id','revision']:['id','expectedRevision']);const {entry,card}=this.read(input.id,input.revision,ctx);
      if(op==='archive')return {...boundary,...this.book.execute({action:'archive',id:input.id,expectedRevision:input.expectedRevision},ctx)};
      return {...boundary,id:entry.id,revision:entry.revision,recordedAt:entry.recordedAt,archived:entry.archived,card};
    }
    if(op!=='list'&&op!=='recall')throw Error('Unknown scene operation');keys(input,op==='list'?['query','offset','limit']:['query','limit','maxChars']);
    if(op==='recall'&&(typeof input.query!=='string'||!input.query.trim()))throw Error('Recall needs task terms; list is discovery');
    const limit=input.limit??(op==='list'?8:2),maxChars=input.maxChars??2400;
    if(!Number.isInteger(limit)||Number(limit)<1||Number(limit)>(op==='list'?20:3))throw Error('Invalid scene limit');
    if(!Number.isInteger(maxChars)||Number(maxChars)<600||Number(maxChars)>6000)throw Error('Invalid scene budget');
    const r=this.book.execute({action:'search',kind:'method',tags:[TAG],query:input.query??'',limit,offset:input.offset??0},ctx);
    const rows=(r.entries as (MemoryCandidate&{expired?:boolean})[]).filter(e=>!e.archived&&!e.expired);
    if(op==='list')return {...boundary,total:r.total,nextOffset:r.nextOffset,entries:rows.map(e=>({id:e.id,revision:e.revision,title:e.summary,scenes:e.tags.filter(t=>t!==TAG)}))};
    const cards:unknown[]=[];let used=0;
    for(const e of rows){const {entry,card}=this.read(e.id,e.revision,ctx),full={id:entry.id,revision:entry.revision,recordedAt:entry.recordedAt,card};
      const chosen=used+JSON.stringify(full).length<=Number(maxChars)?full:{id:e.id,revision:e.revision,title:card.title,scenes:card.scenes,when:card.when.slice(0,200),detailOmitted:true};
      const size=JSON.stringify(chosen).length;if(used+size<=Number(maxChars)){cards.push(chosen);used+=size;}}
    return {...boundary,query:input.query,total:r.total,cards,chars:used,fullDetails:{action:'scene',operation:'get',input:{id:'selected id',revision:'selected revision'}}};
  }
}
