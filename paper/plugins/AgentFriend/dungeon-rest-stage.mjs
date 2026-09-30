// Stage-only checkpoint, controller menu and native merchant protocol test.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const name = process.argv[2];
if (!name) throw new Error('Pass a stage player that cleared floor 6');
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
  username: name, auth: 'offline', version: '1.20.6' });
const errors = [], chat = [];
bot.on('messagestr', (line) => chat.push(line));
bot.on('error', (error) => errors.push(error.message));
bot.on('kicked', (reason) => errors.push(JSON.stringify(reason)));
const until = async (test, label, timeout = 16000) => {
  for (let ms = 0; ms < timeout; ms += 100) {
    const result = test();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`${label}; at=${bot.entity?.position}; chat=${chat.slice(-7).join(' | ')}`);
};
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  rcon(`minecraft:tp ${name} -489 68 -502`);
  await until(() => Math.abs(bot.entity.position.x + 489) < 2, 'guild arrival');
  const skillsOpen = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.chat('/mycli menu');
  const skills = await skillsOpen;
  assert.ok(skills);
  const placesOpen = new Promise((resolve) => bot.once('windowOpen', resolve));
  await bot.clickWindow(16, 0, 0);
  const places = await placesOpen;
  assert.equal(places.slots[17]?.name, 'campfire');
  await bot.clickWindow(17, 0, 0);
  await until(() => Math.abs(bot.entity.position.x + 510) < 2
    && Math.abs(bot.entity.position.y + 3) < 2, 'controller direct rest travel');
  await until(() => bot.currentWindow === null, 'places menu closes after travel');
  bot.setQuickBarSlot(8); // Starter backpack in slot 1 intercepts right-click.
  await sleep(150);
  rcon(`minecraft:tp ${name} -502.5 -3 -308.5`);
  const merchant = await until(() => bot.nearestEntity((entity) => entity.name === 'villager'
    && entity.position.distanceTo(bot.entity.position) < 4), 'rest merchant tracked');
  const menu = await bot.openVillager(merchant);
  assert.equal(menu.trades.length, 6);
  assert.ok(menu.trades.every((trade) => trade.inputs[0]?.name === 'emerald'
    && trade.inputs[0]?.count <= 8 && trade.maximumNbTradeUses >= 100000));
  bot.closeWindow(menu);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', name, checkpoint: true,
    controller: true, merchantOffers: menu.trades.length }));
} finally {
  bot.quit();
}
