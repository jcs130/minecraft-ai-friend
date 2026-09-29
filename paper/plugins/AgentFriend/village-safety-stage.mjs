// Isolated 25566 check: weeds can be cleared inside a protected house; structures and villagers remain safe.
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
try {
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject)});
  const grass = new Vec3(-552,68,-433), foundation = new Vec3(-552,67,-433);
  rcon('minecraft:setblock -552 68 -433 minecraft:short_grass');
  rcon(`minecraft:tp ${bot.username} -550.5 69 -432.5`);
  await sleep(500);
  assert.equal(bot.blockAt(grass)?.name, 'short_grass');
  const floorName = bot.blockAt(foundation)?.name;
  const beforeGrassChat=chats.length;
  await bot.dig(bot.blockAt(grass));
  await sleep(400);
  assert.equal(bot.blockAt(grass)?.name, 'air', 'Grass inside the house region should be clearable');
  assert.ok(!chats.slice(beforeGrassChat).some((line)=>line.includes("can't break")),
    `Clearing grass should not show a contradictory denial: ${JSON.stringify(chats.slice(beforeGrassChat))}`);
  try { await bot.dig(bot.blockAt(foundation)); } catch { /* WorldGuard can reject dig before completion. */ }
  await sleep(400);
  assert.equal(bot.blockAt(foundation)?.name, floorName, 'Protected foundation must remain intact');
  rcon('minecraft:summon minecraft:villager -552.5 68 -433.5 {Tags:["afu_qa_villager"],NoAI:1b}');
  rcon(`minecraft:tp ${bot.username} -551.5 68 -433.5`);
  await sleep(1500);
  const villager = bot.nearestEntity((entity) => entity.name === 'villager');
  assert.ok(villager, 'Fixture villager should be visible to the client');
  const villagerDistance = bot.entity.position.distanceTo(villager.position);
  bot.attack(villager);
  await sleep(400);
  const villagerHealth = rcon('minecraft:data get entity @e[tag=afu_qa_villager,limit=1] Health');
  assert.match(villagerHealth, /20\.0f/, 'Villager in safe zone should take no damage');
  rcon('minecraft:summon minecraft:sheep -554.5 67 -440.5 {Tags:["afu_qa_sheep"],NoAI:1b}');
  rcon(`minecraft:tp ${bot.username} -553.5 67 -440.5`);
  await sleep(1500);
  const sheep = bot.nearestEntity((entity) => entity.name === 'sheep');
  assert.ok(sheep, 'Fixture sheep should be visible to the client');
  const sheepDistance = bot.entity.position.distanceTo(sheep.position);
  bot.attack(sheep);
  await sleep(400);
  const sheepHealth = rcon('minecraft:data get entity @e[tag=afu_qa_sheep,limit=1] Health');
  assert.ok(!/8\.0f/.test(sheepHealth), `Sheep should remain interactable: ${sheepHealth}; distance=${sheepDistance}; villagerDistance=${villagerDistance}`);
  assert.equal(errors.length, 0, `Client errors: ${errors}`);
  console.log(JSON.stringify({verdict:'PASS',grassCleared:true,foundation:floorName,
    villagerHealth:villagerHealth.trim(),sheepHealth:sheepHealth.trim()}));
} finally {
  try { rcon('minecraft:kill @e[tag=afu_qa_villager]'); } catch { }
  try { rcon('minecraft:kill @e[tag=afu_qa_sheep]'); } catch { }
  bot.quit();
}
