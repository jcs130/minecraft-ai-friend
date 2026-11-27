import type { Bot } from 'mineflayer';
import { equipHandConfirmed } from './equipment.ts';
import { inventoryReadConfirmed } from './inventory-window-sync.ts';
import { checkAbort, SkillBlocked, sleep, type SkillContext } from './skill-context.ts';
import type { SkillCall } from './skills.ts';
import { bookMatchesPages, readBookItem } from './window-protocol.ts';
import { beginViewerInteraction, finishViewerInteraction } from './viewer-interaction.ts';

export async function skillBook(bot: Bot, call: Extract<SkillCall, { skill: 'book' }>, ctx: SkillContext): Promise<string> {
  checkAbort(ctx);
  if (!bot.supportFeature('hasEditBookPacket') || bot.supportFeature('editBookPacketUsesNbt')) {
    throw new SkillBlocked('此连接没有经过验证的原版书页编辑协议');
  }
  if (!inventoryReadConfirmed(bot) || bot.currentWindow) {
    throw new SkillBlocked('写书需要已同步的本人背包。关闭容器后再检查书目');
  }
  const requested = call.windowSlot === undefined ? bot.heldItem : bot.inventory.slots[call.windowSlot];
  if (requested?.name !== 'writable_book') {
    throw new SkillBlocked('这里没有可编辑的书与笔。用背包书目选择 writable_book 的槽位；已经署名的书无法改写');
  }
  const draft = readBookItem(requested);
  if (!call.title && draft && bookMatchesPages(draft, call.pages)) {
    return `书与笔已经是所请求的 ${call.pages.length} 页草稿，未重复写入`;
  }

  // The modern packet targets a player inventory index, not a window slot.
  // Move the exact selected stack with the ordinary confirmed hand operation.
  await equipHandConfirmed(bot, requested, () => checkAbort(ctx));
  const hand = bot.quickBarSlot;
  const inventory = bot.inventory;
  const slot = inventory.hotbarStart + hand;
  const original = inventory.slots[slot];
  // Allow the server to process any hand change before editing the book.
  await sleep(100);
  checkAbort(ctx);
  if (bot.inventory !== inventory || bot.currentWindow || bot.quickBarSlot !== hand
    || inventory.slots[slot] !== original || original?.name !== 'writable_book') {
    throw new SkillBlocked('编辑前主手或书本已经改变，未发送写入');
  }

  const signing = call.title !== undefined;
  const written = signing ? 'written_book' : 'writable_book';
  let confirmed = false;
  let disconnected = false;
  const update = (index: number) => {
    if (index !== slot) return;
    const adjusted = inventory.slots[slot];
    const book = readBookItem(adjusted);
    confirmed ||= adjusted?.name === written && !!book && bookMatchesPages(book, call.pages)
      && (!signing || (book.title === call.title && book.author === bot.username));
  };
  const onEnd = () => { disconnected = true; };
  inventory.on('updateSlot', update);
  bot.on('end', onEnd);
  const view = beginViewerInteraction(bot, {
    kind: 'book-write', title: call.title || '书与笔', text: call.pages[0] ?? '', pageCount: call.pages.length,
  });
  try {
    // Mineflayer's helper predicts pages locally and uses a separate listener.
    // Send the same vanilla packet here without mutating the inventory locally.
    bot._client.write('edit_book', { hand, pages: call.pages, title: call.title });
    const deadline = Date.now() + 8000;
    while (!confirmed && !disconnected && Date.now() < deadline) {
      await sleep(100);
      checkAbort(ctx);
    }
    if (!confirmed || disconnected || !inventoryReadConfirmed(bot) || bot.inventory !== inventory) {
      throw new SkillBlocked('未收到匹配的书本回执。重新查询背包和书页，勿直接重发署名', [], 'server');
    }
    finishViewerInteraction(bot, view, 'confirmed', signing ? '服务端已确认署名' : '服务端已保存书页');
    return signing ? `服务端已回传《${call.title}》，作者 ${bot.username}，正文 ${call.pages.length} 页已核对`
      : `服务端已回传书与笔，正文 ${call.pages.length} 页已核对，仍可编辑`;
  } finally {
    finishViewerInteraction(bot, view, 'unconfirmed');
    inventory.off('updateSlot', update);
    bot.off('end', onEnd);
  }
}
