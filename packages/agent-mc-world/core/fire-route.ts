import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { spatialBody } from './spatial-site.ts';
import { hazardBodyBounds } from './hazard-geometry.ts';
import { groundInputSequence } from './skills-control.ts';
import { SkillBlocked, sleep, type SkillContext } from './skill-context.ts';

const { PlayerState } = createRequire(createRequire(import.meta.url).resolve('mineflayer'))('prismarine-physics');
export interface FireCrossing {
  at?: [number, number, number]; mode?: 'auto' | 'walk' | 'jump';
  maxDamage?: number; reserveHealth?: number; dryRun?: boolean;
}
export interface FireRoute {
  mode: 'walk' | 'jump'; yaw: number; ticks: number; end: [number,number,number];
  contactTicks: number; estimatedDamage: number; cost: number;
  geometry: [number,number,number,number][];
}
type Sample = ReturnType<Parameters<typeof spatialBody>[0]>;
/** Risk estimates are vanilla unarmoured heuristics, NOT plugin damage guarantees.
 * Physics predicts collision, support and contact; never applies a simulated state. */
export function fireRoutes(bot: Bot, options: FireCrossing = {}): FireRoute[] {
  if (!bot.entity?.onGround || !bot.inventory || (bot as any).vehicle || !(bot.physics as any)?.simulatePlayer) return [];
  const start = bot.entity.position;
  if (options.at && (Math.abs(options.at[1]-start.y)>.15 || start.distanceTo(new Vec3(...options.at))>4)) return [];
  const cache = new Map<string, ReturnType<Bot['blockAt']>>();
  let used = new Set<string>();
  const readBlock = (p: Vec3) => { const q=p.floored(), k=q.toString(); used.add(k); if(!cache.has(k))cache.set(k,bot.blockAt(q,false)); return cache.get(k)!; };
  const read = (p: [number,number,number]): Sample => {const b=readBlock(new Vec3(...p));return b ? {material:{name:b.name,collision:b.shapes as any,properties:b.getProperties?.()??null,liquid:['water','lava'].includes(b.name)}}:{unknown:'unloaded'};};
  const names = (p: Vec3): string[] => {
    const bounds=hazardBodyBounds(p),out:string[]=[];
    for(let x=bounds.min.x;x<=bounds.max.x;x++)for(let y=bounds.min.y-1;y<=bounds.max.y;y++)for(let z=bounds.min.z;z<=bounds.max.z;z++){
      const b=readBlock(new Vec3(x,y,z));if(!b)throw Error('unloaded');
      if(y>=bounds.min.y||['magma_block','campfire','soul_campfire'].includes(b.name))out.push(b.name);
    }return out;
  };
  const world={getBlock(p:Vec3){const b=readBlock(p);if(!b||!Array.isArray(b.shapes))throw Error('unknown collision');return b;}};
  const angles=options.at?[Math.atan2(start.x-options.at[0],start.z-options.at[2])]:Array.from({length:12},(_,i)=>i*Math.PI/6);
  const modes=options.mode&&options.mode!=='auto'?[options.mode]:['walk','jump'] as const;
  const routes:FireRoute[]=[];
  for(const yaw of angles)for(const mode of modes)try{
    used = new Set<string>();
    const keys={forward:true,back:false,left:false,right:false,jump:false,sprint:false,sneak:false};
    const state=new PlayerState(bot,keys);state.yaw=yaw;state.pitch=0;
    let contactTicks=0,soulTicks=0,landedClear=0;
    for(let tick=0;tick<40;tick++){
      keys.jump=mode==='jump'&&tick===0;
      (bot.physics as any).simulatePlayer(state,world);
      const p=state.pos as Vec3, distance=p.distanceTo(start), touched=names(p);
      if(state.isInWater||state.isInLava||state.isCollidedHorizontally||p.y<start.y-.15||distance>4.8
        ||touched.some(n=>['lava','magma_block','cactus','sweet_berry_bush','powder_snow','cobweb','campfire','soul_campfire'].includes(n)))break;
      const fire=touched.includes('fire')||touched.includes('soul_fire');
      if(fire){contactTicks++;if(touched.includes('soul_fire'))soulTicks++;}
      const landing=spatialBody(read,[p.x,p.y,p.z]);
      const reached=options.at?Math.hypot(p.x-options.at[0],p.z-options.at[2])<.36:distance>.75;
      landedClear=state.onGround&&!fire&&landing.supported&&!landing.collision&&!landing.unknown&&reached?landedClear+1:0;
      if(landedClear>=2){
        // Fire Resistance is observed, not inferred from armour names.
        const resistant=Object.keys(bot.entity.effects??{}).some(id=>/fire.?resistance/i.test(bot.registry.effects?.[Number(id)]?.name??''));
        const damage=resistant?0:contactTicks?8+Math.ceil((contactTicks+soulTicks)/10):0;
        routes.push({mode,yaw,ticks:tick+1,end:[p.x,p.y,p.z],contactTicks,estimatedDamage:damage,
          cost:(tick+1)*.05+damage*2+(mode==='jump'?.15:0),geometry:[...used].map(k=>cache.get(k)!).filter(b=>b!==null)
            .map(b=>[b!.position.x,b!.position.y,b!.position.z,b!.stateId])});break;
      }
    }
  }catch{/* Unreceived geometry/effect state does not certify a route. */}
  return routes.sort((a,b)=>a.cost-b.cost);
}
export function fireRouteGeometryCurrent(bot:Bot,route:FireRoute):boolean {
  return route.geometry.every(([x,y,z,id])=>{
    const current=bot.blockAt(new Vec3(x,y,z),false);
    if(current?.stateId===id)return true;
    // Fire's age/attachment state changes without changing collision or damage
    // class. A newly ignited cell, removed support or soul-fire change still fails.
    const previous=bot.registry.blocksByStateId[id]?.name;
    return (previous==='fire'||previous==='soul_fire')&&current?.name===previous;
  });
}
const intents=new WeakMap<Bot,{until:number;healthFloor:number}>();
/** Scoped to one verified crossing. Never exempts lava, death, cancellation or a whole task. */
export function intentionalFireCrossing(bot:Bot):boolean {
  const i=intents.get(bot);return !!i&&Date.now()<i.until&&bot.health>i.healthFloor;
}
export async function crossFire(bot:Bot,call:FireCrossing,ctx:SkillContext):Promise<string>{
  const routes=fireRoutes(bot,call),maxDamage=call.maxDamage??12,reserve=call.reserveHealth??2;
  const plan=routes.find(r=>r.estimatedDamage<=maxDamage&&bot.health-r.estimatedDamage>reserve);
  const summary={schema:'minecraft-fire-route/v1',estimate:'vanilla-unarmoured heuristic; server damage may differ',
    alternatives:routes.slice(0,8).map(({geometry,...r})=>r),selected:plan?{mode:plan.mode,end:plan.end,cost:plan.cost,estimatedDamage:plan.estimatedDamage}:null};
  if(call.dryRun)return JSON.stringify({...summary,moved:false,completed:false});
  if(!plan)throw new SkillBlocked('没有在本次预计损失与剩余生命预算内、通过真实碰撞和落脚校验的穿火路线；可比较 dryRun 候选、改预算或另选路线', [JSON.stringify(summary)],'local','route-obstructed');
  const start=bot.entity.position.clone(),initialHealth=bot.health,started=Date.now();let damage=0,lastHealth=bot.health;
  const intent={until:started+3000,healthFloor:reserve};
  return groundInputSequence(bot,ctx,async input=>{
    intents.set(bot,intent);
    try{
      await bot.look(plan.yaw,0,true);input.check();
      for(let tick=0;tick<plan.ticks+8;tick++){
        input.check();damage+=Math.max(0,lastHealth-bot.health);lastHealth=bot.health;
        if((damage>0&&damage>=maxDamage)||bot.health<=reserve)throw new SkillBlocked('实际损失达到本次穿火预算；已停止，按新生命与位置选择脱离办法',[],'server','control-no-progress');
        if(!fireRouteGeometryCurrent(bot,plan))throw new SkillBlocked('穿火路径方块发生变化；重新观察，不沿旧预测继续',[],'server','navigation-location-changed');
        if(tick>3&&bot.entity.onGround&&bot.entity.position.distanceTo(new Vec3(...plan.end))<.4){
          input.keys([]);return JSON.stringify({...summary,moved:true,completed:true,from:start,position:bot.entity.position,initialHealth,health:bot.health,observedDamage:damage,elapsedMs:Date.now()-started});
        }
        input.keys(['forward',...(plan.mode==='jump'&&tick===0?['jump' as const]:[])]);await sleep(50);
        if(Date.now()-started>2800)break;
      }
      throw new SkillBlocked('实际落点未达到穿火预测；停止控制，先检查服务端位置和阻挡',[],'server','control-no-progress');
    }finally{if(intents.get(bot)===intent)intents.delete(bot);}
  });
}
