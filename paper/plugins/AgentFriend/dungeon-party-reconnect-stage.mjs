// Isolated 25566 test: a disconnected teammate rejoins the floor reached by the rest of the party.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const suffix = String(Date.now()).slice(-6);
const names = [`CrewA${suffix}`, `CrewB${suffix}`];
const bots = [];
const connect = async (name) => {
  const bot = mineflayer.createBot({
    host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
  });
  bot.lines = [];
  bot.on('messagestr', (line) => bot.lines.push(line));
  bot.on('error', () => {});
  bots.push(bot);
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  return bot;
};
const until = async (test, label, timeout = 17000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}: ${bots.at(-1)?.lines.slice(-8).join(' | ')}`);
};

try {
  let a = await connect(names[0]);
  const b = await connect(names[1]);
  rcon(`minecraft:tp ${a.username} -594.5 91 -312.5`);
  rcon(`minecraft:tp ${b.username} -590.5 91 -320.5`);
  await until(() => Math.abs(a.entity.position.y - 91) < 2
    && Math.abs(b.entity.position.y - 91) < 2, 'lobby arrivals');
  a.chat('/mycli arena start');
  await until(() => Math.abs(a.entity.position.y - 69) < 3
    && Math.abs(b.entity.position.y - 69) < 3, 'party floor 1');
  rcon(`minecraft:effect give ${a.username} minecraft:resistance 120 4 true`);
  rcon(`minecraft:effect give ${b.username} minecraft:resistance 120 4 true`);
  await until(() => b.lines.some((line) => line.includes('第 1/6 层：')
    && line.includes('只怪物')), 'floor 1 wave');
  a.quit();
  await sleep(1500);
  assert.match(rcon('minecraft:kill @e[tag=afu_dungeon_mob]'), /Killed|已杀死/);
  await until(() => b.lines.some((line) => line.includes('第 1/6 层已通关')),
    'online teammate clears floor 1');
  await until(() => Math.abs(b.entity.position.y - 57) < 3,
    'online teammate descends alone');
  a = await connect(names[0]);
  await until(() => Math.abs(a.entity.position.y - 57) < 3,
    'returning teammate rejoins current floor');
  assert.ok(a.lines.some((line) => line.includes('已恢复第 2/6 层试炼')));
  const opened = new Promise((resolve) => a.once('windowOpen', resolve));
  a.chat('/mycli arena rewards');
  const chest = await opened;
  assert.ok(!chest.slots[9], 'offline teammate gets no floor 1 bonus');
  a.closeWindow(chest);
  a.chat('/mycli arena leave');
  b.chat('/mycli arena leave');
  console.log(JSON.stringify({ verdict: 'PASS', names,
    preservedPartySlot: true, advancedToCurrentFloor: true,
    noOfflineReward: true }));
} finally {
  for (const bot of bots) bot.quit();
}
process.exit(0);
