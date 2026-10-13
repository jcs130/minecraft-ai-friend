/** Orient the player toward a coordinate without changing position or interacting. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { cellText, resolveAt } from './cell-facts.ts';
import { SkillBlocked, checkAbort, type SkillContext } from './skill-context.ts';
import type { SkillCall } from './skills.ts';

export async function skillLook(bot: Bot, call: Extract<SkillCall, { skill: 'look' }>, ctx: SkillContext): Promise<string> {
  checkAbort(ctx);
  const cell = resolveAt(bot, call.at);
  const point = new Vec3(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
  const eyes = bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0);
  if (eyes.distanceTo(point) < 0.001) throw new SkillBlocked('目标与眼睛位置重合，没有可确定的朝向');
  await bot.lookAt(point, true);
  await bot.waitForTicks(1);
  checkAbort(ctx);
  return `已原地转头朝向 ${cellText(cell)} 的中心；没有移动或交互，目标是否可见须查看实际画面`;
}
