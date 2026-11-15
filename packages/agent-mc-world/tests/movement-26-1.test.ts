import '../core/dependency-patches.ts';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const mfRequire = createRequire(require.resolve('mineflayer'));
const { Vec3 } = mfRequire('vec3');
const registry = mfRequire('minecraft-data')('26.1');
const pRequire = createRequire(mfRequire.resolve('prismarine-physics'));
const { Physics } = mfRequire('prismarine-physics');
const Block = pRequire('prismarine-block')(registry);

function world(fill: (x: number, y: number, z: number) => string) {
  return { getBlock: (p: any) => { const b = Block.fromStateId(registry.blocksByName[fill(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))].defaultState, 0); b.position = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return b; } };
}
function body(pos: any, extra: Record<string, unknown> = {}) {
  return { pos, vel: new Vec3(0, 0, 0), onGround: false, isInWater: false, isInLava: false, isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false,
    elytraFlying: false, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, yaw: Math.PI, pitch: 0, control: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false },
    jumpBoost: 0, speed: 0, slowness: 0, dolphinsGrace: 0, slowFalling: 0, levitation: 0, depthStrider: 0, elytraEquipped: false, attributes: {}, ...extra };
}

describe('prismarine-physics follows 26.1 vanilla movement', () => {
  it('uses the float hitbox (0.6F wide, 1.8F tall)', () => {
    const physics = Physics(registry, world(() => 'air'));
    expect(physics.playerHalfWidth).toBe(Math.fround(0.6) / 2);
    expect(physics.playerHeight).toBe(Math.fround(1.8));
  });

  it('sinks in still water like LivingEntity.travelInWater (x0.8, gravity/16)', () => {
    const w = world((_x, y) => (y <= 60 ? 'water' : 'air'));
    const physics = Physics(registry, w);
    const e = body(new Vec3(0.5, 58, 0.5));
    physics.simulatePlayer(e, w);
    expect(e.isInWater).toBe(true);
    expect(e.vel.y).toBeCloseTo(-0.005, 6);
    for (let i = 0; i < 60; i++) physics.simulatePlayer(e, w);
    expect(e.vel.y).toBeCloseTo(-0.025, 3); // terminal sinking speed Grim predicts
  });

  it('touches water by the fluid surface reaching the feet, with the 0.4 jump threshold', () => {
    const w = world((_x, y) => (y === 60 ? 'water' : y < 60 ? 'stone' : 'air'));
    const physics = Physics(registry, w);
    const wading = body(new Vec3(0.5, 60, 0.5), { onGround: true });
    physics.simulatePlayer(wading, w);
    expect(wading.isInWater).toBe(true);
    expect(wading.waterHeight).toBeCloseTo(8 / 9, 3) // EntityFluidInteraction: from the real box bottom;
    const above = body(new Vec3(0.5, 60.95, 0.5));
    physics.simulatePlayer(above, w);
    expect(above.isInWater).toBe(false);
  });

  it('does not count the server sprint modifier twice', () => {
    const w = world((_x, y) => (y < 64 ? 'stone' : 'air'));
    const physics = Physics(registry, w);
    const plain = body(new Vec3(0.5, 64, 0.5), { onGround: true, attributes: { 'minecraft:movement_speed': { value: 0.1, modifiers: [] } } });
    const marked = body(new Vec3(0.5, 64, 0.5), { onGround: true, attributes: { 'minecraft:movement_speed': { value: 0.1, modifiers: [{ uuid: 'minecraft:sprinting', amount: 0.3, operation: 2 }] } } });
    for (const e of [plain, marked]) { e.control.forward = true; e.control.sprint = true; physics.simulatePlayer(e, w); }
    expect(marked.vel.z).toBeCloseTo(plain.vel.z, 12);
    expect(marked.attributes['minecraft:movement_speed'].modifiers).toHaveLength(1); // server record untouched
  });

  it('reads step_height, jump_strength and sneaking_speed from attributes', () => {
    const w = world((_x, y) => (y < 64 ? 'stone' : 'air'));
    const physics = Physics(registry, w);
    const e = body(new Vec3(0.5, 64, 0.5), { onGround: true, attributes: { 'minecraft:jump_strength': { value: 0.5, modifiers: [] } } });
    e.control.jump = true;
    physics.simulatePlayer(e, w);
    expect(e.pos.y - 64).toBeCloseTo(0.5, 5);
  });

  it('zeroes slow horizontal motion by its squared length (1.21.5+)', () => {
    const w = world((_x, y) => (y < 64 ? 'stone' : 'air'));
    const physics = Physics(registry, w);
    const e = body(new Vec3(0.5, 64, 0.5), { onGround: true });
    e.vel.set(0.0025, 0, 0.0025); // each axis < 0.003 but 1.25e-5 >= 9e-6: kept
    physics.simulatePlayer(e, w);
    expect(e.pos.x).toBeGreaterThan(0.5);
  });
});

function entitiesRig() {
  const inject = mfRequire('./lib/plugins/entities.js') as (bot: unknown) => void;
  const bot: any = Object.assign(new EventEmitter(), {
    _client: Object.assign(new EventEmitter(), { write() {} }), registry, version: '26.1',
    supportFeature: (f: string) => registry.supportFeature(f), entity: null, players: {}, game: {},
  });
  inject(bot);
  bot._client.emit('login', { entityId: 5, worldState: { dimension: 'overworld' }, gameMode: 0 });
  return bot;
}

describe('mineflayer reads 26.1 entity packets', () => {
  it('keys attributes by the registry index and keeps lpVec3 velocity in blocks/tick', () => {
    const bot = entitiesRig();
    expect(bot.entity).toBeTruthy();
    // movement_speed is registry index 22; the stale protocol table calls 22 "generic.scale".
    bot._client.emit('entity_update_attributes', { entityId: bot.entity.id, properties: [{ key: 'generic.scale', value: 0.1, modifiers: [] }] });
    expect(bot.entity.attributes['minecraft:movement_speed']?.value).toBe(0.1);
    bot._client.emit('entity_velocity', { entityId: bot.entity.id, velocity: { x: 0.1, y: -0.08, z: 0 } });
    expect(bot.entity.velocity.x).toBeCloseTo(0.1, 6);
    expect(bot.entity.velocity.y).toBeCloseTo(-0.08, 6);
  });
});

describe('water current (FlowingFluid.getFlow / EntityFluidInteraction)', () => {
  it('does not push a body standing in still source water walled by solid blocks', () => {
    const physics = Physics(registry, null);
    // source water pool 3x1 in a stone trench at y 64; stone walls on both sides at y 64-65
    const w = world((x, y, z) => y < 64 ? 'stone' : y === 64 && x >= 0 && x <= 2 && z === 0 ? 'water' : y <= 65 ? 'stone' : 'air');
    const e = body(new Vec3(1.5, 64, 0.5), { onGround: true });
    for (let i = 0; i < 20; i++) physics.simulatePlayer(e, w);
    expect(Math.abs(e.pos.x - 1.5)).toBeLessThan(1e-6);
    expect(Math.abs(e.pos.z - 0.5)).toBeLessThan(1e-6);
  });

  it('pulls toward an open edge with water one block down, like vanilla', () => {
    const physics = Physics(registry, null);
    // source at (1,64,0); (2,64,0) is air over water at (2,63,0); stone elsewhere around
    const w = world((x, y, z) => (x === 1 && y === 64 && z === 0) || (x === 2 && y === 63 && z === 0) ? 'water' : x === 2 && y === 64 && z === 0 ? 'air' : y <= 65 ? 'stone' : 'air');
    const e = body(new Vec3(1.5, 64, 0.5), { onGround: true });
    physics.simulatePlayer(e, w);
    expect(e.vel.x).toBeGreaterThan(0);
  });
});

describe('sneak edge back-off (Player.maybeBackOffFromEdge)', () => {
  it('stops a sneaking body at the edge even with blocks beside it at body level', () => {
    const physics = Physics(registry, null);
    // 1-wide bridge along -z at y 63, a wall column at x=1 (body level) next to it, air beyond z<0.
    const w = world((x, y, z) => (y === 63 && x === 0 && z >= 0) || (x === 1 && y >= 64 && y <= 65) ? 'stone' : y < 60 ? 'stone' : 'air');
    const e = body(new Vec3(0.5, 64, 0.5), { onGround: true });
    e.control.sneak = true; e.control.forward = true; e.yaw = 0; // yaw 0 faces -z (north)
    for (let i = 0; i < 60; i++) physics.simulatePlayer(e, w);
    expect(e.onGround).toBe(true);
    expect(e.pos.y).toBe(64);
    expect(e.pos.z).toBeGreaterThan(-0.31);
    expect(e.pos.z).toBeLessThan(-0.2);
  });
});

describe('step up like 26.1 Entity.collide', () => {
  it('lands on a slightly higher snow layer instead of stopping in mid-air (Grim Simulation .0515)', () => {
    // Snow layers 4 (top 0.375) at z=51 and 5 (top 0.5) at z=52 on stone; replay of a live tick.
    const w = { getBlock: (p: any) => {
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      const b = y <= -61 ? Block.fromStateId(registry.blocksByName.stone.defaultState, 0)
        : y === -60 && (z === 51 || z === 52) ? Block.fromProperties('snow', { layers: z === 51 ? 4 : 5 }, 0)
        : Block.fromStateId(0, 0);
      b.position = new Vec3(x, y, z); return b;
    } };
    const physics = Physics(registry, w);
    const e = body(new Vec3(64.5, -59.44853, 51.43712));
    e.vel = new Vec3(0, -0.51433 / 0.98 + 0.08, 0.27);
    e.control.forward = true; e.control.sprint = true;
    physics.simulatePlayer(e, w);
    expect(e.onGround).toBe(true);
    expect(e.pos.y).toBeCloseTo(-59.5, 6); // stepped onto the layer-5 top from the collided box
  });
});

describe('mineflayer client tick like vanilla 26.1', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function physicsRig() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    // mineflayer reads perf_hooks.performance, which fake timers do not replace.
    vi.spyOn(require('node:perf_hooks').performance, 'now').mockImplementation(() => Date.now());
    const injectPhysics = mfRequire('./lib/plugins/physics.js') as (bot: unknown, options: unknown) => void;
    const wire: Array<[string, any]> = [];
    const w = world((_x, y) => (y < 64 ? 'stone' : 'air'));
    const bot: any = Object.assign(new EventEmitter(), {
      _client: Object.assign(new EventEmitter(), { state: 'play', write: (n: string, p: unknown) => wire.push([n, p]) }),
      registry, version: '26.1', isAlive: true, game: { gameMode: 'survival' }, food: 20,
      entity: { id: 9, position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), effects: {}, yaw: Math.PI, pitch: 0, onGround: true, height: 1.8, attributes: {} },
      supportFeature: (f: string) => registry.supportFeature(f), blockAt: (p: any) => w.getBlock(p), inventory: { slots: [] }, getEquipmentDestSlot: () => 6,
    });
    injectPhysics(bot, { physicsEnabled: true });
    bot.emit('login');
    bot.entity.onGround = true; // a fresh login starts airborne; this rig stands on stone
    return { bot, wire };
  }

  it('holds between-tick writes to the next tick, replies before actions, then movement and tick_end', () => {
    const { bot, wire } = physicsRig();
    bot._client.emit('position', { teleportId: 1, x: 0.5, y: 64, z: 0.5, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: { yaw: true, pitch: true } });
    vi.advanceTimersByTime(60);
    wire.length = 0;
    bot._client.write('block_dig', { status: 0 });
    bot._client.write('pong', { id: 7 });
    expect(wire).toHaveLength(0);
    bot.setControlState('forward', true);
    vi.advanceTimersByTime(50);
    const names = wire.map(([n]) => n);
    expect(names.slice(0, 3)).toEqual(['pong', 'block_dig', 'player_input']);
    expect(names[names.length - 1]).toBe('tick_end');
    expect(names.indexOf('position')).toBeGreaterThan(names.indexOf('player_input'));
  });

  it('keeps the standing flag through a teleport and sprints only with forward impulse', () => {
    const { bot, wire } = physicsRig();
    bot._client.emit('position', { teleportId: 1, x: 0.5, y: 64, z: 0.5, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: { yaw: true, pitch: true } });
    expect(bot.entity.onGround).toBe(true);
    vi.advanceTimersByTime(60);
    wire.length = 0;
    bot.setControlState('sprint', true); // no forward: vanilla does not sprint
    vi.advanceTimersByTime(100);
    expect(wire.filter(([n]) => n === 'entity_action')).toHaveLength(0);
    bot.setControlState('forward', true);
    vi.advanceTimersByTime(100);
    expect(wire.filter(([n]) => n === 'entity_action').map(([, p]) => p.actionId)).toEqual(['start_sprinting']);
    const action = wire.findIndex(([n]) => n === 'entity_action');
    expect(wire.slice(action).map(([n]) => n)).toContain('position');
    expect(wire.slice(0, action).filter(([n]) => n === 'player_input').length).toBeGreaterThan(0);
  });

  it('sends the rotation the move used when a physicsTick listener turns after the move (pathfinder)', () => {
    const { bot, wire } = physicsRig();
    bot._client.emit('position', { teleportId: 1, x: 0.5, y: 64, z: 0.5, dx: 0, dy: 0, dz: 0, yaw: 90, pitch: 0, flags: {} });
    vi.advanceTimersByTime(60);
    let turned = false;
    bot.on('physicsTick', () => { if (!turned) { turned = true; bot.entity.yaw += 0.7; } });
    wire.length = 0;
    vi.advanceTimersByTime(50);
    const first = wire.find(([n]) => n === 'look' || n === 'position_look' || n === 'position')?.[1];
    expect(first === undefined || Math.abs(first.yaw - 90) < 0.01).toBe(true); // this tick moved facing 90
    vi.advanceTimersByTime(50);
    const next = wire.filter(([n]) => n === 'look' || n === 'position_look').pop()?.[1];
    expect(Math.abs(next.yaw - (90 - 0.7 * 180 / Math.PI))).toBeLessThan(0.01); // the turn goes out next tick
  });

  it('sends the rotation it simulated, continuous across the 360 wrap', () => {
    const { bot, wire } = physicsRig();
    bot._client.emit('position', { teleportId: 1, x: 0.5, y: 64, z: 0.5, dx: 0, dy: 0, dz: 0, yaw: 179, pitch: 0, flags: {} });
    vi.advanceTimersByTime(60);
    wire.length = 0;
    bot.entity.yaw = bot.entity.yaw - (2 * Math.PI) / 180 * 2; // turn 4 degrees across +-180
    vi.advanceTimersByTime(50);
    const look = wire.find(([n]) => n === 'look' || n === 'position_look')?.[1];
    expect(Math.abs(look.yaw - 183)).toBeLessThan(0.01);
  });

  it('sends held packets on the raw writer once, without re-running outer write wrappers', () => {
    const { bot, wire } = physicsRig();
    bot._client.emit('position', { teleportId: 1, x: 0.5, y: 64, z: 0.5, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: { yaw: true, pitch: true } });
    vi.advanceTimersByTime(60);
    // an outer guard (like the inventory click sync) wraps write after physics was injected
    const inner = bot._client.write; let guardCalls = 0;
    bot._client.write = (n: string, p: unknown) => { if (n === 'window_click') { guardCalls++; if (guardCalls > 1) throw new Error('guard ran twice'); } return inner(n, p); };
    wire.length = 0;
    bot._client.write('window_click', { slot: 1 });
    expect(wire.filter(([n]) => n === 'window_click')).toHaveLength(0);
    expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    expect(guardCalls).toBe(1);
    expect(wire.filter(([n]) => n === 'window_click')).toHaveLength(1);
  });

  it('drops the tick backlog after an event-loop stall (mineflayer #4068, Grim Timer)', () => {
    const { bot, wire } = physicsRig();
    bot._client.emit('position', { teleportId: 1, x: 0.5, y: 64, z: 0.5, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: { yaw: true, pitch: true } });
    vi.advanceTimersByTime(60);
    wire.length = 0;
    vi.setSystemTime(Date.now() + 1000); // 1 s stall: no timer ran
    vi.advanceTimersByTime(250);
    const ticks = wire.filter(([n]) => n === 'tick_end').length;
    // one capped burst (4) plus ~5 on-time ticks; draining would run 20+
    expect(ticks).toBeGreaterThanOrEqual(5);
    expect(ticks).toBeLessThanOrEqual(10);
  });
});

describe('mineflayer-pathfinder stops like a player (Grim)', () => {
  it('does not teleport the body to the block centre or zero its velocity in fullStop', () => {
    const src = String(mfRequire('mineflayer-pathfinder').pathfinder);
    expect(src).not.toContain('bot.entity.position.x = blockX');
    expect(src).not.toContain('bot.entity.velocity.x = 0');
    expect(src).toContain('No position snap');
  });
});
