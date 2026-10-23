import { expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { TacticalMinecraftWorld } from '../core/tactical-world.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { CombatSession } from '../core/combat.ts';
import { Executor } from '../core/executor.ts';
import { methodHarness } from './method-harness.ts';
import type { CombatCandidate } from '../core/combat-decision-types.ts';

class ProactiveWorld extends TacticalMinecraftWorld {
  frame() { return this.sampleCombatDecision(); }
  choose(candidate: CombatCandidate, revision: number) { return this.applyCombatDecision(candidate, revision); }
}

it.each(['1.21.1','1.20.6'])('pauses and restores real travel work for a pre-injury combat choice (%s)', async version => {
  const cfg = structuredClone(MINECRAFT_DEFAULTS);
  cfg.combatOptions = { allowEngage:true, allowMovement:true, engageScope:'hostile' };
  const world = new ProactiveWorld({ cfg }), r = methodHarness(version, () => world);
  const bot = r.bot as unknown as Bot, arrivals: Array<() => void> = [], attacks: number[] = [];
  Object.assign(bot, { equip:async()=>{}, lookAt:async()=>{}, attack:(e:{id:number})=>attacks.push(e.id),
    heldItem:{name:'iron_sword'}, inventory:{slots:[],items:()=>[{name:'iron_sword',type:1,count:1}]} });
  Object.assign(bot.pathfinder, { movements:{canDig:true,scafoldingBlocks:[]},
    goto:async()=>new Promise<void>(resolve=>arrivals.push(resolve)) });
  const enemy = {id:7,name:'zombie',type:'mob',isValid:true,uuid:'00000000-0000-0000-0000-000000000007',
    position:new Vec3(.5,64,-7.2),height:1.95,width:.6,velocity:new Vec3(0,0,0),metadata:[]};
  bot.entities[7] = enemy as never;
  Object.assign(bot.world,{raycast:()=>null}); // This fixture's sight ray is entirely in air above its flat floor.
  let nextId = 0;
  const session = new CombatSession({ getBot:()=>bot, tuning:()=>({...cfg.combat,fight:'auto',fleeHealth:cfg.reflex.fleeHealth}),
    envBusy:()=>false, taskEscaping:()=>exec.escaping, taskFighting:()=>exec.attacking,
    suspendTasks:reason=>exec.suspend(reason), resumeTasks:()=>exec.resume(), emit:()=>{}, log:r.host.log });
  const exec = new Executor({getBot:()=>bot,report:()=>{},log:r.host.log,nextId:()=>++nextId,
    busyWith:()=>session.active?'combat':null});
  Object.assign(world,{combat:session,executor:exec});
  try {
    exec.submit([{skill:'goto',at:[20,64,0]},{skill:'chat',text:'travel complete'}]);
    await vi.waitFor(()=>expect(arrivals).toHaveLength(1));
    expect(exec.status().running).toMatchObject({skill:'goto',resumable:true});
    const frame = world.frame()!;
    expect(frame.battlefield.action.fighting).toBe(false);
    expect(frame.candidates.some(c=>c.kind==='track')).toBe(false);
    const engage = frame.candidates.find(c=>c.kind==='engage');
    expect(engage).toMatchObject({kind:'engage',targetId:7});
    expect(world.choose(engage!,frame.tacticRevision)).toBe(true);
    expect(session.fighting).toBe(true);
    expect(bot.health).toBe(20);
    // Let the cancelled navigation promise settle; the real executor retains its checkpoint.
    arrivals[0]();
    await vi.waitFor(()=>expect(exec.status().running).toBeNull());
    delete bot.entities[7];
    await vi.waitFor(()=>expect(session.active).toBe(false),{timeout:4500});
    await vi.waitFor(()=>expect(arrivals).toHaveLength(2));
    expect(exec.status().running).toMatchObject({id:1,skill:'goto',stepIndex:0,resumable:true});
    bot.entity.position = new Vec3(20.5,64,.5); arrivals[1]();
    await vi.waitFor(()=>expect(r.said).toEqual(['travel complete']));
    expect(bot.health).toBe(20);
  } finally { session.stop(); exec.shutdown(); for(const arrive of arrivals)arrive(); r.close(); }
}, 10_000);
