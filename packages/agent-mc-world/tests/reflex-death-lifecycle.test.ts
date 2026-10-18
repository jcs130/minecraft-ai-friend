import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Reflexes } from '../core/executor.ts';
import { methodHarness } from './method-harness.ts';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T00:00:00Z')); });
afterEach(() => vi.useRealTimers());

function body() {
  const h = methodHarness('1.21.1');
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    for (let y = 64; y <= 66; y++) h.set(x, y, z, 'water');
    h.set(x, 67, z, 'stone');
  }
  h.set(0, 67, -2, 'air');
  h.bot.entity.position = new Vec3(.5, 65.2, .5);
  h.bot.entity.onGround = false;
  h.bot.oxygenLevel = 0;
  h.bot.physicsEnabled = false;
  const bot = Object.assign(h.bot, { isAlive: true });
  const reports: Array<{ text: string }> = [];
  const reflexes = new Reflexes({
    getBot: () => bot as unknown as Bot, report: r => reports.push(r), log: h.host.log,
    preempt: why => h.exec.preempt(why), pauseEnvironment: why => h.exec.pauseForEnvironment(why),
    resumeEnvironment: token => h.exec.resumeAfterEnvironment(token),
    stopFallTask: why => h.exec.stopCurrent(why), resumeAfterFall: token => h.exec.resumeQueue(token),
    escapeActive: () => false, fightBack: () => false, fleeHealth: () => 6,
    reactCooldownSec: () => 10, antiDrown: () => true, antiLava: () => false,
  });
  reflexes.start();
  return { ...h, bot, reflexes, reports, close() { reflexes.stop(); h.close(); } };
}

it.each([['zero health', 0, true], ['respawn life flag', 20, false]] as const)(
  'does not start water rescue for %s', async (_, health, alive) => {
    const r = body();
    try {
      r.bot.health = health;
      r.bot.isAlive = alive;
      await vi.advanceTimersByTimeAsync(3000);
      expect(r.reflexes.envActive).toBe(false);
      expect(r.bot.pathfinder.goal).toBeNull();
      expect(r.keys.jump).toBe(false);
      expect(r.reports).toHaveLength(0);
    } finally { r.close(); }
  });

it('retires the dead rescue without calling respawn its success, then protects the new life', async () => {
  const r = body();
  try {
    await vi.advanceTimersByTimeAsync(2300);
    expect(r.reflexes.envActive).toBe(true);
    expect(r.bot.pathfinder.goal).not.toBeNull();
    r.bot.health = 0;
    r.bot.isAlive = false;
    r.bot.emit('death');
    const before = r.reports.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.reflexes.envActive).toBe(false);
    expect(r.bot.pathfinder.goal).toBeNull();
    expect(r.keys.jump).toBe(false);
    expect(r.reports.slice(before)).toHaveLength(0);
    r.bot.entity.position = new Vec3(.5, 68, .5);
    r.bot.entity.onGround = true;
    r.bot.health = 20;
    r.bot.isAlive = true;
    r.bot.oxygenLevel = 20;
    r.bot.emit('spawn');
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.reports.slice(before).some(row => row.text.includes('自救结束'))).toBe(false);
    r.bot.entity.position = new Vec3(.5, 65.2, .5);
    r.bot.entity.onGround = false;
    r.bot.oxygenLevel = 0;
    await vi.advanceTimersByTimeAsync(2300);
    expect(r.reflexes.envActive).toBe(true);
    expect(r.keys.jump).toBe(true);
  } finally { r.close(); }
});
