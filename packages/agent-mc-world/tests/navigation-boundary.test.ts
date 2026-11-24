import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { installNavigationBoundaryGuard, navigationBoundaryFailureOf } from '../core/navigation-boundary.ts';
import { installPartialBlockStartRepair } from '../core/pathfinder-start.ts';
import { installWorldIdentity } from '../core/world-scope.ts';
import { goalOwnerOf, gotoGoalOnce, setOwnedGoal } from '../core/travel.ts';
import type { SkillContext } from '../core/skill-context.ts';
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

function pausedRoute(x = 30) {
  const r = rig(), goal = new pathfinderPkg.goals.GoalBlock(x, 64, 0);
  const goto = vi.spyOn(r.bot.pathfinder, 'goto');
  const beforeListeners = ['position', 'respawn'].map(event => r.bot._client.listenerCount(event));
  let resume!: () => void, paused = false;
  const handoff = new Promise<void>(resolve => { resume = resolve; });
  const ctx: Pick<SkillContext, 'aborted' | 'checkpoint'> = {
    aborted: () => false,
    checkpoint: async settle => {
      if (paused) return;
      await settle?.();
      paused = true;
      await handoff; // A deferred handoff returns to the original navigation loop.
    },
  };
  const result = gotoGoalOnce(r.bot, goal, ctx as SkillContext).catch(error => error);
  return { ...r, goal, goto, result, resume, beforeListeners, paused: () => paused };
}

it('never revives an old goal after a native relocation during a deferred checkpoint pause', async () => {
  const r = pausedRoute();
  await vi.advanceTimersByTimeAsync(300);
  expect(r.paused()).toBe(true);
  expect(r.bot.pathfinder.goal).toBeNull();
  expect(r.bot.getControlState('forward')).toBe(false);
  const from = r.bot.entity.position.clone();
  r.position(100.5, 64, 100.5);
  r.position(from.x, from.y, from.z); // Returning to the same feet cannot restore the old route.
  r.resume();
  await vi.advanceTimersByTimeAsync(300);
  expect(r.goto).toHaveBeenCalledTimes(1);
  expect(await r.result).toMatchObject({ code: 'navigation-location-changed' });
  expect(['position', 'respawn'].map(event => r.bot._client.listenerCount(event))).toEqual(r.beforeListeners);
  expect(r.bot.pathfinder.goal).toBeNull();
  expect(r.bot.getControlState('forward')).toBe(false);
});

it.each(['task', 'combat'] as const)('preserves a replacement %s goal after relocation during checkpoint cleanup', async owner => {
  const r = pausedRoute();
  await vi.advanceTimersByTimeAsync(300);
  expect(r.paused()).toBe(true);
  expect(r.bot.pathfinder.goal).toBeNull();
  if (owner === 'task') r.position(100.5, 64, 100.5);
  else r.bot._client.emit('respawn', { worldState: { name: 'minecraft:another-world' } } as never);
  const next = new pathfinderPkg.goals.GoalBlock(110, 64, 100);
  setOwnedGoal(r.bot, next, owner, 'replacement during deferred checkpoint');
  r.resume();
  await vi.advanceTimersByTimeAsync(300);
  expect(await r.result).toMatchObject({ code: 'navigation-location-changed' });
  expect(r.goto).toHaveBeenCalledTimes(1);
  expect(r.bot.pathfinder.goal).toBe(next);
  expect(goalOwnerOf(r.bot)).toMatchObject({ kind: owner, goal: next });
  expect(['position', 'respawn'].map(event => r.bot._client.listenerCount(event))).toEqual(r.beforeListeners);
});

it('still completes the same legitimate goal after a deferred checkpoint pause without relocation', async () => {
  const r = pausedRoute(5);
  await vi.advanceTimersByTimeAsync(300);
  expect(r.paused()).toBe(true);
  expect(r.bot.pathfinder.goal).toBeNull();
  r.position(.2, 0, 0, true); // A native small correction still permits the deferred handoff.
  r.resume();
  await vi.advanceTimersByTimeAsync(3000);
  expect(await r.result).toBeUndefined();
  expect(r.goto).toHaveBeenCalledTimes(2);
  expect(r.goto.mock.calls.every(([goal]) => goal === r.goal)).toBe(true);
  expect(['position', 'respawn'].map(event => r.bot._client.listenerCount(event))).toEqual(r.beforeListeners);
  expect(r.bot.entity.position.floored()).toEqual(new Vec3(5, 64, 0));
  expect(r.bot.pathfinder.goal).toBeNull();
  expect(r.bot.getControlState('forward')).toBe(false);
});

it('preserves the relocation reason in the executor terminal instead of retrying with terrain changes', async () => {
  const r = rig(), reports: TaskReport[] = [];
  Object.assign((r.h.exec as any).opts, { report: (report: TaskReport) => reports.push(report), fleeHealth: () => 0 });
  const terminalEvents = ['goal_reached', 'goal_updated', 'path_stop'] as const;
  const beforeListeners = terminalEvents.map(event => r.bot.listenerCount(event));
  expect(r.h.exec.submitDetailed([{ skill: 'goto', at: [30, 64, 0], walkOnly: true }]).accepted).toBe(true);
  // An executable path prefix alone does not prove the goto Promise has armed
  // its terminal listeners. Relocate only during the actual awaited route.
  const awaitedRoute = () => r.bot.pathfinder.isMoving()
    && terminalEvents.every((event, i) => r.bot.listenerCount(event) > beforeListeners[i]);
  for (let elapsed = 0; !awaitedRoute() && elapsed < 3000; elapsed += 50) {
    await vi.advanceTimersByTimeAsync(50);
  }
  expect(awaitedRoute(), JSON.stringify({ beforeListeners,
    currentListeners: terminalEvents.map(event => r.bot.listenerCount(event)), moving: r.bot.pathfinder.isMoving() })).toBe(true);
  r.position(20, 0, 100, true); // Relative packet must be interpreted by native physics.
  // Safety is synchronous; the executor report follows asynchronous goto/checkpoint cleanup.
  expect(r.bot.pathfinder.goal).toBeNull();
  expect(r.bot.pathfinder.isMoving()).toBe(false);
  expect(r.bot.getControlState('forward')).toBe(false);
  for (let elapsed = 0; reports.length === 0 && elapsed < 3000; elapsed += 50) {
    await vi.advanceTimersByTimeAsync(50);
  }
  if (reports.length === 0) {
    const boundary = navigationBoundaryFailureOf(r.bot);
    console.error('NAVIGATION_TERMINAL_FIXTURE_DIAGNOSTIC', JSON.stringify({
      queue: r.h.exec.status(),
      listeners: Object.fromEntries(terminalEvents.map(event => [event, r.bot.listenerCount(event)])),
      boundary: boundary ? { sequence: boundary.sequence, kind: boundary.kind, goalType: boundary.goal.constructor.name } : null,
      position: r.bot.entity.position, onGround: r.bot.entity.onGround, forward: r.bot.getControlState('forward'),
    }));
  }
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ kind: 'blocked', steps: [{ outcome: 'fail', decision: {
    status: 'blocked', reason: 'navigation-location-changed', retryable: false,
  } }] });
  expect(reports[0].text).toContain('旧路径已失效');
  expect(r.bot.pathfinder.goal).toBeNull();
  expect(navigationBoundaryFailureOf(r.bot)?.to?.z).toBeGreaterThan(100);
});

it('terminates a persistent follow after relocation even when the old entity is still tracked', async () => {
  const r = rig(), reports: TaskReport[] = [];
  Object.assign((r.h.exec as any).opts, { report: (report: TaskReport) => reports.push(report), fleeHealth: () => 0 });
  const ally = { id: 2, type: 'player', username: 'Ally', name: 'player', isValid: true,
    position: r.bot.entity.position.offset(32, 0, 0) };
  Object.assign(r.bot.entities, { 2: ally }); Object.assign(r.bot.players, { Ally: { entity: ally } });
  r.h.exec.submit([{ skill: 'follow', name: 'Ally' }], 'append');
  await vi.advanceTimersByTimeAsync(300);
  const taskId = r.h.exec.status().running!.id;
  expect(r.bot.pathfinder.isMoving()).toBe(true);
  r.position(100.5, 64, 100.5);
  await vi.advanceTimersByTimeAsync(300);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ taskId, kind: 'blocked', steps: [{ outcome: 'fail', decision: {
    status: 'blocked', reason: 'navigation-location-changed', retryable: false,
  } }] });
  expect(r.h.exec.status().running).toBeNull();
  expect(r.bot.pathfinder.goal).toBeNull();
  expect(ally.isValid).toBe(true); // Entity presence alone does not authorize a route across relocation.
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
