// Isolated 25566 full-run test of six automatic floors and the guaranteed rare roll.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const name = `SixQA${String(Date.now()).slice(-7)}`;
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
});
const chat = [];
bot.on('messagestr', (line) => chat.push(line));
const until = async (test, label, timeout = 18000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}; position=${bot.entity?.position}; chat=${chat.slice(-9).join(' | ')}`);
};
const levels = [69, 57, 45, 33, 21, 9];
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  rcon(`minecraft:tp ${name} -594.5 91 -312.5`);
  await until(() => Math.abs(bot.entity.position.x + 594.5) < 2, 'lobby arrival');
  bot.chat('/mycli arena start');
  await until(() => Math.abs(bot.entity.position.y - levels[0]) < 3, 'floor 1 arrival');
  rcon(`minecraft:effect give ${name} minecraft:resistance 180 4 true`);
  for (let i = 0; i < levels.length; i++) {
    const n = i + 1;
    await until(() => chat.some((line) => line.includes(`第 ${n}/6 层：`) && line.includes('只怪物')),
      `floor ${n} spawn`);
    const killed = rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
    assert.match(killed, /Killed|已杀死|已清除/);
    await until(() => chat.some((line) => line.includes(`第 ${n}/6 层已通关`)),
      `floor ${n} reward`);
    if (i + 1 < levels.length)
      await until(() => Math.abs(bot.entity.position.y - levels[i + 1]) < 3,
        `automatic floor ${n + 1} arrival`);
  }
  await until(() => chat.some((line) => line.includes('六层完成')), 'six-floor completion');
  const opened = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.chat('/mycli arena rewards');
  const chest = await opened;
  const bonus = chest.slots.slice(9, 15).map((item) => item?.name);
  assert.ok(bonus.every(Boolean), `six personal bonus items: ${JSON.stringify(bonus)}`);
  assert.ok(chat.some((line) => line.includes('稀有')), 'rare pity did not produce a rare reward');
  console.log(JSON.stringify({ verdict: 'PASS', player: name, bonus,
    rareMessages: chat.filter((line) => line.includes('稀有')).length }));
  bot.closeWindow(chest);
} finally {
  bot.quit();
}
