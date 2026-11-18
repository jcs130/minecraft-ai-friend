import type { Bot } from 'mineflayer';
import pathfinderPkg, { type Movements, type Move } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { awaitPathGoal } from './navigation-result.ts';

type Point = { x: number; y: number; z: number };
export interface IdleRoam { origin: Point; destination: Point; anchor: Point }
const active = new WeakMap<Bot, object>();
const hazards = new Set(['water', 'lava', 'bubble_column', 'fire', 'soul_fire', 'magma_block',
  'cactus', 'sweet_berry_bush', 'powder_snow', 'cobweb', 'campfire', 'soul_campfire',
  'nether_portal', 'end_portal', 'end_gateway', 'tripwire']);
const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
const plain = (p: Point): Point => ({x:p.x,y:p.y,z:p.z});

/** Only our exact path may bypass the idle gate's moving/airborne checks. */
export function idleRoamOwnsPath(bot: Bot): boolean {
  return active.get(bot) === bot.pathfinder?.goal && active.has(bot);
}

function dryBlock(block: ReturnType<Bot['blockAt']>): boolean {
  const wet = block?.getProperties?.()?.waterlogged;
  return Boolean(block && !hazards.has(block.name) && !block.name.endsWith('_pressure_plate')
    && wet !== true && wet !== 'true');
}

function dryCell(bot: Bot, p: Point): boolean {
  const at = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  return [-1,0,1].every(dy => dryBlock(bot.blockAt(at.offset(0,dy,0), false)));
}

/** Copy the existing profile so server boundaries and collision repairs remain in force. */
function profile(bot: Bot, anchor: Point, cacheSearch=false): Movements {
  const original = bot.pathfinder.movements;
  const cells=new Map<string,boolean>();
  const dry=(p:Point) => {
    if(!cacheSearch)return dryCell(bot,p);
    const key=`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
    if(!cells.has(key))cells.set(key,dryCell(bot,p));
    return cells.get(key)!;
  };
  return Object.assign(Object.create(Object.getPrototypeOf(original)), original, {
    canDig:false, scafoldingBlocks:[], allow1by1towers:false, allowParkour:false,
    allowSprinting:false, allowFreeMotion:false, canOpenDoors:false, maxDropDown:1,
    infiniteLiquidDropdownDistance:false,
    // Pathfinding outside loaded chunks yields a block descriptor with no position.
    exclusionAreasStep:[...original.exclusionAreasStep, ({position}: {position?:Point}) =>
      !position || distance(position,anchor)>12 || !dry(position) ? 100 : 0],
  });
}

function safeRoute(bot: Bot, path: readonly Move[], anchor: Point): boolean {
  return path.length>0 && path.length<=20 && path.every(n =>
    !n.toBreak.length && !n.toPlace.length && !n.parkour
    && distance(n,anchor)<=12 && dryCell(bot,n) && supported(bot,n));
}

function supported(bot: Bot, p: Point): boolean {
  const cell=new Vec3(Math.floor(p.x),Math.floor(p.y-.05),Math.floor(p.z));
  const below=bot.blockAt(cell,false);
  return Boolean(below?.shapes?.some(s=>p.x-cell.x>=s[0] && p.x-cell.x<=s[3]
    && p.z-cell.z>=s[2] && p.z-cell.z<=s[5] && Math.abs(cell.y+s[4]-p.y)<.11));
}

function shallowStart(bot: Bot, p: Point): boolean {
  const cell=new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const head=bot.blockAt(cell.offset(0,1,0),false);
  return bot.blockAt(cell,false)?.name==='water' && dryBlock(head) && head?.shapes?.length===0
    && dryBlock(bot.blockAt(cell.offset(0,-1,0),false)) && supported(bot,p);
}

function adjacentBank(origin: Point, destination: Point): boolean {
  const dy=destination.y-Math.floor(origin.y);
  return Math.abs(destination.x-Math.floor(origin.x))+Math.abs(destination.z-Math.floor(origin.z))===1
    && (dy===0 || dy===1);
}

/** Recheck a sampled route before reusing it after body or terrain changes. */
export function idleRoamCanStart(bot: Bot, route: IdleRoam): boolean {
  const feet=bot.entity.position;
  return bot.entity.onGround && distance(feet,route.origin)<=.3 && distance(route.destination,route.anchor)<=12
    && dryCell(bot,route.destination)
    && (dryCell(bot,feet) || (adjacentBank(feet,route.destination) && shallowStart(bot,feet)));
}

/** Read-only, bounded search. A reachable walk target replaces a guessed forward vector. */
export function sampleIdleRoam(bot: Bot, anchor: Point, random = Math.random): IdleRoam | null {
  if (!bot.entity.onGround || !bot.pathfinder?.getPathTo || !bot.pathfinder.movements) return null;
  const origin=bot.entity.position, wet=!dryCell(bot,origin);
  if(wet&&!shallowStart(bot,origin))return null;
  const directions=wet?4:8;
  const moves=profile(bot,anchor,true), start=Math.floor(random()*directions)%directions;
  const deadline=performance.now()+60;
  for(let i=0;i<directions && performance.now()<deadline;i++) {
    const a=(wet?0:bot.entity.yaw)+((start+i)%directions)*2*Math.PI/directions;
    const x=wet?Math.floor(origin.x)-Math.round(Math.sin(a)):Math.floor(origin.x-Math.sin(a)*5);
    const z=wet?Math.floor(origin.z)-Math.round(Math.cos(a)):Math.floor(origin.z-Math.cos(a)*5);
    for(const dy of wet?[0,1]:[0,1,-1,2,-2]) {
      if(performance.now()>=deadline) break;
      const destination={x,y:Math.floor(origin.y)+dy,z};
      if(distance(destination,anchor)>11 || !dryCell(bot,destination)) continue;
      const below=bot.blockAt(new Vec3(x,destination.y-1,z),false);
      if(!below?.shapes?.length)continue;
      const result=bot.pathfinder.getPathTo(moves,new pathfinderPkg.goals.GoalBlock(x,destination.y,z),Math.min(35,Math.max(1,deadline-performance.now())));
      if(result.status==='success' && (!wet||result.path.length===1) && safeRoute(bot,result.path,anchor))
        return {origin:plain(origin),destination,anchor:plain(anchor)};
    }
  }
  return null;
}

/** One low-priority navigation lease; abort cleanup finishes before a new body owner runs. */
export async function executeIdleRoam(bot: Bot, route: IdleRoam, signal: AbortSignal,
  available: () => boolean): Promise<void> {
  if(signal.aborted || !available() || !idleRoamCanStart(bot,route)) return;
  const origin=bot.entity.position.clone();
  let departingWater=!dryCell(bot,origin);
  const finder=bot.pathfinder, original=finder.movements, isolated=profile(bot,route.anchor);
  const goal=new pathfinderPkg.goals.GoalBlock(route.destination.x,route.destination.y,route.destination.z);
  const check=finder.getPathTo(isolated,goal,40);
  if(check.status!=='success' || (departingWater&&check.path.length!==1) || !safeRoute(bot,check.path,route.anchor)) return;
  const keys=['canDig','scafoldingBlocks','allow1by1towers','allowParkour','allowSprinting',
    'allowFreeMotion','canOpenDoors','maxDropDown','infiniteLiquidDropdownDistance','exclusionAreasStep'] as const;
  const before=new Map(keys.map(k=>[k,(original as any)[k]]));
  for(const k of keys) (original as any)[k]=(isolated as any)[k];
  let closed=false, stoppedReason:string|undefined, timer:ReturnType<typeof setInterval>|undefined;
  const cleanup=() => {
    if(closed)return; closed=true;
    if(timer)clearInterval(timer);
    signal.removeEventListener('abort',cleanup); bot.removeListener('path_update',update);
    // Never clear a successor's goal or restore configuration it changed.
    if(finder.goal===goal) finder.setGoal(null);
    for(const k of keys) if((original as any)[k]===(isolated as any)[k]) (original as any)[k]=before.get(k);
    if(active.get(bot)===goal)active.delete(bot);
  };
  let remaining=check.path;
  const update=(result:{status:string;path:Move[]})=>{
    if(finder.goal!==goal)return;
    remaining=result.path;
    if(result.path.length && (!safeRoute(bot,result.path,route.anchor) || (departingWater&&result.path.length!==1))){stoppedReason='route-changed';cleanup();}
  };
  const start=Date.now(); let last=bot.entity.position.clone(), progressAt=start;
  active.set(bot,goal); signal.addEventListener('abort',cleanup,{once:true}); bot.on('path_update',update);
  timer=setInterval(()=>{
    if(distance(bot.entity.position,last)>.2){last=bot.entity.position.clone();progressAt=Date.now();}
    if(signal.aborted || !available() || finder.goal!==goal){cleanup();return;}
    const feet=bot.entity.position;
    const dry=dryCell(bot,feet);
    if(Math.floor(feet.x)!==Math.floor(origin.x) || Math.floor(feet.z)!==Math.floor(origin.z))departingWater=false;
    // Permit only the originally checked shallow cell, until first reaching dry ground.
    const leaving=departingWater && Math.floor(feet.y)>=Math.floor(origin.y)
      && Math.floor(feet.y)<=Math.floor(origin.y)+1
      && shallowStart(bot,origin) && dryBlock(bot.blockAt(feet.offset(0,1,0),false));
    if(Date.now()-start>12000)stoppedReason='time-limit';
    else if(Date.now()-progressAt>1800)stoppedReason='no-progress';
    else if(distance(feet,route.anchor)>12 || (!dry && !leaving)
      || remaining.some(n=>!dryCell(bot,n)||!supported(bot,n)))stoppedReason='route-changed';
    if(stoppedReason)cleanup();
  },50);
  try { await awaitPathGoal(bot,goal); }
  catch(error) {
    if(stoppedReason)throw new Error(`Idle stroll stopped: ${stoppedReason}`);
    if(!closed && !signal.aborted) throw error;
  }
  finally { cleanup(); }
}
