import '../core/dependency-patches.ts';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const mfRequire = createRequire(require.resolve('mineflayer'));
const injectDigging = mfRequire('./lib/plugins/digging.js') as (bot: unknown) => void;
const { Vec3 } = mfRequire('vec3');
const registry = mfRequire('prismarine-registry')('26.1');
const Block = mfRequire('prismarine-block')(registry);
const Item = mfRequire('prismarine-item')(registry);

function block(name: string, at: [number, number, number]) {
  const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
  b.position = new Vec3(...at);
  return b;
}

function rig(opts: { held?: string; eyeBlock?: string; onGround?: boolean } = {}) {
  const writes: Array<[string, any]> = [];
  const bot: any = Object.assign(new EventEmitter(), {
    registry,
    supportFeature: (f: string) => registry.supportFeature(f),
    _client: Object.assign(new EventEmitter(), { write: (n: string, p: unknown) => writes.push([n, p]) }),
    entity: { position: new Vec3(0.5, 50, 0.5), eyeHeight: 1.62, onGround: opts.onGround ?? true, effects: {}, attributes: {} },
    lookAt: async () => {}, swingArm() { writes.push(['swing', null]); },
    _updateBlockState(pos: any) { bot.emit(`blockUpdate:${pos}`, null, { type: 0 }); }, getEquipmentDestSlot: () => 5,
    blockAt: (p: any) => (opts.eyeBlock && p.floored().y === 51 ? block(opts.eyeBlock, [0, 51, 0]) : null),
    inventory: { slots: [] }, heldItem: opts.held ? new Item(registry.itemsByName[opts.held].id, 1) : null,
    game: { gameMode: 'survival' }, _clientTicks: 0,
  });
  injectDigging(bot);
  const tick = () => { bot._clientTicks++; bot.emit('clientTick'); };
  return { bot, writes, tick };
}

describe('26.1 break time like Player.getDestroySpeed / Grim BlockBreakSpeed', () => {
  it('matches vanilla ticks for tools, hand, air and instant blocks', () => {
    expect(rig({ held: 'iron_shovel' }).bot._modernDigTicks(block('dirt', [1, 50, 0]))).toBe(3);
    expect(rig({ held: 'iron_pickaxe' }).bot._modernDigTicks(block('stone', [1, 50, 0]))).toBe(8);
    expect(rig().bot._modernDigTicks(block('stone', [1, 50, 0]))).toBe(150);
    expect(rig({ held: 'iron_pickaxe', onGround: false }).bot._modernDigTicks(block('stone', [1, 50, 0]))).toBe(38);
    expect(rig({ held: 'iron_shovel' }).bot._modernDigTicks(block('snow_block', [1, 50, 0]))).toBe(0);
    expect(rig().bot._modernDigTicks(block('bedrock', [1, 50, 0]))).toBe(Infinity);
  });

  it('applies haste, mining fatigue, submerged mining and attribute modifiers', () => {
    const haste = rig({ held: 'iron_pickaxe' });
    haste.bot.entity.effects[registry.effectsByName.Haste.id] = { amplifier: 1 };
    expect(haste.bot._modernDigTicks(block('stone', [1, 50, 0]))).toBe(6); // 6*1.4/45
    const fatigue = rig({ held: 'iron_pickaxe' });
    fatigue.bot.entity.effects[registry.effectsByName.MiningFatigue.id] = { amplifier: 0 };
    expect(fatigue.bot._modernDigTicks(block('stone', [1, 50, 0]))).toBeGreaterThanOrEqual(25); // 6*0.3/45
    const eff = rig({ held: 'iron_pickaxe' });
    eff.bot.entity.attributes['minecraft:mining_efficiency'] = { value: 26, modifiers: [] }; // Efficiency V
    expect(eff.bot._modernDigTicks(block('stone', [1, 50, 0]))).toBe(2);
    const speed = rig({ held: 'iron_pickaxe' });
    speed.bot.entity.attributes['minecraft:block_break_speed'] = { value: 1, modifiers: [{ operation: 2, amount: 1 }] };
    expect(speed.bot._modernDigTicks(block('stone', [1, 50, 0]))).toBe(4);
    expect(rig({ held: 'iron_pickaxe', eyeBlock: 'water' }).bot._modernDigTicks(block('stone', [1, 50, 0]))).toBe(38);
  });
});

describe('26.1 dig packets on the client tick like Grim FastBreak expects', () => {
  it('finishes one tick after vanilla, swings every tick and waits destroyDelay before the next START', async () => {
    const { bot, writes, tick } = rig({ held: 'iron_shovel' });
    const p = bot.dig(block('dirt', [1, 50, 0]), true);
    await new Promise((r) => setTimeout(r, 5));
    const digs = () => writes.filter(([n]) => n === 'block_dig').map(([, x]) => x.status);
    expect(digs()).toEqual([0]);
    for (let i = 0; i < 4; i++) tick();
    expect(digs()).toEqual([0]); // 3-tick block: not before tick 5
    tick(); await p;
    expect(digs()).toEqual([0, 2]);
    expect(writes.filter(([n]) => n === 'swing').length).toBeGreaterThanOrEqual(4);
    const q = bot.dig(block('dirt', [1, 50, 1]), true);
    await new Promise((r) => setTimeout(r, 5));
    expect(digs()).toEqual([0, 2]); // destroyDelay: no START right after a FINISH
    for (let i = 0; i < 6; i++) tick();
    await new Promise((r) => setTimeout(r, 5));
    expect(digs()).toEqual([0, 2, 0]);
    bot.stopDigging(); await q.catch(() => {});
  });

  it('sends START only for an instant break', async () => {
    const { bot, writes } = rig({ held: 'iron_shovel' });
    await bot.dig(block('snow_block', [1, 50, 0]), true);
    expect(writes.filter(([n]) => n === 'block_dig').map(([, x]) => x.status)).toEqual([0]);
  });
});
