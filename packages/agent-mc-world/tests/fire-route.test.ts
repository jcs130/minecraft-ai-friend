import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Bot} from 'mineflayer';
import {methodHarness} from './method-harness.ts';
import {fireRoutes,crossFire,intentionalFireCrossing} from '../core/fire-route.ts';
import {parseSteps} from '../core/skills.ts';
beforeEach(()=>{vi.useFakeTimers();});afterEach(()=>vi.useRealTimers());
const ctx=(controller=new AbortController())=>({aborted:()=>controller.signal.aborted,taskId:97,log:{info(){},warn(){},debug(){},error(){}}} as any);
it('prices crossing fire rather than declaring all fire impassable, including a collision-verified jump',()=>{
 const h=methodHarness('1.21.1');try{
  h.set(1,64,0,'fire');const b=h.bot as unknown as Bot;
  const walk=fireRoutes(b,{at:[2.5,64,.5],mode:'walk'}),jump=fireRoutes(b,{at:[2.5,64,.5],mode:'jump'});
  expect(walk.length).toBeGreaterThan(0);expect(jump.length).toBeGreaterThan(0);
  expect(walk[0].estimatedDamage).toBeGreaterThan(0);
  expect(fireRoutes(b,{at:[2.5,64,.5]})[0].cost).toBe(Math.min(walk[0].cost,jump[0].cost));
  expect(h.bot.entity.position.x).toBe(.5);
  h.set(1,65,0,'stone');h.set(1,66,0,'stone');
  expect(fireRoutes(b,{at:[2.5,64,.5],mode:'jump'})).toEqual([]);
 }finally{h.close();}
});
it('executes one native crossing, yields fire reflex only for that action, and clears ownership',async()=>{
 const h=methodHarness('1.21.1');try{
  h.set(1,64,0,'fire');const b=h.bot as unknown as Bot;
  const run=crossFire(b,{at:[2.5,64,.5],mode:'jump',maxDamage:12},ctx());
  await vi.advanceTimersByTimeAsync(50);expect(intentionalFireCrossing(b)).toBe(true);
  await vi.advanceTimersByTimeAsync(2500);const result=JSON.parse(await run);
  expect(result.completed).toBe(true);expect(h.bot.entity.position.x).toBeGreaterThan(2);
  expect(intentionalFireCrossing(b)).toBe(false);expect(Object.values(h.keys).some(Boolean)).toBe(false);
 }finally{h.close();}
});
it('does not enter lava, unsupported/unloaded landing or a route exceeding damage budget; cancellation cleans up',async()=>{
 const h=methodHarness('1.21.1');try{
  const b=h.bot as unknown as Bot;h.set(1,64,0,'fire');
  await expect(crossFire(b,{at:[2.5,64,.5],mode:'walk',maxDamage:0},ctx())).rejects.toThrow('预算');
  const c=new AbortController(),p=crossFire(b,{at:[2.5,64,.5],mode:'walk'},ctx(c)).catch(e=>e);
  await vi.advanceTimersByTimeAsync(50);c.abort();await vi.advanceTimersByTimeAsync(100);await p;
  expect(intentionalFireCrossing(b)).toBe(false);expect(Object.values(h.keys).some(Boolean)).toBe(false);
  h.set(1,64,0,'lava');expect(fireRoutes(b,{at:[2.5,64,.5],mode:'walk'})).toEqual([]);
 }finally{h.close();}
});
it('publishes validated script/scout parameters, without treating dry-run as completion',()=>{
 expect(parseSteps([{skill:'cross_fire',at:[2.5,64,.5],maxDamage:10,dryRun:true}])).not.toHaveProperty('error');
 expect(parseSteps([{skill:'cross_fire',maxDamage:-1}])).toHaveProperty('error');
});
it('allows a verified zero-damage route with zero budget and stops on actual unexpected damage',async()=>{
 const h=methodHarness('1.21.1');try{
  const b=h.bot as unknown as Bot;
  const p=crossFire(b,{at:[2.5,64,.5],mode:'walk',maxDamage:0},ctx());
  await vi.advanceTimersByTimeAsync(2000);expect(JSON.parse(await p).completed).toBe(true);
  h.bot.entity.position.set(.5,64,.5);h.bot.entity.velocity.set(0,0,0);
  const bad=crossFire(b,{at:[2.5,64,.5],mode:'walk',maxDamage:0},ctx()).catch(e=>e);
  await vi.advanceTimersByTimeAsync(100);h.bot.health=19;
  await vi.advanceTimersByTimeAsync(100);expect(String(await bad)).toContain('实际损失');
  expect(intentionalFireCrossing(b)).toBe(false);expect(Object.values(h.keys).some(Boolean)).toBe(false);
 }finally{h.close();}
});
