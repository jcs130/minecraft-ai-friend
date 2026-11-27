import '../core/dependency-patches.ts';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import minecraftData from 'minecraft-data';
import type { Bot } from 'mineflayer';
import { expect, it } from 'vitest';
import { installServerRecipeBook, readServerRecipeBook } from '../core/server-recipe-book.ts';
import { queryMinecraftKnowledge } from '../core/knowledge.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const protocol = require('minecraft-protocol');
const body = (version: string) => Object.assign(new EventEmitter(), {
  _client: new EventEmitter(), registry: minecraftData(version), version,
}) as unknown as Bot;
const slot = (bot: Bot, name: string, count = 1) => ({
  itemId: bot.registry.itemsByName[name]!.id, itemCount: count, addedComponentCount: 0,
  removedComponentCount: 0, components: [], removeComponents: [],
});
function transmit(bot: Bot, name: string, params: unknown) {
  const options = { state: 'play', version: bot.version };
  const bytes = protocol.createSerializer({ ...options, isServer: true }).createPacketBuffer({ name, params });
  const decoded = protocol.createDeserializer({ ...options, isServer: false }).parsePacketBuffer(bytes);
  expect(decoded.data.name).toBe(name);
  bot._client.emit(name, decoded.data.params);
}

it('prefers the current server recipe over a version reference, matches partial names, and forgets on reconnect', async () => {
  const bot = body('1.21.11');
  const dispose = installServerRecipeBook(bot);
  const book = (query: string) => readServerRecipeBook(bot, { query }, 'tig');
  try {
    transmit(bot, 'declare_recipes', { recipes: [], stoneCutterRecipes: [] });
    expect(book('铁胸')).toMatchObject({ coverage: 'unobserved', total: 0 });
    // A deliberately non-vanilla output, round-tripped over the real protocol.
    transmit(bot, 'recipe_book_add', { replace: true, entries: [{ recipe: { displayId: 11, group: undefined,
      category: 'crafting_equipment', craftingRequirements: undefined, display: { type: 'crafting_shaped',
        data: { width: 2, height: 2, ingredients: [
          { type: 'item', data: bot.registry.itemsByName.iron_ingot!.id }, { type: 'empty' },
          { type: 'tag', data: 'minecraft:planks' }, { type: 'item', data: bot.registry.itemsByName.iron_ingot!.id },
        ], result: { type: 'item_stack', data: slot(bot, 'iron_chestplate', 2) },
        craftingStation: { type: 'item', data: bot.registry.itemsByName.crafting_table!.id } },
      } }, flags: {} }] });
    const expected = { coverage: 'unlocked-recipe-displays', packet: 'recipe_book_add', profile: 'tig', total: 1,
      entries: [{ id: 'display/11', grid: [[{ item: 'iron_ingot' }, null], [{ tag: 'minecraft:planks' }, { item: 'iron_ingot' }]],
        result: { item: 'iron_chestplate', count: 2 }, station: { item: 'crafting_table' } }] };
    expect(book('铁胸')).toMatchObject(expected);
    expect(book('iron chestplat')).toMatchObject(expected);
    expect(await queryMinecraftKnowledge({kind:'recipe', query:'铁胸'}, bot.version, undefined, undefined, 'tig', bot)).toMatchObject(expected);
    expect(readServerRecipeBook(body('1.21.11'), {query:'铁胸'},'another')).toMatchObject({coverage:'unobserved',total:0});
    transmit(bot, 'recipe_book_remove', { recipeIds: [11] });
    expect(book('铁胸')).toMatchObject({ total: 0, coverage: 'unlocked-recipe-displays' });
    expect(await queryMinecraftKnowledge({kind:'recipe',query:'铁胸'}, bot.version, undefined, undefined, 'tig', bot))
      .toMatchObject({retrieval:'local-reference',recipeBook:{matchingEntries:0}});
    bot._client.emit('start_configuration', {});
    expect(book('铁胸')).toMatchObject({ coverage: 'unobserved', total: 0 });
  } finally { dispose(); }
});

it('reads legacy recipe definitions with wire ingredients and a server ID', () => {
  const bot = body('1.21.1');
  const dispose = installServerRecipeBook(bot);
  try {
    transmit(bot, 'declare_recipes', { recipes: [{ name: 'example:torch', type: 'minecraft:crafting_shapeless',
      data: { group: '', category: 0, ingredients: [[slot(bot, 'stick')], [slot(bot, 'coal'), slot(bot, 'charcoal')]],
        result: slot(bot, 'torch', 7) } }] });
    expect(readServerRecipeBook(bot, {id:'example:torch'})).toMatchObject({
      coverage:'declared-recipe-definitions', entries:[{ id:'example:torch', result:{item:'torch',count:7}, ingredients:[
        {item:'stick'}, {anyOf:[{item:'coal'}, {item:'charcoal'}]},
      ]}],
    });
    bot.emit('end');
    expect(readServerRecipeBook(bot, { query:'torch' })).toMatchObject({ coverage:'unobserved', total:0 });
  } finally { dispose(); }
});
