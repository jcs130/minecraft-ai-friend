import type { Bot } from 'mineflayer';

/** 名字 → 物品定义;planks/bed 这两个类别词按包里的树种/羊毛色落地 */
export function craftItemDef(bot: Bot, item: string): { id: number; name: string } | undefined {
  const registry = bot.registry;
  let def = registry.itemsByName[item];
  if (!def && item === 'planks') {
    const log = bot.inventory.items().find((i) => i.name.endsWith('_log'));
    def = registry.itemsByName[log ? log.name.replace('_log', '_planks') : 'oak_planks'];
  }
  if (!def && item === 'bed') {
    const wool = bot.inventory.items().find((i) => i.name.endsWith('_wool'));
    def = registry.itemsByName[wool ? wool.name.replace('_wool', '_bed') : 'white_bed'];
  }
  return def;
}

