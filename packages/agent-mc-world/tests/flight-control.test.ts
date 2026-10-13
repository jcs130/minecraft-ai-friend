import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flightState, flyToPosition, setFlightExpiry, stopFlight, watchFlightAbilities } from '../core/flight.ts';
import { cancelControlInput, skillControl } from '../core/skills-control.ts';
import type { SkillContext } from '../core/skill-context.ts';
import { parseSteps, type ControlKey } from '../core/skills.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function rig(permission = true) {
  const client = Object.assign(new EventEmitter(), { write: vi.fn() });
  const keys: Record<string, boolean> = {};
  const bot = Object.assign(new EventEmitter(), {
    _client: client, controlState: keys,
    entity: { position: new Vec3(.5, 70, .5), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, onGround: false },
    physics: { gravity: .08 }, physicsEnabled: true,
    clearControlStates() { for (const key of Object.keys(keys)) keys[key] = false; },
    setControlState(key: string, value: boolean) { keys[key] = value; },
    blockAt: vi.fn(() => ({ name: 'air', shapes: [] as number[][], boundingBox: 'empty' })),
  }) as unknown as Bot;
  const unwatch = watchFlightAbilities(bot);
  if (permission) client.emit('abilities', { flags: 4, flyingSpeed: .05 });
  const ctx = { aborted: () => false } as SkillContext;
  const move = (input: ControlKey[], durationMs = 500) => skillControl(bot, { skill: 'control', mode: 'flight', keys: input, durationMs }, ctx);
  const released = () => expect(Object.values(keys).some(Boolean)).toBe(false);
  return { bot, client, keys, ctx, move, released, unwatch };
}

it('holds real inputs only during movement and reports hover while settling', async () => {
  const h = rig();
  const done = h.move(['forward', 'jump', 'sprint']);
  await vi.advanceTimersByTimeAsync(100);
  expect(h.keys).toMatchObject({ forward: true, jump: true, sprint: true });
  expect(flightState(h.bot)).toMatchObject({ allowed: true, flying: true, mode: 'input' });
  expect(flightState(h.bot).direction!.x).toBeCloseTo(0);
  expect(flightState(h.bot).direction!.y).toBeCloseTo(3);
  expect(flightState(h.bot).direction!.z).toBeCloseTo(-6);
  await vi.advanceTimersByTimeAsync(400);
  h.released(); expect(flightState(h.bot).mode).toBe('hover');
  expect(h.bot.entity.position.y).toBeCloseTo(71.5);
  expect(h.bot.entity.position.z).toBeCloseTo(-2.5);
  await vi.runAllTimersAsync(); expect(await done).toContain('客户端观测');
  h.unwatch();
});

it.each([
  [['forward'], 0, 0, -1.5], [['back'], 0, 0, 1.5], [['left'], -1.5, 0, 0], [['right'], 1.5, 0, 0],
  [['jump'], 0, 1.5, 0], [['sneak'], 0, -1.5, 0],
  [['forward', 'jump'], 0, 1.5, -1.5], [['back', 'sprint'], 0, 0, 1.5],
] as [ControlKey[], number, number, number][])('moves %j on independent axes', async (keys, x, y, z) => {
  const h = rig(), from = h.bot.entity.position.clone();
  const done = h.move(keys); await vi.runAllTimersAsync(); await done;
  const delta = h.bot.entity.position.minus(from);
  expect(delta.x).toBeCloseTo(x); expect(delta.y).toBeCloseTo(y); expect(delta.z).toBeCloseTo(z);
  h.released(); h.unwatch();
});

it('uses current yaw, ignores pitch for vertical input, and normalizes only the horizontal diagonal', async () => {
  const h = rig(), from = h.bot.entity.position.clone(); h.bot.entity.yaw = Math.PI / 2; h.bot.entity.pitch = -Math.PI / 2;
  const done = h.move(['forward', 'left', 'jump']); await vi.runAllTimersAsync(); await done;
  const d = h.bot.entity.position.minus(from);
  expect(d.x).toBeCloseTo(-1.5 / Math.sqrt(2)); expect(d.z).toBeCloseTo(1.5 / Math.sqrt(2)); expect(d.y).toBeCloseTo(1.5);
  h.unwatch();
});

it('never presses keys or moves without server permission, and waiting is cancellable', async () => {
  const h = rig(false), before = h.bot.entity.position.clone();
  const done = h.move(['jump']).catch(e => e);
  await vi.advanceTimersByTimeAsync(200); h.released(); expect(h.bot.entity.position).toEqual(before);
  cancelControlInput(h.bot, 'operator pause');
  await vi.runAllTimersAsync(); expect((await done).message).toContain('operator pause');
  h.client.emit('abilities', { flags: 4, flyingSpeed: .05 }); await vi.runAllTimersAsync();
  h.released(); expect(h.bot.entity.position).toEqual(before); h.unwatch();
});

it.each(['revoked', 'expiry', 'forcedMove', 'respawn', 'death', 'end', 'stop'])(
  '%s releases keys immediately and an old continuation cannot resume movement', async reason => {
    const h = rig(); const done = h.move(['forward', 'jump', 'sprint'], 2000).catch(e => e);
    await vi.advanceTimersByTimeAsync(100);
    if (reason === 'revoked') h.client.emit('abilities', { flags: 0 });
    else if (reason === 'expiry') { setFlightExpiry(h.bot, Date.now()); await vi.advanceTimersByTimeAsync(0); }
    else if (reason === 'stop') stopFlight(h.bot);
    else h.bot.emit(reason);
    const at = h.bot.entity.position.clone(); h.released();
    expect(h.bot.physicsEnabled).toBe(true); expect(h.bot.physics.gravity).toBe(.08);
    h.client.emit('abilities', { flags: 4, flyingSpeed: .05 });
    await vi.runAllTimersAsync(); expect(await done).toBeInstanceOf(Error);
    expect(h.bot.entity.position).toEqual(at); h.released(); expect(flightState(h.bot).mode).toBe('ground'); h.unwatch();
  });

it('stops a sprint before a thin collision shape', async () => {
  const h = rig(), before = h.bot.entity.position.clone();
  vi.mocked(h.bot.blockAt).mockImplementation((p: Vec3) => ({ name: 'pane', shapes: p.z === 0 ? [[0, 0, .15, 1, 1, .2]] : [], boundingBox: 'empty' }) as never);
  const done = h.move(['forward', 'sprint']).catch(e => e); await vi.runAllTimersAsync();
  expect((await done).message).toContain('碰撞'); expect(h.bot.entity.position).toEqual(before);
  h.released(); expect(flightState(h.bot).mode).toBe('hover'); h.unwatch();
});

it('coordinate flight reports its route without inventing WASD presses', async () => {
  const h = rig(); const done = flyToPosition(h.bot, { x: .5, y: 71, z: .5 }, () => false);
  await vi.advanceTimersByTimeAsync(100);
  expect(flightState(h.bot).mode).toBe('route'); expect(flightState(h.bot).direction!.y).toBeGreaterThan(0); h.released();
  await vi.runAllTimersAsync(); await done; expect(flightState(h.bot).mode).toBe('hover'); h.unwatch();
});

it('public step parsing accepts flight sprint while retaining bounds and opposing-key checks', () => {
  const call = { skill: 'control', mode: 'flight', keys: ['forward', 'jump', 'sprint'], durationMs: 500 };
  expect(parseSteps([call])).toMatchObject({ steps: [call] });
  expect(parseSteps([{ ...call, durationMs: 5000 }])).toHaveProperty('error');
  expect(parseSteps([{ ...call, keys: ['jump', 'sneak'] }])).toHaveProperty('error');
});
