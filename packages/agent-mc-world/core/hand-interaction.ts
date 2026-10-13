/** 纯方块交互时，避免自定义右键物品抢走开门/开箱子的服务端动作。 */
import type { Bot } from 'mineflayer';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SkillBlocked } from './skill-context.ts';
import { itemCustomName } from './item-display.ts';

const MECHANISM = /(^|_)(?:door|trapdoor|fence_gate|button)$/;
const UTILITY = new Set([
  'lever', 'chest', 'trapped_chest', 'barrel', 'ender_chest',
  'furnace', 'blast_furnace', 'smoker', 'crafting_table',
  'anvil', 'chipped_anvil', 'damaged_anvil', 'grindstone',
  'loom', 'stonecutter', 'cartography_table', 'smithing_table',
  'enchanting_table', 'brewing_stand', 'lectern',
]);

const ORDINARY_TOOL = /_(?:sword|pickaxe|axe|shovel|hoe)$/;
const preparedInteractionHand = new AsyncLocalStorage<Bot>();

/** 调用方负责准备主手并在发包时核验；此调用中的导航包装不再更换主手。 */
export function withPreparedInteractionHand<T>(bot: Bot, action: () => T): T {
  return preparedInteractionHand.run(bot, action);
}

export function needsBareHandToInteract(name: string, heldItemName?: string | null): boolean {
  // 剑、镐等普通工具可以直接按原版机制开门和按按钮。只对可能把右键
  // 截走的道具腾手；否则满包时连受保护区域的门都打不开。
  if (MECHANISM.test(name)) return !heldItemName || !ORDINARY_TOOL.test(heldItemName);
  return UTILITY.has(name);
}

/** 已知有空背包格才 unequip；不能让 Mineflayer 在满包时把主手物品扔掉。 */
export async function clearHandForBlockInteraction(bot: Bot, requireEmpty = false): Promise<boolean> {
  if (!bot.heldItem) return false;
  const slots = bot.inventory?.slots;
  const hasRoom = Array.isArray(slots)
    ? slots.slice(9, 45).some((item) => item == null)
    : typeof bot.inventory?.items === 'function' && bot.inventory.items().length < 36;
  if (!requireEmpty && !hasRoom && typeof bot.equip === 'function') {
    const plainTool = bot.inventory.items().find((item) => ORDINARY_TOOL.test(item.name) && !itemCustomName(item));
    if (plainTool) {
      await bot.equip(plainTool, 'hand');
      if (bot.heldItem?.name === plainTool.name) return false;
    }
  }
  if (!hasRoom || typeof bot.unequip !== 'function') {
    if (requireEmpty) {
      throw new SkillBlocked('需要空手右键目标方块，但背包没有空格或无法腾空主手；没有继续右键，先整理背包或切到空快捷栏');
    }
    throw new SkillBlocked('需要空手操作门或功能方块，但背包没有空格且找不到可安全右键的普通工具；先整理背包或切到空快捷栏');
  }
  await bot.unequip('hand');
  if (bot.heldItem) throw new SkillBlocked('尝试腾空主手后仍拿着物品；这次没有继续右键');
  return true;
}

/** 寻路器的 useOne 开门直接调用 bot.activateBlock，也须走同一条腾手规则。 */
export function installNavigationBareHand(bot: Bot): void {
  const original = bot.activateBlock.bind(bot);
  bot.activateBlock = async (block, direction, cursorPos) => {
    if (preparedInteractionHand.getStore() !== bot
      && block && /(^|_)(?:door|fence_gate)$/.test(block.name)
      && needsBareHandToInteract(block.name, bot.heldItem?.name)) {
      await clearHandForBlockInteraction(bot);
    }
    return original(block, direction, cursorPos);
  };
}
