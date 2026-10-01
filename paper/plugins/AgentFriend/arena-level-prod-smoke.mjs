import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const bot = mineflayer.createBot({host:'192.168.3.163', port:25565,
  username:`LevelProbe${String(Date.now()).slice(-5)}`, auth:'offline', version:'1.20.6'});
const lines = [];
bot.on('messagestr', line => lines.push(line));
const wait = async (test, label) => {
  for (let i = 0; i < 80; i++) {
    const value = test();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out: ${label}; recent=${lines.slice(-10).join(' | ')}`);
};
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  bot.chat('/mycli arena difficulty list');
  const tier = await wait(() => lines.find(line => line.includes('MC_DUNGEON_DIFFICULTY selected=')),
    'private tier reply');
  assert.match(tier, /mode=auto recommended=normal adventurerRank=0/);
  bot.chat('/mycli arena status');
  const status = await wait(() => lines.find(line => line.includes('MC_DUNGEON status')),
    'private status reply');
  assert.match(status, /participant=false/);
  assert.match(status, /globalActive=false/);
  assert.match(status, /difficultyMode=auto recommendedDifficulty=normal adventurerRank=0/);
  console.log(JSON.stringify({verdict:'PASS', username:bot.username, tier, status:status.match(/globalActive=\w+/)?.[0]}));
} finally {
  bot.quit();
}
