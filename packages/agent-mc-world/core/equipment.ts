/** Equipment slot moves wait for server inventory snapshots before reporting success. */
import type { Bot } from 'mineflayer';
import { clickInventoryConfirmed, isInventoryClickError, resumeInventoryCursor,
  sameInventoryStack } from './inventory-click-sync.ts';
import { itemCustomName } from './item-display.ts';
import { zhName } from './names.ts';
import { SkillBlocked } from './skill-context.ts';

type EquipmentDestination = 'head' | 'torso' | 'legs' | 'feet' | 'off-hand' | 'hand';
type Item = NonNullable<Bot['heldItem']>;
const itemText = (item: Item | null): string => item ? itemCustomName(item) ?? zhName(item.name) : '空';

function requirePlayerInventory(bot: Bot): void {
  if (bot.currentWindow) throw new SkillBlocked('换装需要先关闭当前容器窗口');
}

async function equipmentMove(bot: Bot, slot: number, move: () => Promise<void>): Promise<void> {
  try { await move(); } catch (error) {
    if (!isInventoryClickError(error)) throw error;
    throw new SkillBlocked(`换装未确认：${(error as Error).message}；装备槽回读为${itemText(bot.inventory.slots[slot])}，` +
      `光标为${itemText(bot.inventory.selectedItem)}。先核对库存，不重复换装`,
    [], 'server', 'inventory-click-sync');
  }
}

/** Direct slot exchanges keep the cursor empty without moving unrelated hotbar items. */
async function swapOffHandConfirmed(bot: Bot, source: number, destination: number, checkActive?: () => void): Promise<void> {
  const window = bot.inventory, start = window.hotbarStart;
  const quickBar = Array.from({ length: 9 }, (_, i) => start + i);
  checkActive?.();
  if (quickBar.includes(source)) {
    await clickInventoryConfirmed(bot, destination, source - start, 2, window, checkActive);
    return;
  }
  // F over the source swaps it directly with offhand. An unrelated hotbar
  // shortcut may be protected by the server even when both intended slots are
  // movable; it must not be borrowed as scratch storage. A denial stops here.
  await clickInventoryConfirmed(bot, source, 40, 2, window, checkActive);
}

/** Each inventory move has its own authoritative slot and cursor confirmation. */
export async function equipSlotConfirmed(bot: Bot, item: Item, dest: EquipmentDestination, checkActive?: () => void): Promise<void> {
  checkActive?.();
  requirePlayerInventory(bot);
  const slot = bot.getEquipmentDestSlot(dest);
  if (item.slot === slot) return;
  await equipmentMove(bot, slot, async () => {
    if (bot.supportFeature?.('stateIdUsed') !== true) {
      await bot.equip(item, dest);
      return;
    }
    const window = bot.inventory;
    await resumeInventoryCursor(bot, checkActive);
    checkActive?.();
    const source = item.slot;
    const found = window.slots[source];
    if (!found || !sameInventoryStack(found, item)) {
      throw new SkillBlocked('待穿装备所在槽位已经变化，先重新核对背包');
    }
    if (dest === 'hand' && slot >= window.hotbarStart && slot < window.hotbarStart + 9
      && ((source >= window.inventoryStart && source < window.inventoryEnd)
        || source === bot.getEquipmentDestSlot('off-hand'))) {
      // A number-key swap preserves both complete stacks and an empty cursor,
      // even with a full bag or compatible stacks already in the selected hand.
      await clickInventoryConfirmed(bot, source, slot - window.hotbarStart, 2, window, checkActive);
      return;
    }
    if (dest === 'off-hand' && source >= window.inventoryStart && source < window.inventoryEnd) {
      await swapOffHandConfirmed(bot, source, slot, checkActive);
      return;
    }
    await clickInventoryConfirmed(bot, source, 0, 0, window, checkActive);
    checkActive?.();
    await clickInventoryConfirmed(bot, slot, 0, 0, window, checkActive);
    checkActive?.();
    if (window.selectedItem) await clickInventoryConfirmed(bot, source, 0, 0, window, checkActive);
  });
  checkActive?.();
  const worn = bot.inventory.slots[slot];
  if (!worn || !sameInventoryStack(worn, item) || bot.inventory.selectedItem) {
    throw new SkillBlocked(`换装后装备槽回读为${itemText(worn)}，未确认穿上点名装备`, [], 'server');
  }
}

/** Hotbar selection needs no inventory move; other hand swaps use the same server barrier as armor. */
export async function equipHandConfirmed(bot: Bot, item: Item, checkActive?: () => void): Promise<void> {
  checkActive?.();
  requirePlayerInventory(bot);
  if (bot.supportFeature?.('stateIdUsed') !== true) {
    await bot.equip(item, 'hand');
    checkActive?.();
    if (!bot.heldItem || !sameInventoryStack(bot.heldItem, item)) {
      throw new SkillBlocked('主手回读未确认拿起点名物品', [], 'server');
    }
    return;
  }
  await resumeInventoryCursor(bot, checkActive);
  checkActive?.();
  const found = bot.inventory.slots[item.slot];
  if (!found || !sameInventoryStack(found, item)) {
    throw new SkillBlocked('待手持物品所在槽位已经变化，先重新核对背包');
  }
  const start = bot.inventory.hotbarStart;
  if (item.slot >= start && item.slot < start + 9) {
    bot.setQuickBarSlot(item.slot - start);
  } else {
    const window = bot.inventory, selected = bot.getEquipmentDestSlot('hand');
    const empty = window.slots[selected] ? window.slots.findIndex((entry, slot) =>
      slot >= start && slot < start + 9 && !entry) : -1;
    // Named server shortcuts are often immovable. With a full hotbar, prefer
    // exchanging an ordinary stack rather than moving that selected shortcut.
    // This is only destination selection: the server still confirms one swap,
    // and a rejection must never trigger attempts against the remaining slots.
    const ordinary = empty < 0 && itemCustomName(window.slots[selected] ?? {})
      ? window.slots.findIndex((entry, slot) => slot >= start && slot < start + 9
        && entry && !itemCustomName(entry)) : -1;
    const destination = empty >= 0 ? empty : ordinary;
    if (destination < 0) {
      await equipSlotConfirmed(bot, item, 'hand', checkActive);
    } else {
      // Keep the old selection until both stacks and the empty cursor are
      // confirmed, including cancellation during the ACK. No item is dropped.
      const source = item.slot, displaced = window.slots[destination];
      const sourceMatches = (): boolean => displaced
        ? Boolean(window.slots[source] && sameInventoryStack(window.slots[source], displaced)
          && window.slots[source]!.count === displaced.count)
        : !window.slots[source];
      await equipmentMove(bot, destination, () => clickInventoryConfirmed(bot, source, destination - start, 2, window, () => {
        checkActive?.();
        if (!sourceMatches() || !window.slots[destination] || !sameInventoryStack(window.slots[destination], item)
          || window.slots[destination]!.count !== item.count
          || window.selectedItem) {
          throw new SkillBlocked('备用快捷栏或来源在派发前变化，换装未发送');
        }
      }));
      checkActive?.();
      if (!sourceMatches() || !window.slots[destination] || !sameInventoryStack(window.slots[destination], item)
        || window.slots[destination]!.count !== item.count || window.selectedItem) {
        throw new SkillBlocked('备用快捷栏未确认收到点名物品，未切换主手', [], 'server');
      }
      bot.setQuickBarSlot(destination - start);
    }
  }
  checkActive?.();
  if (!bot.heldItem || !sameInventoryStack(bot.heldItem, item) || bot.inventory.selectedItem) {
    throw new SkillBlocked('主手回读未确认拿起点名物品，先核对库存和游标', [], 'server');
  }
}

/** The caller checks storage capacity; cursor recovery never drops the item. */
export async function unequipSlotConfirmed(bot: Bot, dest: EquipmentDestination): Promise<void> {
  requirePlayerInventory(bot);
  const slot = bot.getEquipmentDestSlot(dest);
  await equipmentMove(bot, slot, async () => {
    if (bot.supportFeature?.('stateIdUsed') !== true) {
      await bot.unequip(dest);
      return;
    }
    await resumeInventoryCursor(bot);
    await clickInventoryConfirmed(bot, slot, 0, 0, bot.inventory);
    await resumeInventoryCursor(bot);
  });
  if (bot.inventory.slots[slot] || bot.inventory.selectedItem) {
    throw new SkillBlocked(`腾空后${dest === 'off-hand' ? '副手' : dest}回读为${itemText(bot.inventory.slots[slot])}，未确认收回背包`, [], 'server');
  }
}

export const clearOffHandConfirmed = (bot: Bot): Promise<void> => unequipSlotConfirmed(bot, 'off-hand');
