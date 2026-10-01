import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: process.argv[2], auth: 'offline', version: '1.20.6'});
await new Promise((resolve, reject) => {
  bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
});
try {
  rcon(`minecraft:effect give ${bot.username} minecraft:resistance 120 4 true`);
  await sleep(8000);
  const audit = () => rcon('mycli admin dungeonaudit');
  const before = audit();
  const entries = [...before.matchAll(/MC_DUNGEON_MOB floor=10 id=([a-f0-9-]+) type=(\w+)[^\n]* health=([0-9.]+)/g)]
    .map(([, id, type, health]) => ({id, type, health: Number(health)}));
  const victim = entries.find(entry => entry.type === 'RAVAGER');
  const attacker = entries.find(entry => entry.type === 'PILLAGER');
  assert.ok(victim && attacker, `boss and pillager need to be alive: ${before}`);
  const command = rcon(`minecraft:damage ${victim.id} 4 minecraft:mob_attack by ${attacker.id}`);
  await sleep(300);
  const after = audit();
  const health = Number(after.match(new RegExp(`MC_DUNGEON_MOB floor=10 id=${victim.id}[^\\n]* health=([0-9.]+)`))?.[1]);
  assert.equal(health, victim.health, `friendly attack must not hurt boss: ${command} ${after}`);
  assert.match(after, /lastDamage=blocked_friendly_/);
  const projectile = rcon(`minecraft:damage ${victim.id} 4 minecraft:arrow by ${attacker.id}`);
  await sleep(300);
  const projectileAudit = audit();
  const afterProjectile = Number(projectileAudit.match(new RegExp(`MC_DUNGEON_MOB floor=10 id=${victim.id}[^\\n]* health=([0-9.]+)`))?.[1]);
  assert.equal(afterProjectile, health, `friendly arrow-type damage must not hurt boss: ${projectile}`);
  const generic = rcon(`minecraft:damage ${victim.id} 2 minecraft:generic`);
  await sleep(300);
  const control = audit();
  const controlHealth = Number(control.match(new RegExp(`MC_DUNGEON_MOB floor=10 id=${victim.id}[^\\n]* health=([0-9.]+)`))?.[1]);
  assert.ok(controlHealth < health, `positive control must damage the same boss: ${generic} ${control}`);
  console.log(JSON.stringify({verdict: 'PASS', victim: victim.type, attacker: attacker.type,
    healthBefore: victim.health, healthAfterFriendly: health,
    healthAfterProjectile: afterProjectile, healthAfterControl: controlHealth,
    command: command.trim()}));
} finally { bot.quit(); }
