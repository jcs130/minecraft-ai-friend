// Adapted from mindcraft-bots/mindcraft e1c1fc3 (MIT). See LICENSE and README.md.
export function createSkills(world, mc, actions) {
  async function craftRecipe(bot, itemName, num=1) {
      /**
       * Attempt to craft the given item name from a recipe. May craft many items.
       * @param {MinecraftBot} bot, reference to the minecraft bot.
       * @param {string} itemName, the item name to craft.
       * @returns {Promise<boolean>} true if the recipe was crafted, false otherwise.
       * @example
       * await skills.craftRecipe(bot, "stick");
       **/
      const id = mc.getItemId(itemName);
      if (id === null) {
          log(bot, itemName + ' has no known item or recipe.');
          return false;
      }
      let table = null;
      let placed = null;
      let recipes = bot.recipesFor(id, null, 1, null);
      if (!recipes.length && bot.recipesFor(id, null, 1, true).length) {
          table = world.getNearestBlock(bot, 'crafting_table', 16);
          if (!table && world.getInventoryCounts(bot).crafting_table > 0) {
              const pos = world.getNearestFreeSpace(bot, 1, 6);
              if (pos && await placeBlock(bot, 'crafting_table', pos.x, pos.y, pos.z)) {
                  table = bot.blockAt(pos);
                  if (table?.name === 'crafting_table') placed = table;
              }
          }
          if (table) {
              if (table.position.distanceTo(bot.entity.position) > 4)
                  await goToPosition(bot, ...table.position.toArray(), 3);
              table = bot.blockAt(table.position);
              if (table?.name === 'crafting_table') recipes = bot.recipesFor(id, null, 1, table);
          }
      }
      try {
          const recipe = recipes[0];
          if (!recipe) {
              const output = actions.taggedOutput(itemName);
              if (output) {
                  const before = world.getInventoryCounts(bot)[itemName] ?? 0;
                  await actions.step({skill:'craft',item:itemName,count:num*output});
                  return (world.getInventoryCounts(bot)[itemName] ?? 0) - before >= num*output;
              }
              const ingredients = mc.getItemCraftingRecipes(itemName)?.[0]?.[0];
              log(bot, 'No currently craftable recipe for ' + itemName +
                  '; use world.getDetailedCraftingPlan(bot,itemName,count) to inspect intermediate steps' +
                  (ingredients ? '; example ingredients ' + JSON.stringify(ingredients) : ''));
              return false;
          }
          const before = world.getInventoryCounts(bot);
          const needed = mc.ingredientsFromPrismarineRecipe(recipe);
          const limit = mc.calculateLimitingResource(before, needed);
          const applications = Math.min(num, limit.num);
          if (!(applications > 0)) return false;
          await bot.craft(recipe, applications, table);
          const delta = (world.getInventoryCounts(bot)[itemName] ?? 0) - (before[itemName] ?? 0);
          log(bot, 'Observed ' + itemName + ' inventory delta ' + delta + ' for ' + applications + '/' + num + ' recipe applications.');
          return delta >= num * recipe.result.count;
      } finally {
          if (placed && !bot.interrupt_code && bot.blockAt(placed.position)?.stateId === placed.stateId)
              await breakBlockAt(bot, ...placed.position.toArray());
      }
  }

  async function clearNearestFurnace(bot) {
      /**
       * Clears the nearest furnace of all items.
       * @param {MinecraftBot} bot, reference to the minecraft bot.
       * @returns {Promise<boolean>} true if the furnace was cleared, false otherwise.
       * @example
       * await skills.clearNearestFurnace(bot);
       **/
      let furnaceBlock = world.getNearestBlock(bot, 'furnace', 32);
      if (!furnaceBlock) {
          log(bot, `No furnace nearby to clear.`);
          return false;
      }
      if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
          await goToNearestBlock(bot, 'furnace', 4, 32);
      }


      const furnace = await bot.openFurnace(furnaceBlock);

      // take the items out of the furnace
      let smelted_item, intput_item, fuel_item;
      if (furnace.outputItem())
          smelted_item = await furnace.takeOutput();
      if (furnace.inputItem())
          intput_item = await furnace.takeInput();
      if (furnace.fuelItem())
          fuel_item = await furnace.takeFuel();

      let smelted_name = smelted_item ? `${smelted_item.count} ${smelted_item.name}` : `0 smelted items`;
      let input_name = intput_item ? `${intput_item.count} ${intput_item.name}` : `0 input items`;
      let fuel_name = fuel_item ? `${fuel_item.count} ${fuel_item.name}` : `0 fuel items`;
      log(bot, `Cleared furnace, received ${smelted_name}, ${input_name}, and ${fuel_name}.`);
      return true;

  }

  async function goToNearestBlock(bot, blockType,  min_distance=2, range=64) {
      /**
       * Navigate to the nearest block of the given type.
       * @param {MinecraftBot} bot, reference to the minecraft bot.
       * @param {string} blockType, the type of block to navigate to.
       * @param {number} min_distance, the distance to keep from the block. Defaults to 2.
       * @param {number} range, the range to look for the block. Defaults to 64.
       * @returns {Promise<boolean>} true if the block was reached, false otherwise.
       * @example
       * await skills.goToNearestBlock(bot, "oak_log", 64, 2);
       * **/
      const MAX_RANGE = 512;
      if (range > MAX_RANGE) {
          log(bot, `Maximum search range capped at ${MAX_RANGE}. `);
          range = MAX_RANGE;
      }
      let block = null;
      if (blockType === 'water' || blockType === 'lava') {
          let blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType && block.metadata === 0, range, 1);
          if (blocks.length === 0) {
              log(bot, `Could not find any source ${blockType} in ${range} blocks, looking for uncollectable flowing instead...`);
              blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType, range, 1);
          }
          block = blocks[0];
      }
      else {
          block = world.getNearestBlock(bot, blockType, range);
      }
      if (!block) {
          log(bot, `Could not find any ${blockType} in ${range} blocks.`);
          return false;
      }
      log(bot, `Found ${blockType} at ${block.position}. Navigating...`);
      return await goToPosition(bot, block.position.x, block.position.y, block.position.z, min_distance);
  }

  async function goToNearestEntity(bot, entityType, min_distance=2, range=64) {
      /**
       * Navigate to the nearest entity of the given type.
       * @param {MinecraftBot} bot, reference to the minecraft bot.
       * @param {string} entityType, the type of entity to navigate to.
       * @param {number} min_distance, the distance to keep from the entity. Defaults to 2.
       * @param {number} range, the range to look for the entity. Defaults to 64.
       * @returns {Promise<boolean>} true if the entity was reached, false otherwise.
       **/
      let entity = world.getNearestEntityWhere(bot, entity => entity.name === entityType, range);
      if (!entity) {
          log(bot, `Could not find any ${entityType} in ${range} blocks.`);
          return false;
      }
      let distance = bot.entity.position.distanceTo(entity.position);
      log(bot, `Found ${entityType} ${distance} blocks away.`);
      return await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, min_distance);
  }

  async function viewChest(bot) {
      /**
       * View the contents of the nearest chest.
       * @param {MinecraftBot} bot, reference to the minecraft bot.
       * @returns {Promise<boolean>} true if the chest was viewed, false otherwise.
       * @example
       * await skills.viewChest(bot);
       * **/
      let chest = world.getNearestBlock(bot, 'chest', 32);
      if (!chest) {
          log(bot, `Could not find a chest nearby.`);
          return false;
      }
      await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
      const chestContainer = await bot.openContainer(chest);
      let items = chestContainer.containerItems();
      if (items.length === 0) {
          log(bot, `The chest is empty.`);
      }
      else {
          log(bot, `The chest contains:`);
          for (let item of items) {
              log(bot, `${item.count} ${item.name}`);
          }
      }
      await chestContainer.close();
      return true;
  }

  async function showVillagerTrades(bot, id) {
      const villagerEntity = await findAndGoToVillager(bot, id);
      if (!villagerEntity) {
          return false;
      }

      try {
          const villager = await bot.openVillager(villagerEntity);

          if (!villager.trades || villager.trades.length === 0) {
              log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
              villager.close();
              return false;
          }

          log(bot, `Villager has ${villager.trades.length} available trades:`);
          stringifyTrades(bot, villager.trades).forEach((trade, i) => {
              const tradeInfo = `${i + 1}: ${trade}`;

              log(bot, tradeInfo);
          });

          villager.close();
          return true;
      } catch (err) {
          log(bot, 'Failed to open villager trading interface - they might be sleeping, a baby, or jobless');

          return false;
      }
  }

  async function tradeWithVillager(bot, id, index, count=1) {
      const villagerEntity = await findAndGoToVillager(bot, id);
      if (!villagerEntity) {
          return false;
      }

      try {
          const villager = await bot.openVillager(villagerEntity);

          if (!villager.trades || villager.trades.length === 0) {
              log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
              villager.close();
              return false;
          }

          const tradeIndex = parseInt(index) - 1; // Convert to 0-based index
          const trade = villager.trades[tradeIndex];

          if (!trade) {
              log(bot, `Trade ${index} not found. This villager has ${villager.trades.length} trades available.`);
              villager.close();
              return false;
          }

          if (trade.disabled) {
              log(bot, `Trade ${index} is currently disabled`);
              villager.close();
              return false;
          }

          const item_2 = trade.inputItem2 ? stringifyItem(bot, trade.inputItem2)+' ' : '';
          log(bot, `Trading ${stringifyItem(bot, trade.inputItem1)} ${item_2}for ${stringifyItem(bot, trade.outputItem)}...`);

          const maxPossibleTrades = trade.maximumNbTradeUses - trade.nbTradeUses;
          const requestedCount = count;
          const actualCount = Math.min(requestedCount, maxPossibleTrades);

          if (actualCount <= 0) {
              log(bot, `Trade ${index} has been used to its maximum limit`);
              villager.close();
              return false;
          }

          if (!hasResources(villager.slots, trade, actualCount)) {
              log(bot, `Don't have enough resources to execute trade ${index} ${actualCount} time(s)`);
              villager.close();
              return false;
          }

          log(bot, `Executing trade ${index} ${actualCount} time(s)...`);

          try {
              await bot.trade(villager, tradeIndex, actualCount);
              log(bot, `Successfully traded ${actualCount} time(s)`);
              villager.close();
              return actualCount === requestedCount;
          } catch (tradeErr) {
              log(bot, 'An error occurred while trying to execute the trade');

              villager.close();
              return false;
          }
      } catch (err) {
          log(bot, 'Failed to open villager trading interface');

          return false;
      }
  }

  function hasResources(window, trade, count) {
      const first = enough(trade.inputItem1, count);
      const second = !trade.inputItem2 || enough(trade.inputItem2, count);
      return first && second;

      function enough(item, count) {
          let c = 0;
          window.forEach((element) => {
              if (element && element.type === item.type && element.metadata === item.metadata) {
                  c += element.count;
              }
          });
          return c >= item.count * count;
      }
  }

  function stringifyTrades(bot, trades) {
      return trades.map((trade) => {
          let text = stringifyItem(bot, trade.inputItem1);
          if (trade.inputItem2) text += ` & ${stringifyItem(bot, trade.inputItem2)}`;
          if (trade.disabled) text += ' x '; else text += ' » ';
          text += stringifyItem(bot, trade.outputItem);
          return `(${trade.nbTradeUses}/${trade.maximumNbTradeUses}) ${text}`;
      });
  }

  function stringifyItem(bot, item) {
      if (!item) return 'nothing';
      let text = `${item.count} ${item.displayName}`;
      if (item.nbt && item.nbt.value) {
          const ench = item.nbt.value.ench;
          const StoredEnchantments = item.nbt.value.StoredEnchantments;
          const Potion = item.nbt.value.Potion;
          const display = item.nbt.value.display;

          if (Potion) text += ` of ${Potion.value.replace(/_/g, ' ').split(':')[1] || 'unknown type'}`;
          if (display) text += ` named ${display.value.Name.value}`;
          if (ench || StoredEnchantments) {
              text += ` enchanted with ${(ench || StoredEnchantments).value.value.map((e) => {
                  const lvl = e.lvl.value;
                  const id = e.id.value;
                  return bot.registry.enchantments[id].displayName + ' ' + lvl;
              }).join(' ')}`;
          }
      }
      return text;
  }

  async function digDown(bot, distance = 10) {
      /**
       * Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.
       * @param {MinecraftBot} bot, reference to the minecraft bot.
       * @param {int} distance, distance to dig down.
       * @returns {Promise<boolean>} true if successfully dug all the way down.
       * @example
       * await skills.digDown(bot, 10);
       **/

      let start_block_pos = bot.blockAt(bot.entity.position).position;
      for (let i = 1; i <= distance; i++) {
          const targetBlock = bot.blockAt(start_block_pos.offset(0, -i, 0));
          let belowBlock = bot.blockAt(start_block_pos.offset(0, -i-1, 0));

          if (!targetBlock || !belowBlock) {
              log(bot, `Dug down ${i-1} blocks, but reached the end of the world.`);
              return false;
          }

          // Check for lava, water
          if (targetBlock.name === 'lava' || targetBlock.name === 'water' ||
              belowBlock.name === 'lava' || belowBlock.name === 'water') {
              log(bot, `Dug down ${i-1} blocks, but reached ${belowBlock ? belowBlock.name : '(lava/water)'}`)
              return false;
          }

          const MAX_FALL_BLOCKS = 2;
          let num_fall_blocks = 0;
          for (let j = 0; j <= MAX_FALL_BLOCKS; j++) {
              if (!belowBlock || (belowBlock.name !== 'air' && belowBlock.name !== 'cave_air')) {
                  break;
              }
              num_fall_blocks++;
              belowBlock = bot.blockAt(belowBlock.position.offset(0, -1, 0));
          }
          if (num_fall_blocks > MAX_FALL_BLOCKS) {
              log(bot, `Dug down ${i-1} blocks, but reached a drop below the next block.`);
              return false;
          }

          if (targetBlock.name === 'air' || targetBlock.name === 'cave_air') {
              log(bot, 'Skipping air block');

              continue;
          }

          let dug = await breakBlockAt(bot, targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
          if (!dug) {
              log(bot, 'Failed to dig block at position:' + targetBlock.position);
              return false;
          }
      }
      log(bot, `Dug down ${distance} blocks.`);
      return true;
  }

  async function findAndGoToVillager(bot, id) {
      const entity = bot.entities[id];
      if (!entity || !['villager', 'wandering_trader'].includes(entity.name)) return null;
      if (bot.entity.position.distanceTo(entity.position) > 3)
          await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, 2);
      return bot.entities[id] ?? null;
  }

  function log(bot, message) { actions.note(String(message)); }

  async function wait(bot, milliseconds) {
    await actions.wait(milliseconds);
    return true;
  }
  async function stay(bot, seconds=30) { return wait(bot, seconds * 1000); }

  async function goToGoal(bot, goal) { return actions.goto(goal); }
  async function goToPosition(bot, x, y, z, min_distance=2) {
    return actions.goto({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), rangeSq: min_distance ** 2 });
  }
  async function goToPlayer(bot, username, distance=3) {
    const target = world.getNearbyPlayers(bot, 64).find(entity => entity.username === username);
    if (!target) return false;
    const {x,y,z} = target.position;
    await goToPosition(bot,x,y,z,distance);
    const fresh = bot.entities[target.id];
    return !!fresh && bot.entity.position.distanceTo(fresh.position) < distance + 1;
  }
  async function followPlayer(bot, username, distance=4) {
    while (!bot.interrupt_code) {
      const target = world.getNearbyPlayers(bot,64).find(e => e.username === username);
      if (!target) return false;
      if (target.position.distanceTo(bot.entity.position) > distance + 1)
        await goToPlayer(bot,username,distance);
      await wait(bot,250);
    }
    return false;
  }
  async function moveAway(bot, distance) { return actions.away(bot.entity.position, distance); }

  async function moveAwayFromEntity(bot, entity, distance=16) {
    const target=bot.entities[entity.id];
    if (!target) return false;
    return actions.away(target.position, distance, target.id);
  }
  async function avoidEnemies(bot, distance=16) {
    const threat = actions.nearestHostile(distance);
    return threat ? moveAwayFromEntity(bot,threat,distance) : true;
  }
  async function attackEntity(bot, entity, kill=true) {
    const target = bot.entities[entity.id];
    if (!target || target.id === bot.entity.id) return false;
    if (!kill) return actions.hit(target);
    return actions.step({skill:'attack',target:target.name ?? target.username,entityId:target.id});
  }
  async function attackNearest(bot, mobType, kill=true) {
    const target = world.getNearestEntityWhere(bot, entity => entity.name === mobType, 24);
    return !!target && attackEntity(bot,target,kill);
  }
  async function defendSelf(bot, range=9) {
    const target = actions.nearestHostile(range);
    return !!target && attackEntity(bot,target);
  }
  async function collectBlock(bot, blockType, num=1, exclude=null) {
    if (!exclude?.length) return actions.step({skill:'collect',block:blockType,count:num});
    const forbidden = new Set(exclude.map(p => [p.x,p.y,p.z].join(',')));
    for (let i=0; i<num; i++) {
      const block = world.getNearestBlocks(bot,blockType,32,64).find(b => !forbidden.has(b.position.toArray().join(',')));
      if (!block) return false;
      const p = block.position;
      await breakBlockAt(bot,p.x,p.y,p.z);
      await pickupNearbyItems(bot);
    }
    return true;
  }
  async function pickupNearbyItems(bot) { return actions.step({skill:'pickup'}); }
  async function breakBlockAt(bot,x,y,z) { return actions.breakAt(x,y,z); }
  async function placeBlock(bot, blockType, x,y,z,placeOn='bottom',dontCheat=false) {
    return actions.place(blockType,x,y,z,placeOn);
  }
  async function equip(bot,itemName) { return actions.equip(itemName); }
  async function consume(bot,itemName="") {
    const item = itemName || bot.inventory.items().find(i => Object.hasOwn(bot.registry.foodsByName ?? {},i.name))?.name;
    return !!item && actions.step({skill:'eat',item});
  }
  async function giveToPlayer(bot,itemType,username,num=1) {
    return actions.step({skill:'toss',item:itemType,count:num,target:username});
  }
  async function discard(bot,itemName,num=-1) {
    const held = bot.inventory.items().filter(i => i.name === itemName).reduce((n,i) => n+i.count,0);
    return held > 0 && actions.step({skill:'toss',item:itemName,count:num === -1 ? held : Math.min(held,num)});
  }
  async function putInChest(bot,itemName,num=-1) {
    const chest=world.getNearestBlock(bot,'chest',32);
    const held=bot.inventory.items().filter(i => i.name === itemName).reduce((n,i)=>n+i.count,0);
    return !!chest && held>0 && actions.step({skill:'stow',item:itemName,count:num===-1?held:Math.min(held,num),at:chest.position.toArray()});
  }
  async function takeFromChest(bot,itemName,num=-1) {
    const chest=world.getNearestBlock(bot,'chest',32);
    if (!chest) return false;
    await goToPosition(bot,...chest.position.toArray(),2);
    const win=await bot.openContainer(chest);
    const stacks=win.containerItems().filter(item=>item.name===itemName);
    const available=stacks.reduce((n,item)=>n+item.count,0);
    let left=num===-1 ? available : Math.min(available,num);
    if (!left) return false;
    for (const stack of stacks) {
      const take=Math.min(left,stack.count);
      await win.withdraw(stack.type,stack.metadata,take,stack.nbt);
      left-=take;
      if (!left) break;
    }
    return left===0;
  }
  async function smeltItem(bot,itemName,num=1) {
    const fuel=mc.getSmeltingFuel(bot);
    return !!fuel && actions.step({skill:'smelt',input:itemName,count:num,fuel:fuel.name});
  }
  async function useDoor(bot,door_pos=null) {
    const ids=Object.values(bot.registry.blocksByName).filter(b=>b.name.endsWith('_door') && b.name!=='iron_door').map(b=>b.id);
    const pos=door_pos ?? world.getNearestBlocksWhere(bot,ids,16,1)[0]?.position;
    return !!pos && actions.step({skill:'use',at:[pos.x,pos.y,pos.z],open:true});
  }
  async function goToBed(bot) {
    const names=Object.keys(bot.registry.blocksByName).filter(name=>name.endsWith('_bed'));
    const bed=world.getNearestBlocks(bot,names,32,1)[0];
    if (!bed) return false;
    await goToPosition(bot,...bed.position.toArray(),2);
    await bot.sleep(bed);
    return bot.isSleeping===true;
  }
  async function tillAndSow(bot,x,y,z,seedType=null) {
    const pos=actions.point(x,y,z);
    let ground=bot.blockAt(pos);
    if (!ground || !['grass_block','dirt','farmland'].includes(ground.name)) return false;
    const crop=bot.blockAt(pos.offset(0,1,0));
    if (!crop || !['air','cave_air'].includes(crop.name)) return false;
    if (ground.name!=='farmland') {
      const hoe=bot.inventory.items().find(i=>i.name.endsWith('_hoe'));
      if (!hoe) return false;
      await actions.step({skill:'use',item:hoe.name,at:pos.toArray()});
      ground=bot.blockAt(pos);
      if (ground?.name!=='farmland') return false;
    }
    if (!seedType) return true;
    await actions.step({skill:'use',item:seedType,at:pos.toArray(),face:'up'});
    const planted=bot.blockAt(pos.offset(0,1,0));
    return !!planted && !['air','cave_air'].includes(planted.name);
  }
  async function activateNearestBlock(bot,type) {
    const block=world.getNearestBlock(bot,type,16);
    return !!block && actions.step({skill:'use',at:block.position.toArray()});
  }
  async function goToSurface(bot) {
    const from = bot.entity.position.floored();
    for (let dy=32; dy>=0; dy--) {
      const support=bot.blockAt(from.offset(0,dy,0));
      const feet=bot.blockAt(from.offset(0,dy+1,0));
      if (!support || support.boundingBox !== 'block' || feet?.name !== 'air' || feet.skyLight !== 15) continue;
      return goToPosition(bot,from.x,from.y+dy+1,from.z,0);
    }
    return false;
  }
  async function useToolOnBlock(bot,toolName,block) {
    if (!block?.position) return false;
    return actions.step({skill:'use',...(toolName==='hand'?{}:{item:toolName}),at:[block.position.x,block.position.y,block.position.z]});
  }
  async function useToolOn(bot,toolName,targetName) {
    const block=world.getNearestBlock(bot,targetName,16);
    if (block) return useToolOnBlock(bot,toolName,block);
    const entity=world.getNearestEntityWhere(bot,e=>e.name===targetName,16);
    return !!entity && actions.step({skill:'use',...(toolName==='hand'?{}:{item:toolName}),target:targetName,entityId:entity.id});
  }
  return { log, craftRecipe, wait, smeltItem, clearNearestFurnace, attackNearest, attackEntity, defendSelf, collectBlock, pickupNearbyItems, breakBlockAt, placeBlock, equip, discard, putInChest, takeFromChest, viewChest, consume, giveToPlayer, goToGoal, goToPosition, goToNearestBlock, goToNearestEntity, goToPlayer, followPlayer, moveAway, moveAwayFromEntity, avoidEnemies, stay, useDoor, goToBed, tillAndSow, activateNearestBlock, showVillagerTrades, tradeWithVillager, digDown, goToSurface, useToolOn, useToolOnBlock };
}
