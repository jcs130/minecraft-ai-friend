import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { Bridge } from '../core/bridge.ts';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';
import type { TaskReport } from '../core/executor.ts';
import { nullLogger } from '../src/client/index.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.useRealTimers());

it.each(['1.21.1', '1.20.6'])('walks the existing detour around a wall without breaking it (%s)', async version => {
  vi.useFakeTimers();
  const h = methodHarness(version), bot = h.bot as unknown as Bot, reports: TaskReport[] = [];
  try {
    Object.assign(h.bot, { supportFeature: (name: string) => h.bot.registry.supportFeature(name),
      getControlState: (key: string) => h.keys[key], isAlive: true, dig: vi.fn(() => { throw Error('Unexpected digging'); }), placeBlock: vi.fn() });
    Object.assign(h.bot.game, { minY: -64, height: 384 });
    Object.assign(h.bot.world, { getBlockStateId: (at: Vec3) => h.bot.blockAt(at).stateId, getColumn: () => ({}) });
    for (let z = -2; z <= 2; z++) for (let y = 64; y < 68; y++) h.set(2, y, z, 'dirt');
    pathfinderPkg.pathfinder(bot); installPathfinderPerf();
    class FixtureBridge extends Bridge { attach() { this._bot = bot; } tune() { this.applyTuning(bot, bot.pathfinder.movements); } }
    const bridge = new FixtureBridge({ host: 'fixture.invalid', port: 25565, username: 'Fixture', version,
      viewerPort: 0, log: nullLogger(), onSnapshot() {}, onEvent() {}, onMessage() {},
      movementCosts: () => ({ digCost: 0.001, placeCost: 1 }) } as never);
    bridge.attach(); bridge.tune();
    bot.pathfinder.movements.canDig = true;
    bot.pathfinder.movements.scafoldingBlocks = [];
    bot.pathfinder.thinkTimeout = 1000; bot.pathfinder.tickTimeout = 10;
    const probe = bridge.probeRoutes({ x: 6, y: 64, z: 0 }, undefined, ['walk'])!;
    expect(probe).toHaveLength(1); expect(probe[0].status).toBe('complete');
    expect(probe[0].breaks).toBe(0); expect(probe[0].place).toBe(0);
    const alternatives = bridge.probeRoutes({ x: 6, y: 64, z: 0 })!;
    const shortcut = alternatives.find(p => p.profile === 'style')!;
    expect(shortcut.status).toBe('complete'); expect(shortcut.breaks).toBeGreaterThan(0);
    expect(probe[0].steps).toBeGreaterThan(shortcut.steps);
    Object.assign((h.exec as any).opts, { report: (r: TaskReport) => reports.push(r),
      probeRoutes: bridge.probeRoutes.bind(bridge), fleeHealth: () => 0 });
    const visitedZ: number[] = []; bot.on('physicsTick', () => visitedZ.push(bot.entity.position.z));
    expect(h.exec.submitDetailed([{ skill: 'goto', at: [6, 64, 0] }]).accepted).toBe(true);
    for (let t = 0; t < 400 && !reports.length; t++) await vi.advanceTimersByTimeAsync(50);
    expect(reports[0]?.kind, JSON.stringify(reports)).toBe('done');
    expect(bot.entity.position.x).toBeGreaterThan(4.9);
    expect(Math.max(...visitedZ.map(Math.abs))).toBeGreaterThan(2.5);
    expect(h.bot.dig).not.toHaveBeenCalled(); expect(h.bot.placeBlock).not.toHaveBeenCalled();
    expect(h.bot.blockAt(new Vec3(2, 64, 0)).name).toBe('dirt');
    expect(bot.pathfinder.movements.canDig).toBe(true);
  } finally { h.close(); }
});
