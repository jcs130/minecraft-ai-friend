import type { Bot } from 'mineflayer';
import { readDurability, readEnchants, type ItemLike } from './item-facts.ts';

type InventoryItem = ReturnType<Bot['inventory']['items']>[number];
export type RangedWeaponKind = 'bow' | 'crossbow' | 'trident';
export interface RangedWeapon {
  item: InventoryItem;
  kind: RangedWeaponKind;
  chargeMs: number;
}

const arrows = new Set(['arrow', 'spectral_arrow', 'tipped_arrow']);

function hasCrossbowArrows(bot: Bot, items: InventoryItem[]): boolean {
  const offhandSlot = bot.getEquipmentDestSlot?.('off-hand');
  const offhand = offhandSlot === undefined ? null : bot.inventory.slots[offhandSlot];
  if (offhand?.count && offhand.name === 'firework_rocket') return false;
  if (offhand?.count && arrows.has(offhand.name)) return true;
  return items.some(item => arrows.has(item.name) && item.count > 0);
}

/** Vanilla release loads a crossbow; only the next use can shoot. */
export function crossbowCharge(bot: Bot, item: ItemLike): 'empty' | 'arrow' | 'other' | 'unknown' {
  if (!bot.supportFeature?.('itemsWithComponents')) return 'unknown';
  const component = item.componentMap?.get('charged_projectiles');
  if (!component) return 'empty';
  const slots = (component.data as { projectiles?: unknown } | null)?.projectiles;
  if (!Array.isArray(slots)) return 'unknown';
  if (slots.length === 0) return 'empty';
  const items = bot.registry.items;
  if (!slots.every(slot => Number.isSafeInteger(slot?.itemId) && Number.isSafeInteger(slot?.itemCount) && slot.itemCount > 0))
    return 'unknown';
  return slots.every(slot => arrows.has(items?.[slot.itemId]?.name)) ? 'arrow' : 'other';
}

/** Legacy bow callers keep their original ordinary-arrow contract. */
export function hasUsableArrows(bot: Bot): boolean {
  return bot.inventory.items().some(item => item.name === 'arrow' && item.count > 0);
}

export function readyToThrowTrident(bot: Bot, item: ItemLike, explicit: boolean): boolean {
  if ((readDurability(item)?.left ?? 0) <= 1) return false;
  const enchants = readEnchants(item, bot.registry);
  if (enchants.some(e => e.name === 'riptide' && e.level > 0)) return false;
  return explicit || enchants.some(e => e.name === 'loyalty' && e.level > 0);
}

/** Choose from observed, usable weapons. A verified preloaded crossbow is the fastest shot. */
export function selectRangedWeapon(bot: Bot, preference?: string, distance?: number): RangedWeapon | null {
  const wanted = preference?.replace(/^minecraft:/, '');
  const items = bot.inventory.items();
  const normalAmmo = items.some(item => item.name === 'arrow' && item.count > 0);
  const hasCrossbowAmmo = hasCrossbowArrows(bot, items);
  const held = bot.heldItem;
  let selected: RangedWeapon | null = null;
  let priority = -Infinity, durability = 0;
  for (const item of items) {
    if (wanted && item.name !== wanted) continue;
    const left = readDurability(item)?.left ?? 0;
    if ((item.count ?? 1) <= 0 || left <= 0) continue;
    let score = 0, chargeMs: number;
    if (item.name === 'bow' && normalAmmo) {
      chargeMs = 1_000;
      score = 3;
    } else if (item.name === 'crossbow') {
      const loaded = crossbowCharge(bot, item);
      if (loaded === 'arrow') { chargeMs = 0; score = 9; }
      else if (loaded === 'empty' && hasCrossbowAmmo) {
        const quick = readEnchants(item, bot.registry).find(e => e.name === 'quick_charge')?.level ?? 0;
        const level = Number.isInteger(quick) ? Math.max(0, Math.min(3, quick)) : 0;
        // Include one server tick before releasing, then wait for the slot update.
        chargeMs = (26 - 5 * level) * 50;
        score = (distance !== undefined && distance >= 18) || level >= 2 ? 5 : 2;
      } else continue;
    } else if (item.name === 'trident' && readyToThrowTrident(bot, item, wanted === 'trident')) {
      chargeMs = 600;
      score = distance !== undefined && distance <= 14 ? 5 : 1;
    } else continue;
    if (held?.type === item.type && held?.slot === item.slot) score += 1;
    if (score > priority || (score === priority && left > durability)) {
      selected = { item, kind: item.name as RangedWeaponKind, chargeMs };
      priority = score;
      durability = left;
    }
  }
  return selected;
}

export function hasReadyRangedWeapon(bot: Bot, preference?: string): boolean {
  return selectRangedWeapon(bot, preference) !== null;
}
