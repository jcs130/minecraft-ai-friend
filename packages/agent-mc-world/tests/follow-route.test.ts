import {afterEach,expect,it,vi} from 'vitest';
import {Vec3} from 'vec3';
import type {Bot}from'mineflayer';
import {followRoute}from'../core/follow-route.ts';
import {parseWalkRoute}from'../core/route-contract.ts';
import {cancelControlInput,waterControlActive}from'../core/skills-control.ts';
import {methodHarness,methodEnded}from'./method-harness.ts';

afterEach(()=>vi.useRealTimers());
const context=(aborted=()=>false)=>({aborted,taskId:97} as any);
function parsed(input:Record<string,unknown>){const r=parseWalkRoute(input);if('error'in r)throw Error(r.error);return r;}
async function settle<T>(pending:Promise<T>,max=1200){let done=false,result:T|undefined,error:unknown;pending.then(r=>{done=true;result=r},e=>{done=true;error=e});
 for(let i=0;!done&&i<max;i++)await vi.advanceTimersByTimeAsync(50);
 if(!done)throw Error('controller did not settle');if(error)throw error;return result!;}

it.each(['1.21.1','1.20.6'])('follows fractional waypoints around a pressure plate, preserving sneak and braking (%s)',async version=>{
 vi.useFakeTimers();const h=methodHarness(version),seen:{p:Vec3;sneak:boolean;sprint:boolean}[]=[];
 try{
  h.set(2,64,0,'stone_pressure_plate');
  h.bot.on('physicsTick',()=>seen.push({p:h.bot.entity.position.clone(),sneak:h.keys.sneak,sprint:h.keys.sprint}));
  const result=JSON.parse(await settle(followRoute(h.bot as unknown as Bot,parsed({waypoints:[{at:[.5,64,2.5],posture:'sneak'},{at:[4.5,64,2.5],posture:'sprint'},{at:[4.5,64,.5],posture:'walk'}],avoidBlocks:['stone_pressure_plate']}),context())));
  expect(result.arrived).toBe(true);expect(result.reached.map((p:any)=>p.index)).toEqual([1,2,3]);
  expect(h.bot.entity.position.distanceTo(new Vec3(4.5,64,.5))).toBeLessThan(.13);
  expect(seen.some(p=>p.sneak)).toBe(true);expect(seen.some(p=>p.sprint)).toBe(true);
  expect(seen.some(({p})=>p.x+.3>2&&p.x-.3<3&&p.z+.3>0&&p.z-.3<1)).toBe(false);
  expect(Object.values(h.keys).some(Boolean)).toBe(false);expect(waterControlActive(h.bot as unknown as Bot)).toBe(false);
 }finally{h.close();}
});

it.each(['plate','corner','gap','unknown'])('rejects an unsafe full segment before the first input (%s)',async kind=>{
 const h=methodHarness('1.21.1');try{
  let destination=[4.5,64,.5];
  if(kind==='plate')h.set(2,64,0,'stone_pressure_plate');
  if(kind==='corner'){h.set(1,64,0,'stone');destination=[2.5,64,2.5];}
  if(kind==='gap')h.set(2,63,0,'air');
  if(kind==='unknown'){const original=h.bot.blockAt;h.bot.blockAt=((p:Vec3)=>p.x===2?null:original(p))as any;}
  const set=vi.spyOn(h.bot,'setControlState');
  await expect(followRoute(h.bot as unknown as Bot,parsed({waypoints:[{at:destination}],avoidBlocks:['stone_pressure_plate']}),context())).rejects.toThrow(/预检受阻/);
  expect(set).not.toHaveBeenCalled();expect(h.bot.entity.position.x).toBe(.5);
 }finally{h.close();}
});

it.each(['death','respawn','forcedMove','cancel','new-owner'])('releases only its own input after %s',async kind=>{
 vi.useFakeTimers();const h=methodHarness('1.21.1');let aborted=false;
 try{
  const run=followRoute(h.bot as unknown as Bot,parsed({waypoints:[{at:[10.5,64,.5],posture:'sneak'}]}),context(()=>aborted));
  const settled=run.catch(e=>e);await vi.advanceTimersByTimeAsync(150);
  if(kind==='cancel')aborted=true;else if(kind==='new-owner'){cancelControlInput(h.bot as unknown as Bot,'preempt');h.bot.setControlState('back',true);}else h.bot.emit(kind);
  expect(await settle(settled)).toBeInstanceOf(Error);
  expect(h.keys.forward).toBe(false);expect(h.keys.sneak).toBe(false);expect(h.keys.back).toBe(kind==='new-owner');
  expect(waterControlActive(h.bot as unknown as Bot)).toBe(false);
 }finally{h.close();}
});

it('detects a newly placed obstacle and preserves completed waypoint evidence',async()=>{
 vi.useFakeTimers();const h=methodHarness('1.21.1');try{
  const run=followRoute(h.bot as unknown as Bot,parsed({waypoints:[{at:[1.5,64,.5]},{at:[6.5,64,.5]}]}),context());
  const outcome=run.catch(e=>e);await vi.advanceTimersByTimeAsync(800);h.set(4,64,0,'stone');
  const error=await settle(outcome);expect(error).toBeInstanceOf(Error);expect(error.message).toContain('现场已变化');
  expect(h.bot.entity.position.x).toBeLessThan(3.7);expect(Object.values(h.keys).some(Boolean)).toBe(false);
 }finally{h.close();}
});

it('executes an agent-authored route through the real isolated JavaScript worker and single body executor',async()=>{
 const h=methodHarness('1.21.1');try{
  const run=h.runner.start({name:'agent-local-sneak-detour',code:`
    const before=await bot.read('entity.position');
    const result=await mc.do([{skill:'follow_route',waypoints:[{at:[.5,64,1.5],posture:'sneak'},{at:[1.5,64,1.5]}],avoid:[[1,64,0]]}]);
    return {before,after:await bot.read('entity.position'),result};`});
  const result=await methodEnded(h,run.id);
  expect(result.status,JSON.stringify(result)).toBe('completed');
  expect(result.result).toMatchObject({before:{x:.5,y:64,z:.5},result:{accepted:true,done:true}});
  const value=result.result as {after:{x:number;y:number;z:number}};
  expect(Math.hypot(value.after.x-1.5,value.after.z-1.5)).toBeLessThan(.13);
  expect(Object.values(h.keys).some(Boolean)).toBe(false);
 }finally{h.close();}
});
