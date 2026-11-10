import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { rideDrive, useBoat } from '../core/skills-interact.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.useRealTimers());

it.each(['one', 'none', 'ambiguous', 'removed'] as const)('reports a newly observed boat identity without substituting an old boat: %s', async mode => {
  vi.useFakeTimers(); const h = methodHarness('1.21.1');
  let count = 1;
  const boat = (id: number) => ({ id, name: 'boat', isValid: true, position: new Vec3(1.5, 64, .5) });
  Object.assign(h.bot, { lookAt: vi.fn(async () => {}), waitForTicks: vi.fn(async () => {}) });
  h.bot.inventory.items = (() => count ? [{ name: 'spruce_boat', count, type: h.bot.registry.itemsByName.spruce_boat.id }] : []) as never;
  Object.assign(h.bot.entities, { 8: boat(8) });
  try {
    const result = useBoat(h.bot as unknown as Bot, { x: 1, y: 64, z: 0 }, 'spruce_boat', '云杉木船', async () => {
      count = 0;
      if (mode !== 'none') Object.assign(h.bot.entities, { 9: { ...boat(9), isValid: mode !== 'removed' } });
      if (mode === 'ambiguous') Object.assign(h.bot.entities, { 10: boat(10) });
    });
    await vi.advanceTimersByTimeAsync(1000);
    const text = await result;
    expect(text).toContain('1 → 0');
    if (mode === 'one') {
      expect(text).toContain('entityId=9');
      expect(text).toContain('"entityId":9');
    } else {
      expect(text).toMatch(/未确认|不能确认/);
      expect(text).not.toContain('"entityId":');
    }
    expect(text).not.toContain('entityId=8');
  } finally { h.close(); }
});

it('stops at a real boat hull obstacle while keeping the rider aboard and releasing the correction listener', async () => {
  const h = methodHarness('1.21.1'); h.bot.physicsEnabled = false;
  const vehicle = { id: 9, name: 'boat', isValid: true, position: new Vec3(.5, 64, .5), width: 1.4, height: .6 };
  const dismount = vi.fn(() => { (h.bot as any).vehicle = null; });
  Object.assign(h.bot, { vehicle, dismount });
  for (let z = -2; z <= 2; z++) for (let y = 64; y <= 68; y++) h.set(1, y, z, 'stone');
  const before = h.bot._client.listenerCount('vehicle_move');
  try {
    await expect(rideDrive(h.bot as unknown as Bot, { aborted: () => false } as never, { x: 8, y: 64, z: 0 }))
      .rejects.toThrow(/停在/);
    expect(dismount).not.toHaveBeenCalled();
    expect((h.bot as any).vehicle).toBe(vehicle);
    expect(h.bot._client.listenerCount('vehicle_move')).toBe(before);
  } finally { h.close(); }
});
