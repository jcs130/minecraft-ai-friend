// Run against the isolated Paper 1.20.6 server on port 25566.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: 'StarboltTypeQA', auth: 'offline', version: '1.20.6',
});
const messages = [];
const packets = [];
bot.on('messagestr', message => messages.push(message));
bot._client.on('packet', (packet, meta) => {
  if (meta.name === 'world_particles' || meta.name === 'set_title_text'
      || meta.name.includes('sound')) packets.push({ name: meta.name, body: JSON.stringify(packet) });
});
const cast = async () => {
  messages.length = 0;
  bot.chat('/mycli cast starbolt');
  await sleep(800);
  return messages.join('\n');
};

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reason => reject(new Error(JSON.stringify(reason))));
    setTimeout(() => reject(new Error('spawn timeout')), 30000);
  });
  rcon('minecraft:kill @e[tag=qa_starbolt_type]');
  rcon('minecraft:fill 290 98 -10 310 98 10 stone');
  rcon('minecraft:fill 290 99 -10 310 105 10 air');
  rcon('minecraft:tp StarboltTypeQA 300 99 0 0 0');
  rcon('minecraft:summon villager 300 99 3 {NoAI:1b,Tags:["qa_starbolt_type"],CustomName:\'{"text":"小林"}\'}');
  await sleep(500);
  assert.match(await cast(), /没找到怪物；未消耗魔力/);

  rcon('minecraft:summon pillager 300 99 7 {NoAI:1b,Tags:["qa_starbolt_type"],CustomName:\'{"text":"小林"}\'}');
  await sleep(350);
  packets.length = 0;
  const hit = await cast();
  assert.match(hit, /星芒箭命中 小林〔掠夺者 \/ minecraft:pillager〕（4 魔力）/);
  assert.ok(packets.some(packet => packet.name === 'set_title_text'
    && packet.body.includes('星芒破空')), 'combat chant title');
  assert.ok(packets.filter(packet => packet.name === 'world_particles').length >= 45,
    'three-beat caster sigil plus starbolt trail');
  assert.ok(packets.filter(packet => packet.name.includes('sound')).length >= 2,
    'two-beat combat audio');
  assert.match(rcon('minecraft:data get entity @e[type=minecraft:villager,tag=qa_starbolt_type,limit=1] Health'), /20\.0f/);
  assert.match(rcon('minecraft:data get entity @e[type=minecraft:pillager,tag=qa_starbolt_type,limit=1] Health'), /19\.0f/);
  console.log('PASS named pillager type shown; villager ignored; no-target cast did not enter cooldown');
} finally {
  rcon('minecraft:kill @e[tag=qa_starbolt_type]');
  bot.quit();
}
