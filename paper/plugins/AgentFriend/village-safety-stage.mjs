// Isolated Paper 1.20.6: original house fabric stays protected; leaves and new blocks do not.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const rcon = (cmd) => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', cmd], { encoding:'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566,
  username:`Village${String(Date.now()).slice(-7)}`, auth:'offline', version:'1.20.6' });
const errors=[];
const chats=[];
bot.on('messagestr',(line)=>chats.push(line));
bot.on('error', (error) => errors.push(error.message));
bot.on('kicked', (reason) => errors.push(JSON.stringify(reason)));
const fixture = new Vec3(-559,100,-436); // Inside afu_house_02, above its original roof.
const wall = new Vec3(-551,68,-432); // Original stripped spruce log in the captured mask.
try {
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject)});
  rcon('minecraft:fill -560 99 -437 -557 99 -434 minecraft:stone');
  rcon(`minecraft:tp ${bot.username} -557.5 100 -435.5`);
  rcon(`minecraft:give ${bot.username} minecraft:dirt 2`);
  await sleep(1200);
  assert.equal(bot.blockAt(fixture)?.name, 'air', 'House test space should start empty');
  const dirt = bot.inventory.items().find((item)=>item.name==='dirt');
  assert.ok(dirt, 'Dirt fixture missing');
  await bot.equip(dirt,'hand');
  await bot.placeBlock(bot.blockAt(fixture.offset(0,-1,0)),new Vec3(0,1,0));
  await sleep(350);
  assert.equal(bot.blockAt(fixture)?.name, 'dirt', 'Player should be able to place inside a house region');
  await bot.dig(bot.blockAt(fixture));
  await sleep(350);
  assert.equal(bot.blockAt(fixture)?.name, 'air', 'Player should be able to remove their own block');

  rcon('minecraft:setblock -559 100 -436 minecraft:oak_leaves');
  await sleep(250);
  assert.equal(bot.blockAt(fixture)?.name, 'oak_leaves');
  const beforeLeafChat=chats.length;
  await bot.dig(bot.blockAt(fixture));
  await sleep(350);
  assert.equal(bot.blockAt(fixture)?.name, 'air', 'Leaves inside a house region should be clearable');
  assert.ok(!chats.slice(beforeLeafChat).some((line)=>line.includes("can't break")),
    `Leaves should not show a WorldGuard denial: ${JSON.stringify(chats.slice(beforeLeafChat))}`);

  rcon(`minecraft:tp ${bot.username} -550.5 69 -432.5`);
  await sleep(850);
  assert.equal(bot.blockAt(wall)?.name, 'stripped_spruce_log', 'Expected original wall block');
  try { await bot.dig(bot.blockAt(wall)); } catch { /* Protected dig may reject completion. */ }
  await sleep(350);
  assert.equal(bot.blockAt(wall)?.name, 'stripped_spruce_log', 'Original house wall must remain intact');

  rcon('minecraft:summon minecraft:villager -554.5 68 -440.5 {Tags:["afu_qa_villager"],NoAI:1b}');
  rcon(`minecraft:tp ${bot.username} -553.5 68 -440.5`);
  await sleep(1200);
  const villager = bot.nearestEntity((entity) => entity.name === 'villager');
  assert.ok(villager, 'Fixture villager should be visible');
  bot.attack(villager);
  await sleep(350);
  const villagerHealth = rcon('minecraft:data get entity @e[tag=afu_qa_villager,limit=1] Health');
  assert.match(villagerHealth, /20\.0f/, 'Village villager should take no damage');
  rcon('minecraft:kill @e[tag=afu_qa_villager]');
  rcon('minecraft:summon minecraft:sheep -554.5 68 -440.5 {Tags:["afu_qa_sheep"],NoAI:1b}');
  await sleep(500);
  const sheep = bot.nearestEntity((entity) => entity.name === 'sheep');
  assert.ok(sheep, 'Fixture sheep should be visible');
  bot.attack(sheep);
  await sleep(350);
  const sheepHealth = rcon('minecraft:data get entity @e[tag=afu_qa_sheep,limit=1] Health');
  assert.ok(!/8\.0f/.test(sheepHealth), `Sheep should remain interactable: ${sheepHealth}`);
  assert.equal(errors.length, 0, `Client errors: ${errors}`);
  console.log(JSON.stringify({verdict:'PASS',place:true,removeOwnBlock:true,
    leafCleared:true,originalWallProtected:true,villagerHealth:villagerHealth.trim(),
    sheepHealth:sheepHealth.trim()}));
} finally {
  try { rcon('minecraft:kill @e[tag=afu_qa_villager]'); } catch { }
  try { rcon('minecraft:kill @e[tag=afu_qa_sheep]'); } catch { }
  try { rcon('minecraft:fill -560 99 -437 -557 99 -434 minecraft:air'); } catch { }
  try { rcon('minecraft:setblock -559 100 -436 minecraft:air'); } catch { }
  bot.quit();
}
