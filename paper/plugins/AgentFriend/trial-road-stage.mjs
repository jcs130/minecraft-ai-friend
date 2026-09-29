// End-to-end walking and protection probe for the already-built 25566 stage world.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { pathfinder, goals, Movements } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const name = `Road${String(Date.now()).slice(-6)}`;
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name, version: '1.20.6', auth: 'offline',
});
bot.loadPlugin(pathfinder);
const messages = [];
bot.on('messagestr', (message) => messages.push(message));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const limit = setTimeout(() => {
  console.error('trial-road probe timed out', bot.entity?.position?.toString());
  bot.quit(); process.exitCode = 2;
}, 180000);

async function verifyProtected(x, y, z, expected) {
  const point = new Vec3(x, y, z);
  const before = bot.blockAt(point);
  assert.equal(before?.name, expected);
  messages.length = 0;
  try { await bot.dig(before); } catch { /* A cancelled dig may reject on some mineflayer versions. */ }
  await sleep(1200);
  assert.equal(bot.blockAt(point)?.name, expected, `${expected} must remain in the world`);
  assert.ok(messages.some((message) => message.includes('公共道路')), 'road protection feedback');
}

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  const movements = new Movements(bot);
  movements.canDig = false;
  movements.allow1by1towers = false;
  bot.pathfinder.setMovements(movements);
  const spawn = bot.entity.position.clone();
  await bot.pathfinder.goto(new goals.GoalNear(-570, 64, -411, 2));
  const start = bot.entity.position.clone();
  await verifyProtected(-570, 63, -411, 'spruce_planks');
  await bot.pathfinder.goto(new goals.GoalNear(-590, 76, -350, 1));
  await verifyProtected(-590, 75, -350, 'stone_brick_stairs');
  await bot.pathfinder.goto(new goals.GoalNear(-590, 91, -329, 2));
  const finish = bot.entity.position.clone();
  assert.ok(finish.distanceTo(new Vec3(-590, 91, -329)) < 3);
  console.log(JSON.stringify({ spawn: spawn.toString(), start: start.toString(),
    finish: finish.toString(), walkedWithoutDigging: true, protectedSamples: 2 }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(limit);
  bot.quit();
}
