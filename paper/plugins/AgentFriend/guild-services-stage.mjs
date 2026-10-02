// Against isolated Paper 25566 after `mycli admin buildservices`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const connect = async prefix => {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username: `${prefix}${String(Date.now()).slice(-7)}`, auth: 'offline', version: '1.20.6' });
  const messages = [];
  bot.on('messagestr', text => messages.push(text));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  bot.setQuickBarSlot(8);
  return { bot, messages };
};
async function until(test, label, timeout = 10000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    const result = test();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function teleport(client, x, y, z) {
  rcon(`minecraft:tp ${client.bot.username} ${x} ${y} ${z}`);
  await until(() => client.bot.entity.position.distanceTo(new Vec3(x, y, z)) < 2, 'teleport');
  await client.bot.waitForChunksToLoad();
}
async function ask(client, command, pattern) {
  client.messages.length = 0;
  client.bot.chat(command);
  return until(() => client.messages.join('\n').match(pattern)?.[0], command);
}

const a = await connect('GuildA');
const b = await connect('GuildB');
try {
  assert.match(await ask(a, '/mycli guild shared', /MC_GUILD_SHARED id=misc.*slots=54/), /scope=public/);
  assert.match(await ask(a, '/mycli guild trader', /MC_GUILD_TRADER .*x=-493 y=67 z=-497 scope=public/), /scope=public/);
  await teleport(a, -475.5, 67, -493.5);
  await teleport(b, -475.5, 67, -493.5);
  for (const z of [-495, -493, -491, -489]) {
    const block = a.bot.blockAt(new Vec3(-473, 67, z));
    assert.equal(block?.name, 'chest');
    const container = await a.bot.openContainer(block);
    assert.equal(container.inventoryStart, 54, `row ${z} should be a double chest`);
    a.bot.closeWindow(container);
  }
  rcon(`minecraft:give ${a.bot.username} minecraft:iron_sword 1`);
  await until(() => a.bot.inventory.items().some(item => item.name === 'iron_sword'), 'sword delivered');
  const swordId = a.bot.registry.itemsByName.iron_sword.id;
  let chest = await a.bot.openContainer(a.bot.blockAt(new Vec3(-473, 67, -495)));
  await chest.deposit(swordId, null, 1);
  assert.equal(chest.containerItems().filter(item => item.name === 'iron_sword').length, 1);
  a.bot.closeWindow(chest);
  chest = await b.bot.openContainer(b.bot.blockAt(new Vec3(-472, 67, -495)));
  assert.equal(chest.containerItems().filter(item => item.name === 'iron_sword').length, 1,
    'other half and other player see the donated sword');
  await chest.withdraw(swordId, null, 1);
  assert.equal(chest.containerItems().filter(item => item.name === 'iron_sword').length, 0);
  b.bot.closeWindow(chest);
  const protectedBlock = a.bot.blockAt(new Vec3(-473, 67, -495));
  await a.bot.dig(protectedBlock).catch(() => {});
  await sleep(300);
  assert.match(rcon('minecraft:execute if block -473 67 -495 minecraft:chest'), /Test passed|测试通过/);

  await teleport(a, -491.5, 67, -498.5);
  const receptionist = await until(() => a.bot.nearestEntity(entity => entity.name === 'villager'
    && entity.position.distanceTo(a.bot.entity.position) < 5), 'guild receptionist');
  const menuOpen = new Promise(resolve => a.bot.once('windowOpen', resolve));
  a.bot.activateEntity(receptionist);
  const menu = await Promise.race([menuOpen, sleep(5000).then(() => { throw Error('NPC menu not opened'); })]);
  assert.equal(menu.inventoryStart, 27);
  assert.equal(menu.slots[12]?.name, 'emerald');
  assert.equal(menu.slots[14]?.name, 'hopper');
  const shopOpen = new Promise(resolve => a.bot.once('windowOpen', resolve));
  await a.bot.clickWindow(12, 0, 0);
  const shop = await Promise.race([shopOpen, sleep(5000).then(() => { throw Error('shop not opened'); })]);
  assert.equal(shop.inventoryStart, 27);
  assert.equal(shop.slots[0]?.name, 'iron_helmet');
  a.bot.closeWindow(shop);
  let nextOpen = new Promise(resolve => a.bot.once('windowOpen', resolve));
  a.bot.activateEntity(receptionist);
  await nextOpen;
  nextOpen = new Promise(resolve => a.bot.once('windowOpen', resolve));
  await a.bot.clickWindow(14, 0, 0);
  const recycle = await Promise.race([nextOpen, sleep(5000).then(() => { throw Error('recycle not opened'); })]);
  assert.equal(recycle.inventoryStart, 54);
  a.bot.closeWindow(recycle);
  nextOpen = new Promise(resolve => a.bot.once('windowOpen', resolve));
  a.bot.activateEntity(receptionist);
  await nextOpen;
  nextOpen = new Promise(resolve => a.bot.once('windowOpen', resolve));
  let tradeCount = 0;
  a.bot._client.once('trade_list', packet => { tradeCount = packet.trades?.length ?? 0; });
  await a.bot.clickWindow(22, 0, 0);
  const merchant = await Promise.race([nextOpen, sleep(5000).then(() => { throw Error('merchant not opened'); })]);
  await sleep(300);
  assert.equal(merchant.type, 'minecraft:merchant');
  assert.ok(tradeCount >= 6, 'NPC can also open vanilla emerald trades');
  a.bot.closeWindow(merchant);
  assert.match(rcon('mycli admin buildservices'), /拒绝覆盖/);
  console.log(JSON.stringify({ verdict: 'PASS', rows: 4, slotsPerRow: 54,
    donatedAndWithdrawn: 'iron_sword', protectedChest: true,
    receptionist: true, shop: true, recycle: true, vanillaMerchant: true }, null, 2));
} finally {
  a.bot.quit(); b.bot.quit();
}
