import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/staging/life-guild-20261003/rcon-stage.mjs', command], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const username = `LifeFish${Date.now().toString(36).slice(-4)}`;
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567,
  username, auth: 'offline', version: '1.20.6' });
const receipts = [];
bot._client.on('custom_payload', packet => {
  if (packet.channel === 'mcagent:life') receipts.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
});
async function waitFor(test, label, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
}
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
  });
  rcon('minecraft:fill -6 70 -1 6 80 13 minecraft:air');
  rcon('minecraft:fill -6 68 3 6 68 12 minecraft:stone');
  rcon('minecraft:fill -6 69 3 6 70 12 minecraft:water');
  rcon(`minecraft:tp ${username} 0.5 70 0.5`);
  bot.chat('/mycli life accept angler_catch');
  await waitFor(() => receipts.some(item => item.kind === 'accept' && item.id === 'angler_catch'), 'accept');
  await waitFor(() => bot.inventory.items().some(item => item.name === 'fishing_rod'), 'starter rod');
  await bot.equip(bot.inventory.items().find(item => item.name === 'fishing_rod'), 'hand');
  await bot.lookAt(new Vec3(0, 70, 9), true);
  for (let i = 0; i < 3; i++) {
    await Promise.race([bot.fish(), sleep(45000).then(() => { throw new Error('fish timeout'); })]);
    console.log(`fish ${i + 1}`);
  }
  await waitFor(() => receipts.some(item => item.kind === 'progress'
    && item.id === 'angler_catch' && item.progress === 3), 'fish progress');
  bot.chat('/mycli life claim');
  await waitFor(() => receipts.some(item => item.kind === 'claim'
    && item.id === 'angler_catch' && item.success), 'fish claim');
  assert.ok(bot.inventory.items().some(item => ['cod', 'salmon', 'tropical_fish', 'pufferfish']
    .includes(item.name)), 'caught fish not present');
  console.log(JSON.stringify({ verdict: 'PASS', catches: 3, claimed: true }));
} finally {
  bot.quit();
}
