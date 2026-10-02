import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const rconPath = 'E:/MC/staging/life-guild-20261003/rcon-stage.mjs';
const rcon = command => execFileSync(process.execPath, [rconPath, command], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const username = `LifeEv${Date.now().toString(36).slice(-5)}`;
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567,
  username, auth: 'offline', version: '1.20.6' });
const packets = [];
const errors = [];
bot.on('error', error => errors.push(error.message));
bot.on('kicked', reason => errors.push(`kicked: ${JSON.stringify(reason)}`));
bot._client.on('custom_payload', packet => {
  if (packet.channel === 'mcagent:life') packets.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
});
async function waitFor(predicate, label, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (predicate()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}; last=${JSON.stringify(packets.at(-1))}`);
}
const progress = id => packets.findLast(packet => packet.kind === 'progress' && packet.id === id)?.progress ?? 0;
const equip = async name => {
  const item = bot.inventory.items().find(item => item.name === name);
  assert.ok(item, `missing ${name}`);
  await bot.equip(item, 'hand');
};
const positions = [];
for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
  if (x === 0 && z === 0) continue;
  positions.push(new Vec3(x, 70, z));
}

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reason => reject(new Error(JSON.stringify(reason))));
  });
  rcon(`op ${username}`);
  rcon('minecraft:fill -5 70 -5 5 80 5 minecraft:air');
  rcon('minecraft:fill -5 69 -5 5 69 5 minecraft:stone');
  rcon(`minecraft:tp ${username} 0.5 70 0.5`);
  await sleep(500);

  bot.chat('/mycli life accept builder_home');
  await waitFor(() => packets.some(packet => packet.kind === 'accept' && packet.id === 'builder_home'), 'builder accept');
  rcon(`minecraft:give ${username} minecraft:oak_planks 16`);
  await waitFor(() => bot.inventory.items().some(item => item.name === 'oak_planks'), 'planks');
  await equip('oak_planks');
  for (const position of positions.slice(0, 12)) {
    await bot.placeBlock(bot.blockAt(position.offset(0, -1, 0)), new Vec3(0, 1, 0));
    await sleep(80);
  }
  await waitFor(() => progress('builder_home') === 12, 'builder progress');
  bot.chat('/mycli life claim');
  await waitFor(() => packets.some(packet => packet.kind === 'claim' && packet.id === 'builder_home' && packet.success),
    'builder claim');

  bot.chat('/mycli life accept farmer_harvest');
  await waitFor(() => packets.some(packet => packet.kind === 'accept' && packet.id === 'farmer_harvest'), 'farm accept');
  for (const position of positions.slice(0, 12)) {
    rcon(`minecraft:setblock ${position.x} 70 ${position.z} minecraft:wheat[age=7]`);
    await bot.dig(bot.blockAt(position));
    await sleep(80);
  }
  await waitFor(() => progress('farmer_harvest') === 12, 'farm progress');
  bot.chat('/mycli life claim');
  await waitFor(() => packets.some(packet => packet.kind === 'claim' && packet.id === 'farmer_harvest' && packet.success),
    'farm claim');

  bot.chat('/mycli life accept tinkerer_light');
  await waitFor(() => packets.some(packet => packet.kind === 'accept' && packet.id === 'tinkerer_light'), 'redstone accept');
  rcon(`minecraft:give ${username} minecraft:redstone_lamp 1`);
  rcon(`minecraft:give ${username} minecraft:lever 1`);
  await waitFor(() => bot.inventory.items().some(item => item.name === 'redstone_lamp')
    && bot.inventory.items().some(item => item.name === 'lever'), 'redstone materials');
  const lamp = new Vec3(1, 70, 1);
  const lever = new Vec3(2, 70, 1);
  await equip('redstone_lamp');
  await bot.placeBlock(bot.blockAt(lamp.offset(0, -1, 0)), new Vec3(0, 1, 0));
  await equip('lever');
  await bot.placeBlock(bot.blockAt(lever.offset(0, -1, 0)), new Vec3(0, 1, 0));
  await bot.activateBlock(bot.blockAt(lever));
  await waitFor(() => progress('tinkerer_light') === 1, 'lit lamp progress');
  bot.chat('/mycli life claim');
  await waitFor(() => packets.some(packet => packet.kind === 'claim' && packet.id === 'tinkerer_light' && packet.success),
    'redstone claim');

  bot.chat('/mycli life accept gourmet_bread');
  await waitFor(() => packets.some(packet => packet.kind === 'accept' && packet.id === 'gourmet_bread'), 'chef accept');
  rcon('minecraft:setblock 0 70 -2 minecraft:crafting_table');
  rcon(`minecraft:give ${username} minecraft:wheat 9`);
  await waitFor(() => bot.inventory.items().some(item => item.name === 'wheat' && item.count >= 9), 'wheat');
  const table = bot.blockAt(new Vec3(0, 70, -2));
  const breadId = bot.registry.itemsByName.bread.id;
  const recipe = bot.recipesFor(breadId, null, 1, table)[0];
  assert.ok(recipe, 'bread recipe missing');
  for (let i = 0; i < 3; i++) await bot.craft(recipe, 1, table);
  await waitFor(() => progress('gourmet_bread') === 3, 'chef progress');
  bot.chat('/mycli life claim');
  await waitFor(() => packets.some(packet => packet.kind === 'claim' && packet.id === 'gourmet_bread' && packet.success),
    'chef claim');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', builder: 12, farmer: 12, redstone: 1,
    chef: 3, claimed: 4, packets: packets.length }));
} finally {
  bot.quit();
}
