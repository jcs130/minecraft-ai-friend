import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { skillCollect } from '../core/skills-gather.ts';
import { SkillBlocked, type SkillContext } from '../core/skill-context.ts';

vi.mock('../core/terrain.ts', async original => ({
  ...await original<typeof import('../core/terrain.ts')>(), canSeeBlockAt: () => true,
}));
vi.mock('../core/tools.ts', async original => ({
  ...await original<typeof import('../core/tools.ts')>(), equipToolFor: async () => {}, harvestFact: () => null,
}));
vi.mock('../core/travel.ts', async original => ({
  ...await original<typeof import('../core/travel.ts')>(), dropGoal: () => {},
  walkOnlyPath: () => () => {},
}));
vi.mock('../core/temporary-scaffold.ts', () => ({
  beginTemporaryScaffold: () => ({ finished: false }), closeTemporaryScaffold: () => {},
  reclaimTemporaryScaffold: async () => '',
}));
vi.mock('../core/placement.ts', async original => ({
  ...await original<typeof import('../core/placement.ts')>(),
  Upkeep: class { async light() {} tally() { return []; } },
}));

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('prismarine-registry')('1.20.6');
const Block = require('prismarine-block')(registry);

function rig(cells: Array<[number, number, number]>, pickup = true, failAt = -1) {
  const world = new Map<string, any>();
  const item = { name: 'carrot', type: registry.itemsByName.carrot.id, count: 1 };
  const set = (at: Vec3, name: string) => {
    const b = Block.fromProperties(registry.blocksByName[name].id, name === 'carrots' ? { age: 7 } : {});
    b.position = at; world.set(at.toString(), b); return b;
  };
  const air = set(new Vec3(0, 0, 0), 'air');
  cells.forEach(p => set(new Vec3(...p), 'carrots'));
  let digs = 0;
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { position: new Vec3(-8.5, 64, 3.5), onGround: true },
    game: { dimension: 'overworld' }, entities: {},
    inventory: { items: () => [item] },
    blockAt: (at: Vec3) => world.get(at.toString()) ?? air,
    findBlocks: () => [...world.values()].filter(b => b.name === 'carrots').map(b => b.position),
    canDigBlock: () => true, digTime: () => 1, stopDigging: vi.fn(),
    dig: vi.fn(async (b: any) => {
      if (digs++ === failAt) throw new Error('server denied');
      set(b.position, 'air'); if (pickup) item.count += 3;
    }),
  }) as unknown as Bot;
  const write = vi.fn();
  const ctx = { aborted: () => false, taskId: 7, diag: { write } } as unknown as SkillContext;
  return { bot, ctx, write };
}

afterEach(() => vi.useRealTimers());
describe('crop collection retains original executed cells', () => {
  it('keeps both heights at the same XZ, separate from the player feet and inventory gains', async () => {
    const r = rig([[-6, 64, -4], [-6, 65, -4]]);
    const receipt = await skillCollect(r.bot, 'carrots', 2, r.ctx);
    expect(receipt).toContain('实际入包 6 个');
    expect(receipt).toContain('carrots@(-6,64,-4)、carrots@(-6,65,-4)');
    expect(receipt).toContain('不代表当前为空');
    expect(receipt).toContain('不证明服务端委托计数');
    expect(r.write.mock.calls.map(c => c[0].data.at)).toEqual([{ x: -6, y: 64, z: -4 }, { x: -6, y: 65, z: -4 }]);
    expect(r.write.mock.calls.every(c => c[0].taskId === 7)).toBe(true);
  });
  it('retains a confirmed harvested cell even when no drop enters the inventory', async () => {
    vi.useFakeTimers(); const r = rig([[1, 64, 0]], false);
    const result = skillCollect(r.bot, 'carrots', 1, r.ctx).catch(e => e);
    await vi.runAllTimersAsync();
    const error = await result;
    expect(error).toBeInstanceOf(SkillBlocked);
    expect(error.message).toContain('一个都没进包');
    expect(error.scene.join('\n')).toContain('carrots@(1,64,0)');
    expect(r.write).toHaveBeenCalledTimes(1);
  });
  it('preserves partial evidence and never records an attempted but failed dig as harvested', async () => {
    const r = rig([[1, 64, 0], [2, 64, 0]], true, 1);
    const error = await skillCollect(r.bot, 'carrots', 2, r.ctx).catch(e => e);
    expect(error).toBeInstanceOf(SkillBlocked);
    expect(error.scene.join('\n')).toContain('carrots@(1,64,0)');
    expect(error.scene.join('\n')).not.toContain('carrots@(2,64,0)');
    expect(r.write).toHaveBeenCalledTimes(1);
  });
  it('bounds the prompt receipt while retaining every executed cell in task-linked diagnostics', async () => {
    const r = rig(Array.from({ length: 20 }, (_, i) => [i, 64, 0] as [number, number, number]));
    const receipt = await skillCollect(r.bot, 'carrots', 20, r.ctx);
    expect(receipt).toContain('另 4 格见本任务 crop-harvest 日志');
    expect(receipt.match(/carrots@/g)).toHaveLength(16);
    expect(r.write).toHaveBeenCalledTimes(20);
    expect(r.write.mock.calls[19][0].data.at.x).toBe(19);
  });
});
