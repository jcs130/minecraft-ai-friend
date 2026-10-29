import {afterEach,describe,expect,it} from 'vitest';
import type {Bot} from 'mineflayer';
import {Vec3} from 'vec3';
import {planSwim,lastSwimResult} from '../core/swim-route.ts';
import {prepareWorkRoutine} from '../core/work-routines.ts';
import {parseSteps} from '../core/skills.ts';
import {methodHarness,methodEnded} from './method-harness.ts';

const fixtures:ReturnType<typeof methodHarness>[]=[];
afterEach(()=>fixtures.splice(0).forEach(h=>h.close()));
function pool(low=64,high=68,range=4) {
 const h=methodHarness();fixtures.push(h);
 for(let x=-range;x<=range;x++)for(let z=-range;z<=range;z++){
  for(let y=low;y<=high;y++)h.set(x,y,z,'water');h.set(x,high+1,z,'stone');
 }
 h.bot.entity.position=new Vec3(.5,low+1,.5);h.bot.entity.onGround=false;
 return h;
}
describe('oxygen-aware loaded-water routes',()=>{
 it('ascends a vertical waypoint without turning toward sub-deadband horizontal drift',async()=>{
  const h=pool();h.bot.entity.position=new Vec3(.51,65,.49);h.bot.entity.yaw=1.1;
  const id=h.runner.start(prepareWorkRoutine('swim_route',{dimension:'overworld',at:[0,67,0]})).id;
  const until=Date.now()+7000;while(h.runner.read(id)[0]?.status==='running'&&Date.now()<until)await new Promise(r=>setTimeout(r,20));
  expect(h.runner.read(id)[0],JSON.stringify(h.runner.read(id)[0])).toMatchObject({status:'completed',result:{goalCompleted:true}});
  expect(h.bot.entity.yaw).toBeCloseTo(1.1,5);
  expect(h.bot.entity.position.y).toBeGreaterThan(66.2);
 },10000);
 it('plans cardinal three-dimensional detours with no mutation or diagonal corner clipping',async()=>{
  const h=pool();for(let y=64;y<=68;y++)h.set(1,y,0,'stone');
  const before=h.bot.entity.position.clone();const p=await planSwim(h.bot as unknown as Bot,[3,65,0]);
  expect(p).toMatchObject({complete:true,reason:null,terrainSource:'loaded-collision-map'});
  expect(p.waypoints.length).toBeGreaterThan(3);expect(h.bot.entity.position).toEqual(before);
  let last=[0,65,0];for(const point of p.waypoints){expect(point.at.reduce((n,v,i)=>n+Math.abs(v-last[i]),0)).toBe(1);last=point.at;}
 });
 it('does not jump through an intermediate solid layer to a water cell three blocks below',async()=>{
  const h=pool(63,68);h.bot.entity.position.y=66;
  for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)h.set(x,65,z,'stone');
  const plan=await planSwim(h.bot as unknown as Bot,[0,63,0]);
  expect(plan.complete).toBe(false);expect(plan.waypoints).toEqual([]);
 });
 it('preserves unknown water and oxygen, limits search, and does not manufacture a breath refill',async()=>{
  const h=pool();h.bot.oxygenLevel=undefined as never;
  expect(await planSwim(h.bot as unknown as Bot,[2,65,0])).toMatchObject({complete:false,reason:'oxygen_unknown'});
  h.bot.oxygenLevel=7;
  expect((await planSwim(h.bot as unknown as Bot,[4,65,0])).complete).toBe(false);
  h.bot.oxygenLevel=20;
  expect(await planSwim(h.bot as unknown as Bot,[99,65,0])).toMatchObject({reason:'target_out_of_range'});
  expect(await planSwim({...h.bot,blockAt:()=>null} as unknown as Bot,[2,65,0])).toMatchObject({complete:false,reason:'water_state_unknown'});
 });
 it('uses the public registry and supports read-only SDK planning without acquiring a body',async()=>{
  const parsed=parseSteps([{skill:'swim',at:[2,65,0],dryRun:true}]);expect(parsed).toMatchObject({steps:[{reserveOxygen:6,maxDurationMs:45000}]});
  const h=pool();const id=h.runner.start({name:'preview swim',code:'return await mc.swimPlan({at:[2,65,0]});'}).id;
  expect(await methodEnded(h,id)).toMatchObject({status:'completed',result:{complete:true}});
  expect(h.exec.currentTask).toBeNull();expect(Object.values(h.keys).some(Boolean)).toBe(false);
 });
 it('uses an actual water-breathing effect only for its remaining duration',async()=>{
  const h=pool();h.bot.oxygenLevel=7;
  const effectId=Object.values(h.bot.registry.effects as Record<string,any>).find((e:any)=>e.name==='WaterBreathing')!.id;
  (h.bot.entity.effects as any)[effectId]={duration:1200};
  expect(await planSwim(h.bot as unknown as Bot,[4,65,0])).toMatchObject({complete:true,waterBreathingMs:expect.any(Number)});
  (h.bot.entity.effects as any)[effectId]={duration:1};
  expect((await planSwim(h.bot as unknown as Bot,[4,65,0])).complete).toBe(false);
 });
 it('finishes a real executor detour using unchanged Prismarine swimming and one action group',async()=>{
  const h=pool();for(let y=64;y<=68;y++)h.set(1,y,0,'stone');
  const id=h.runner.start(prepareWorkRoutine('swim_route',{dimension:'overworld',at:[3,65,0]})).id;
  const end=Date.now()+22000;while(h.runner.read(id)[0]?.status==='running'&&Date.now()<end)await new Promise(r=>setTimeout(r,20));
  const r=h.runner.read(id)[0];expect(r,JSON.stringify(r)).toMatchObject({status:'completed',result:{goalCompleted:true,route:{complete:true}}});
  expect(r.trace.filter(t=>t.method==='do')).toHaveLength(1);
  expect(lastSwimResult(h.bot as unknown as Bot)?.controlPulses).toBeGreaterThan(0);
  expect(h.bot.entity.position.distanceTo(new Vec3(3.5,65,.5))).toBeLessThan(.81);
 },25000);
 it('cancels an in-flight route, records its incomplete result and releases controls',async()=>{
  const h=pool();const id=h.runner.start(prepareWorkRoutine('swim_route',{dimension:'overworld',at:[4,65,0]})).id;
  const until=Date.now()+3000;while(!h.keys.forward&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
  expect(h.keys.forward).toBe(true);h.runner.stop('cancel water route');await new Promise(r=>setTimeout(r,250));
  expect(h.runner.read(id)[0].status).toBe('cancelled');expect(Object.values(h.keys).every(v=>!v)).toBe(true);
  expect(lastSwimResult(h.bot as unknown as Bot)).toMatchObject({complete:false});
 });
});
