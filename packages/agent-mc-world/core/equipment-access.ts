import type { Bot } from 'mineflayer';
import { invItemNamed, wornItemNamed } from './inventory.ts';
import { unequipSlotConfirmed } from './equipment.ts';

export interface WornItemAccessResult {
  status: 'not-worn' | 'moved' | 'blocked' | 'unknown';
  reason?: string;
  item?: string;
  sourceSlot?: number;
  goal_completed: false;
}

/** One explicit inventory move, called only by the caller's existing body owner.
 * Never discovers a connection, queues work, starts a body, retries, or repairs an item. */
export async function takeWornItem(bot: Bot, item: string, pick?: string,
  checkActive?: () => void): Promise<WornItemAccessResult> {
  checkActive?.();
  const selected = wornItemNamed(bot, item, pick);
  if (!selected) return { status: 'not-worn', goal_completed: false };
  const meta = { item: selected.item.name, sourceSlot: selected.slot, goal_completed: false as const };
  if (bot.currentWindow) return { ...meta, status: 'blocked', reason: '先关闭当前容器窗口，再取下穿戴装备' };
  const inventory = bot.inventory;
  if (inventory.selectedItem) return { ...meta, status: 'blocked', reason: '物品光标不为空；先核对并收回光标，不自动移动装备' };
  if (!inventory.slots.some((value, slot) => slot >= inventory.inventoryStart && slot < inventory.inventoryEnd && !value))
    return { ...meta, status: 'blocked', reason: '背包没有空位收回装备；没有取下、丢弃或覆盖物品' };
  checkActive?.();
  try {
    // Complete this bounded slot/cursor transaction before yielding the body.
    await unequipSlotConfirmed(bot, selected.destination);
    if (inventory.slots[selected.slot] || inventory.selectedItem || !invItemNamed(bot, item, pick))
      return { ...meta, status: 'unknown', reason: '取下后的装备槽、背包或光标未确认；先读库存，不自动重试' };
    return { ...meta, status: 'moved' };
  } catch (error) {
    return { ...meta, status: 'unknown', reason: `取下装备未确认：${String(error).slice(0, 400)}；先读库存，不自动重试` };
  }
}
