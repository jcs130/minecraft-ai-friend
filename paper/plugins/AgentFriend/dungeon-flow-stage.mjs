// Isolated 25566 test: button proximity, automatic floor change, healing, and personal loot.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const suffix = String(Date.now()).slice(-6);
const names = ['TeamA', 'TeamB', 'TeamFar'].map((prefix) => `${prefix}${suffix}`);
const bots = names.map((username) => mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username,
  auth: 'offline', version: '1.20.6',
}));
const chats = new Map(names.map((name) => [name, []]));
const errors = [];
for (const bot of bots) {
  bot.on('messagestr', (line) => chats.get(bot.username).push(line));
  bot.on('error', (error) => errors.push(`${bot.username}: ${error.message}`));
  bot.on('kicked', (reason) => errors.push(`${bot.username}: ${JSON.stringify(reason)}`));
}
const until = async (test, label, timeout = 15000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}; ${JSON.stringify(Object.fromEntries(chats))}`);
};
const ask = async (bot, command) => {
  const lines = chats.get(bot.username);
  lines.length = 0;
  bot.chat(command);
  await sleep(450);
  return lines.join('\n');
};

try {
  await Promise.all(bots.map((bot) => new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  })));
  const [a, b, far] = bots;
  assert.match(await ask(a, '/mycli guild accept party_oath'), /已接公会委托/);
  assert.match(await ask(b, '/mycli guild accept treasure_keeper'), /已接公会委托/);
  rcon(`minecraft:tp ${a.username} -594.5 91 -312.5`);
  rcon(`minecraft:tp ${b.username} -590.5 91 -320.5`); // Old lobby rectangle excluded this teammate.
  rcon(`minecraft:tp ${far.username} -580.5 91 -304.5`);
  await until(() => Math.abs(a.entity.position.x + 594.5) < 2
    && Math.abs(b.entity.position.z + 320.5) < 2, 'lobby positions');
  const button = a.blockAt(new Vec3(-596, 92, -313));
  assert.equal(button?.name, 'stone_button');
  a.activateBlock(button);
  await until(() => a.currentWindow?.slots[16]?.name === 'lime_concrete',
    'entrance difficulty menu');
  await a.clickWindow(16, 0, 0);
  await until(() => a.entity.position.y < 80 && b.entity.position.y < 80,
    'nearby pair enter floor 1');
  assert.ok(far.entity.position.y > 80, 'far player must stay in lobby');
  await sleep(3800);
  rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  await until(() => chats.get(a.username).some((line) => line.includes('10 秒后全队自动进入')), 'floor 1 clear');
  const fullHealth = a.health;
  rcon(`minecraft:damage ${a.username} 8 minecraft:generic`);
  await until(() => a.health < fullHealth - 4, 'test player damaged');
  const damagedHealth = a.health;
  await until(() => a.entity.position.y < 65 && b.entity.position.y < 65,
    'both players automatically enter floor 2', 15000);
  await until(() => a.health >= fullHealth - 0.1, 'health restored on descent');
  rcon(`minecraft:effect give ${a.username} minecraft:resistance 30 4 true`);
  rcon(`minecraft:effect give ${b.username} minecraft:resistance 30 4 true`);
  await sleep(3800);
  rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  await until(() => chats.get(a.username).some((line) => line.includes('第 2/6 层已通关')),
    'floor 2 clear');
  assert.match(await ask(a, '/mycli guild status'), /结伴试炼 \[1\/1\]/);
  const opened = new Promise((resolve) => b.once('windowOpen', resolve));
  b.chat('/mycli arena rewards');
  const chest = await opened;
  assert.ok(chest.slots[9], 'random personal loot is visible in the chest');
  for (const slot of [0, 1, 2]) {
    assert.ok(chest.slots[slot], `guaranteed reward slot ${slot}`);
    await b.clickWindow(slot, 0, 0);
    await sleep(180);
  }
  assert.match(await ask(b, '/mycli guild status'), /宝箱整理师 \[3\/3\]/);
  b.closeWindow(chest);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', team: [a.username, b.username],
    excluded: far.username, damagedHealth, restoredHealth: a.health,
    personalBonus: chest.slots[9]?.name, partyQuest: true, chestQuest: true }));
} finally {
  for (const bot of bots) bot.quit();
}
