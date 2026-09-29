import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (cmd) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', cmd,
], { encoding: 'utf8' });
const suffix = String(Date.now()).slice(-6);
const names = [`GuildA${suffix}`, `GuildB${suffix}`];
const bots = names.map((username) => mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username, auth: 'offline', version: '1.20.6',
}));
const messages = new Map(names.map((name) => [name, []]));
const errors = [];

for (const bot of bots) {
  bot.on('messagestr', (message) => messages.get(bot.username).push(message));
  bot.on('error', (error) => errors.push(`${bot.username}: ${error.message}`));
  bot.on('kicked', (reason) => errors.push(`${bot.username} kicked: ${JSON.stringify(reason)}`));
}
const ask = async (bot, command, delay = 400) => {
  messages.get(bot.username).length = 0;
  bot.chat(command);
  await sleep(delay);
  return messages.get(bot.username).join('\n');
};
const until = async (test, label, timeout = 10000) => {
  for (let n = 0; n < timeout / 200; n++) {
    if (test()) return;
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
};

try {
  await Promise.all(bots.map((bot) => new Promise((resolve, reject) => {
    if (bot.entity) return resolve();
    bot.once('spawn', resolve);
    bot.once('error', reject);
  })));
  const [a, b] = bots;
  assert.match(await ask(a, '/mycli guild board'), /first_step/);
  assert.match(await ask(a, '/mycli guild accept first_step'), /已接公会委托/);
  assert.match(await ask(b, '/mycli guild accept pest_control'), /已接公会委托/);
  assert.match(await ask(b, '/mycli guild accept deep_explorer'), /先完成并交付/);
  await Promise.all(bots.map((bot) => ask(bot, '/mycli goto arena', 500)));
  for (const name of names) rcon(`tp ${name} -589.5 91 -304.5`); // Stage-only shortcut into the lobby.
  await until(() => bots.every((bot) => bot.entity.position.distanceTo({ x: -589.5, y: 91, z: -304.5 }) < 3),
    'both players inside the arena lobby');
  assert.match(await ask(a, '/mycli arena start', 500), /试炼|进入第/);
  await until(() => bots.every((bot) => bot.entity.position.y < 80), 'both players in floor 1');
  for (const name of names) rcon(`minecraft:effect give ${name} minecraft:resistance 180 4 true`);
  await sleep(3800);
  const firstKill = rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  assert.match(firstKill, /3|Killed|已杀死|已清除/);
  await sleep(1500);
  assert.match(await ask(a, '/mycli guild status'), /初探苔穴 \[1\/1\]/);
  assert.match(await ask(b, '/mycli guild status'), /洞窟讨伐 \[3\/5\]/);
  assert.match(await ask(b, '/mycli guild claim'), /还需完成/);
  assert.match(await ask(a, '/mycli guild claim'), /委托交付成功/);
  assert.match(await ask(a, '/mycli guild status'), /声望 5/);
  assert.match(await ask(a, '/mycli guild accept first_step'), /今日已经完成/);

  const open = new Promise((resolve) => a.once('windowOpen', resolve));
  a.chat('/mycli guild menu');
  const window = await open;
  assert.equal(window.slots[11]?.name, 'iron_sword');
  await a.clickWindow(11, 0, 0);
  await sleep(500);
  assert.match(await ask(a, '/mycli guild status'), /洞窟讨伐 \[0\/5\]/);
  a.closeWindow(a.currentWindow);

  await until(() => bots.every((bot) => bot.entity.position.y < 65), 'both players automatically enter floor 2', 15000);
  await sleep(3800);
  const secondKill = rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  assert.match(secondKill, /4|Killed|已杀死|已清除/);
  await sleep(1500);
  assert.match(await ask(b, '/mycli guild status'), /洞窟讨伐 \[5\/5\]/);
  assert.match(await ask(a, '/mycli guild status'), /洞窟讨伐 \[4\/5\]/);
  assert.match(await ask(b, '/mycli guild claim'), /委托交付成功/);
  assert.match(await ask(b, '/mycli guild accept deep_explorer'), /需要黑铁级/);

  await until(() => bots.every((bot) => bot.entity.position.y < 53), 'both players automatically enter floor 3', 15000);
  await sleep(3800);
  rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  await sleep(1500);
  assert.match(await ask(a, '/mycli guild status'), /洞窟讨伐 \[5\/5\]/);
  assert.match(await ask(a, '/mycli guild claim'), /等级提升：青铜 → 黑铁/);
  assert.match(await ask(a, '/mycli guild accept deep_explorer'), /已接公会委托/);

  const rewardOpen = new Promise((resolve) => a.once('windowOpen', resolve));
  a.chat('/mycli arena rewards');
  const rewards = await rewardOpen;
  assert.equal(rewards.slots[0]?.name, 'emerald');
  assert.ok(rewards.slots[0]?.count >= 5, 'guild emeralds were not saved in the personal chest');
  a.closeWindow(rewards);
  assert.match(await ask(a, '/mycli guild abandon'), /已放弃/);
  assert.match(await ask(a, '/mycli guild status'), /当前没有在办的委托/);
  assert.match(await ask(a, '/mycli guild accept deep_explorer'), /已接公会委托/);
  const boardOpen = new Promise((resolve) => a.once('windowOpen', resolve));
  a.chat('/mycli guild menu');
  await boardOpen;
  await a.clickWindow(27, 0, 0);
  await sleep(400);
  assert.match(await ask(a, '/mycli guild status'), /当前没有在办的委托/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', players: names, firstKill: firstKill.trim(),
    secondKill: secondKill.trim(), aRank: '黑铁', bRank: '青铜',
    rewardEmeralds: rewards.slots[0].count, sharedKillProgress: true, dailyLimit: true }, null, 2));
} finally {
  for (const bot of bots) bot.quit();
  await sleep(200);
}
