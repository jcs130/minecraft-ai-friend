// Isolated server account has already completed two ten-floor runs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: 'Loot25843539', auth: 'offline', version: '1.20.6'});
const lines = [];
bot.on('messagestr', line => lines.push(line));
const ask = async (command, action) => {
  lines.length = 0;
  bot.chat(command);
  for (let elapsed = 0; elapsed < 10000; elapsed += 100) {
    const replies = lines.filter(line => line.startsWith('MC_ARENA_ECONOMY '))
      .map(line => JSON.parse(line.slice('MC_ARENA_ECONOMY '.length)));
    const result = replies.find(reply => reply.action === action);
    if (result) return {result, replies};
    await sleep(100);
  }
  throw new Error(`no ${action}: ${command}`);
};

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  const gear = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const response = await ask(`/mycli arena recycle list ${page}`, 'recycle_list_end');
    pages = response.result.pages;
    gear.push(...response.replies.filter(reply => reply.action === 'recycle_list'));
  }
  assert.ok(gear.some(entry => entry.item?.name === '苔原旅盔'));
  assert.ok(gear.some(entry => entry.item?.name === '星辉冠'));
  assert.ok(!gear.some(entry => entry.item?.name === '深渊裁决'), 'unique boss relic must stay protected');
  const duplicate = gear.find(entry => entry.item?.name === '苔原旅盔' && entry.source === 'chest');
  assert.ok(duplicate);
  const {result: quote} = await ask(`/mycli arena recycle quote chest ${duplicate.slot}`, 'quote');
  assert.equal(quote.success, true);
  const {result: sold} = await ask(`/mycli arena recycle sell ${quote.quoteId}`, 'sell');
  assert.equal(sold.success, true);
  assert.ok(sold.balance > 0);
  bot.chat('/mycli arena loot');
  for (let elapsed = 0; elapsed < 10000 && !lines.some(line => line.startsWith('MC_DUNGEON_SET ')); elapsed += 100)
    await sleep(100);
  assert.ok(lines.some(line => line.includes('diamondIndex=4')));
  console.log(JSON.stringify({verdict: 'PASS', recyclable: gear.length,
    sold: sold.item.name, balance: sold.balance, diamondIndex: 4}));
} finally { bot.quit(); }
