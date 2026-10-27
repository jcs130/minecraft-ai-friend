import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { awaitPathGoal } from '../core/navigation-result.ts';

const nativeGoto = createRequire(import.meta.url)('mineflayer-pathfinder/lib/goto.js');
const events = ['path_update', 'goal_reached', 'goal_updated', 'path_stop'];
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function rig() {
  const bot = Object.assign(new EventEmitter(), { pathfinder: {
    goal: null as pathfinder.goals.Goal | null,
    setGoal(goal: pathfinder.goals.Goal | null) { this.goal = goal; bot.emit('goal_updated', goal); },
  } });
  const goal = new pathfinder.goals.GoalBlock(2, 66, 0);
  return { bot, goal, start: () => awaitPathGoal(bot as unknown as Bot, goal) };
}
function observe(promise: Promise<void>) {
  const result = { settled: false, error: null as Error | null };
  promise.then(() => { result.settled = true; }, error => { result.settled = true; result.error = error; });
  return result;
}
function cleaned(bot: EventEmitter) {
  for (const event of events) expect(bot.listenerCount(event), event).toBe(0);
}

it('reproduces pinned goto resolving an empty partial, while the core keeps that search alive', async () => {
  const old = rig(), fixed = rig();
  const previous = observe(nativeGoto(old.bot, old.goal)), current = observe(fixed.start());
  for (const { bot } of [old, fixed]) bot.emit('path_update', { status: 'partial', path: [] });
  await vi.advanceTimersByTimeAsync(1);
  expect(previous).toMatchObject({ settled: true, error: null });
  expect(current.settled).toBe(false);
  fixed.bot.emit('path_update', { status: 'success', path: [{ x: 2, y: 66, z: 0 }] });
  await vi.advanceTimersByTimeAsync(1);
  expect(current.settled).toBe(false);
  fixed.bot.emit('goal_reached', fixed.goal);
  await vi.advanceTimersByTimeAsync(1);
  expect(current).toMatchObject({ settled: true, error: null });
  cleaned(old.bot); cleaned(fixed.bot);
});

it.each([['noPath', 'NoPath'], ['timeout', 'Timeout']])('preserves %s as failure even with an empty path', async (status, name) => {
  const h = rig(), result = observe(h.start());
  h.bot.emit('path_update', { status, path: [] });
  await vi.advanceTimersByTimeAsync(1);
  expect(result.settled).toBe(true); expect(result.error?.name).toBe(name); cleaned(h.bot);
});

it('settles an already satisfied goal only on the next stack, after native cleanup', async () => {
  const h = rig(); let nativeCleanup = false;
  const promise = h.start().then(() => { expect(nativeCleanup).toBe(true); });
  h.bot.emit('path_update', { status: 'success', path: [] });
  nativeCleanup = true;
  await vi.advanceTimersByTimeAsync(1); await promise; cleaned(h.bot);
});

it.each(['changed', 'stopped'])('cancellation by %s cannot become success or leave listeners on a later path', async reason => {
  const h = rig(), result = observe(h.start());
  const replacement = new pathfinder.goals.GoalBlock(10, 65, 0);
  if (reason === 'changed') h.bot.pathfinder.setGoal(replacement);
  else h.bot.emit('path_stop');
  h.bot.emit('goal_reached', h.goal);
  await vi.advanceTimersByTimeAsync(1);
  expect(result.error?.name).toBe(reason === 'changed' ? 'GoalChanged' : 'PathStopped'); cleaned(h.bot);
  if (reason === 'changed') expect(h.bot.pathfinder.goal).toBe(replacement);
});

it('cleans up synchronous startup errors without waiting for a path event', async () => {
  const h = rig(); h.bot.pathfinder.setGoal = () => { throw new Error('startup failed'); };
  const result = observe(h.start());
  await vi.advanceTimersByTimeAsync(1);
  expect(result.error?.message).toBe('startup failed'); cleaned(h.bot);
});
