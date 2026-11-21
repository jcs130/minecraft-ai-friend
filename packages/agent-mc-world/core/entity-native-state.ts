import type { Bot } from 'mineflayer';
import { onConnectionEnd } from './connection-end.ts';
type Entry={key:number;type:unknown;value:unknown;at:number;sequence:number};
type RecordState={id:number;uuid:string|null;spawn:unknown;metadata:Map<number,Entry>;updates:Array<unknown>;attributes:Map<string|number,unknown>;statuses:Array<{at:number;sequence:number;status:number}>;passengers:number[]|null;truncatedUpdates:number};
const states=new WeakMap<Bot,{records:Map<number,RecordState>;sequence:number;closed:boolean;dispose():void}>();
/** In-memory parsed native facts only; never captures auth/chat, writes files or infers NPC safety. */
export function installEntityNativeState(bot:Bot):()=>void {
 const old=states.get(bot);if(old)return old.dispose;
 const s={records:new Map<number,RecordState>(),sequence:0,closed:false,dispose:()=>{}};states.set(bot,s);const off:Array<()=>void>=[];
 const on=(name:string,fn:(p:any)=>void)=>{bot._client.on(name,fn);off.push(()=>bot._client.off(name,fn));};
 const get=(id:number)=>{let r=s.records.get(id);if(!r){if(s.records.size>=256)s.records.delete(s.records.keys().next().value!);r={id,uuid:null,spawn:null,metadata:new Map(),updates:[],attributes:new Map(),statuses:[],passengers:null,truncatedUpdates:0};s.records.set(id,r);}return r;};
 on('login',()=>s.records.clear());on('respawn',()=>s.records.clear());on('entity_destroy',p=>{for(const id of p.entityIds??[])s.records.delete(id);});
 on('spawn_entity',p=>{
  if(bot.registry?.entities?.[p.type]?.type==='player')return;
  const existing=s.records.get(p.entityId);if(existing?.uuid&&existing.uuid!==p.objectUUID)s.records.delete(p.entityId);
  const r=get(p.entityId);r.uuid=p.objectUUID;r.spawn={at:Date.now(),sequence:++s.sequence,entityId:p.entityId,uuid:p.objectUUID,
   typeId:p.type,type:bot.registry?.entities?.[p.type]?.name??null,position:{x:p.x,y:p.y,z:p.z},yaw:p.yaw,pitch:p.pitch,
   headPitch:p.headPitch,objectData:p.objectData,velocity:p.velocity};
 });
 on('entity_metadata',p=>{
  if(p.entityId===bot.entity?.id||bot.entities?.[p.entityId]?.type==='player')return;
  const r=get(p.entityId),sequence=++s.sequence,at=Date.now();
  const entries=(p.metadata??[]).filter((m:any)=>Number.isInteger(m.key)&&m.key>=0&&m.key<255).map((m:any)=>({key:m.key,type:m.type,value:m.value,at,sequence}));
  for(const m of entries)r.metadata.set(m.key,m);r.updates.push({at,sequence,entries});if(r.updates.length>16){r.updates.shift();r.truncatedUpdates++;}
 });
 on('entity_update_attributes',p=>{const r=s.records.get(p.entityId);if(r)for(const a of p.properties??[])r.attributes.set(a.key,{at:Date.now(),sequence:++s.sequence,...a});});
 on('set_passengers',p=>{const r=s.records.get(p.entityId);if(r)r.passengers=[...(p.passengers??[])];});
 on('entity_status',p=>{const r=s.records.get(p.entityId);if(r){r.statuses.push({at:Date.now(),sequence:++s.sequence,status:p.entityStatus});if(r.statuses.length>16)r.statuses.shift();}});
 const close=()=>{s.closed=true;for(const d of off)d();end();};const end=onConnectionEnd(bot,close);s.dispose=()=>{close();states.delete(bot);};return s.dispose;
}
/** The caller must deliberately choose the entity; no bulk player/profile export. */
export function entityNativeState(bot:Bot,entity:Bot['entity']) {
 const r=states.get(bot)?.records.get(entity.id);if(!r||entity.type==='player'||r.uuid&&r.uuid!==entity.uuid)return null;
 const team=entity.uuid?bot.teamMap?.[entity.uuid]:undefined;
 return {schema:'native-entity-state/v1' as const,registryProtocol:bot.registry?.version?.version??null,disconnected:states.get(bot)?.closed??true,entityId:r.id,uuid:r.uuid,spawn:r.spawn,
  metadata:[...r.metadata.values()],updates:[...r.updates],truncatedUpdates:r.truncatedUpdates,attributes:[...r.attributes.values()],statuses:[...r.statuses],
  presentation:team&&entity.uuid&&team.team==='CIT-'+entity.uuid.replace(/-/g,'').slice(0,12)
   ?{providerHint:'citizens-compatible-scoreboard',source:'uuid-matched-team-convention',safety:'unconfirmed; NPC providers may also implement hostile actors'}:null,
  team:team?{name:team.team,collisionRule:team.collisionRule,friendlyFire:team.friendlyFire??null,flags:typeof team.friendlyFire==='number'?{friendlyFire:(team.friendlyFire&1)!==0,seeFriendlyInvisible:(team.friendlyFire&2)!==0}:null,nameTagVisibility:team.nameTagVisibility}:null,
  dimensions:{width:entity.width,height:entity.height},vehicle:entity.vehicle?.id??null,passengers:r.passengers??entity.passengers?.map(e=>e.id)??null};
}
