// Isolated port 25566 protocol test for six expedition destinations and three new contracts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const username = `ExpQA${String(Date.now()).slice(-7)}`;
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username, auth: 'offline', version: '1.20.6',
});
const messages = [];
const errors = [];
bot.on('messagestr', (line) => messages.push(line));
bot.on('error', (error) => errors.push(error.message));
bot.on('kicked', (reason) => errors.push(JSON.stringify(reason)));
const ask = async (command, wait = 500) => {
  messages.length = 0;
  bot.chat(command);
  await sleep(wait);
  return messages.join('\n');
};
const until = async (test, label, timeout = 20000) => {
  for (let ms = 0; ms < timeout; ms += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`Timeout: ${label}; at=${bot.entity?.position}; chat=${messages.slice(-6).join(' | ')}`);
};
const sites = [
  { id: 'illager_camp', quest: 'camp_scout', x: -1072, z: -1120, ax: -1000, az: -1120 },
  { id: 'ruin_town', quest: 'lost_town', x: -1248, z: -1392, ax: -1176, az: -1404 },
  { id: 'bunker', quest: 'bunker_explorer', x: -1184, z: -1552, ax: -1112, az: -1552 },
];

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  rcon(`minecraft:gamemode creative ${username}`);
  assert.match(await ask('/mycli guild board'), /camp_scout[\s\S]*lost_town[\s\S]*bunker_explorer/);
  const boardOpen = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.chat('/mycli guild menu');
  const board = await boardOpen;
  assert.equal(board.slots.length >= 36, true);
  assert.equal(board.slots[22]?.name, 'crossbow');
  assert.equal(board.slots[23]?.name, 'map');
  assert.equal(board.slots[24]?.name, 'stone_bricks');
  bot.closeWindow(board);
  await sleep(150);

  const results = [];
  for (const site of sites) {
    assert.match(await ask(`/mycli guild accept ${site.quest}`), /已接公会委托/);
    assert.match(await ask(`/mycli guild travel ${site.id}`), /正在寻找/);
    await until(() => Math.abs(bot.entity.position.x - site.ax) <= 5
      && Math.abs(bot.entity.position.z - site.az) <= 5, `travel ${site.id}`);
    const at = bot.entity.position.clone();
    const floor = bot.blockAt(at.offset(0, -1, 0));
    const head = bot.blockAt(at.offset(0, 1, 0));
    assert.ok(floor && floor.boundingBox === 'block', `${site.id}: safe floor`);
    assert.ok(head && head.boundingBox !== 'block', `${site.id}: head room`);
    rcon(`minecraft:tp ${username} ${site.x} 120 ${site.z}`);
    await until(() => messages.some((line) => line.includes('已达成')), `complete ${site.quest}`);
    assert.match(await ask('/mycli guild claim'), /委托交付成功/);
    results.push({ site: site.id, landing: `${at}`, floor: floor.name });
  }
  assert.match(await ask('/mycli guild status'), /声望 28/);
  const rewardsOpen = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.chat('/mycli arena rewards');
  const rewards = await rewardsOpen;
  assert.equal(rewards.slots[0]?.name, 'emerald');
  assert.equal(rewards.slots[0]?.count, 13);
  assert.equal(rewards.slots[9]?.name, 'shield');
  assert.equal(rewards.slots[10]?.name, 'iron_sword');
  bot.closeWindow(rewards);
  await sleep(150);

  const skillsOpen = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.chat('/mycli menu');
  await skillsOpen;
  const placesOpen = new Promise((resolve) => bot.once('windowOpen', resolve));
  await bot.clickWindow(16, 0, 0);
  const places = await placesOpen;
  assert.equal(places.slots[10]?.name, 'bell', 'village waypoint is visible again');
  assert.equal(places.slots[11]?.name, 'cherry_sapling', 'cherry waypoint is visible again');
  assert.equal(places.slots[12]?.name, 'map', 'plains waypoint is visible again');
  assert.equal(places.slots[16]?.name, 'filled_map');
  const expeditionOpen = new Promise((resolve) => bot.once('windowOpen', resolve));
  await bot.clickWindow(16, 0, 0);
  const expeditions = await expeditionOpen;
  assert.deepEqual(expeditions.slots.slice(10, 16).map((item) => item?.name),
    ['bone', 'moss_block', 'chiseled_sandstone', 'crossbow', 'map', 'stone_bricks']);
  await bot.clickWindow(13, 0, 0);
  await until(() => Math.abs(bot.entity.position.x + 1000) <= 5, 'controller expedition menu travel');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', results, fame: 28, menu: 'six sites' }));
} finally {
  bot.quit();
}
