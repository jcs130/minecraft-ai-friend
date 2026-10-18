import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { expect, it, vi } from 'vitest';
import { useOnce } from '../core/skills-interact.ts';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.21.1');
const Item = req('prismarine-item')(registry);
const Block = req('prismarine-block')(registry);

it.each(['air', 'cave_air', 'void_air', 'water', 'lava'])('reports the actual %s target before full-bag hand preparation', async name => {
  const slots = Array.from({ length: 46 }, (_, slot) => {
    if (slot < 9 || slot > 44) return null;
    const item = new Item(registry.itemsByName.stone_pickaxe.id, 1);
    item.slot = slot;
    return item;
  });
  const bot = {
    registry, entity: { position: new Vec3(1.5, 64, .5) }, game: { dimension: 'overworld' },
    heldItem: slots[36], inventory: { slots, items: () => slots.slice(9, 45), selectedItem: null },
    blockAt: (position: Vec3) => {
      const kind = position.y < 64 ? 'stone' : name;
      const block = Block.fromStateId(registry.blocksByName[kind].minStateId, 0);
      block.position = position.clone();
      return block;
    },
    equip: vi.fn(), unequip: vi.fn(), activateBlock: vi.fn(), activateItem: vi.fn(),
  };
  await expect(useOnce(bot as unknown as Bot, { skill: 'use', at: [1, 64, 0] },
    { aborted: () => false } as never)).rejects.toThrow('右键它不产生任何动作');
  expect(bot.equip).not.toHaveBeenCalled();
  expect(bot.unequip).not.toHaveBeenCalled();
  expect(bot.activateBlock).not.toHaveBeenCalled();
  expect(bot.activateItem).not.toHaveBeenCalled();
  expect(bot.heldItem).toBe(slots[36]);
});
