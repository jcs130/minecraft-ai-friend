import { describe, expect, it, vi } from 'vitest';
import { unwedgeBody } from '../core/travel.ts';
import { Aborted, type SkillContext } from '../core/skill-context.ts';
import { methodHarness } from './method-harness.ts';

const context = (aborted = () => false) => ({ aborted } as SkillContext);
// The first real physics tick can clear onGround before the next tick settles it.
// Wall-clock warmup does not establish readiness when callbacks are delayed.
const settledGround = (r: ReturnType<typeof methodHarness>) => new Promise<void>((resolve, reject) => {
  const cleanup = () => { clearTimeout(timeout); r.bot.off('physicsTick', check); };
  const check = () => {
    if (r.bot.physicsEnabled && r.bot.entity.onGround && r.bot.entity.position.y === 64) {
      cleanup(); resolve();
    }
  };
  const timeout = setTimeout(() => { cleanup(); reject(new Error('fixture did not reach grounded physics')); }, 2000);
  r.bot.on('physicsTick', check);
});

describe('unsticking uses supported ground and releases controls', () => {
  it('waits for actual grounded physics when the next physics callback is delayed', async () => {
    vi.useFakeTimers();
    const r = methodHarness();
    try {
      let ready = false;
      const waiting = settledGround(r).then(() => { ready = true; });
      await vi.advanceTimersByTimeAsync(50);
      expect(r.bot.entity.onGround).toBe(false);
      r.bot.physicsEnabled = false;
      await vi.advanceTimersByTimeAsync(150);
      expect(ready).toBe(false);
      r.bot.physicsEnabled = true;
      await vi.advanceTimersByTimeAsync(100);
      await waiting;
      expect(ready).toBe(true);
      expect(r.bot.entity.onGround).toBe(true);
      expect(r.bot.entity.position.y).toBe(64);
    } finally { r.close(); vi.useRealTimers(); }
  });
  it('does not jump or retreat from a one-block island over a deep shaft', async () => {
    const r = methodHarness();
    try {
      for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
        if (x === 0 && z === 0) continue;
        for (let y = 35; y < 64; y++) r.set(x, y, z, 'air');
      }
      const from = r.bot.entity.position.clone(), pressed: string[] = [];
      const control = r.bot.setControlState.bind(r.bot);
      r.bot.setControlState = (key, value) => { if (value) pressed.push(key); control(key, value); };
      expect(await unwedgeBody(r.bot as never, context())).toBe(0);
      expect(pressed).toEqual([]);
      expect(r.bot.entity.position).toEqual(from);
      expect(Object.values(r.keys).some(Boolean)).toBe(false);
    } finally { r.close(); }
  });

  it('still moves on loaded flat ground using real Minecraft physics', async () => {
    const r = methodHarness();
    try {
      await settledGround(r);
      const moved = await unwedgeBody(r.bot as never, context());
      expect(moved).toBeGreaterThan(0.2);
      expect(moved).toBeLessThan(1.6);
      expect(r.bot.entity.position.y).toBe(64);
      expect(r.bot.entity.onGround).toBe(true);
      expect(Object.values(r.keys).some(Boolean)).toBe(false);
    } finally { r.close(); }
  });

  it('cancelling in the middle of a movement releases every control key', async () => {
    const r = methodHarness(); let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await settledGround(r);
      const control = r.bot.setControlState.bind(r.bot);
      r.bot.setControlState = (key, value) => {
        control(key, value);
        if (key === 'back' && value) timer = setTimeout(() => { cancelled = true; }, 40);
      };
      await expect(unwedgeBody(r.bot as never, context(() => cancelled))).rejects.toBeInstanceOf(Aborted);
      expect(cancelled).toBe(true);
      expect(Object.values(r.keys).some(Boolean)).toBe(false);
      expect(r.bot.entity.position.y).toBe(64);
    } finally { clearTimeout(timer); r.close(); }
  });

  it('releases movement when previously loaded support disappears', async () => {
    const r = methodHarness(); let removed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await settledGround(r);
      const control = r.bot.setControlState.bind(r.bot);
      r.bot.setControlState = (key, value) => {
        control(key, value);
        if (key === 'back' && value) timer = setTimeout(() => {
          removed = true;
          for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
            if (x === 0 && z === 0) continue;
            for (let y = 35; y < 64; y++) r.set(x, y, z, 'air');
          }
        }, 20);
      };
      await unwedgeBody(r.bot as never, context());
      expect(removed).toBe(true);
      expect(r.bot.entity.position.y).toBe(64);
      expect(r.bot.entity.onGround).toBe(true);
      expect(Object.values(r.keys).some(Boolean)).toBe(false);
    } finally { clearTimeout(timer); r.close(); }
  });

  it('does not guess footing in an unloaded area or water corridor', async () => {
    const r = methodHarness();
    try {
      const read = r.bot.blockAt;
      r.bot.blockAt = () => null as never;
      expect(await unwedgeBody(r.bot as never, context())).toBe(0);
      r.bot.blockAt = read;
      for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
        if (x === 0 && z === 0) continue;
        r.set(x, 64, z, 'water'); r.set(x, 65, z, 'water');
      }
      expect(await unwedgeBody(r.bot as never, context())).toBe(0);
      expect(Object.values(r.keys).some(Boolean)).toBe(false);
    } finally { r.close(); }
  });
});
