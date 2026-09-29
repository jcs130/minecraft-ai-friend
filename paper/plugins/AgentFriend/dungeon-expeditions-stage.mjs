// Isolated 25566 test of safe approach points and exploration contracts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const name = `RuinQA${String(Date.now()).slice(-7)}`;
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
});
const messages = [];
const errors = [];
bot.on('messagestr', (line) => messages.push(line));
bot.on('error', (error) => errors.push(error.message));
bot.on('kicked', (reason) => errors.push(JSON.stringify(reason)));
const until = async (test, label, timeout = 30000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}; position=${bot.entity?.position}; chat=${messages.slice(-8).join(' | ')}`);
};
const sites = [
  { id: 'undead_crypt', x: -344, z: 680 },
  { id: 'creeping_crypt', x: 1096, z: 232 },
  { id: 'desert_ruins', x: -3224, z: -2088 },
];

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  bot.chat('/mycli guild accept undead_explorer');
  await until(() => messages.some((line) => line.includes('已接公会委托')), 'accept exploration contract');
  const results = [];
  for (const site of sites) {
    bot.chat(`/mycli guild travel ${site.id}`);
    await until(() => Math.abs(bot.entity.position.x - site.x) <= 6
      && Math.abs(bot.entity.position.z - site.z) <= 6,
    `safe travel to ${site.id}`);
    await until(() => bot.blockAt(bot.entity.position.offset(0, -1, 0))
      && bot.blockAt(bot.entity.position.offset(0, 1, 0)), `chunk blocks at ${site.id}`);
    const at = bot.entity.position;
    const floor = bot.blockAt(at.offset(0, -1, 0));
    const head = bot.blockAt(at.offset(0, 1, 0));
    assert.ok(floor && floor.boundingBox === 'block', `${site.id}: solid floor`);
    assert.ok(head && head.boundingBox !== 'block', `${site.id}: headroom`);
    results.push({ id: site.id, position: { x: at.x, y: at.y, z: at.z }, floor: floor.name });
  }
  rcon(`minecraft:effect give ${name} minecraft:slow_falling 30 1 true`);
  rcon(`minecraft:tp ${name} -416 120 672`);
  await until(() => messages.some((line) => line.includes('亡灵墓穴调查')
    && line.includes('已达成')), 'exploration contract completion');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', results, contract: 'undead_explorer' }));
} finally {
  bot.quit();
}
