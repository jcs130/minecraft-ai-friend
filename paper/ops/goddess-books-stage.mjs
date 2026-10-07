// Isolated Paper 1.20.6 only; never connects to the production port.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import net from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire('E:/MC/probe/package.json');
const mineflayer = require('mineflayer');
const Vec3 = require('vec3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const receipts = [];
async function command(text) {
  const password = readFileSync('E:/MC/staging/life-buildings-20261003/server.properties', 'utf8').match(/^rcon\.password=(.*)$/m)[1].trim();
  const packet = (id, type, body) => {
    const payload = Buffer.from(body), buffer = Buffer.alloc(payload.length + 14);
    buffer.writeInt32LE(payload.length + 10, 0); buffer.writeInt32LE(id, 4); buffer.writeInt32LE(type, 8);
    payload.copy(buffer, 12); return buffer;
  };
  const result = await new Promise((resolve, reject) => {
    const socket = net.connect(25587, '127.0.0.1');
    let buffer = Buffer.alloc(0), answer = '', settle;
    const finish = error => { clearTimeout(timer); clearTimeout(settle); socket.destroy(); error ? reject(error) : resolve(answer); };
    const timer = setTimeout(() => finish(new Error('Stage RCON timeout')), 10000);
    socket.on('error', finish);
    socket.on('connect', () => socket.write(packet(1, 3, password)));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
        const length = buffer.readInt32LE(0), id = buffer.readInt32LE(4), type = buffer.readInt32LE(8);
        const body = buffer.subarray(12, length + 2).toString('utf8'); buffer = buffer.subarray(length + 4);
        if (id === -1) return finish(new Error('Stage RCON authentication failed'));
        if (id === 1 && type === 2) socket.write(packet(2, 2, text));
        else if (id === 2 && type === 0) { answer += body; clearTimeout(settle); settle = setTimeout(() => finish(), 100); }
      }
    });
  });
  receipts.push({ command: text, result });
  return result;
}
const name = 'BookAudit';
const badBook = 'minecraft:enchanted_book[enchantments={levels:{"minecraft:mending":1}},custom_data={book_audit:"keep"},custom_name=\'"Audit Book"\',repair_cost=1]';
const repair = `minecraft:execute if items entity ${name} hotbar.1 minecraft:enchanted_book[enchantments={levels:{"minecraft:mending":1}},stored_enchantments={levels:{}}] run minecraft:item modify entity ${name} hotbar.1 {function:"minecraft:set_components",components:{"minecraft:stored_enchantments":{levels:{"minecraft:mending":1}},"minecraft:enchantments":{levels:{}}}}`;
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567, username: name, auth: 'offline', version: '1.20.6' });
bot.on('error', error => console.error(error.message));
let window;
async function anvilResult() {
  bot.setQuickBarSlot(0);
  bot.setControlState('sneak', false);
  await sleep(150);
  assert.equal(bot.heldItem?.name, 'diamond_sword', 'avoid activating starter menu items');
  window = await bot.openBlock(bot.blockAt(new Vec3(9001, 301, 9000)));
  assert.equal(window.type, 'minecraft:anvil');
  for (const [itemName, targetSlot] of [['diamond_sword', 0], ['enchanted_book', 1]]) {
    const item = window.slots.find((item, slot) => slot >= window.inventoryStart && item?.name === itemName);
    assert.ok(item, `${itemName} missing from anvil inventory`);
    await bot.clickWindow(item.slot, 0, 0);
    await bot.clickWindow(targetSlot, 0, 0);
  }
  bot._client.write('name_item', { name: '' });
  await sleep(700);
  return window.slots[2];
}
let passed = false;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Stage bot spawn timeout')), 20000);
    bot.once('spawn', () => { clearTimeout(timeout); resolve(); });
    bot.once('error', reject);
  });
  await command('minecraft:gamerule sendCommandFeedback true');
  await command(`minecraft:clear ${name}`);
  await command(`minecraft:gamemode spectator ${name}`);
  await command(`minecraft:tp ${name} 9000.5 301 9000.5`);
  await bot.waitForChunksToLoad();
  assert.match(await command('minecraft:fill 8999 300 8999 9002 300 9002 minecraft:stone'), /(?:Successfully filled|No blocks were filled)/);
  assert.match(await command('minecraft:setblock 9001 301 9000 minecraft:anvil'), /(?:Changed the block|Could not set)/);
  await command(`minecraft:gamemode survival ${name}`);
  await command(`minecraft:experience set ${name} 30 levels`);
  await command(`minecraft:item replace entity ${name} hotbar.0 with minecraft:diamond_sword 1`);
  await command(`minecraft:item replace entity ${name} hotbar.1 with ${badBook} 1`);
  await sleep(1500);
  assert.equal(await anvilResult(), null, 'equipment enchantments must not produce a sword with Mending');
  window.close(); window = null;
  await sleep(500);
  await command(`minecraft:clear ${name}`);
  await command(`minecraft:item replace entity ${name} hotbar.0 with minecraft:diamond_sword 1`);
  await command(`minecraft:item replace entity ${name} hotbar.1 with ${badBook} 1`);
  assert.match(await command(repair), /Replaced a slot/);
  const path = `minecraft:data get entity ${name} Inventory[{Slot:1b}]`;
  assert.match(await command(`${path}.components."minecraft:stored_enchantments"`), /"minecraft:mending": 1/);
  assert.match(await command(`${path}.components."minecraft:custom_data"`), /book_audit: "keep"/);
  assert.match(await command(`${path}.components."minecraft:custom_name"`), /Audit Book/);
  assert.match(await command(`${path}.components."minecraft:repair_cost"`), /data: 1$/);
  assert.match(await command(`${path}.count`), /data: 1$/);
  assert.match(await command(`${path}.components."minecraft:enchantments"`), /Found no elements/);
  assert.doesNotMatch(await command(repair), /Replaced a slot/, 'repair must not apply twice');
  await sleep(500);
  const output = await anvilResult();
  assert.equal(output?.name, 'diamond_sword');
  await bot.putAway(2);
  window.close(); window = null;
  await sleep(500);
  assert.match(await command(`minecraft:data get entity ${name} Inventory[{id:"minecraft:diamond_sword"}].components."minecraft:enchantments"`), /"minecraft:mending": 1/);
  assert.ok(bot.experience.level < 30, 'survival anvil operation must consume XP');
  assert.match(await command(`minecraft:data get entity ${name} Inventory[{id:"minecraft:enchanted_book"}]`), /Found no elements/);
  passed = true;
  console.log(JSON.stringify({ passed, wrongBook: 'no anvil output', repairedBook: 'Mending sword crafted', xpRemaining: bot.experience.level, metadataPreserved: true, repeatedRepair: 'no change' }));
} finally {
  window?.close();
  bot.quit();
  writeFileSync('E:/MC/ops/repairs/goddess-books-20261006/stage-receipt.json', JSON.stringify({ passed, receipts }, null, 2));
  await sleep(500);
}
