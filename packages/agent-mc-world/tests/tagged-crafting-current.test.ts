import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { taggedCraftChoice } from '../core/tagged-crafting.ts';
import { precheckStep } from '../core/precheck.ts';
import { craftNeeds } from '../core/skills-craft.ts';

const dependency = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
function rig(version: string, stock: Record<string, number>) {
  const registry = dependency('prismarine-registry')(version);
  const Item = dependency('prismarine-item')(registry);
  const Recipe = dependency('prismarine-recipe')(registry).Recipe;
  const slots = Array(46).fill(null);
  Object.entries(stock).forEach(([name, count], index) => { slots[9 + index] = new Item(registry.itemsByName[name].id, count); });
  return { registry, inventory: { slots, selectedItem: null, items: () => slots.slice(9,45).filter(Boolean) },
    recipesAll: (id: number) => Recipe.find(id, null), currentWindow: null };
}
const deps = { resolve: () => null, blockAt: () => null, cellsOf: () => null };

describe('versioned ingredient tags in real registry crafting', () => {
  it.each(['1.20.6', '1.21.1'])('can allocate the observed mixed plank inventory to one chest (%s)', version => {
    const bot = rig(version, { oak_planks:5, spruce_planks:4 });
    const before = bot.inventory.items().map(item => [item.type,item.count]);
    const choice = taggedCraftChoice(bot as never, 'chest');
    expect(choice?.recipe).toBeTruthy();
    const recipe = choice!.recipe!;
    expect(recipe.result).toEqual({ id:bot.registry.itemsByName.chest.id, count:1 });
    expect(recipe.requiresTable).toBe(true);
    expect(recipe.inShape?.[1][1]).toBeNull();
    expect([...craftNeeds(recipe)]).toEqual([[bot.registry.itemsByName.oak_planks.id,5], [bot.registry.itemsByName.spruce_planks.id,3]]);
    expect(precheckStep(bot as never, { skill:'craft', item:'chest', count:1 }, deps)).toBeNull();
    expect(bot.inventory.items().map(item => [item.type,item.count])).toEqual(before);
  });
  it('does not call seven mixed planks enough or treat logs as planks', () => {
    const bot = rig('1.21.1', { oak_planks:4, spruce_planks:3, oak_log:64 });
    expect(taggedCraftChoice(bot as never,'chest')).toMatchObject({ recipe:null, needs:'任意木板×8' });
    expect(precheckStep(bot as never,{ skill:'craft',item:'chest',count:1 },deps)?.rule).toBe('craft.short');
  });
  it('allows mixed plank species in a bed but requires three wool of the requested color', () => {
    const bot = rig('1.21.1', { white_wool:3, oak_planks:1, spruce_planks:2 });
    expect(taggedCraftChoice(bot as never,'white_bed')?.recipe?.requiresTable).toBe(true);
    expect(taggedCraftChoice(rig('1.21.1',{ white_wool:2, brown_wool:1, oak_planks:3 }) as never,'white_bed')?.recipe).toBeNull();
  });
  it('preserves exact version coverage and unsupported non-tagged fallback', () => {
    expect(taggedCraftChoice(rig('1.21.1',{ oak_planks:8 }) as never,'oak_boat')).toBeNull();
    expect(taggedCraftChoice(rig('1.21.4',{ oak_planks:8 }) as never,'chest')).toBeNull();
  });
  it('uses the current official stone material alternatives without inventing a bricks substitution', () => {
    expect(taggedCraftChoice(rig('1.21.1',{ cobblestone:4,blackstone:4 }) as never,'furnace')?.recipe).toBeTruthy();
    expect(taggedCraftChoice(rig('1.21.1',{ bricks:8 }) as never,'furnace')?.recipe).toBeNull();
  });
});
