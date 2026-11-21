import type { Bot } from 'mineflayer';
import { entityMaxHealth } from './entity-max-health.ts';
import { onConnectionEnd } from './connection-end.ts';

type Point = { at: number; sequence: number; source: string; [key: string]: unknown };
interface Loss { at: number; from: number; to: number; rawDelta: number; baselineEstablished: boolean;
  attribution: 'unattributed' | 'damage-correlated'; recoveredAt: number | null; capacityChangedNearby: boolean }
interface State {
  closed:boolean; current: number | null; maximum: number | null; food: number | null; saturation: number | null;
  metadataHealth: number | null; baseline: {current: number; maximum: number; at: number} | null;
  changedAt: number; maxChangedAt: number; damageAt: number; loss: Loss | null; epoch: number;
  selfId: number | null; sequence: number; events: Point[]; display: Map<string, number>; hearts: Set<string>; dispose(): void;
}
const states = new WeakMap<Bot, State>();
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function settle(s:State,now:number) {
  if(!s.closed&&!s.baseline&&s.current!==null&&s.current>0&&s.maximum!==null&&s.maximum>0&&s.current<=s.maximum+0.001&&now-s.changedAt>=250)
    s.baseline={current:s.current,maximum:s.maximum,at:now};
}
/** Native channels remain separate. In particular, a quickly recovered loss is NOT declared harmless. */
export function installHealthSources(bot: Bot): () => void {
  const previous=states.get(bot);if(previous)return previous.dispose;
  const s:State={closed:false,current:null,maximum:null,food:null,saturation:null,metadataHealth:null,baseline:null,
    changedAt:Date.now(),maxChangedAt:-Infinity,damageAt:-Infinity,loss:null,epoch:0,selfId:null,sequence:0,
    events:[],display:new Map(),hearts:new Set(),dispose:()=>{}};
  states.set(bot,s);const detach:Array<()=>void>=[];
  const event=(source:string,data:Record<string,unknown>)=>{s.events.push({at:Date.now(),sequence:++s.sequence,source,...data});if(s.events.length>48)s.events.shift();};
  const on=(name:string,fn:(p:any)=>void)=>{bot._client.on(name,fn);detach.push(()=>bot._client.off(name,fn));};
  const reset=()=>{s.current=null;s.maximum=null;s.food=null;s.saturation=null;s.metadataHealth=null;s.baseline=null;s.loss=null;s.changedAt=Date.now();s.maxChangedAt=-Infinity;s.damageAt=-Infinity;s.epoch++;s.display.clear();event('life-reset',{});};
  on('login',p=>{reset();s.selfId=p.entityId;});on('respawn',reset);
  on('update_health',p=>{
    if(!finite(p.health)) {event('invalid-health',{});s.current=null;s.baseline=null;return;}
    const old=s.current,now=Date.now();settle(s,now);
    if(old!==p.health)s.changedAt=now;
    if(old!==null&&p.health<old){s.loss={at:now,from:old,to:p.health,rawDelta:old-p.health,
      baselineEstablished:s.baseline!==null,attribution:now-s.damageAt<=250?'damage-correlated':'unattributed',
      recoveredAt:null,capacityChangedNearby:now-s.maxChangedAt<=250};}
    if(s.loss&&p.health>=s.loss.from&&s.loss.recoveredAt===null)s.loss.recoveredAt=now;
    s.current=p.health;s.food=finite(p.food)?p.food:null;s.saturation=finite(p.foodSaturation)?p.foodSaturation:null;
    event('update_health',{current:s.current,maximum:s.maximum,food:s.food,saturation:s.saturation,rawDelta:old===null?null:p.health-old});
  });
  const attributes=(p:any)=>{
    if(p.entityId!==(s.selfId??bot.entity?.id))return;
    const a=p.properties?.find((a:any)=>typeof a.key==='string'&&/(?:^|[.:])max_health$/.test(a.key));if(!a)return;
    settle(s,Date.now());
    const max=entityMaxHealth({attributes:{[a.key]:a}} as never);const old=s.maximum;
    if(max!==old){s.maxChangedAt=Date.now();s.changedAt=Date.now();if(s.loss&&Date.now()-s.loss.at<=250)s.loss.capacityChangedNearby=true;}
    s.maximum=max;event('max_health_attribute',{key:a.key,base:a.value,modifiers:a.modifiers,maximum:max,previous:old});
  };
  on('entity_update_attributes',attributes);on('update_attributes',attributes);
  on('entity_metadata',p=>{
    if(p.entityId!==(s.selfId??bot.entity?.id))return;
    const key=bot.registry?.entitiesByName?.player?.metadataKeys?.indexOf('health');
    const entry=p.metadata?.find((m:any)=>m.key===key);if(entry&&finite(entry.value)){s.metadataHealth=entry.value;event('self_metadata_health',{value:entry.value,index:key,type:entry.type});}
  });
  const damage=(source:string,p:any)=>{
    if(p.entityId!==(s.selfId??bot.entity?.id))return;
    event(source,source==='damage_event'?{sourceTypeId:p.sourceTypeId,causeId:p.sourceCauseId,directId:p.sourceDirectId}:{status:p.entityStatus});
    if(source==='damage_event'||p.entityStatus===2||p.entityStatus===3){s.damageAt=Date.now();if(s.loss&&Date.now()-s.loss.at<=250)s.loss.attribution='damage-correlated';}
  };
  on('damage_event',p=>damage('damage_event',p));on('entity_status',p=>damage('entity_status',p));
  // HEARTS is only a display render type, not permission to overwrite native HP.
  on('scoreboard_objective',p=>{if(p.action===1){s.hearts.delete(p.name);s.display.delete(p.name);}else if(p.type===1||p.type==='hearts'){if(s.hearts.size<16)s.hearts.add(p.name);}else{s.hearts.delete(p.name);s.display.delete(p.name);}});
  on('scoreboard_score',p=>{if(p.itemName===bot.username&&s.hearts.has(p.scoreName)&&finite(p.value))s.display.set(p.scoreName,p.value);});
  const close=()=>{s.closed=true;for(const d of detach)d();end();};
  const end=onConnectionEnd(bot,close);s.dispose=()=>{close();states.delete(bot);};return s.dispose;
}
export function healthSources(bot: Bot, now=Date.now()) {
  const s=states.get(bot);if(!s)return null;
  const coherent=s.current!==null&&s.current>0&&s.maximum!==null&&s.maximum>0&&s.current<=s.maximum+0.001;
  const settled=coherent&&now-s.changedAt>=250;
  settle(s,now);
  return {schema:'native-health-sources/v1' as const,epoch:s.epoch,
    disconnected:s.closed,synchronisation:s.closed?'disconnected':s.current===null?'unavailable':!s.baseline?'initializing':settled?'stable':'transition',
    native:{current:s.current,maximum:s.maximum,food:s.food,saturation:s.saturation},
    metadataHealth:s.metadataHealth,displayScores:Object.fromEntries(s.display),baseline:s.baseline?{...s.baseline}:null,
    lastLoss:s.loss?{...s.loss}:null,events:s.events.map(e=>({...e})),
    meaning:'Raw HP loss remains observable even if recovered; no proof of harmlessness from absent damage or timing.'};
}
