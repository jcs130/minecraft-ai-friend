/** Conservative geometry gate for public observations. Unloaded is unknown. */
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
type Point={x:number;y:number;z:number};
const observationSources=new WeakMap<object,Bot>();
export interface ObservationPolicy {
  mineralVision?: boolean;
  /** Surroundings uses loaded line of sight in every direction; camera also applies the yaw/pitch cone. */
  entityView?: 'surroundings' | 'camera';
  /** Maximum entity observation distance in blocks, 1..64. */
  entityRange?: number;
}
export const OBSERVATION_DEFAULTS = { mineralVision: false, entityView: 'surroundings' as const, entityRange: 32 };
const policies=new WeakMap<object,()=>ObservationPolicy|undefined>();
export function entityObservationScope(bot: object): { view: 'surroundings' | 'camera'; range: number } {
  const policy=policies.get(observationSources.get(bot)??bot)?.();
  return {view:policy?.entityView??OBSERVATION_DEFAULTS.entityView,range:policy?.entityRange??OBSERVATION_DEFAULTS.entityRange};
}
/** Host configuration only; an Agent cannot silently grant itself mineral vision. */
export function configureObservationPolicy(bot:object,policy:()=>ObservationPolicy|undefined):void {
  policies.set(observationSources.get(bot)??bot,policy);
}
/** Explicit opt-in exposes only already received mineral cells, never unloaded terrain or entities. */
export function mineralObservationAllowed(bot:any,position:Point):boolean {
  bot=observationSources.get(bot)??bot;
  if(policies.get(bot)?.()?.mineralVision!==true||!finite(position)||!finite(bot?.entity?.position))return false;
  const p=bot.entity.position;
  if(Math.hypot(position.x-p.x,position.y-p.y,position.z-p.z)>32)return false;
  const name=bot.blockAt?.(new Vec3(Math.floor(position.x),Math.floor(position.y),Math.floor(position.z)),false)?.name;
  return typeof name==='string'&&(name.endsWith('_ore')||name==='ancient_debris');
}
const finite=(p:Point|undefined):p is Point=>!!p&&[p.x,p.y,p.z].every(Number.isFinite);
/** Vision only. Glass is transparent but retains its native collision boxes. Tinted glass is opaque. */
export const observationTransparent=(name:string)=>['air','cave_air','void_air','water','glass','glass_pane'].includes(name)
  ||name.endsWith('_stained_glass')||name.endsWith('_stained_glass_pane');
const transparent=observationTransparent;
function intersects(a:number[],d:number[],shape:number[],cell:number[]):boolean {
  let near=0,far=1-1e-6;
  for(let i=0;i<3;i++){
    const lo=shape[i]!+cell[i]!,hi=shape[i+3]!+cell[i]!;
    if(Math.abs(d[i]!)<1e-9){if(a[i]!<lo||a[i]!>hi)return false;}
    else{const u=(lo-a[i]!)/d[i]!,v=(hi-a[i]!)/d[i]!;near=Math.max(near,Math.min(u,v));far=Math.min(far,Math.max(u,v));if(near>far)return false;}
  }
  return far>=0&&near<1-1e-6;
}
export function clearObservationRay(bot:any,from:Point,to:Point):boolean {
  bot=observationSources.get(bot)??bot;
  if(!finite(from)||!finite(to)||typeof bot?.blockAt!=='function')return false;
  const a=[from.x,from.y,from.z],d=[to.x-from.x,to.y-from.y,to.z-from.z];
  if(Math.hypot(...d)>64)return false;
  const cell=a.map(Math.floor),end=[to.x,to.y,to.z].map(Math.floor),step=d.map(Math.sign);
  const delta=d.map(n=>n?Math.abs(1/n):Infinity);
  const edge=d.map((n,i)=>n?((step[i]!>0?cell[i]!+1:cell[i]!)-a[i]!)/n:Infinity),tested=new Set<string>();
  const check=(at:number[])=>{
    for(let dy=-1;dy<=1;dy++){
      const p=[at[0]!,at[1]!+dy,at[2]!],key=p.join(',');if(tested.has(key))continue;tested.add(key);
      const block=bot.blockAt(new Vec3(p[0]!,p[1]!,p[2]!),false);if(!block)return false;
      if(transparent(String(block.name)))continue;
      const shapes=Array.isArray(block.shapes)?block.shapes:[[0,0,0,1,1,1]];
      if(shapes.some((s:number[])=>intersects(a,d,s,p)))return false;
    }
    return true;
  };
  for(let count=0;count<256;count++){
    if(!check(cell))return false;
    if(cell.every((n,i)=>n===end[i]))return true;
    const next=Math.min(...edge);if(next>1)return true;
    const axes=edge.map((v,i)=>Math.abs(v-next)<1e-10?i:-1).filter(i=>i>=0);
    // A diagonal grazing a corner cannot skip the other adjacent cells.
    for(let mask=1;mask<(1<<axes.length);mask++){
      const neighbor=[...cell];axes.forEach((axis,j)=>{if(mask&(1<<j))neighbor[axis]!+=step[axis]!;});
      if(!check(neighbor))return false;
    }
    for(const i of axes){cell[i]!+=step[i]!;edge[i]!+=delta[i]!;}
  }
  return false;
}
export function observedEntity(bot:any,entity:any,cone?:boolean):boolean {
  bot=observationSources.get(bot)??bot;
  const scope=entityObservationScope(bot);
  const self=bot?.entity,p=entity?.position;
  if(!finite(self?.position)||!finite(p)||entity.isValid===false||entity.invisible||entity.dead||entity.health===0)return false;
  const keys=bot.registry?.entitiesByName?.[entity.name]?.metadataKeys??[];
  const flags=entity.metadata?.[keys.indexOf('shared_flags')];if(typeof flags==='number'&&(flags&32))return false;
  const eye={x:self.position.x,y:self.position.y+(Number.isFinite(self.eyeHeight)?self.eyeHeight:1.62),z:self.position.z};
  return [.25,.5,.85].some(part=>{
    const point={x:p.x,y:p.y+(entity.height??1)*part,z:p.z};
    const dx=point.x-eye.x,dy=point.y-eye.y,dz=point.z-eye.z,flat=Math.hypot(dx,dz);
    if(Math.hypot(flat,dy)>scope.range)return false;
    if(cone??scope.view==='camera'){
      const diff=Math.atan2(Math.sin(Math.atan2(-dx,-dz)-(self.yaw??0)),Math.cos(Math.atan2(-dx,-dz)-(self.yaw??0)));
      if(Math.abs(diff)>55*Math.PI/180||Math.abs(Math.atan2(dy,flat)-(self.pitch??0))>40*Math.PI/180)return false;
    }
    return clearObservationRay(bot,eye,point);
  });
}

/** A visible face establishes the block identity; hidden neighboring cells stay unknown. */
export function observedBlock(bot:any,position:Point):boolean {
  bot=observationSources.get(bot)??bot;
  const self=bot?.entity;
  if(!finite(self?.position)||!finite(position)||typeof bot.blockAt!=='function')return false;
  const cell={x:Math.floor(position.x),y:Math.floor(position.y),z:Math.floor(position.z)};
  const eye={x:self.position.x,y:self.position.y+(self.eyeHeight??1.62),z:self.position.z};
  const center={x:cell.x+.5,y:cell.y+.5,z:cell.z+.5};
  if(Math.hypot(center.x-eye.x,center.y-eye.y,center.z-eye.z)>32)return false;
  const target=bot.blockAt(new Vec3(cell.x,cell.y,cell.z),false);
  if(!target)return false;
  const points=transparent(String(target.name))?[center]:[
    {x:cell.x-.001,y:center.y,z:center.z},{x:cell.x+1.001,y:center.y,z:center.z},
    {x:center.x,y:cell.y-.001,z:center.z},{x:center.x,y:cell.y+1.001,z:center.z},
    {x:center.x,y:center.y,z:cell.z-.001},{x:center.x,y:center.y,z:cell.z+1.001},
  ];
  return points.some(p=>clearObservationRay(bot,eye,p));
}

/** Read-only observation facade. Execution/pathfinding keeps its original Bot. */
export function observationView<T extends Bot>(bot:T):T {
  if(observationSources.has(bot))return bot;
  const view=new Proxy(bot, {get(target,key){
    if(key==='blockAt')return (p:Point,extra=true)=>observedBlock(target,p)||mineralObservationAllowed(target,p)?target.blockAt(new Vec3(p.x,p.y,p.z),extra):null;
    if(key==='entities')return Object.fromEntries(Object.entries(target.entities??{}).filter(([,e])=>e===target.entity||observedEntity(target,e)));
    if(key==='findBlocks'||key==='findBlock')return (options:Parameters<Bot['findBlocks']>[0])=>{
      const found=target.findBlocks({...options,count:Math.min(2048,Math.max(options.count??1,128))})
        .filter(p=>observedBlock(target,p)||mineralObservationAllowed(target,p)).slice(0,options.count??1);
      return key==='findBlock'?(found[0]?target.blockAt(found[0]):null):found;
    };
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  observationSources.set(view,bot);
  return view;
}
