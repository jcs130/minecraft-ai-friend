// Adapted from mindcraft-bots/mindcraft e1c1fc3 (MIT). See LICENSE and README.md.
import pf from 'mineflayer-pathfinder';
import { detailedCraftingPlan } from './recipe-plan.mjs';
export function createWorld(mc) {
  // Adapted from wehos/mc-agent-neko escapeDigPlan (a4ce409, MIT).
  function getEscapeDigPlan(bot, x, y, z) {
    const target = bot.blockAt(bot.entity.position.clone().set(x, y, z).floored());
    if (!target?.diggable || target.boundingBox === 'empty') return null;
    const eye = bot.blockAt(bot.entity.position.offset(0,bot.entity.eyeHeight,0));
    if (!eye || typeof bot.entity.onGround !== 'boolean') return null;
    const wet = ['water','flowing_water'].includes(eye.name);
    const helmet = bot.inventory.slots[bot.getEquipmentDestSlot('head')];
    let best = null;
    for (const stack of [bot.heldItem, null, ...bot.inventory.items()]) {
      const time = target.digTime(stack?.type ?? null, bot.game.gameMode === 'creative', wet,
        !bot.entity.onGround, [...(stack?.enchants ?? []), ...(helmet?.enchants ?? [])], bot.entity.effects);
      if (Number.isFinite(time) && (!best || time < best.digMs)) {
        best = {tool:stack?.name ?? null, slot:stack?.slot ?? null, digMs:time,
          budgetMs:Math.round(time * 1.4) + 1500, block:target.name, inWater:wet, onGround:bot.entity.onGround};
      }
    }
    return best;
  }

  function getNearestFreeSpace(bot, size=1, distance=8) {
      /**
       * Get the nearest empty space with solid blocks beneath it of the given size.
       * @param {Bot} bot - The bot to get the nearest free space for.
       * @param {number} size - The (size x size) of the space to find, default 1.
       * @param {number} distance - The maximum distance to search, default 8.
       * @returns {Vec3} - The south west corner position of the nearest free space.
       * @example
       * let position = world.getNearestFreeSpace(bot, 1, 8);
       **/
      let empty_pos = bot.findBlocks({
          matching: (block) => {
              return block && block.name == 'air';
          },
          maxDistance: distance,
          count: 64
      });
      for (let i = 0; i < empty_pos.length; i++) {
          let empty = true;
          for (let x = 0; x < size; x++) {
              for (let z = 0; z < size; z++) {
                  let top = bot.blockAt(empty_pos[i].offset(x, 0, z));
                  let bottom = bot.blockAt(empty_pos[i].offset(x, -1, z));
                  if (!top || top.name !== 'air' || !bottom || bottom.boundingBox !== 'block') {
                      empty = false;
                      break;
                  }
              }
              if (!empty) break;
          }
          if (empty) {
              return empty_pos[i];
          }
      }
  }

  function getBlockAtPosition(bot, x=0, y=0, z=0) {
       /**
       * Get a block from the bot's relative position
       * @param {Bot} bot - The bot to get the block for.
       * @param {number} x - The relative x offset to serach, default 0.
       * @param {number} y - The relative y offset to serach, default 0.
       * @param {number} y - The relative z offset to serach, default 0.
       * @returns {Block} - The nearest block.
       * @example
       * let blockBelow = world.getBlockAtPosition(bot, 0, -1, 0);
       * let blockAbove = world.getBlockAtPosition(bot, 0, 2, 0); since minecraft position is at the feet
       **/
      let block = bot.blockAt(bot.entity.position.offset(x, y, z));


      return block;
  }

  function getSurroundingBlocks(bot) {
      /**
       * Get the surrounding blocks from the bot's environment.
       * @param {Bot} bot - The bot to get the block for.
       * @returns {string[]} - A list of block results as strings.
       * @example
       **/
      // Create a list of block position results that can be unpacked.
      let res = [];
      res.push(`Block Below: ${getBlockAtPosition(bot, 0, -1, 0)?.name ?? 'unknown'}`);
      res.push(`Block at Legs: ${getBlockAtPosition(bot, 0, 0, 0)?.name ?? 'unknown'}`);
      res.push(`Block at Head: ${getBlockAtPosition(bot, 0, 1, 0)?.name ?? 'unknown'}`);

      return res;
  }

  function getFirstBlockAboveHead(bot, ignore_types=null, distance=32) {
       /**
       * Searches a column from the bot's position for the first solid block above its head
       * @param {Bot} bot - The bot to get the block for.
       * @param {string[]} ignore_types - The names of the blocks to ignore.
       * @param {number} distance - The maximum distance to search, default 32.
       * @returns {string} - The fist block above head.
       * @example
       * let firstBlockAboveHead = world.getFirstBlockAboveHead(bot, null, 32);
       **/
      // if ignore_types is not a list, make it a list.
      let ignore_blocks = [];
      if (ignore_types === null) ignore_blocks = ['air', 'cave_air'];
      else {
          if (!Array.isArray(ignore_types))
              ignore_types = [ignore_types];
          for(let ignore_type of ignore_types) {
              if (mc.getBlockId(ignore_type) !== null) ignore_blocks.push(ignore_type);
          }
      }
      // The block above, stops when it finds a solid block .
      let block_above = {name: 'air'};
      let height = 0
      for (let i = 0; i < distance; i++) {
          let block = bot.blockAt(bot.entity.position.offset(0, i+2, 0));
          if (!block) return null;
          // Ignore and continue
          if (ignore_blocks.includes(block.name)) continue;
          // Defaults to any block
          block_above = block;
          height = i;
          break;
      }

      if (ignore_blocks.includes(block_above.name)) return 'none';

      return `${block_above.name} (${height} blocks up)`;
  }

  function getNearestBlocks(bot, block_types=null, distance=8, count=10000) {
      /**
       * Get a list of the nearest blocks of the given types.
       * @param {Bot} bot - The bot to get the nearest block for.
       * @param {string[]} block_types - The names of the blocks to search for.
       * @param {number} distance - The maximum distance to search, default 16.
       * @param {number} count - The maximum number of blocks to find, default 10000.
       * @returns {Block[]} - The nearest blocks of the given type.
       * @example
       * let woodBlocks = world.getNearestBlocks(bot, ['oak_log', 'birch_log'], 16, 1);
       **/
      // if blocktypes is not a list, make it a list
      let block_ids = [];
      if (block_types === null) {
          block_ids = mc.getAllBlockIds(['air']);
      }
      else {
          if (!Array.isArray(block_types))
              block_types = [block_types];
          for(let block_type of block_types) {
              const id = mc.getBlockId(block_type);
              if (id !== null) block_ids.push(id);
          }
      }
      return getNearestBlocksWhere(bot, block_ids, distance, count);
  }

  function getNearestBlocksWhere(bot, predicate, distance=8, count=10000) {
      /**
       * Get a list of the nearest blocks that satisfy the given predicate.
       * @param {Bot} bot - The bot to get the nearest blocks for.
       * @param {function} predicate - The predicate to filter the blocks.
       * @param {number} distance - The maximum distance to search, default 16.
       * @param {number} count - The maximum number of blocks to find, default 10000.
       * @returns {Block[]} - The nearest blocks that satisfy the given predicate.
       * @example
       * let waterBlocks = world.getNearestBlocksWhere(bot, block => block.name === 'water', 16, 10);
       **/
      let positions = bot.findBlocks({matching: predicate, maxDistance: distance, count: count});
      let blocks = positions.map(position => bot.blockAt(position));
      return blocks.filter(Boolean);
  }

  function getNearestBlock(bot, block_type, distance=16) {
       /**
       * Get the nearest block of the given type.
       * @param {Bot} bot - The bot to get the nearest block for.
       * @param {string} block_type - The name of the block to search for.
       * @param {number} distance - The maximum distance to search, default 16.
       * @returns {Block} - The nearest block of the given type.
       * @example
       * let coalBlock = world.getNearestBlock(bot, 'coal_ore', 16);
       **/
      let blocks = getNearestBlocks(bot, block_type, distance, 1);
      if (blocks.length > 0) {
          return blocks[0];
      }
      return null;
  }

  function getNearbyEntities(bot, maxDistance=16) {
      let entities = [];
      for (const entity of Object.values(bot.entities)) {
          if (entity.id === bot.entity.id) continue;
          const distance = entity.position.distanceTo(bot.entity.position);
          if (distance > maxDistance) continue;
          entities.push({ entity: entity, distance: distance });
      }
      entities.sort((a, b) => a.distance - b.distance);
      let res = [];
      for (let i = 0; i < entities.length; i++) {
          res.push(entities[i].entity);
      }
      return res;
  }

  function getNearestEntityWhere(bot, predicate, maxDistance=16) {
      return getNearbyEntities(bot, maxDistance).find(entity => entity.id !== bot.entity.id && predicate(entity)) ?? null;
  }

  function getNearbyPlayers(bot, maxDistance) {
      if (maxDistance == null) maxDistance = 16;
      let players = [];
      for (const entity of Object.values(bot.entities)) {
          const distance = entity.position.distanceTo(bot.entity.position);
          if (distance > maxDistance) continue;
          if (entity.type == 'player' && entity.username != bot.username) {
              players.push({ entity: entity, distance: distance });
          }
      }
      players.sort((a, b) => a.distance - b.distance);
      let res = [];
      for (let i = 0; i < players.length; i++) {
          res.push(players[i].entity);
      }
      return res;
  }

  function getVillagerProfession(entity) {
      // Villager profession mapping based on metadata
      const professions = {
          0: 'Unemployed',
          1: 'Armorer',
          2: 'Butcher',
          3: 'Cartographer',
          4: 'Cleric',
          5: 'Farmer',
          6: 'Fisherman',
          7: 'Fletcher',
          8: 'Leatherworker',
          9: 'Librarian',
          10: 'Mason',
          11: 'Nitwit',
          12: 'Shepherd',
          13: 'Toolsmith',
          14: 'Weaponsmith'
      };

      if (entity.metadata && entity.metadata[18]) {
          // Check if metadata[18] is an object with villagerProfession property
          if (typeof entity.metadata[18] === 'object' && entity.metadata[18].villagerProfession !== undefined) {
              const professionId = entity.metadata[18].villagerProfession;
              const level = entity.metadata[18].level || 1;
              const professionName = professions[professionId] || 'Unknown';
              return `${professionName} L${level}`;
          }
          // Fallback for direct profession ID
          else if (typeof entity.metadata[18] === 'number') {
              const professionId = entity.metadata[18];
              return professions[professionId] || 'Unknown';
          }
      }

      // If we can't determine profession but it's an adult villager
      if (entity.metadata && entity.metadata[16] !== 1) { // Not a baby
          return 'Adult';
      }

      return 'Unknown';
  }

  function getInventoryCounts(bot) {
      /**
       * Get an object representing the bot's inventory.
       * @param {Bot} bot - The bot to get the inventory for.
       * @returns {object} - An object with item names as keys and counts as values.
       * @example
       * let inventory = world.getInventoryCounts(bot);
       * let oakLogCount = inventory['oak_log'];
       * let hasWoodenPickaxe = inventory['wooden_pickaxe'] > 0;
       **/
      let inventory = {};
      for (const slot of bot.inventory.slots) {
          if (slot != null && slot.name) {
              if (inventory[slot.name] == null) {
                  inventory[slot.name] = 0;
              }
              inventory[slot.name] += slot.count;
          }
      }
      return inventory;
  }

  async function getCraftableItems(bot) {
      /**
       * Get a list of all items that can be crafted with the bot's current inventory.
       * @param {Bot} bot - The bot to get the craftable items for.
       * @returns {string[]} - A list of all items that can be crafted.
       * @example
       * let craftableItems = world.getCraftableItems(bot);
       **/
      let table = getNearestBlock(bot, 'crafting_table');
      if (!table) {
          for (const item of bot.inventory.items()) {
              if (item != null && item.name === 'crafting_table') {
                  table = item;
                  break;
              }
          }
      }
      let res = [];
      let i = 0;
      for (const item of mc.getAllItems()) {
          if (++i % 32 === 0) await bot.yieldRead();
          let recipes = bot.recipesFor(item.id, null, 1, table);
          if (recipes.length > 0)
              res.push(item.name);
      }
      return res;
  }

  function getPosition(bot) {
      /**
       * Get your position in the world (Note that y is vertical).
       * @param {Bot} bot - The bot to get the position for.
       * @returns {Vec3} - An object with x, y, and x attributes representing the position of the bot.
       * @example
       * let position = world.getPosition(bot);
       * let x = position.x;
       **/
      return bot.entity.position;
  }

  function getNearbyEntityTypes(bot) {
      /**
       * Get a list of all nearby mob types.
       * @param {Bot} bot - The bot to get nearby mobs for.
       * @returns {string[]} - A list of all nearby mobs.
       * @example
       * let mobs = world.getNearbyEntityTypes(bot);
       **/
      let mobs = getNearbyEntities(bot, 16);
      let found = [];
      for (let i = 0; i < mobs.length; i++) {
          if (!found.includes(mobs[i].name)) {
              found.push(mobs[i].name);
          }
      }
      return found;
  }

  function isEntityType(name) {
      /**
       * Check if a given name is a valid entity type.
       * @param {string} name - The name of the entity type to check.
       * @returns {boolean} - True if the name is a valid entity type, false otherwise.
       */
      return mc.getEntityId(name) !== null;
  }

  function getNearbyPlayerNames(bot) {
      /**
       * Get a list of all nearby player names.
       * @param {Bot} bot - The bot to get nearby players for.
       * @returns {string[]} - A list of all nearby players.
       * @example
       * let players = world.getNearbyPlayerNames(bot);
       **/
      let players = getNearbyPlayers(bot, 64);
      let found = [];
      for (let i = 0; i < players.length; i++) {
          if (!found.includes(players[i].username) && players[i].username != bot.username) {
              found.push(players[i].username);
          }
      }
      return found;
  }

  function getNearbyBlockTypes(bot, distance=16) {
      /**
       * Get a list of all nearby block names.
       * @param {Bot} bot - The bot to get nearby blocks for.
       * @param {number} distance - The maximum distance to search, default 16.
       * @returns {string[]} - A list of all nearby blocks.
       * @example
       * let blocks = world.getNearbyBlockTypes(bot);
       **/
      let blocks = getNearestBlocks(bot, null, distance);
      let found = [];
      for (let i = 0; i < blocks.length; i++) {
          if (!found.includes(blocks[i].name)) {
              found.push(blocks[i].name);
          }
      }
      return found;
  }

  async function isClearPath(bot, target) {
      /**
       * Check if there is a path to the target that requires no digging or placing blocks.
       * @param {Bot} bot - The bot to get the path for.
       * @param {Entity} target - The target to path to.
       * @returns {boolean} - True if there is a clear path, false otherwise.
       */
      let movements = bot.walkProfile()
      movements.canDig = false;
      movements.scafoldingBlocks = [];
      movements.canOpenDoors = false;
      let goal = new pf.goals.GoalNear(target.position.x, target.position.y, target.position.z, 1);
      let path = await bot.pathfinder.getPathTo(movements, goal, 100);
      return path.status === 'success';
  }

  function shouldPlaceTorch(bot) {
      if (bot.interrupt_code) return false;
      const pos = getPosition(bot);
      // TODO: check light level instead of nearby torches, block.light is broken
      let nearest_torch = getNearestBlock(bot, 'torch', 6);
      if (!nearest_torch)
          nearest_torch = getNearestBlock(bot, 'wall_torch', 6);
      if (!nearest_torch) {
          const block = bot.blockAt(pos);
          let has_torch = bot.inventory.items().find(item => item.name === 'torch');
          return !!has_torch && block?.name === 'air';
      }
      return false;
  }

  function getBiomeName(bot) {
      /**
       * Get the name of the biome the bot is in.
       * @param {Bot} bot - The bot to get the biome for.
       * @returns {string} - The name of the biome.
       * @example
       * let biome = world.getBiomeName(bot);
       **/
      const biomeId = bot.world.getBiome(bot.entity.position);
      return mc.getAllBiomes()[biomeId]?.name ?? null;
  }
  function getDetailedCraftingPlan(bot, targetItem, count=1) { return detailedCraftingPlan(bot,mc,targetItem,count); }
  return { getEscapeDigPlan, getDetailedCraftingPlan, getNearestFreeSpace, getBlockAtPosition, getSurroundingBlocks, getFirstBlockAboveHead, getNearestBlocks, getNearestBlocksWhere, getNearestBlock, getNearbyEntities, getNearestEntityWhere, getNearbyPlayers, getVillagerProfession, getInventoryCounts, getCraftableItems, getPosition, getNearbyEntityTypes, isEntityType, getNearbyPlayerNames, getNearbyBlockTypes, isClearPath, shouldPlaceTorch, getBiomeName };
}
