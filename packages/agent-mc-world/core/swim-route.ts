/** Loaded water geometry only: bounded, oxygen-aware A* and ordinary water inputs. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { movementReadout, ownNativeControlInput, skillControl } from './skills-control.ts';
import { checkAbort, sleep, SkillBlocked, type SkillContext } from './skill-context.ts';
import { WATER_BLOCKS } from './terrain.ts';
import { dropGoal } from './travel.ts';
import { remainingWaterBreathingMs } from './status-effects.ts';
import { breathingReadout } from './breathing.ts';
import { stableDryFooting } from './skills-build.ts';

type Point = { x: number; y: number; z: number };
type Cell = [number, number, number];
type Node = { at: Cell; air: number; cost: number; rank: number; parent: Node | null };
export interface SwimPlan {
  schema: 'agent-mc.swim-plan/v1'; sampledAt: string; from: Point; at: Cell;
  complete: boolean; reason: string | null; waypoints: Array<{ at: Cell; breathe: boolean; bank?: true }>;
  expanded: number; planningMs: number; estimatedMs: number | null; reserveOxygen: number;
  terrainSource: 'loaded-collision-map'; unknownCells: number; waterBreathingMs: number;
}
export interface SwimResult {
  schema: 'agent-mc.swim/v1'; taskId: number | null; dimension: string;
  startedAt: string; sampledAt: string; at: Cell; from: Point; position: Point;
  complete: boolean; reason: string | null; plan: SwimPlan | null;
  controlPulses: number; replans: number; breathStops: number; elapsedMs: number;
}
const results = new WeakMap<Bot, SwimResult>();
const owners = new WeakMap<Bot, { deadline: number; progressAt: number; reserve: number }>();
export const lastSwimResult = (bot: Bot): SwimResult | null => results.get(bot) ?? null;
const target = (at: Cell): Vec3 => new Vec3(at[0] + .5, at[1], at[2] + .5);
const key = (at: Cell): string => at.join(',');
const HORIZONTAL_MS = 800, VERTICAL_MS = 1200, SEARCH_NODES = 4096;
const finite = (p: Point) => [p.x,p.y,p.z].every(Number.isFinite);

/** Only a bounded route with real progress and current breathing evidence can defer the timer. */
export function progressingSwim(bot: Bot, now: number): boolean {
  const owner = owners.get(bot);
  if (!owner || now >= owner.deadline || now - owner.progressAt > 1_600) return false;
  if (remainingWaterBreathingMs(bot) > 0) return true;
  const breath = breathingReadout(bot, { attach: false });
  const updated = Date.parse(breath.oxygenUpdatedAt ?? '');
  return breath.oxygen !== null && breath.oxygen > owner.reserve && updated <= now && now - updated <= 2_000;
}

/** Does not expose block names or scan for materials. Unknown collision cells are impassable. */
function waterGeometry(bot: Bot) {
  const cache = new Map<string, { open: boolean; wet: boolean; support: boolean } | null>();
  let unknown = 0;
  const cell = (x: number,y: number,z: number) => {
    const id = `${x},${y},${z}`;
    if (cache.has(id)) return cache.get(id)!;
    const block = bot.blockAt(new Vec3(x,y,z), false);
    if (!block) { cache.set(id,null); unknown++; return null; }
    const shapes = block.shapes ?? (block.boundingBox === 'block' ? [[0,0,0,1,1,1]] : []);
    const open = !shapes.some(s => s[0]! < .8 && s[3]! > .2 && s[2]! < .8 && s[5]! > .2 && s[1]! < 1 && s[4]! > 0);
    const wet = WATER_BLOCKS.has(block.name) || block.isWaterlogged === true;
    const safe = !/^(lava|fire|soul_fire|magma_block|cactus|powder_snow|campfire|soul_campfire)$/.test(block.name);
    const support = !wet && safe && shapes.some(s => s[0]! <= .2 && s[3]! >= .8 && s[2]! <= .2 && s[5]! >= .8 && s[4] === 1);
    const entry = { open: open && safe, wet, support };
    cache.set(id, entry); return entry;
  };
  return {
    point(at: Cell): { breathe: boolean; wet: boolean } | null {
      const [x,y,z] = at, feet=cell(x,y,z), head=cell(x,y+1,z);
      if (!feet?.open || !head?.open) return null;
      if (!feet.wet && !head.wet && !cell(x,y-1,z)?.wet) return null;
      return {breathe:!head.wet,wet:feet.wet||head.wet};
    },
    bank(from: Cell, to: Cell): boolean {
      const [x,y,z] = to, feet = cell(x,y,z), head = cell(x,y+1,z), support = cell(x,y-1,z);
      return Math.abs(x-from[0])+Math.abs(z-from[2])===1
        && (y === from[1] || (y === from[1]+1 && cell(from[0],from[1]+2,from[2])?.open === true))
        && !!feet?.open && !feet.wet && !!head?.open && !head.wet && !!support?.support;
    },
    unknown: () => unknown,
  };
}
function push(heap: Node[], value: Node): void {
  heap.push(value); let i=heap.length-1;
  while(i>0) { const p=(i-1)>>1; if(heap[p]!.rank<=value.rank)break; heap[i]=heap[p]!;i=p; } heap[i]=value;
}
function pop(heap: Node[]): Node {
  const first=heap[0]!,last=heap.pop()!;
  if(heap.length) { let i=0;while(i*2+1<heap.length) { let c=i*2+1;if(c+1<heap.length && heap[c+1]!.rank<heap[c]!.rank)c++;
    if(last.rank<=heap[c]!.rank)break;heap[i]=heap[c]!;i=c; } heap[i]=last; }return first;
}

export async function planSwim(bot: Bot, at: Cell, reserveOxygen = 6, aborted: () => boolean = () => false,
  options: { seekBank?: boolean } = {}): Promise<SwimPlan> {
  const started=Date.now(), p=bot.entity?.position;
  if(!p || !finite(p))throw new SkillBlocked('还没进入世界，不能规划水路');
  const from={x:p.x,y:p.y,z:p.z}, movement=movementReadout(bot),breathingMs=remainingWaterBreathingMs(bot);
  const result:SwimPlan={schema:'agent-mc.swim-plan/v1',sampledAt:new Date().toISOString(),from,at,complete:false,
    reason:null,waypoints:[],expanded:0,planningMs:0,estimatedMs:null,reserveOxygen,terrainSource:'loaded-collision-map',unknownCells:0,waterBreathingMs:breathingMs};
  const geometry=waterGeometry(bot);
  const finish=(reason:string|null) => ({...result,reason,planningMs:Date.now()-started,unknownCells:geometry.unknown()});
  if(!at.every(Number.isSafeInteger) || at.some(n=>Math.abs(n)>30_000_000) || !Number.isInteger(reserveOxygen) || reserveOxygen<6 || reserveOxygen>16) return finish('invalid_parameters');
  if(movement.bodyWet===null || movement.headWet===null)return finish('water_state_unknown');
  if(movement.vehicleAttached || !movement.bodyWet)return finish(movement.vehicleAttached?'vehicle_attached':'not_in_water');
  const seekBank=options.seekBank===true, range=seekBank?12:32;
  if(!seekBank && p.distanceTo(target(at))>range)return finish('target_out_of_range');
  if(!seekBank && !geometry.point(at))return finish('target_not_swimmable_or_unloaded');
  if(movement.headWet && movement.oxygen===null && !breathingMs)return finish('oxygen_unknown');
  const oxygen=movement.oxygen;
  if(movement.headWet && oxygen!==null && oxygen<=reserveOxygen && !breathingMs)return finish('low_oxygen');
  const start:Cell=[Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)];
  const estimate=(c:Cell)=>seekBank?0:Math.abs(c[0]-at[0])*HORIZONTAL_MS+Math.abs(c[1]-at[1])*VERTICAL_MS+Math.abs(c[2]-at[2])*HORIZONTAL_MS;
  // A breath node is a planning assumption; execution waits for an actual air reading before diving again.
  const capacity=(20-reserveOxygen)*750;
  const initialAir=oxygen===null?0:Math.max(0,(oxygen-reserveOxygen)*750);
  const heap:Node[]=[],seen=new Map<string,Array<{cost:number;air:number}>>();
  const first:Node={at:start,air:initialAir,cost:0,rank:estimate(start),parent:null};push(heap,first);
  let oxygenLimited=false;
  while(heap.length && result.expanded<SEARCH_NODES && Date.now()-started<500) {
    if(aborted())return finish('cancelled');
    const node=pop(heap);result.expanded++;
    const bank=seekBank && node.parent && geometry.bank(node.parent.at,node.at);
    if(bank || (!seekBank && key(node.at)===key(at))) {
      const chain:Node[]=[];for(let n:Node|null=node;n?.parent;n=n.parent)chain.push(n);
      chain.reverse();result.waypoints=(chain.length?chain:[node]).map(n=>bank && n===node
        ? {at:n.at,breathe:true,bank:true} : {at:n.at,breathe:geometry.point(n.at)!.breathe});
      result.at=node.at;
      result.complete=true;result.estimatedMs=node.cost;return finish(null);
    }
    if(result.expanded%64===0)await sleep(0);
    const edges=seekBank?BANK_EDGES:WATER_EDGES;
    for(const [dx,dy,dz] of edges) {
      const next:Cell=[node.at[0]+dx!,node.at[1]+dy!,node.at[2]+dz!];
      if(Math.hypot(next[0]-start[0],next[1]-start[1],next[2]-start[2])>range)continue;
      const landing=seekBank&&(dx!==0||dz!==0)&&geometry.bank(node.at,next);
      const terrain=landing?{breathe:true,wet:false}:dy===1&&(dx!==0||dz!==0)?null:geometry.point(next);
      if(!terrain || (seekBank && !landing && !terrain.wet))continue;
      const ms=dy?VERTICAL_MS:HORIZONTAL_MS, cost=node.cost+ms;
      const protectedMs=Math.min(ms,Math.max(0,breathingMs-node.cost));
      if(landing && geometry.point(node.at)?.breathe!==true && node.air < ms-protectedMs) {oxygenLimited=true;continue;}
      const air=terrain.breathe?capacity:node.air-(ms-protectedMs);
      if(air<0) {oxygenLimited=true;continue;}
      const previous=seen.get(key(next))??[];
      if(previous.some(n=>n.cost<=cost && n.air>=air))continue;
      seen.set(key(next),[...previous.filter(n=>!(cost<=n.cost && air>=n.air)),{cost,air}]);
      push(heap,{at:next,air,cost,rank:cost+estimate(next),parent:node});
    }
  }
  return finish(heap.length?'planning_budget_exhausted':oxygenLimited?'oxygen_budget_insufficient':seekBank?'no_loaded_bank_route':'no_loaded_water_route');
}

const WATER_EDGES = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]] as const;
const BANK_EDGES = [...WATER_EDGES,[1,1,0],[-1,1,0],[0,1,1],[0,1,-1]] as const;

export async function skillSwim(bot: Bot, call: {at: Cell;reserveOxygen?:number;maxDurationMs?:number;dryRun?:boolean;seekBank?:boolean}, ctx:SkillContext,
  initialPlan?: SwimPlan): Promise<string> {
  checkAbort(ctx);
  const reserve=call.reserveOxygen??6,started=Date.now(),deadline=started+(call.maxDurationMs??45000);
  let plan:SwimPlan|null=null,reason:string|null=null,pulses=0,replans=0,breathStops=0;
  let release: (() => void) | undefined;
  const owner={deadline,progressAt:0,reserve};
  const from=bot.entity.position.clone();
  const save=(complete:boolean) => {
    const result:SwimResult={schema:'agent-mc.swim/v1',taskId:ctx.taskId??null,dimension:String(bot.game.dimension),
      startedAt:new Date(started).toISOString(),sampledAt:new Date().toISOString(),at:plan?.at??call.at,from,
      position:bot.entity.position.clone(),complete,reason,plan,controlPulses:pulses,replans,breathStops,elapsedMs:Date.now()-started};
    results.set(bot,result);return result;
  };
  try {
    plan=initialPlan??await planSwim(bot,call.at,reserve,ctx.aborted,{seekBank:call.seekBank});
    checkAbort(ctx);
    if(call.dryRun)return JSON.stringify(plan);
    if(!plan.complete) {reason=plan.reason;throw new SkillBlocked(`水路受阻: ${reason}`);}
    dropGoal(bot,'task','水下路线接管',ctx.diag);
    release=ownNativeControlInput(bot);
    owners.set(bot,owner);
    let index=0,stalled=0;
    const arrived=()=>!!plan && bot.entity.position.distanceTo(target(plan.at))<=.8
      && (!call.seekBank || (bot.entity.onGround && movementReadout(bot).bodyWet===false));
    while(!arrived()) {
      checkAbort(ctx);
      if(Date.now()>deadline) {reason='movement_timeout';break;}
      const reading=movementReadout(bot);
      const waypoint=plan.waypoints[index];
      if(!waypoint) {reason='route_end_unconfirmed';break;}
      if(reading.vehicleAttached || (!reading.bodyWet && (!waypoint.bank || bot.entity.onGround))) {
        reason='left_water_or_vehicle_changed';break;
      }
      if(reading.headWet && !remainingWaterBreathingMs(bot) && (reading.oxygen===null || reading.oxygen<=reserve)) {reason=reading.oxygen===null?'oxygen_unknown':'low_oxygen';break;}
      const destination=target(waypoint.at),before=bot.entity.position.clone(),dist=before.distanceTo(destination);
      if(!waypoint.bank && dist<=.55 && (!waypoint.breathe || reading.headWet===false)) {
        // Surface travel does not spend the planner's underwater air budget.
        // Verify a refill before the next submerged leg, not at every surface cell.
        if(waypoint.breathe && plan.waypoints[index+1]?.breathe===false && !remainingWaterBreathingMs(bot) && (reading.oxygen===null || reading.oxygen<20)) {
          breathStops++;const until=Math.min(deadline,Date.now()+3000);
          while(Date.now()<until) {
            checkAbort(ctx);const r=movementReadout(bot);if(r.headWet!==false || r.bodyWet!==true)break;
            if(r.oxygen!==null && r.oxygen>=20)break;
            await skillControl(bot,{skill:'control',mode:'water',keys:bot.entity.position.y<destination.y+.25?['jump']:[],
              durationMs:Math.min(200,until-Date.now())},ctx);
            pulses++;
          }
          const r=movementReadout(bot);
          if(r.headWet!==false || r.oxygen===null || r.oxygen<20) {reason='breathing_unconfirmed';break;}
        }
        index++;continue;
      }
      const dx=destination.x-before.x,dz=destination.z-before.z,horizontal=Math.hypot(dx,dz);
      const desired=Math.atan2(-dx,-dz),delta=desired-(reading.yaw??0);
      const keys:Array<'forward'|'jump'>=[];
      if(horizontal>.2)keys.push('forward');
      if(reading.bodyWet && (destination.y-before.y>.18 || (waypoint.breathe && (reading.headWet===true || before.y<destination.y+.25))))keys.push('jump');
      // Vertical travel must not aim at tiny horizontal drift: atan2 around the
      // waypoint centre flips by pi while no horizontal input is even active.
      await skillControl(bot,{skill:'control',mode:'water',keys,durationMs:200,
        ...(horizontal>.2 ? {yawDeg:Math.atan2(Math.sin(delta),Math.cos(delta))*180/Math.PI} : {})},ctx,
        {finishAtBank:waypoint.bank});
      pulses++;
      const progress=dist-bot.entity.position.distanceTo(destination);
      if(progress>=.02)owner.progressAt=Date.now();
      stalled=progress<.02?stalled+1:0;
      if(stalled>=6) {
        if(replans>=2) {reason='no_progress';break;}
        replans++;plan=await planSwim(bot,call.at,reserve,ctx.aborted,{seekBank:call.seekBank});checkAbort(ctx);
        if(!plan.complete) {reason=plan.reason;break;}
        index=0;stalled=0;
      }
    }
    if(call.seekBank && !reason && !(await stableDryFooting(bot,ctx)))reason='bank_footing_unconfirmed';
    const done=!reason && arrived();
    const result=save(done);
    if(!done)throw new SkillBlocked(`水路尚未完成: ${reason??'arrival_unconfirmed'}`,[JSON.stringify(result)]);
    return `水路抵达；${JSON.stringify(result)}`;
  } catch(error) {
    reason??=ctx.aborted()?'cancelled':error instanceof Error?error.message:'operation_failed';save(false);throw error;
  } finally {
    if(owners.get(bot)===owner)owners.delete(bot);
    release?.();
  }
}
