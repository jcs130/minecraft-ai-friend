import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Reflexes } from '../core/executor.ts';
import { headInWater } from '../core/terrain.ts';
import { hasDryFooting } from '../core/skills-build.ts';
import { methodHarness } from './method-harness.ts';
import { installTreadWater } from '../core/travel.ts';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T00:43:00Z')); });
afterEach(() => vi.useRealTimers());

function rescue(options: { passive?: boolean; emergency?: boolean } = {}) {
  let waterAscent = options.passive ?? true;
  let emergency = options.emergency;
  const h = methodHarness('1.21.1');
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    for (let y = 64; y <= 66; y++) h.set(x, y, z, 'water');
    h.set(x, 67, z, 'stone');
  }
  // One nearby breathing column and a further alternative, both actual water/air blocks.
  for (const z of [-2, -4]) h.set(0, 67, z, 'air');
  h.bot.entity.position = new Vec3(.5, 65.2, .5);
  h.bot.entity.onGround = false;
  h.bot.oxygenLevel = 0;
  h.bot.physicsEnabled = false; // Replay the measured, blocked live coordinates, not invented navigation.
  Object.assign(h.bot.pathfinder, { isMoving: () => false });
  const detachTread = options.passive === false
    ? installTreadWater(h.bot as unknown as Bot, () => waterAscent) : () => {};
  const reports: Array<{ text: string }> = [], diagnostics: Array<{ event: string; data?: unknown }> = [];
  const reflexes = new Reflexes({
    getBot: () => h.bot as unknown as Bot,
    report: r => reports.push(r), log: h.host.log,
    preempt: why => h.exec.preempt(why),
    pauseEnvironment: why => h.exec.pauseForEnvironment(why),
    resumeEnvironment: token => h.exec.resumeAfterEnvironment(token),
    stopFallTask: why => h.exec.stopCurrent(why), resumeAfterFall: token => h.exec.resumeQueue(token),
    escapeActive: () => false, fightBack: () => false, fleeHealth: () => 6,
    reactCooldownSec: () => 10, antiDrown: () => waterAscent, antiLava: () => false,
    ...(emergency === undefined ? {} : { emergencyDrown: () => emergency! }),
    diag: { write: row => diagnostics.push(row) } as never,
  });
  reflexes.start();
  return { ...h, reflexes, reports, diagnostics, disableAscent() { waterAscent = false; },
    disableEmergency() { emergency = false; },
    close() { reflexes.stop(); detachTread(); h.close(); } };
}

it('keeps ordinary diving input free but starts critical rescue with passive ascent disabled', async () => {
  const r = rescue({ passive: false, emergency: true });
  try {
    r.bot.oxygenLevel = 20;
    await vi.advanceTimersByTimeAsync(2300);
    expect(r.keys.jump).toBe(false);
    expect(r.reflexes.envActive).toBe(false);
    r.bot.oxygenLevel = 3;
    await vi.advanceTimersByTimeAsync(200);
    expect(r.reflexes.environmentOwnerKind).toBe('drown');
    await vi.advanceTimersByTimeAsync(200);
    expect(r.keys.jump).toBe(true);
    expect(r.bot.pathfinder.goal).not.toBeNull();
  } finally { r.close(); }
});

it('reacts to paired underwater damage before the timer while passive ascent is disabled', async () => {
  const r = rescue({ passive: false, emergency: true });
  try {
    r.bot.oxygenLevel = 20;
    await vi.advanceTimersByTimeAsync(200);
    r.bot._client.emit('damage_event', { entityId: 1, nativeDecodedIds: true,
      nativeSourceType: 'minecraft:drown', sourceTypeId: 0, sourceCauseId: -1, sourceDirectId: -1 });
    r.bot.health = 18; r.bot.emit('health');
    await vi.advanceTimersByTimeAsync(200);
    expect(r.reflexes.environmentOwnerKind).toBe('drown');
    expect(r.diagnostics.some(row => row.event === 'drown-trigger')).toBe(true);
    expect(r.keys.jump).toBe(true);
  } finally { r.close(); }
});

it('honors explicit emergency disable and releases only its rescue ownership', async () => {
  const r = rescue({ passive: false, emergency: true });
  try {
    await vi.advanceTimersByTimeAsync(2300);
    expect(r.reflexes.environmentOwnerKind).toBe('drown');
    r.disableEmergency();
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.reflexes.envActive).toBe(false);
    expect(r.keys.jump).toBe(false);
    expect(r.bot.pathfinder.goal).toBeNull();
    expect(r.diagnostics.some(row => row.event === 'drown-disabled')).toBe(true);
  } finally { r.close(); }
});

it('interrupts a water control segment, clears its input, and does not replay it after measured safe footing', async () => {
  const r = rescue({ passive: false, emergency: true });
  try {
    r.bot.physicsEnabled = true;
    r.bot.entity.yaw = Math.PI; // Keep this segment beneath the roof, away from the breathing openings.
    r.bot.oxygenLevel = 20;
    r.exec.submit([{ skill: 'control', mode: 'water', keys: ['forward'], durationMs: 8000 },
      { skill: 'chat', text: 'after rescue' }], 'append');
    await vi.advanceTimersByTimeAsync(2300);
    expect(r.keys.forward).toBe(true);
    r.bot.oxygenLevel = 3;
    await vi.advanceTimersByTimeAsync(400);
    expect(r.reflexes.environmentOwnerKind).toBe('drown');
    expect(r.keys.forward).toBe(false);
    expect(r.said).not.toContain('after rescue');
    r.bot.entity.position = new Vec3(.5, 68, .5);
    r.bot.entity.onGround = true; r.bot.oxygenLevel = 20;
    await vi.advanceTimersByTimeAsync(2500);
    expect(r.reflexes.envActive).toBe(false);
    expect(r.keys.forward).toBe(false);
    expect(r.said.filter(text => text === 'after rescue')).toHaveLength(1);
  } finally { r.close(); }
});

it('releases a running drowning reflex and its queue hold on live disable while still underwater', async () => {
  const r = rescue();
  try {
    await vi.advanceTimersByTimeAsync(2300);
    expect(r.reflexes.environmentOwnerKind).toBe('drown');
    expect(r.bot.pathfinder.goal).not.toBeNull();
    r.disableAscent();
    await vi.advanceTimersByTimeAsync(200);
    expect(r.reflexes.envActive).toBe(false);
    expect(r.bot.pathfinder.goal).toBeNull();
    expect(r.keys.jump).toBe(false);
    expect(r.diagnostics.some(row => row.event === 'drown-disabled')).toBe(true);
    r.exec.submit([{ skill: 'chat', text: 'queue released' }], 'append');
    await vi.advanceTimersByTimeAsync(200);
    expect(r.said).toContain('queue released');
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.reflexes.envActive).toBe(false);
    expect(r.keys.jump).toBe(false);
  } finally { r.close(); }
});

it('rejects the same water rescue target after recorded collision oscillation instead of renewing it forever', async () => {
  const r = rescue();
  try {
    await vi.advanceTimersByTimeAsync(2300);
    const first = r.bot.pathfinder.goal;
    expect(first).not.toBeNull();
    // The live body oscillated x=-558.31..-557.84, y=61.2, z=-385.51..-385.30 for hours.
    const samples = [[.19, .7], [.66, .49], [.25, .7], [.5, .49]];
    for (let i = 0; i < 60; i++) {
      const [x, z] = samples[i % samples.length];
      r.bot.entity.position = new Vec3(x, 65.2, z);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(r.diagnostics.some(row => row.event === 'escape-goal-stalled')).toBe(true);
    expect(r.bot.pathfinder.goal).not.toBe(first);
    expect(r.reports.some(row => row.text.includes('换一个目标'))).toBe(true);
  } finally { r.close(); }
});

it('keeps an advancing rescue route across the old eight-second refresh boundary', async () => {
  const r = rescue();
  try {
    await vi.advanceTimersByTimeAsync(2300);
    const first = r.bot.pathfinder.goal;
    for (let i = 1; i <= 45; i++) {
      r.bot.entity.position = new Vec3(.5 + i * .03, 65.2, .5);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(r.bot.pathfinder.goal).toBe(first);
    expect(r.diagnostics.filter(row => row.event === 'drown-breath')).toHaveLength(1);
  } finally { r.close(); }
});

it('bounds a looping rescue even when repeated movement is large enough to look like progress', async () => {
  const r = rescue();
  try {
    await vi.advanceTimersByTimeAsync(2300);
    for (let i = 0; i < 240; i++) {
      r.bot.entity.position = new Vec3(i % 2 ? 1.2 : .5, 65.2, .5);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(r.diagnostics).toContainEqual(expect.objectContaining({
      event: 'escape-goal-stalled', data: expect.objectContaining({ expired: true }),
    }));
  } finally { r.close(); }
});

it.each([{}, { passive: false, emergency: true }])('uses real 1.21.1 pathfinder and physics to leave roofed water with switches %j', async options => {
  const r = rescue(options);
  try {
    r.bot.physicsEnabled = true;
    Object.assign(r.bot, {
      supportFeature: (name: string) => r.bot.registry.supportFeature(name),
      getControlState: (key: string) => r.keys[key],
      isAlive: true,
    });
    // A genuinely open side of the pool; there is no teleport or coordinate advancement.
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= -3; z++) {
      for (let y = 64; y <= 67; y++) r.set(x, y, z, 'air');
    }
    pathfinderPkg.pathfinder(r.bot as unknown as Bot);
    r.bot.pathfinder.movements.canDig = false;
    r.bot.pathfinder.movements.allowParkour = false;
    r.bot.pathfinder.thinkTimeout = 100;
    r.bot.pathfinder.tickTimeout = 5;
    for (let i = 0; i < 25; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      if (!r.reflexes.envActive && hasDryFooting(r.bot as unknown as Bot)) break;
    }
    expect(headInWater(r.bot as unknown as Bot), JSON.stringify({ at: r.bot.entity.position, last: r.diagnostics.slice(-5) })).toBe(false);
    expect(hasDryFooting(r.bot as unknown as Bot)).toBe(true);
    expect(r.reflexes.envActive).toBe(false);
  } finally { r.close(); }
}, 15_000);
