// Run `prepare`, stop/start the isolated server, then run `verify` to test persisted run recovery.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const phase = process.argv[2];
const name = 'RunRestoreQA';
if (!['prepare', 'verify'].includes(phase)) throw new Error('use prepare or verify');
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name,
  auth: 'offline', version: '1.20.6',
});
const lines = [];
bot.on('messagestr', (line) => lines.push(line));
bot.on('error', () => {});
const until = async (test, label, timeout = 17000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}: ${lines.slice(-10).join(' | ')}`);
};

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  if (phase === 'prepare') {
    rcon(`minecraft:tp ${name} -594.5 91 -312.5`);
    await until(() => Math.abs(bot.entity.position.y - 91) < 2, 'lobby arrival');
    bot.chat('/mycli arena start');
    await until(() => Math.abs(bot.entity.position.y - 69) < 3, 'floor 1 arrival');
    rcon(`minecraft:effect give ${name} minecraft:resistance 120 4 true`);
    await until(() => lines.some((line) => line.includes('第 1/6 层：')
      && line.includes('只怪物')), 'floor 1 wave');
    assert.match(rcon('minecraft:kill @e[tag=afu_dungeon_mob]'), /Killed|已杀死/);
    await until(() => lines.some((line) => line.includes('第 1/6 层已通关')),
      'floor 1 reward');
    bot.quit();
    await sleep(1800);
    const checkpoint = readFileSync(
      'E:/MC/staging/arena-dungeon-20260928/plugins/AgentFriend/config.yml', 'utf8');
    assert.match(checkpoint, /dungeon-active-run:\s+floor: 1/);
    assert.match(checkpoint, /cleared: true/);
    console.log(JSON.stringify({ verdict: 'PREPARED', name, floor: 1 }));
  } else {
    await until(() => lines.some((line) => line.includes('已恢复第 1/6 层试炼')),
      'restored floor after JVM restart');
    await until(() => Math.abs(bot.entity.position.y - 57) < 3,
      'automatic floor 2 after persisted countdown');
    assert.ok(!lines.some((line) => line.includes('第 1/6 层已通关')),
      'restored run must not repeat floor 1 reward');
    bot.chat('/mycli arena leave');
    await until(() => lines.some((line) => line.includes('已返回地面')),
      'voluntary exit');
    console.log(JSON.stringify({ verdict: 'PASS', name,
      checkpointRestored: true, countdownResumed: true, noDuplicateReward: true }));
  }
} finally {
  bot.quit();
}
process.exit(0);
