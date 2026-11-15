import {afterEach, expect, it, vi} from 'vitest';
import type {Bot} from 'mineflayer';
import {Vec3} from 'vec3';
import {boatDetour, type BoatPoint} from '../core/boat-detour.ts';
import {rideDrive, rideObstacle} from '../core/skills-interact.ts';
import {methodHarness} from './method-harness.ts';

afterEach(()=>vi.useRealTimers());
const start={x:.5,y:64,z:.5}, goal={x:8.5,y:64,z:.5};
it('plans a bounded sideways path around a bank rather than only sliding toward the goal',()=>{
  const clear=(a:BoatPoint,b:BoatPoint)=>{for(let t=0;t<=1;t+=.05){const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;if(x>=1&&x<=3&&Math.abs(z-.5)<=2)return false;}return true;};
  const path=boatDetour(start,goal,clear);expect(path).not.toBeNull();
  expect(path!.some(p=>Math.abs(p.z-.5)>2)).toBe(true);
  let prev=start;for(const p of path!){expect(clear(prev,p)).toBe(true);prev=p;}
  expect(Math.hypot(prev.x-goal.x,prev.z-goal.z)).toBeLessThanOrEqual(6);
});
it('does not emit an unverified partial path when surrounded or outside the bounded search',()=>{
  expect(boatDetour(start,goal,()=>false)).toBeNull();
  expect(boatDetour(start,{...goal,x:100},(a,b)=>b.x<1)).toBeNull();
});

function waterFixture(){
  const h=methodHarness('1.21.1');h.bot.physicsEnabled=false;
  for(let x=-10;x<16;x++)for(let z=-10;z<11;z++)h.set(x,63,z,'water');
  // A finite clay bank leaves open water on either side. A point-size planner
  // would cut the corner; replay checks the actual boat width at every packet.
  for(let x=1;x<=2;x++)for(let z=-2;z<=2;z++)for(let y=63;y<68;y++)h.set(x,y,z,'clay');
  const vehicle={id:9,name:'boat',isValid:true,position:new Vec3(.25,64,.5),width:1.4,height:.6};
  Object.assign(h.bot,{vehicle});return {...h,vehicle};
}
it('drives around a finite bank using collision-checked native-size steps and retains the attachment',async()=>{
  vi.useFakeTimers();const h=waterFixture(),bot=h.bot as unknown as Bot;
  const packets:BoatPoint[]=[];bot._client.write=((name:string,p:BoatPoint)=>{if(name==='vehicle_move')packets.push({...p});}) as never;
  try{
    const result=rideDrive(bot,{aborted:()=>false} as never,{x:8,y:64,z:0}).catch(e=>e);
    await vi.advanceTimersByTimeAsync(20_000);const receipt=await result;
    expect(receipt).not.toBeInstanceOf(Error);expect(String(receipt)).toContain('绕行');
    expect(packets.some(p=>Math.abs(p.z-.5)>3)).toBe(true);
    let prev:BoatPoint={x:.25,y:64,z:.5};
    for(const p of packets){expect(rideObstacle(bot,p.x,p.y,p.z,h.vehicle)).toBeNull();expect(Math.hypot(p.x-prev.x,p.z-prev.z)).toBeLessThanOrEqual(.301);prev=p;}
    expect(bot.vehicle).toBe(h.vehicle);expect(bot._client.listenerCount('vehicle_move')).toBe(0);
  }finally{h.close();}
});
it.each(['unknown','lava','dry'] as const)('does not route across %s cells or dismount automatically',async mode=>{
  vi.useFakeTimers();const h=waterFixture(),bot=h.bot as unknown as Bot;
  if(mode==='unknown'){const read=bot.blockAt;bot.blockAt=((p:Vec3)=>Math.abs(p.z-.5)>2?null:read(p)) as never;}
  else for(let x=-10;x<16;x++)for(let z=-10;z<11;z++)if(Math.abs(z-.5)>2)h.set(x,63,z,mode==='lava'?'lava':'stone');
  try{const result=rideDrive(bot,{aborted:()=>false} as never,{x:8,y:64,z:0}).catch(e=>e);await vi.advanceTimersByTimeAsync(20_000);expect(await result).toBeInstanceOf(Error);expect(bot.vehicle).toBe(h.vehicle);expect(bot._client.listenerCount('vehicle_move')).toBe(0);}finally{h.close();}
});
it('cancellation during a detour sends no later motion and removes the correction listener',async()=>{
  vi.useFakeTimers();const h=waterFixture(),bot=h.bot as unknown as Bot;let abort=false,count=0;
  bot._client.write=((name:string)=>{if(name==='vehicle_move'&&++count===4)abort=true;}) as never;
  try{const result=rideDrive(bot,{aborted:()=>abort} as never,{x:8,y:64,z:0}).catch(e=>e);await vi.advanceTimersByTimeAsync(20_000);expect(await result).toBeInstanceOf(Error);expect(count).toBe(4);expect(bot.vehicle).toBe(h.vehicle);expect(bot._client.listenerCount('vehicle_move')).toBe(0);}finally{h.close();}
});
