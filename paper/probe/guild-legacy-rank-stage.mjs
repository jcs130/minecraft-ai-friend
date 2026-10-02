import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
// Stage config seeds this offline UUID with fame=360, joined=true and no
// rituals.certified. The migration must keep its preexisting Diamond rank.
const username = 'GuildLegacyQA';
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567,
  username, auth: 'offline', version: '1.20.6' });
const lines = [];
bot.on('messagestr', line => lines.push(line));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(test, label) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}; lines=${JSON.stringify(lines.slice(-5))}`);
}
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
  });
  bot.chat('/mycli guild status');
  await waitFor(() => lines.some(line => line.includes('冒险者认证：钻石')), 'legacy rank');
  bot.chat('/mycli guild menu');
  await waitFor(() => bot.currentWindow?.slots[0]?.name === 'book', 'guild menu');
  assert.equal(bot.currentWindow.slots[47]?.name, 'sunflower');
  assert.equal(bot.currentWindow.slots[48]?.name, 'barrier');
  assert.equal(bot.currentWindow.slots[49]?.name, 'emerald');
  console.log(JSON.stringify({ verdict: 'PASS', rank: '钻石', controls: [47, 48, 49] }));
} finally {
  bot.quit();
}
