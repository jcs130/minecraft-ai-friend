// Production read-only smoke: a new Mineflayer player must be marked as a nonparticipant.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25565,
  username: `StatusQA${String(Date.now()).slice(-7)}`,
  auth: 'offline', version: '1.20.6'});
const lines = [];
const errors = [];
bot.on('messagestr', line => lines.push(line));
bot.on('error', error => errors.push(String(error)));
bot.on('kicked', reason => errors.push(String(reason)));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const query = async command => {
  const start = lines.length;
  bot.chat(command);
  for (let elapsed = 0; elapsed < 15000; elapsed += 100) {
    if (errors.length) throw new Error(errors.join('\n'));
    const result = lines.slice(start);
    const status = result.find(line => line.startsWith('MC_DUNGEON status '));
    const entrance = result.find(line => line.startsWith('MC_DUNGEON entrance '));
    if (status && entrance) return {status, entrance, lines: result};
    await sleep(100);
  }
  throw new Error(`${command}: ${JSON.stringify(lines.slice(-8))}`);
};

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  const receipts = [];
  for (const command of ['/mycli arena status', '/mycli status']) {
    const result = await query(command);
    assert.match(result.status, /participant=false selfState=not_participating globalActive=(true|false)/);
    assert.ok(result.lines.some(line => line.includes('本人试炼：未参赛；全服试炼：')));
    assert.match(result.entrance, /scope=public participant=false$/);
    receipts.push({command, status: result.status});
  }
  console.log(JSON.stringify({verdict: 'PASS', receipts}));
} finally { bot.quit(); }
