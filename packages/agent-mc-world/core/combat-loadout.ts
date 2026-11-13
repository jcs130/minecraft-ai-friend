import type { Bot } from 'mineflayer';
import { bestWeapon, meleeWeapons } from './melee.ts';
import { bestRangedWeapon, hasUsableArrows } from './ranged.ts';
import { itemsInReach } from './inventory.ts';
import { weaponCapabilities, type WeaponCapability } from './weapon-capabilities.ts';

/** Observed native body-controller capability, not a verdict on spell combat or
 * the world's goal. Unknown inventory is not proof of an empty backpack. */
export interface CombatLoadout {
  inventoryKnown: boolean;
  melee: string | null;
  ranged: string | null;
  arrows: number | null;
  canEngage: boolean | null;
  /** Supported modes; ammo, charge and effect are separate live prerequisites. */
  choices?: WeaponCapability[];
  choicesOmitted?: number;
  meleeOrder?: readonly string[];
  defense?: { offhand: string | null; carriedShields: number; shieldEquipped: boolean };
}
export function combatLoadout(bot: Bot, order: readonly string[] = []): CombatLoadout {
  const lifecycle = (bot as Bot & { deathLifecycle?: { inventorySynced?: boolean } }).deathLifecycle;
  if (typeof bot.inventory?.items !== 'function' || lifecycle?.inventorySynced === false)
    return { inventoryKnown: false, melee: null, ranged: null, arrows: null, canEngage: null };
  const melee = bestWeapon(bot, order)?.name ?? null, ranged = bestRangedWeapon(bot)?.name ?? null;
  const arrows = bot.inventory.items().filter(i => i.name === 'arrow').reduce((n,i) => n+i.count,0);
  const usable = new Set(meleeWeapons(bot).map(i => i.name));
  const choices = weaponCapabilities(itemsInReach(bot));
  return { inventoryKnown: true, melee, ranged, arrows, canEngage: !!melee || !!ranged && hasUsableArrows(bot),
    choices: choices.slice(0, 8).map(c => ({...c, melee:c.melee && usable.has(c.item)})),
    ...(choices.length > 8 ? {choicesOmitted:choices.length - 8} : {}), meleeOrder: [...order],
    defense: { offhand: bot.inventory.slots?.[45]?.name ?? null,
      carriedShields: bot.inventory.items().filter(i => i.name === 'shield' && i.slot !== 45).reduce((n,i) => n+i.count,0),
      shieldEquipped: bot.inventory.slots?.[45]?.name === 'shield' } };
}
