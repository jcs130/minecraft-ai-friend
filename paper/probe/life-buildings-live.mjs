import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node', ['E:/MC/probe/rcon.mjs', command], {encoding:'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, what) {
  for (let i = 0; i < 100; i++) {
    const found = check();
    if (found) return found;
    await sleep(100);
  }
  throw new Error(`timeout: ${what}`);
}
const expected = [
  ['farmer_harvest','farmer',-607,72,-499],
  ['gourmet_bread','butcher',-603,72,-499],
  ['angler_catch','fisherman',-622,71,-471],
  ['trader_supply','cartographer',-618,71,-471],
  ['builder_home','mason',-547,69,-463],
  ['tinkerer_light','toolsmith',-543,69,-463],
  ['author_story','librarian',-593,68,-451],
];
const username = `LifeQA${Date.now().toString(36).slice(-5)}`;
const bot = mineflayer.createBot({host:'127.0.0.1',port:25565,username,auth:'offline',version:'1.20.6'});
const life = [], protection = [];
bot._client.on('custom_payload', packet => {
  if (!['mcagent:life','mcagent:protection'].includes(packet.channel)) return;
  const data = JSON.parse(Buffer.from(packet.data).toString('utf8'));
  (packet.channel === 'mcagent:life' ? life : protection).push(data);
});
try {
  await new Promise((resolve,reject) => {
    bot.once('spawn',resolve); bot.once('error',reject); bot.once('kicked',reject);
  });
  bot.setQuickBarSlot(8);
  bot.chat('/mycli life locations');
  const packet = await until(() => life.find(item => item.kind === 'locations'), 'private locations');
  assert.equal(packet.npcs.length,7);
  for (const [id,profession,x,y,z] of expected) {
    const item = packet.npcs.find(npc => npc.contractId === id);
    assert.ok(item, id);
    assert.deepEqual([item.profession,item.x,item.y,item.z],[profession,x,y,z]);
    const actual = rcon(`minecraft:execute positioned ${x} ${y} ${z} run minecraft:data get entity @e[type=minecraft:villager,distance=..1,limit=1] VillagerData.profession`);
    assert.match(actual,new RegExp(`minecraft:${profession}`));
  }
  bot.chat('/mycli life menu');
  await until(() => bot.currentWindow?.slots[24]?.name === 'compass', 'life menu');
  await bot.clickWindow(24,0,0);
  await until(() => bot.currentWindow?.slots[10]?.name === 'hay_block', 'four hall menu');
  for (const slot of [10,12,14,16]) assert.notEqual(bot.currentWindow.slots[slot]?.name,'barrier');
  bot.closeWindow(bot.currentWindow);
  bot.chat('/mycli life visit library');
  await until(() => Math.abs(bot.entity.position.x + 592.5) < 3 && Math.abs(bot.entity.position.z + 444.5) < 3,
    'library teleport');
  rcon(`minecraft:tp ${username} -593.5 68 -448.5`);
  const entity = await until(() => Object.values(bot.entities).find(e => e.name === 'villager'
    && Math.abs(e.position.x + 592.5) < 1 && Math.abs(e.position.z + 450.5) < 1), 'story host visible');
  bot.activateEntity(entity);
  await until(() => bot.currentWindow?.slots[7]?.name === 'emerald_block', 'story host menu');
  bot.closeWindow(bot.currentWindow);
  bot.chat('/mycli protect break -597 68 -451');
  await until(() => protection.find(item => item.status === 'deny' && item.reason === 'life_guild_building'),
    'structure protection');
  console.log('PASS live life guilds: seven hosts, four menus, story host, visit and private protection');
} finally {
  bot.quit();
}
