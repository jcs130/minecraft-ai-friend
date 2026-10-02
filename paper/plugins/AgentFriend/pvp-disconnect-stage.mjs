// Verify a disconnected fighter loses and recovers their original inventory on reconnect.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const suffix = process.argv[2] || 'QG';
const alpha = 'PvPAlpha' + suffix, beta = 'PvPBeta' + suffix;
function connect(name) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username: name, auth: 'offline', version: '1.20.6' });
  bot.lines = [];
  bot.on('messagestr', line => bot.lines.push(line));
  return bot;
}
async function spawn(bot) {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
}
async function waitFor(check, label) {
  for (let i = 0; i < 120; i++) {
    if (check()) return;
    await sleep(100);
  }
  throw new Error('timeout ' + label);
}
const count = (bot, name) => bot.inventory.items().filter(item => item.name === name)
  .reduce((sum, item) => sum + item.count, 0);
const a = connect(alpha);
let b = connect(beta);
try {
  await Promise.all([spawn(a), spawn(b)]);
  rcon('minecraft:give ' + alpha + ' minecraft:diamond 5');
  rcon('minecraft:give ' + beta + ' minecraft:emerald 7');
  await waitFor(() => count(a, 'diamond') === 5 && count(b, 'emerald') === 7, 'original gear');
  a.chat('/mycli pvp join');
  b.chat('/mycli pvp join');
  await waitFor(() => count(a, 'iron_sword') === 1 && count(b, 'iron_sword') === 1, 'kit');
  await sleep(6200);
  b.quit();
  await waitFor(() => a.lines.some(line => line.includes('MC_PVP_RESULT outcome=win')
    && line.includes('reason=disconnect')), 'disconnect result');
  assert.equal(count(a, 'diamond'), 5);
  b = connect(beta);
  await spawn(b);
  await waitFor(() => count(b, 'emerald') === 7, 'reconnected inventory');
  assert.equal(count(b, 'iron_sword'), 0);
  b.chat('/mycli pvp status');
  await waitFor(() => b.lines.some(line => line.startsWith('MC_PVP {')
    && line.includes('"losses":1')), 'persisted loss');
  console.log(JSON.stringify({ result: 'PASS', winner: alpha, loser: beta,
    winnerDiamonds: count(a, 'diamond'), loserEmeralds: count(b, 'emerald'),
    lastState: b.lines.filter(line => line.startsWith('MC_PVP {')).at(-1) }, null, 2));
} finally {
  a.quit();
  b.quit();
}
