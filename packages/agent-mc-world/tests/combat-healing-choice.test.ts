import { expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { TacticalMinecraftWorld } from '../core/tactical-world.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { COMBAT_EXECUTION_DEFAULTS } from '../core/combat-decision-types.ts';
import type { CombatCandidate } from '../core/combat-decision-types.ts';
import { combatRequest } from '../src/decisions/combat-request.ts';

class HealingWorld extends TacticalMinecraftWorld {
  protected override combatHealingUrgent() { return true; }
  protected override combatDecisionConfig() { return {...COMBAT_EXECUTION_DEFAULTS,allowEngage:true,allowMovement:true,engageScope:'hostile' as const}; }
  sample() { return this.sampleCombatDecision(); }
  choose(candidate:CombatCandidate,revision:number) { return this.applyCombatDecision(candidate,revision); }
}
function rig(health=34) {
  const world=new HealingWorld({cfg:structuredClone(MINECRAFT_DEFAULTS)});
  const sword={name:'iron_sword',count:1};
  const bot={health,food:17,entity:{id:1,position:new Vec3(0,64,0),yaw:Math.PI/2,onGround:true},heldItem:sword,inventory:{items:()=>[sword]},
    entities:{7:{id:7,name:'witch',position:new Vec3(4,64,0)}},game:{dimension:'overworld'}};
  const field={sampledAtMs:Date.now(),connectionGeneration:1,dimension:'overworld',
    self:{entityId:1,position:[0,64,0],food:17,scoreboardTeam:null,health:{current:health,max:55,source:'native',updatedAtMs:Date.now()}},
    actors:[{entityId:7,uuid:'witch-7',type:'witch',name:null,relation:'hostile',relationSource:'hostile-type',scoreboardTeam:null,
      position:[4,64,0],distance:4,lineOfSight:true,targetEntityId:null,health:{current:12,max:60,source:'native',updatedAtMs:Date.now()}}],
    server:null,omitted:0};
  const retreating={value:false},escaping={value:false};
  Object.assign(world,{bridge:{bot,connected:true},bodyInhibitReason:null,escapeHoldUntil:0,
    executor:{status:()=>({running:null,waiting:[],hold:null}),get escaping(){return escaping.value;},eating:false,attacking:false},
    combat:{active:false,fighting:false,tracking:false,reactionState:()=>({targetId:null,canStep:false,sinceHitMs:null,retreating:retreating.value}),
      engagementTargets:()=>health>=13?[7]:[],trackingTargets:()=>[],canRetreat:()=>true},
    battlefield:{sample:(_bot:unknown,_generation:unknown,action:unknown)=>({...field,action})},
  });
  return {world,retreating,escaping,bot,field};
}

it('keeps target/withdraw choices under a high healing threshold instead of turning healing desire into a body lock',()=>{
  const {world}=rig();const frame=world.sample()!;
  expect(frame.battlefield.action.emergency).toBe(false);
  expect(frame.survival).toEqual({fleeAtOrBelow:10,healingDesired:true});
  expect(frame.candidates).toEqual(expect.arrayContaining([expect.objectContaining({kind:'retreat'}),expect.objectContaining({kind:'engage',targetId:7})]));
  expect(combatRequest(frame).state.survival).toEqual(frame.survival);
});
it('keeps withdrawal available below the engagement health line without permitting unsafe new attacks',()=>{
  const {world}=rig(6);const frame=world.sample()!;
  expect(frame.battlefield.action.emergency).toBe(false);
  expect(frame.candidates.some(c=>c.kind==='retreat')).toBe(true);
  expect(frame.candidates.some(c=>c.kind==='engage')).toBe(false);
});
it('still yields when an actual survival controller holds the body',()=>{
  const {world,retreating}=rig();retreating.value=true;
  expect(world.sample()!.battlefield.action.emergency).toBe(true);
  expect(world.sample()!.candidates).toHaveLength(0);
});
it('routes a selected search through the existing body task queue with a relative turn and no attack',()=>{
  const {world,field}=rig();
  field.actors=[];
  const submit=vi.fn(()=>({accepted:true,taskId:42}));
  Object.assign(world,{bridge:{connected:true,bot:{health:34,food:17,entity:{id:1,position:new Vec3(0,64,0),yaw:Math.PI/2,onGround:true},
    inventory:{items:()=>[{name:'iron_sword',count:1}]},entities:{},
    blockAt:(p:Vec3)=>({name:p.y<64?'stone':'air',boundingBox:p.y<64?'block':'empty',shapes:p.y<64?[[0,0,0,1,1,1]]:[],getProperties:()=>({})})}},
    battlefield:{sample:(_b:unknown,_g:unknown,action:unknown)=>({...field,action,clues:[{source:'sound-packet',kind:'怪物声',direction:'东',distance:'中距离',heardAt:field.sampledAtMs-1,expiresAt:field.sampledAtMs+8000,origin:[0,64,0]}]})},
    executor:{status:()=>({running:null,waiting:[],hold:null}),submitDetailed:submit,attacking:false,eating:false,escaping:false}});
  const frame=world.sample()!,choice=frame.candidates.find(c=>c.kind==='search')!;
  expect(choice).toBeTruthy();expect(world.choose(choice,frame.tacticRevision)).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
  const [steps,mode]=submit.mock.calls[0] as unknown as [Array<{skill:string;keys:string[];mode:string;durationMs:number;yawDeg:number}>,string];
  expect(mode).toBe('append');expect(steps).toHaveLength(1);
  expect(steps[0]).toMatchObject({skill:'control',keys:['forward'],mode:'ground',durationMs:250});
  expect(Math.abs(steps[0].yawDeg)).toBeCloseTo(180);
});
