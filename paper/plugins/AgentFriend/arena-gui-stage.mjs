// Isolated Paper 25566: exercise the seventh-floor vanilla GUI with a real Mineflayer connection.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: 'Audit24068409', auth: 'offline', version: '1.20.6'});
const errors = [];
bot.on('error', error => errors.push(error.stack ?? String(error)));
bot.on('kicked', reason => errors.push(`kicked: ${reason}`));
const waitFor = (emitter, event, timeout = 15000) => Promise.race([
  new Promise(resolve => emitter.once(event, resolve)),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${event}`)), timeout))
]);

try {
  await waitFor(bot, 'spawn');
  bot.chat('/mycli arena rest');
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.equal(errors.length, 0, errors.join('\n'));
  const shopOpening = waitFor(bot, 'windowOpen');
  bot.chat('/mycli arena shop');
  const shop = await shopOpening;
  assert.equal(shop.slots.length, 63, '27 shop + 36 player slots');
  assert.equal(shop.slots[23]?.name, 'emerald_block');
  const recycleOpening = waitFor(bot, 'windowOpen');
  await bot.clickWindow(22, 0, 0);
  const recycle = await recycleOpening;
  assert.equal(recycle.slots.length, 90, '54 recycle + 36 player slots');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({verdict: 'PASS', shop: shop.title,
    recycle: recycle.title, icon: shop.slots[23]?.name}));
} finally {
  bot.quit();
}
