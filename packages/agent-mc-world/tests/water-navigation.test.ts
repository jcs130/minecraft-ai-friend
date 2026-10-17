import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';
import { installPartialBlockStartRepair } from '../core/pathfinder-start.ts';
import { installDoorWaypointRepair } from '../core/path-waypoints.ts';
import { goals, installTreadWater, writeStallProbe } from '../core/travel.ts';
import { repairWaterWaypoints } from '../core/water-navigation.ts';
import { methodHarness } from './method-harness.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const fixtures: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const h of fixtures.splice(0)) h.close(); });

/** The same 1.21.1 registry, pinned pathfinder and collision physics as the client. */
function pool(plant: 'water' | 'kelp' | 'tall_seagrass') {
  const h = methodHarness('1.21.1'); fixtures.push(h);
  for (let x = -2; x <= 2; x++) for (let z = -7; z <= 2; z++) {
    h.set(x, 64, z, plant === 'water' ? 'water' : plant === 'kelp' ? 'kelp_plant' : 'tall_seagrass');
    h.set(x, 65, z, plant);
  }
  for (let x = -3; x <= 3; x++) for (let z = -8; z <= 3; z++) {
    if (Math.abs(x) !== 3 && z !== -8 && z !== 3) continue;
    for (let y = 64; y <= 67; y++) h.set(x, y, z, 'stone');
  }
  Object.assign(h.bot, { supportFeature: (name: string) => h.bot.registry.supportFeature(name),
    getControlState: (key: string) => h.keys[key], isAlive: true });
  Object.assign(h.bot.game, { minY: -64, height: 384 });
  Object.assign(h.bot.world, { getBlockStateId: (at: Vec3) => h.bot.blockAt(at).stateId,
    getColumn: () => ({}) });
  h.bot.entity.position = new Vec3(.5, 65.3, .5); h.bot.entity.onGround = false;
  const bot = h.bot as unknown as Bot;
  pathfinderPkg.pathfinder(bot); installPathfinderPerf(); installPartialBlockStartRepair(bot);
  const movements = bot.pathfinder.movements;
  movements.canDig = false; movements.allowParkour = false; movements.allow1by1towers = false;
  movements.scafoldingBlocks = []; bot.pathfinder.thinkTimeout = 250; bot.pathfinder.tickTimeout = 5;
  installTreadWater(bot); installDoorWaypointRepair(bot);
  return { ...h, bot, movements };
}

it.each(['water', 'kelp', 'tall_seagrass'] as const)('plans %s as a water route without lowering executable waypoints or inventing support', plant => {
  const h = pool(plant);
  let result: ReturnType<typeof h.bot.pathfinder.getPathTo> | undefined;
  for (const probe of h.bot.pathfinder.getPathFromTo(h.movements, h.bot.entity.position,
    new pathfinderPkg.goals.GoalBlock(0, 65, -5), { timeout: 500, tickTimeout: 10 })) result = probe.result;
  expect(result).toBeDefined();
  if (!result) return;
  expect(result.status).toBe('success');
  expect(result.path.length).toBeGreaterThan(0);
  expect(result.path.every(p => p.y === 65 && !p.toBreak.length && !p.toPlace.length), JSON.stringify(result.path)).toBe(true);
});

it.each(['water', 'kelp', 'tall_seagrass'] as const)('crosses the actual %s pool with passive treading installed', async plant => {
  const h = pool(plant), from = h.bot.entity.position.clone();
  let reached = false;
  h.bot.on('goal_reached', () => { reached = true; });
  h.bot.pathfinder.setGoal(new pathfinderPkg.goals.GoalBlock(0, 65, -5));
  for (let i = 0; i < 200 && !reached; i++) await vi.advanceTimersByTimeAsync(50);
  expect(reached, JSON.stringify({ from, at: h.bot.entity.position, keys: h.keys })).toBe(true);
  expect(h.bot.entity.position.z).toBeLessThan(-4);
  expect(h.bot.entity.position.y).toBeGreaterThanOrEqual(65);
  expect(h.bot.physicsEnabled).toBe(true);
});

it('does not infer an original water cell from a missing hash or future construction', () => {
  const h = pool('kelp');
  const unknown = { x:.5, y:64, z:.5 };
  const future = { x:.5, y:64, z:.5, hash:'0,65,0', toPlace:[{}] };
  const after = { x:.5, y:64, z:-.5, hash:'0,65,-1' };
  expect(repairWaterWaypoints(h.bot,[unknown,future,after])).toBe(0);
  expect(after.y).toBe(64);
});

it('captures actual accessor-backed movement keys in the stalled-water evidence', () => {
  const h = pool('water'), keys = {};
  Object.defineProperty(keys,'jump',{get:()=>true,enumerable:false});
  Object.defineProperty(keys,'forward',{get:()=>false,enumerable:false});
  Object.assign(h.bot,{controlState:keys});
  let captured: Record<string,unknown> | undefined;
  writeStallProbe(h.bot,{taskId:1,diag:{write:(row: {data:Record<string,unknown>})=>{captured=row.data;}}} as never,
    new goals.GoalBlock(0,66,-5),'stall');
  expect(captured?.controlState).toMatchObject({jump:true,forward:false,sneak:null});
});
