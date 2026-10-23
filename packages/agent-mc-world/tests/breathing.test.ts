import type { Bot } from 'mineflayer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { breathingReadout, installBreathingReadings } from '../core/breathing.ts';
import { methodHarness } from './method-harness.ts';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T08:00:00Z')); });
afterEach(() => vi.useRealTimers());
const fixtures: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const h of fixtures.splice(0)) h.close(); });
function rig() { const h = methodHarness('1.21.1'); fixtures.push(h); return { ...h, live: h.bot as unknown as Bot }; }

it('keeps sampling time separate from received oxygen and health update times', async () => {
  const h = rig(), dispose = installBreathingReadings(h.live);
  expect(breathingReadout(h.live)).toMatchObject({ oxygen: 20, oxygenUpdatedAt: null, healthUpdatedAt: null });
  h.live.emit('breath'); h.live.emit('health');
  const first = breathingReadout(h.live);
  await vi.advanceTimersByTimeAsync(1000);
  h.live.oxygenLevel = 18; h.live.emit('breath');
  const next = breathingReadout(h.live);
  expect(next.oxygenUpdatedAt).toBe(next.sampledAt);
  expect(next.healthUpdatedAt).toBe(first.healthUpdatedAt);
  expect(Date.parse(next.sampledAt) - Date.parse(first.sampledAt)).toBe(1000);
  h.live.emit('respawn');
  expect(breathingReadout(h.live)).toMatchObject({ oxygen: 18, oxygenUpdatedAt: null, healthUpdatedAt: null });
  dispose(); expect(h.live.listenerCount('breath')).toBe(0);
});

it.each([undefined, Number.NaN, 303, -1])('does not turn invalid oxygen %s into full oxygen', value => {
  const h = rig(); h.live.oxygenLevel = value as number;
  expect(breathingReadout(h.live).oxygen).toBeNull();
});

it('reports actual water and motion while preserving unknown loaded blocks', () => {
  const h = rig(); h.live.physicsEnabled = false;
  h.set(0, 64, 0, 'tall_seagrass'); h.set(0, 65, 0, 'water');
  h.live.entity.velocity = new Vec3(0, -.1, 0);
  expect(breathingReadout(h.live)).toMatchObject({ headWet: true, bodyWet: true, velocity: { y: -.1 } });
  h.live.blockAt = () => null;
  expect(breathingReadout(h.live)).toMatchObject({ headWet: null, bodyWet: null });
});

it('attaches only once and disposes with the original connection', () => {
  const h = rig(); const before = h.live.listenerCount('breath');
  const dispose = installBreathingReadings(h.live);
  expect(installBreathingReadings(h.live)).toBe(dispose);
  breathingReadout(h.live); breathingReadout(h.live);
  expect(h.live.listenerCount('breath')).toBe(before + 1);
  h.live.emit('end', 'test');
  expect(h.live.listenerCount('breath')).toBe(before);
});
it('gives a reconnected observation a new identity even when realm, entity id and epoch repeat',()=>{
  const first=rig(),second=rig();
  const a=breathingReadout(first.live),b=breathingReadout(second.live);
  expect(a.entityId).toBe(b.entityId);expect(a.observationEpoch).toBe(b.observationEpoch);
  expect(a.observationId).not.toBe(b.observationId);
  first.live.emit('respawn');expect(breathingReadout(first.live).observationId).toBe(a.observationId);
});

it('keeps damage separate from healing and resets both counters on respawn', () => {
  const h = rig(); installBreathingReadings(h.live);
  h.live.health = 15; h.live.emit('health'); h.live.health = 19; h.live.emit('health');
  expect(breathingReadout(h.live)).toMatchObject({ health: 19, healthLoss: 5, healthRecovered: 4, observationEpoch: 0 });
  h.live.emit('respawn');
  expect(breathingReadout(h.live)).toMatchObject({ healthLoss: 0, healthRecovered: 0, observationEpoch: 1 });
});
