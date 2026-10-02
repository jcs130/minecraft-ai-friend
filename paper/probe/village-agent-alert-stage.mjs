import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node', [
  'E:/MC/staging/life-guild-20261003/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
};
const names = ['CortiLan', `Human${Date.now().toString(36).slice(-5)}`];
const bots = names.map(username => mineflayer.createBot({
  host: '127.0.0.1', port: 25567, username, auth: 'offline', version: '1.20.6',
}));
const chats = [[], []];
const packets = [[], []];
const whispers = [[], []];
for (const [i, bot] of bots.entries()) {
  bot.on('messagestr', line => chats[i].push(line));
  bot.on('whisper', (from, message) => whispers[i].push({ from, message }));
  bot._client.on('custom_payload', packet => {
    if (packet.channel === 'mcagent:village')
      packets[i].push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
  });
}

try {
  await Promise.all(bots.map(bot => new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  })));
  // Vanilla tell succeeds without an RCON response body; this minimal RCON client times out on it.
  try { rcon('minecraft:tell CortiLan STAGE_PRIVATE_DELIVERY_TEST'); }
  catch (error) {
    if (!String(error.stdout).includes('RCON TIMEOUT')) throw error;
  }
  await until(() => whispers[0].some(w => w.message.includes('STAGE_PRIVATE_DELIVERY_TEST')),
    'console whisper reaches Mineflayer');
  for (const name of names) rcon(`minecraft:tp ${name} -640 80 -450`);
  await sleep(2_500);
  rcon('minecraft:execute positioned -640 80 -450 run minecraft:kill @e[tag=test_raider,distance=..15]');
  await sleep(2_500);
  const baselines = chats.map(lines => lines.length);
  const whisperBaseline = whispers[0].length;
  rcon('minecraft:summon minecraft:pillager -638 80 -450 {Tags:["test_raider"],NoAI:1b}');
  await until(() => packets.every(list => list.some(item => item.kind === 'alert' && item.active)), 'both private alerts');
  await until(() => whispers[0].slice(whisperBaseline).some(w => w.message.startsWith('MC_VILLAGE_ALERT ')), 'agent urgent whisper alert');
  await until(() => chats[1].slice(baselines[1]).some(line => line.includes('村庄外围出现掠夺者')), 'human short alert');
  assert.equal(whispers[0].slice(whisperBaseline).filter(w => w.message.startsWith('MC_VILLAGE_ALERT ')).length, 1);
  assert.equal(chats[1].slice(baselines[1]).filter(line => line.includes('MC_VILLAGE_ALERT ')).length, 0);
  rcon('minecraft:execute positioned -640 80 -450 run minecraft:kill @e[tag=test_raider,distance=..15]');
  await until(() => packets.every(list => list.some(item => item.kind === 'clear')), 'both private clear');
  console.log('PASS village alert: Agent JSON once, human text once, both private plugin states and clear');
} finally {
  for (const bot of bots) bot.quit();
}
