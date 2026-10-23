import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { installPlacementMissState } from '../core/placement-miss-state.ts';
import { SkillBlocked } from '../core/skill-context.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('prismarine-registry')('1.20.6');
const Block = require('prismarine-block')(registry);
function rig() {
  const world = new Map<string, any>();
  const target = new Vec3(1, 64, 0), support = target.offset(0, -1, 0);
  const set = (p: Vec3, name: string) => {
    const block = Block.fromProperties(registry.blocksByName[name].id, {}); block.position = p; world.set(p.toString(), block); return block;
  };
  const air = Block.fromProperties(registry.blocksByName.air.id, {});
  let sends = 0, permission = true;
  const bot: any = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(.5, 64, 2.5) }, game: { dimension: 'overworld' },
    heldItem: { name: 'rail' }, placeMisses: [],
    blockAt: (p: Vec3) => world.has(p.toString()) ? world.get(p.toString()) : air,
    placeBlock: async () => {
      if (!permission) throw new SkillBlocked('authoritative protection denial', [], 'server');
      if (bot.placeMisses.some((m: any) => m.x === 1 && m.y === 64 && m.z === 0)) throw Error('cached failure');
      sends++;
      if (bot.blockAt(support).name === 'air') {
        bot.placeMisses.push({ x: 1, y: 64, z: 0, was: 'air', at: Date.now() });
        throw Error('unconfirmed placement');
      }
      set(target, bot.heldItem.name);
    },
  });
  const original = bot.placeBlock;
  const handle = installPlacementMissState(bot as Bot);
  return { bot, target, support, set, handle, original, sends: () => sends, deny: () => { permission = false; }, unload: (p: Vec3) => world.set(p.toString(), null),
    place: () => bot.placeBlock({ position: support }, new Vec3(0, 1, 0)) };
}

describe('placement failure state across composed operations', () => {
  it('retains the existing limit when the scene has not changed', async () => {
    const r = rig();
    await expect(r.place()).rejects.toThrow('unconfirmed');
    await expect(r.place()).rejects.toThrow('cached');
    expect(r.sends()).toBe(1); expect(r.handle.invalidations).toEqual([]);
  });
  it('retries after the roadbed changes while the target remains air', async () => {
    const r = rig();
    await expect(r.place()).rejects.toThrow('unconfirmed');
    const after = r.set(r.support, 'dirt');
    r.bot.emit('blockUpdate', null, after);
    expect(r.bot.blockAt(r.target).name).toBe('air');
    await r.place();
    expect(r.sends()).toBe(2); expect(r.bot.blockAt(r.target).name).toBe('rail');
    expect(r.handle.invalidations).toHaveLength(1);
  });
  it('does not reuse a failed material or standing position as an immutable cell ban', async () => {
    for (const change of [(r: ReturnType<typeof rig>) => { r.bot.heldItem = { name: 'stone' }; },
      (r: ReturnType<typeof rig>) => { r.bot.entity.position = new Vec3(2.5, 64, .5); }]) {
      const r = rig(); await expect(r.place()).rejects.toThrow('unconfirmed');
      change(r); await expect(r.place()).rejects.toThrow('unconfirmed');
      expect(r.sends()).toBe(2);
    }
  });
  it('retains unknown/legacy evidence and still honors authoritative protection', async () => {
    const unknown = rig();
    await expect(unknown.place()).rejects.toThrow('unconfirmed');
    unknown.unload(unknown.support); await expect(unknown.place()).rejects.toThrow('cached');
    expect(unknown.sends()).toBe(1);
    const r = rig();
    r.bot.placeMisses.push({ x: 1, y: 64, z: 0, was: 'air', at: Date.now() });
    r.set(r.support, 'dirt'); await expect(r.place()).rejects.toThrow('cached');
    expect(r.sends()).toBe(0);
    r.bot.placeMisses = []; r.deny();
    await expect(r.place()).rejects.toMatchObject({ source: 'server', message: 'authoritative protection denial' });
  });
  it('is idempotent and can restore the prior wrapper without changing world state', () => {
    const r = rig();
    expect(installPlacementMissState(r.bot)).toBe(r.handle);
    r.handle.rollback(); expect(r.bot.placeBlock).toBe(r.original); expect(r.bot.listenerCount('blockUpdate')).toBe(0);
  });
});
