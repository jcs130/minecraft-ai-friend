import '../core/dependency-patches.ts';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const mfRequire = createRequire(require.resolve('mineflayer'));
const injectDigging = mfRequire('./lib/plugins/digging.js') as (bot: unknown) => void;
const { Vec3 } = mfRequire('vec3');

function rig() {
  const writes: Array<[string, any]> = [];
  const bot: any = Object.assign(new EventEmitter(), {
    _client: Object.assign(new EventEmitter(), { write: (n: string, p: unknown) => writes.push([n, p]) }),
    entity: { position: new Vec3(0.5, 50, 0.5), eyeHeight: 1.62 }, lookAt: async () => {}, swingArm() {},
    digTime: () => 50, _updateBlockState() {}, supportFeature: () => false, getEquipmentDestSlot: () => 0,
    blockAt: () => null, inventory: { slots: [] }, heldItem: null, game: { gameMode: 'survival' },
  });
  injectDigging(bot);
  return { bot, writes };
}

async function startFace(bot: any, writes: Array<[string, any]>, at: [number, number, number]) {
  writes.length = 0;
  const p = bot.dig({ position: new Vec3(...at), name: 'stone', digTime: () => 50, shapes: [[0, 0, 0, 1, 1, 1]] }, true).catch(() => {});
  await new Promise((r) => setTimeout(r, 5));
  bot.stopDigging(); await p;
  return writes.filter(([n]) => n === 'block_dig').map(([, p]) => p);
}

describe('mineflayer dig packets like a vanilla 26.1 client', () => {
  it('names the face the look ray enters instead of always TOP', async () => {
    const { bot, writes } = rig();
    expect((await startFace(bot, writes, [1, 51, 0]))[0].face).toBe(4); // eye-level block east of us: WEST face
    expect((await startFace(bot, writes, [0, 51, -1]))[0].face).toBe(3); // north of us: SOUTH face
    expect((await startFace(bot, writes, [1, 50, 0]))[0].face).toBe(1); // feet level: TOP face
    expect((await startFace(bot, writes, [0, 49, 0]))[0].face).toBe(1); // below: TOP
    expect((await startFace(bot, writes, [0, 53, 0]))[0].face).toBe(0); // above head: BOTTOM
  });

  it('numbers every predicted dig action from one increasing sequence', async () => {
    const { bot, writes } = rig();
    const a = await startFace(bot, writes, [1, 50, 0]);
    const b = await startFace(bot, writes, [1, 51, 0]);
    const seqs = [...a, ...b].map((p) => p.sequence);
    expect(seqs).toEqual([1, 2, 3, 4]);
  });
});

describe('mineflayer movement keys like a vanilla 26.1 client', () => {
  it('defers sprint to the tick and coalesces the full player_input key state', () => {
    const injectPhysics = mfRequire('./lib/plugins/physics.js') as (bot: unknown, options: unknown) => void;
    const registry = mfRequire('minecraft-data')('26.1');
    const writes: Array<[string, any]> = [];
    const bot: any = Object.assign(new EventEmitter(), {
      _client: Object.assign(new EventEmitter(), { state: 'play', write: (n: string, p: unknown) => writes.push([n, p]) }),
      registry, version: '26.1', entity: { id: 9, position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), effects: {} },
      supportFeature: (f: string) => registry.supportFeature(f), world: { getBlock: () => null },
    });
    try { injectPhysics(bot, { physicsEnabled: false }); } catch { /* physics engine setup needs a world; controls are enough */ }
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    bot.setControlState('sneak', true);
    bot.setControlState('sprint', false);
    // 1.21.2+: the sprint state is decided and reported by the client tick (vanilla sendIsSprintingIfNeeded).
    expect(writes.filter(([n]) => n === 'entity_action')).toHaveLength(0);
    expect(writes.filter(([n]) => n === 'player_input')).toHaveLength(0); // flushed on the next tick
    expect(bot._pendingPlayerInput.inputs).toEqual({ forward: true, backward: false, left: false, right: false, jump: false, shift: true, sprint: false });
  });
});

describe('mineflayer teleports like a vanilla 26.1 client', () => {
  it('keeps the velocity the server sends with a setback and answers airborne without collision', () => {
    const injectPhysics = mfRequire('./lib/plugins/physics.js') as (bot: unknown, options: unknown) => void;
    const registry = mfRequire('minecraft-data')('26.1');
    const writes: Array<[string, any]> = [];
    const bot: any = Object.assign(new EventEmitter(), {
      _client: Object.assign(new EventEmitter(), { state: 'play', write: (n: string, p: unknown) => writes.push([n, p]) }),
      registry, version: '26.1', entity: { id: 9, position: new Vec3(0, 64, 0), velocity: new Vec3(0.2, 0, 0.2), effects: {}, isCollidedHorizontally: true },
      supportFeature: (f: string) => registry.supportFeature(f), world: { getBlock: () => null },
    });
    try { injectPhysics(bot, { physicsEnabled: false }); } catch { /* controls/teleport only */ }
    bot._client.emit('position', { teleportId: 3, x: 1, y: 65, z: 2, dx: 0, dy: -0.0784, dz: 0.05, yaw: 0, pitch: 0,
      flags: { x: false, y: false, z: false, yaw: true, pitch: true, dx: false, dy: false, dz: true } });
    expect(bot.entity.position.toArray()).toEqual([1, 65, 2]);
    expect(bot.entity.velocity.x).toBe(0);
    expect(bot.entity.velocity.y).toBeCloseTo(-0.0784);
    expect(bot.entity.velocity.z).toBeCloseTo(0.25);
    const reply = writes.find(([n]) => n === 'position_look')?.[1];
    expect(reply?.flags).toEqual({ onGround: false, hasHorizontalCollision: false });
  });
});
