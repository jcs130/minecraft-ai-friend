import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const username = process.argv[2];
if (!username) throw new Error('Pass the test player name from arena-economy-stage.mjs');
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username, auth: 'offline', version: '1.20.6'});
const receipts = [];
bot.on('messagestr', line => {
  if (line.startsWith('MC_ARENA_ECONOMY ')) receipts.push(JSON.parse(line.slice(17)));
});
await new Promise((resolve, reject) => {
  bot.once('spawn', resolve);
  bot.once('error', reject);
  bot.once('kicked', reject);
});
try {
  bot.chat('/mycli arena wallet');
  for (let n = 0; n < 100 && !receipts.some(value => value.action === 'wallet'); n++)
    await new Promise(resolve => setTimeout(resolve, 100));
  const wallet = receipts.find(value => value.action === 'wallet');
  assert.ok(wallet);
  assert.equal(wallet.balance, 2);
  bot.chat('/mycli arena rewards');
  const window = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chest window timed out')), 10000);
    bot.once('windowOpen', value => {clearTimeout(timer); resolve(value);});
  });
  const arrows = window.containerItems().filter(value => value.name === 'arrow')
    .reduce((sum, value) => sum + value.count, 0);
  assert.ok(arrows >= 16, 'purchased arrows persisted and materialized into personal chest');
  bot.closeWindow(window);
  console.log(JSON.stringify({verdict: 'PASS', balance: wallet.balance, arrowsInChest: arrows}));
} finally { bot.quit(); }
