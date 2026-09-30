// Real 1.20.6 protocol smoke test of the ten-floor deep trial wing on isolated port 25566.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const name = process.argv[2] || `DeepQA${String(Date.now()).slice(-7)}`;
const resuming = Boolean(process.argv[2]);
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
});
const chat = [], errors = [], bossPackets = [], tradePackets = [];
bot.on('messagestr', (line) => chat.push(line));
bot.on('error', (error) => errors.push(error.message));
bot.on('kicked', (reason) => errors.push(`kicked: ${JSON.stringify(reason)}`));
bot._client.on('boss_bar', (packet) => bossPackets.push(packet));
bot._client.on('trade_list', (packet) => tradePackets.push(packet));
const until = async (test, label, timeout = 30000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}; at=${bot.entity?.position}; chat=${chat.slice(-10).join(' | ')}; errors=${errors.join(' | ')}`);
};
const levels = [69, 57, 45, 33, 21, 9, -3, -15, -27, -39];
const xs = [-590, -590, -590, -590, -590, -590, -510, -510, -510, -510];
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  if (!resuming) {
    rcon(`minecraft:tp ${name} -594.5 91 -312.5`);
    await until(() => Math.abs(bot.entity.position.x + 594.5) < 2, 'lobby arrival');
    bot.chat('/mycli arena start');
    await until(() => Math.abs(bot.entity.position.y - levels[0]) < 3, 'floor 1 arrival');
  } else {
    await until(() => Math.abs(bot.entity.position.y - levels[6]) < 3, 'floor 7 resume');
    rcon(`minecraft:tp ${name} -509.5 -3 -304.5`);
    await until(() => Math.abs(bot.entity.position.x + 509.5) < 2, 'rest center');
  }
  rcon(`minecraft:effect give ${name} minecraft:resistance 900 4 true`);
  for (let n = resuming ? 7 : 1; n <= 10; n++) {
    await until(() => Math.abs(bot.entity.position.y - levels[n - 1]) < 3
      && Math.abs(bot.entity.position.x - xs[n - 1]) < 3, `floor ${n} arrival`);
    if (n === 7) {
      if (!resuming) assert.match(chat.join('\n'), /已解锁第七层灯火驿站直达/);
      for (const [dx, dz, material] of [
        [-5, 0, 'crafting_table'], [-5, 2, 'furnace'], [-5, -2, 'blast_furnace'],
        [-2, -5, 'anvil'], [0, -5, 'smithing_table'], [2, -5, 'grindstone'],
        [5, 0, 'enchanting_table'], [5, 2, 'stonecutter'],
      ]) {
        await until(() => bot.blockAt(bot.entity.position.floored().offset(dx, 0, dz)),
          `rest workstation loaded ${material}`);
        const block = bot.blockAt(bot.entity.position.floored().offset(dx, 0, dz));
        assert.equal(block?.name, material, `rest workstation ${material}`);
      }
      const opened = new Promise((resolve) => bot.once('windowOpen', resolve));
      bot.chat('/mycli arena shop');
      const shop = await Promise.race([opened, sleep(15000).then(() => { throw new Error('shop open timeout'); })]);
      assert.equal(shop.type, 'minecraft:merchant');
      await until(() => tradePackets.some((packet) => packet.trades?.length >= 4), 'merchant trade packet');
      bot.closeWindow(shop);
      await sleep(150);
      bot.chat('/mycli arena next');
      await until(() => chat.some((line) => line.includes('驿站出发')), 'rest early departure');
      continue;
    }
    await until(() => chat.some((line) => line.includes(`第 ${n}/10 层：`) && line.includes('只怪物')),
      `floor ${n} wave`);
    if (n === 10) assert.ok(bossPackets.length > 0, 'boss bar not sent');
    const killed = rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
    assert.match(killed, /Killed|已杀死|已清除/);
    await until(() => chat.some((line) => line.includes(`第 ${n}/10 层已通关`)), `floor ${n} clear`);
  }
  await until(() => chat.some((line) => line.includes('10 层完成')), 'final completion');
  const opened = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.chat('/mycli arena rewards');
  const chest = await opened;
  const bonuses = chest.slots.slice(9, 18).filter(Boolean).map((item) => ({
    name: item.name, displayName: item.displayName,
  }));
  assert.ok(bonuses.some((item) => item.name === 'diamond_sword'), 'guaranteed boss relic missing');
  assert.ok(bossPackets.length > 0, 'no boss bar packets');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', name, floors: 10, bossPackets: bossPackets.length,
    bonuses: bonuses.map((item) => item.name), diamonds: chest.slots[7]?.count ?? 0 }));
  bot.closeWindow(chest);
} finally {
  bot.quit();
}
