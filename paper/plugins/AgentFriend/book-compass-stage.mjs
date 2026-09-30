// Isolated Paper 1.20.6 contract: the tagged compass stays with its owner,
// ordinary compasses still drop, and the book transmits fresh personal pages.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const username = `Book${String(Date.now()).slice(-8)}`;
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
  username, auth: 'offline', version: '1.20.6' });
const messages = [];
bot.on('messagestr', line => messages.push(line));
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command],
  { encoding: 'utf8', timeout: 10000 });

try {
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); });
  await sleep(3000);
  let compass = bot.inventory.items().find(item => item.name === 'compass');
  let book = bot.inventory.items().find(item => item.name === 'written_book');
  assert.ok(compass && book, 'Starter compass and book must reach the client');
  const pages = JSON.stringify(book);
  for (const phrase of ['冒险战绩', '死亡次数', '角色成长', '没有可手动分配的属性点',
    '法术熟练度', '冒险者公会', '当前任务'])
    assert.ok(pages.includes(phrase), `Book wire item lacks ${phrase}`);

  await bot.tossStack(compass);
  await sleep(400);
  compass = bot.inventory.items().find(item => item.name === 'compass');
  assert.ok(compass, 'Tagged skill compass was lost after drop attempt');
  assert.ok(messages.some(line => line.includes('技能罗盘会留在身上')),
    'Server did not reject skill compass drop');

  await bot.tossStack(book);
  await sleep(400);
  book = bot.inventory.items().find(item => item.name === 'written_book');
  assert.ok(book, 'Tagged destiny book was lost after drop attempt');
  assert.ok(messages.some(line => line.includes('命格书会留在身上')),
    'Server did not reject destiny book drop');

  rcon(`give ${username} minecraft:compass 1`);
  await sleep(400);
  const ordinary = bot.inventory.items().find(item => item.name === 'compass'
    && item.slot !== compass.slot);
  assert.ok(ordinary, 'Ordinary compass did not arrive');
  await bot.tossStack(ordinary);
  await sleep(400);
  assert.equal(bot.inventory.items().filter(item => item.name === 'compass').length, 1,
    'Ordinary compass should drop while skill compass stays');

  rcon(`give ${username} minecraft:written_book 1`);
  await sleep(400);
  const ordinaryBook = bot.inventory.items().find(item => item.name === 'written_book'
    && item.slot !== book.slot);
  assert.ok(ordinaryBook, 'Ordinary written book did not arrive');
  await bot.tossStack(ordinaryBook);
  await sleep(400);
  assert.equal(bot.inventory.items().filter(item => item.name === 'written_book').length, 1,
    'Ordinary written book should drop while destiny book stays');

  rcon(`experience set ${username} 7 levels`);
  await sleep(300);
  book = bot.inventory.items().find(item => item.name === 'written_book');
  await bot.equip(book, 'hand');
  bot.activateItem();
  await sleep(500);
  assert.ok(JSON.stringify(bot.heldItem).includes('原版经验等级 7'),
    'Opening book did not refresh the player\'s actual experience level');
  console.log(`PASS ${username}: protected compass/book, ordinary drops, book pages and live level`);
} finally {
  bot.quit();
}
