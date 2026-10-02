// Isolated Paper 1.20.6 wire test: opt-in 1v1, outside damage gate,
// equal kit, result/rating, and original inventory restoration.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
const lines = new Map();

function connect(name) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username: name, auth: 'offline', version: '1.20.6' });
  lines.set(name, []);
  bot.on('messagestr', line => lines.get(name).push(line));
  bot.on('error', error => errors.push(name + ': ' + error.message));
  bot.on('kicked', reason => errors.push(name + ': kicked ' + JSON.stringify(reason)));
  return bot;
}
async function spawn(bot) {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
}
async function waitFor(check, label, ms = 10000) {
  for (let i = 0; i < ms / 100; i++) {
    if (errors.length) throw new Error(errors.join('\n'));
    if (check()) return;
    await sleep(100);
  }
  throw new Error('timeout ' + label + ': ' + JSON.stringify([...lines.values()].map(x => x.slice(-5))));
}
const count = (bot, name) => bot.inventory.items().filter(item => item.name === name)
  .reduce((total, item) => total + item.count, 0);
const lastState = bot => lines.get(bot.username).filter(line => line.startsWith('MC_PVP {')).at(-1);

const suffix = process.argv[2] || 'QA';
const alpha = 'PvPAlpha' + suffix, beta = 'PvPBeta' + suffix, guest = 'PvPGuest' + suffix;
const a = connect(alpha), b = connect(beta), outsider = connect(guest);
try {
  await Promise.all([spawn(a), spawn(b), spawn(outsider)]);
  a.loadPlugin(pathfinder);
  a.pathfinder.setMovements(new Movements(a));
  rcon('minecraft:give ' + alpha + ' minecraft:diamond 3');
  rcon('minecraft:give ' + beta + ' minecraft:emerald 2');
  await waitFor(() => count(a, 'diamond') === 3 && count(b, 'emerald') === 2, 'original items');
  a.chat('/mycli pvp lobby');
  outsider.chat('/mycli pvp lobby');
  await waitFor(() => a.entity.position.y > 160 && outsider.entity.position.y > 160, 'lobby teleports');
  const originalHealth = a.health;
  await sleep(300);
  outsider.attack(outsider.nearestEntity(entity => entity.username === alpha));
  await sleep(450);
  assert.equal(a.health, originalHealth, 'nonparticipants must not damage each other');

  a.chat('/mycli pvp join');
  await waitFor(() => lastState(a)?.includes('"queued":true'), 'A queued');
  b.chat('/mycli pvp join');
  await waitFor(() => count(a, 'iron_sword') === 1 && count(b, 'iron_sword') === 1,
    'equal kit', 12000);
  assert.equal(count(a, 'diamond'), 0);
  assert.equal(count(b, 'emerald'), 0);
  await sleep(6200);
  a.chat('/mycli pvp status');
  await waitFor(() => lastState(a)?.includes('"phase":"fighting"'), 'fight start');
  a.pathfinder.setGoal(new goals.GoalNear(b.entity.position.x, b.entity.position.y,
    b.entity.position.z, 2));
  await waitFor(() => a.entity.position.distanceTo(b.entity.position) < 3.2, 'fighters adjacent', 15000);
  a.pathfinder.setGoal(null);
  const target = a.players[beta]?.entity;
  assert.ok(target, 'opponent player entity must be visible to Mineflayer');
  await a.lookAt(target.position.offset(0, 1.5, 0));
  const before = b.health;
  for (let i = 0; i < 5 && b.health === before; i++) {
    a.attack(target);
    await sleep(600);
  }
  await waitFor(() => b.health < before, 'PvP hit', 6000);
  const dealt = before - b.health;
  b.chat('/mycli pvp leave');
  await waitFor(() => count(a, 'diamond') === 3 && count(b, 'emerald') === 2,
    'restored inventory', 10000);
  assert.equal(count(a, 'iron_sword'), 0);
  assert.equal(count(b, 'iron_sword'), 0);
  assert.ok(lines.get(a.username).some(line => line.includes('MC_PVP_RESULT outcome=win')));
  assert.ok(lines.get(b.username).some(line => line.includes('MC_PVP_RESULT outcome=loss')));
  a.chat('/mycli pvp status');
  await waitFor(() => lastState(a)?.includes('"rating":1012'), 'A rating 1012');
  b.chat('/mycli pvp status');
  await waitFor(() => lastState(b)?.includes('"rating":988'), 'B rating 988');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', outsideDamageBlocked: true,
    duelDamageApplied: dealt, aStatus: lastState(a), bStatus: lastState(b),
    inventoryRestored: true }, null, 2));
} finally {
  a.quit(); b.quit(); outsider.quit();
}
