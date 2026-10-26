import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { BowController, type BowEvent, type RangedTarget } from '../core/ranged.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture(distance: number, height = 1.95, y = 64) {
  const bow = { name: 'bow', type: 2, count: 1 };
  const arrow = { name: 'arrow', type: 3, count: 15 };
  const target: RangedTarget = { id: 7, position: new Vec3(distance, y, 0), height, width: 0.6 };
  const events: BowEvent[] = [];
  const b = {
    entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62, velocity: new Vec3(0, 0, 0) },
    heldItem: bow, quickBarSlot: 0, usingHeldItem: false,
    inventory: { items: () => [bow, arrow], hotbarStart: 36, slots: Array(45).fill(null) },
    equip: vi.fn(async () => { b.heldItem = bow; }),
    lookAt: vi.fn(async (_point: Vec3) => {}),
    activateItem: vi.fn(() => { b.usingHeldItem = true; }),
    deactivateItem: vi.fn(() => { b.usingHeldItem = false; }),
    setQuickBarSlot: vi.fn((slot: number) => { b.quickBarSlot = slot; b.usingHeldItem = false; }),
    world: { raycast: vi.fn((): unknown => null) },
  };
  b.inventory.slots[36] = bow;
  let lease = true;
  const controller = new BowController({ getBot: () => b as unknown as Bot, resolveTarget: () => target,
    leaseValid: () => lease, emit: event => events.push(event) });
  return { bot: b, target, controller, events, cancelLease: () => { lease = false; } };
}

describe('short-range bow safety versus preferred weapon distance', () => {
  it.each([
    [0.6, 1.95, 64], [1, 1.95, 64], [2.7, 1.95, 64], [5.5, 1.95, 64],
    [2, 0.5, 64], [2, 1.95, 65],
  ])('releases a valid visible shot at distance %s, height %s, feet %s', async (distance, height, y) => {
    const f = fixture(distance, height, y);
    const shot = f.controller.shoot(f.target, 'combat');
    await vi.advanceTimersByTimeAsync(1100);
    const result = await shot;
    expect(result.kind).toBe('released');
    expect(f.bot.deactivateItem).toHaveBeenCalledTimes(1);
    expect(f.bot.setQuickBarSlot).not.toHaveBeenCalled();
    if (result.kind !== 'released') return;
    // At these distances the arrow crosses the target during the first two
    // native physics ticks. Check the trajectory against its actual hitbox,
    // including the 0.1-block eye-to-arrow spawn offset, not a range constant.
    const aim = result.aim.minus(new Vec3(0, 65.62, 0)).normalize();
    let pos = new Vec3(0, 65.52, 0), velocity = aim.scaled(3), hit = false;
    for (let tick = 0; tick < 3; tick++) {
      const fraction = (distance - pos.x) / velocity.x;
      if (fraction >= 0 && fraction <= 1) {
        const at = pos.plus(velocity.scaled(fraction));
        hit = at.y >= y && at.y <= y + height && Math.abs(at.z) <= 0.3;
        break;
      }
      pos = pos.plus(velocity); velocity = velocity.scaled(0.99); velocity.y -= 0.05;
    }
    expect(hit).toBe(true);
  });

  it('does not abort a valid draw merely because the hostile crosses 5.5 blocks', async () => {
    const f = fixture(8), shot = f.controller.shoot(f.target);
    await vi.advanceTimersByTimeAsync(200);
    f.target.position = new Vec3(2, 64, 0);
    await vi.advanceTimersByTimeAsync(900);
    expect((await shot).kind).toBe('released');
    expect(f.bot.deactivateItem).toHaveBeenCalledTimes(1);
  });

  it.each(['occluded', 'lease', 'abort'] as const)('still cancels a close draw on %s without releasing an arrow', async reason => {
    const f = fixture(2), shot = f.controller.shoot(f.target);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.bot.activateItem).toHaveBeenCalledTimes(1);
    if (reason === 'occluded') f.bot.world.raycast.mockReturnValue({ name: 'stone' });
    if (reason === 'lease') f.cancelLease();
    if (reason === 'abort') f.controller.abort();
    await vi.advanceTimersByTimeAsync(900);
    expect((await shot).kind).toBe('blocked');
    expect(f.bot.deactivateItem).not.toHaveBeenCalled();
    expect(f.bot.setQuickBarSlot).toHaveBeenCalledTimes(1);
    expect(f.events.some(event => event.kind === 'released')).toBe(false);
    expect(f.controller.active).toBe(false);
  });
});
