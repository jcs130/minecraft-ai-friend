import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Executor } from '../core/executor.ts';
import { skillCraft } from '../core/skills-craft.ts';
import { narrateWorldSegments, snapshotFromBot } from '../core/terrain.ts';

const dependency = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = dependency('prismarine-registry')('1.21.1');
const Item = dependency('prismarine-item')(registry);
afterEach(() => vi.useRealTimers());

function rig() {
  vi.useFakeTimers();
  const slots = Array(46).fill(null);
  slots[9] = new Item(registry.itemsByName.mutton.id, 4);
  slots[10] = new Item(registry.itemsByName.melon_slice.id, 37);
  const write = vi.fn(), equip = vi.fn(), craft = vi.fn();
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '1.21.1', _client: Object.assign(new EventEmitter(), { write }),
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    game: { dimension: 'overworld', gameMode: 'survival' }, entities: {}, players: {},
    health: 18, food: 17, time: { timeOfDay: 1000 },
    inventory: { slots, selectedItem: null, items: () => slots.slice(9, 45).filter(Boolean) },
    heldItem: null, currentWindow: null, blockAt: () => null, findBlocks: () => [],
    recipesAll: vi.fn(() => []), equip, craft,
  });
  let id = 0;
  const exec = new Executor({ getBot: () => bot as never, nextId: () => ++id,
    report: vi.fn(), busyWith: () => 'existing action',
    log: { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} } as never });
  return { bot, slots, exec, write, equip, craft };
}

describe('verified inventory identities and craft correction', () => {
  it('keeps actual native IDs available alongside Chinese inventory quantities', () => {
    const r = rig();
    const before = snapshotFromBot(r.bot, { scanBlocks: false });
    const parts = narrateWorldSegments(before);
    const identities = parts.find(part => part.key === 'inventoryIds');
    expect(identities?.text).toContain('生羊肉=mutton');
    expect(identities?.text).toContain('西瓜片=melon_slice');
    expect(identities?.text).not.toContain('raw_mutton');
    expect(parts.find(part => part.key === 'gear')?.text).toContain('生羊肉×4');
    r.slots[11] = new Item(registry.itemsByName.mutton.id, 2);
    expect(narrateWorldSegments(snapshotFromBot(r.bot, { scanBlocks: false }))
      .find(part => part.key === 'inventoryIds')?.cmp).toBe(identities?.cmp);
    const unsynced = narrateWorldSegments({ ...before, invSynced: false, inventorySync: { phase: 'quarantined' } });
    expect(unsynced.find(part => part.key === 'inventoryIds')?.text).not.toContain('mutton');
  });

  it('rejects unknown grid IDs as identity errors without declaring known food absent or replacing queued work', () => {
    const r = rig();
    const prior = r.exec.submitDetailed([{ skill: 'chat', text: 'kept offline' }], 'append');
    expect(prior.accepted).toBe(true);
    const queued = r.exec.status().waiting.map(task => task.id);
    const rejected = r.exec.submitDetailed([{ skill: 'craft', grid: [['raw_mutton']], count: 1 }], 'replace');
    expect(rejected.accepted).toBe(false);
    expect(rejected.receipt).toContain('未知物品 ID');
    expect(rejected.receipt).toContain('raw_mutton');
    expect(rejected.receipt).toContain('生羊肉=mutton');
    expect(rejected.receipt).not.toContain('包里 0');
    expect(r.exec.status().waiting.map(task => task.id)).toEqual(queued);
    expect(r.write).not.toHaveBeenCalled();
    expect(r.craft).not.toHaveBeenCalled();
  });

  it('does not send an impossible cooked-food recipe to a crafting grid', async () => {
    const r = rig();
    const result = skillCraft(r.bot as never, { skill: 'craft', item: 'cooked_mutton', count: 1 },
      { aborted: () => false } as never);
    await expect(result).rejects.toThrow(/合成配方表.*smelt/s);
    expect(r.write).not.toHaveBeenCalled();
    expect(r.equip).not.toHaveBeenCalled();
    expect(r.craft).not.toHaveBeenCalled();
    expect(r.slots[9].count).toBe(4);
  });
});
