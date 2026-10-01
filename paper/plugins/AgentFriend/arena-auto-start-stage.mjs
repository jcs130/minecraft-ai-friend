import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const username = process.argv[2];
if (!username) throw new Error('Provide a prepared platinum-rank stage name');
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding:'utf8'});
const bot = mineflayer.createBot({host:'127.0.0.1', port:25566,
  username, auth:'offline', version:'1.20.6'});
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
  rcon(`minecraft:tp ${username} -589.5 91 -304.5`);
  await wait(() => bot.entity.position.y > 85, 'lobby');
  bot.chat('/mycli arena difficulty auto');
  await wait(() => lines.some(line => line.includes('selected=apocalypse mode=auto recommended=apocalypse')),
    'automatic recommendation');
  bot.chat('/mycli arena start');
  await wait(() => bot.entity.position.y < 75, 'entered trial');
  bot.chat('/mycli arena status');
  const status = await wait(() => lines.find(line => line.includes('MC_DUNGEON status')
    && line.includes('globalDifficulty=apocalypse')), 'apocalypse started');
  const audit = await wait(() => {
    const value = rcon('mycli admin dungeonaudit');
    return value.includes('MC_DUNGEON_AUDIT_END floor=1 count=3') ? value : null;
  }, 'apocalypse wave');
  assert.match(audit, /type=ZOMBIE[^\n]*health=44\.00/);
  console.log(JSON.stringify({verdict:'PASS', status:status.match(/globalDifficulty=\w+/)?.[0],
    zombieHealth:44}));
} finally {
  bot.quit();
}
