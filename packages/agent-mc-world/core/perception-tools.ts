import type { ToolDef } from './support/host-contract.ts';
import { observedEntity } from './perception-sight.ts';
import { classifyEntity } from './terrain.ts';
import { zhEntity } from './names.ts';

export type AttentionMode='peaceful'|'explore'|'combat';
/** Server adapter receipts, never tool arguments or a successful cast alone.
 * These are snapshots: never supplement them from currently hidden entities. */
export interface DetectionEvidence {
  source:string;receiptId:string;connectionGeneration:number;dimension:string;
  observedAt:number;expiresAt:number;position:{x:number;y:number;z:number};
  label?:string;attackRange?:number;sightRange?:number;
}
export function validDetection(e:DetectionEvidence,generation:number,dimension:string,now:number):boolean {
  return !!e && !!e.source && !!e.receiptId && e.connectionGeneration===generation && e.dimension===dimension
    && Number.isFinite(e.observedAt) && Number.isFinite(e.expiresAt) && e.observedAt<=now && e.observedAt>=now-30_000
    && e.expiresAt>now && e.expiresAt<=e.observedAt+30_000
    && !!e.position && [e.position.x,e.position.y,e.position.z].every(Number.isFinite);
}
const limitSchema={type:'integer',minimum:1,maximum:8,description:'Default 3; compact highlights only.'};
export const PERCEPTION_TOOLS:Array<Omit<ToolDef,'handler'>>=[
  {name:'mc_attention',tags:['read'],description:'Read up to 3 directly visible highlights. Optional mode changes only observation focus (combat: threats; peaceful: people/life plus urgent threats; explore: nearby variety). Does not alter tasks, combat policy or movement. Occlusion/unknown chunks fail closed. Hearing and predictions are separate on-demand tools.',
    parameters:{type:'object',properties:{mode:{type:'string',enum:['peaceful','explore','combat']},limit:limitSchema},additionalProperties:false}},
  {name:'mc_hear',tags:['read'],description:'Read recent actual server sound packets, merged by sound kind/direction. Returns coarse direction and distance bands at the time heard, age and source; no precise coordinates, entity IDs/counts or invented sounds. No record does not prove safety.',
    parameters:{type:'object',properties:{limit:limitSchema},additionalProperties:false}},
  {name:'mc_risk',tags:['read'],description:'On-demand risk highlights from currently visible threats. Separates received facts from short constant-motion estimates; probabilities/attack/sight ranges remain null without authoritative evidence. Optional entityId narrows to one currently visible entity. Does not use occluded live positions. No full grid by default; ask mc_visual overview for an image.',
    parameters:{type:'object',properties:{entityId:{type:'integer',minimum:0},limit:limitSchema},additionalProperties:false}},
];
export function perceptionArgs(args:Record<string,unknown>,kind:string):{limit:number;mode?:AttentionMode;entityId?:number}|{error:string} {
  const allowed=kind==='mc_attention'?['mode','limit']:kind==='mc_risk'?['entityId','limit']:['limit'];
  if(Object.keys(args).some(key=>!allowed.includes(key)))return {error:'不支持的参数'};
  if(args.limit!==undefined&&(!Number.isInteger(args.limit)||Number(args.limit)<1||Number(args.limit)>8))return {error:'limit须为1–8'};
  if(args.mode!==undefined&&!['peaceful','explore','combat'].includes(String(args.mode)))return {error:'mode须为peaceful、explore或combat'};
  if(args.entityId!==undefined&&(!Number.isInteger(args.entityId)||Number(args.entityId)<0))return {error:'entityId须为非负整数'};
  return {limit:Number(args.limit??3),...(args.mode?{mode:args.mode as AttentionMode}:{}),...(args.entityId!==undefined?{entityId:Number(args.entityId)}:{})};
}
const conditional=new Set(['spider','enderman','bee','wolf','polar_bear','piglin','zombified_piglin','iron_golem','panda','llama','goat']);
function kindOf(bot:any,e:any):string {
  if(e.type==='player'||e.name==='player')return 'player';
  if(['villager','wandering_trader'].includes(e.name))return 'npc';
  const keys=bot.registry?.entitiesByName?.[e.name]?.metadataKeys??[];
  const read=(name:string)=>e.metadata?.[keys.indexOf(name)];
  if(e.name==='creeper'&&(read('swell')===1||read('is_ignited')===true))return 'warning';
  if(conditional.has(e.name))return read('remaining_anger_time')>0||(e.name==='enderman'&&read('creepy')===true)
    ||(e.name==='bee'&&typeof read('flags')==='number'&&(read('flags')&2))?'warning':'neutral';
  const kind=classifyEntity(e.type,e.name);return kind==='hostile'?'hostile':kind==='animal'?'neutral':'unknown';
}
export class AttentionReader {
  mode:AttentionMode='explore';
  private motion=new Map<number,{position:{x:number;y:number;z:number};at:number}>();
  reset():void{this.motion.clear();}
  read(bot:any,limit:number,now=Date.now(),risk=false,entityId?:number) {
    const p=bot.entity.position;
    const visible=Object.values(bot.entities??{}).filter((e:any)=>e!==bot.entity&&e.id!==bot.entity.id&&observedEntity(bot,e)) as any[];
    const rows=visible.map(e=>{
      const pos=e.position,previous=this.motion.get(e.id),dt=previous?(now-previous.at)/1000:0;
      let prediction:null|{source:string;horizonMs:number;at:number[];uncertaintyRadius:number;probability:null}=null;
      if(previous&&dt>=.1&&dt<=2){
        const dx=(pos.x-previous.position.x)/dt,dz=(pos.z-previous.position.z)/dt,speed=Math.hypot(dx,dz);
        if(speed<=8)prediction={source:'两次可见位置匀速外推，未核验路线',horizonMs:1000,
          at:[round(pos.x+dx),round(pos.y),round(pos.z+dz)],uncertaintyRadius:round(.5+speed*.5),probability:null};
      }
      this.motion.set(e.id,{position:{x:pos.x,y:pos.y,z:pos.z},at:now});
      return {entity:e,kind:kindOf(bot,e),distance:Math.hypot(pos.x-p.x,pos.y-p.y,pos.z-p.z),prediction};
    });
    const ids=new Set(visible.map(e=>e.id));for(const id of this.motion.keys())if(!ids.has(id))this.motion.delete(id);
    const priority=(row:typeof rows[number])=>row.kind==='warning'?0:row.kind==='hostile'?(row.distance<6?1:this.mode==='peaceful'?5:2)
      :this.mode==='combat'?6:['player','npc'].includes(row.kind)?3:4;
    const selected=rows.filter(row=>entityId!==undefined?row.entity.id===entityId:risk||this.mode==='combat'
      ?['warning','hostile'].includes(row.kind):true).sort((a,b)=>priority(a)-priority(b)||a.distance-b.distance).slice(0,limit);
    return {sampledAt:now,mode:this.mode,source:'eye-line-of-sight',
      highlights:selected.map(({entity:e,kind,distance,prediction})=>({id:e.id,label:zhEntity(e.name??'unknown'),kind,distance:round(distance),
        at:[round(e.position.x),round(e.position.y),round(e.position.z)],relation:kind==='player'?'未确认':undefined,
        ...(risk?{attackRange:null,sightRange:null,prediction,priority:kind==='warning'?'高':distance<6?'近距注意':'观察'}:{})})),
      note:risk?'范围未知不是零；风险为注意优先级，非命中概率或安全保证。':'仅当前可见；未列出不等于不存在。'};
  }
}
const round=(n:number)=>Math.round(n*10)/10;
