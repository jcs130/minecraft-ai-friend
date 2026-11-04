import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Reflexes } from '../core/executor.ts';
import { methodHarness } from './method-harness.ts';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T16:52:12Z')); });
afterEach(() => vi.useRealTimers());

function rig(fightBack = () => true, combatHurt = vi.fn(() => true)) {
  const h = methodHarness('1.21.1');
  Object.assign(h.bot, { isAlive: true, physicsEnabled: false, lookAt: vi.fn(async () => {}) });
  Object.assign(h.bot.entity, { metadata: [1] });
  Object.assign(h.bot.world, { getColumn: () => ({}) });
  const pause = vi.fn((why: string) => h.exec.pauseForEnvironment(why));
  const reports: string[] = [];
  const reflex = new Reflexes({ getBot: () => h.bot as unknown as Bot, report: r => reports.push(r.text), log: h.host.log,
    preempt: why => h.exec.preempt(why), pauseEnvironment: pause,
    resumeEnvironment: token => h.exec.resumeAfterEnvironment(token), stopFallTask: why => h.exec.stopCurrent(why),
    resumeAfterFall: token => h.exec.resumeQueue(token), escapeActive: () => false,
    fightBack, combatHurt, fleeHealth: () => 6, reactCooldownSec: () => 10,
    antiDrown: () => false, antiLava: () => true,
  });
  reflex.start();
  return { ...h, reflex, pause, reports, combatHurt, close() { reflex.stop(); h.close(); } };
}

it('honors live retaliation choice while retaining low-health escape', async () => {
  let enabled = false;
  const r = rig(() => enabled);
  try {
    const enemy = { id: 7, name: 'blaze', isValid: true, position: new Vec3(3, 64, .5), height: 1.8 };
    (r.bot.entities as any)[7] = enemy;
    const evidence = { origin: 'packet', sequence: 1, actor: { id: 7, name: 'blaze', entity: enemy },
      sourceType: 'fireball', causeId: 7, directId: 8, projectile: true, sourcePosition: enemy.position };
    await (r.reflex as any).onHurt(r.bot, evidence);
    expect(r.combatHurt).not.toHaveBeenCalled();
    expect(r.bot.pathfinder.goal).toBeNull();
    enabled = true;
    await (r.reflex as any).onHurt(r.bot, evidence);
    expect(r.combatHurt).toHaveBeenCalledTimes(1);
    enabled = false; r.bot.health = 3;
    await (r.reflex as any).onHurt(r.bot, evidence);
    expect(r.combatHurt).toHaveBeenCalledTimes(1);
    expect(r.bot.pathfinder.goal).not.toBeNull();
  } finally { r.close(); }
});

it.each(['fire', 'lava', 'soul_fire'])('a burning body near %s does not cancel combat or eating without actual contact', async name => {
  const r = rig();
  try {
    r.set(2, 64, 0, name); // Within the old 3-block radius, outside the body.
    await vi.advanceTimersByTimeAsync(1500);
    expect(r.pause).not.toHaveBeenCalled();
    expect(r.reflex.envActive).toBe(false);
    expect(r.bot.pathfinder.goal).toBeNull();
    expect(r.keys.forward).toBe(false);
  } finally { r.close(); }
});

it.each(['fire', 'lava'])('still rescues real %s contact, then releases even with a nearby hazard and residual burning', async name => {
  const r = rig();
  try {
    r.set(0, 64, 0, name);
    r.set(2, 64, 0, name);
    await vi.advanceTimersByTimeAsync(200);
    expect(r.reflex.envActive).toBe(true);
    expect(r.pause).toHaveBeenCalledTimes(1);
    r.set(0, 64, 0, 'air');
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.reflex.envActive).toBe(false);
    expect(r.keys.forward).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.pause).toHaveBeenCalledTimes(1);
  } finally { r.close(); }
});
