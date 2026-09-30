// Isolated Paper 1.20.6 integration: readable book, controller menus, Agent guide.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const username = `Guide${String(Date.now()).slice(-8)}`;
const create = () => mineflayer.createBot({ host: '127.0.0.1', port: 25566,
  username, auth: 'offline', version: '1.20.6' });
let bot = create();
const chats = [], packets = [], errors = [];
function watch(client) {
  client.on('messagestr', line => chats.push(line));
  client.on('error', error => errors.push(error.message));
  client.on('kicked', reason => errors.push(`kicked: ${JSON.stringify(reason)}`));
  client._client.on('packet', (packet, meta) => packets.push(meta.name));
}
watch(bot);
const waitOpen = async () => {
  const next = new Promise(resolve => bot.once('windowOpen', resolve));
  return Promise.race([next, sleep(3000).then(() => { throw new Error('Menu did not open'); })]);
};
try {
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); });
  await sleep(2800);
  assert.ok(chats.some(line => line.includes('欢迎来到千灯纪') && line.includes('旅途指南')),
    `First-login action missing: ${chats}`);
  const book = bot.inventory.items().find(item => item.name === 'written_book');
  const compass = bot.inventory.items().find(item => item.name === 'compass');
  assert.ok(book && compass, 'New player needs the guide book and skill compass');
  const bookWire = JSON.stringify(book);
  for (const phrase of ['手柄也能玩', '试炼塔与奖励', '/mycli guide', '冒险者公会'])
    assert.ok(bookWire.includes(phrase), `Book component missing ${phrase}`);
  await bot.equip(compass, 'hand');
  const skillsPromise = waitOpen();
  bot.activateItem();
  const skills = await skillsPromise;
  assert.equal(skills.slots[4]?.name, 'written_book', 'Compass needs prominent journey-guide entry');
  const guidePromise = waitOpen();
  await bot.clickWindow(4, 0, 0);
  const guide = await guidePromise;
  assert.equal(guide.slots[10]?.name, 'compass', 'Guide needs exploration action');
  assert.equal(guide.slots[13]?.name, 'lectern', 'Guide needs guild action');
  assert.equal(guide.slots[16]?.name, 'written_book', 'Guide should open the actual book');
  const placesPromise = waitOpen();
  await bot.clickWindow(10, 0, 0);
  const places = await placesPromise;
  assert.equal(places.slots[11]?.name, 'cherry_sapling', 'Guide exploration should reach live places menu');
  const skillsAgainPromise = waitOpen();
  await bot.clickWindow(22, 0, 0);
  await skillsAgainPromise;
  const guideAgainPromise = waitOpen();
  await bot.clickWindow(4, 0, 0);
  await guideAgainPromise;
  const guildPromise = waitOpen();
  await bot.clickWindow(13, 0, 0);
  const guild = await guildPromise;
  assert.equal(guild.slots.length, 72, 'Guild chapter should reach 36 board slots plus player inventory');
  bot.closeWindow(guild);
  const bookMenuPromise = waitOpen();
  bot.chat('/mycli guide menu');
  await bookMenuPromise;
  const openBookBefore = packets.filter(name => name === 'open_book').length;
  await bot.clickWindow(16, 0, 0);
  await sleep(300);
  assert.ok(packets.filter(name => name === 'open_book').length > openBookBefore,
    `Controller book action must send open_book packet: ${packets.slice(-12)}`);
  bot.chat('/mycli guide');
  bot.chat('/mycli guide gear');
  bot.chat('/mycli guide dungeon');
  await sleep(900);
  for (const phrase of ['/mycli status', '/mycli imprint <技能ID>', '/mycli arena rewards'])
    assert.ok(chats.some(line => line.includes(phrase)), `Agent command guide missing ${phrase}: ${chats}`);
  assert.equal(errors.length, 0, `Client errors: ${errors}`);
  bot.quit();
  await sleep(1100);
  chats.length = 0;
  bot = create();
  watch(bot);
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); });
  await sleep(2700);
  assert.ok(!chats.some(line => line.includes('欢迎来到千灯纪')),
    `Welcome should not repeat on every join: ${chats}`);
  assert.equal(errors.length, 0, `Client errors after reconnect: ${errors}`);
  console.log(JSON.stringify({ verdict: 'PASS', bookBytes: bookWire.length,
    menu: 'compass->guide->places/guild', guideTopics: 3, welcomeOnce: true }));
} finally {
  if (bot?.entity) bot.quit();
}
