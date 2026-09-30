// Isolated 25566 Paper smoke: test the packets received by a real Mineflayer client.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const rcon = (command) => execFileSync('node', ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const points = [
  { x: 317, y: 115, z: 17, name: 'diamond_ore' },
  { x: 316, y: 115, z: 17, name: 'iron_ore' },
  { x: 318, y: 115, z: 17, name: 'gold_ore' },
];
// Build before the bot receives a chunk; live setblock packets are intentionally truthful.
rcon('minecraft:forceload add 300 0 330 32');
rcon('minecraft:fill 314 112 14 320 118 20 minecraft:stone');
for (const p of points) rcon(`minecraft:setblock ${p.x} ${p.y} ${p.z} minecraft:${p.name}`);

const username = `OreQA${String(Date.now()).slice(-8)}`;
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username, auth: 'offline', version: '1.20.6' });
const chats = [], bars = [], particles = [], states = [], errors = [];
bot.on('messagestr', (message) => chats.push(message));
bot.on('error', (error) => errors.push(error.message));
bot.on('kicked', (reason) => errors.push(`kicked: ${JSON.stringify(reason)}`));
bot._client.on('packet', (packet, meta) => {
  if (meta.name === 'boss_bar') bars.push(packet);
  if (meta.name === 'world_particles') particles.push(packet);
  if (meta.name === 'custom_payload' && packet.channel === 'mcviewer:state') {
    states.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
  }
});
try {
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); });
  bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from('mcviewer:state') });
  rcon(`minecraft:tp ${username} 317.5 119 17.5 180 0`);
  await sleep(1500);
  assert.equal(bot.blockAt(new Vec3(317, 118, 17))?.name, 'stone', 'Test chunk must be loaded before checking hidden ores');
  const raw = points.map((p) => ({ expected: p.name, received: bot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? null }));
  assert.ok(raw.every((p) => p.received !== null), `Ore cells must be loaded: ${JSON.stringify(raw)}`);
  assert.ok(raw.every((p) => p.received === 'stone'), `Anti-xray should hide sealed ores as stone without false ores: ${JSON.stringify(raw)}`);
  assert.ok(states.at(-1)?.mana, 'AuraSkills state must be ready');
  const beforeMana = states.at(-1).mana.current;
  const firstMenu = new Promise((resolve) => bot.once('windowOpen', resolve));
  bot.chat('/mycli menu');
  const skillsMenu = await firstMenu;
  assert.equal(skillsMenu.slots[17]?.name, 'spyglass', 'Skill compass must expose prospecting to controller users');
  const secondMenu = new Promise((resolve) => bot.once('windowOpen', resolve));
  await bot.clickWindow(17, 0, 0);
  const prospectMenu = await secondMenu;
  assert.equal(prospectMenu.slots[14]?.name, 'diamond', 'Prospecting menu must offer a gem search');
  bot.closeWindow(prospectMenu);
  bot.chat('/mycli cast prospect ancient');
  await sleep(350);
  assert.ok(chats.some((line) => line.includes('没有发现这种矿脉')), 'Empty search should give a clear result');
  assert.equal(states.at(-1).mana.current, beforeMana, 'Empty search must not spend mana');
  await sleep(5200);
  bot.chat('/mycli cast prospect diamond');
  await sleep(1300);
  assert.ok(chats.some((line) => line.includes('探矿术找到钻石矿')), `Expected prospecting feedback: ${JSON.stringify(chats)}`);
  assert.ok(chats.some((line) => line.includes('dimension=minecraft:overworld X=317 Y=115 Z=17 ore=minecraft:diamond_ore')),
    `Agent must receive absolute block coordinates and dimension in chat: ${JSON.stringify(chats)}`);
  assert.ok(bars.some((bar) => JSON.stringify(bar).includes('钻石矿')), 'Expected on-screen bossbar with ore name');
  assert.ok(bars.some((bar) => JSON.stringify(bar).includes('X=317 Y=115 Z=17')),
    'Bossbar must show the same absolute block coordinates');
  assert.ok(particles.length > 0, 'Expected vanilla particle packets');
  assert.ok(states.some((state) => state.abilities?.some((ability) => ability.id === 'mycli:prospect' && ability.cooldownMs > 0)),
    'Expected per-player HUD cooldown update');
  assert.ok(states.some((state) => state.mana?.current <= beforeMana - 5.9), 'Successful prospecting must spend six mana');
  bot.chat('/mycli cast prospect diamond');
  await sleep(350);
  assert.ok(chats.some((line) => line.includes('探矿术冷却还剩')), 'Expected repeat cast to be blocked by cooldown');
  rcon('minecraft:setblock 317 115 16 minecraft:air');
  await sleep(600);
  assert.equal(bot.blockAt(new Vec3(317, 115, 17))?.name, 'diamond_ore',
    'Exposed ore must become truthful to the client after a block update');
  assert.equal(errors.length, 0, `Client errors: ${errors}`);
  console.log(JSON.stringify({ verdict: 'PASS', raw, bossBars: bars.length, particles: particles.length, hudStates: states.length, chat: chats.slice(-4) }));
} finally {
  bot.quit();
}
