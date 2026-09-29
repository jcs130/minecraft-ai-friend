import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const name = `Hall${String(Date.now()).slice(-6)}`;
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
});
const messages = [];
const errors = [];
bot.on('messagestr', (message) => messages.push(message));
bot.on('error', (error) => errors.push(error.message));
bot.on('kicked', (reason) => errors.push(`kicked: ${JSON.stringify(reason)}`));

async function until(test, label, timeout = 10000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 200) {
    if (test()) return;
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}
async function ask(command, delay = 450) {
  messages.length = 0;
  bot.chat(command);
  await sleep(delay);
  return messages.join('\n');
}

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
  });
  assert.match(await ask('/mycli guild hall'), /冒险者公会/);
  await until(() => bot.entity.position.distanceTo(new Vec3(-488.5, 67, -497.5)) < 2,
    'guild hall teleport');
  await bot.waitForChunksToLoad();
  assert.equal(bot.blockAt(new Vec3(-489, 66, -502))?.name, 'spruce_planks');
  const entrance = bot.blockAt(new Vec3(-489, 67, -496));
  assert.equal(entrance?.name, 'air', 'open archway');
  assert.match(rcon(`minecraft:tp ${name} -485.5 67 -493.5`), /Teleported|传送/);
  await until(() => bot.entity.position.distanceTo(new Vec3(-485.5, 67, -493.5)) < 2,
    'quest board approach');
  await bot.waitForChunksToLoad();
  const sign = bot.blockAt(new Vec3(-486, 68, -495));
  assert.equal(sign?.name, 'oak_sign', 'physical quest board');
  if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  bot.setQuickBarSlot(8);
  assert.equal(bot.heldItem, null, 'empty hand for sign interaction');
  const opened = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.activateBlock(sign);
  const window = await Promise.race([
    opened, sleep(5000).then(() => { throw new Error('quest board did not open'); }),
  ]);
  assert.equal(window.slots[10]?.name, 'moss_block');
  assert.equal(window.slots[11]?.name, 'iron_sword');
  await bot.clickWindow(10, 0, 0);
  await sleep(600);
  assert.match(await ask('/mycli guild status'), /初探苔穴 \[0\/1\]/);
  if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  rcon(`minecraft:tp ${name} -488.5 67 -501.5`);
  await until(() => bot.entity.position.distanceTo(new Vec3(-488.5, 67, -501.5)) < 2,
    'guild hall floor approach');
  const floor = bot.blockAt(new Vec3(-489, 66, -502));
  assert.equal(floor?.name, 'spruce_planks');
  await bot.dig(floor).catch(() => {});
  await sleep(400);
  assert.match(rcon('minecraft:execute if block -489 66 -502 minecraft:spruce_planks'), /Test passed|测试通过/);
  assert.match(rcon('mycli admin buildguild -489 -502'), /拒绝覆盖/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', hall: [-489, 66, -502],
    board: [-486, 68, -495], quest: 'first_step', protectedFloor: true,
    protocol: '1.20.6' }, null, 2));
} finally {
  bot.quit();
  await sleep(200);
}
