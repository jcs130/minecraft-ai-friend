import type { Bot } from 'mineflayer';
import { readEnchants, type ItemLike } from './item-facts.ts';
import { checkAbort, sleep, SkillBlocked, type SkillContext } from './skill-context.ts';

export interface EnchantmentTargetWindow {
  id: number;
  targetItem(): (ItemLike & { name: string }) | null;
}

/** Mineflayer enchant() waits indefinitely for updateSlot:0. Send the same
 * native packet once, then reconcile the actual window item with a bounded,
 * cancellable read. A timeout never authorizes another paid click. */
export async function enchantOnceConfirmed(bot: Bot, win: EnchantmentTargetWindow, choice: number, ctx: SkillContext): Promise<void> {
  checkAbort(ctx);
  const active = () => bot.currentWindow === (win as unknown) && bot._client?.state === 'play';
  if (!active()) throw new SkillBlocked('附魔窗口或连接已变化，未发送附魔请求');
  const before = win.targetItem();
  if (!before) throw new SkillBlocked('附魔槽为空，未发送附魔请求');
  const signature = (item: ItemLike) => JSON.stringify(readEnchants(item, bot.registry).map(e => [e.name, e.level]).sort());
  const prior = signature(before);
  if (!Number.isInteger(choice) || choice < 0 || choice > 2) throw new SkillBlocked('附魔档位应为1/2/3，未发送请求');
  bot._client.write('enchant_item', { windowId: win.id, enchantment: choice });
  ctx.diag?.write({lane:'skill',event:'enchant-requested',msg:'已发送一次附魔请求，等待真实物品变化',
    data:{windowId:win.id,choice:choice+1,item:before.name}});
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    checkAbort(ctx);
    if (!active()) break;
    const after = win.targetItem();
    const expectedItem = after?.name === before.name || before.name === 'book' && after?.name === 'enchanted_book';
    if (after && expectedItem && readEnchants(after, bot.registry).length > 0 && signature(after) !== prior) return;
    await sleep(80);
  }
  throw new SkillBlocked('附魔请求已发送，但未确认目标物品的新附魔；结果未知。先核对背包、等级和青金石，不要重复点击扣费。');
}
