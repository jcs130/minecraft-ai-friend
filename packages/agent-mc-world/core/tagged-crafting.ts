/**
 * 按确切版本读取官方配方的物品标签。minecraft-data 的 recipesAll 把标签压成
 * 一种代表材料（例如所有木板都变成橡木木板）；这里在现有背包中展开标签，
 * 只产生摆格方案。合成结果仍以服务端实际回包为准。
 */
import type { Bot } from 'mineflayer';
import legacy from './data/crafting-tags-1.20.6.json' with { type: 'json' };
import current from './data/crafting-tags-1.21.1.json' with { type: 'json' };
import type { CraftRecipeLike } from './skills-craft.ts';
import { zhName } from './names.ts';
import { playerInvIn } from './inventory.ts';

type Ingredient = { item?: string; tag?: string } | Array<{ item?: string; tag?: string }>;
type TaggedRecipe = {
  type: string;
  pattern?: string[];
  key?: Record<string, Ingredient>;
  ingredients?: Ingredient[];
  result: { count: number; id: string };
};
type TaggedData = { version: string; recipes: Record<string, TaggedRecipe[]>; tags: Record<string, string[]> };
const versions: Record<string, TaggedData> = { [legacy.version]: legacy as TaggedData, [current.version]: current as TaggedData };

const unnamespace = (id: string): string => id.startsWith('minecraft:') ? id.slice(10) : id;

function expand(spec: Ingredient, tags: TaggedData['tags'], seen = new Set<string>()): string[] {
  if (Array.isArray(spec)) return [...new Set(spec.flatMap((entry) => expand(entry, tags, seen)))];
  if (spec.item) return [unnamespace(spec.item)];
  if (!spec.tag || seen.has(spec.tag)) return [];
  const next = new Set(seen);
  next.add(spec.tag);
  return [...new Set((tags[spec.tag] ?? []).flatMap((entry) => entry.startsWith('#')
    ? expand({ tag: entry.slice(1) }, tags, next) : [unnamespace(entry)]))];
}

function cellsOf(recipe: TaggedRecipe): { rows: Array<Array<Ingredient | null>>; shaped: boolean } {
  if (recipe.type === 'minecraft:crafting_shaped' && recipe.pattern && recipe.key) {
    return { rows: recipe.pattern.map((row) => [...row].map((char) => char === ' ' ? null : recipe.key?.[char] ?? null)), shaped: true };
  }
  return { rows: [(recipe.ingredients ?? [])], shaped: false };
}

export interface TaggedCraftChoice {
  recipe: CraftRecipeLike | null;
  /** 配方表中要求的直接材料，失败时供 Agent 改计划，不把标签错写成橡木。 */
  needs: string;
  shortfall?: string;
}

/** null:此版本/物品没有带标签的官方配方，应使用通常的 recipesAll。 */
export function taggedCraftChoice(bot: Bot, item: string, requestedOutput = 1): TaggedCraftChoice | null {
  const version = (bot.registry.version as { minecraftVersion?: string } | undefined)?.minecraftVersion;
  const vanilla = version ? versions[version] : undefined;
  if (!vanilla) return null;
  const recipes = vanilla.recipes[item];
  if (!recipes?.length) return null;
  const have = new Map<number, number>();
  for (const stack of playerInvIn(bot, bot.currentWindow).items()) have.set(stack.type, (have.get(stack.type) ?? 0) + stack.count);
  const itemDefs = bot.registry.itemsByName as Record<string, { id: number } | undefined>;
  let fallbackNeeds = '';
  let shortfall: string | undefined;
  for (const source of recipes) {
    const { rows, shaped } = cellsOf(source);
    const width = Math.max(0, ...rows.map((row) => row.length));
    const options = rows.flat().map((spec) => spec === null ? [null] : expand(spec, vanilla.tags)
      .map((name) => itemDefs[name]?.id).filter((id): id is number => id !== undefined));
    const required = new Map<string, { count: number; ids: ReadonlyArray<number | null> }>();
    for (const [index, spec] of rows.flat().entries()) {
      if (!spec) continue;
      const parts = Array.isArray(spec) ? spec : [spec];
      const label = parts.map((part) => part.tag === 'minecraft:planks'
        ? '任意木板' : part.tag ? `#${part.tag}` : zhName(unnamespace(part.item ?? ''))).join(' 或 ');
      const group = required.get(label);
      if (group) group.count++;
      else required.set(label, { count: 1, ids: options[index]! });
    }
    fallbackNeeds = [...required].map(([name, group]) => `${name}×${group.count}`).join(' + ');
    const selected: Array<number | null> = [];
    const choose = (index: number): boolean => {
      if (index === options.length) return true;
      const ids = options[index] ?? [];
      for (const id of ids) {
        if (id !== null && (have.get(id) ?? 0) <= 0) continue;
        selected.push(id);
        if (id !== null) have.set(id, (have.get(id) ?? 0) - 1);
        if (choose(index + 1)) return true;
        if (id !== null) have.set(id, (have.get(id) ?? 0) + 1);
        selected.pop();
      }
      return false;
    };
    if (!choose(0)) {
      const batches = Math.ceil(requestedOutput / source.result.count);
      // A tag can overlap another ingredient. Per-group shortfalls are lower bounds,
      // never a claim that independently counted groups can all spend the same stack.
      const missing = [...required].flatMap(([label, group]) => {
        const held = group.ids.reduce<number>((sum, id) => sum + (id === null ? 0 : have.get(id) ?? 0), 0);
        const need = group.count * batches;
        return held < need ? [`${label}需${need}、随身${held}、至少差${need - held}`] : [];
      });
      shortfall = missing.length ? `${recipes.length > 1 ? '本配方示例，' : ''}目标产物×${requestedOutput}：${missing.join('；')}` : undefined;
      continue;
    }
    const needsTable = shaped ? rows.length > 2 || width > 2 : selected.length > 4;
    const recipe: CraftRecipeLike = {
      result: { id: bot.registry.itemsByName[item]?.id ?? null, count: source.result.count },
      requiresTable: needsTable,
      ...(shaped
        ? { inShape: rows.map((row, y) => row.map((_cell, x) => {
          const id = selected[y * width + x];
          return id === null || id === undefined ? null : { id };
        })) }
        : { ingredients: selected.filter((id): id is number => id !== null).map((id) => ({ id })) }),
    };
    return { recipe, needs: fallbackNeeds };
  }
  return { recipe: null, needs: fallbackNeeds, shortfall };
}
