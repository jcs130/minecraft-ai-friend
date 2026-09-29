// Isolated 25566 protocol test: disconnect during the 10-second transition and during combat.
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
const name = `RJoinQA${String(Date.now()).slice(-6)}`;
const bots = [];
const connect = async () => {
  const bot = mineflayer.createBot({
    host: '127.0.0.1', port: 25566, username: name,
    auth: 'offline', version: '1.20.6',
  });
  bot.chatLog = [];
  bot.on('messagestr', (line) => bot.chatLog.push(line));
  bot.on('error', () => {});
  bots.push(bot);
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('kicked', reject);
    bot.once('error', reject);
  });
  return bot;
};
const until = async (test, label, timeout = 17000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(label + ' | ' + bots.at(-1)?.chatLog?.slice(-10).join(' | '));
};
const savedRun = () => readFileSync(config, 'utf8').split('dungeon-active-run:')[1] ?? '';

try {
  let bot = await connect();
  rcon(`minecraft:tp ${name} -594.5 91 -312.5`);
  await until(() => Math.abs(bot.entity.position.y - 91) < 2, 'lobby arrival');
  bot.chat('/mycli arena start');
  await until(() => Math.abs(bot.entity.position.y - 69) < 3, 'floor 1 arrival');
  rcon(`minecraft:effect give ${name} minecraft:resistance 120 4 true`);
  rcon(`minecraft:attribute ${name} minecraft:generic.knockback_resistance base set 1`);
  await until(() => bot.chatLog.some((line) => line.includes('第 1/6 层：')
    && line.includes('只怪物')), 'floor 1 wave');
  assert.match(rcon('minecraft:kill @e[tag=afu_dungeon_mob]'), /Killed|已杀死/);
  await until(() => bot.chatLog.some((line) => line.includes('第 1/6 层已通关')),
    'floor 1 reward');
  bot.quit();
  await sleep(2800);
  assert.match(savedRun(), /floor: 1/);
  assert.match(savedRun(), /cleared: true/);
  assert.match(savedRun(), /paused-at: 1\d{12}/);
  bot = await connect();
  await until(() => bot.chatLog.some((line) => line.includes('已恢复第 1/6 层试炼')),
    'reconnect during cleared countdown');
  await sleep(2000);
  assert.ok(Math.abs(bot.entity.position.y - 69) < 3, 'countdown should resume, not skip');
  await until(() => Math.abs(bot.entity.position.y - 57) < 3,
    'automatic floor 2 after reconnect');
  assert.equal(bot.chatLog.filter((line) => line.includes('第 1/6 层已通关')).length, 0,
    'reconnect must not re-credit the cleared floor');
  await until(() => bot.chatLog.some((line) => line.includes('第 2/6 层：')
    && line.includes('只怪物')), 'floor 2 wave');
  bot.quit();
  await sleep(2800);
  assert.match(savedRun(), /floor: 2/);
  assert.match(savedRun(), /cleared: false/);
  bot = await connect();
  await until(() => bot.chatLog.some((line) => line.includes('已恢复第 2/6 层试炼')),
    'reconnect during combat');
  await until(() => bot.chatLog.some((line) => line.includes('第 2/6 层：')
    && line.includes('只怪物')),
    'floor 2 wave restarted');
  bot.chat('/mycli arena leave');
  await until(() => bot.chatLog.some((line) => line.includes('已返回地面')),
    'voluntary exit');
  console.log(JSON.stringify({ verdict: 'PASS', name, clearedCountdownResumed: true,
    combatWaveRetried: true, rewardsNotDuplicated: true }));
} finally {
  for (const bot of bots) if (bot._client?.state !== 'disconnected') bot.quit();
}
process.exit(0);
