import {afterEach,expect,it,vi} from 'vitest';
import {Vec3} from 'vec3';
import type {Bot} from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import {methodHarness} from './method-harness.ts';
import {installPathfinderPerf} from '../core/pathfinder-perf.ts';
import {installPartialBlockStartRepair} from '../core/pathfinder-start.ts';
import {executeIdleRoam,sampleIdleRoam,idleRoamOwnsPath} from '../core/idle-roam.ts';
import {sampleIdleActions} from '../core/idle-actions.ts';
afterEach(()=>vi.useRealTimers());
function fixture(){
 vi.useFakeTimers();const h=methodHarness('1.21.1'),b=h.bot as unknown as Bot;
 Object.assign(b,{supportFeature:(name:string)=>b.registry.supportFeature(name),getControlState:(k:string)=>h.keys[k],isAlive:true,
  dig:vi.fn(()=>{throw Error('idle must not dig');}),placeBlock:vi.fn(()=>{throw Error('idle must not place');})});
 Object.assign(b.game,{minY:-64,height:384});
 Object.assign(b.world,{getBlockStateId:(p:Vec3)=>b.blockAt(p)?.stateId??null,getColumn:()=>({})});
 pathfinderPkg.pathfinder(b);installPathfinderPerf();installPartialBlockStartRepair(b);
 Object.assign((h.world as any).cfg.idle,{enabled:true,allowMovement:true});
 return {...h,b};
}
async function run(h:ReturnType<typeof fixture>,to:Vec3,expectedError?:string,retryDeferredSearch=false){
 const b=h.b,start=b.entity.position.clone(),original=b.pathfinder.getPathTo.bind(b.pathfinder);
 let searchStatus:string|undefined;
 const search=vi.spyOn(b.pathfinder,'getPathTo').mockImplementation((...args)=>{
  const result=original(...args);searchStatus=result.status;return result;
 });
 try{for(let attempt=0;attempt<(retryDeferredSearch?4:1);attempt++){
  const stop=new AbortController();let ended=false,error:unknown;searchStatus=undefined;
  const result=executeIdleRoam(b,{origin:start,destination:to,anchor:start},stop.signal,()=>true)
   .catch(e=>{error=e;}).finally(()=>{ended=true;});
  for(let i=0;i<280&&!ended;i++)await vi.advanceTimersByTimeAsync(50);
  await result;
  // Real wall-clock search budgets can defer on a cold/loaded CI runner. Model the
  // next idle tick only for that explicit status; never retry a started/failed walk.
  if(retryDeferredSearch && !error && ['partial','timeout'].includes(searchStatus??'')
    && b.entity.position.distanceTo(start)<.1 && !idleRoamOwnsPath(b)){
   await vi.advanceTimersByTimeAsync(200);continue;
  }
  if(expectedError)expect(String(error)).toContain(expectedError);else expect(error).toBeUndefined();break;
 }return start;}finally{search.mockRestore();}
}
it('offers a reachable stroll and walks around a wall, without changing blocks',async()=>{
 const h=fixture();try{
  for(let z=-1;z<=1;z++)for(let y=64;y<68;y++)h.set(2,y,z,'stone');
  const origin=h.b.entity.position.clone();let sample=sampleIdleRoam(h.b,origin,()=>0);
  // A bounded cold search may defer to the next idle tick under parallel CI load.
  for(let i=0;i<4&&!sample;i++)sample=sampleIdleRoam(h.b,origin,()=>0);
  expect(sample).not.toBeNull();expect(h.b.entity.position).toEqual(origin);
  expect(sampleIdleActions(h.b,{allowMovement:true}).candidates.some(c=>c.id==='stroll')).toBe(true);
  const zs:number[]=[];h.b.on('physicsTick',()=>zs.push(h.b.entity.position.z));
  await run(h,new Vec3(5,64,0),undefined,true);
  expect(h.b.entity.position.distanceTo(new Vec3(5.5,64,.5))).toBeLessThan(.8);
  expect(Math.max(...zs.map(Math.abs))).toBeGreaterThan(1.5);
  expect(h.b.dig).not.toHaveBeenCalled();expect(h.b.placeBlock).not.toHaveBeenCalled();
  expect(h.b.pathfinder.movements.canDig).toBe(true);expect(idleRoamOwnsPath(h.b)).toBe(false);
 }finally{h.close();}
});
it('walks up a one-block step and is not cancelled by its own airborne/moving gate',async()=>{
 const h=fixture();try{
  for(let x=2;x<=7;x++)for(let z=-4;z<=4;z++)h.set(x,64,z,'stone');
  const w=h.world as any;w.idleBehavior={active:true};
  let ownAirborne=false;h.b.on('physicsTick',()=>{if(idleRoamOwnsPath(h.b)&&!h.b.entity.onGround){ownAirborne=true;expect(w.idleUnavailableReason()).toBeNull();}});
  await run(h,new Vec3(5,65,0),undefined,true);expect(h.b.entity.position.y).toBeGreaterThan(64.9);
  expect(h.b.entity.position.x).toBeGreaterThan(4.8);expect(ownAirborne).toBe(true);
 }finally{h.close();}
});
it.each(['water','lava','fire','oak_pressure_plate'])('rejects a destination reached only through %s',async hazard=>{
 const h=fixture();try{
  for(let x=-12;x<=12;x++)for(let z=-12;z<=12;z++)h.set(x,64,z,hazard);
  for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)h.set(x,64,z,'air');
  expect(sampleIdleRoam(h.b,h.b.entity.position,()=>0)).toBeNull();
  const p=h.b.entity.position.clone();await run(h,new Vec3(5,64,0));expect(h.b.entity.position.distanceTo(p)).toBeLessThan(.1);
 }finally{h.close();}
});
it('cancels synchronously and late cleanup leaves a successor goal/controls intact',async()=>{
 const h=fixture();try{
  const stop=new AbortController(),p=h.b.entity.position.clone();
  const result=executeIdleRoam(h.b,{origin:p,destination:new Vec3(5,64,0),anchor:p},stop.signal,()=>true);
  await vi.advanceTimersByTimeAsync(300);expect(idleRoamOwnsPath(h.b)).toBe(true);
  stop.abort();expect(h.keys.forward).toBe(false);expect(h.b.pathfinder.movements.canDig).toBe(true);
  const successor=new pathfinderPkg.goals.GoalBlock(0,64,8);h.b.pathfinder.setGoal(successor);h.b.setControlState('forward',true);
  await vi.advanceTimersByTimeAsync(2);await result;expect(h.b.pathfinder.goal).toBe(successor);expect(h.keys.forward).toBe(true);
 }finally{h.close();}
});
it('stops before a new hazard on the chosen route and bounds a stalled walk',async()=>{
 const h=fixture();try{
  const p=h.b.entity.position.clone();let done=false;
  const result=executeIdleRoam(h.b,{origin:p,destination:new Vec3(5,64,0),anchor:p},new AbortController().signal,()=>true).catch(e=>e).finally(()=>done=true);
  await vi.advanceTimersByTimeAsync(200);h.set(4,64,0,'fire');await vi.advanceTimersByTimeAsync(100);await result;
  expect(done).toBe(true);expect(String(await result)).toContain('route-changed');expect(h.b.entity.position.x).toBeLessThan(4);expect(h.keys.forward).toBe(false);
  h.set(4,64,0,'air');h.b.physicsEnabled=false;
  const since=Date.now();await run(h,new Vec3(5,64,0),'no-progress');expect(Date.now()-since).toBeLessThan(2200);
 }finally{h.close();}
});
it('rejects missing chunks, a cliff and routes outside the idle anchor',async()=>{
 const h=fixture();try{
  const start=h.b.entity.position.clone(),read=h.b.blockAt.bind(h.b);
  h.b.blockAt=((p:Vec3,...args:any[])=>p.x>=2?null:read(p,...args)) as any;
  await run(h,new Vec3(5,64,0));expect(h.b.entity.position.distanceTo(start)).toBeLessThan(.1);
  h.b.blockAt=read;for(let x=2;x<=6;x++)for(let z=-12;z<=12;z++)for(let y=60;y<64;y++)h.set(x,y,z,'air');
  await run(h,new Vec3(5,64,0));expect(h.b.entity.position.distanceTo(start)).toBeLessThan(.1);
  const result=executeIdleRoam(h.b,{origin:start,destination:new Vec3(30,64,0),anchor:start},new AbortController().signal,()=>true);
  await result;expect(h.b.entity.position.distanceTo(start)).toBeLessThan(.1);
 }finally{h.close();}
});
