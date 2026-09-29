// Isolated 25566 test: death before and after a floor clear, respawn guidance, and personal loot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const config = 'E:/MC/staging/arena-dungeon-20260928/plugins/AgentFriend/config.yml';
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = String(Date.now()).slice(-6);
const names = [`DeathA${suffix}`, `DeathB${suffix}`];
const bots = names.map((username) => mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username,
  auth: 'offline', version: '1.20.6',
}));
const chats = new Map(names.map((name) => [name, []]));
const respawns = new Map(names.map((name) => [name, 0]));
const errors = [];
for (const bot of bots) {
  bot.on('messagestr', (line) => chats.get(bot.username).push(line));
  bot.on('respawn', () => respawns.set(bot.username, respawns.get(bot.username) + 1));
  bot.on('error', (error) => errors.push(`${bot.username}: ${error.message}`));
  bot.on('kicked', (reason) => errors.push(`${bot.username}: ${JSON.stringify(reason)}`));
}
const until = async (test, label, timeout = 17000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}: ${JSON.stringify(Object.fromEntries(chats))}`);
};
const hasGuide = (bot, snippet) => chats.get(bot.username)
  .some((line) => line.includes('[试炼指引]') && line.includes(snippet));

try {
  await Promise.all(bots.map((bot) => new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  })));
  const [earned, unearned] = bots;
  for (const bot of bots) {
    rcon(`minecraft:tp ${bot.username} -594.5 91 -312.5`);
    rcon(`minecraft:effect give ${bot.username} minecraft:resistance 120 4 true`);
  }
  await until(() => bots.every((bot) => Math.abs(bot.entity.position.y - 91) < 2), 'lobby arrival');
  earned.chat('/mycli arena start');
  await until(() => bots.every((bot) => Math.abs(bot.entity.position.y - 69) < 3), 'two-person entry');
  await until(() => chats.get(earned.username).some((line) => line.includes('第 1/6 层：')
    && line.includes('只怪物')),
    'floor 1 wave');

  rcon(`minecraft:kill ${unearned.username}`);
  await until(() => hasGuide(unearned, '当前个人箱没有待领奖励'), 'unearned death guidance');
  await until(() => hasGuide(unearned, '入口奖励箱 (-594, 91, -313)'), 'unearned chest location');
  await until(() => respawns.get(unearned.username) > 0 && unearned.health > 0,
    'unearned respawn');
  await until(() => chats.get(unearned.username).filter((line) => line.includes('入口奖励箱')).length >= 2,
    'unearned respawn reminder');

  assert.match(rcon('minecraft:kill @e[tag=afu_dungeon_mob]'), /Killed|已杀死/);
  await until(() => chats.get(earned.username).some((line) => line.includes('第 1/6 层已通关')),
    'earned floor 1 reward');
  await until(() => Math.abs(earned.entity.position.y - 57) < 3, 'earned enters floor 2', 17000);
  rcon(`minecraft:kill ${earned.username}`);
  await until(() => hasGuide(earned, '你已有未领取奖励'), 'earned death guidance');
  await until(() => hasGuide(earned, '/mycli arena rewards'), 'earned reward command');
  await until(() => respawns.get(earned.username) > 0 && earned.health > 0, 'earned respawn');
  await until(() => chats.get(earned.username).filter((line) => line.includes('入口奖励箱')).length >= 2,
    'earned respawn reminder');

  const opened = new Promise((resolve) => earned.once('windowOpen', resolve));
  earned.chat('/mycli arena rewards');
  const chest = await opened;
  assert.ok(chest.slots[1], 'earned floor 1 iron remains in the personal chest');
  assert.ok(chest.slots[9], 'earned floor 1 bonus remains in the personal chest');
  earned.closeWindow(chest);
  const yaml = readFileSync(config, 'utf8');
  assert.doesNotMatch(yaml, new RegExp(`dungeon-death-guide:[\\s\\S]*${earned.uuid}: true`),
    'earned guide should clear after delivery');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', names, unearnedGuided: true,
    earnedGuided: true, respawnReminder: true, rewardChestPreserved: true }));
} finally {
  for (const bot of bots) bot.quit();
}
