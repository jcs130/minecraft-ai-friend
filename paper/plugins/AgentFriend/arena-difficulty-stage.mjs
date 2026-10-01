import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const difficulty = process.argv[2] ?? 'adventure';
const health = {normal: 20, adventure: 30, apocalypse: 44}[difficulty];
const wallet = {normal: 0, adventure: 2, apocalypse: 5}[difficulty];
assert.ok(health, 'expected normal, adventure or apocalypse');
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: `Tier${difficulty[0]}${String(Date.now()).slice(-6)}`,
  auth: 'offline', version: '1.20.6'});
const messages = [];
bot.on('messagestr', line => messages.push(line));
const until = async (fn, label, limit = 20000) => {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const value = fn();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}; ${messages.slice(-12).join(' | ')}`);
};
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  rcon(`minecraft:tp ${bot.username} -589.5 91 -304.5`);
  await until(() => bot.entity.position.x < -580, 'lobby');
  bot.chat(`/mycli arena difficulty ${difficulty}`);
  await until(() => messages.some(line => line.includes(`selected=${difficulty} changed=true`)), 'tier selected');
  bot.chat('/mycli arena start');
  await until(() => bot.entity.position.y < 75, 'entered first floor');
  const audit = await until(() => {
    const raw = rcon('mycli admin dungeonaudit');
    return raw.includes('MC_DUNGEON_AUDIT_END floor=1 count=3') ? raw : null;
  }, 'three first-floor mobs');
  const mobs = [...audit.matchAll(/type=ZOMBIE[^\n]*hand=(\w+)[^\n]*health=([0-9.]+)/g)];
  assert.equal(mobs.length, 3, audit);
  for (const match of mobs) {
    assert.ok(['STONE_SWORD', 'STONE_AXE'].includes(match[1]), match[0]);
    assert.equal(Number(match[2]), health, match[0]);
  }
  const before = bot.health;
  await until(() => bot.health < before, 'mob attack damage', 18000);
  const after = bot.health;
  if (process.argv.includes('--deep'))
    rcon(`minecraft:effect give ${bot.username} minecraft:resistance 240 4 true`);
  rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  await until(() => messages.some(line => line.includes('category=difficulty_wallet')
      || difficulty === 'normal' && line.includes('第 1 层过关')), 'floor reward', 8000);
  if (difficulty !== 'normal') {
    assert.ok(messages.some(line => line.includes(`difficulty=${difficulty} amount=${wallet}`)),
      messages.slice(-20).join(' | '));
    bot.chat('/mycli arena wallet');
    await until(() => messages.some(line => line.includes('MC_ARENA_ECONOMY')
      && line.includes(`"balance":${wallet}`)), 'virtual wallet');
  }
  let deep = null;
  if (process.argv.includes('--deep')) {
    const floorY = {2: 57, 3: 45, 4: 33, 5: 21, 6: 9};
    for (const [floor, y] of Object.entries(floorY)) {
      await until(() => Math.abs(bot.entity.position.y - y) < 2,
        `floor ${floor} arrival`, 20000);
      const wave = await until(() => {
        const audit = rcon('mycli admin dungeonaudit');
        return new RegExp(`MC_DUNGEON_AUDIT_END floor=${floor} count=[1-9]`).test(audit) ? audit : null;
      }, `floor ${floor} wave`, 10000);
      assert.match(wave, /ai=true target=PLAYER:/);
      if (floor === '5' && process.argv.includes('--ranged')) {
        rcon('minecraft:tag @e[tag=afu_dungeon_mob,type=minecraft:skeleton,limit=1,sort=nearest] add qa_keep');
        rcon('minecraft:kill @e[tag=afu_dungeon_mob,tag=!qa_keep]');
        await until(() => {
          const audit = rcon('mycli admin dungeonaudit');
          return audit.includes('MC_DUNGEON_AUDIT_END floor=5 count=1') ? audit : null;
        }, 'single skeleton remains');
        rcon(`minecraft:effect clear ${bot.username} minecraft:resistance`);
        const rangedBefore = bot.health;
        await until(() => bot.health < rangedBefore, 'skeleton projectile damage', 18000);
        rcon(`minecraft:effect give ${bot.username} minecraft:resistance 240 4 true`);
      }
      if (floor !== '6') rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
      else {
        assert.match(wave, /type=SKELETON[^\n]*hand=BOW/);
        assert.match(wave, /type=WITCH[^\n]*hand=AIR/);
        rcon(`minecraft:effect clear ${bot.username} minecraft:resistance`);
        const healthBefore = bot.health;
        await until(() => bot.health < healthBefore, 'sixth-floor real damage', 18000);
        deep = {floor: 6, healthBefore, healthAfter: bot.health};
      }
    }
  }
  console.log(JSON.stringify({verdict: 'PASS', difficulty, zombieHealth: health,
    playerHealthBefore: before, playerHealthAfter: after, walletBonus: wallet,
    mobWeapons: mobs.map(match => match[1]), deep}));
} finally {
  bot.quit();
}
