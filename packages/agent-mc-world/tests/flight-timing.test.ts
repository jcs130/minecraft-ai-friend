import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flyToPosition, previewFlight, setFlightExpiry, watchFlightAbilities } from '../core/flight.ts';
import { previewFlightPlan } from '../core/flight-preview.ts';
import * as context from '../core/skill-context.ts';

beforeEach(() => {
  vi.useFakeTimers();
  // Reproduce an 80ms execution tick despite a requested 50ms sleep.
  vi.spyOn(context, 'sleep').mockImplementation(ms => new Promise(resolve => setTimeout(resolve, ms + 30)));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function flightRig() {
  const client = Object.assign(new EventEmitter(), { write: vi.fn() });
  const bot = Object.assign(new EventEmitter(), {
    _client: client,
    entity: { position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), onGround: false },
    physics: { gravity: 0.08 }, physicsEnabled: true,
    clearControlStates() {},
    blockAt: () => ({ name: 'air', shapes: [], boundingBox: 'empty' }),
  }) as unknown as Bot;
  const unwatch = watchFlightAbilities(bot);
  client.emit('abilities', { flags: 4, flyingSpeed: 0.05 });
  return { bot, client, unwatch };
}

async function learnTiming(bot: Bot) {
  const y = bot.entity.position.y + 9;
  const result = flyToPosition(bot, { x: 0.5, y, z: 0.5 }, () => false);
  await vi.runAllTimersAsync();
  expect(await result).toContain(`实际在 (0.5,${y.toFixed(1)},0.5)`);
}

describe('flight duration under runtime scheduling delay', () => {
  it('uses recent executed ticks to avoid repeating an optimistic whole-route budget', async () => {
    const { bot, unwatch } = flightRig();
    const points = [73, 82, 91, 100].map(y => ({ skill: 'flight' as const, at: [0, y, 0] as [number, number, number], land: false }));
    const nominal = previewFlightPlan(bot, points, 21_000);
    expect(nominal.fitsBudget).toBe(true);
    await learnTiming(bot);
    const before = bot.entity.position.clone();
    // Plan the same four nine-block legs from the new observed origin.
    const measured = previewFlightPlan(bot, [82, 91, 100, 109].map((y, i) => ({ ...points[i], at: [0, y, 0] })), 21_000);
    expect(measured.fitsBudget).toBe(false);
    expect(measured.segments[0]).toMatchObject({ timing: { source: 'runtime', tickMs: 80 } });
    expect(measured.estimatedDurationMs).toBe(21_200);
    expect(measured.steps).toBeNull();
    expect(bot.entity.position).toEqual(before);
    unwatch();
  });

  it('applies the observed duration to the actual permission deadline before moving', async () => {
    const { bot, unwatch } = flightRig();
    await learnTiming(bot);
    const before = bot.entity.position.clone();
    setFlightExpiry(bot, Date.now() + 4_500);
    const target = { x: 0.5, y: 82, z: 0.5 };
    expect(previewFlight(bot, target)).toMatchObject({ estimatedDurationMs: 5_300, timeEnough: false });
    await expect(flyToPosition(bot, target, () => false)).rejects.toThrow('飞行剩余时间不足');
    expect(bot.entity.position).toEqual(before);
    unwatch();
  });

  it('drops timing from an old connection, changed speed or expired sample', async () => {
    const { bot, client, unwatch } = flightRig();
    await learnTiming(bot);
    expect(previewFlight(bot, { x: 0.5, y: 82, z: 0.5 })).toMatchObject({ timing: { source: 'runtime' } });
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    expect(previewFlight(bot, { x: 0.5, y: 82, z: 0.5 })).toMatchObject({ timing: { source: 'nominal' } });
    await learnTiming(bot);
    client.emit('abilities', { flags: 4, flyingSpeed: 0.1 });
    expect(previewFlight(bot, { x: 0.5, y: 82, z: 0.5 })).toMatchObject({ timing: { source: 'nominal' } });
    await learnTiming(bot);
    bot.emit('respawn');
    expect(previewFlight(bot, { x: 0.5, y: 82, z: 0.5 })).toMatchObject({ timing: { source: 'nominal' } });
    unwatch();
  });

  it('does not restore old timing when an interrupted flight settles after respawn', async () => {
    const { bot, client, unwatch } = flightRig();
    const done = flyToPosition(bot, { x: 0.5, y: 73, z: 0.5 }, () => false).catch(error => String(error));
    await vi.advanceTimersByTimeAsync(600);
    bot.emit('respawn');
    client.emit('abilities', { flags: 4, flyingSpeed: 0.05 });
    await vi.runAllTimersAsync();
    expect(await done).toContain('连接或维度已变化');
    expect(previewFlight(bot, { x: 0.5, y: 73, z: 0.5 })).toMatchObject({ timing: { source: 'nominal' } });
    unwatch();
  });
});
