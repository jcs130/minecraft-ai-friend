// Isolated-server sale of a repeated spell-imprinted reward; first-clear relic stays protected.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: process.argv[2], auth: 'offline', version: '1.20.6'});
const messages = [], errors = [];
bot.on('messagestr', line => messages.push(line));
bot.on('error', error => errors.push(error.message));
const receipt = action => messages.map(line => line.startsWith('MC_ARENA_ECONOMY ')
  ? JSON.parse(line.slice('MC_ARENA_ECONOMY '.length)) : null)
  .find(message => message?.action === action);
const waitFor = async (condition, label) => {
  for (let i = 0; i < 100; i++) {
    if (errors.length) throw new Error(errors.join('; '));
    const result = condition();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`timeout ${label}`);
};
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  await sleep(350);
  const named = text => bot.inventory.items().find(item => JSON.stringify(item).includes(text));
  const blink = named('赤铜柄·闪现匕首');
  const relic = named('深渊裁决');
  assert.ok(blink && relic, 'functional and unique rewards should be in the test inventory');
  const bagSlot = item => item.slot >= 36 ? item.slot - 36 : item.slot;
  bot.chat(`/mycli arena recycle quote bag ${bagSlot(relic)}`);
  const protectedReceipt = await waitFor(() => receipt('quote'), 'relic quote');
  assert.equal(protectedReceipt.success, false);
  assert.equal(protectedReceipt.reason, 'not_recyclable_or_protected');
  messages.length = 0;
  bot.chat(`/mycli arena recycle quote bag ${bagSlot(blink)}`);
  const quoted = await waitFor(() => receipt('quote'), 'blink quote');
  assert.equal(quoted.success, true, JSON.stringify(quoted));
  assert.ok(quoted.quoteId);
  messages.length = 0;
  bot.chat(`/mycli arena recycle sell ${quoted.quoteId}`);
  const sold = await waitFor(() => receipt('sell'), 'blink sale');
  assert.equal(sold.success, true, JSON.stringify(sold));
  assert.ok(sold.balance > quoted.balance);
  assert.equal(errors.length, 0);
  console.log(JSON.stringify({verdict: 'PASS', sold: sold.item.name,
    earned: sold.earned, balance: sold.balance, uniqueProtected: true}));
} finally {
  bot.quit();
}
