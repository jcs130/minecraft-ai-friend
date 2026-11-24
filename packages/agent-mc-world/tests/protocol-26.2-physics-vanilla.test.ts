import '../core/dependency-patches.ts';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  installExperimentalMinecraftDataResolution,
  uninstallExperimentalMinecraftDataResolution,
} from '../core/experimental-26.2.ts';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = require(join(root, 'tests/fixtures/vanilla-26.2/rest-matrix-live-evidence.json'));
const { Vec3 } = require('vec3');

beforeAll(() => installExperimentalMinecraftDataResolution());
afterAll(() => uninstallExperimentalMinecraftDataResolution());

function loadPhysics() {
  // Resolve through mineflayer like movement-26-1, after dependency-patches hooks _compile.
  const mfRequire = createRequire(require.resolve('mineflayer'));
  const registry = require('prismarine-registry')('26.2');
  const pRequire = createRequire(mfRequire.resolve('prismarine-physics'));
  const { Physics } = mfRequire('prismarine-physics');
  const Block = pRequire('prismarine-block')(registry);
  return { Physics, Block, registry };
}

function world(Block: any, registry: any, fill: (x: number, y: number, z: number) => string) {
  return {
    getBlock: (p: any) => {
      const name = fill(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
      b.position = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      return b;
    },
  };
}

function body(pos: any, extra: Record<string, unknown> = {}) {
  return {
    pos, vel: new Vec3(0, 0, 0), onGround: true, isInWater: false, isInLava: false, isInWeb: false,
    isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, jumpTicks: 0, jumpQueued: false,
    fireworkRocketDuration: 0, yaw: 0, pitch: 0,
    control: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false },
    jumpBoost: 0, speed: 0, slowness: 0, dolphinsGrace: 0, slowFalling: 0, levitation: 0, depthStrider: 0,
    elytraEquipped: false, attributes: {}, ...extra,
  };
}

function trace(label: string) {
  return evidence.physics.traces.find((t: any) => t.label === label);
}

describe('26.2 climbUsingJump and block/step collision vs local vanilla movement', () => {
  it('vanilla ladder+jump oracle: climbUsingJump raises Y; forward or idle does not', () => {
    const jump = trace('ladder-jump-only');
    const forward = trace('ladder-forward-no-jump');
    const none = trace('ladder-neither');
    const against = trace('jump-against-full-block');
    expect(jump.yLast - jump.y0).toBeGreaterThan(2);
    expect(jump.xLast).toBeCloseTo(jump.x0, 5);
    expect(forward.yLast).toBe(forward.y0);
    expect(none.yLast).toBe(none.y0);
    expect(against.yMax - against.y0).toBeLessThan(1.2);
    expect(against.xLast).toBeCloseTo(309.7, 3);
  });

  it('stops at the vanilla full-block face (player width 0.6 → x=309.7)', () => {
    const wall = trace('walk-into-full-block');
    expect(wall.yLast).toBe(80);
    expect(wall.xLast).toBeCloseTo(309.69999998807907, 5);
  });

  it('walks up stairs and onto a bottom slab in the vanilla traces', () => {
    const stairs = trace('walk-up-stairs');
    const slab = trace('walk-onto-slab');
    expect(stairs.yMax).toBe(82);
    expect(slab.yMax).toBe(80.5);
  });

  it('patched prismarine-physics 26.2 climbs a ladder only when jump is held, and collides with a full block', () => {
    const { Physics, Block, registry } = loadPhysics();
    const Z = 20;
    const w = world(Block, registry, (x, y, z) => {
      if (y <= 79) return 'smooth_stone';
      if (x === 304 && z === Z && y >= 80 && y <= 85) return 'stone';
      if (x === 303 && z === Z && y >= 80 && y <= 84) return 'ladder';
      if (x === 310 && z >= Z - 1 && z <= Z + 1 && y >= 80 && y <= 82) return 'stone';
      return 'air';
    });
    const physics = Physics(registry, w);

    const climber = body(new Vec3(303.5, 80, Z + 0.5));
    climber.control.jump = true;
    for (let i = 0; i < 24; i++) physics.simulatePlayer(climber, w);
    expect(climber.pos.y - 80).toBeGreaterThan(1.5);
    expect(climber.pos.x).toBeCloseTo(303.5, 2);
    // Vanilla jump-only rose ~2.70 over 24 * 50ms samples (~24 ticks).
    expect(Math.abs((climber.pos.y - 80) - (trace('ladder-jump-only').yLast - 80))).toBeLessThan(1.25);

    const walker = body(new Vec3(303.5, 80, Z + 0.5));
    walker.control.jump = false;
    walker.control.forward = true;
    for (let i = 0; i < 24; i++) physics.simulatePlayer(walker, w);
    expect(walker.pos.y).toBeCloseTo(80, 1);

    const bumper = body(new Vec3(308.5, 80, Z + 0.5), { yaw: -Math.PI / 2 });
    bumper.control.forward = true;
    for (let i = 0; i < 24; i++) physics.simulatePlayer(bumper, w);
    expect(bumper.pos.x).toBeCloseTo(309.7, 1);
    expect(bumper.pos.y).toBeCloseTo(80, 1);
    expect(Math.abs(bumper.pos.x - trace('walk-into-full-block').xLast)).toBeLessThan(0.05);
  });
});
