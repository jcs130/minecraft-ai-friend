import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { afterEach, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { methodHarness } from './method-harness.ts';
import { reachCell } from '../core/travel.ts';

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const h of rigs.splice(0)) { h.close(); h.bot.emit('end', 'fixture'); } vi.useRealTimers(); });

it('ends a real 1.21.1 approach at reachable range without requiring a path across a gap', async () => {
  vi.useFakeTimers();
  const h = methodHarness('1.21.1'); rigs.push(h);
  const bot = h.bot as unknown as Bot;
  Object.assign(bot, { supportFeature: (name: string) => bot.registry.supportFeature(name) });
  Object.assign(bot.game, { minY: -64, height: 384 });
  Object.assign(bot.world, { getBlockStateId: (at: Vec3) => bot.blockAt(at)!.stateId, getColumn: () => ({}) });
  // The chest is visible across a short gap. The bank is inside interaction
  // reach, but there is no supported position within the old two-block goal.
  for (let x = 3; x < 12; x++) for (let z = -12; z < 12; z++)
    for (let y = 50; y < 64; y++) h.set(x, y, z, 'air');
  h.set(5, 64, 0, 'chest');
  pathfinder.pathfinder(bot);
  Object.assign(bot.pathfinder.movements, { canDig: false, allowParkour: false,
    allow1by1towers: false, scafoldingBlocks: [] });
  bot.pathfinder.thinkTimeout = 100; bot.pathfinder.tickTimeout = 5;
  const work = reachCell(bot, { x: 5, y: 64, z: 0 }, { aborted: () => false } as never)
    .then(() => ({ ok: true, error: null }), error => ({ ok: false, error }));
  await vi.advanceTimersByTimeAsync(5000);
  const result = await work;
  expect(result.error).toBeNull();
  expect(bot.entity.position.x).toBeGreaterThan(1.5);
  expect(bot.entity.position.x).toBeLessThan(3);
  expect(new pathfinder.goals.GoalNear(5, 64, 0, 2).isEnd(bot.entity.position.floored())).toBe(false);
  expect(bot.entity.position.distanceTo(new Vec3(5.5, 64.5, 0.5))).toBeLessThanOrEqual(4);
  expect(bot.pathfinder.goal).toBeNull();
});

it('honours cancellation even when the target is already within reach', async () => {
  const h = methodHarness('1.21.1'); rigs.push(h);
  await expect(reachCell(h.bot as unknown as Bot, { x: 1, y: 64, z: 0 }, { aborted: () => true } as never))
    .rejects.toThrow();
});
