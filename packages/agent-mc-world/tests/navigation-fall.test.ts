import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { Reflexes } from '../core/executor.ts';
import { checkGroundPath, groundPathIssueOf, installDoorWaypointRepair } from '../core/path-waypoints.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.useRealTimers());

it('rejects a damaging executable drop without rejecting a descending staircase', () => {
  const bot = { entity: { position: new Vec3(.5, 73, .5), onGround: true, effects: {} },
    blockAt: (position: Vec3) => ({ name: 'air', position }) };
  expect(checkGroundPath(bot as never, [{ x: 1.5, y: 50, z: .5 }])?.reason).toContain('落差');
  expect(checkGroundPath(bot as never, [71, 69, 67, 65, 63].map((y, x) => ({ x: x + 1.5, y, z: .5 })))).toBeNull();
  bot.blockAt = position => ({ name: 'water', position });
  expect(checkGroundPath(bot as never, [{ x: 1.5, y: 50, z: .5 }])).toBeNull();
});

it('stops the real physics/control loop before walking off a dry 22-block cliff', async () => {
  vi.useFakeTimers();
  const r = methodHarness();
  try {
    for (let x = 2; x <= 9; x++) for (let z = -3; z <= 3; z++) for (let y = 42; y <= 63; y++) r.set(x, y, z, 'air');
    r.bot.entity.yaw = -Math.PI / 2;
    r.bot.pathfinder.goal = { y: 42 } as never;
    r.bot.on('physicsTick', () => { if (r.bot.pathfinder.goal) r.bot.setControlState('forward', true); });
    installDoorWaypointRepair(r.bot as never);
    let lowest = 64;
    r.bot.on('physicsTick', () => { lowest = Math.min(lowest, r.bot.entity.position.y); });
    await vi.advanceTimersByTimeAsync(2500);
    expect(groundPathIssueOf(r.bot)?.reason).toContain('落差');
    expect(r.bot.pathfinder.goal).toBeNull();
    expect(lowest).toBeGreaterThanOrEqual(63.99);
    // The original 0.6-wide body can overhang the edge while supported.
    expect(r.bot.entity.position.x).toBeLessThan(2.3);
    expect(r.bot.entity.onGround).toBe(true);
  } finally { r.close(); }
});

it('keeps flat travel and a two-block descent moving in the same physics loop', async () => {
  vi.useFakeTimers();
  const r = methodHarness();
  try {
    for (let x = 2; x <= 12; x++) for (let z = -2; z <= 2; z++) for (const y of [62, 63]) r.set(x, y, z, 'air');
    r.bot.entity.yaw = -Math.PI / 2;
    r.bot.pathfinder.goal = { y: 62 } as never;
    r.bot.on('physicsTick', () => { if (r.bot.pathfinder.goal) r.bot.setControlState('forward', true); });
    installDoorWaypointRepair(r.bot as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(groundPathIssueOf(r.bot)).toBeNull();
    expect(r.bot.entity.position.x).toBeGreaterThan(5);
    expect(r.bot.entity.position.y).toBeCloseTo(62);
  } finally { r.close(); }
});

it('a lower goal never exempts an already observed deep fall from stopping the task', () => {
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(.5, 73, .5), velocity: new Vec3(0, -.1, 0), onGround: false, height: 1.8 },
    health: 20, blockAt: () => ({ name: 'air', boundingBox: 'empty' }), clearControlStates() {},
    pathfinder: { goal: { y: 50 } as unknown, setGoal(value: unknown) { this.goal = value; } },
  });
  const stop = vi.fn(() => null), report = vi.fn();
  const reflexes = new Reflexes({ getBot: () => bot, stopFallTask: stop, report } as never);
  (reflexes as any).watchFall(bot);
  bot.entity.position.y = 61;
  (reflexes as any).watchFall(bot);
  expect(stop).toHaveBeenCalledOnce();
  expect(bot.pathfinder.goal).toBeNull();
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reflex', text: expect.stringContaining('深坠落') }));
});
