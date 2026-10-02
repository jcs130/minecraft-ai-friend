// Isolated Paper 25566: new vanilla weapons invoke their imprinted spell by sneaking/use.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = Date.now().toString(36).slice(-5);
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command],
  { encoding: 'utf8', timeout: 10000 });
const allCases = [
  { suffix: 'A', material: 'iron_axe', spell: 'flamewave', cost: 8, x: -450 },
  { suffix: 'B', material: 'bow', spell: 'starbolt', cost: 4, x: -435 },
  { suffix: 'C', material: 'crossbow', spell: 'blink', cost: 4, x: -420 },
  { suffix: 'D', material: 'trident', spell: 'frostnova', cost: 7, x: -405 },
];
const cases = process.env.WEAPON_ONLY
  ? allCases.filter(test => test.material === process.env.WEAPON_ONLY) : allCases;
const bots = [];

try {
  rcon('minecraft:forceload add -460 -370 -390 -330');
  assert.match(rcon('minecraft:fill -460 200 -370 -390 200 -330 minecraft:stone'), /Filled|填充/i);
  for (const test of cases) {
    const name = `Wpn${test.suffix}${stamp}`;
    const events = [];
    const chat = [];
    const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
      username: name, auth: 'offline', version: '1.20.6' });
    bots.push(bot);
    bot.on('messagestr', line => chat.push(line));
    bot._client.on('custom_payload', packet => {
      if (packet.channel === 'mcagent:event')
        events.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
    });
    await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); });
    rcon(`minecraft:tp ${name} ${test.x} 201 -350`);
    await sleep(800);
    const item = `minecraft:${test.material}[minecraft:custom_data={PublicBukkitValues:{"agentfriend:imprint_spell":"${test.spell}"}}]`;
    assert.match(rcon(`minecraft:item replace entity ${name} weapon.mainhand with ${item} 1`),
      /Replaced|替换|已替换/i);
    let target;
    if (test.spell !== 'blink') {
      rcon(`minecraft:execute at ${name} run summon minecraft:zombie ~2 ~ ~ {Tags:["WeaponImprintQA"],NoAI:1b,PersistenceRequired:1b}`);
      await sleep(300);
      target = Object.values(bot.entities).find(entity => entity.name === 'zombie'
        && entity.position.distanceTo(new Vec3(test.x + 2.5, 201, -349.5)) < 3);
      assert.ok(target, `${test.material}: zombie absent`);
      await bot.lookAt(target.position.offset(0, 1, 0), true);
    } else await bot.lookAt(new Vec3(test.x + 8, 202, -349.5), true);
    const before = bot.health;
    bot.setControlState('sneak', true);
    await sleep(200);
    bot.activateItem();
    await sleep(1600);
    bot.setControlState('sneak', false);
    const success = events.find(event => event.id === test.spell && event.kind === 'skill');
    assert.ok(success, `${test.material}: no successful ${test.spell} private event; events=${JSON.stringify(events)} chat=${JSON.stringify(chat.slice(-12))}`);
    assert.equal(bot.heldItem?.name, test.material, `${test.material}: normal use consumed imprinted weapon`);
    console.log(`PASS ${name}: ${test.material} -> ${test.spell}; health ${before}->${bot.health}`);
    bot.quit();
    rcon('minecraft:kill @e[tag=WeaponImprintQA]');
  }
} finally {
  rcon('minecraft:kill @e[tag=WeaponImprintQA]');
  rcon('minecraft:forceload remove -460 -370 -390 -330');
  for (const bot of bots) bot.quit();
}
