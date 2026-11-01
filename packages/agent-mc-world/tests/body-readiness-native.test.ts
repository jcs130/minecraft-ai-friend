import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { installNativeBodyReadiness } from '../core/body-readiness.ts';
import { methodHarness } from './method-harness.ts';
import type { Bot } from 'mineflayer';
import { Executor, type TaskReport } from '../core/executor.ts';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('returns a physical step terminal as blocked without dispatch while retaining queued chat', async () => {
  vi.useFakeTimers();
  const r = methodHarness('1.21.1'); r.close();
  const observer = installNativeBodyReadiness(r.bot), reports: TaskReport[] = [];
  const exec = new Executor({ getBot: () => r.bot as unknown as Bot, report: value => reports.push(value),
    log: r.host.log, nextId: (() => { let n = 0; return () => ++n; })() });
  try {
    exec.submit([{ skill: 'goto', at: [10, 64, 0] }], 'append');
    exec.submit([{ skill: 'chat', text: 'fixture chat remains available' }], 'append');
    await vi.advanceTimersByTimeAsync(1000);
    expect(reports.find(value => value.taskId === 1 && value.kind === 'blocked')?.text).toContain('本步未执行');
    expect(reports.find(value => value.taskId === 2)?.kind).toBe('done');
    expect(r.said).toEqual(['fixture chat remains available']);
    expect(r.bot.entity.position.x).toBe(.5);
  } finally { exec.shutdown(); observer.dispose(); }
});
it('reproduces the frozen positive-health body using real pinned 1.21.1 health and physics plugins, then accepts a real new position', async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const r = methodHarness('1.21.1'), b = r.bot as unknown as Bot;
  // Stop the harness's timer/executor; keep its local collision grid and entity.
  // Only Mineflayer's actual physics plugin may advance the body in this test.
  r.close();
  Object.assign(b, { supportFeature: (name: string) => b.registry.supportFeature(name) });
  const observer = installNativeBodyReadiness(b);
  req('mineflayer/lib/plugins/health.js')(b, { respawn: false });
  req('mineflayer/lib/plugins/physics.js')(b, { physicsEnabled: true });
  const health = (value: number) => b._client.emit('update_health', { health: value, food: 20, foodSaturation: 5 });
  const land = (x: number) => b._client.emit('position', { x, y: 64, z: .5, yaw: 0, pitch: 0,
    flags: { x: false, y: false, z: false, yaw: false, pitch: false }, teleportId: 1 });
  // Use the plugin's native event as proof, not the harness's simulated ticker.
  let nativeTicks = 0;
  b.on('physicsTick', () => nativeTicks++);
  try {
    b.emit('login'); health(35); land(.5); await vi.advanceTimersByTimeAsync(100);
    health(0); b._client.emit('respawn', {}); health(35);
    const before = b.entity.position.clone();
    b.setControlState('forward', true); await vi.advanceTimersByTimeAsync(3000);
    expect(b.entity.position.distanceTo(before)).toBeLessThan(.001);
    expect(observer.read().phase).toBe('waiting-position');
    b.setControlState('forward', false);
    land(10.5); await vi.advanceTimersByTimeAsync(1600);
    expect(observer.read().phase).toBe('ready');
    b.setControlState('forward', true); const fresh = b.entity.position.clone();
    await vi.advanceTimersByTimeAsync(500);
    expect(b.entity.position.distanceTo(fresh)).toBeGreaterThan(.1);
    expect(nativeTicks).toBeGreaterThan(0);
  } finally { b.emit('end'); observer.dispose(); }
});
