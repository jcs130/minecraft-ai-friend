import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { installDeathLifecycle, respawnDelay, type DeathLifecycle } from '../core/death-lifecycle.ts';

afterEach(() => vi.useRealTimers());
function rig(delay?: number) {
  vi.useFakeTimers();
  let current = true;
  const bot = Object.assign(new EventEmitter(), { health: 0, respawn: vi.fn(), deathLifecycle: undefined as DeathLifecycle | undefined });
  const recovery = installDeathLifecycle(bot, delay, () => current);
  return { bot, recovery, stale: () => { current = false; } };
}
it('waits four seconds and dispatches only once despite repeated native death/health', async () => {
  const r = rig(); r.bot.emit('death');
  const id = r.bot.deathLifecycle!.episodeId;
  r.bot.emit('death'); r.bot.emit('health');
  await vi.advanceTimersByTimeAsync(3999);
  expect(r.bot.respawn).not.toHaveBeenCalled();
  expect(r.bot.deathLifecycle!.episodeId).toBe(id);
  await vi.advanceTimersByTimeAsync(1);
  expect(r.bot.respawn).toHaveBeenCalledTimes(1);
  r.bot.emit('death'); await vi.advanceTimersByTimeAsync(20000);
  expect(r.bot.respawn).toHaveBeenCalledTimes(1);
  r.recovery.dispose();
});
it.each(['stop', 'disconnect', 'generation', 'native-respawn'])('cancels pending respawn on %s', async kind => {
  const r = rig(); r.bot.emit('death');
  if (kind === 'stop') r.recovery.cancel();
  if (kind === 'disconnect') r.bot.emit('end');
  if (kind === 'generation') r.stale();
  if (kind === 'native-respawn') { r.bot.health = 20; r.bot.emit('spawn'); }
  await vi.advanceTimersByTimeAsync(16000);
  expect(r.bot.respawn).not.toHaveBeenCalled();
  r.recovery.dispose();
});
it('starts a new episode only after fresh native spawn', async () => {
  const r = rig(0); r.bot.emit('death'); await vi.advanceTimersByTimeAsync(0);
  const old = r.bot.deathLifecycle!.episodeId;
  r.bot.health = 20; r.bot.emit('spawn');
  expect(r.bot.deathLifecycle!.phase).toBe('alive');
  r.bot.health = 0; r.bot.emit('death'); await vi.advanceTimersByTimeAsync(0);
  expect(r.bot.respawn).toHaveBeenCalledTimes(2);
  expect(r.bot.deathLifecycle!.episodeId).not.toBe(old);
  r.recovery.dispose();
});
it('validates the bounded configurable delay', () => {
  expect(respawnDelay(undefined)).toBe(4000);
  expect(respawnDelay(15000)).toBe(15000);
  for (const n of [-1, 15001, NaN, 0.5]) expect(() => respawnDelay(n)).toThrow();
});
