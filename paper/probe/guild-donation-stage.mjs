import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
// Stage config seeds an in-progress harvest_home donation for this offline UUID.
const username = 'GuildDonateQA';
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/staging/life-guild-20261003/rcon-stage.mjs', command], { encoding: 'utf8' });
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
  await waitFor(() => lines.some(line => line.includes('丰收归仓') && line.includes('0/16')), 'empty donation');
  rcon(`minecraft:give ${username} minecraft:wheat 16`);
  await waitFor(() => bot.inventory.items().some(item => item.name === 'wheat' && item.count >= 16), 'wheat arrived');
  bot.chat('/mycli guild status');
  await waitFor(() => lines.some(line => line.includes('丰收归仓') && line.includes('16/16')), 'dynamic donation progress');
  bot.chat('/mycli guild claim');
  await waitFor(() => lines.some(line => line.includes('委托交付成功')), 'donation claim');
  assert.equal(bot.inventory.items().filter(item => item.name === 'wheat').reduce((n, item) => n + item.count, 0),
    0, 'donated wheat remained in inventory');
  bot.chat('/mycli guild status');
  await waitFor(() => lines.some(line => line.includes('已完成 1 单')), 'completed count');
  console.log(JSON.stringify({ verdict: 'PASS', donation: 16, claimed: true }));
} finally {
  bot.quit();
}
