// Confirm the real spectator camera receives the target's chant title and nearby effects.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const connect = (username) => mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username, auth: 'offline', version: '1.20.6',
});
const target = connect('CortiLan');
const eye = connect('CortiEye');
const packets = { target: [], eye: [] };
for (const [key, bot] of [['target', target], ['eye', eye]]) {
  bot._client.on('packet', (packet, meta) => {
    if (/title|sound|particle/.test(meta.name))
      packets[key].push({ name: meta.name, body: JSON.stringify(packet) });
  });
}
const until = async (test, label, limit = 15000) => {
  for (let elapsed = 0; elapsed < limit; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}; camera=${rcon('cortieye')}`);
};
const title = (items) => items.some((packet) => packet.name === 'set_title_text'
  && packet.body.includes('空间之力'));

try {
  await Promise.all([target, eye].map((bot) => new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  })));
  await sleep(3500); // SpectatorPlus and the mirror attach during the first join ticks.
  await until(() => {
    try { return rcon('cortieye').includes('attached=true'); }
    catch { return false; }
  }, 'camera attachment', 12000);
  rcon('minecraft:tp CortiLan -589.5 91 -329.5');
  await until(() => target.entity.position.distanceTo(new Vec3(-589.5, 91, -329.5)) < 2,
    'target arena position');
  packets.target.length = 0;
  packets.eye.length = 0;
  target.chat('/mycli cast home');
  await until(() => title(packets.target) && title(packets.eye), 'both chant titles');
  await sleep(400);
  assert.ok(packets.target.some((packet) => packet.name === 'world_particles'));
  assert.ok(packets.target.some((packet) => packet.name.includes('sound')));
  assert.ok(packets.eye.filter((packet) => packet.name === 'world_particles').length >= 30,
    'attached spectator receives the full three-beat particle sequence');
  assert.ok(packets.eye.filter((packet) => packet.name.includes('sound')).length >= 2,
    'attached spectator receives both sound cues');
  console.log(JSON.stringify({ attached: true,
    target: packets.target.map((packet) => packet.name),
    eye: packets.eye.map((packet) => packet.name),
    eyeTitle: title(packets.eye),
    eyeSound: packets.eye.some((packet) => packet.name.includes('sound')),
    eyeParticles: packets.eye.some((packet) => packet.name === 'world_particles') }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  target.quit();
  eye.quit();
}
