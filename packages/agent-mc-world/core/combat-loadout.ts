import type { Bot } from 'mineflayer';
import { bestWeapon } from './melee.ts';
import { bestRangedWeapon, hasUsableArrows } from './ranged.ts';

/** Observed native body-controller capability, not a verdict on spell combat or
 * the world's goal. Unknown inventory is not proof of an empty backpack. */
export interface CombatLoadout {
  inventoryKnown: boolean;
  melee: string | null;
  ranged: string | null;
  arrows: number | null;
  canEngage: boolean | null;
}
export function combatLoadout(bot: Bot): CombatLoadout {
  const lifecycle = (bot as Bot & { deathLifecycle?: { inventorySynced?: boolean } }).deathLifecycle;
  if (typeof bot.inventory?.items !== 'function' || lifecycle?.inventorySynced === false)
    return { inventoryKnown: false, melee: null, ranged: null, arrows: null, canEngage: null };
  const melee = bestWeapon(bot)?.name ?? null, ranged = bestRangedWeapon(bot)?.name ?? null;
  const arrows = bot.inventory.items().filter(i => i.name === 'arrow').reduce((n,i) => n+i.count,0);
  return { inventoryKnown: true, melee, ranged, arrows, canEngage: !!melee || !!ranged && hasUsableArrows(bot) };
}
