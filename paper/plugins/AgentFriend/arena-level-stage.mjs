import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const [lowName, highName] = process.argv.slice(2);
if (!lowName || !highName) throw new Error('Provide the two names prepared in stage config');
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding:'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (test, label, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = test();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}; positions=${JSON.stringify(players.map(({bot}) =>
    bot.entity?.position))}; recent=${JSON.stringify(players.map(({lines}) => lines.slice(-8)))}`);
};
const players = [lowName, highName].map(username => {
  const bot = mineflayer.createBot({host:'127.0.0.1', port:25566,
    username, auth:'offline', version:'1.20.6'});
  const lines = [];
  bot.on('messagestr', line => lines.push(line));
  return {bot, lines};
});
const [low, high] = players;
try {
  await Promise.all(players.map(({bot}) => new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  })));
  for (const {bot} of players) rcon(`minecraft:tp ${bot.username} -589.5 91 -304.5`);
  await until(() => players.every(({bot}) => bot.entity.position.y > 85), 'lobby');
  high.bot.chat('/mycli arena difficulty auto');
  await until(() => high.lines.some(line => line.includes('selected=apocalypse mode=auto recommended=apocalypse')),
    'platinum switched to auto');
  for (const {bot} of players) bot.chat('/mycli arena difficulty list');
  await until(() => low.lines.some(line => line.includes('selected=normal mode=auto recommended=normal adventurerRank=0')),
    'bronze automatic normal');
  await until(() => high.lines.some(line => line.includes('selected=apocalypse mode=auto recommended=apocalypse adventurerRank=4')),
    'platinum automatic apocalypse');
  high.bot.chat('/mycli arena difficulty normal');
  await until(() => high.lines.some(line => line.includes('selected=normal mode=manual recommended=apocalypse')),
    'high rank manual override');
  low.bot.chat('/mycli arena start');
  await until(() => players.every(({bot}) => bot.entity.position.y < 75), 'both entered');
  for (const {bot} of players)
    rcon(`minecraft:effect give ${bot.username} minecraft:resistance 180 4 true`);
  await until(() => rcon('mycli admin dungeonaudit').includes('MC_DUNGEON_AUDIT_END floor=1 count=3'),
    'first floor spawned');
  rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  const lowScale = await until(() => low.lines.find(line => line.includes('category=level_scaling')),
    'bronze reward');
  const highScale = await until(() => high.lines.find(line => line.includes('category=level_scaling')),
    'platinum reward');
  assert.match(lowScale, /recommendedDifficulty=normal runDifficulty=normal rewardPercent=100 firstClear=true/);
  assert.match(highScale, /recommendedDifficulty=apocalypse runDifficulty=normal rewardPercent=30 firstClear=false repeatedGear=false/);
  await until(() => low.lines.some(line => line.includes('category=supply')), 'bronze supplies');
  assert.equal(high.lines.filter(line => line.includes('category=supply')).length, 0,
    'repeat under-tier reward must not create supplies');
  if (process.argv.includes('--deep')) {
    for (const [floor, y] of [[2,57],[3,45],[4,33]]) {
      await until(() => players.every(({bot}) => Math.abs(bot.entity.position.y - y) < 2),
        `floor ${floor} arrival`, 25000);
      await until(() => new RegExp(`MC_DUNGEON_AUDIT_END floor=${floor} count=[1-9]`)
        .test(rcon('mycli admin dungeonaudit')), `floor ${floor} wave`);
      rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
      await until(() => players.every(({lines}) => lines.some(line =>
        line.includes(`MC_DUNGEON_LOOT floor=${floor} category=level_scaling`))),
        `floor ${floor} rewards`);
    }
    assert.ok(low.lines.some(line => line.includes('floor=4 category=milestone')),
      'first-clear bronze player keeps milestone gear');
    assert.equal(high.lines.filter(line => line.includes('floor=4 category=milestone')).length, 0,
      'repeat platinum player receives no low-tier milestone gear');
  }
  const state = rcon('mycli admin dungeonaudit');
  assert.match(state, process.argv.includes('--deep') ? /floor=4 active=true/ : /floor=1 active=true/);
  console.log(JSON.stringify({verdict:'PASS', lowScale, highScale,
    lowSupplies:low.lines.filter(line => line.includes('category=supply')).length,
    highSupplies:high.lines.filter(line => line.includes('category=supply')).length,
    deep:process.argv.includes('--deep')}));
} finally {
  for (const {bot} of players) bot.quit();
}
