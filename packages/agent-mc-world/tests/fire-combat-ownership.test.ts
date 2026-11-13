import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Reflexes } from '../core/executor.ts';
import { methodHarness } from './method-harness.ts';
import { localHazardExit } from '../core/hazard-exit.ts';
import { findEscapeCell, hazardsWithin, hazardTouch } from '../core/terrain.ts';
import { crossFire, intentionalFireCrossing, fireRoutes, fireRouteGeometryCurrent } from '../core/fire-route.ts';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T16:52:12Z')); });
afterEach(() => vi.useRealTimers());

it('retains a simulated fire route across fire age changes, but rejects changed support or new fire',()=>{
  const r=rig();try{
    r.set(0,64,0,'fire');const plan=fireRoutes(r.bot as unknown as Bot)[0];expect(plan).toBeDefined();
    const read=r.bot.blockAt;
    r.bot.blockAt=(p:Vec3)=>{const b=read(p);if(b.name==='fire')b.stateId=b.stateId===r.bot.registry.blocksByName.fire.minStateId?b.stateId+1:b.stateId-1;return b;};
    expect(fireRouteGeometryCurrent(r.bot as unknown as Bot,plan)).toBe(true);
    const footing=plan.geometry.find(([,y])=>y===63)!;r.set(footing[0],footing[1],footing[2],'air');
    expect(fireRouteGeometryCurrent(r.bot as unknown as Bot,plan)).toBe(false);
  }finally{r.close();}
});

function rig(fightBack = () => true, combatHurt = vi.fn(() => true)) {
  const h = methodHarness('1.21.1');
  Object.assign(h.bot, { isAlive: true, physicsEnabled: false, lookAt: vi.fn(async () => {}) });
  Object.assign(h.bot.entity, { metadata: [1] });
  Object.assign(h.bot.world, { getColumn: () => ({}) });
  const pause = vi.fn((why: string) => h.exec.pauseForEnvironment(why));
  const reports: string[] = [];
  const reflex = new Reflexes({ getBot: () => h.bot as unknown as Bot, report: r => reports.push(r.text), log: h.host.log,
    preempt: why => h.exec.preempt(why), pauseEnvironment: pause,
    resumeEnvironment: token => h.exec.resumeAfterEnvironment(token), stopFallTask: why => h.exec.stopCurrent(why),
    resumeAfterFall: token => h.exec.resumeQueue(token), escapeActive: () => false,
    fightBack, combatHurt, fleeHealth: () => 6, reactCooldownSec: () => 10,
    antiDrown: () => false, antiLava: () => true,
  });
  reflex.start();
  return { ...h, reflex, pause, reports, combatHurt, close() { reflex.stop(); h.close(); } };
}

it('honors live retaliation choice while retaining low-health escape', async () => {
  let enabled = false;
  const r = rig(() => enabled);
  try {
    const enemy = { id: 7, name: 'blaze', isValid: true, position: new Vec3(3, 64, .5), height: 1.8 };
    (r.bot.entities as any)[7] = enemy;
    const evidence = { origin: 'packet', sequence: 1, actor: { id: 7, name: 'blaze', entity: enemy },
      sourceType: 'fireball', causeId: 7, directId: 8, projectile: true, sourcePosition: enemy.position };
    await (r.reflex as any).onHurt(r.bot, evidence);
    expect(r.combatHurt).not.toHaveBeenCalled();
    expect(r.bot.pathfinder.goal).toBeNull();
    enabled = true;
    await (r.reflex as any).onHurt(r.bot, evidence);
    expect(r.combatHurt).toHaveBeenCalledTimes(1);
    enabled = false; r.bot.health = 3;
    await (r.reflex as any).onHurt(r.bot, evidence);
    expect(r.combatHurt).toHaveBeenCalledTimes(1);
    expect(r.bot.pathfinder.goal).not.toBeNull();
  } finally { r.close(); }
});

it.each(['fire', 'lava', 'soul_fire'])('a burning body near %s does not cancel combat or eating without actual contact', async name => {
  const r = rig();
  try {
    r.set(2, 64, 0, name); // Within the old 3-block radius, outside the body.
    await vi.advanceTimersByTimeAsync(1500);
    expect(r.pause).not.toHaveBeenCalled();
    expect(r.reflex.envActive).toBe(false);
    expect(r.bot.pathfinder.goal).toBeNull();
    expect(r.keys.forward).toBe(false);
  } finally { r.close(); }
});

it.each(['fire', 'lava'])('still rescues real %s contact, then releases even with a nearby hazard and residual burning', async name => {
  const r = rig();
  try {
    r.set(0, 64, 0, name);
    r.set(2, 64, 0, name);
    await vi.advanceTimersByTimeAsync(200);
    expect(r.reflex.envActive).toBe(true);
    expect(r.pause).toHaveBeenCalledTimes(1);
    r.set(0, 64, 0, 'air');
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.reflex.envActive).toBe(false);
    expect(r.keys.forward).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.pause).toHaveBeenCalledTimes(1);
  } finally { r.close(); }
});

it('leaves dense fire through the open side instead of running into the wall (native physics)', async () => {
  const r=rig();
  try{
    r.set(0,64,0,'fire');
    for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)if(Math.abs(x)===3||Math.abs(z)===3)r.set(x,64,z,'fire');
    r.set(-1,64,0,'nether_bricks');r.set(-1,65,0,'nether_bricks');
    expect(findEscapeCell(r.bot,hazardsWithin(r.bot,7),4)).toBeNull();
    const exit=localHazardExit(r.bot as unknown as Bot);
    expect(exit).not.toBeNull();expect(exit?.x).not.toBe(-1);
    r.bot.lookAt=async(target:Vec3)=>{const p=r.bot.entity.position;r.bot.entity.yaw=Math.atan2(-(target.x-p.x),-(target.z-p.z));};
    r.bot.physicsEnabled=true;
    await vi.advanceTimersByTimeAsync(1800);
    expect(hazardTouch(r.bot).touching).toBeNull();
    expect(r.reflex.envActive).toBe(false);
    expect(r.bot.entity.position.distanceTo(new Vec3(.5,64,.5))).toBeGreaterThan(.7);
  }finally{r.close();}
});

it('blocked fire recovery never takes a no-op body lease, and can use a newly opened exit',async()=>{
  const r=rig();try{
    r.set(0,64,0,'fire');
    for(const [x,z] of [[-1,0],[1,0],[0,-1],[0,1]]){r.set(x,64,z,'nether_bricks');r.set(x,65,z,'nether_bricks');}
    await vi.advanceTimersByTimeAsync(6200);
    expect(r.reflex.envActive).toBe(false);expect(r.keys.forward).toBe(false);
    expect(r.bot.pathfinder.goal).toBeNull();expect(r.pause).not.toHaveBeenCalled();
    expect(r.reports.filter(t=>t.includes('[反射受阻]'))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);expect(r.pause).not.toHaveBeenCalled();
    r.set(1,64,0,'air');r.set(1,65,0,'air');
    await vi.advanceTimersByTimeAsync(200);expect(r.reflex.envActive).toBe(true);expect(r.pause).toHaveBeenCalledTimes(1);
  }finally{r.close();}
});

it('does not cancel combat during an airborne fire contact without an executable escape',async()=>{
  const r=rig();try{
    r.set(0,64,0,'fire');r.bot.entity.onGround=false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.pause).not.toHaveBeenCalled();expect(r.reflex.envActive).toBe(false);
    r.bot.entity.onGround=true;
    await vi.advanceTimersByTimeAsync(200);expect(r.pause).toHaveBeenCalledTimes(1);
  }finally{r.close();}
});

it('does not call a gap, unobserved block or a thin collision shape a fire exit',()=>{
  const r=rig();try{
    r.set(0,64,0,'fire');
    for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++)if(x||z)r.set(x,63,z,'air');
    expect(localHazardExit(r.bot as unknown as Bot)).toBeNull();
    r.set(1,63,0,'stone');r.set(1,64,0,'oak_fence');
    expect(localHazardExit(r.bot as unknown as Bot)).toBeNull();
  }finally{r.close();}
});
it('does not fight an explicitly budgeted crossing for body control, then restores fire rescue',async()=>{
  const r=rig();try{
    r.bot.physicsEnabled=true;r.set(1,64,0,'fire');
    const p=crossFire(r.bot as unknown as Bot,{at:[2.5,64,.5],mode:'walk',maxDamage:12},
      {aborted:()=>false,taskId:97,log:r.host.log} as any);
    await vi.advanceTimersByTimeAsync(50);expect(intentionalFireCrossing(r.bot as unknown as Bot)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);expect(JSON.parse(await p).completed).toBe(true);
    expect(r.pause).not.toHaveBeenCalled();expect(r.reflex.envActive).toBe(false);
    r.bot.physicsEnabled=false;const at=r.bot.entity.position.floored();r.set(at.x,at.y,at.z,'fire');
    await vi.advanceTimersByTimeAsync(200);expect(r.reflex.envActive).toBe(true);
  }finally{r.close();}
});
