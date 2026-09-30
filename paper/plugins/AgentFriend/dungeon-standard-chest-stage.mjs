// Integration test on the isolated Paper 25566 server. Pass the printed player
// name after restarting staging to verify persisted ordinary chest contents.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const name = process.argv[2] ?? `ChestA${String(Date.now()).slice(-7)}`;
const verifyOnly = process.argv.length > 2;
const other = `ChestB${String(Date.now()).slice(-7)}`;
const connect = async (username) => {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username, auth: 'offline', version: '1.20.6' });
  const lines = [];
  bot.on('messagestr', (line) => lines.push(line));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  return { bot, lines };
};
const until = async (test, label, ms = 15000) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
};
const ask = async (client, command, pattern) => {
  client.lines.length = 0;
  client.bot.chat(command);
  await until(() => pattern.test(client.lines.join('\n')), command);
  return client.lines.join('\n');
};
const openChest = async (client) => {
  await sleep(350);
  if (client.bot.entity.position.distanceTo(new Vec3(-594.5, 91, -311.5)) > 2)
    rcon(`minecraft:tp ${client.bot.username} -594.5 91 -311.5`);
  await until(() => Math.abs(client.bot.entity.position.x + 594.5) < 1, 'lobby chest arrival');
  await client.bot.waitForChunksToLoad();
  const block = client.bot.blockAt(new Vec3(-594, 91, -313));
  assert.equal(block?.name, 'chest', 'physical entrance block is a chest');
  const chest = await client.bot.openContainer(block);
  assert.equal(chest.inventoryStart, 54, 'ordinary 54-slot double chest window');
  return chest;
};
const count = (chest, item) => chest.containerItems()
  .filter((stack) => stack.name === item).reduce((sum, stack) => sum + stack.count, 0);

let a = await connect(name);
let b;
try {
  if (verifyOnly) {
    const chest = await openChest(a);
    assert.equal(count(chest, 'diamond'), 1, 'diamond persists after JVM restart');
    assert.equal(count(chest, 'dirt'), 0, 'other player contents stay private after restart');
    await chest.withdraw(a.bot.registry.itemsByName.diamond.id, null, 1);
    assert.equal(count(chest, 'diamond'), 0, 'ordinary withdraw empties persisted slot');
    a.bot.closeWindow(chest);
    await until(() => a.bot.inventory.items().some((item) => item.name === 'diamond'), 'diamond in backpack');
    console.log(JSON.stringify({ verdict: 'PASS', phase: 'after-restart', player: name }));
  } else {
    b = await connect(other);
    rcon(`minecraft:give ${name} minecraft:cobblestone 3`);
    rcon(`minecraft:give ${name} minecraft:diamond 1`);
    rcon(`minecraft:give ${other} minecraft:dirt 1`);
    await until(() => a.bot.inventory.items().some((item) => item.name === 'cobblestone'), 'cobblestone given');
    let chest = await openChest(a);
    assert.equal(count(chest, 'cobblestone'), 0, 'new personal chest is empty');
    await chest.deposit(a.bot.registry.itemsByName.cobblestone.id, null, 2);
    await chest.deposit(a.bot.registry.itemsByName.diamond.id, null, 1);
    assert.equal(count(chest, 'cobblestone'), 2, 'Mineflayer deposit works');
    assert.equal(count(chest, 'diamond'), 1);
    a.bot.closeWindow(chest);

    chest = await openChest(b);
    assert.equal(count(chest, 'cobblestone'), 0, 'other UUID cannot read A stash');
    assert.equal(count(chest, 'diamond'), 0);
    await chest.deposit(b.bot.registry.itemsByName.dirt.id, null, 1);
    b.bot.closeWindow(chest);
    rcon(`minecraft:tp ${other} -589.5 91 -304.5`);

    chest = await openChest(a);
    assert.equal(count(chest, 'dirt'), 0, 'A cannot read B stash');
    await chest.withdraw(a.bot.registry.itemsByName.cobblestone.id, null, 1);
    assert.equal(count(chest, 'cobblestone'), 1, 'Mineflayer withdraw works');
    a.bot.closeWindow(chest);

    await ask(a, '/mycli guild accept first_step', /已接公会委托/);
    rcon(`minecraft:tp ${name} -589.5 91 -304.5`);
    await until(() => Math.abs(a.bot.entity.position.x + 589.5) < 1, 'start arrival');
    await ask(a, '/mycli arena start', /试炼|进入第/);
    await until(() => a.bot.entity.position.y < 80, 'first floor');
    rcon(`minecraft:effect give ${name} minecraft:resistance 180 4 true`);
    await sleep(3800);
    rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
    await until(() => a.lines.some((line) => line.includes('第 1/10 层已通关')), 'floor clear');
    await ask(a, '/mycli guild claim', /委托交付成功/);
    const before = await ask(a, '/mycli arena rewards list', /MC_REWARD_SUMMARY/);
    assert.match(before, /id=minecraft:emerald/);
    assert.match(before, /id=minecraft:iron_ingot/);
    chest = await openChest(a);
    assert.ok(count(chest, 'emerald') >= 1, 'guild reward appears as normal chest item');
    assert.ok(count(chest, 'iron_ingot') >= 1, 'floor reward appears as normal chest item');
    await chest.withdraw(a.bot.registry.itemsByName.emerald.id, null, 1);
    a.bot.closeWindow(chest);
    const after = await ask(a, '/mycli arena rewards list', /MC_REWARD_SUMMARY/);
    assert.match(after, /MC_REWARD_SUMMARY visible=0 queuedBonus=0/);
    await until(() => a.bot.inventory.items().some((item) => item.name === 'emerald'), 'reward in backpack');
    console.log(JSON.stringify({ verdict: 'PASS', phase: 'session', player: name, other }));
  }
} finally {
  a.bot.quit();
  b?.bot.quit();
}
