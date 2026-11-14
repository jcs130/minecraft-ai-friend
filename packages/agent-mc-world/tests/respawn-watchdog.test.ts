import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeBodyReadiness } from '../core/body-readiness.ts';
import { installRespawnWatchdog } from '../core/respawn-watchdog.ts';

afterEach(() => vi.useRealTimers());

function rig(features: string[] = ['respawnIsPayload', 'sendsPlayerLoadedPacket']) {
  const writes: Array<{ name: string; packet: any }> = [];
  const client = Object.assign(new EventEmitter(), { state: 'play',
    write(name: string, packet: unknown) { writes.push({ name, packet }); } });
  const bot: any = Object.assign(new EventEmitter(), { _client: client, isAlive: true, health: 20, food: 20,
    physicsEnabled: true, entity: { position: { x: 1.5, y: 69, z: 2.5 } }, blockAt: () => null,
    supportFeature: (n: string) => features.includes(n), world: { async: { columns: {} } } });
  installNativeBodyReadiness(bot);
  const seen: Array<{ diag: any; final: boolean }> = [];
  const dispose = installRespawnWatchdog(bot, { checkMs: 100, finalMs: 300, onDiagnosis: (diag, final) => seen.push({ diag, final }) });
  // Server-forced respawn: mineflayer marks the player dead, then a position arrives.
  const respawn = () => { bot.isAlive = false; bot.emit('respawn'); client.emit('position', { x: 1.5, y: 69, z: 2.5 }); };
  return { bot, client, writes, seen, dispose, respawn };
}

describe('respawn watchdog', () => {
  it('requests a vanilla respawn once when the client is still dead and reports the stuck body', () => {
    vi.useFakeTimers();
    const r = rig();
    r.bot.health = 0;
    r.respawn();
    vi.advanceTimersByTime(120);
    expect(r.writes).toEqual([{ name: 'client_command', packet: { payload: 0 } }]);
    expect(r.seen[0].final).toBe(false);
    expect(r.seen[0].diag).toMatchObject({ boundary: 'respawn', phase: 'waiting-physics', isAlive: false, chunkLoaded: false,
      repairs: ['respawn-request'] });
    vi.advanceTimersByTime(300);
    expect(r.seen.map(s => s.final)).toEqual([false, true]);
    expect(r.writes).toHaveLength(1); // never retried
  });

  it('marks a revived client alive and sends player_loaded when the alive edge was missed', () => {
    vi.useFakeTimers();
    const r = rig();
    r.respawn(); // health stays 20, isAlive false
    vi.advanceTimersByTime(120);
    expect(r.bot.isAlive).toBe(true);
    expect(r.writes).toEqual([{ name: 'player_loaded', packet: {} }]);
    expect(r.seen[0].diag.repairs).toEqual(['mark-alive', 'player_loaded']);
  });

  it('does nothing once physics resumes', () => {
    vi.useFakeTimers();
    const r = rig();
    r.respawn();
    r.bot.emit('physicsTick');
    vi.advanceTimersByTime(500);
    expect(r.writes).toEqual([]);
    expect(r.seen).toEqual([]);
  });

  it('stops after dispose', () => {
    vi.useFakeTimers();
    const r = rig();
    r.dispose();
    r.respawn();
    vi.advanceTimersByTime(500);
    expect(r.seen).toEqual([]);
  });
});
