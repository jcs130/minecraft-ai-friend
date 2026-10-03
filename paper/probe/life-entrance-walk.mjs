import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const {Vec3} = require('vec3');
const stage = process.argv.includes('--stage');
const port = stage ? 25567 : 25565;
const rconPath = stage
  ? 'E:/MC/staging/life-buildings-20261003/rcon-stage.mjs'
  : 'E:/MC/probe/rcon.mjs';
const halls = [
  ['harvest', -605, 71, -499],
  ['harbor', -620, 70, -471],
  ['workshop', -545, 68, -463],
  ['library', stage ? -566 : -593, 67, stage ? -447 : -451],
];
const selected = process.argv.includes('--harvest-only') ? halls.slice(0, 1) : halls;
const inspectOnly = process.argv.includes('--inspect-only');
const checkProtection = process.argv.includes('--check-protection');
const stairCounts = {harvest: 3, harbor: 3, workshop: 2, library: 4};
const username = `DoorQA${Date.now().toString(36).slice(-5)}`;
const rcon = command => execFileSync('node', [rconPath, command], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
}

const bot = mineflayer.createBot({
  host: '127.0.0.1', port, username, auth: 'offline', version: '1.20.6',
});
const protection = [];
bot._client.on('custom_payload', packet => {
  if (packet.channel === 'mcagent:protection')
    protection.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
});
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  for (const [id, x, y, z] of selected) {
    for (const dy of [1, 2]) {
      const clear = rcon(`execute if block ${x} ${y + dy} ${z + 5} minecraft:air`);
      assert.match(clear, /Test passed/, `${id} doorway height ${dy}`);
    }
    const teleport = rcon(`minecraft:tp ${username} ${x + 0.5} ${y + 1} ${z + 8.5}`);
    assert.match(teleport, /Teleported/);
    await until(() => Math.abs(bot.entity.position.z - (z + 8.5)) < 0.8,
      `${id} outside arrival`);
    await sleep(1000);
    const ground = [4, 5, 6, 7, 8].map(dz => ({dz, blocks: [-4, -3, -2, -1, 0, 1, 2].map(dy =>
      `${dy}:${bot.blockAt(new Vec3(x, y + dy, z + dz))?.name}`)}));
    if (inspectOnly) {
      console.log(`${id} start=${bot.entity.position.toString()} ground=${JSON.stringify(ground)}`);
      continue;
    }
    await bot.lookAt(new Vec3(x + 0.5, y + 1.6, z + 1.5), true);
    bot.setControlState('forward', true);
    try {
      await until(() => bot.entity.position.z < z + 3.7, `${id} walk through doorway`);
    } finally {
      bot.setControlState('forward', false);
    }
    console.log(`PASS ${id} outside to inside: z=${bot.entity.position.z.toFixed(2)}`);
    if (checkProtection) {
      const before = protection.length;
      const step = stairCounts[id];
      bot.chat(`/mycli protect break ${x} ${y - step + 1} ${z + 4 + step}`);
      await until(() => protection.length > before, `${id} outer stair protection`);
      assert.equal(protection.at(-1).reason, 'life_guild_building');
      assert.equal(protection.at(-1).status, 'deny');
      console.log(`PASS ${id} outer stair protected`);
      const beforeSign = protection.length;
      bot.chat(`/mycli protect break ${x + 3} ${y + 2} ${z + 5}`);
      await until(() => protection.length > beforeSign, `${id} sign protection`);
      assert.equal(protection.at(-1).reason, 'life_guild_building');
      assert.equal(protection.at(-1).status, 'deny');
      console.log(`PASS ${id} relocated sign protected`);
    }
  }
} finally {
  bot.quit();
}
