// Stage 25566: newly assigned and existing jobs open real merchant menus
// over the same Mineflayer 1.20.6 protocol used by Agents.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (test, label, timeout = 12000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 200) {
    if (test()) return;
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
};
const username = `VillTrade${String(Date.now()).slice(-5)}`;
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
  username, auth: 'offline', version: '1.20.6' });
const errors = [];
bot.on('error', (error) => errors.push(error.message));
bot.on('kicked', (reason) => errors.push(JSON.stringify(reason)));

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  bot.setQuickBarSlot(8); // Starter backpack in slot 1 intercepts use.
  rcon('minecraft:time set day');
  try {
    rcon('minecraft:execute positioned -543 67 -439 as @e[type=minecraft:villager,distance=..9] run minecraft:tp @s -580 67 -439');
  } catch {
    // RCON on this server sends no body when no villager matched.
  }
  rcon(`minecraft:tp ${username} -542 67 -439`);
  const cases = [
    { id: 'unemployed', nbt: 'VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}', expected: /profession: "minecraft:(?!none|nitwit)[a-z_]+"/ },
    { id: 'butcher', nbt: 'VillagerData:{profession:"minecraft:butcher",level:1,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:porkchop",count:10},sell:{id:"minecraft:emerald",count:1},maxUses:16},{buy:{id:"minecraft:emerald",count:2},sell:{id:"minecraft:rabbit_stew",count:1},maxUses:16}]}', expected: /profession: "minecraft:butcher"/ },
    { id: 'librarian', nbt: 'VillagerData:{profession:"minecraft:librarian",level:1,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:paper",count:24},sell:{id:"minecraft:emerald",count:1},maxUses:16}]}', expected: /profession: "minecraft:librarian"/ },
  ];
  const menus = [];
  for (const testCase of cases) {
    const tag = `afu_qa_${testCase.id}`;
    rcon(`minecraft:summon minecraft:villager -543 67 -439 {Tags:["${tag}"],NoAI:1b,${testCase.nbt}}`);
    await until(() => testCase.expected.test(rcon(`minecraft:data get entity @e[tag=${tag},limit=1] VillagerData`))
      && !/Found no elements/.test(rcon(`minecraft:data get entity @e[tag=${tag},limit=1] Offers.Recipes[0].buy`)), `${testCase.id} trade ready`);
    await until(() => bot.nearestEntity((entity) => entity.name === 'villager'
      && entity.position.distanceTo(bot.entity.position) < 3), `${testCase.id} tracked`);
    const villager = bot.nearestEntity((entity) => entity.name === 'villager'
      && entity.position.distanceTo(bot.entity.position) < 3);
    const menu = await bot.openVillager(villager);
    assert.ok(menu.trades.length >= 1, `${testCase.id} has no offers`);
    assert.ok(menu.trades.every((trade) => trade.maximumNbTradeUses >= 1024));
    for (const trade of menu.trades) {
      for (const input of trade.inputs) {
        assert.ok(input.count <= (input.name === 'emerald' ? 16 : 24),
          `${testCase.id} has an expensive ${input.name} trade: ${input.count}`);
      }
    }
    menus.push({ type: testCase.id, offers: menu.trades.length,
      first: `${menu.trades[0].inputItem1.name} ${menu.trades[0].realPrice} -> ${menu.trades[0].outputItem.name}` });
    bot.closeWindow(menu);
    rcon(`minecraft:tp @e[tag=${tag}] -580 67 -439`);
    await sleep(300);
  }
  assert.deepEqual(errors, []);
  const report = rcon('mycli admin villagers');
  assert.match(report, /无职业=0，无交易=0/);
  const maxEmeraldCost = Number(report.match(/最高绿宝石价格=(\d+)/)?.[1]);
  assert.ok(maxEmeraldCost <= 16, `Highest emerald cost is ${maxEmeraldCost}`);
  console.log(JSON.stringify({ verdict: 'PASS', menus }));
} catch (error) {
  console.error(JSON.stringify({ verdict: 'FAIL', message: error.message, errors }));
  process.exitCode = 1;
} finally {
  bot.quit();
  process.exit(process.exitCode || 0);
}
