// Isolated Paper 1.20.6 check: real vanilla book, private Agent command, use, persistence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = cmd => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', cmd], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const name = `Tome${String(Date.now()).slice(-9)}`;
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: name, auth: 'offline', version: '1.20.6'});
const lines = [];
const errors = [];
bot.on('messagestr', line => lines.push(line));
bot.on('error', error => errors.push(error.stack ?? String(error)));
bot.on('kicked', reason => errors.push(`kicked: ${JSON.stringify(reason)}`));
async function until(predicate, label, timeout = 10000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (errors.length) throw new Error(errors.join('\n'));
    const result = predicate();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`timeout ${label}: ${lines.slice(-10).join(' | ')}`);
}
const tome = () => bot.inventory.items().find(item => item.name === 'book'
  && JSON.stringify(item).includes('skill_tome_spell'));

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  const granted = rcon(`mycli admin givetome ${name} starbolt 4`);
  assert.match(granted, /发放成功/);
  const book = await until(tome, 'book with skill PDC');
  assert.match(JSON.stringify(book), /starbolt/);
  const initialSlot = book.slot >= 36 ? book.slot - 36 : book.slot;
  bot.chat('/mycli skillbook list');
  await until(() => lines.find(line => line.includes('MC_SKILLBOOK action=list')
    && line.includes('id=starbolt')), 'list reply');
  bot.chat(`/mycli skillbook use ${initialSlot}`);
  await until(() => lines.find(line => line.includes('MC_SKILLBOOK action=use ok=true')
    && line.includes('id=starbolt') && line.includes('gained=4')), 'use reply');
  assert.equal(tome(), undefined, 'one real book consumed');
  rcon(`mycli admin givetome ${name} leap 8`);
  const leap = await until(() => bot.inventory.items().find(item => item.name === 'book'
    && JSON.stringify(item).includes('leap')), 'leap book');
  await bot.equip(leap, 'hand');
  bot.activateItem();
  await until(() => lines.find(line => line.includes('MC_SKILLBOOK action=use ok=true')
    && line.includes('id=leap') && line.includes('gained=8')), 'hand-use reply');
  bot.chat('/mycli mastery');
  await until(() => lines.find(line => line.includes('MC_MASTERY id=leap')
    && line.includes('level=2') && line.includes('uses=8')), 'mastery persisted in memory');
  console.log('PASS skill tome: vanilla book PDC, private list/use, hand-use, consumption, mastery');
} finally {
  bot.quit();
}
