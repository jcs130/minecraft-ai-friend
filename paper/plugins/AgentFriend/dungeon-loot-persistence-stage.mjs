// Reconnect a prior isolated-test account after Paper restart and inspect its personal chest.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const name = process.argv[2];
if (!name) throw new Error('Pass the prior test player name');
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
});
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  const opened = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.chat('/mycli arena rewards');
  const chest = await opened;
  assert.ok(chest.slots[9], 'random loot vanished after restart');
  console.log(JSON.stringify({ verdict: 'PASS', player: name,
    firstBonus: chest.slots[9].name, amount: chest.slots[9].count,
    components: (chest.slots[9].components ?? []).map((component) => component.type) }));
  bot.closeWindow(chest);
} finally {
  bot.quit();
}
