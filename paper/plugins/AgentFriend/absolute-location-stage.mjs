// Isolated 25566 contract test: navigation messages use absolute block coordinates.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = (command) => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clients = [];
const until = async (test, label, timeout = 30_000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}: ${JSON.stringify(clients[0]?.lines.slice(-12))}`);
};
const join = async (prefix) => {
  const name = `${prefix}${String(Date.now()).slice(-7)}`;
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username: name, auth: 'offline', version: '1.20.6' });
  const lines = [], errors = [];
  bot.on('messagestr', (line) => lines.push(line));
  bot.on('error', (error) => errors.push(error.message));
  bot.on('kicked', (reason) => errors.push(JSON.stringify(reason)));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  const client = { name, bot, lines, errors };
  clients.push(client);
  return client;
};

try {
  rcon('minecraft:forceload add -320 -720 -280 -680');
  rcon('minecraft:fill -320 149 -720 -280 149 -680 minecraft:stone');
  rcon('minecraft:setworldspawn -300 150 -700');
  const agent = await join('NavQA');
  const teammate = await join('MateQA');
  rcon(`minecraft:tp ${agent.name} -300.5 150 -700.5`);
  rcon(`minecraft:tp ${teammate.name} -298.5 150 -700.5`);
  await sleep(500);
  agent.bot.chat('/mycli locate list');
  await until(() => agent.lines.some((line) => line.startsWith(`MC_PLAYER name=${teammate.name} `)), 'locate list');
  assert.match(agent.lines.find((line) => line.startsWith(`MC_PLAYER name=${teammate.name} `)),
    /dimension=minecraft:overworld x=-299 y=150 z=-701/);
  agent.bot.chat('/mycli locate nearest');
  await until(() => agent.lines.filter((line) => line.startsWith(`MC_PLAYER name=${teammate.name} `)).length >= 2,
    'locate nearest');
  agent.bot.chat('/mycli waypoint');
  await until(() => agent.lines.some((line) => line.startsWith('MC_WAYPOINT id=arena ')), 'arena waypoint');
  assert.ok(agent.lines.some((line) => /^MC_WAYPOINT id=cherry dimension=minecraft:overworld x=-?\d+ y=-?\d+ z=-?\d+$/.test(line)),
    'Essentials public warp lacks absolute coordinates');
  agent.bot.chat('/mycli waypoint add navqa');
  await until(() => agent.lines.some((line) => line.startsWith('MC_WAYPOINT id=personal:navqa ')), 'personal waypoint');
  agent.bot.chat('/mycli arena status');
  await until(() => agent.lines.some((line) => line.startsWith('MC_DUNGEON entrance ')), 'arena status');
  rcon('minecraft:summon minecraft:husk -296.5 150 -700.5 {Tags:["afu_nav_qa"],NoAI:1b}');
  await sleep(250);
  agent.bot.chat('/mycli cast sense');
  await until(() => agent.lines.some((line) => line.startsWith('MC_HOSTILE type=husk ')), 'hostile scan');
  assert.match(agent.lines.find((line) => line.startsWith('MC_HOSTILE type=husk ')),
    /dimension=minecraft:overworld x=-297 y=150 z=-701/);
  agent.bot.chat('/mycli guild travel undead_crypt');
  await until(() => agent.lines.some((line) => line.startsWith('MC_SITE id=undead_crypt ')), 'expedition');
  assert.match(agent.lines.find((line) => line.startsWith('MC_SITE id=undead_crypt ')),
    /dimension=minecraft:overworld x=-?\d+ y=-?\d+ z=-?\d+ centerX=-416 centerZ=672/);
  agent.bot.chat('/mycli goto cherry');
  await until(() => agent.lines.some((line) => line.startsWith('MC_DESTINATION id=cherry ')), 'public destination');
  agent.bot.chat('/mycli goto personal:navqa');
  await until(() => agent.lines.some((line) => line.startsWith('MC_DESTINATION id=personal:navqa ')), 'personal destination');
  agent.bot.chat('/mycli goto guild');
  await until(() => agent.lines.some((line) => line.includes('已到冒险者公会') && line.includes('dimension=')), 'guild landing');
  assert.ok(clients.every((client) => client.errors.length === 0), JSON.stringify(clients.map((client) => client.errors)));
  console.log(JSON.stringify({ verdict: 'PASS', samples: agent.lines.filter((line) => line.startsWith('MC_')) }));
} finally {
  for (const client of clients) client.bot.quit();
  try { rcon('minecraft:kill @e[tag=afu_nav_qa]'); } catch { }
  try { rcon('minecraft:setworldspawn -543 68 -439'); } catch { }
  try { rcon('minecraft:fill -320 149 -720 -280 149 -680 minecraft:air'); } catch { }
  try { rcon('minecraft:forceload remove -320 -720 -280 -680'); } catch { }
}
