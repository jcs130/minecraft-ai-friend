// Real Mineflayer 1.20.6 contract against the isolated Paper server on 25566.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const name = `Bound${String(Date.now()).slice(-8)}`;
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command],
  { encoding: 'utf8', timeout: 10000 });
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
  username: name, auth: 'offline', version: '1.20.6' });
const messages = [];
bot.on('messagestr', message => messages.push(message));

try {
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); });
  await sleep(2500);
  rcon(`minecraft:give ${name} minecraft:diamond_chestplate 1`);
  await sleep(400);
  let plate = bot.inventory.items().find(item => item.name === 'diamond_chestplate');
  assert.ok(plate, 'Test chestplate did not reach owner');
  const bukkitSlot = plate.slot >= 36 ? plate.slot - 36 : plate.slot;
  const preview = rcon(`mycli admin bindgear ${name} ${bukkitSlot}`);
  assert.match(preview, /owner=none/);
  assert.match(rcon(`mycli admin bindgear ${name} ${bukkitSlot} apply`), /已绑定到/);
  const customData = rcon(`minecraft:data get entity ${name} Inventory[{Slot:${bukkitSlot}b}].components."minecraft:custom_data"`);
  assert.match(customData, /agentfriend:soulbound_owner/);
  await sleep(400);
  plate = bot.inventory.items().find(item => item.name === 'diamond_chestplate');
  assert.ok(plate, 'Binding removed chestplate');
  assert.ok(JSON.stringify(plate).includes('灵魂绑定'), 'Bound lore was not synced to vanilla client');
  await bot.tossStack(plate);
  await sleep(500);
  assert.ok(bot.inventory.items().some(item => item.name === 'diamond_chestplate'),
    'Bound chestplate was dropped');
  assert.ok(messages.some(message => message.includes('专属装备已绑定')),
    'Owner did not receive rejection notice');

  let chest = bot.blockAt(bot.entity.position.floored().offset(2, 0, 0));
  if (chest?.name !== 'chest') {
    rcon(`minecraft:execute at ${name} run setblock ~2 ~ ~ minecraft:chest`);
    await sleep(300);
    chest = bot.blockAt(bot.entity.position.floored().offset(2, 0, 0));
  }
  assert.equal(chest?.name, 'chest', 'Staging chest not found');
  const window = await bot.openChest(chest);
  const slot = window.slots.findIndex((item, index) => index >= window.inventoryStart
    && item?.name === 'diamond_chestplate');
  assert.ok(slot >= 0, 'Bound chestplate absent from open chest window');
  await bot.clickWindow(slot, 0, 1); // shift-click from player inventory into chest
  await sleep(400);
  assert.ok(window.slots.slice(window.inventoryStart).some(item => item?.name === 'diamond_chestplate'),
    'Bound chestplate left player inventory on shift-click');
  assert.ok(!window.slots.slice(0, window.inventoryStart).some(item => item?.name === 'diamond_chestplate'),
    'Bound chestplate entered shared chest');
  window.close();

  rcon(`minecraft:give ${name} minecraft:cobblestone 1`);
  await sleep(400);
  const ordinary = bot.inventory.items().find(item => item.name === 'cobblestone');
  assert.ok(ordinary, 'Ordinary item not received');
  await bot.tossStack(ordinary);
  await sleep(400);
  assert.ok(!bot.inventory.items().some(item => item.name === 'cobblestone'),
    'Ordinary item should still be droppable');

  plate = bot.inventory.items().find(item => item.name === 'diamond_chestplate');
  await bot.equip(plate, 'torso');
  await sleep(350);
  assert.equal(bot.inventory.slots[6]?.name, 'diamond_chestplate',
    'Owner cannot equip bound chestplate');
  rcon('minecraft:gamerule keepInventory false');
  try {
    const respawned = new Promise(resolve => bot.once('death', () => { bot.respawn(); resolve(); }));
    rcon(`minecraft:tp ${name} -589.5 91 -329.5`);
    await sleep(400);
    rcon(`minecraft:kill ${name}`);
    await respawned;
    await sleep(1300);
    assert.equal(bot.inventory.slots[6]?.name, 'diamond_chestplate',
      'Bound chestplate was lost on death when keepInventory=false');
  } finally {
    rcon('minecraft:gamerule keepInventory true');
  }
  console.log(`PASS ${name}: owner UUID, vanilla lore, drop/chest denied, ordinary drop, equip and death retention`);
} finally {
  bot.quit();
}
