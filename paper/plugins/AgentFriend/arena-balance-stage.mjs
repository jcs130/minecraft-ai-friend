// Isolated Paper 1.20.6 integration: normal mob strength, reward curve, and vanilla item imprints.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const name = `Balance${String(Date.now()).slice(-8)}`;
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: name, auth: 'offline', version: '1.20.6'});
const lines = [], errors = [];
bot.on('messagestr', line => lines.push(line));
bot.on('error', error => errors.push(error.stack ?? String(error)));
bot.on('kicked', reason => errors.push(`kicked: ${JSON.stringify(reason)}`));
const until = async (test, label, timeout = 30000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (errors.length) throw new Error(errors.join('\n'));
    const result = test();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`timeout ${label}; ${lines.slice(-8).join(' | ')}`);
};
const y = [69, 57, 45, 33, 21, 9, -3, -15, -27, -39];

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  rcon(`minecraft:effect give ${name} minecraft:resistance 900 4 true`);
  rcon(`minecraft:effect give ${name} minecraft:saturation 900 4 true`);
  rcon(`minecraft:tp ${name} -589.5 91 -304.5`);
  bot.chat('/mycli arena difficulty normal');
  await until(() => lines.some(line => line.includes('普通') && line.includes('难度')), 'difficulty');
  bot.chat('/mycli arena start');
  for (let floor = 1; floor <= 10; floor++) {
    await until(() => Math.abs(bot.entity.position.y - y[floor - 1]) < 2,
      `floor ${floor} arrival`);
    if (floor === 7) {
      bot.chat('/mycli arena next');
      continue;
    }
    await until(() => lines.some(line => line.includes(`第 ${floor}/`) && line.includes('只怪物')),
      `floor ${floor} wave`, 15000);
    if (floor === 1) {
      const health = rcon('minecraft:data get entity @e[tag=afu_dungeon_mob,type=minecraft:zombie,limit=1] Health');
      assert.match(health, /23(?:\.0)?f?/, `normal zombie health should be 23: ${health}`);
    }
    rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
    await until(() => lines.some(line => line.includes(`第 ${floor}/`) && line.includes('已通关')),
      `floor ${floor} clear`);
    const fixed = lines.filter(line => line.startsWith(`MC_DUNGEON_LOOT floor=${floor} category=milestone`));
    if (floor === 6 || floor === 10) assert.ok(fixed.some(line => line.includes('item=minecraft:iron_sword')),
      `functional iron weapon milestone ${floor}: ${fixed}`);
    const resource = lines.filter(line => line.startsWith(`MC_DUNGEON_LOOT floor=${floor} category=milestone`));
    assert.ok(resource.every(line => !line.includes('diamond_') && !line.includes('netherite_')),
      `top-tier equipment milestone ${floor}: ${resource}`);
  }
  const opening = new Promise(resolve => bot.once('windowOpen', resolve));
  bot.chat('/mycli arena rewards');
  const chest = await Promise.race([opening, sleep(15000).then(() => {throw new Error('chest timeout');})]);
  const contents = chest.slots.slice(0, 54).filter(Boolean);
  const blink = contents.find(item => item.name === 'iron_sword' && JSON.stringify(item).includes('赤铜柄·闪现匕首'));
  const frost = contents.find(item => item.name === 'iron_sword' && JSON.stringify(item).includes('寒霜剑'));
  assert.ok(blink && frost, 'both named vanilla iron weapons must reach Mineflayer chest');
  assert.ok(JSON.stringify(blink).includes('imprint_spell') && JSON.stringify(blink).includes('blink'),
    'blink dagger missing clientbound imprint component');
  assert.ok(JSON.stringify(frost).includes('imprint_spell') && JSON.stringify(frost).includes('frostnova'),
    'frost sword missing clientbound imprint component');
  assert.ok(!contents.some(item => item.name.startsWith('netherite_') || item.name.startsWith('diamond_')),
    'ordinary ten-floor run must not guarantee top-tier gear');
  bot.chat('/mycli arena loot');
  const progress = await until(() => lines.find(line => line.startsWith('MC_DUNGEON_SET schemaVersion=2')),
    'equipment progress');
  assert.match(progress, /equipmentIndex=2 next=minecraft:shield nextName=copper_shield/);
  assert.equal(errors.length, 0);
  console.log(JSON.stringify({verdict: 'PASS', player: name, slotsUsed: contents.length,
    blink: blink.name, frost: frost.name, progress}));
  bot.closeWindow(chest);
} finally {
  bot.quit();
}
