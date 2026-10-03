import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node', [
  'E:/MC/staging/life-buildings-20261003/rcon-stage.mjs', command,
], {encoding:'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (check()) return check();
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
}
const hosts = [
  {id:'farmer_harvest', profession:'farmer', x:-607, y:72, z:-499},
  {id:'gourmet_bread', profession:'butcher', x:-603, y:72, z:-499},
  {id:'angler_catch', profession:'fisherman', x:-622, y:71, z:-471},
  {id:'trader_supply', profession:'cartographer', x:-618, y:71, z:-471},
  {id:'builder_home', profession:'mason', x:-547, y:69, z:-463},
  {id:'tinkerer_light', profession:'toolsmith', x:-543, y:69, z:-463},
  {id:'author_story', profession:'librarian', x:-566, y:68, z:-447},
];
const username = `LifeSite${Date.now().toString(36).slice(-5)}`;
const bot = mineflayer.createBot({host:'127.0.0.1',port:25567,username,auth:'offline',version:'1.20.6'});
const life = [];
const protections = [];
const offers = [];
bot._client.on('trade_list', packet => offers.push(packet));
bot._client.on('custom_payload', packet => {
  if (!['mcagent:life','mcagent:protection'].includes(packet.channel)) return;
  const data = JSON.parse(Buffer.from(packet.data).toString('utf8'));
  (packet.channel === 'mcagent:life' ? life : protections).push(data);
});
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  bot.setQuickBarSlot(8);
  await sleep(200);
  bot.chat('/mycli life locations');
  const locations = await until(() => life.find(item => item.kind === 'locations'), 'locations payload');
  assert.equal(locations.npcs.length, 7);
  assert.deepEqual(new Set(locations.npcs.map(item => item.contractId)),
    new Set(hosts.map(item => item.id)));
  bot.chat('/mycli life menu');
  const lifeMenu = await until(() => bot.currentWindow?.slots[24]?.name === 'compass'
    ? bot.currentWindow : null, 'life menu with map');
  await bot.clickWindow(24,0,0);
  const mapMenu = await until(() => bot.currentWindow !== lifeMenu && bot.currentWindow?.slots[10]?.name === 'hay_block'
    ? bot.currentWindow : null, 'four building map');
  for (const slot of [10,12,14,16]) assert.ok(mapMenu.slots[slot] && mapMenu.slots[slot].name !== 'barrier');
  await bot.clickWindow(10,0,0);
  await until(() => Math.abs(bot.entity.position.x + 604.5) < 3 && Math.abs(bot.entity.position.z + 492.5) < 3,
    'visit harvest entrance');
  if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  for (const host of hosts) {
    const datum = locations.npcs.find(item => item.contractId === host.id);
    assert.equal(datum.profession, host.profession);
    assert.deepEqual([datum.x,datum.y,datum.z],[host.x,host.y,host.z]);
    rcon(`minecraft:tp ${username} ${host.x + .5} ${host.y} ${host.z + 2.5}`);
    const entity = await until(() => Object.values(bot.entities).find(e => e.name === 'villager'
      && Math.abs(e.position.x - host.x - .5) < .8
      && Math.abs(e.position.z - host.z - .5) < .8),`${host.id} visible`);
    const actual = rcon(`minecraft:execute positioned ${host.x} ${host.y} ${host.z} run minecraft:data get entity @e[type=minecraft:villager,distance=..1,limit=1] VillagerData.profession`);
    assert.match(actual,new RegExp(`minecraft:${host.profession}`),host.id);
    const menu = await new Promise((resolve,reject) => {
      const timer=setTimeout(() => reject(new Error(`menu timeout ${host.id}`)),6000);
      bot.once('windowOpen',window => {clearTimeout(timer);resolve(window)});
      bot.activateEntity(entity);
    });
    await until(() => menu.slots[1]?.name, `${host.id} menu content`);
    assert.equal(menu.slots[1]?.name,'book');
    assert.equal(menu.slots[3]?.name,'writable_book');
    assert.equal(menu.slots[5]?.name,'emerald');
    assert.equal(menu.slots[7]?.name,'emerald_block');
    if (host.id === 'farmer_harvest') {
      await bot.clickWindow(3,0,0);
      await until(() => life.some(item => item.kind === 'accept' && item.id === host.id && item.success),
        'NPC quest accepted');
      const next = new Promise((resolve,reject) => {
        const timer=setTimeout(() => reject(new Error('native merchant timeout')),6000);
        bot.once('windowOpen',window => {clearTimeout(timer);resolve(window)});
      });
      bot.activateEntity(entity);
      await next;
    }
    const before = offers.length;
    await bot.clickWindow(7,0,0);
    await until(() => bot.currentWindow?.type === 'minecraft:merchant', `${host.id} native merchant open`);
    await until(() => offers.length > before, `${host.id} native trade list`);
    assert.ok(offers.at(-1).trades?.length > 0, `${host.id} has real vanilla trades`);
    assert.match(rcon('mycli admin villagers'), /最高绿宝石价格=(?:[0-9]|1[0-6])(?:\D|$)/,
      `${host.id} prices stay at most 16 emeralds`);
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  }
  rcon(`minecraft:tp ${username} -605.5 72 -494.5`);
  await sleep(600);
  bot.chat('/mycli protect break -609 72 -499');
  await until(() => protections.some(item => item.status === 'deny'
    && item.reason === 'life_guild_building'), 'building protection result');
  console.log('PASS life buildings: 4 structures, 7 profession NPCs, native menus/trade, private locations and protection');
} finally {
  bot.quit();
}
