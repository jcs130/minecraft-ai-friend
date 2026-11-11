import type { Bot } from 'mineflayer';

/** Bridge a real vanilla resource ID to Prismarine's bare registry keys.
 * Unknown namespaces and category-like resource IDs remain unchanged. */
export function registryTargetName(bot: Pick<Bot, 'registry'>, name: string): string {
  if (!name.startsWith('minecraft:')) return name;
  const bare = name.slice('minecraft:'.length);
  const registry = bot.registry as Bot['registry'] & { entitiesByName?: Record<string, unknown> };
  return registry.blocksByName?.[bare] || registry.itemsByName?.[bare] || registry.entitiesByName?.[bare]
    ? bare : name;
}
