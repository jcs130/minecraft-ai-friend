// Exercises rewards as held vanilla items, through the same sneak-use path as Java/Bedrock.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const name = process.argv[2];
assert.ok(name, 'pass the arena-balance-stage player name');
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: name, auth: 'offline', version: '1.20.6'});
const lines = [], errors = [];
bot.on('messagestr', line => lines.push(line));
bot.on('error', error => errors.push(error.stack ?? String(error)));
bot.on('kicked', reason => errors.push(`kicked: ${JSON.stringify(reason)}`));
const waitFor = async (condition, label, timeout = 10000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (errors.length) throw new Error(errors.join('\n'));
    if (condition()) return;
    await sleep(100);
  }
  throw new Error(`timeout ${label}: ${lines.slice(-8).join(' | ')}`);
};
const hasName = (item, name) => item && JSON.stringify(item).includes(name);

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  bot.chat('/mycli arena leave');
  await sleep(300);
  const opening = new Promise(resolve => bot.once('windowOpen', resolve));
  bot.chat('/mycli arena rewards');
  const chest = await Promise.race([opening, sleep(8000).then(() => {throw new Error('chest timeout');})]);
  assert.ok(chest.slots.slice(0, 54).some(item => hasName(item, '赤铜柄·闪现匕首'))
    || bot.inventory.items().some(item => hasName(item, '赤铜柄·闪现匕首')));
  assert.ok(chest.slots.slice(0, 54).some(item => hasName(item, '寒霜剑'))
    || bot.inventory.items().some(item => hasName(item, '寒霜剑')));
  const swordType = chest.slots.find(item => item?.name === 'iron_sword').type;
  for (let tries = 0; tries < 8 && !(bot.inventory.items().some(item => hasName(item, '赤铜柄·闪现匕首'))
    && bot.inventory.items().some(item => hasName(item, '寒霜剑'))); tries++) {
    if (!chest.slots.slice(0, 54).some(item => item?.name === 'iron_sword')) break;
    await chest.withdraw(swordType, null, 1);
    await sleep(150);
  }
  bot.closeWindow(chest);
  const blink = bot.inventory.items().find(item => hasName(item, '赤铜柄·闪现匕首'));
  const frost = bot.inventory.items().find(item => hasName(item, '寒霜剑'));
  assert.ok(blink && frost, 'both functional swords must be withdrawable with normal container API');

  rcon('minecraft:forceload add 992 992 1040 1008');
  rcon('minecraft:fill 996 149 996 1030 149 1005 minecraft:stone');
  rcon('minecraft:fill 1012 150 999 1012 153 1001 minecraft:stone');
  rcon(`minecraft:tp ${name} 1000.5 150 1000.5 -90 0`);
  await waitFor(() => bot.entity.position.x > 999 && bot.entity.position.y >= 149, 'test platform arrival');
  await bot.equip(blink, 'hand');
  const before = bot.entity.position.clone();
  bot.setControlState('sneak', true);
  await sleep(300);
  bot.activateItem();
  await waitFor(() => bot.entity.position.distanceTo(before) > 4, 'blink dagger movement');
  const blinkDistance = bot.entity.position.distanceTo(before);
  bot.deactivateItem();
  bot.setControlState('sneak', false);

  rcon(`minecraft:tp ${name} 1000.5 150 1000.5 -90 0`);
  assert.match(rcon('minecraft:summon minecraft:zombie 1003 150 1000 {NoAI:1b}'), /Summoned/);
  await bot.equip(frost, 'hand');
  await sleep(400);
  bot.setControlState('sneak', true);
  await sleep(300);
  bot.activateItem();
  await waitFor(() => lines.some(line => line.includes('霜环') && line.includes('命中')), 'frost sword cast');
  bot.deactivateItem();
  bot.setControlState('sneak', false);
  const health = rcon('minecraft:data get entity @e[type=minecraft:zombie,x=1003,y=150,z=1000,distance=..4,limit=1] Health');
  assert.ok(!/20(?:\.0)?f?\b/.test(health), `frost sword should damage zombie: ${health}`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({verdict: 'PASS', player: name,
    blinkDistance, frostTargetHealth: health.trim()}));
} finally {
  bot.quit();
  rcon('minecraft:kill @e[type=minecraft:zombie,x=1003,y=150,z=1000,distance=..4]');
  rcon('minecraft:forceload remove 992 992 1040 1008');
}
