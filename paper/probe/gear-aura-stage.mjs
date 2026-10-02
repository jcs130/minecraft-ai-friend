// Isolated Paper 1.20.6 integration: vanilla equipped items, hostile-only burn,
// nearby player healing, and per-account mcagent state.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = String(Date.now()).slice(-7);
const first = `GearA${stamp}`;
const second = `GearB${stamp}`;
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command],
  { encoding: 'utf8', timeout: 10000 });
const bots = [];
const states = new Map();

async function join(name) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username: name, auth: 'offline', version: '1.20.6' });
  bots.push(bot);
  bot._client.on('custom_payload', packet => {
    if (packet.channel !== 'mcagent:state') return;
    const data = Buffer.isBuffer(packet.data) ? packet.data : Buffer.from(packet.data ?? []);
    states.set(name, JSON.parse(data.toString('utf8')));
  });
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); });
  return bot;
}

try {
  const a = await join(first);
  const b = await join(second);
  rcon('minecraft:gamerule naturalRegeneration false');
  rcon('minecraft:forceload add -405 -355 -395 -345');
  assert.match(rcon('minecraft:fill -405 200 -355 -395 200 -345 minecraft:stone'), /Filled|填充/i);
  rcon(`minecraft:tp ${first} -400 201 -350`);
  rcon(`minecraft:tp ${second} -398 201 -350`);
  await sleep(1000);
  const equip = (name, type, aura) => rcon(`minecraft:item replace entity ${name} armor.chest with minecraft:${type}[minecraft:custom_data={PublicBukkitValues:{"agentfriend:gear_aura":"${aura}"}}] 1`);
  assert.match(equip(first, 'iron_chestplate', 'ember'), /Replaced|替换|已替换/i);
  await sleep(1800);
  assert.equal(states.get(first)?.equipmentEffects?.[0]?.id, 'gear:ember');
  assert.deepEqual(states.get(second)?.equipmentEffects, []);
  rcon('minecraft:kill @e[tag=GearAuraQA]');
  assert.match(rcon(`minecraft:execute at ${first} run summon minecraft:zombie ~2 ~ ~ {Tags:["GearAuraQA"],NoAI:1b,PersistenceRequired:1b}`), /Summoned|召唤/i);
  const health = () => {
    const raw = rcon('minecraft:data get entity @e[tag=GearAuraQA,limit=1] Health');
    return Number(raw.match(/entity data:\s*(-?\d+(?:\.\d+)?)/)?.[1]);
  };
  await sleep(300);
  const before = health();
  const friendlyBefore = b.health;
  await sleep(5200);
  const after = health();
  assert.ok(after < before, `Ember armor did not damage nearby hostile: ${before} -> ${after}`);
  assert.equal(b.health, friendlyBefore, 'Ember armor damaged nearby player');
  rcon('minecraft:kill @e[tag=GearAuraQA]');

  assert.match(equip(first, 'golden_chestplate', 'renewal'), /Replaced|替换|已替换/i);
  rcon(`minecraft:damage ${first} 6 minecraft:generic`);
  rcon(`minecraft:damage ${second} 6 minecraft:generic`);
  await sleep(500);
  const firstDamaged = a.health;
  const secondDamaged = b.health;
  await sleep(5200);
  assert.equal(a.health, firstDamaged, 'Renewal healed wearer during combat');
  assert.equal(b.health, secondDamaged, 'Renewal healed nearby player during combat');
  await sleep(6800);
  assert.ok(a.health > firstDamaged, `Wearer was not healed: ${firstDamaged} -> ${a.health}`);
  assert.ok(b.health > secondDamaged, `Nearby player was not healed: ${secondDamaged} -> ${b.health}`);
  assert.equal(states.get(first)?.equipmentEffects?.[0]?.id, 'gear:renewal');
  assert.deepEqual(states.get(second)?.equipmentEffects, []);

  assert.match(equip(first, 'chainmail_chestplate', 'leech'), /Replaced|替换|已替换/i);
  await sleep(1300);
  assert.equal(states.get(first)?.equipmentEffects?.[0]?.id, 'gear:leech');
  rcon(`minecraft:damage ${first} 6 minecraft:generic`);
  rcon(`minecraft:damage ${second} 6 minecraft:generic`);
  await sleep(250);
  const groupBeforeA = a.health;
  const groupBeforeB = b.health;
  const manaBefore = states.get(first)?.mana?.current;
  a.chat(process.env.DIRECT_CAST ? '/cast heal' : '/mycli cast heal');
  await sleep(900);
  assert.ok(a.health >= groupBeforeA + 5.9, `Group heal missed caster: ${groupBeforeA} -> ${a.health}`);
  assert.ok(b.health >= groupBeforeB + 5.9, `Group heal missed ally: ${groupBeforeB} -> ${b.health}`);
  assert.ok(states.get(first)?.mana?.current <= manaBefore - 5.5, 'Group heal did not spend shared mana');

  rcon(`minecraft:damage ${first} 8 minecraft:generic`);
  rcon(`minecraft:execute at ${first} run summon minecraft:zombie ~1 ~ ~ {Tags:["GearAuraQA"],NoAI:1b,PersistenceRequired:1b}`);
  await sleep(350);
  const zombie = Object.values(a.entities).find(entity => entity.name === 'zombie'
    && entity.position.distanceTo(a.entity.position) < 3);
  assert.ok(zombie, 'Lifesteal target not visible to vanilla client');
  const leechBefore = a.health;
  for (let attempt = 0; attempt < 3 && a.health <= leechBefore; attempt++) {
    a.attack(zombie);
    await sleep(900);
  }
  assert.ok(a.health > leechBefore, `Lifesteal did not restore health: ${leechBefore} -> ${a.health}`);
  console.log(`PASS ${first}/${second}: hostile burn, out-of-combat shared regen, private state, group heal, lifesteal ${leechBefore}->${a.health}`);
} finally {
  rcon('minecraft:gamerule naturalRegeneration true');
  rcon('minecraft:kill @e[tag=GearAuraQA]');
  rcon('minecraft:forceload remove -405 -355 -395 -345');
  for (const bot of bots) bot.quit();
}
