import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { installNativeBodyReadiness, nativeBodyBlockedReason, nativeBodyReadiness } from '../core/body-readiness.ts';

afterEach(() => vi.useRealTimers());
function rig() {
  vi.useFakeTimers();
  const bot = Object.assign(new EventEmitter(), { _client: Object.assign(new EventEmitter(), { state: 'play' }),
    health: 35, physicsEnabled: true, entity: { position: { x: -645, y: 67, z: -454 } } });
  const observer = installNativeBodyReadiness(bot);
  const land = () => { bot._client.emit('position', {}); bot.emit('physicsTick'); };
  return { bot, observer, land };
}
it('does not promote positive health/spawn at the old death position to a recovered body', () => {
  const r = rig(); r.land(); expect(r.observer.read().phase).toBe('ready');
  r.bot.emit('death'); r.bot.emit('respawn'); r.bot.emit('spawn'); r.bot.emit('health');
  expect(r.observer.read()).toMatchObject({ phase: 'waiting-position', positionAt: null, physicsAt: null });
  expect(nativeBodyBlockedReason(r.bot, 'goto')).toContain('旧坐标不是当前落点');
  expect(nativeBodyBlockedReason(r.bot, 'chat')).toBeNull();
  r.bot.emit('physicsTick'); expect(r.observer.read().phase).toBe('waiting-position');
  r.bot._client.emit('position', {}); expect(r.observer.read().phase).toBe('waiting-physics');
  r.bot.emit('physicsTick'); expect(r.observer.read().phase).toBe('ready'); r.observer.dispose();
});
it('expires physics liveness on wall time even when no physics callbacks occur', async () => {
  const r = rig(); r.land(); await vi.advanceTimersByTimeAsync(5001);
  expect(r.observer.read().phase).toBe('waiting-physics');
  expect(nativeBodyBlockedReason(r.bot)).toContain('物理更新尚未恢复或已经中断');
  r.bot.emit('physicsTick'); expect(r.observer.read().phase).toBe('ready'); r.observer.dispose();
});
it('keeps an idle stationary player ready while real physics continues, including ordinary corrections', async () => {
  const r = rig(); r.land();
  for (let n = 0; n < 12; n++) { await vi.advanceTimersByTimeAsync(1000); r.bot.emit('physicsTick'); }
  r.bot._client.emit('position', {});
  expect(r.observer.read().phase).toBe('ready'); expect(r.bot.entity.position.x).toBe(-645); r.observer.dispose();
});
it.each(['death', 'respawn', 'login'])('requires a new position after the %s boundary', boundary => {
  const r = rig(); r.land(); r.bot.emit(boundary); expect(r.observer.read().phase).toBe('waiting-position');
  r.bot.emit('spawn'); expect(r.observer.read().phase).toBe('waiting-position');
  r.land(); expect(r.observer.read().phase).toBe('ready'); r.observer.dispose();
});
it('keeps a confirmed mount usable without walking ticks, but never across death or a changed vehicle', async () => {
  const r = rig(); r.land();
  const vehicle = { id: 7, isValid: true, position: { x: 1, y: 64, z: 1 } };
  Object.assign(r.bot, { vehicle }); r.bot.emit('mount');
  await vi.advanceTimersByTimeAsync(30000);
  expect(r.observer.read()).toMatchObject({ phase: 'mounted', vehicleId: 7 });
  expect(nativeBodyBlockedReason(r.bot, 'ride')).toBeNull();
  expect(nativeBodyBlockedReason(r.bot)).toBeNull();
  expect(nativeBodyBlockedReason(r.bot, 'goto')).toContain('ride.to');
  Object.assign(r.bot, { vehicle: { ...vehicle } }); expect(r.observer.read().phase).toBe('waiting-physics');
  Object.assign(r.bot, { vehicle }); r.bot.emit('death'); r.bot.emit('respawn'); r.bot.emit('mount');
  expect(r.observer.read().phase).toBe('waiting-position'); r.observer.dispose();
});
it('waits for native walking physics after dismount and drops all mount listeners on disposal', () => {
  const r = rig(); r.land(); Object.assign(r.bot, { vehicle: { id: 7, position: { x: 1, y: 64, z: 1 } } });
  r.bot.emit('mount'); Object.assign(r.bot, { vehicle: null }); r.bot.emit('dismount');
  expect(r.observer.read().phase).toBe('waiting-physics');
  r.land(); expect(r.observer.read().phase).toBe('ready');
  r.observer.dispose(); expect(r.bot.listenerCount('mount')).toBe(0); expect(r.bot.listenerCount('dismount')).toBe(0);
});
it('does not reuse a previous world position through configuration or a closed connection', () => {
  const r = rig(); r.land(); r.bot._client.state = 'configuration'; r.bot._client.emit('state', 'configuration');
  r.land(); expect(r.observer.read().phase).toBe('waiting-position');
  r.bot._client.state = 'play'; r.land(); expect(r.observer.read().phase).toBe('ready');
  const duplicate = installNativeBodyReadiness(r.bot); duplicate.dispose();
  expect(nativeBodyReadiness(r.bot)?.phase).toBe('ready');
  r.bot._client.emit('end'); expect(nativeBodyReadiness(r.bot)?.phase).toBe('closed');
  expect(r.bot.listenerCount('physicsTick')).toBe(0); expect(r.bot._client.listenerCount('position')).toBe(0);
  r.land(); expect(nativeBodyReadiness(r.bot)?.phase).toBe('closed');
});
it('retains explicit compatibility for consumers which did not install the observer', () => {
  expect(nativeBodyReadiness({})).toBeNull(); expect(nativeBodyBlockedReason({})).toBeNull();
});
it('reports only native readiness transitions, without logging every physics frame or correction', () => {
  const bot = Object.assign(new EventEmitter(), { _client: Object.assign(new EventEmitter(), { state: 'play' }),
    health: 35, physicsEnabled: true, entity: { position: { x: 0, y: 64, z: 0 } } });
  const observe = vi.fn(), state = installNativeBodyReadiness(bot, observe);
  bot.emit('death'); bot.emit('respawn'); bot.emit('spawn');
  expect(observe.mock.calls.map(([event]) => event)).toEqual(['boundary', 'boundary']);
  bot._client.emit('position', {});
  for (let n = 0; n < 30; n++) { bot.emit('physicsTick'); bot._client.emit('position', {}); }
  expect(observe.mock.calls.map(([event]) => event)).toEqual(['boundary', 'boundary', 'position', 'physics-ready']);
  expect(observe.mock.calls.at(-1)?.[1].phase).toBe('ready');
  state.dispose(); bot.emit('death'); expect(observe).toHaveBeenCalledTimes(4);
});
