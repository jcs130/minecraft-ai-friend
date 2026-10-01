import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: `Attack${String(Date.now()).slice(-7)}`, auth: 'offline', version: '1.20.6'});
const until = async (test, name, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (test()) return;
    await sleep(250);
  }
  throw new Error(`Timeout: ${name}`);
};
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  rcon(`minecraft:tp ${bot.username} -589.5 91 -304.5`);
  await until(() => bot.entity.position.x < -580, 'lobby');
  bot.chat('/mycli arena start');
  await until(() => bot.entity.position.y < 75, 'floor one');
  const before = bot.health;
  await until(() => bot.health < before, 'mob damage', 18000);
  console.log(JSON.stringify({verdict: 'PASS', before, after: bot.health,
    audit: rcon('mycli admin dungeonaudit')}));
} finally {
  bot.quit();
}
