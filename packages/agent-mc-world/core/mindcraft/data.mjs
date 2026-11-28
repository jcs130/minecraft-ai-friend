// Adapted from mindcraft-bots/mindcraft e1c1fc3 (MIT). See LICENSE and README.md.

export function createGameData(mcdata) {
  function getBlockId(blockName) {
      let block = mcdata.blocksByName[blockName];
      if (block) {
          return block.id;
      }
      return null;
  }

  function getItemId(itemName) {
      let item = mcdata.itemsByName[itemName];
      if (item) {
          return item.id;
      }
      return null;
  }

  function getEntityId(entityName) {
      let entity = mcdata.entitiesByName[entityName];
      if (entity) {
          return entity.id;
      }
      return null;
  }

  function getItemName(itemId) {
      let item = mcdata.items[itemId]
      if (item) {
          return item.name;
      }
      return null;
  }

  function getAllItems(ignore) {
      if (!ignore) {
          ignore = [];
      }
      let items = []
      for (const itemId in mcdata.items) {
          const item = mcdata.items[itemId];
          if (!ignore.includes(item.name)) {
              items.push(item);
          }
      }
      return items;
  }

  function getAllBlocks(ignore) {
      if (!ignore) {
          ignore = [];
      }
      let blocks = []
      for (const blockId in mcdata.blocks) {
          const block = mcdata.blocks[blockId];
          if (!ignore.includes(block.name)) {
              blocks.push(block);
          }
      }
      return blocks;
  }

  function getAllBlockIds(ignore) {
      const blocks = getAllBlocks(ignore);
      let blockIds = [];
      for (const block of blocks) {
          blockIds.push(block.id);
      }
      return blockIds;
  }

  function getAllBiomes() {
      return mcdata.biomes;
  }

  function getItemCraftingRecipes(itemName) {
      let itemId = getItemId(itemName);
      if (!mcdata.recipes[itemId]) {
          return null;
      }

      let recipes = [];
      for (let r of mcdata.recipes[itemId]) {
          let recipe = {};
          let ingredients = [];
          if (r.ingredients) {
              ingredients = r.ingredients;
          } else if (r.inShape) {
              ingredients = r.inShape.flat();
          }
          for (let ingredient of ingredients) {
              let ingredientName = getItemName(ingredient);
              if (ingredientName === null) continue;
              if (!recipe[ingredientName])
                  recipe[ingredientName] = 0;
              recipe[ingredientName]++;
          }
          recipes.push([
              recipe,
              {craftedCount : r.result.count}
          ]);
      }
      // sort recipes by if their ingredients include common items
      const commonItems = ['oak_planks', 'oak_log', 'coal', 'cobblestone'];
      recipes.sort((a, b) => {
          let commonCountA = Object.keys(a[0]).filter(key => commonItems.includes(key)).reduce((acc, key) => acc + a[0][key], 0);
          let commonCountB = Object.keys(b[0]).filter(key => commonItems.includes(key)).reduce((acc, key) => acc + b[0][key], 0);
          return commonCountB - commonCountA;
      });

      return recipes;
  }

  function getSmeltingFuel(bot) {
      let fuel = bot.inventory.items().find(i => i.name === 'coal' || i.name === 'charcoal' || i.name === 'blaze_rod')
      if (fuel)
          return fuel;
      fuel = bot.inventory.items().find(i => i.name.includes('log') || i.name.includes('planks'))
      if (fuel)
          return fuel;
      return bot.inventory.items().find(i => i.name === 'coal_block' || i.name === 'lava_bucket');
  }

  function ingredientsFromPrismarineRecipe(recipe) {
      let requiredIngedients = {};
      if (recipe.inShape)
          for (const ingredient of recipe.inShape.flat()) {
              if(ingredient.id<0) continue; //prismarine-recipe uses id -1 as an empty crafting slot
              const ingredientName = getItemName(ingredient.id);
              requiredIngedients[ingredientName] ??=0;
              requiredIngedients[ingredientName] += ingredient.count;
          }
      if (recipe.ingredients)
          for (const ingredient of recipe.ingredients) {
              if(ingredient.id<0) continue;
              const ingredientName = getItemName(ingredient.id);
              requiredIngedients[ingredientName] ??=0;
              requiredIngedients[ingredientName] -= ingredient.count;
              //Yes, the `-=` is intended.
              //prismarine-recipe uses positive numbers for the shaped ingredients but negative for unshaped.
              //Why this is the case is beyond my understanding.
          }
      return requiredIngedients;
  }

  function calculateLimitingResource(availableItems, requiredItems, discrete=true) {
      let limitingResource = null;
      let num = Infinity;
      for (const itemType in requiredItems) {
          if ((availableItems[itemType] ?? 0) < requiredItems[itemType] * num) {
              limitingResource = itemType;
              num = (availableItems[itemType] ?? 0) / requiredItems[itemType];
          }
      }
      if(discrete) num = Math.floor(num);
      return {num, limitingResource}
  }
  return { getBlockId, getItemId, getEntityId, getItemName, getAllItems, getAllBlocks, getAllBlockIds, getAllBiomes, getItemCraftingRecipes, getSmeltingFuel, ingredientsFromPrismarineRecipe, calculateLimitingResource };
}
