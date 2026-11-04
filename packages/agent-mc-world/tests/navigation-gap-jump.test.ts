import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { afterEach, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';
import { installLevelGapJumps } from '../core/navigation-gap-jump.ts';
import { installDoorWaypointRepair } from '../core/path-waypoints.ts';

afterEach(() => vi.useRealTimers());
function rig(version: string) {
  vi.useFakeTimers();
  const h = methodHarness(version), bot = h.bot as unknown as Bot;
  Object.assign(h.bot, { supportFeature: (name: string) => h.bot.registry.supportFeature(name),
    getControlState: (key: string) => h.keys[key], isAlive: true,
    dig: vi.fn(() => { throw Error('unexpected digging'); }), placeBlock: vi.fn() });
  Object.assign(h.bot.game, { minY: -64, height: 384 });
  Object.assign(h.bot.world, { getBlockStateId: (at: any) => h.bot.blockAt(at).stateId, getColumn: () => ({}) });
  // Corridor cannot route around the gap. Physical landing and walls use native block shapes.
  for (let x = -4; x <= 8; x++) for (let y = 64; y <= 67; y++) {
    h.set(x, y, -1, 'stone'); h.set(x, y, 1, 'stone');
  }
  pathfinderPkg.pathfinder(bot); installPathfinderPerf(); installDoorWaypointRepair(bot);
  const m = new pathfinderPkg.Movements(bot);
  Object.assign(m, { canDig: false, allowParkour: true, allow1by1towers: false, scafoldingBlocks: [], maxDropDown: 2 });
  installLevelGapJumps(m);
  bot.pathfinder.setMovements(m); bot.pathfinder.tickTimeout = 20;
  return { ...h, bot, m };
}

it.each(['1.21.1', '1.20.6'])('physically crosses a one-cell lava gap without touching lava on %s', async version => {
  const r = rig(version);
  try {
    r.set(1, 63, 0, 'lava');
    await vi.advanceTimersByTimeAsync(200);
    const hits: number[] = []; r.bot.on('physicsTick', () => { if (r.bot.entity.isInLava) hits.push(Date.now()); });
    let done = false, error: unknown;
    void r.bot.pathfinder.goto(new pathfinderPkg.goals.GoalBlock(3, 64, 0)).then(() => { done = true; }, e => { done = true; error = e; });
    for (let t = 0; t < 200 && !done; t++) await vi.advanceTimersByTimeAsync(50);
    expect(r.bot.entity.position.x).toBeGreaterThan(2.5);
    expect(r.bot.entity.position.y).toBeGreaterThanOrEqual(64);
    expect(hits).toEqual([]);
    expect({ done, error, position: r.bot.entity.position, goal: r.bot.pathfinder.goal }).toMatchObject({ done: true, error: undefined });
    expect(r.bot.dig).not.toHaveBeenCalled(); expect(r.bot.placeBlock).not.toHaveBeenCalled();
  } finally { r.bot.pathfinder.setGoal(null); r.close(); }
}, 15000);

it.each(['wide', 'ceiling', 'raised'])('rejects a %s gap and never generates the old door-frame style upward parkour', async kind => {
  const r = rig('1.21.1');
  try {
    r.set(1, 63, 0, 'lava');
    if (kind === 'wide') r.set(2, 63, 0, 'lava');
    if (kind === 'ceiling') r.set(1, 66, 0, 'stone');
    if (kind === 'raised') r.set(2, 64, 0, 'stone');
    const moves: any[] = [];
    (r.m as any).getMoveParkourForward({ x: 0, y: 64, z: 0, remainingBlocks: 0 }, { x: 1, z: 0 }, moves);
    expect(moves).toEqual([]);
  } finally { r.close(); }
});
