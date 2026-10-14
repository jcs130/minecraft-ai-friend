import type { Bot } from 'mineflayer';
import { checkAbort, SkillBlocked, type SkillContext } from './skill-context.ts';

/** look(force=true) updates local state; physics writes rotation after tick listeners return.
 * Continue on the next microtask before an action, including protocols whose use-item has no rotation. */
export async function flushActionAim(bot: Bot, ctx: SkillContext, action = '抛出'): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearInterval(poll); clearTimeout(timeout);
      bot.off('physicsTick', tick); bot.off('end', ended);
      if (error) reject(error); else resolve();
    };
    const tick = (): void => finish();
    const ended = (): void => finish(new SkillBlocked(`连接已结束，尚未${action}`));
    const poll = setInterval(() => { try { checkAbort(ctx); } catch (error) { finish(error as Error); } }, 50);
    const timeout = setTimeout(() => finish(new SkillBlocked(`未等到朝向发送的物理刻，尚未${action}`)), 1000);
    bot.once('physicsTick', tick); bot.once('end', ended);
  });
  checkAbort(ctx);
}
