import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { installDeathLifecycle, respawnDelay, type DeathLifecycle } from '../core/death-lifecycle.ts';

afterEach(() => vi.useRealTimers());
it.each([20, 0])('handles proxy login health without a false recovery gate, authenticated health=%s', async health => {
  vi.useFakeTimers();
  let authenticated = false;
  const bot = Object.assign(new EventEmitter(), { health: 20, respawn() {}, deathLifecycle: undefined as DeathLifecycle | undefined,
    _client: Object.assign(new EventEmitter(), {write:vi.fn()}), inventory: {slots:Array(46).fill(null)},
    supportFeature:()=>false });
  const recovery=installDeathLifecycle(bot,4000,()=>true,()=>authenticated);
  // Actual Mineflayer health plugin: a proxy's zero sets isAlive=false, so
  // a later authenticated zero emits no second death event.
  const require=createRequire(import.meta.url);
  require('mineflayer/lib/plugins/health.js')(bot,{respawn:false});
  bot._client.emit('update_health',{health:0,food:20});
  expect(bot.deathLifecycle).toBeUndefined();
  await vi.advanceTimersByTimeAsync(5000);
  expect(bot._client.write).not.toHaveBeenCalled();
  authenticated=true;
  bot._client.emit('window_items',{windowId:0,items:Array(46).fill(null)});
  bot._client.emit('update_health',{health,food:20});
  if(health>0){
    expect(bot.deathLifecycle).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(bot._client.write).not.toHaveBeenCalled();
  }else{
    expect(bot.deathLifecycle).toMatchObject({phase:'respawn_pending',inventorySynced:false});
    await vi.advanceTimersByTimeAsync(4000);
    expect(bot._client.write).toHaveBeenCalledTimes(1);
    expect(bot._client.write).toHaveBeenCalledWith('client_command',{actionId:0});
    bot._client.emit('respawn',{});
    bot._client.emit('window_items',{windowId:0,items:Array(46).fill(null)});
    bot._client.emit('update_health',{health:20,food:20});
    expect(bot.deathLifecycle).toMatchObject({phase:'alive',inventorySynced:true});
  }
  recovery.dispose();
});
it('retains packet health for the same recovery without inventing another death or a landing', () => {
  const r = rig(); r.bot.emit('death');
  const id = r.bot.deathLifecycle!.episodeId;
  r.bot.deathLifecycle!.deathsToday = 1;
  r.bot._client.emit('update_health', { health: 3, food: 2 });
  expect(r.bot.deathLifecycle!.healthObservation).toBeUndefined();
  r.bot.emit('respawn');
  r.bot._client.emit('update_health', { health: 35, food: 20 });
  r.bot.health = 35; r.bot.emit('spawn');
  expect(r.bot.deathLifecycle).toMatchObject({ episodeId: id, phase: 'alive', deathsToday: 1,
    healthObservation: { health: 35, food: 20, observedAt: new Date().toISOString() } });
  r.bot.health = 0; r.bot.emit('death');
  expect(r.bot.deathLifecycle!.episodeId).not.toBe(id);
  expect(r.bot.deathLifecycle!.healthObservation).toBeUndefined();
  expect(r.bot.deathLifecycle!.deathsToday).toBeUndefined();
  r.recovery.dispose();
  expect(r.bot._client.listenerCount('update_health')).toBe(0);
});
function rig(delay?: number) {
  vi.useFakeTimers();
  let current = true;
  const bot = Object.assign(new EventEmitter(), { health: 0, respawn: vi.fn(), deathLifecycle: undefined as DeathLifecycle | undefined,
    _client: new EventEmitter(), inventory: { slots: Array(46).fill(null) } });
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
it('cancels on the native respawn packet before fresh health emits spawn', async () => {
  const r = rig(); r.bot.emit('death');
  const old = r.bot.deathLifecycle!.episodeId;
  await vi.advanceTimersByTimeAsync(2000);
  r.bot.emit('respawn'); // Mineflayer leaves health at zero until update_health.
  await vi.advanceTimersByTimeAsync(5000);
  expect(r.bot.respawn).not.toHaveBeenCalled();
  expect(r.bot.deathLifecycle).toMatchObject({ episodeId: old, phase: 'dead', respawnAt: null });
  r.bot.emit('death');
  expect(r.bot.deathLifecycle!.episodeId).toBe(old);
  r.bot.health = 20; r.bot.emit('spawn');
  expect(r.bot.deathLifecycle!.phase).toBe('alive');
  r.recovery.dispose();
});
it('validates the bounded configurable delay', () => {
  expect(respawnDelay(undefined)).toBe(4000);
  expect(respawnDelay(15000)).toBe(15000);
  for (const n of [-1, 15001, NaN, 0.5]) expect(() => respawnDelay(n)).toThrow();
});

it.each([true, false])('requires a complete inventory packet after respawn, including inventory-before-spawn=%s', beforeSpawn => {
  const r = rig();
  const packet = (windowId = 0, length = 46) => r.bot._client.emit('window_items', { windowId, items: Array(length).fill(null) });
  packet();
  r.bot.emit('death');
  expect(r.bot.deathLifecycle).toMatchObject({ inventorySynced: false });
  packet(); // Late old-life inventory, before the native respawn boundary.
  expect(r.bot.deathLifecycle).toMatchObject({ inventorySynced: false });
  r.bot.emit('respawn');
  packet(1); packet(0, 20);
  expect(r.bot.deathLifecycle).toMatchObject({ inventorySynced: false });
  if (beforeSpawn) packet();
  r.bot.health = 20;
  r.bot.emit('spawn');
  expect(r.bot.deathLifecycle).toMatchObject({ phase: 'alive', inventorySynced: beforeSpawn });
  packet();
  expect(r.bot.deathLifecycle).toMatchObject({ inventorySynced: true });
  r.bot.emit('respawn'); // A later dimension transfer is not another death episode.
  expect(r.bot.deathLifecycle).toMatchObject({ inventorySynced: true });
  r.bot.emit('death');
  expect(r.bot.deathLifecycle).toMatchObject({ inventorySynced: false });
  r.stale(); r.bot.emit('respawn'); packet();
  expect(r.bot.deathLifecycle).toMatchObject({ inventorySynced: false });
  r.recovery.dispose();
});
