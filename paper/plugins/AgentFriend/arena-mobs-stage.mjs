// Real Mineflayer + isolated Paper 25566 integration audit of all ten floors.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const expected = [3, 4, 4, 5, 6, 7, 0, 8, 9, 5];
const floorY = [69, 57, 45, 33, 21, 9, -3, -15, -27, -39];
const handFor = {
  SKELETON: 'BOW', STRAY: 'BOW', PILLAGER: 'CROSSBOW', VINDICATOR: 'IRON_AXE',
};
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: `Audit${String(Date.now()).slice(-8)}`, auth: 'offline', version: '1.20.6'});
const lines = [];
bot.on('messagestr', line => lines.push(line));
const until = async (test, label, ms = 25000) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 300) {
    const value = test();
    if (value) return value;
    await sleep(300);
  }
  throw new Error(`Timed out: ${label}`);
};
await new Promise((resolve, reject) => {
  bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
});
const report = [];
try {
  rcon(`minecraft:effect give ${bot.username} minecraft:resistance 900 4 true`);
  rcon(`minecraft:effect give ${bot.username} minecraft:saturation 900 4 true`);
  rcon(`minecraft:tp ${bot.username} -589.5 91 -304.5`);
  await until(() => Math.abs(bot.entity.position.x + 589.5) < 1, 'lobby arrival');
  bot.chat('/mycli arena start');
  await until(() => Math.abs(bot.entity.position.y - floorY[0]) < 2, 'first floor');
  for (let number = 1; number <= 10; number++) {
    await until(() => Math.abs(bot.entity.position.y - floorY[number - 1]) < 2,
      `floor ${number} arrival`, 30000);
    const raw = await until(() => {
      const value = rcon('mycli admin dungeonaudit');
      const found = value.match(/MC_DUNGEON_AUDIT_END floor=(\d+) count=(\d+)/);
      const targets = [...value.matchAll(/MC_DUNGEON_MOB[^\n]* target=([^ ]+)/g)].map(match => match[1]);
      return found && Number(found[1]) === number && Number(found[2]) === expected[number - 1]
        && targets.length === expected[number - 1] && targets.every(target => /^PLAYER:/.test(target))
        ? value : null;
    }, `floor ${number} spawned and targeted`, 14000);
    const summary = raw.match(/MC_DUNGEON_AUDIT floor=(\d+) active=(\w+) spawned=(\w+)/);
    const count = raw.match(/MC_DUNGEON_AUDIT_END floor=(\d+) count=(\d+)/);
    assert.ok(summary && count, `audit response floor ${number}: ${raw}`);
    assert.equal(Number(summary[1]), number);
    assert.equal(Number(count[2]), expected[number - 1], `mob count floor ${number}`);
    const mobs = [...raw.matchAll(/MC_DUNGEON_MOB floor=(\d+) id=([a-f0-9-]+) type=(\w+) hand=(\w+) ai=(\w+) target=([^ ]+) health=([^ ]+) lastDamage=([^\s]+)/g)]
      .map(([, floor, id, type, hand, ai, target, health, lastDamage]) =>
        ({floor: Number(floor), id, type, hand, ai, target, health: Number(health), lastDamage}));
    assert.equal(mobs.length, expected[number - 1], `parse all mobs floor ${number}`);
    for (const mob of mobs) {
      assert.equal(mob.ai, 'true', `AI floor ${number} ${mob.type}`);
      assert.equal(mob.hand, handFor[mob.type] ?? 'AIR', `main hand floor ${number} ${mob.type}`);
      assert.match(mob.target, /^PLAYER:/, `player target floor ${number} ${mob.type}`);
      assert.ok(!/:(?:ZOMBIE|HUSK|SKELETON|STRAY|PILLAGER|VINDICATOR|WITCH|SPIDER|CAVE_SPIDER|BLAZE|DROWNED|MAGMA_CUBE|RAVAGER)$/.test(mob.lastDamage),
        `no unblocked monster damage floor ${number} ${mob.type}`);
    }
    report.push({floor: number, count: mobs.length, mobs});
    if (number === 7) {
      bot.chat('/mycli arena shop');
      const menu = await until(() => bot.currentWindow, 'seventh-floor shop menu');
      assert.equal(menu.inventoryStart, 27, 'vanilla 27-slot shop menu');
      bot.closeWindow(menu);
      bot.chat('/mycli arena next');
    } else if (number !== 10) {
      rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
    }
  }
  rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  writeFileSync('E:/MC/staging/arena-dungeon-20260928/arena-mob-audit-20261001.json',
    JSON.stringify(report, null, 2));
  console.log(JSON.stringify({verdict: 'PASS', floors: report.map(value =>
    ({floor: value.floor, count: value.count, types: value.mobs.map(mob => mob.type)}))}));
} finally { bot.quit(); }
