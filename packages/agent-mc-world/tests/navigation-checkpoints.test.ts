import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { afterEach, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { noteGoalOwner } from '../core/travel.ts';
import type { TaskReport } from '../core/executor.ts';
import { createMinecraftChoiceTool } from '../src/client/choice.ts';

const rigs: ReturnType<typeof rig>[] = [];
afterEach(() => { for (const r of rigs.splice(0)) r.close(); vi.useRealTimers(); });
function rig() {
  vi.useFakeTimers();
  const h=methodHarness('1.21.1'), bot=h.bot as unknown as Bot, reports:TaskReport[]=[];
  const stack={name:'beef',count:2,type:h.bot.registry.itemsByName.beef.id,slot:36};
  const slots=Array(46).fill(null);slots[36]=stack;
  Object.assign(h.bot,{supportFeature:(name:string)=>h.bot.registry.supportFeature(name),isAlive:true,
    // This is a path/physics fixture. Food is already in an actual hotbar
    // slot; inventory packet exchanges are covered by food-consumption-native.
    inventory:{slots,hotbarStart:36,inventoryStart:9,inventoryEnd:45,selectedItem:null,items:()=>stack.count?[stack]:[]},quickBarSlot:0,
    getEquipmentDestSlot:(dest:string)=>dest==='hand'?36:45,
    setQuickBarSlot:vi.fn((slot:number)=>{h.bot.heldItem=slots[36+slot];}),
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

function allyFor(h: ReturnType<typeof rig>, distance = 2) {
  const ally = {id:2,type:'player',username:'Ally',name:'player',isValid:true,
    position:h.bot.entity.position.offset(distance,0,0)};
  Object.assign(h.bot.entities,{2:ally});
  Object.assign(h.bot.players,{Ally:{entity:ally}});
  return ally;
}

it.each([2,32])('a persistent follow at distance %s yields for a meal and resumes the same task',async distance=>{
  const h=rig();rigs.push(h);const ally=allyFor(h,distance);
  h.exec.submit([{skill:'follow',name:'Ally'}],'append');
  await vi.advanceTimersByTimeAsync(800);
  const original=h.exec.status().running!.id;
  h.exec.submit([{skill:'eat',item:'beef'}],'afterCheckpoint');
  await vi.advanceTimersByTimeAsync(2000);
  expect((h.bot as any).consume,JSON.stringify(h.reports)).toHaveBeenCalledTimes(1);
  expect(h.reports.filter(r=>r.kind==='suspended'&&r.taskId===original)).toHaveLength(1);
  expect(h.exec.status().running).toMatchObject({id:original,skill:'follow',followTarget:'Ally'});
  expect(h.reports.filter(r=>r.kind==='done'&&r.taskId===original)).toHaveLength(0);
  const resumedAt=h.bot.entity.position.x;
  ally.position=ally.position.offset(12,0,0);
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.bot.entity.position.x).toBeGreaterThan(resumedAt+1);
});

it.each(['combat','environment','airborne','window','foreign-goal'] as const)('a follow does not yield through an unsafe %s checkpoint',async state=>{
  const h=rig();rigs.push(h);allyFor(h);
  h.exec.submit([{skill:'follow',name:'Ally'}],'append');await vi.advanceTimersByTimeAsync(800);
  const original=h.exec.status().running!.id,goal=h.bot.pathfinder.goal;
  if(state==='combat')h.internals.opts.bodyState=()=>({combatActive:true});
  if(state==='environment')h.internals.opts.bodyState=()=>({environmentOwnerKind:'drown'});
  if(state==='airborne'){h.bot.physicsEnabled=false;h.bot.entity.onGround=false;}
  if(state==='window')h.bot.currentWindow={} as never;
  if(state==='foreign-goal')noteGoalOwner(h.bot,goal!,'combat','other body owner');
  h.exec.submit([{skill:'eat',item:'beef'}],'afterCheckpoint');await vi.advanceTimersByTimeAsync(1500);
  expect((h.bot as any).consume).not.toHaveBeenCalled();
  expect(h.exec.status().running?.id).toBe(original);expect(h.bot.pathfinder.goal).toBe(goal);
  h.internals.opts.bodyState=undefined;h.bot.currentWindow=null;h.bot.physicsEnabled=true;h.bot.entity.onGround=true;
  if(state==='foreign-goal')noteGoalOwner(h.bot,goal!,'task','follow owns movement again');
  await vi.advanceTimersByTimeAsync(2000);
  expect((h.bot as any).consume).toHaveBeenCalledTimes(1);
  expect(h.exec.status().running?.id).toBe(original);
});

it('a checkpoint resumes follow from a newly resolved target, and does not resurrect a missing target',async()=>{
  const h=rig();rigs.push(h);const ally=allyFor(h);
  h.exec.submit([{skill:'follow',name:'Ally'}],'append');await vi.advanceTimersByTimeAsync(800);
  const original=h.exec.status().running!.id;
  (h.bot as any).consume.mockImplementation(async()=>{
    ally.isValid=false;delete (h.bot.entities as any)[2];delete (h.bot.players as any).Ally;
    h.stack.count--;h.bot.food+=3;
  });
  h.exec.submit([{skill:'eat',item:'beef'}],'afterCheckpoint');await vi.advanceTimersByTimeAsync(2000);
  expect((h.bot as any).consume).toHaveBeenCalledTimes(1);
  expect(h.reports.some(r=>r.kind==='blocked'&&r.taskId===original)).toBe(true);
  expect(h.exec.status().running).toBeNull();expect(h.bot.pathfinder.goal).toBeNull();
});

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

it.each(['villager','zombie'])('keeps bounded advice past a static visible %s through live requestFacts movement',async name=>{
  const h=rig();rigs.push(h);h.bot.food=20;
  Object.assign((h.world as any).bridge,{connectionState:{ready:true,phase:'online'}});
  h.exec.submit([{skill:'goto',at:[128,64,0],walkOnly:true}],'append');
  await vi.advanceTimersByTimeAsync(800);
  const here=h.bot.entity.position.clone();
  Object.assign(h.bot.entities,{55:{id:55,name,type:'mob',isValid:true,height:1.8,health:20,position:here.offset(12,0,0),metadata:[]}});
  (h.world as any).journeyTick(h.bot,[{kind:'sign',key:'sign:1',label:'oak_sign',position:[here.x+4,64,here.z],source:'visible-block',observedAtMs:Date.now()}]);
  const before=h.world.requestFacts()!;
  expect(before.decisionStability!.route!.entities).toMatchObject([{id:55,name,visible:true}]);
  const request=vi.fn(async()=>{
    await vi.advanceTimersByTimeAsync(500);
    return {answers:{action:{choice:'continue',confidence:.9,probabilities:{continue:.9,inspect:.08,_inspect:.02}}}};
  });
  Object.assign(h.host,{decisions:{request}});
  const tool=createMinecraftChoiceTool(()=>h.host,()=>h.world.requestFacts());
  const raw=await tool.handler({category:'route',goal:'继续原旅程，可考虑已见告示牌',candidates:[
    {id:'continue',label:'继续',evidence:'当前goto在推进',ready:true},
    {id:'inspect',label:'读牌',evidence:'刚看见告示牌',ready:true},
  ]},{role:'test',log:h.host.log});
  const result=JSON.parse(typeof raw==='string'?raw:raw.text);
  expect(h.bot.entity.position.distanceTo(here)).toBeGreaterThan(1);
  expect(h.world.requestFacts()!.parts!.find(part=>part.key==='queue')!.text).not.toBe(before.parts!.find(part=>part.key==='queue')!.text);
  expect(h.world.requestFacts()!.parts!.find(part=>part.key==='life')!.text).not.toBe(before.parts!.find(part=>part.key==='life')!.text);
  expect(result.status).toBe('advice');expect(result.execution).toContain('未执行');
  if(name==='zombie')expect(result.routeTolerance.horizontalBlocks).toBe(5);
  else expect(result.routeTolerance.horizontalBlocks).toBeGreaterThan(10);
  expect(h.exec.status().waiting).toHaveLength(0);
  expect(request.mock.calls[0][0].state.observed.facts.find((part:any)=>part.key==='journey')).toBeTruthy();
  (h.world as any).hookBotEvents(h.bot);
  const epoch=h.world.requestFacts()!.decisionStability!.route!.positionEpoch;
  h.bot.emit('forcedMove');
  expect(h.world.requestFacts()!.decisionStability!.route!.positionEpoch).toBe(epoch+1);
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

it('a journey encounter wakes the host without stopping travel; an explicitly chosen detour resumes the same destination',async()=>{
  const h=rig();rigs.push(h);h.bot.food=20;
  h.exec.submit([{skill:'goto',at:[128,64,0],walkOnly:true}],'append');
  await vi.advanceTimersByTimeAsync(800);
  const original=h.exec.status().running!.id;
  expect(h.exec.status().running!.travel).toEqual({destination:[128,64,0],dimension:'minecraft:overworld'});
  const here=h.bot.entity.position;
  (h.world as any).journeyTick(h.bot,[{kind:'npc',key:'entity:7',label:'villager',position:[here.x+4,64,here.z],source:'visible-entity',observedAtMs:Date.now()}]);
  const event=h.host.events.find(e=>e.meta?.journey);
  expect(event?.text).toContain('128,64,0');
  expect(h.host.pushOpts[h.host.events.indexOf(event!)]?.trigger).toBe('debounce');
  const fresh=h.world.requestFacts()!;
  expect(fresh.parts?.find(part=>part.key==='journey')?.text).toContain((event!.meta!.journey as any).id);
  expect(fresh.decisionStability?.route).toMatchObject({task:{id:original,destination:[128,64,0]},journeyId:(event!.meta!.journey as any).id});
  expect(h.bot.pathfinder.isMoving()).toBe(true);
  expect(h.exec.status().running?.id).toBe(original);
  // This is the host/agent's explicit choice; the observer itself never creates this task.
  h.exec.submit([{skill:'goto',at:[8,64,4],walkOnly:true},{skill:'chat',text:'detour inspected'}],'afterCheckpoint');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.said).toEqual(['detour inspected']);
  expect(h.exec.status().running).toMatchObject({id:original,travel:{destination:[128,64,0]}});
  await vi.advanceTimersByTimeAsync(40_000);
  expect(h.reports.filter(r=>r.kind==='done'&&r.taskId===original)).toHaveLength(1);
  expect(h.bot.entity.position.x).toBeGreaterThan(126);
});

it('does not bind an earlier opportunity to a replacement task and marks aged cues as history',async()=>{
  const h=rig();rigs.push(h);h.bot.food=20;
  h.exec.submit([{skill:'goto',at:[128,64,0],walkOnly:true}],'append');await vi.advanceTimersByTimeAsync(800);
  const here=h.bot.entity.position;
  (h.world as any).journeyTick(h.bot,[{kind:'sign',key:'sign:old',label:'oak_sign',position:[here.x+4,64,here.z],source:'visible-block',observedAtMs:Date.now()}]);
  expect(h.world.requestFacts()!.parts?.find(p=>p.key==='journey')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(11_000);
  expect(h.world.requestFacts()!.parts?.find(p=>p.key==='journey')?.text).toContain('历史旅途线索');
  h.exec.submit([{skill:'goto',at:[256,64,0],walkOnly:true}],'now');await vi.advanceTimersByTimeAsync(100);
  expect(h.world.requestFacts()!.parts?.find(p=>p.key==='journey')).toBeUndefined();
  expect(h.world.requestFacts()!.decisionStability?.route?.journeyId).toBeNull();
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
