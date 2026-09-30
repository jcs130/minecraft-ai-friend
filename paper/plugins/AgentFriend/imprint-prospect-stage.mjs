// Paper 1.20.6 isolated-server integration: range, enchantment table, generic item casting.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const rcon = (command) => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const username = `Imprint${String(Date.now()).slice(-7)}`;
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username, auth: 'offline', version: '1.20.6' });
const chats = [], errors = [], bars = [];
bot.on('messagestr', (line) => chats.push(line));
bot.on('error', (error) => errors.push(error.message));
bot.on('kicked', (reason) => errors.push(`kicked: ${JSON.stringify(reason)}`));
bot._client.on('packet', (packet, meta) => { if (meta.name === 'boss_bar') bars.push(packet); });
try {
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); });
  rcon('minecraft:forceload add 992 992 1040 1008');
  rcon('minecraft:gamerule naturalRegeneration false');
  rcon('minecraft:fill 996 149 996 1005 149 1005 minecraft:stone');
  rcon('minecraft:setblock 1001 150 1000 minecraft:enchanting_table');
  rcon('minecraft:fill 1024 145 998 1028 149 1002 minecraft:stone');
  rcon('minecraft:setblock 1026 147 1000 minecraft:diamond_ore');
  rcon(`minecraft:tp ${username} 1000.5 150 1000.5`);
  rcon(`minecraft:experience set ${username} 12 levels`);
  rcon(`minecraft:give ${username} minecraft:diamond_pickaxe 1`);
  rcon(`minecraft:give ${username} minecraft:iron_sword 1`);
  rcon(`minecraft:give ${username} minecraft:lapis_lazuli 3`);
  await sleep(1600);
  const pick = bot.inventory.items().find((item) => item.name === 'diamond_pickaxe');
  assert.ok(pick, 'pickaxe should be delivered over vanilla protocol');
  await bot.equip(pick, 'hand');
  bot.chat('/mycli cast prospect diamond');
  await sleep(500);
  assert.ok(chats.some((line) => line.includes('周围 24 格内没有发现')), `Unimprinted range: ${chats}`);
  await sleep(5100);
  bot.chat('/mycli imprint prospect diamond');
  await sleep(500);
  assert.ok(chats.some((line) => line.includes('已给手持物品刻印 探钻石')), `Imprint: ${chats}`);
  const enchantedPick = bot.heldItem;
  assert.equal(enchantedPick.name, 'diamond_pickaxe');
  const raw = JSON.stringify(enchantedPick);
  assert.ok(raw.includes('探钻石') || raw.includes('imprint_spell'), `Lore/PDC missing from client ItemStack: ${raw}`);
  assert.ok(bot.inventory.items().filter((item) => item.name === 'lapis_lazuli')
    .reduce((sum, item) => sum + item.count, 0) === 2, 'Imprint should cost one lapis');
  assert.equal(bot.experience.level, 9, 'Imprint should cost three XP levels');
  bot.setControlState('sneak', true);
  bot.activateItem();
  await sleep(1100);
  bot.setControlState('sneak', false);
  assert.ok(chats.some((line) => line.includes('探矿术找到钻石矿（范围 32 格')), `Imprinted range: ${chats}`);
  assert.ok(bars.some((bar) => JSON.stringify(bar).includes('钻石矿')), 'Client needs a real bossbar');
  rcon(`skills skill setlevel ${username} mining 25`);
  await sleep(200);
  bot.chat('/mycli status');
  await sleep(350);
  assert.ok(chats.some((line) => line.includes('挖矿等级 25') && line.includes('探矿 42 格')),
    `AuraSkills Mining must scale prospect range: ${chats.slice(-8)}`);
  const sword = bot.inventory.items().find((item) => item.name === 'iron_sword');
  assert.ok(sword);
  await bot.equip(sword, 'hand');
  const menuOpened = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.setControlState('sneak', true);
  bot.activateBlock(bot.blockAt(new Vec3(1001, 150, 1000)));
  const menu = await Promise.race([menuOpened, sleep(3000).then(() => { throw new Error('Enchanting table imprint menu did not open'); })]);
  bot.setControlState('sneak', false);
  assert.equal(menu.slots[21]?.name, 'golden_apple', 'Controller menu must expose self-heal');
  await bot.clickWindow(21, 0, 0);
  await sleep(450);
  assert.ok(chats.some((line) => line.includes('已给手持物品刻印 治疗自己')), `Sword imprint: ${chats}`);
  assert.ok(JSON.stringify(bot.heldItem).includes('imprint_spell'), 'Sword PDC must reach the client');
  rcon(`minecraft:damage ${username} 8`);
  await sleep(200);
  const injured = bot.health;
  bot.setControlState('sneak', true);
  await sleep(350);
  bot.activateBlock(bot.blockAt(new Vec3(1000, 149, 1000)));
  await sleep(800);
  bot.setControlState('sneak', false);
  assert.ok(bot.health >= injured + 4, `Sword must cast self-heal: ${injured} -> ${bot.health}; ${chats.slice(-6)}`);
  assert.equal(errors.length, 0, `Client errors: ${errors}`);
  console.log(JSON.stringify({ verdict: 'PASS', xp: bot.experience.level, lapis: 1,
    oreRange: 32, healed: `${injured}->${bot.health}`, bars: bars.length }));
} finally {
  bot.quit();
  rcon('minecraft:gamerule naturalRegeneration true');
}
