/** 实体元数据字段位置取自 registry.entitiesByName 的 metadataKeys。 */
import type { Bot } from 'mineflayer';
import { matchBlockIds } from './travel.ts';
import { zhName } from './names.ts';
import { metaOf, type FactBot, type FactEntity } from './animal-state.ts';
export * from './animal-state.ts';

/** 羊毛元数据的低四位是颜色,第五位(0x10)是"剪过了"。 */
export const WOOL_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;

/** 染料 item 名 → 颜色名;不是染料返回 null。 */
export function dyeColorOf(item: string | null | undefined): string | null {
  if (!item || !item.endsWith('_dye')) return null;
  const color = item.slice(0, -'_dye'.length);
  return (WOOL_COLORS as readonly string[]).includes(color) ? color : null;
}

/** 这只羊现在的颜色;读不到返回 null。 */
export function readSheepColor(bot: FactBot, entity: FactEntity): string | null {
  const raw = metaOf(bot, entity, 'wool');
  if (typeof raw !== 'number') return null;
  return WOOL_COLORS[raw & 0x0f] ?? null;
}
/** 可攻击目标名限定为实体类型 ID 或在线玩家名。 */
/** use.target 只接受活物；无效目标的回执说明可接受类型及改用 at 的方块写法。 */
export function unknownUseTargetText(bot: Bot, target: string): string {
  const head = `use 的 target 只认活物(生物、玩家),「${target}」不是活物`;
  const ids = matchBlockIds(bot, target);
  if (ids.length === 0) return `${head};要右键一格方块的话写 {"skill":"use","at":[x,y,z]}`;
  // 现场恰好找得到那一格就把坐标一并给出:她照抄就能用
  const near = bot.findBlocks({ matching: ids, maxDistance: 16, count: 1 })[0] ?? null;
  if (!near) {
    return `${head},它是方块 —— 右键方块写 {"skill":"use","at":[x,y,z]};` +
      `那一格在哪先用 {"skill":"find","target":"${target}","distance":16} 问一句`;
  }
  return `${head},它是方块 —— 右键它写 {"skill":"use","at":[${near.x},${near.y},${near.z}]}` +
    `(${zhName(target)}就在那一格,16 格内看得见的最近一处)`;
}

export function isKnownTarget(bot: Bot, name: string): boolean {
  const n = name.toLowerCase();
  const entities = (bot.registry as unknown as { entitiesByName?: Record<string, unknown> }).entitiesByName;
  if (entities?.[n]) return true;
  return Object.keys(bot.players ?? {}).some((p) => p.toLowerCase() === n);
}

