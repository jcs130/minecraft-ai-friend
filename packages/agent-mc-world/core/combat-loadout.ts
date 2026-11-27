import type { Bot } from 'mineflayer';
import { bestWeapon, meleeWeapons } from './melee.ts';
import { selectRangedWeapon } from './ranged.ts';
import { inventoryReadConfirmed } from './inventory-window-sync.ts';
import { itemsInReach } from './inventory.ts';
import { weaponCapabilities, type WeaponCapability } from './weapon-capabilities.ts';

/** Observed native body-controller capability, not a verdict on spell combat or
 * the world's goal. Unknown inventory is not proof of an empty backpack. */
export interface CombatLoadout {
  inventoryKnown: boolean;
  melee: string | null;
  /** Currently usable for automatic ranged selection, including an already loaded crossbow. */
  ranged: string | null;
  /** Ordinary arrows stored in the main inventory. Other ammunition readiness is reflected in ranged. */
  arrows: number | null;
  canEngage: boolean | null;
  /** Supported modes and current ranged readiness; counts alone only indicate possession. */
  choices?: WeaponCapability[];
  choicesOmitted?: number;
  meleeOrder?: readonly string[];
  defense?: { offhand: string | null; carriedShields: number; shieldEquipped: boolean };
}
export function combatLoadout(bot: Bot, order: readonly string[] = []): CombatLoadout {
  const lifecycle = (bot as Bot & { deathLifecycle?: { inventorySynced?: boolean } }).deathLifecycle;
  if (typeof bot.inventory?.items !== 'function' || lifecycle?.inventorySynced === false || !inventoryReadConfirmed(bot))
    return { inventoryKnown: false, melee: null, ranged: null, arrows: null, canEngage: null };
  const melee = bestWeapon(bot, order)?.name ?? null, ranged = selectRangedWeapon(bot)?.item.name ?? null;
  const arrows = bot.inventory.items().filter(i => i.name === 'arrow').reduce((n,i) => n+i.count,0);
  const usable = new Set(meleeWeapons(bot).map(i => i.name));
  const choices = weaponCapabilities(itemsInReach(bot));
  return { inventoryKnown: true, melee, ranged, arrows, canEngage: !!melee || !!ranged,
    choices: choices.slice(0, 8).map(c => ({ ...c, melee: c.melee && usable.has(c.item),
      ...(c.ranged ? { rangedReady: Boolean(selectRangedWeapon(bot, c.item)) } : {}) })),
    ...(choices.length > 8 ? {choicesOmitted:choices.length - 8} : {}), meleeOrder: [...order],
    defense: { offhand: bot.inventory.slots?.[45]?.name ?? null,
      carriedShields: bot.inventory.items().filter(i => i.name === 'shield' && i.slot !== 45).reduce((n,i) => n+i.count,0),
      shieldEquipped: bot.inventory.slots?.[45]?.name === 'shield' } };
}
