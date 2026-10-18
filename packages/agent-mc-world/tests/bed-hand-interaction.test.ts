import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { expect, it, vi } from 'vitest';
import { clearHandForBlockInteraction, needsBareHandToInteract } from '../core/hand-interaction.ts';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.21.1');
const beds = Object.keys(registry.blocksByName).filter(name => name.endsWith('_bed'));

function fullBag(ordinaryTool = true) {
  const tool = { name: ordinaryTool ? 'stone_pickaxe' : 'blaze_rod', count: 1, slot: 36 };
  const bot = {
    heldItem: tool,
    inventory: { slots: Array.from({ length: 45 }, () => tool), items: () => [tool] },
    equip: vi.fn(async (item: typeof tool) => { bot.heldItem = item; }),
    unequip: vi.fn(async () => { throw new Error('A full bag must never unequip or discard an item'); }),
  };
  return bot;
}

it('covers all registered Java 1.21.1 bed colours', () => {
  expect(beds).toHaveLength(16);
});

it.each(beds)('prepares bare block use on %s with a full inventory and a safe tool', async name => {
  const bot = fullBag();
  // This is the exact bareBlockUse call-site contract in executeUse. No
  // packet, sleep claim, item discard or target redirection is manufactured.
  await expect(clearHandForBlockInteraction(bot as unknown as Bot,
    !needsBareHandToInteract(name))).resolves.toBe(false);
  expect(bot.equip).toHaveBeenCalledWith(bot.heldItem, 'hand');
  expect(bot.unequip).not.toHaveBeenCalled();
  expect(bot.heldItem.name).toBe('stone_pickaxe');
});

it('does not use a custom-use item when a full bag has no safe ordinary tool', async () => {
  const bot = fullBag(false);
  await expect(clearHandForBlockInteraction(bot as unknown as Bot,
    !needsBareHandToInteract('red_bed'))).rejects.toThrow('找不到可安全右键的普通工具');
  expect(bot.equip).not.toHaveBeenCalled();
  expect(bot.unequip).not.toHaveBeenCalled();
});

it('keeps genuinely empty-hand interactions strict', async () => {
  const bot = fullBag();
  expect(needsBareHandToInteract('oak_sign')).toBe(false);
  await expect(clearHandForBlockInteraction(bot as unknown as Bot, true)).rejects.toThrow('需要空手右键');
  expect(bot.equip).not.toHaveBeenCalled();
  expect(bot.unequip).not.toHaveBeenCalled();
});
