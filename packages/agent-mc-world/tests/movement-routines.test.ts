import { afterEach, describe, expect, it } from 'vitest';
import { MethodRunner, type MethodRun } from '../core/method-runner.ts';
import { prepareWorkRoutine, readWorkRoutine } from '../core/work-routines.ts';
import { movementReadout } from '../core/skills-control.ts';
import { methodHarness, methodEnded } from './method-harness.ts';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

function rig(id: string, params: Record<string, unknown>, options: {
  denied?: boolean; unchanged?: boolean; oxygen?: number | null; permission?: boolean; headWet?: boolean;
  noProgress?: boolean; revoke?: boolean; dimension?: string; legs?: number; budget?: boolean;
} = {}) {
  let p = {x:0.5,y:64,z:0.5}, n = 0, yaw = 0;
  const actions: any[] = [];
  const state = () => ({sampledAt:new Date(++n).toISOString(),connectionGeneration:1,combatActive:false,
    snapshot:{position:{...p},dimension:options.dimension ?? 'overworld',health:20},
    movement:{bodyWet:true,headWet:options.headWet ?? true,oxygen:options.oxygen===undefined?20:options.oxygen,yaw,onGround:true,vehicleAttached:false},
    flight:{allowed:options.permission!==false && !(options.revoke && actions.length>0),flying:false}});
  let end!: (r:MethodRun)=>void;
  const terminal = new Promise<MethodRun>(r=>{end=r;});
  const runner = new MethodRunner({onFinish:end,nativeMethods:['blockAt'],call:async (method,args)=>{
    if (method==='state') return state();
    if (method==='mineflayer') return {value:{name:'water',position:args.args?.[0]}};
    if (method==='flightPlan') return {complete:true,from:[p.x,p.y,p.z],sampledAt:new Date(n).toISOString(),
      fitsBudget:options.budget!==false,steps:options.budget===false?null:Array.from({length:options.legs ?? 2},(_,i)=>({skill:'flight',at:[i+1,64,0],land:i===(options.legs ?? 2)-1,needs:i?[i]:undefined}))};
    const step=(args.steps as any[])[0]; actions.push(step);
    const old={...p};
    if (!options.denied && !options.unchanged) {
      if (step.skill==='control') {
        yaw+=(step.yawDeg ?? 0)*Math.PI/180;
        if (!options.noProgress) p={x:p.x-Math.sin(yaw),y:p.y,z:p.z-Math.cos(yaw)};
      } else p={x:step.at[0]+0.5,y:step.at[1],z:step.at[2]+0.5};
    }
    return {accepted:true,done:!options.denied,taskId:actions.length,
      steps:[{step:1,outcome:options.denied?'fail':'ok'}],receipt:JSON.stringify({old,new:p}),state:state()};
  }});
  runner.start(prepareWorkRoutine(id,params));
  return {runner,terminal,actions};
}

describe('bounded movement routine receipts',()=>{
  it('validates absolute coordinates and movement budgets before starting a body',()=>{
    for (const id of ['navigate_route','flight_route']) {
      expect(()=>prepareWorkRoutine(id,{dimension:'overworld',waypoints:[['~1',64,0]]})).toThrow();
      expect(()=>prepareWorkRoutine(id,{waypoints:[[1,64,0]]})).toThrow();
      expect(()=>prepareWorkRoutine(id,{dimension:'overworld',waypoints:Array(9).fill([1,64,0])})).toThrow();
    }
    for (const extra of [{maxPulses:13},{pulseMs:1001},{minOxygen:5},{within:0.1}]) {
      expect(()=>prepareWorkRoutine('swim_to',{dimension:'overworld',at:[1,64,0],...extra})).toThrow();
    }
    expect(readWorkRoutine('flight_route').code.length).toBeLessThan(12000);
  });
  it('walks a route with one model instruction and preserves real per-leg positions',async()=>{
    const r=rig('navigate_route',{dimension:'minecraft:overworld',waypoints:[[1,64,0],[3,64,0],[1,64,0]]});
    const result=await r.terminal;
    expect(result).toMatchObject({status:'completed',result:{goalCompleted:true,outcome:'completed',remaining:[],position:{x:1.5,y:64,z:0.5}}});
    expect(r.actions).toHaveLength(3);
    expect(r.actions.every(s=>s.exact===true && s.walkOnly===true && s.dimension==='minecraft:overworld')).toBe(true);
    expect((result.result as any).records[1]).toMatchObject({from:{x:1.5,y:64,z:0.5},to:{x:3.5,y:64,z:0.5}});
  });
  it('does not confuse accepted or finished movement with actual arrival or retry a denied route',async()=>{
    for (const options of [{denied:true},{unchanged:true}]) {
      const r=rig('navigate_route',{dimension:'overworld',waypoints:[[2,64,0],[3,64,0]]},options);
      expect(await r.terminal).toMatchObject({status:'completed',result:{goalCompleted:false,outcome:'blocked',remaining:[[2,64,0],[3,64,0]]}});
      expect(r.actions).toHaveLength(1);
    }
  });
  it('skips already reached cells and allows explicit terrain-changing navigation',async()=>{
    const r=rig('navigate_route',{dimension:'overworld',waypoints:[[0,64,0],[1,64,0]],walkOnly:false});
    expect(await r.terminal).toMatchObject({result:{goalCompleted:true,records:[{outcome:'noop'},{outcome:'ok'}]}});
    expect(r.actions).toHaveLength(1);expect(r.actions[0].walkOnly).toBe(false);
  });
  it('rejects a dimension mismatch without walking',async()=>{
    const r=rig('navigate_route',{dimension:'the_nether',waypoints:[[1,64,0]]});
    expect(await r.terminal).toMatchObject({result:{reason:'dimension_mismatch'}});expect(r.actions).toEqual([]);
  });
  it('steers water inputs using native radians, re-reads actual position and stops at the target',async()=>{
    const r=rig('swim_to',{dimension:'overworld',at:[2,64,0],within:0.5});
    expect(await r.terminal).toMatchObject({result:{goalCompleted:true,outcome:'completed',remaining:[]}});
    expect(r.actions).toHaveLength(2);expect(r.actions[0]).toMatchObject({skill:'control',mode:'water',yawDeg:-90,keys:['forward'],durationMs:500});
  });
  it('does not rotate on pure vertical swim pulses when horizontal drift is within tolerance',async()=>{
    const r=rig('swim_to',{dimension:'overworld',at:[0,67,0]},{noProgress:true});
    expect(await r.terminal).toMatchObject({result:{goalCompleted:false,reason:'no_progress'}});
    expect(r.actions).toHaveLength(3);
    for(const step of r.actions){expect(step.keys).toEqual(['jump']);expect(step).not.toHaveProperty('yawDeg');}
  });
  it.each([{oxygen:8},{oxygen:null}])('will not submerge with unusable oxygen %j',async options=>{
    const r=rig('swim_to',{dimension:'overworld',at:[1,63,0]},options);
    expect(await r.terminal).toMatchObject({result:{goalCompleted:false,reason:options.oxygen===null?'oxygen_unknown':'low_oxygen'}});
    expect(r.actions).toEqual([]);
  });
  it('stops a wedged swimmer after measured non-progress instead of repeating until timeout',async()=>{
    const r=rig('swim_to',{dimension:'overworld',at:[4,64,0]},{noProgress:true});
    expect(await r.terminal).toMatchObject({result:{goalCompleted:false,reason:'no_progress'}});expect(r.actions).toHaveLength(3);
  });
  it('does not invent flight permission or start a route beyond its checked budget',async()=>{
    for (const options of [{permission:false},{budget:false},{legs:17}]) {
      const r=rig('flight_route',{dimension:'overworld',waypoints:[[2,64,0]]},options);
      expect(await r.terminal).toMatchObject({result:{goalCompleted:false,outcome:'blocked'}});expect(r.actions).toEqual([]);
    }
  });
  it('flies the checked absolute legs without carrying cross-group needs and confirms landing',async()=>{
    const r=rig('flight_route',{dimension:'overworld',waypoints:[[2,64,0]]});
    expect(await r.terminal).toMatchObject({result:{goalCompleted:true,remaining:[],records:[{outcome:'ok'},{outcome:'ok'}]}});
    expect(r.actions).toEqual([{skill:'flight',at:[1,64,0],land:false},{skill:'flight',at:[2,64,0],land:true}]);
  });
  it('keeps the unflown absolute legs when permission is revoked between segments',async()=>{
    const r=rig('flight_route',{dimension:'overworld',waypoints:[[2,64,0]]},{revoke:true});
    expect(await r.terminal).toMatchObject({result:{outcome:'partial',reason:'flight_permission_lost',remaining:[{at:[2,64,0],land:true}]}});
    expect(r.actions).toHaveLength(1);
  });
});

const fixtures:ReturnType<typeof methodHarness>[]=[];
afterEach(()=>{for(const h of fixtures.splice(0))h.close();});
it('keeps unknown oxygen and unloaded self-local water readings unknown',()=>{
  const h=methodHarness();fixtures.push(h);h.bot.oxygenLevel=undefined as never;
  expect(movementReadout(h.bot as unknown as Bot).oxygen).toBeNull();
  const bot={...h.bot,blockAt:()=>null} as unknown as Bot;
  expect(movementReadout(bot)).toMatchObject({bodyWet:null,headWet:null,feetWet:null});
});
it('runs swim_to through the real executor and pinned Prismarine collision/water physics',async()=>{
  const h=methodHarness();fixtures.push(h);
  for(let x=-4;x<=5;x++)for(let z=-4;z<=4;z++)for(let y=64;y<=69;y++)h.set(x,y,z,'water');
  h.bot.entity.position=new Vec3(.5,66,.5);h.bot.entity.onGround=false;
  const id=h.runner.start(prepareWorkRoutine('swim_to',{dimension:'overworld',at:[2,66,0],within:0.8})).id;
  const r=await methodEnded(h,id);
  expect(r).toMatchObject({status:'completed',result:{goalCompleted:true,outcome:'completed'}});
  expect(h.bot.entity.position.x).toBeGreaterThan(1.7);
  expect(Object.values(h.keys).every(v=>v===false)).toBe(true);
},10000);
it('cancellation releases an active swimmer and cannot become successful arrival',async()=>{
  const h=methodHarness();fixtures.push(h);
  for(let x=-4;x<=8;x++)for(let z=-4;z<=4;z++)for(let y=64;y<=69;y++)h.set(x,y,z,'water');
  h.bot.entity.position=new Vec3(.5,66,.5);h.bot.entity.onGround=false;
  const id=h.runner.start(prepareWorkRoutine('swim_to',{dimension:'overworld',at:[6,66,0],pulseMs:1000})).id;
  const deadline=Date.now()+3000;
  while(!h.keys.forward && Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  expect(h.keys.forward).toBe(true);h.runner.stop('user cancelled');
  const r=await methodEnded(h,id);
  expect(r.status).toBe('cancelled');
  await new Promise(r=>setTimeout(r,120));
  expect(Object.values(h.keys).every(v=>v===false)).toBe(true);
},10000);
it('runs the flight plan through the real executor, permission watcher and landing physics',async()=>{
  const h=methodHarness();fixtures.push(h);
  h.bot._client.emit('abilities',{flags:4,flyingSpeed:0.05});
  const id=h.runner.start(prepareWorkRoutine('flight_route',{dimension:'overworld',waypoints:[[2,66,0],[4,64,0]]})).id;
  const r=await methodEnded(h,id);
  expect((r.result as any)?.reason,JSON.stringify(r.result)).toBeNull();
  expect(r).toMatchObject({status:'completed',result:{goalCompleted:true,outcome:'completed',remaining:[]}});
  expect(h.bot.entity.position.distanceTo(new Vec3(4.5,64,.5))).toBeLessThan(.7);
  expect(h.bot.entity.onGround).toBe(true);expect(h.bot.physicsEnabled).toBe(true);
  expect(Object.values(h.keys).every(v=>v===false)).toBe(true);
},10000);
