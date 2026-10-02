// Read-only production check. Whitelist GuildShareQA before running and remove it after.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync('node', ['E:/MC/probe/rcon.mjs', command], { encoding: 'utf8' });
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565,
  username: 'GuildShareQA', auth: 'offline', version: '1.20.6' });
const messages = [];
bot.on('messagestr', line => messages.push(line));
async function until(test, label, timeout = 10000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    const result = test();
    if (result) return result;
    await sleep(100);
  }
  throw Error(`Timed out: ${label}`);
}
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  bot.setQuickBarSlot(8);
  bot.chat('/mycli guild shared');
  await until(() => messages.filter(line => line.startsWith('MC_GUILD_SHARED ')).length === 4,
    'four public chest coordinates');
  rcon('minecraft:tp GuildShareQA -475.5 67 -493.5');
  await sleep(1000);
  await bot.waitForChunksToLoad();
  for (const z of [-495, -493, -491, -489]) {
    const block = bot.blockAt(new Vec3(-473, 67, z));
    assert.equal(block?.name, 'chest');
    const window = await bot.openContainer(block);
    assert.equal(window.inventoryStart, 54);
    bot.closeWindow(window);
  }
  rcon('minecraft:tp GuildShareQA -491.5 67 -498.5');
  await sleep(900);
  const receptionist = await until(() => bot.nearestEntity(entity => entity.name === 'villager'
    && entity.position.distanceTo(bot.entity.position) < 5), 'receptionist');
  const opening = new Promise(resolve => bot.once('windowOpen', resolve));
  bot.activateEntity(receptionist);
  const window = await Promise.race([opening, sleep(5000).then(() => { throw Error('NPC menu not opened'); })]);
  assert.equal(window.inventoryStart, 27);
  assert.equal(window.slots[12]?.name, 'emerald');
  assert.equal(window.slots[14]?.name, 'hopper');
  bot.closeWindow(window);
  console.log(JSON.stringify({ verdict: 'PASS', chests: 4, slotsPerChest: 54,
    receptionist: true, menu: true, readOnly: true }));
} finally { bot.quit(); }
