import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refAt } from '../core/cell-facts.ts';
import { matchPlacedMaterialName, placeIntoCell, usableReference } from '../core/placement.ts';
import { skillBuild } from '../core/skills-build.ts';
import { SkillBlocked, type SkillContext } from '../core/skill-context.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('prismarine-registry')('1.20.6');
const Block = require('prismarine-block')(registry);
const target = new Vec3(1, 64, 0), support = target.offset(0, -1, 0);
function rig(outcome: 'accepted' | 'no-ack' | 'denied' = 'accepted') {
  const world = new Map<string, any>();
  const set = (point: Vec3, name: string) => {
    const b = Block.fromProperties(registry.blocksByName[name].id, {});
    b.position = point; world.set(point.toString(), b); return b;
  };
  const air = set(target, 'air'), farmland = set(support, 'farmland');
  const item = { name: 'wheat_seeds', count: 2, type: registry.itemsByName.wheat_seeds.id };
  const place = vi.fn(async (reference: any, face: Vec3) => {
    expect(reference.name).toBe('farmland'); expect(face).toEqual(new Vec3(0, 1, 0));
    if (outcome === 'denied') throw new SkillBlocked('authoritative protection denial', [], 'server');
    if (outcome === 'accepted') { set(target, 'wheat'); item.count--; }
  });
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { position: new Vec3(.5, 64, 2.5), height: 1.8, width: .6 },
    game: { dimension: 'overworld' }, heldItem: item,
    inventory: { items: () => [item] },
    blockAt: (p: Vec3) => world.get(p.toString()) ?? air,
    setControlState: vi.fn(), placeBlock: place,
  }) as unknown as Bot;
  const ctx = { aborted: () => false, taskId: 1 } as SkillContext;
  return { bot, ctx, place, farmland };
}
afterEach(() => vi.useRealTimers());
describe('planting through composed build', () => {
  it('clicks the farmland top and verifies the crop rather than the seed item name', async () => {
    vi.useFakeTimers(); const r = rig();
    expect(refAt(r.bot, support)).toBe(true);
    expect(usableReference(r.bot, target, 'up')).toBe(r.farmland);
    const result = skillBuild(r.bot, { skill: 'build', material: 'wheat_seeds', anchors: [[1, 64, 0]] }, r.ctx);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toContain('放下了');
    expect(r.place).toHaveBeenCalledTimes(1);
    expect(r.bot.blockAt(target)?.name).toBe('wheat');
    expect(r.bot.heldItem?.count).toBe(1);
    expect(r.bot.setControlState).toHaveBeenLastCalledWith('sneak', false);
  });
  it('does not count native dispatch without a changed crop as success', async () => {
    vi.useFakeTimers(); const r = rig('no-ack');
    const result = placeIntoCell(r.bot, target, 'wheat_seeds', r.ctx, 'up');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBeNull(); expect(r.place).toHaveBeenCalledTimes(1);
    expect(r.bot.setControlState).toHaveBeenLastCalledWith('sneak', false);
  });
  it('preserves authoritative permission denial and releases the control key', async () => {
    const r = rig('denied');
    await expect(placeIntoCell(r.bot, target, 'wheat_seeds', r.ctx, 'up')).rejects.toThrow('protection denial');
    expect(r.bot.setControlState).toHaveBeenLastCalledWith('sneak', false);
  });
  it('uses crop identity without confusing other crops or harvested food with planting material', () => {
    const r = rig();
    for (const [material, crop] of [['wheat_seeds','wheat'], ['beetroot_seeds','beetroots'],
      ['carrot','carrots'], ['potato','potatoes'], ['melon_seeds','melon_stem'],
      ['pumpkin_seeds','pumpkin_stem'], ['torchflower_seeds','torchflower_crop']]) {
      expect(matchPlacedMaterialName(r.bot, material, crop)).toBe(true);
    }
    expect(matchPlacedMaterialName(r.bot, 'wheat_seeds', 'carrots')).toBe(false);
    expect(matchPlacedMaterialName(r.bot, 'beetroot', 'beetroots')).toBe(false);
    expect(matchPlacedMaterialName(r.bot, 'wheat_seeds', 'air')).toBe(false);
  });
  it('does not treat unloaded support or a crop with no usable collision face as farmland', () => {
    const r = rig();
    r.bot.blockAt = (() => null) as Bot['blockAt'];
    expect(usableReference(r.bot, target, 'up')).toBeNull();
    r.bot.blockAt = (() => Block.fromProperties(registry.blocksByName.wheat.id, {})) as Bot['blockAt'];
    expect(usableReference(r.bot, target, 'up')).toBeNull();
  });
});
