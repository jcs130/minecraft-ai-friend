import { createHash } from 'node:crypto';
import { readNearbySpeaker } from '../../core/nearby-speaker.mjs';
import type { EventEnvelope } from '../contracts/host.ts';

/** A source projection, not a learned fact or a current world snapshot. */
export interface GameMemoryEvent {
  protocol: 'agent-mc-event-memory/v1';
  id: string;
  category: 'speech' | 'execution' | 'combat' | 'goal' | 'observation';
  evidence: 'speaker-claim' | 'client-transport' | 'native-receipt' | 'client-observation';
  source: { world: string; run: string | null; cursor: number; type: string; at: string;
    reference: string; sha256: string; delivery: string | null };
  actor: { name: string | null; uuid: string | null; key: string | null; self: boolean; kind: string | null };
  correlation: Record<string, string | number>;
  text: string;
  data: Record<string, unknown>;
  truncated: boolean;
  goalVerified: false;
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const string = (v: unknown, max = 180): string | null => typeof v === 'string' && v.trim() ? v.slice(0, max) : null;
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const pick = (v: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(k => v[k] !== undefined).map(k => [k, v[k]]));

/** Limit explicitly selected evidence, never arbitrary metadata or secrets. */
function bounded(value: unknown, state: {truncated:boolean}, depth=0): unknown {
  if (typeof value === 'string') { if(value.length>500)state.truncated=true; return value.slice(0,500); }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (depth>5) {state.truncated=true; return '[see original]';}
  if (Array.isArray(value)) {if(value.length>8)state.truncated=true;return value.slice(0,8).map(x=>bounded(x,state,depth+1));}
  if (value && typeof value === 'object') {const entries=Object.entries(value);if(entries.length>24)state.truncated=true;
    return Object.fromEntries(entries.slice(0,24).map(([k,v])=>[k,bounded(v,state,depth+1)]));}
  return null;
}
function inventoryDelta(before: unknown, after: unknown): Record<string,number> | null {
  if (!before || !after || typeof before!=='object' || typeof after!=='object' || Array.isArray(before) || Array.isArray(after)) return null;
  const a=obj(before),b=obj(after),keys=[...new Set([...Object.keys(a),...Object.keys(b)])];
  if(keys.some(k=>(a[k]!==undefined&&(!Number.isSafeInteger(a[k])||a[k]<0))||(b[k]!==undefined&&(!Number.isSafeInteger(b[k])||b[k]<0))))return null;
  return Object.fromEntries(keys.filter(k=>(b[k]??0)!==(a[k]??0)).map(k=>[k,(b[k]??0)-(a[k]??0)]));
}
function steps(value: unknown) {
  return !Array.isArray(value) ? [] : value.map(raw=>{
    const s=obj(raw),effect=obj(s.observedEffect),before=obj(effect.before),after=obj(effect.after);
    return {...pick(s,['step','what','outcome','reason','why','decision']),skill:s.skill??effect.skill??null,
      ...(s.observation?{observation:{...pick(obj(s.observation),['kind','status','observedAt']),
        readout:pick(obj(s.observation.readout),['protocol','kind','worldKey','scanComplete','knownComplete','unknownCount']),
        boundary:'A read observation, not a mutation or completed gameplay objective.'}}:{}),
      ...(effect.schema==='agent-mc-observed-effect/v1' ? {observed:{
      ...pick(effect,['schema','status','coverage','dimension','at','changed']),
      beforeAt:before.at??null,afterAt:after.at??null,inventoryDelta:inventoryDelta(before.inventory,after.inventory),
      positionBefore:before.position??null,positionAfter:after.position??null,goalVerified:false}} : {})};
  });
}

/** Pure SDK/MCP/host-shared normalization. Archive-only concerns foreground routing,
 * not retention. State ticks and unstructured system echoes remain in the native
 * archive; they are not additional social utterances or action evidence. */
export function projectGameMemoryEvent(event: EventEnvelope): GameMemoryEvent | null {
  if(!event.source || !Number.isSafeInteger(event.cursor) || !Number.isFinite(Date.parse(event.ts)) || event.tags?.includes('snapshot'))return null;
  const m=obj(event.meta),delivery=obj(m.chatDelivery),r=obj(m.receipt),execution=event.execution;
  const suffix=event.type.startsWith(event.source+'.')?event.type.slice(event.source.length+1):event.type.replace(/^minecraft\./,'');
  const actor={name:string(m.from??m.sender??m.username),uuid:string(m.senderUuid),key:string(event.senderKey),
    self:m.outgoing===true||m.direction==='outgoing'||delivery.protocol==='agent-mc/chat-delivery/v1',kind:string(m.senderKind)};
  const correlation:Record<string,string|number>={};
  for(const key of ['assignmentId','taskId','decisionId','sessionId','goalId','goalVersion','stageVersion','maidOperationId','utteranceId']){
    if(typeof m[key]==='string'||typeof m[key]==='number')correlation[key]=m[key];
  }
  let category:GameMemoryEvent['category'], evidence:GameMemoryEvent['evidence'],text=event.text,data:Record<string,unknown>;
  if(delivery.protocol==='agent-mc/chat-delivery/v1' && typeof delivery.text==='string') {
    category='speech';evidence='client-transport';text=delivery.text;
    if(typeof delivery.id==='string')correlation.messageId=delivery.id;
    data={...pick(delivery,['status','sentAt','channel','target','audience','boundary','recipientRead','voiceRequestId']),
      effect:'Only client transport is observed; receipt does not prove anyone heard or read the words.'};
  } else if(execution?.terminal===true) {
    actor.self=true;
    category='execution';evidence='native-receipt';correlation.executionId=execution.id;
    const e=obj(execution.evidence);
    data={execution:pick(execution,['kind','id','phase','terminal']),steps:steps(e.steps),
      ...pick(e,['outcome','observedAt','deathEpisodeId','progress']),goalCompleted:false};
  } else if(suffix==='combat' && finite(r.id)!==null && typeof r.reason==='string') {
    actor.self=true;
    category='combat';evidence='client-observation';correlation.combatId=r.id;
    data={...pick(r,['id','startedAt','endedAt','reason','healthBefore','healthAfter','swings','meleeLanded','arrows','rangedLanded',
      'targetDeaths','killAttribution','confirmedOwnKills','attributedDeaths','scope','sceneBefore','tacticRevision','policy','deathEpisodeId']),
      healthDelta:finite(r.healthBefore)!==null&&finite(r.healthAfter)!==null?r.healthAfter-r.healthBefore:null,
      casts:Array.isArray(r.casts)?r.casts.map((c:any)=>pick(obj(c),['spell','sentAt','reply','replyAt','tacticRevision','manaBefore'])):[],
      castBoundary:'A sent cast is an attempt; reply and measured effect must be checked separately.',
      killCredit:r.killAttribution==='server-confirmed'?r.kills:null,goalCompleted:false};
  } else if(suffix==='event' && obj(m.mobDeath).schemaVersion===1 && typeof obj(m.mobDeath).eventId==='string') {
    category='observation';evidence='native-receipt';correlation.eventId=m.mobDeath.eventId;
    data={kind:'mob-death',...pick(m.mobDeath,['eventId','world','occurredAt','victim','damageType','causingEntity','directEntity','indirect']),
      ownKillCredit:m.ownKillCredit??null,goalCompleted:false};
  } else if(obj(m.positionChange).schema==='agent-mc-position-change/v1') {
    category='observation';evidence='client-observation';data={kind:'position-change',subject:'self',
      ...pick(obj(m.positionChange),['schema','source','before','after','distance']),cause:null,initiator:null,
      boundary:'Position changed; this event alone does not identify its cause or who initiated it. Correlate original actions and server receipts.',goalVerified:false};
  } else if(m.goalRevision || m.taskVerification || m.goalClosure) {
    category='goal';evidence='native-receipt';data=pick(m,['goalRevision','taskVerification','goalClosure']);
  } else if(suffix==='skill') {
    category='observation';evidence='native-receipt';data={kind:'skill-source-notification',
      boundary:'A catalogue or method notification, not proof of learning, casting, or improved performance.'};
  } else if(/^(chat|conversation|hearing|message)(\.|$)/.test(suffix)) {
    if(m.channel==='system' || m.executionFeedback || !actor.name&&!actor.uuid&&!actor.key)return null;
    const sampled = (m.channel==='nearby' && m.identityEvidence==='packet-sender' && m.chatTransport==='chat'
      || m.channel==='nearby-voice' && m.transcript===true && m.source==='mcagent:voice/nearby_voice')
      && actor.uuid && readNearbySpeaker(m.speakerOrigin,actor.uuid);
    category='speech';evidence='speaker-claim';
    text=sampled && typeof m.chatBody==='string' ? m.chatBody : typeof m.body==='string' ? m.body : event.text;
    data={channel:m.chatChannel??m.channel??null,scope:m.chatScope??m.socialScope??null,
      identityEvidence:m.identityEvidence??null,recipient:m.recipient??m.target??null,
      effect:'Attributed words only. Pronouns or unspecified targets remain unknown; claims are not measured actions.'};
  } else return null;
  const state={truncated:text.length>1200};text=text.slice(0,1200);
  let clean=bounded(data,state) as Record<string,unknown>;
  if(JSON.stringify(clean).length>7000){state.truncated=true;clean={
    ...pick(clean,['execution','reason','healthDelta','goalCompleted']),
    evidenceExcerpt:JSON.stringify(clean).slice(0,5000),originalRequired:true};}
  // Logical message IDs suppress transport echo/re-delivery without merging independent identical speech.
  const logical=correlation.messageId??correlation.maidOperationId??correlation.utteranceId;
  const id=hash(logical?[event.source,event.run??null,category,logical,actor.self]:[event.source,event.run??null,event.cursor,event.ts]);
  return {protocol:'agent-mc-event-memory/v1',id,category,evidence,
    source:{world:event.source,run:event.run??null,cursor:event.cursor,type:event.type,at:event.ts,
      reference:`event:${event.source}:${event.run??'unknown'}:${event.cursor}`,
      sha256:hash({source:event.source,type:event.type,run:event.run??null,cursor:event.cursor,ts:event.ts,text:event.text,
        senderKey:event.senderKey??null,meta:event.meta??null,execution:event.execution??null}),delivery:event.contextDelivery??null},
    actor,correlation,text,data:clean,truncated:state.truncated,goalVerified:false};
}

/** Episodic grouping never crosses a World/run, execution, or message channel. */
export function gameMemoryGroup(event:GameMemoryEvent):string {
  return hash([event.source.world,event.source.run,event.category,
    event.correlation.executionId??event.correlation.combatId??event.data.channel??null,
    Math.floor(Date.parse(event.source.at)/60000)]);
}
