// Isolated Paper 25566: console preview/apply moves only plain stash items into real public chests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
  username: `ShareQA${String(Date.now()).slice(-7)}`, auth: 'offline', version: '1.20.6' });
const messages = [];
bot.on('messagestr', line => messages.push(line));
async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    const found = check();
    if (found) return found;
    await sleep(100);
  }
  throw Error(`Timed out: ${label}`);
}
async function ask(command, pattern) {
  messages.length = 0;
  bot.chat(command);
  return until(() => messages.join('\n').match(pattern)?.[0], command);
}
async function countChest(z, type, expectedMinimum = 0) {
  const block = await until(() => bot.blockAt(new Vec3(-473, 67, z)), `chest ${z}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const chest = await bot.openContainer(block);
    await sleep(300 + attempt * 250);
    const count = chest.containerItems().filter(item => item.name === type)
      .reduce((sum, item) => sum + item.count, 0);
    bot.closeWindow(chest);
    await sleep(150);
    if (count >= expectedMinimum) return count;
  }
  throw Error(`chest ${z} never displayed ${type} count >= ${expectedMinimum}`);
}

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  rcon(`minecraft:give ${bot.username} minecraft:arrow 64`);
  rcon(`minecraft:give ${bot.username} minecraft:emerald 5`);
  rcon(`minecraft:give ${bot.username} minecraft:diamond_sword 1`);
  await until(() => bot.inventory.items().some(item => item.name === 'diamond_sword'), 'items delivered');
  await ask('/mycli arena stash put arrow 64', /MC_STASH_PUT .*moved=64/);
  await ask('/mycli arena stash put emerald 5', /MC_STASH_PUT .*moved=5/);
  await ask('/mycli arena stash put diamond_sword 1', /MC_STASH_PUT .*moved=1/);
  assert.match(rcon(`mycli admin sharetrial ${bot.username}`), /mode=preview planned=2 kept=1/);
  rcon(`minecraft:tp ${bot.username} -475.5 67 -493.5`);
  await until(() => bot.entity.position.distanceTo(new Vec3(-475.5, 67, -493.5)) < 2, 'teleport');
  await bot.waitForChunksToLoad();
  const arrowsBefore = await countChest(-491, 'arrow');
  const emeraldsBefore = await countChest(-489, 'emerald');
  assert.match(rcon(`mycli admin sharetrial ${bot.username} apply`), /ok=true moved=2/);
  const arrowsAfter = await countChest(-491, 'arrow', arrowsBefore + 64);
  const emeraldsAfter = await countChest(-489, 'emerald', emeraldsBefore + 5);
  assert.equal(arrowsAfter, arrowsBefore + 64,
    `arrows before=${arrowsBefore} after=${arrowsAfter}`);
  assert.equal(emeraldsAfter, emeraldsBefore + 5,
    `emeralds before=${emeraldsBefore} after=${emeraldsAfter}`);
  messages.length = 0;
  bot.chat('/mycli arena stash list');
  await until(() => messages.some(line => line.includes('MC_STASH_SUMMARY')), 'stash summary');
  const list = messages.join('\n');
  assert.match(list, /minecraft:diamond_sword/);
  assert.doesNotMatch(list, /minecraft:arrow|minecraft:emerald/);
  assert.match(rcon(`mycli admin sharetrial ${bot.username}`), /planned=0 kept=1/);
  console.log('PASS sharetrial preview/apply, physical double-chest deltas, unique gear retention, idempotence');
} finally {
  bot.quit();
}
