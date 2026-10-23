import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { afterEach, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { noteGoalOwner } from '../core/travel.ts';
import type { TaskReport } from '../core/executor.ts';

const rigs: ReturnType<typeof rig>[] = [];
afterEach(() => { for (const r of rigs.splice(0)) r.close(); vi.useRealTimers(); });
function rig() {
  vi.useFakeTimers();
  const h=methodHarness('1.21.1'), bot=h.bot as unknown as Bot, reports:TaskReport[]=[];
  const stack={name:'beef',count:2,type:h.bot.registry.itemsByName.beef.id};
  Object.assign(h.bot,{supportFeature:(name:string)=>h.bot.registry.supportFeature(name),isAlive:true,
    inventory:{slots:Array(46).fill(null),selectedItem:null,items:()=>stack.count?[stack]:[]},
    equip:vi.fn(async()=>{h.bot.heldItem=stack as never;}),
    consume:vi.fn(async()=>{stack.count--;h.bot.food+=3;}),food:0});
  Object.assign(h.bot.game,{minY:-64,height:384});
  Object.assign(h.bot.world,{getBlockStateId:(at:any)=>h.bot.blockAt(at).stateId,getColumn:()=>({})});
  pathfinder.pathfinder(bot);
  bot.pathfinder.movements.canDig=false;bot.pathfinder.movements.allowParkour=false;
  bot.pathfinder.movements.allow1by1towers=false;bot.pathfinder.movements.scafoldingBlocks=[];
  bot.pathfinder.thinkTimeout=100;bot.pathfinder.tickTimeout=5;
  const internals=h.exec as any;
  internals.opts.report=(r:TaskReport)=>reports.push(r);internals.opts.fleeHealth=()=>0;
  (h.world as any).diag={write:vi.fn()};
  return {...h,bot,stack,reports,internals};
}

it('a long running goto yields to one real meal before arrival, then resumes its original task id',async()=>{
  const h=rig();rigs.push(h);
  h.exec.submit([{skill:'goto',at:[64,64,0],walkOnly:true}],'append');
  await vi.advanceTimersByTimeAsync(1000);
  const original=h.exec.status().running!.id;
  expect(h.bot.pathfinder.isMoving()).toBe(true);
  (h.world as any).autoEatTick(h.bot);(h.world as any).autoEatTick(h.bot);
  await vi.advanceTimersByTimeAsync(2000);
  expect((h.bot as any).consume).toHaveBeenCalledTimes(1);
  expect(h.bot.food).toBe(3);expect(h.stack.count).toBe(1);
  expect(h.reports.some(r=>r.kind==='suspended'&&r.taskId===original)).toBe(true);
  expect(h.exec.status().running?.id).toBe(original);
  expect(h.bot.entity.position.x).toBeLessThan(63);
  await vi.advanceTimersByTimeAsync(20000);
  expect(h.reports.some(r=>r.kind==='done'&&r.taskId===original)).toBe(true);
  expect(h.bot.entity.position.x).toBeGreaterThan(62);
  expect(h.reports.filter(r=>r.kind==='done'&&r.taskId===original)).toHaveLength(1);
});

it('waits for the old path cleanup before consuming or resuming another path',async()=>{
  const h=rig();rigs.push(h);
  const native=h.bot.pathfinder.goto.bind(h.bot.pathfinder);let cleaned=0;
  h.bot.pathfinder.goto=async goal=>{
    try{await native(goal);}catch(error){
      await new Promise(resolve=>setTimeout(resolve,600));
      h.bot.clearControlStates();cleaned++;throw error;
    }
  };
  h.exec.submit([{skill:'goto',at:[64,64,0],walkOnly:true}],'append');
  await vi.advanceTimersByTimeAsync(800);
  const original=h.exec.status().running!.id;
  h.exec.submit([{skill:'eat',item:'beef'}],'afterCheckpoint');
  await vi.advanceTimersByTimeAsync(500);
  expect((h.bot as any).consume).not.toHaveBeenCalled();expect(cleaned).toBe(0);
  await vi.advanceTimersByTimeAsync(1500);
  expect(cleaned).toBe(1);expect((h.bot as any).consume).toHaveBeenCalledTimes(1);
  expect(h.exec.status().running?.id).toBe(original);
  const resumedAt=h.bot.entity.position.x;
  await vi.advanceTimersByTimeAsync(700);
  expect(h.bot.entity.position.x).toBeGreaterThan(resumedAt+1);
});

it.each(['combat','environment','airborne','window','foreign-goal'] as const)('does not stop navigation through an unsafe %s handoff',async state=>{
  const h=rig();rigs.push(h);
  h.exec.submit([{skill:'goto',at:[64,64,0],walkOnly:true}],'append');
  await vi.advanceTimersByTimeAsync(800);
  const original=h.exec.status().running!.id, goal=h.bot.pathfinder.goal;
  if(state==='combat')h.internals.opts.bodyState=()=>({combatActive:true});
  if(state==='environment')h.internals.opts.bodyState=()=>({environmentOwnerKind:'drown'});
  if(state==='airborne'){h.bot.physicsEnabled=false;h.bot.entity.onGround=false;}
  if(state==='window')h.bot.currentWindow={} as never;
  if(state==='foreign-goal')noteGoalOwner(h.bot,goal!,'combat','other body owner');
  h.exec.submit([{skill:'eat',item:'beef'}],'afterCheckpoint');
  await vi.advanceTimersByTimeAsync(1500);
  expect((h.bot as any).consume).not.toHaveBeenCalled();
  expect(h.exec.status().running?.id).toBe(original);
  expect(h.bot.pathfinder.goal).toBe(goal);
  h.internals.opts.bodyState=undefined;h.bot.currentWindow=null;h.bot.physicsEnabled=true;h.bot.entity.onGround=true;
  if(state==='foreign-goal')noteGoalOwner(h.bot,goal!,'task','resume original movement');
  await vi.advanceTimersByTimeAsync(2000);
  expect((h.bot as any).consume).toHaveBeenCalledTimes(1);
  expect(h.exec.status().running?.id).toBe(original);
});
