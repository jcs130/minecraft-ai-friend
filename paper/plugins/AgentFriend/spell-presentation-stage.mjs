// Run against the isolated 25566 server with AgentFriend 0.3.56 enabled.
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
const name = `Chant${String(Date.now()).slice(-6)}`;
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
});
const packets = [];
const chat = [];
bot._client.on('packet', (packet, meta) => {
  if (/title|sound|particle/.test(meta.name)) packets.push({ name: meta.name, body: JSON.stringify(packet) });
});
bot.on('messagestr', (line) => chat.push(line));
const until = async (test, label, limit = 10000) => {
  for (let elapsed = 0; elapsed < limit; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}; chat=${chat.slice(-8).join(' | ')}`);
};
const titleCount = (text) => packets.filter((packet) => packet.name.includes('title')
  && packet.body.includes(text)).length;
const cues = async (incantation, action) => {
  const start = packets.length;
  action();
  await until(() => titleCount(incantation) > 0, `${incantation} title`);
  await sleep(600);
  const newPackets = packets.slice(start);
  assert.ok(newPackets.filter((packet) => packet.name.includes('sound')).length >= 2,
    'opening and closing vanilla sound packets');
  assert.ok(newPackets.filter((packet) => packet.name.includes('particle')).length >= 30,
    'three distinct vanilla-particle beats');
  return newPackets.map((packet) => packet.name);
};

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  rcon(`minecraft:tp ${name} -589.5 91 -329.5`);
  await until(() => bot.entity.position.distanceTo(new Vec3(-589.5, 91, -329.5)) < 2,
    'teleport to arena');
  const homePackets = await cues('空间之力', () => bot.chat('/mycli cast home'));
  await until(() => bot.entity.position.distanceTo(new Vec3(-543.5, 67, -439.5)) < 3,
    'home arrival');
  rcon(`minecraft:tp ${name} -589.5 91 -329.5`);
  await until(() => bot.entity.position.distanceTo(new Vec3(-589.5, 91, -329.5)) < 2,
    'return to arena for healing test');
  const attributeResult = rcon(`minecraft:attribute ${name} minecraft:generic.max_health base set 40`);
  assert.match(attributeResult, /set to 40|已设置|属性/i);
  await sleep(250);
  const beforeHeal = bot.health;
  const healPackets = await cues('柔和的光', () => bot.chat('/mycli cast selfheal'));
  await until(() => bot.health > beforeHeal, 'self-heal result');
  const titlesBeforeRetry = titleCount('柔和的光');
  bot.chat('/mycli cast selfheal');
  await sleep(600);
  assert.equal(titleCount('柔和的光'), titlesBeforeRetry, 'cooldown must not show success title');
  const starlightPackets = await cues('星尘听令', () => bot.chat('/mycli cast starlight'));
  console.log(JSON.stringify({ name, homePackets, healPackets, starlightPackets,
    health: bot.health, cooldownSuppressedTitle: true, chat: chat.slice(-6) }));
} catch (error) {
  console.error(error);
  console.error('presentation packets', packets.slice(-20));
  process.exitCode = 1;
} finally {
  bot.quit();
}
