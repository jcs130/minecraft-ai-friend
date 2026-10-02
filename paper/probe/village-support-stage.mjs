import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node', [
  'E:/MC/staging/life-guild-20261003/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label, ms = 12_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
};
const name = `Village${Date.now().toString(36).slice(-6)}`;
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567,
  username: name, auth: 'offline', version: '1.20.6' });
const events = [];
const chat = [];
bot.on('messagestr', message => chat.push(message));
bot._client.on('custom_payload', packet => {
  if (packet.channel === 'mcagent:village' || packet.channel === 'mcagent:life')
    events.push({ channel: packet.channel, ...JSON.parse(Buffer.from(packet.data).toString('utf8')) });
});

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  bot.setQuickBarSlot(8);
  bot.chat('/mycli life accept trader_supply');
  await until(() => events.some(e => e.channel === 'mcagent:life' && e.kind === 'accept'
    && e.id === 'trader_supply'), 'trade quest accepted');
  rcon(`minecraft:tp ${name} -640 80 -450`);
  await until(() => Math.abs(bot.entity.position.x + 640) < 3, 'at stage village edge');
  rcon('minecraft:fill -648 79 -458 -632 79 -442 minecraft:stone');
  rcon('minecraft:fill -648 80 -458 -632 84 -442 minecraft:air');
  rcon('minecraft:execute positioned -640 80 -450 run minecraft:kill @e[type=minecraft:villager,distance=..15]');
  rcon('minecraft:execute positioned -640 80 -450 run minecraft:kill @e[tag=test_raider,distance=..15]');
  await sleep(2_500);
  rcon(`minecraft:give ${name} minecraft:wheat 10`);
  rcon(`minecraft:give ${name} minecraft:cod 10`);

  for (const [profession, input] of [['farmer', 'wheat'], ['fisherman', 'cod']]) {
    const tag = `test_${profession}`;
    const beforeIds = new Set(Object.values(bot.entities).map(entity => entity.id));
    rcon(`minecraft:execute at ${name} run minecraft:summon minecraft:villager ~1 ~ ~1 {Tags:["${tag}"],NoAI:1b,VillagerData:{profession:"minecraft:${profession}",level:1,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:${input}",count:5},sell:{id:"minecraft:emerald",count:1},maxUses:16}]}}`);
    await until(() => bot.nearestEntity(e => e.name === 'villager' && !beforeIds.has(e.id)
      && e.position.distanceTo(bot.entity.position) < 4), `${profession} visible`);
    const villager = bot.nearestEntity(e => e.name === 'villager' && !beforeIds.has(e.id)
      && e.position.distanceTo(bot.entity.position) < 4);
    const menu = await bot.openVillager(villager);
    assert.equal(menu.trades[0].outputItem.name, 'emerald');
    await menu.trade(0, 1);
    if (profession === 'farmer') {
      await menu.trade(0, 1);
      await sleep(300);
      assert.ok(!events.some(e => e.channel === 'mcagent:life' && e.kind === 'progress'
        && e.id === 'trader_supply' && e.progress === 2), 'same profession counted twice');
    }
    bot.closeWindow(menu);
    await until(() => events.some(e => e.channel === 'mcagent:life'
      && e.kind === 'progress' && e.id === 'trader_supply'
      && e.lastProfession === profession), `${profession} credited`);
    assert.ok(events.findLast(e => e.channel === 'mcagent:life' && e.kind === 'progress')
      .seenProfessions.includes(profession));
    rcon(`minecraft:tp @e[tag=${tag}] -700 80 -450`);
    await sleep(300);
  }
  assert.ok(events.some(e => e.channel === 'mcagent:life' && e.kind === 'progress'
    && e.id === 'trader_supply' && e.progress === 2));
  bot.chat('/mycli life claim');
  await until(() => events.some(e => e.channel === 'mcagent:life' && e.kind === 'claim'
    && e.id === 'trader_supply' && e.success), 'trade claim');

  bot.chat('/mycli village villagers');
  await until(() => events.some(e => e.channel === 'mcagent:village'
    && e.kind === 'villagers'), 'village list');
  bot.chat('/mycli village threat');
  await until(() => events.some(e => e.channel === 'mcagent:village'
    && e.kind === 'status' && !e.active), 'initial clear');

  const alertCount = events.filter(e => e.channel === 'mcagent:village' && e.kind === 'alert').length;
  const chatAlertCount = chat.filter(line => line.includes('村庄外围出现掠夺者')).length;
  rcon('minecraft:summon minecraft:pillager -638 80 -450 {Tags:["test_raider"],NoAI:1b,Health:8f}');
  bot.chat('/mycli village threat');
  await until(() => events.filter(e => e.channel === 'mcagent:village'
    && e.kind === 'alert' && e.active && e.source === 'patrol'
    && e.position?.x === -638).length > alertCount, 'private raid alert', 8_000);
  assert.equal(chat.filter(line => line.includes('村庄外围出现掠夺者')).length - chatAlertCount, 1);
  const raider = bot.nearestEntity(e => e.name === 'pillager');
  assert.ok(raider, 'raider visible');
  rcon(`minecraft:give ${name} minecraft:iron_sword 1`);
  await until(() => bot.inventory.items().some(item => item.name === 'iron_sword'), 'weapon received');
  await bot.equip(bot.inventory.items().find(item => item.name === 'iron_sword'), 'hand');
  for (let n = 0; n < 5 && !events.some(e => e.kind === 'defense'); n++) {
    bot.attack(raider);
    await sleep(800);
  }
  await until(() => events.some(e => e.channel === 'mcagent:village'
    && e.kind === 'defense' && e.dayKills >= 1 && e.rewardedToday), 'defense reward');
  await until(() => events.some(e => e.channel === 'mcagent:village'
    && e.kind === 'clear'), 'clear alert');
  console.log('PASS village support: two real profession trades, claim, profession list, one alert, defense reward and clear');
} catch (error) {
  console.error(JSON.stringify({ error: error.message, chat: chat.slice(-12), events: events.slice(-10) }, null, 2));
  throw error;
} finally {
  bot.quit();
}
