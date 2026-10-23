import type { Bot } from 'mineflayer';
import { SkillBlocked, checkAbort, type SkillContext } from './skill-context.ts';
import { clickInventoryConfirmed, inventoryClickState } from './inventory-click-sync.ts';
import { inventoryOrganizationKey, inventoryOrganizationLimit, organizationSlotState, type OrganizationStack } from './inventory-organization.ts';

type Window = NonNullable<Bot['currentWindow']>;
const current = (bot: Bot) => bot.currentWindow ?? bot.inventory;
const clone = (item: OrganizationStack) => ({ ...item, componentMap: item.componentMap });
function same(bot: Bot, win: Window): void {
  if (current(bot) !== win) throw new SkillBlocked('精确搬物窗口已关闭或被替换；剩余物品未操作', [], 'local', 'container-window-changed');
}

/** Exact source slot and component-compatible destinations; neither type-wide lookup nor variant guessing. */
export async function transferInventoryStackConfirmed(bot: Bot, win: Window, from: number,
  start: number, end: number, count: number, ctx: SkillContext): Promise<number> {
  same(bot, win); checkAbort(ctx);
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isInteger(from) || from < 0 || from >= win.slots.length
    || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > win.slots.length || start >= end
    || (from >= start && from < end)) throw new SkillBlocked('精确搬物的源槽、目标范围或数量无效');
  if (win.selectedItem) throw new SkillBlocked('精确搬物前光标仍有物品，未开始');
  const source = win.slots[from];
  if (!source || source.count < count) throw new SkillBlocked('精确搬物的源槽数量已变化，未开始');
  const key = inventoryOrganizationKey(source), initial = organizationSlotState(source);
  let moved = 0, owned: string | null = null;
  try {
    await clickInventoryConfirmed(bot, from, 0, 0, win, () => {
      same(bot, win); checkAbort(ctx);
      if (win.slots[from] || organizationSlotState(win.selectedItem) !== initial)
        throw new SkillBlocked('精确搬物源槽在派发前变化，点击未发送');
    });
    owned = organizationSlotState(win.selectedItem);
    while (moved < count) {
      checkAbort(ctx); same(bot, win);
      const cursor = win.selectedItem as OrganizationStack | null;
      if (!cursor || inventoryOrganizationKey(cursor) !== key) throw new SkillBlocked('搬物光标已变化，后续操作停止');
      let into = -1, capacity = 0;
      for (let i = start; i < end; i++) {
        const target = win.slots[i], limit = inventoryOrganizationLimit(target ?? cursor);
        if (limit === undefined) continue;
        if ((!target || inventoryOrganizationKey(target) === key) && limit - (target?.count ?? 0) > 0) {
          into = i; capacity = limit - (target?.count ?? 0); break;
        }
      }
      if (into < 0) throw new SkillBlocked(`目标范围没有兼容空位；已确认移入 ${moved}，剩余未移`, [], 'local',
        'container-full', { status: moved ? 'partial' : 'blocked', completed: moved, remaining: count-moved, unit: 'items' });
      const held = clone(cursor), old = win.slots[into], max = Math.min(capacity, cursor.count);
      const amount = max <= count - moved ? max : 1;
      const placed = { ...held, count: (old?.count ?? 0) + amount };
      const carried = held.count === amount ? null : { ...held, count: held.count - amount };
      await clickInventoryConfirmed(bot, into, amount === max ? 0 : 1, 0, win, () => {
        same(bot, win); checkAbort(ctx);
        if (organizationSlotState(win.slots[into]) !== organizationSlotState(placed)
          || organizationSlotState(win.selectedItem) !== organizationSlotState(carried))
          throw new SkillBlocked('搬物目标或光标在派发前变化，点击未发送');
      });
      moved += amount; owned = win.selectedItem ? organizationSlotState(win.selectedItem) : null;
    }
  } finally {
    if (owned && win.selectedItem && current(bot) === win && inventoryClickState(bot).phase === 'ready'
      && organizationSlotState(win.selectedItem) === owned) {
      const target = win.slots[from], cursor = win.selectedItem as OrganizationStack;
      if (target && (inventoryOrganizationKey(target) !== key
        || target.count + cursor.count > (inventoryOrganizationLimit(target) ?? 0)))
        throw new SkillBlocked('源槽无法归还已确认光标；物品保留在光标上');
      const returned = { ...clone(cursor), count: (target?.count ?? 0) + cursor.count };
      await clickInventoryConfirmed(bot, from, 0, 0, win, () => {
        same(bot, win);
        if (win.selectedItem || organizationSlotState(win.slots[from]) !== organizationSlotState(returned))
          throw new SkillBlocked('归还光标时槽位发生变化，停止点击');
      });
    }
  }
  return moved;
}

/** Vanilla drop mode addresses a specific slot, preserving unselected same-ID variants. */
export async function discardInventorySlotConfirmed(bot: Bot, from: number, count: number, ctx: SkillContext): Promise<void> {
  const win = current(bot), source = win.slots[from];
  if (win.selectedItem || !source || !Number.isSafeInteger(count) || count < 1 || count > source.count)
    throw new SkillBlocked('精确丢弃的源槽、数量或光标不符，未抛出');
  const item = clone(source);
  let left = count;
  while (left > 0) {
    same(bot, win); checkAbort(ctx);
    const stack = win.slots[from];
    if (!stack || inventoryOrganizationKey(stack) !== inventoryOrganizationKey(item))
      throw new SkillBlocked('丢弃期间源槽变体已变化，剩余未抛');
    const amount = left === stack.count ? left : 1;
    const remaining = stack.count === amount ? null : { ...clone(stack), count: stack.count - amount };
    await clickInventoryConfirmed(bot, from, amount === stack.count ? 1 : 0, 4, win, () => {
      same(bot, win); checkAbort(ctx);
      if (win.selectedItem || organizationSlotState(win.slots[from]) !== organizationSlotState(remaining))
        throw new SkillBlocked('丢弃派发前槽位变化，未继续抛物');
    });
    left -= amount;
  }
}
