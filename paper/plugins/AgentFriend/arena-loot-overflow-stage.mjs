// Stage-only fixture: config queue for this account is seeded to 128 ordinary items before start.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const name = 'Loot25843539';
const uuid = '49988c10-3ef9-3dec-905e-1844724f3434';
const config = 'E:/MC/staging/arena-dungeon-20260928/plugins/AgentFriend/config.yml';
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: name, auth: 'offline', version: '1.20.6'});
const lines = [];
bot.on('messagestr', line => lines.push(line));
const until = async (test, label, ms = 20000) => {
  for (let waited = 0; waited < ms; waited += 100) {
    const result = test();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`timeout ${label}: ${lines.slice(-6).join(' | ')}`);
};
const queued = () => {
  const all = readFileSync(config, 'utf8').split(/\r?\n/);
  const root = all.findIndex(line => line === 'dungeon-bonus-items:');
  const index = all.findIndex((line, i) => i > root && line === `  ${uuid}:`);
  assert.ok(index > root);
  let end = index + 1;
  while (end < all.length && !/^  [a-f0-9-]{36}:/.test(all[end]) && !/^[a-z][^ ]*:/.test(all[end])) end++;
  const block = all.slice(index, end);
  return {count: block.filter(line => line.startsWith('  - ==:')).length,
    leggings: block.some(line => line.trim() === 'type: IRON_LEGGINGS')};
};

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  assert.equal(queued().count, 128);
  rcon(`minecraft:effect give ${name} minecraft:resistance 120 4 true`);
  bot.chat('/mycli arena rest');
  await until(() => Math.abs(bot.entity.position.y + 3) < 2, 'rest floor');
  bot.chat('/mycli arena next');
  await until(() => Math.abs(bot.entity.position.y + 15) < 2, 'eighth floor');
  await until(() => lines.some(line => line.includes('第 8/10 层：') && line.includes('只怪物')),
    'eighth floor wave');
  rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  await until(() => lines.some(line => line.includes('第 8/10 层已通关')), 'eighth floor clear');
  const state = queued();
  assert.ok(state.count >= 129, `milestone must survive full ordinary queue: ${state.count}`);
  assert.equal(state.leggings, true);
  assert.ok(lines.some(line => line.includes('MC_DUNGEON_LOOT floor=8 category=milestone item=minecraft:iron_leggings')));
  console.log(JSON.stringify({verdict: 'PASS', queued: state.count, milestoneLeggings: state.leggings}));
} finally { bot.quit(); }
