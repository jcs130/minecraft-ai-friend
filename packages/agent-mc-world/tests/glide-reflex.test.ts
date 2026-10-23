import { afterEach, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { Reflexes } from '../core/executor.ts';

afterEach(() => vi.useRealTimers());
function harness() {
  const token = { kind: 'fall', id: 7 };
  const stop = vi.fn(() => token), resume = vi.fn(() => true);
  const bot = {
    health: 20,
    entity: { position: new Vec3(.5, 100, .5), velocity: new Vec3(0, -.2, 0),
      onGround: false, elytraFlying: false, metadata: [] },
    blockAt: (p: Vec3) => ({ name: p.y < 64 ? 'stone' : 'air',
      boundingBox: p.y < 64 ? 'block' : 'empty', position: p.floored() }),
    pathfinder: { goal: null, setGoal: vi.fn() },
    clearControlStates: vi.fn(),
  };
  const reflex = new Reflexes({ stopFallTask: stop, resumeAfterFall: resume,
    report: vi.fn(), getBot: () => bot } as any);
  const sample = (y: number, gliding = false, grounded = false) => {
    bot.entity.position.y = y; bot.entity.elytraFlying = gliding;
    bot.entity.onGround = grounded; bot.entity.velocity.y = grounded ? 0 : -.2;
    (reflex as any).watchFall(bot);
  };
  return { reflex, stop, resume, token, sample };
}
it('clears pre-launch fall tracking during confirmed glide and does not count a glide landing as deep free fall', () => {
  const h = harness(); h.sample(100); h.sample(98, true); h.sample(80, true); h.sample(64, false, true);
  expect(h.stop).not.toHaveBeenCalled(); expect((h.reflex as any).fall).toBeNull();
});
it('resumes normal deep-fall detection from the actual loss of gliding, not from the launch height', () => {
  const h = harness(); h.sample(100, true); h.sample(80, true);
  h.sample(79); h.sample(74); expect(h.stop).not.toHaveBeenCalled();
  h.sample(72); expect(h.stop).toHaveBeenCalledOnce();
});
it('preserves a genuine fall hold through a later glide and only releases it after stable safe footing', () => {
  vi.useFakeTimers(); const h = harness(); h.sample(100); h.sample(93);
  expect(h.stop).toHaveBeenCalledOnce(); h.sample(82, true);
  expect((h.reflex as any).fall.hold).toBe(h.token); expect(h.resume).not.toHaveBeenCalled();
  h.sample(64, false, true); expect(h.resume).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000); h.sample(64, false, true);
  expect(h.resume).toHaveBeenCalledWith(h.token); expect((h.reflex as any).fall).toBeNull();
});
