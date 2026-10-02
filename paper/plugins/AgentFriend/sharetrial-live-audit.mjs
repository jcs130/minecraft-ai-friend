// Read-only post-deployment audit. Argument: Paper startup log containing Guild donation entries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync('node', ['E:/MC/probe/rcon.mjs', command], { encoding: 'utf8' });
const expected = Array.from({ length: 4 }, () => new Map());
const log = readFileSync(process.argv[2], 'utf8');
let entries = 0;
for (const match of log.matchAll(/Guild donation CortiLan stashSlot=\d+ chest=(\d) item=([A-Z_]+) count=(\d+)/g)) {
  const category = Number(match[1]);
  assert.ok(category >= 0 && category < 4);
  const item = match[2].toLowerCase();
  expected[category].set(item, (expected[category].get(item) ?? 0) + Number(match[3]));
  entries++;
}
assert.equal(entries, 30, 'expected the single 30-slot CortiLan transfer');
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565,
  username: `ShareAudit${String(Date.now()).slice(-5)}`, auth: 'offline', version: '1.20.6' });
async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await sleep(100);
  }
  throw Error(`Timed out: ${label}`);
}
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  rcon(`minecraft:tp ${bot.username} -475.5 67 -493.5`);
  await until(() => bot.entity.position.distanceTo(new Vec3(-475.5, 67, -493.5)) < 2, 'guild teleport');
  await bot.waitForChunksToLoad();
  for (let category = 0; category < 4; category++) {
    const z = -495 + category * 2;
    const block = bot.blockAt(new Vec3(-473, 67, z));
    assert.equal(block?.name, 'chest');
    let verified = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const chest = await bot.openContainer(block);
      await sleep(300 + attempt * 250);
      assert.equal(chest.inventoryStart, 54);
      const counts = new Map();
      for (const item of chest.containerItems())
        counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
      verified = [...expected[category]].every(([name, count]) => (counts.get(name) ?? 0) >= count);
      bot.closeWindow(chest);
      await sleep(150);
      if (verified) break;
    }
    assert.ok(verified, `guild chest category ${category} lacks donated items`);
    console.log(`category=${category} verifiedTypes=${expected[category].size}`);
  }
  console.log('PASS 30 CortiLan item stacks present in the four public double chests after restart');
} finally {
  bot.quit();
}
