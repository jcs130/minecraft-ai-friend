// Isolated 25566 regression: arriving during a wave or its clear countdown joins the next descent.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const suffix = String(Date.now()).slice(-6);
const names = [`LateA${suffix}`, `LateB${suffix}`, `LateC${suffix}`];
const bots = [];
const connect = async name => {
  const bot = mineflayer.createBot({
    host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
  });
  bot.lines = [];
  bot.on('messagestr', line => bot.lines.push(line));
  bot.on('error', () => {});
  bots.push(bot);
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  return bot;
};
const until = async (test, label, timeout = 18000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}: ${bots.map(bot => `${bot.username}: ${bot.lines.slice(-8).join(' | ')}`).join('\n')}`);
};
const latestStatus = async bot => {
  const at = bot.lines.length;
  bot.chat('/mycli arena status');
  await until(() => bot.lines.slice(at).some(line => line.startsWith('MC_DUNGEON status ')),
    `status for ${bot.username}`);
  return bot.lines.slice(at).find(line => line.startsWith('MC_DUNGEON status '));
};

try {
  const a = await connect(names[0]);
  const b = await connect(names[1]);
  const c = await connect(names[2]);
  rcon(`minecraft:effect give ${a.username} minecraft:resistance 120 4 true`);
  rcon(`minecraft:effect give ${b.username} minecraft:resistance 120 4 true`);
  rcon(`minecraft:effect give ${c.username} minecraft:resistance 120 4 true`);
  rcon(`minecraft:tp ${a.username} -594.5 91 -312.5`);
  rcon(`minecraft:tp ${b.username} -580.5 91 -304.5`);
  rcon(`minecraft:tp ${c.username} -580.5 91 -304.5`);
  await until(() => Math.abs(a.entity.position.y - 91) < 2, 'starter in lobby');
  a.chat('/mycli arena start');
  await until(() => Math.abs(a.entity.position.y - 69) < 2, 'solo start');
  assert.match(await latestStatus(b), /participant=false/);

  rcon(`minecraft:gamemode spectator ${c.username}`);
  rcon(`minecraft:tp ${b.username} -586.5 69 -304.5`);
  rcon(`minecraft:tp ${c.username} -584.5 69 -304.5`);
  await until(() => b.lines.some(line => line.includes('MC_DUNGEON_JOIN floor=1 participant=true')),
    'late fighter enrolled');
  assert.match(await latestStatus(b), /participant=true/);
  assert.match(await latestStatus(c), /participant=false/);
  await until(() => a.lines.some(line => /第 1\/\d+ 层/.test(line)
    && line.includes('只怪物')), 'floor 1 wave spawned');
  assert.match(rcon('minecraft:kill @e[tag=afu_dungeon_mob]'), /Killed|已杀死/);
  await until(() => b.lines.some(line => line.includes('MC_DUNGEON_LOOT floor=1')),
    'late fighter receives floor 1 reward');
  await until(() => Math.abs(a.entity.position.y - 57) < 2
    && Math.abs(b.entity.position.y - 57) < 2, 'late fighter descends with starter', 17000);
  assert.ok(Math.abs(c.entity.position.y - 69) < 2, 'spectator stays on old floor');

  await until(() => a.lines.some(line => /第 2\/\d+ 层/.test(line)
    && line.includes('只怪物')), 'floor 2 wave spawned');
  assert.match(rcon('minecraft:kill @e[tag=afu_dungeon_mob]'), /Killed|已杀死/);
  await until(() => a.lines.some(line => /第 2\/\d+ 层已通关/.test(line)),
    'floor 2 clear');
  rcon(`minecraft:gamemode survival ${c.username}`);
  rcon(`minecraft:tp ${c.username} -584.5 57 -304.5`);
  await until(() => c.lines.some(line => line.includes('MC_DUNGEON_JOIN floor=2 participant=true')
    && line.includes('rewardThisFloor=false')), 'countdown visitor enrolled');
  assert.ok(!c.lines.some(line => line.includes('MC_DUNGEON_LOOT floor=2')),
    'visitor after clear does not receive floor 2 reward');
  await until(() => Math.abs(c.entity.position.y - 45) < 2,
    'countdown visitor descends to floor 3', 17000);
  assert.match(await latestStatus(c), /participant=true/);
  a.chat('/mycli arena leave');
  b.chat('/mycli arena leave');
  c.chat('/mycli arena leave');
  console.log(JSON.stringify({ result: 'PASS', lateDuringFight: b.username,
    joinedAfterClear: c.username, spectatorExcluded: true, noRetroactiveReward: true }));
} finally {
  for (const bot of bots) bot.quit();
}
process.exit(0);
