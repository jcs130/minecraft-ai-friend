/** Mineflayer emits deletion before removing the bar from its public list. */
import type { EventEmitter } from 'node:events';

export function observeViewerBossBars(bot: EventEmitter, publish: () => void): () => void {
  const afterDelete = () => queueMicrotask(publish);
  bot.on('bossBarCreated', publish);
  bot.on('bossBarUpdated', publish);
  bot.on('bossBarDeleted', afterDelete);
  return () => {
    bot.off('bossBarCreated', publish);
    bot.off('bossBarUpdated', publish);
    bot.off('bossBarDeleted', afterDelete);
  };
}
