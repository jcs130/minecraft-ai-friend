import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', ['E:/MC/probe/rcon.mjs', command], { encoding: 'utf8' });
const username = `SQA${Date.now().toString(36).slice(-7)}`;
const lines = [];
let bot;

const ask = async (command, expected) => {
  const start = lines.length;
  bot.chat(command);
  for (let elapsed = 0; elapsed < 5000; elapsed += 100) {
    const answer = lines.slice(start).join('\n');
    if (expected.test(answer)) return answer;
    await sleep(100);
  }
  throw new Error(`No ${expected} response to ${command}: ${lines.slice(start).join(' | ')}`);
};

try {
  assert.match(rcon(`minecraft:whitelist add ${username}`), /Added|added|白名单/);
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565,
    username, auth: 'offline', version: '1.20.6' });
  bot.on('messagestr', (line) => lines.push(line));
  await Promise.race([
    new Promise((resolve, reject) => {
      bot.once('spawn', resolve); bot.once('error', reject);
      bot.once('kicked', (reason) => reject(new Error(JSON.stringify(reason))));
    }),
    sleep(20000).then(() => { throw new Error('spawn timeout'); }),
  ]);
  await ask('/mycli arena rewards list', /MC_REWARD_SUMMARY visible=0 queuedBonus=0/);
  await ask('/mycli arena stash list', /MC_STASH_SUMMARY occupied=0\/27/);
  rcon(`minecraft:give ${username} minecraft:cobblestone 3`);
  for (let i = 0; i < 30 && !bot.inventory.items().some((item) => item.name === 'cobblestone'); i++)
    await sleep(100);
  assert.ok(bot.inventory.items().some((item) => item.name === 'cobblestone'));
  rcon(`minecraft:tp ${username} -594.5 91 -311.5`);
  for (let i = 0; i < 100 && bot.entity.position.distanceTo(new Vec3(-594.5, 91, -311.5)) > 2; i++)
    await sleep(100);
  await bot.waitForChunksToLoad();
  const block = bot.blockAt(new Vec3(-594, 91, -313));
  assert.equal(block?.name, 'chest', 'trial entrance chest is present');
  let chest = await bot.openContainer(block);
  assert.equal(chest.inventoryStart, 27, 'normal chest window');
  await chest.deposit(bot.registry.itemsByName.cobblestone.id, null, 2);
  assert.equal(chest.containerItems().find((item) => item.name === 'cobblestone')?.count, 2);
  await chest.withdraw(bot.registry.itemsByName.cobblestone.id, null, 1);
  bot.closeWindow(chest);
  await ask('/mycli arena stash list', /MC_STASH slot=1 id=minecraft:cobblestone count=1/);
  chest = await bot.openContainer(block);
  assert.equal(chest.containerItems().find((item) => item.name === 'cobblestone')?.count, 1);
  await chest.withdraw(bot.registry.itemsByName.cobblestone.id, null, 1);
  bot.closeWindow(chest);
  await ask('/mycli arena stash list', /MC_STASH_SUMMARY occupied=0\/27/);
  console.log(JSON.stringify({ verdict: 'PASS', player: username, rewardIsolated: true,
    ordinaryChestDepositAndWithdraw: true }));
} finally {
  if (bot) bot.quit();
  rcon(`minecraft:whitelist remove ${username}`);
}
