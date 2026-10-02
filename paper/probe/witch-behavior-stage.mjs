// Isolated Paper 25566 only: isolate the sixth-floor witch and observe attacks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], { encoding: 'utf8' });
const name = process.env.WITCH_NAME ?? `WitchQA${Date.now().toString(36).slice(-6)}`;
const resume = process.env.WITCH_RESUME === '1';
const distance = Number(process.env.WITCH_DISTANCE ?? 4.5);
const freeze = process.env.WITCH_FREEZE === '1';
const expectRecovery = process.env.WITCH_EXPECT_RECOVERY === '1';
assert.ok(distance >= 3 && distance <= 16, 'test distance out of room bounds');
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
  username: name, auth: 'offline', version: '1.20.6' });
const health = [];
const potionSpawns = [];
const errors = [];
bot.on('health', () => health.push({ at: Date.now(), value: bot.health }));
bot.on('entitySpawn', entity => {
  if (/potion/i.test(entity.name ?? '') || /potion/i.test(entity.displayName ?? ''))
    potionSpawns.push({ at: Date.now(), name: entity.name, position: entity.position });
});
bot.on('error', error => errors.push(error.message));
const until = async (predicate, label, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}; audit=${rcon('mycli admin dungeonaudit')}`);
};
const audit = () => rcon('mycli admin dungeonaudit');
const floorReady = floor => {
  const state = audit();
  const header = state.match(/MC_DUNGEON_AUDIT floor=(\d+) active=(\w+) spawned=(\w+)/);
  const end = state.match(/MC_DUNGEON_AUDIT_END floor=(\d+) count=(\d+)/);
  return header && end && Number(header[1]) === floor && header[3] === 'true'
    && Number(end[2]) > 0 ? state : null;
};

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  rcon(`minecraft:attribute ${name} minecraft:generic.max_health base set 100`);
  rcon(`minecraft:effect give ${name} minecraft:instant_health 1 10 true`);
  rcon(`minecraft:effect give ${name} minecraft:resistance 180 4 true`);
  if (!resume) {
    rcon(`minecraft:tp ${name} -589.5 91 -304.5`);
    await sleep(500);
    bot.chat('/mycli arena start');
    for (let floor = 1; floor <= 5; floor++) {
      await until(() => floorReady(floor), `floor ${floor} spawned`, 35000);
      rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
    }
  }
  const state = await until(() => floorReady(6), 'floor 6 spawned', 35000);
  const witchLine = state.split(/\r?\n/).find(line => /type=WITCH\b/.test(line));
  assert.ok(witchLine, `no witch on floor 6: ${state}`);
  const x = Number(witchLine.match(/\bx=(-?\d+)/)?.[1]);
  const y = Number(witchLine.match(/\by=(-?\d+)/)?.[1]);
  const z = Number(witchLine.match(/\bz=(-?\d+)/)?.[1]);
  rcon('minecraft:kill @e[tag=afu_dungeon_mob,type=!minecraft:witch]');
  const freezeResult = freeze
    ? rcon('minecraft:attribute @e[tag=afu_dungeon_mob,type=minecraft:witch,limit=1] minecraft:generic.movement_speed base set 0')
    : null;
  rcon(`minecraft:tp ${name} ${x + distance} ${y} ${z + 0.5}`);
  rcon(`minecraft:effect clear ${name} minecraft:resistance`);
  await sleep(1000);
  const before = bot.health;
  const firstAudit = audit();
  await sleep(16000);
  const after = bot.health;
  const lastAudit = audit();
  const report = { name, distance, before, after,
    minimumHealth: Math.min(...health.filter(item => item.at >= Date.now() - 16_500).map(item => item.value)),
    potionCount: potionSpawns.length, freeze, freezeResult, playerPosition: bot.entity.position,
    firstAudit, lastAudit, errors };
  console.log(JSON.stringify(report, null, 2));
  const firstX = Number(firstAudit.match(/type=WITCH[^\n]*\bx=(-?\d+)/)?.[1]);
  const lastX = Number(lastAudit.match(/type=WITCH[^\n]*\bx=(-?\d+)/)?.[1]);
  if (expectRecovery) {
    assert.ok(firstX !== lastX, 'stationary ranged mob did not recover');
    assert.match(lastAudit, /lastProjectileMs=\d+/, 'recovered witch did not cast');
    assert.ok(after < before, 'recovered witch did not damage participant');
  } else if (freeze) {
    assert.equal(firstX, lastX, 'effective ranged mob was moved despite hitting');
    assert.match(lastAudit, /lastDirectHitMs=\d+/, 'effective witch has no direct hit');
    assert.ok(after < before && potionSpawns.length > 0, 'effective witch did not fight');
  }
} finally {
  try { rcon('minecraft:kill @e[tag=afu_dungeon_mob]'); } catch { /* stage only */ }
  bot.quit();
}
