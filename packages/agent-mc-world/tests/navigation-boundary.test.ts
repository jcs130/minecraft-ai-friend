import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { installNavigationBoundaryGuard, navigationBoundaryFailureOf } from '../core/navigation-boundary.ts';
import { installPartialBlockStartRepair } from '../core/pathfinder-start.ts';
import { installWorldIdentity } from '../core/world-scope.ts';
import { gotoGoalOnce, setOwnedGoal } from '../core/travel.ts';
import { methodHarness } from './method-harness.ts';
import type { TaskReport } from '../core/executor.ts';

const mf = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const h of rigs.splice(0)) { h.bot.emit('end'); h.close(); } vi.useRealTimers(); });

function rig(version = '1.21.1', guard = true) {
  vi.useFakeTimers();
  const h = methodHarness(version); rigs.push(h);
  const bot = h.bot as unknown as Bot;
  Object.assign(bot, { supportFeature: (name: string) => bot.registry.supportFeature(name), isAlive: true });
  Object.assign(bot.game, { minY: -64, height: 384 });
  // Native protocol application + real local collision physics. No sockets/server.
  mf('mineflayer/lib/plugins/physics.js')(bot, { physicsEnabled: true });
  installWorldIdentity(bot);
  bot._client.emit('login', { worldState: { name: 'minecraft:overworld' } } as never);
  pathfinderPkg.pathfinder(bot); installPartialBlockStartRepair(bot);
  const m = bot.pathfinder.movements;
  m.canDig = false; m.allowParkour = false; m.allow1by1towers = false; m.scafoldingBlocks = [];
  bot.pathfinder.tickTimeout = 10;
  const dispose = guard ? installNavigationBoundaryGuard(bot) : () => {};
  const position = (x: number, y: number, z: number, relative = false) => bot._client.emit('position', {
    x, y, z, yaw: 0, pitch: 0, flags: { x: relative, y: relative, z: relative, yaw: false, pitch: false }, teleportId: 1,
  } as never);
  return { h, bot, position, dispose };
}

it.each(['1.21.1', '1.20.6'])('invalidates an in-flight route at a native teleport, before another physics tick (%s)', async version => {
  const r = rig(version), goal = new pathfinderPkg.goals.GoalBlock(30, 64, 0);
  const result = r.bot.pathfinder.goto(goal).catch(e => e);
  await vi.advanceTimersByTimeAsync(300);
  expect(r.bot.entity.position.x).toBeGreaterThan(.5);
  expect(r.bot.pathfinder.isMoving()).toBe(true);
  r.position(-582.5, 69, 934.5);
  expect(r.bot.pathfinder.goal).toBeNull();
  expect(r.bot.pathfinder.isMoving()).toBe(false);
  expect(r.bot.getControlState('forward')).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ name: 'NavigationBoundary' });
  expect(navigationBoundaryFailureOf(r.bot)).toMatchObject({ goal, kind: 'position-discontinuity', to: { x: -582.5, y: 69, z: 934.5 } });
  // Returning through a portal with no new route cannot resurrect the old A* frontier.
  r.position(.5, 64, .5); await vi.advanceTimersByTimeAsync(100);
  expect(r.bot.pathfinder.goal).toBeNull(); expect(r.bot.pathfinder.isMoving()).toBe(false);
});

it('reproduces pinned upstream retaining its old route after the same teleport without the guard', async () => {
  const r = rig('1.21.1', false), goal = new pathfinderPkg.goals.GoalBlock(30, 64, 0);
  const result = r.bot.pathfinder.goto(goal).catch(e => e);
  await vi.advanceTimersByTimeAsync(300); r.position(-582.5, 69, 934.5);
  expect(r.bot.pathfinder.goal).toBe(goal); expect(r.bot.pathfinder.isMoving()).toBe(true);
  expect(r.bot.getControlState('forward')).toBe(true);
  r.bot.pathfinder.setGoal(null); await vi.advanceTimersByTimeAsync(1); await result;
});

it('reports a boundary promptly and leaves a replacement goal owned by another action intact', async () => {
  const r = rig(), old = new pathfinderPkg.goals.GoalBlock(30, 64, 0);
  const result = gotoGoalOnce(r.bot, old, { aborted: () => false } as never).catch(e => e);
  await vi.advanceTimersByTimeAsync(300); r.position(100, 64, 100);
  const next = new pathfinderPkg.goals.GoalBlock(110, 64, 100);
  setOwnedGoal(r.bot, next, 'task', 'new task after relocation');
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ code: 'navigation-location-changed' });
  expect(r.bot.pathfinder.goal).toBe(next);
  expect((await result).message).not.toMatch(/跳跃范围|零推进|不可达$/);
});

it('preserves the relocation reason in the executor terminal instead of retrying with terrain changes', async () => {
  const r = rig(), reports: TaskReport[] = [];
  Object.assign((r.h.exec as any).opts, { report: (report: TaskReport) => reports.push(report), fleeHealth: () => 0 });
  expect(r.h.exec.submitDetailed([{ skill: 'goto', at: [30, 64, 0], walkOnly: true }]).accepted).toBe(true);
  await vi.advanceTimersByTimeAsync(300);
  r.position(20, 0, 100, true); // Relative packet must be interpreted by native physics.
  await vi.advanceTimersByTimeAsync(300);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ kind: 'blocked', steps: [{ outcome: 'fail', decision: {
    status: 'blocked', reason: 'navigation-location-changed', retryable: false,
  } }] });
  expect(reports[0].text).toContain('旧路径已失效');
  expect(r.bot.pathfinder.goal).toBeNull();
  expect(navigationBoundaryFailureOf(r.bot)?.to?.z).toBeGreaterThan(100);
});

it.each(['relative', 'absolute', 'rotation'])('keeps a small %s server correction and ordinary motion usable', async mode => {
  const r = rig(), goal = new pathfinderPkg.goals.GoalBlock(5, 64, 0);
  const result = r.bot.pathfinder.goto(goal).catch(e => e);
  await vi.advanceTimersByTimeAsync(300);
  const p = r.bot.entity.position.clone();
  if (mode === 'relative') r.position(.2, 0, 0, true);
  else r.position(p.x + (mode === 'absolute' ? .2 : 0), p.y, p.z);
  expect(r.bot.pathfinder.goal).toBe(goal); expect(navigationBoundaryFailureOf(r.bot)).toBeNull();
  for (let t = 0; t < 150 && r.bot.pathfinder.goal; t++) await vi.advanceTimersByTimeAsync(50);
  expect(r.bot.pathfinder.goal).toBeNull(); await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBeUndefined(); expect(r.bot.entity.position.x).toBeGreaterThan(4.5);
});

it('clears partial search on native respawn even with identical coordinates and dimension type', async () => {
  const r = rig(), goal = new pathfinderPkg.goals.GoalBlock(30, 64, 0);
  const result = r.bot.pathfinder.goto(goal).catch(e => e);
  r.bot._client.emit('respawn', { worldState: { name: 'minecraft:another-world' } } as never);
  expect(r.bot.pathfinder.goal).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ name: 'NavigationBoundary' });
  expect(navigationBoundaryFailureOf(r.bot)).toMatchObject({ kind: 'respawn', world: 'minecraft:another-world' });
});

it('is idempotent, disposes its listeners and permits a fresh route from the new landing', async () => {
  const r = rig(), listeners = r.bot._client.listenerCount('position');
  expect(installNavigationBoundaryGuard(r.bot)).toBe(r.dispose);
  expect(r.bot._client.listenerCount('position')).toBe(listeners);
  const first = r.bot.pathfinder.goto(new pathfinderPkg.goals.GoalBlock(30, 64, 0)).catch(e => e);
  await vi.advanceTimersByTimeAsync(200); r.position(100.5, 64, 100.5);
  await vi.advanceTimersByTimeAsync(1); await first;
  const second = r.bot.pathfinder.goto(new pathfinderPkg.goals.GoalBlock(104, 64, 100)).catch(e => e);
  for (let t = 0; t < 150 && r.bot.pathfinder.goal; t++) await vi.advanceTimersByTimeAsync(50);
  expect(await second).toBeUndefined(); expect(r.bot.entity.position.x).toBeGreaterThan(103.5);
  r.dispose(); r.dispose();
  expect(r.bot._client.listenerCount('position')).toBe(listeners - 2);
  expect(navigationBoundaryFailureOf(r.bot)).toBeNull();
});
