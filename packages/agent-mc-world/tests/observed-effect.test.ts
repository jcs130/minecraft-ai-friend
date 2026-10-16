import { expect, it } from 'vitest';
import { sampleEffect, observedEffect } from '../core/observed-effect.ts';
import type { Bot } from 'mineflayer';
import type { EffectSample } from '../src/contracts/observed-effect.ts';

const sample = (): EffectSample => ({ at: new Date().toISOString(), target: { name: 'moss_block', stateId: 123 },
  inventory: { dirt: 3 }, position: [1, 64, 1], window: null });
it('separates unchanged client-visible readback from execution and goal success', () => {
  const e = observedEffect('use', 'overworld', [1, 63, 1], sample(), sample());
  expect(e.status).toBe('unchanged');
  expect(e.changed).toEqual({ target: false, inventory: false, position: false, window: false });
  expect(e.coverage).toBe('client-visible-only'); expect(e.goalVerified).toBe(false);
});
it('records target, inventory, movement and window changes independently', () => {
  const before = sample(), after = sample(); after.target = { name: 'air', stateId: 0 };
  after.inventory = { dirt: 4 }; after.position = [2, 64, 1]; after.window = { id: 4, type: 'chest' };
  expect(observedEffect('use', 'overworld', [1, 63, 1], before, after).changed)
    .toEqual({ target: true, inventory: true, position: true, window: true });
});
it('keeps missing reads unknown even when all available domains are unchanged', () => {
  const after = sample(); after.target = null; after.inventory = null; delete after.window;
  const e = observedEffect('use', 'overworld', [1, 63, 1], sample(), after);
  expect(e.status).toBe('unknown'); expect(e.changed.target).toBeNull(); expect(e.changed.inventory).toBeNull();
});
it('samples physical stack totals and keeps missing or unloaded fields null', () => {
  const bot = { entity: { position: { x: 1, y: 64, z: 1 } }, currentWindow: null,
    inventory: { items: () => [{ name: 'dirt', count: 3 }, { name: 'dirt', count: 4 }] }, blockAt: () => null } as unknown as Bot;
  expect(sampleEffect(bot, [1, 63, 1]).inventory).toEqual({ dirt: 7 });
  expect(sampleEffect(bot, [1, 63, 1]).target).toBeNull();
  const unavailable = sampleEffect({} as Bot, [1, 63, 1]);
  expect(unavailable.inventory).toBeNull(); expect(unavailable.position).toBeNull(); expect(unavailable.window).toBeUndefined();
});
