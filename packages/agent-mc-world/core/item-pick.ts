/**
 * 按物品的显示标签、英文附魔 ID 和数值等级做子串匹配。
 * 同一挑选词可匹配多件物品，操作数量由 count 指定；未匹配时返回候选清单。
 */
import { roman, zhEnchant, zhName } from './names.ts';
import { readDurability, readEnchants, type Durability, type EnchantRegistry, type ItemEnchant, type ItemLike } from './item-facts.ts';
import { enchantSuffix } from './terrain.ts';
import { itemCustomName } from './item-display.ts';

export interface PickTarget {
  name: string;
  enchantments?: readonly ItemEnchant[];
  displayName?: string;
  durability?: Durability | null;
}

export function pickLabel(it: PickTarget): string {
  const wear = it.durability ? ` 耐久${it.durability.left}/${it.durability.max}` : '';
  return `${it.displayName ?? zhName(it.name)}${enchantSuffix(it.enchantments)}${wear}`;
}

export function pickTargetOf(item: ItemLike, registry?: EnchantRegistry | null): PickTarget {
  const displayName = itemCustomName(item);
  return { name: item.name, enchantments: readEnchants(item, registry),
    ...(displayName ? { displayName } : {}),
    durability: readDurability(item) };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function facets(it: PickTarget): string[] {
  const out = [zhName(it.name), it.name, pickLabel(it)];
  if (it.displayName) out.push(it.displayName);
  if (it.durability) out.push(`耐久${it.durability.left}/${it.durability.max}`);
  for (const e of it.enchantments ?? []) {
    const zh = zhEnchant(e.name);
    out.push(zh, `${zh}${roman(e.level)}`, `${zh}${e.level}`, e.name, `${e.name}${e.level}`);
  }
  return out;
}

/** 空挑选词不筛选。 */
export function matchesPick(pick: string | undefined, it: PickTarget): boolean {
  if (!pick) return true;
  const q = normalize(pick);
  return q.length > 0 && facets(it).some((f) => normalize(f).includes(q));
}

export function itemMatchesPick(
  pick: string | undefined,
  item: ItemLike,
  registry?: EnchantRegistry | null,
): boolean {
  return pick ? matchesPick(pick, pickTargetOf(item, registry)) : true;
}

/** 无附魔时显示“没有附魔”。 */
function pickFacts(it: PickTarget): string {
  return pickLabel(it);
}

export function pickMissText(
  where: string,
  id: string,
  pick: string,
  sameId: readonly PickTarget[],
): string {
  return `${where}有 ${sameId.length} 件${zhName(id)},没有一件带「${pick}」:`
    + `${sameId.map(pickFacts).join(' / ')}`;
}

export function pickedText(picked: readonly PickTarget[]): string {
  return [...new Set(picked.map(pickLabel))].join('、');
}
