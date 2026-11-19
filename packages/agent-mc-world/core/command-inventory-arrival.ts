import type { Bot } from 'mineflayer';
import { playerInvIn } from './inventory.ts';
import { Aborted, SkillBlocked } from './skill-context.ts';

/** A server pack parses its own authenticated command reply. Item uses the registry name. */
export type InventoryArrivalMatcher = (text: string) =>
  { item: string; moved: number } | { rejected: string } | null;

/** The caller owns dispatch once the command matches. Unmatched commands use normal chat. */
export type InventoryCommandDispatch = (bot: Bot, text: string, send: () => void, signal?: AbortSignal) =>
  Promise<string> | undefined;

export class CommandInventoryArrival {
  private pending?: { bot: Bot; afterSequence: number; receive: (text: string) => void };

  observe(bot: Bot, sequence: number, text: string): void {
    if (this.pending?.bot === bot && sequence > this.pending.afterSequence) this.pending.receive(text);
  }

  async send(bot: Bot, match: InventoryArrivalMatcher, afterSequence: number, send: () => void,
    signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new Aborted();
    if (this.pending) throw new SkillBlocked('上一条取物命令仍在核对回执，本次未发送。');
    const window = bot.currentWindow ?? bot.inventory;
    const before = new Map<string, number>();
    for (const item of playerInvIn(bot, window).items()) before.set(item.name, (before.get(item.name) ?? 0) + item.count);
    let reply: { item: string; moved: number } | undefined;
    let close!: () => void;
    try {
      return await new Promise<string>((resolve, reject) => {
        let sent = false;
        const check = () => {
          if (!sent || !reply) return;
          const { item: name } = reply;
          const now = playerInvIn(bot, window).items().reduce((n, item) => n + (item.name === name ? item.count : 0), 0);
          if (now - (before.get(reply.item) ?? 0) >= reply.moved) {
            resolve(`服务端回执与随身背包增量一致：${reply.item} ×${reply.moved}。`);
          }
        };
        const interrupted = () => reject(new Aborted('取物期间身体或连接已改变；先核对本人库存，不自动重发'));
        const switchedWindow = () => reject(new SkillBlocked('取物期间库存窗口已切换；结果待核对，请先读取本人库存。', [], 'server'));
        const timeout = setTimeout(() => reject(new SkillBlocked(reply
          ? `服务端报告转入 ${reply.item} ×${reply.moved}，本人库存增量尚未核实。先核对物品，不要重发。`
          : '取物命令已发送，未在期限内收到匹配的服务端回执。先核对本人背包和来源槽，不要重发。', [], 'server')), 3_000);
        this.pending = { bot, afterSequence, receive: text => {
          if (reply) return;
          const result = match(text);
          if (!result) return;
          if ('rejected' in result) { reject(new SkillBlocked(result.rejected, [], 'server')); return; }
          reply = result;
          check();
        } };
        close = () => {
          this.pending = undefined;
          clearTimeout(timeout);
          signal?.removeEventListener('abort', interrupted);
          window.off('updateSlot', check);
          bot.off('end', interrupted);
          bot.off('death', interrupted);
          bot.off('respawn', interrupted);
          bot.off('windowOpen', switchedWindow);
          bot.off('windowClose', switchedWindow);
        };
        window.on('updateSlot', check);
        bot.on('end', interrupted);
        bot.on('death', interrupted);
        bot.on('respawn', interrupted);
        bot.on('windowOpen', switchedWindow);
        bot.on('windowClose', switchedWindow);
        signal?.addEventListener('abort', interrupted, { once: true });
        send();
        sent = true;
        check();
      });
    } finally { close?.(); }
  }
}
