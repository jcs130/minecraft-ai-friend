// Run prepare, restart isolated Paper, then run verify.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const mode = process.argv[2];
assert.ok(['prepare', 'verify'].includes(mode));
const rcon = command => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
  username: `ShrPst${String(Date.now()).slice(-6)}`, auth: 'offline', version: '1.20.6' });
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  bot.setQuickBarSlot(8);
  rcon(`minecraft:tp ${bot.username} -475.5 67 -493.5`);
  await sleep(1200);
  await bot.waitForChunksToLoad();
  const block = bot.blockAt(new Vec3(-473, 67, -489));
  assert.equal(block?.name, 'chest');
  const chest = await bot.openContainer(block);
  assert.equal(chest.inventoryStart, 54);
  const id = bot.registry.itemsByName.cobblestone.id;
  if (mode === 'prepare') {
    assert.equal(chest.containerItems().filter(item => item.name === 'cobblestone').length, 0);
    bot.closeWindow(chest);
    rcon(`minecraft:give ${bot.username} minecraft:cobblestone 3`);
    await sleep(300);
    const opened = await bot.openContainer(block);
    await opened.deposit(id, null, 3);
    assert.equal(opened.containerItems().find(item => item.name === 'cobblestone')?.count, 3);
    bot.closeWindow(opened);
  } else {
    assert.equal(chest.containerItems().find(item => item.name === 'cobblestone')?.count, 3);
    await chest.withdraw(id, null, 3);
    bot.closeWindow(chest);
    rcon(`minecraft:tp ${bot.username} -491.5 67 -498.5`);
    await sleep(900);
    const receptionists = Object.values(bot.entities).filter(entity => entity.name === 'villager'
      && entity.position.distanceTo(new Vec3(-492.5, 67, -497.5)) < 2);
    assert.equal(receptionists.length, 1, 'one persistent receptionist after restart');
  }
  console.log(JSON.stringify({ verdict: 'PASS', mode, chest: [-473, 67, -489],
    cobblestone: mode === 'prepare' ? 3 : 0 }));
} finally { bot.quit(); }
