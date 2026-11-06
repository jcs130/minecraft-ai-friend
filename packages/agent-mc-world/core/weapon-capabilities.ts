/** Shared selection facts. Scores are fallback preferences, not predicted damage. */
export const WEAPON_KIND_SCORE: Record<string, number> = { sword: 40, axe: 30, pickaxe: 20, shovel: 10, hoe: 5 };
export const WEAPON_TIER_SCORE: Record<string, number> = { netherite: 6, diamond: 5, iron: 4, stone: 3, golden: 2, wooden: 1 };

export function weaponScore(name: string): number {
  if (name === 'trident') return 44.5;
  if (name === 'mace') return 35;
  const kind = Object.keys(WEAPON_KIND_SCORE).find(k => name.endsWith(`_${k}`));
  if (!kind) return -1;
  const tier = Object.keys(WEAPON_TIER_SCORE).find(t => name.startsWith(`${t}_`));
  return WEAPON_KIND_SCORE[kind] + (tier ? WEAPON_TIER_SCORE[tier] : 0);
}

export function validMeleeWeaponOrder(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 8 && new Set(value).size === value.length
    && value.every(v => typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v) && weaponScore(v) >= 0);
}

export interface WeaponCapability {
  item: string;
  count: number;
  melee: boolean;
  ranged: 'automatic-bow' | 'explicit-trident-use' | 'native-script-only' | null;
}

/** Inventory facts only; no equipment change, inferred enchantment or automatic throw. */
export function weaponCapabilities(items: readonly { name: string; count?: number }[]): WeaponCapability[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if ((item.count ?? 1) <= 0 || weaponScore(item.name) < 0 && item.name !== 'bow' && item.name !== 'crossbow') continue;
    counts.set(item.name, (counts.get(item.name) ?? 0) + (item.count ?? 1));
  }
  return [...counts].map(([item, count]) => ({ item, count, melee: weaponScore(item) >= 0,
    ranged: item === 'bow' ? 'automatic-bow' : item === 'trident' ? 'explicit-trident-use'
      : item === 'crossbow' ? 'native-script-only' : null }));
}
