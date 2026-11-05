import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import type { Bot } from 'mineflayer';
import { afterEach, expect, it, vi } from 'vitest';
import { installNativeBodyReadiness, nativeBodyBlockedReason } from '../core/body-readiness.ts';
import { Executor, type TaskReport } from '../core/executor.ts';
import { flightState, flyToPosition, setFlightExpiry, watchFlightAbilities } from '../core/flight.ts';
import type { SkillCall } from '../core/skills.ts';
import { methodHarness } from './method-harness.ts';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  vi.restoreAllMocks(); vi.useRealTimers();
});

/** Real pinned Mineflayer health/physics + executor, synthetic transport and block grid.
 * The harness ticker is stopped: it emits physicsTick even while physics is disabled. */
async function rig() {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const r = methodHarness('1.21.1'); r.close();
  const bot = r.bot as unknown as Bot;
  Object.assign(bot, { supportFeature: (name: string) => bot.registry.supportFeature(name) });
  bot._client.state = 'play';
  const observer = installNativeBodyReadiness(bot);
  req('mineflayer/lib/plugins/health.js')(bot, { respawn: false });
  req('mineflayer/lib/plugins/physics.js')(bot, { physicsEnabled: true });
  const unwatch = watchFlightAbilities(bot);
  const reports: TaskReport[] = [];
  const exec = new Executor({ getBot: () => bot, report: value => reports.push(value),
    log: r.host.log, nextId: (() => { let n = 0; return () => ++n; })() });
  cleanup.push(() => { exec.shutdown(); bot.emit('end'); unwatch(); observer.dispose(); });
  const health = (value: number) => bot._client.emit('update_health', { health: value, food: 20, foodSaturation: 5 });
  const position = (x = .5, y = 64, z = .5) => bot._client.emit('position', { x, y, z, yaw: 0, pitch: 0,
    flags: { x: false, y: false, z: false, yaw: false, pitch: false }, teleportId: 1 });
  bot.emit('login'); health(20); position();
  await vi.advanceTimersByTimeAsync(1600);
  expect(observer.read().phase).toBe('ready');
  bot._client.emit('abilities', { flags: 4, flyingSpeed: .05 });
  const submit = (call: SkillCall) => { exec.submit([call], 'append'); };
  const run = async (call: SkillCall, ms = 2000) => {
    const before = reports.length;
    submit(call); await vi.advanceTimersByTimeAsync(ms);
    return reports.slice(before).find(report => ['done', 'blocked', 'failed', 'cancelled'].includes(report.kind));
  };
  const takeoff = async () => {
    expect((await run({ skill: 'flight', at: [0, 66, 0], land: false }))?.kind).toBe('done');
    expect(flightState(bot)).toMatchObject({ controlActive: true, mode: 'hover' });
    expect(bot.physicsEnabled).toBe(false);
  };
  return { ...r, bot, exec, observer, reports, health, position, submit, run, takeoff };
}

it('BODY-1: lands through the executor after a hover longer than the native physics liveness bound', async () => {
  const r = await rig();
  r.bot.physics.gravity = .06;
  await r.takeoff();
  const physicsAt = r.observer.read().physicsAt;
  await vi.advanceTimersByTimeAsync(6000);
  expect(r.observer.read().physicsAt).toBe(physicsAt); // No fake physics ticks during hover.
  expect(r.observer.read().phase).toBe('controlled-flight');
  expect(r.observer.read().movementAt).toBeGreaterThan(physicsAt!);
  const result = await r.run({ skill: 'land' });
  expect(result, result?.text).toMatchObject({ kind: 'done' });
  expect(r.bot.entity.position.y).toBeCloseTo(64);
  expect(r.bot.entity.onGround).toBe(true);
  expect(r.bot.physicsEnabled).toBe(true);
  expect(r.bot.physics.gravity).toBe(.06);
  expect(flightState(r.bot).controlActive).toBe(false);
  expect(r.observer.read().phase).toBe('ready');
});

it('does not confuse permission or arbitrary disabled physics with owned flight', async () => {
  const r = await rig();
  r.bot._client.emit('abilities', { flags: 6 });
  r.bot.physicsEnabled = false;
  await vi.advanceTimersByTimeAsync(6000);
  expect(r.observer.read().phase).toBe('waiting-physics');
  expect((await r.run({ skill: 'land' }))?.kind).toBe('blocked');
  expect(r.bot.physicsEnabled).toBe(false);
  expect(flightState(r.bot).controlActive).toBe(false);
});

it('allows bounded flight inputs and another route from hover but keeps ground skills gated', async () => {
  const r = await rig(); await r.takeoff();
  expect((await r.run({ skill: 'control', mode: 'flight', keys: ['jump'], durationMs: 250 }))?.kind).toBe('done');
  expect((await r.run({ skill: 'flight', at: [1, 66, 0], land: false }))?.kind).toBe('done');
  expect((await r.run({ skill: 'goto', at: [1, 64, 0] }))?.kind).toBe('blocked');
  expect((await r.run({ skill: 'control', mode: 'ground', keys: ['forward'], durationMs: 250 }))?.kind).toBe('blocked');
  expect((await r.run({ skill: 'chat', text: 'ready to land' }))?.kind).toBe('done');
  expect((await r.run({ skill: 'land' }))?.kind).toBe('done');
});

it.each(['void', 'water', 'magma_block', 'unloaded'])('keeps hover when the surface is %s; an old-position expect cannot claim landing', async surface => {
  const r = await rig(); await r.takeoff();
  for (let y = 54; y < 64; y++) r.set(0, y, 0, 'air');
  if (surface !== 'void' && surface !== 'unloaded') r.set(0, 63, 0, surface);
  const blockAt = r.bot.blockAt.bind(r.bot);
  if (surface === 'unloaded') vi.spyOn(r.bot, 'blockAt').mockImplementation((p, ...args) => p.y < 64 ? null : blockAt(p, ...args));
  const before = r.bot.entity.position.clone();
  const result = await r.run({ skill: 'land', expect: { near: [0, 66, 0], within: 2 } });
  expect(result?.kind).toBe('blocked');
  expect(result?.text).toContain('没有已加载的安全落点');
  expect(r.bot.entity.position).toEqual(before);
  expect(r.bot.physicsEnabled).toBe(false);
  expect(flightState(r.bot).mode).toBe('hover');
  vi.mocked(r.bot.blockAt).mockRestore?.();
  r.set(0, 63, 0, 'stone');
  expect((await r.run({ skill: 'land' }))?.kind).toBe('done');
});

it('rejects a landing whose support disappears during descent and retains controllable hover', async () => {
  const r = await rig(); await r.takeoff();
  r.submit({ skill: 'land' });
  await vi.advanceTimersByTimeAsync(200);
  r.set(0, 63, 0, 'air');
  await vi.advanceTimersByTimeAsync(1000);
  expect(r.reports.at(-1)?.kind).toBe('blocked');
  expect(r.reports.at(-1)?.text).toContain('支撑已变化');
  expect(r.bot.physicsEnabled).toBe(false);
  r.set(0, 63, 0, 'stone');
  expect((await r.run({ skill: 'land' }))?.kind).toBe('done');
});

it('cancellation during flight settling leaves hover that a new land can recover', async () => {
  const r = await rig(); await r.takeoff();
  let cancelled = false;
  // Zero-distance flight is already in its 150ms settling await.
  const done = flyToPosition(r.bot, r.bot.entity.position.clone(), () => cancelled).catch(error => error);
  await vi.advanceTimersByTimeAsync(50); cancelled = true;
  await vi.advanceTimersByTimeAsync(200);
  expect(await done).toBeInstanceOf(Error);
  expect(flightState(r.bot).mode).toBe('hover');
  expect((await r.run({ skill: 'land' }))?.kind).toBe('done');
});

it('rejects a stalled movement pump even though flight ownership and positive health remain', async () => {
  const r = await rig(); await r.takeoff();
  // The real Mineflayer physics plugin suspends both ticks and movement on an unloaded chunk.
  const blocks = vi.spyOn(r.bot, 'blockAt').mockReturnValue(null);
  await vi.advanceTimersByTimeAsync(5001);
  expect(r.observer.read().phase).toBe('waiting-physics');
  expect((await r.run({ skill: 'land' }))?.kind).toBe('blocked');
  blocks.mockRestore();
  await vi.advanceTimersByTimeAsync(1100);
  expect((await r.run({ skill: 'land' }))?.kind).toBe('done');
});

it('mounting ends hover without discarding the same connection’s flight grant', async () => {
  const r = await rig(); await r.takeoff();
  const expiresAt = Date.now() + 15000;
  setFlightExpiry(r.bot, expiresAt);
  Object.assign(r.bot, { vehicle: { id: 99 } });
  r.bot.emit('mount');
  expect(flightState(r.bot)).toMatchObject({ allowed: true, controlActive: false, expiresAtMs: expiresAt });
  r.position(0.5, 64); await vi.advanceTimersByTimeAsync(1600);
  expect((await r.run({ skill: 'flight', at: [0, 66, 0], land: false }))?.kind).toBe('blocked');
  Object.assign(r.bot, { vehicle: null });
  r.bot.emit('dismount');
  r.position(0.5, 64); await vi.advanceTimersByTimeAsync(1600);
  await r.takeoff(); // No extra server abilities packet is required after dismount.
  expect((await r.run({ skill: 'land' }))?.kind).toBe('done');
});

it.each(['death', 'respawn', 'login', 'mount', 'configuration', 'bot-end', 'client-end'])(
  '%s retires hover and cannot reuse old position/positive health to land', async boundary => {
    const r = await rig(); await r.takeoff();
    if (boundary === 'configuration') {
      r.bot._client.state = 'configuration'; r.bot._client.emit('state', 'configuration');
    } else if (boundary === 'client-end') r.bot._client.emit('end');
    else if (boundary === 'bot-end') r.bot.emit('end');
    else if (boundary === 'death') r.health(0);
    else if (boundary === 'respawn') r.bot._client.emit('respawn', {});
    else r.bot.emit(boundary);
    expect(r.bot.physicsEnabled).toBe(true);
    expect(r.bot.physics.gravity).toBe(.08);
    expect(flightState(r.bot).controlActive).toBe(false);
    r.health(20); r.bot.emit('spawn');
    r.bot._client.state = 'play'; r.bot._client.emit('abilities', { flags: 6 });
    expect((await r.run({ skill: 'land', expect: { near: [0, 66, 0], within: 2 } }))?.kind).toBe('blocked');
    expect(r.observer.read().phase).toBe(boundary.endsWith('end') ? 'closed' : 'waiting-position');
    if (!boundary.endsWith('end')) {
      r.position(10.5); expect(r.observer.read().phase).toBe('waiting-physics');
      await vi.advanceTimersByTimeAsync(1700);
      expect(r.observer.read().phase).toBe('ready');
      r.bot._client.emit('abilities', { flags: 4 });
      expect((await r.run({ skill: 'flight', at: [10, 66, 0], land: false }))?.kind).toBe('done');
      expect((await r.run({ skill: 'land' }))?.kind).toBe('done');
    } else {
      expect(r.bot._client.listenerCount('abilities')).toBe(0);
      expect(r.bot.listenerCount('move')).toBe(1); // Only the native look plugin listener remains.
    }
  });

it.each(['x', 'y', 'z'] as const)('never lets owned hover authorize a non-finite %s coordinate', async axis => {
  const r = await rig(); await r.takeoff();
  r.bot.entity.position[axis] = Number.NaN;
  expect(nativeBodyBlockedReason(r.bot, 'land')).toContain('旧坐标不是当前落点');
  expect((await r.run({ skill: 'land' }))?.kind).toBe('blocked');
});

it.each(['revoked', 'expiry', 'correction'])('%s restores physics and interrupts an in-flight landing', async reason => {
  const r = await rig(); await r.takeoff();
  r.submit({ skill: 'land' }); await vi.advanceTimersByTimeAsync(100);
  if (reason === 'revoked') r.bot._client.emit('abilities', { flags: 0 });
  else if (reason === 'expiry') { setFlightExpiry(r.bot, Date.now()); await vi.advanceTimersByTimeAsync(0); }
  else r.position(8.5, 64, .5);
  expect(r.bot.physicsEnabled).toBe(true);
  expect(r.bot.physics.gravity).toBe(.08);
  expect(flightState(r.bot).controlActive).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(r.reports.at(-1)?.kind).toBe('blocked');
  if (reason === 'correction') expect(r.bot.entity.position.x).toBe(8.5);
});

it('does not resume an old permission wait after a complete world boundary and new permission', async () => {
  const r = await rig(); r.bot._client.emit('abilities', { flags: 0 });
  const done = flyToPosition(r.bot, { x: .5, y: 66, z: .5 }, () => false).catch(error => error);
  await vi.advanceTimersByTimeAsync(100);
  r.bot._client.state = 'configuration'; r.bot._client.emit('state', 'configuration');
  r.bot._client.state = 'play'; r.position(20.5); r.bot.emit('physicsTick');
  r.bot._client.emit('abilities', { flags: 4 });
  await vi.advanceTimersByTimeAsync(500);
  expect((await done).message).toContain('连接或维度已变化');
  expect(r.bot.entity.position.x).toBe(20.5);
  expect(flightState(r.bot).controlActive).toBe(false);
});

it('keeps an old landing blocked when a world change happens after physics was restored', async () => {
  const r = await rig(); await r.takeoff();
  r.submit({ skill: 'land', expect: { near: [20, 64, 0], within: 2 } });
  for (let i = 0; i < 30 && !r.bot.physicsEnabled; i++) await vi.advanceTimersByTimeAsync(50);
  expect(r.bot.physicsEnabled).toBe(true);
  expect(r.exec.status().running).not.toBeNull();
  r.bot._client.emit('respawn', {}); r.health(20); r.position(20.5);
  await vi.advanceTimersByTimeAsync(1000);
  expect(r.reports.at(-1)?.kind).toBe('blocked');
  expect(r.bot.entity.position.x).toBe(20.5);
});
