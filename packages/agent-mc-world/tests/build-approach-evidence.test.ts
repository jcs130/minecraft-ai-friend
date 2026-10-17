import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { skillBuild } from '../core/skills-build.ts';
import { Aborted, SkillBlocked, type SkillContext } from '../core/skill-context.ts';
import { gotoGoal } from '../core/travel.ts';

vi.mock('../core/travel.ts', async original => ({ ...await original<typeof import('../core/travel.ts')>(), gotoGoal: vi.fn() }));
const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('prismarine-registry')('1.21.1');
const Block = require('prismarine-block')(registry);
function rig() {
  const blocks = new Map<string, any>();
  const set = (p: Vec3, name: string) => {
    const b = Block.fromProperties(registry.blocksByName[name].id, {}); b.position = p;
    blocks.set(p.toString(), b); return b;
  };
  const at = (p: Vec3) => blocks.get(p.toString()) ?? (() => {
    const b = Block.fromProperties(registry.blocksByName.air.id, {}); b.position = p; return b;
  })();
  const target = new Vec3(0, 96, 0); set(target.offset(0, -1, 0), 'dirt');
  const item = { name: 'dirt', type: registry.itemsByName.dirt.id, count: 10 };
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(.5, 70, 2.5), onGround: true, height: 1.8, width: .6 },
    game: { dimension: 'overworld' }, heldItem: item, inventory: { items: () => [item] },
    blockAt: at, world: { getBlock: at }, setControlState: vi.fn(), lookAt: vi.fn(async () => undefined),
    placeBlock: vi.fn(async (ref: any, face: Vec3) => { set(ref.position.plus(face), 'dirt'); item.count--; }),
  }) as unknown as Bot;
  const ctx = { aborted: () => false, taskId: 1, partial: vi.fn() } as unknown as SkillContext;
  return { bot, ctx, target, set, item };
}
afterEach(() => { vi.useRealTimers(); vi.mocked(gotoGoal).mockReset(); });

it('preserves the failed approach and measured height without claiming a target placement was sent', async () => {
  const r = rig();
  vi.mocked(gotoGoal).mockRejectedValue(new SkillBlocked('path needs an unsupported two-block rise'));
  const error = await skillBuild(r.bot, { skill: 'build', anchors: [[0, 96, 0]], material: 'dirt' }, r.ctx).catch(e => e);
  expect(error).toBeInstanceOf(SkillBlocked);
  expect(error.source).toBe('local');
  expect(error.message).toContain('path needs an unsupported two-block rise');
  expect(error.message).toContain('尚未发出对该目标的放置');
  expect(error.message).toContain('(0, 70, 2)');
  expect(error.message).toContain('高 26 格');
  expect(error.message).not.toContain('可用参照面未确认放置成功');
  expect(r.bot.placeBlock).not.toHaveBeenCalled();
  expect(r.item.count).toBe(10);
});

it('keeps a failed approach local to its cell and still completes a different reachable placement', async () => {
  vi.useFakeTimers(); const r = rig();
  r.set(new Vec3(1, 69, 0), 'dirt');
  vi.mocked(gotoGoal).mockRejectedValue(new Error('no route to the high cell'));
  const result = skillBuild(r.bot, { skill: 'build', anchors: [[0, 96, 0], [1, 70, 0]], material: 'dirt' }, r.ctx);
  await vi.runAllTimersAsync();
  const text = await result;
  expect(text).toContain('放上了 1/2');
  expect(text).toContain('no route to the high cell');
  expect(r.bot.placeBlock).toHaveBeenCalledTimes(1);
  expect(r.bot.blockAt(new Vec3(1, 70, 0))?.name).toBe('dirt');
  expect(r.bot.blockAt(r.target)?.name).toBe('air');
  expect(r.ctx.partial).toHaveBeenCalled();
});

it('propagates cancellation instead of reporting it as a failed placement', async () => {
  const r = rig(); const abort = new Aborted(); vi.mocked(gotoGoal).mockRejectedValue(abort);
  await expect(skillBuild(r.bot, { skill: 'build', anchors: [[0, 96, 0]], material: 'dirt' }, r.ctx)).rejects.toBe(abort);
  expect(r.bot.placeBlock).not.toHaveBeenCalled();
});
