import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { methodHarness } from './method-harness.ts';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';
import { installNavigationFallCosts, navigationFallBudget, setNavigationFallMode, hasApprovedNavigationDrop, approveNavigationDrop } from '../core/navigation-fall.ts';
import { checkGroundPath, groundPathIssueOf, installDoorWaypointRepair } from '../core/path-waypoints.ts';
import { parsePolicy, defaultPolicy } from '../core/policy.ts';
import type { TaskReport } from '../core/executor.ts';
import { Reflexes } from '../core/executor.ts';

const require = createRequire(import.meta.url);
const Move = createRequire(require.resolve('mineflayer-pathfinder/package.json'))('./lib/move.js');
afterEach(() => vi.useRealTimers());

function fixture(drop = 4) {
  const h = methodHarness('1.21.1'), bot = h.bot as unknown as Bot;
  Object.assign(h.bot, { supportFeature: (n: string) => h.bot.registry.supportFeature(n), getControlState: (k: string) => h.keys[k],
    isAlive: true, dig: vi.fn(() => { throw Error('unexpected digging'); }), placeBlock: vi.fn() });
  Object.assign(h.bot.game, { minY: -64, height: 384 });
  Object.assign(h.bot.world, { getBlockStateId: (p: Vec3) => h.bot.blockAt(p).stateId, getColumn: () => ({}) });
  for (let x = 1; x <= 15; x++) for (let z = -4; z <= 4; z++) for (let y = 64 - drop; y < 64; y++) h.set(x, y, z, 'air');
  pathfinder.pathfinder(bot); installPathfinderPerf();
  const m = new pathfinder.Movements(bot);
  m.canDig = false; m.scafoldingBlocks = []; m.allow1by1towers = false; m.allowParkour = false;
  installNavigationFallCosts(bot, m); bot.pathfinder.setMovements(m);
  bot.pathfinder.thinkTimeout = 1000; bot.pathfinder.tickTimeout = 20;
  return { ...h, bot, m };
}

it('uses health-aware budgets and offers a non-damaging policy without unknown-health optimism', () => {
  expect(navigationFallBudget({health:20})).toMatchObject({maxDropDown:21,damageBudget:18,reserveHealth:2});
  expect(navigationFallBudget({health:2}).damageBudget).toBe(0);
  expect(navigationFallBudget({health:NaN}).damageBudget).toBe(0);
  expect(navigationFallBudget({health:20},'safe').maxDropDown).toBe(3);
  expect(defaultPolicy().fall).toBe('survivable');
  expect(parsePolicy({fall:'safe'}).patch.fall).toBe('safe');
});

it('reproduces the old two-block limit and admits a four-block landing with damage cost', () => {
  const h = fixture();
  try {
    const legacy = new pathfinder.Movements(h.bot); legacy.maxDropDown = 2;
    expect((legacy as any).getLandingBlock(new Move(0,64,0,0,0),{x:1,z:0})).toBeNull();
    const moves = (h.m as any).getNeighbors(new Move(0,64,0,0,0));
    const drop = moves.find((m:any)=>m.x===1&&m.y===60&&m.z===0);
    expect(drop).toMatchObject({fallDamage:1}); expect(drop.cost).toBeGreaterThan(5);
    expect(checkGroundPath(h.bot,[{x:1.5,y:60,z:.5}])).toBeNull();
    h.bot.health=2;
    expect((h.m as any).getNeighbors(new Move(0,64,0,0,0)).some((m:any)=>m.y===60)).toBe(false);
    expect(checkGroundPath(h.bot,[{x:1.5,y:60,z:.5}])?.reason).toContain('超出预算');
  } finally {h.close();}
});

it('measures maxDropDown to feet, so a non-damaging three-block drop is available', () => {
  const h=fixture(3);
  try {
    setNavigationFallMode(h.bot,()=> 'safe');
    expect((h.m as any).getLandingBlock(new Move(0,64,0,0,0),{x:1,z:0})?.position.y).toBe(61);
  } finally {h.close();}
});

it('prefers a nearby staircase while allowing a direct descent over a much longer detour',()=>{
  for(const stairZ of [1,4]) {
    const h=fixture();
    try {
      for(let x=1;x<=3;x++)for(let y=60;y<64-x;y++)h.set(x,y,stairZ,'stone');
      const r=h.bot.pathfinder.getPathTo(h.m,new pathfinder.goals.GoalBlock(4,60,0),1000);
      expect(r.status).toBe('success');
      expect((r.path.at(-1) as any).fallDamage).toBe(stairZ===1?0:1);
    }finally{h.close();}
  }
});

it('routes around an uncertified five-block drop and reaches the same goal', async () => {
  vi.useFakeTimers();
  const h = fixture(5), reports: TaskReport[] = [];
  try {
    // The native search considers a stair block physical. Its upper collision
    // face does not supply the full landing footprint required for a fall.
    for (let z = -3; z <= 3; z++) h.set(1, 58, z, 'stone_stairs');
    const goal = new pathfinder.goals.GoalBlock(4, 59, 0);
    const result = h.bot.pathfinder.getPathTo(h.m, goal, 1000);
    expect(result.status).toBe('success');
    expect(checkGroundPath(h.bot, result.path)).toBeNull();
    expect(result.path.some(node => node.y === 59 && Math.abs(Math.floor(node.z)) >= 4)).toBe(true);
    expect(result.path.at(-1)).toMatchObject({ x: 4.5, y: 59, z: .5 });

    installDoorWaypointRepair(h.bot);
    Object.assign((h.exec as any).opts, { report: (r: TaskReport) => reports.push(r), fleeHealth: () => 0 });
    await vi.advanceTimersByTimeAsync(200);
    h.exec.submitDetailed([{ skill: 'goto', at: [4, 59, 0], exact: true }]);
    for (let tick = 0; tick < 600 && !reports.length; tick++) await vi.advanceTimersByTimeAsync(50);
    expect(reports[0]?.kind, JSON.stringify({ position: h.bot.entity.position, issue: groundPathIssueOf(h.bot) })).toBe('done');
    expect(h.bot.entity.position.floored()).toEqual(new Vec3(4, 59, 0));
    expect(h.bot.entity.onGround).toBe(true);
  } finally { h.close(); }
}, 15000);

it('honours received higher fall damage and a lower safe-fall distance',()=>{
  const h=fixture();
  try{
    h.bot.health=4;
    (h.bot.entity as any).attributes={'minecraft:generic.fall_damage_multiplier':{value:2,modifiers:[{operation:0,amount:1}]}};
    expect(navigationFallBudget(h.bot)).toMatchObject({damageMultiplier:3,damageBudget:2});
    expect((h.m as any).getNeighbors(new Move(0,64,0,0,0)).some((v:any)=>v.y===60)).toBe(false);
    (h.bot.entity as any).attributes={'minecraft:generic.safe_fall_distance':{value:1,modifiers:[]}};
    expect(navigationFallBudget(h.bot).maxDropDown).toBe(3);
  }finally{h.close();}
});

it('does not spend the same health twice across successive drops or collapse different budgets into one A* node', () => {
  const h=fixture();
  try {
    h.bot.health=4;
    const from=new Move(0,64,0,0,0); from.fallDamage=1;
    const to=(h.m as any).getNeighbors(from).find((m:any)=>m.x===1&&m.y===60&&m.z===0);
    expect(to.fallDamage).toBe(2); expect(to.hash).toContain('|fall:2');
    from.fallDamage=2;
    expect((h.m as any).getNeighbors(from).some((m:any)=>m.x===1&&m.y===60&&m.z===0)).toBe(false);
  } finally {h.close();}
});

it.each(['unknown','lava','magma_block','stone'])('does not turn %s at the landing into a valid drop', kind=>{
  const h=fixture();
  try {
    if(kind==='unknown') {const read=h.bot.blockAt.bind(h.bot);h.bot.blockAt=((p:Vec3)=>Math.floor(p.x)===1&&Math.floor(p.y)===60?null:read(p)) as typeof h.bot.blockAt;}
    else h.set(1,kind==='magma_block'?59:60,0,kind);
    expect(checkGroundPath(h.bot,[{x:1.5,y:60,z:.5}])).not.toBeNull();
  } finally {h.close();}
});

it.each([[4,3],[7,3],[7,1]])('actually descends %i blocks to x=%i with native pathfinder, physics and execution guard',async (drop,targetX)=>{
  vi.useFakeTimers(); const h=fixture(drop), reports:TaskReport[]=[], paths:unknown[]=[], stop=vi.fn(()=>null);
  try {
    installDoorWaypointRepair(h.bot);
    const reflex=new Reflexes({stopFallTask:stop,report:vi.fn()} as never);
    h.bot.on('physicsTick',()=> (reflex as any).watchFall(h.bot));
    h.bot.on('path_update',(p:any)=>paths.push({status:p.status,path:p.path?.map((v:any)=>({x:v.x,y:v.y,z:v.z}))}));
    h.bot.on('goal_reached',()=>paths.push({goalReached:true,pos:{...h.bot.entity.position},onGround:h.bot.entity.onGround}));
    h.bot.on('goal_updated',()=>paths.push({goalUpdated:true,pos:{...h.bot.entity.position},onGround:h.bot.entity.onGround}));
    Object.assign((h.exec as any).opts,{report:(r:TaskReport)=>reports.push(r),fleeHealth:()=>0});
    await vi.advanceTimersByTimeAsync(200);
    h.exec.submitDetailed([{skill:'goto',at:[targetX,64-drop,0],exact:true}]);
    for(let i=0;i<600&&!reports.length;i++) await vi.advanceTimersByTimeAsync(50);
    expect(reports[0]?.kind,JSON.stringify({paths,position:h.bot.entity.position,issue:groundPathIssueOf(h.bot)})).toBe('done');
    expect(h.bot.entity.position.y).toBeCloseTo(64-drop);
    expect(h.bot.entity.onGround).toBe(true);
    expect(h.bot.dig).not.toHaveBeenCalled(); expect(h.bot.placeBlock).not.toHaveBeenCalled();
    expect(stop,JSON.stringify(paths)).not.toHaveBeenCalled();
    h.bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(0,64,0));
    expect(hasApprovedNavigationDrop(h.bot)).toBe(false);
  } finally {h.close();}
},15000);

it('withdraws a previously planned drop when health is lost before departure',async()=>{
  vi.useFakeTimers();const h=fixture(),reports:TaskReport[]=[];
  try{
    installDoorWaypointRepair(h.bot);
    Object.assign((h.exec as any).opts,{report:(r:TaskReport)=>reports.push(r),fleeHealth:()=>0});
    h.bot.once('path_update',()=>{h.bot.health=2;});
    h.exec.submitDetailed([{skill:'goto',at:[3,60,0],exact:true}]);
    for(let i=0;i<100&&!reports.length;i++) await vi.advanceTimersByTimeAsync(50);
    expect(h.bot.pathfinder.goal).toBeNull();expect(groundPathIssueOf(h.bot)?.reason).toContain('预算');
    expect(h.bot.entity.position.y).toBeCloseTo(64);
  }finally{h.close();}
});

it('only grants a short arrival grace to the matching completed route, not cancellation or another goal',()=>{
  vi.useFakeTimers(); const h=fixture(7);
  try {
    installDoorWaypointRepair(h.bot);
    const start={x:.5,y:64,z:.5},end={x:1.5,y:57,z:.5};
    const begin=()=>{
      h.bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(1,57,0));
      approveNavigationDrop(h.bot,start,end);
      h.bot.entity.position=new Vec3(1.5,57.4,.5);h.bot.entity.onGround=false;
    };
    begin();h.bot.pathfinder.setGoal(null);
    expect(hasApprovedNavigationDrop(h.bot,64)).toBe(false);
    begin();h.bot.emit('goal_reached',h.bot.pathfinder.goal!);h.bot.pathfinder.setGoal(null);
    expect(hasApprovedNavigationDrop(h.bot,64)).toBe(true);
    vi.setSystemTime(Date.now()+1001);
    expect(hasApprovedNavigationDrop(h.bot,64)).toBe(false);
    begin();h.bot.emit('goal_reached',h.bot.pathfinder.goal!);
    h.bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(2,57,0));
    expect(hasApprovedNavigationDrop(h.bot,64)).toBe(false);
  }finally{h.close();}
});
