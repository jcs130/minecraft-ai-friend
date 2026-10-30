import type { Bot } from 'mineflayer';
import { afterEach, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { goals, gotoGoal, navigationMotionEvidence, stallBlocked } from '../core/travel.ts';

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const h of rigs.splice(0)) h.close(); vi.useRealTimers(); });

it('ends an owned route that never issues motion without running collision recovery or claiming a frozen player', async () => {
  vi.useFakeTimers();
  const h = methodHarness('1.21.1'); rigs.push(h);
  let resolve!: () => void;
  const goal = new goals.GoalBlock(0, 67, 0);
  Object.assign(h.bot.pathfinder, { isMoving: () => false, isMining: () => false, isBuilding: () => false,
    goto: async (next: unknown) => { h.bot.pathfinder.goal = next as never; await new Promise<void>(done => { resolve = done; }); },
    setGoal: (next: unknown) => { h.bot.pathfinder.goal = next as never; if (next === null) resolve(); },
  });
  const keys = vi.spyOn(h.bot, 'setControlState');
  const work = gotoGoal(h.bot as unknown as Bot, goal, { aborted: () => false } as never).catch(error => error);
  await vi.advanceTimersByTimeAsync(11000);
  const error = await work;
  expect(error.code).toBe('pathfinder-planning-stalled');
  expect(error.message).toContain('未观察到行走或移动按键');
  expect(error.message).not.toMatch(/人动不了|跳\/退解卡也没能动|服务器冻结(?!。)/);
  expect(keys.mock.calls.some(([, value]) => value === true)).toBe(false);
  expect(h.bot.pathfinder.goal).toBeNull();
});

it('reads non-enumerable native motor accessors and keeps missing readings unknown', () => {
  const h = methodHarness('1.21.1'); rigs.push(h);
  Object.assign(h.bot.pathfinder, { isMoving: () => false });
  expect(navigationMotionEvidence(h.bot as unknown as Bot)).toBe(false);
  let pressed = true;
  Object.defineProperty(h.keys, 'forward', { get: () => pressed, set: value => { pressed = value; }, enumerable: false });
  expect(navigationMotionEvidence(h.bot as unknown as Bot)).toBe(true);
  expect(navigationMotionEvidence({ pathfinder: { isMoving: () => false } } as unknown as Bot)).toBeNull();
});

it('keeps a collision distinct and does not turn an unavailable support reading into empty space', () => {
  const h = methodHarness('1.21.1'); rigs.push(h);
  h.bot.blockAt = () => null as never;
  const error = stallBlocked(h.bot as unknown as Bot, { best: 3, now: 3, at: { x: 0, y: 64, z: 0 },
    metric: '直线', ms: 10000, gate: 'idle', wedged: true, leg: { x: 0, y: 67, z: 0 }, activity: 'movement' }, 0);
  expect(error.message).toContain('钉在原地');
  expect(error.message).toContain('安全解卡未取得有效位移');
  expect(error.message).toContain('脚下方块未读取');
  expect(error.message).not.toContain('人动不了');
});
