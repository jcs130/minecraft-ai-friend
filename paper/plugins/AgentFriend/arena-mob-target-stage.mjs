import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: process.argv[2], auth: 'offline', version: '1.20.6'});
await new Promise((resolve, reject) => {
  bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
});
await new Promise(resolve => setTimeout(resolve, 8000));
console.log(execFileSync('node', ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs',
  'mycli admin dungeonaudit'], {encoding: 'utf8'}));
bot.quit();
