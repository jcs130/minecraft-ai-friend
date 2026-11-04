// Loopback QA: real successful casts and rejected casts, observed on the wire.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../../../ops/rcon-client.mjs';
import { installRecipePacketBypass } from '../../../ops/mineflayer-client-compat.mjs';

const [stage, clientManifest, suffix = 'A'] = process.argv.slice(2);
assert(stage && clientManifest && /^[A-Z0-9]{1,3}$/.test(suffix), 'Usage: node cast-title-client.mjs <stage> <Mineflayer package.json> [fresh actor suffix]');
const root = await fs.realpath(stage), properties = path.join(root, 'server.properties');
assert.equal((await fs.readFile(path.join(root, '.rpg-title-qa'), 'utf8')).trim(), 'rpg-cast-title-loopback');
const config = (await fs.readFile(properties, 'utf8')).split(/\r?\n/);
for (const required of ['server-ip=127.0.0.1', 'server-port=25978', 'rcon.port=25979', 'online-mode=false']) assert(config.includes(required));
const rcon = line => command(line, 15000, { properties, port: 25979 });
const require = createRequire(path.resolve(clientManifest));
const { createBot } = require('mineflayer');
const nbt = require('prismarine-nbt');
const bots = [], checks = [], samples = {};
function check(ok, label) { assert(ok, label); checks.push(label); console.log('PASS ' + label); }
async function until(poll, label, timeout = 15000) {
  const end = Date.now() + timeout;
  do { const value = await poll(); if (value) return value; await delay(100); } while (Date.now() < end);
  throw Error('Timed out: ' + label);
}
function plain(c) {
  if (typeof c === 'string') return c.replace(/§./g, '');
  if (Array.isArray(c)) return c.map(plain).join('');
  return c && typeof c === 'object' ? plain(c.text ?? '') + plain(c.extra ?? '') : '';
}
async function connect(role) {
  const bot = createBot({ host: '127.0.0.1', port: 25978, username: 'TitleQa' + role + suffix,
    version: '1.21.1', auth: 'offline', physicsEnabled: false, hideErrors: true });
  bots.push(bot);
  bot.chatLines = []; bot.titlePackets = []; bot.lastCommand = 0;
  bot.on('messagestr', line => bot.chatLines.push(line));
  bot.on('error', e => console.log('QA client: ' + e.message));
  for (const [packet, kind] of [['set_title_text', 'title'], ['set_title_subtitle', 'subtitle']]) {
    bot._client.on(packet, ({ text }) => bot.titlePackets.push({ kind, text: plain(nbt.simplify(text)) }));
  }
  bot.on('title_times', (fadeIn, stay, fadeOut) => bot.titlePackets.push({ kind: 'timing', fadeIn, stay, fadeOut }));
  installRecipePacketBypass(bot);
  await Promise.race([once(bot, 'spawn'), once(bot, 'kicked').then(([why]) => { throw Error('QA client kicked: ' + why); }),
    delay(20000, null, { ref: false }).then(() => { throw Error('QA spawn timeout'); })]);
  return bot;
}
async function say(bot, line) {
  await delay(Math.max(0, 1250 - (Date.now() - bot.lastCommand)));
  const start = bot.chatLines.length;
  bot.lastCommand = Date.now(); bot.chat(line);
  return start;
}
async function reply(bot, offset, pattern, label) {
  return until(() => bot.chatLines.slice(offset).find(line => pattern.test(line)), label);
}
async function title(bot, offset, name, pathName) {
  await until(() => bot.titlePackets.slice(offset).some(p => p.kind === 'title' && p.text === name), pathName + ' title');
  const packets = bot.titlePackets.slice(offset);
  check(packets.filter(p => p.kind === 'title' && p.text === name).length === 1
    && packets.some(p => p.kind === 'subtitle' && p.text === '✦ 技能发动 ✦')
    && packets.some(p => p.kind === 'timing' && p.fadeIn === 3 && p.stay === 36 && p.fadeOut === 8),
  pathName + ' sends one configured skill title with matching subtitle and timing');
  samples[pathName] = packets;
}
const startVersion = await until(async () => {
  try { return (await rcon('version QiandengjiRpg')).includes('0.2.19'); } catch { return false; }
}, 'isolated server started', 100000);
assert(startVersion);
try {
  const knight = await connect('Knight'), other = await connect('Other');
  await rcon('minecraft:tp ' + knight.username + ' 4250.5 81 4200.5');
  await rcon('minecraft:tp ' + other.username + ' 4252.5 81 4200.5');
  await until(() => knight.entity.position.x === 4250.5 && other.entity.position.x === 4252.5, 'QA clients at floor');
  let offset = await say(knight, '/mycli profession choose knight');
  await reply(knight, offset, /已选择并保存/, 'knight class saved');
  const sword = await until(() => knight.inventory.items().find(i => i.name === 'iron_sword'), 'class starter sword delivered');
  if (knight.currentWindow) knight.closeWindow(knight.currentWindow);
  const observerStart = other.titlePackets.length;
  let start = knight.titlePackets.length;
  offset = await say(knight, '/mycli cast fortify');
  await reply(knight, offset, /技能已执行/, 'CLI cast actually succeeded');
  await title(knight, start, '坚守', 'mycli cast');

  start = knight.titlePackets.length;
  offset = await say(knight, '/mycli cast fortify');
  await reply(knight, offset, /冷却|cooldown/i, 'second cast denied by cooldown');
  await delay(400);
  check(!knight.titlePackets.slice(start).some(p => p.text === '坚守' || p.text === '✦ 技能发动 ✦'), 'cooldown failure emits no success title');

  await delay(8500);
  start = knight.titlePackets.length;
  await say(knight, '/vortexrpg:cast fortify');
  await title(knight, start, '坚守', 'native cast');
  await say(knight, '/vortexrpg:spell equip fortify');
  await knight.equip(sword, 'hand');
  await delay(8500);
  start = knight.titlePackets.length;
  const ground = await until(() => {
    const block = knight.blockAt(knight.entity.position.floored().offset(0, -1, 0));
    return block?.name === 'stone' && block;
  }, 'QA stone interaction target');
  await knight.activateBlock(ground);
  await title(knight, start, '坚守', 'class weapon right click');
  check(!other.titlePackets.slice(observerStart).some(p => p.text === '坚守' || p.text === '✦ 技能发动 ✦'), 'nearby unrelated player receives no skill title');

  await fs.writeFile(path.join(root, 'cast-title-report.json'), JSON.stringify({ passed: checks.length, checks, samples }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: String(error), chat: bots[0]?.chatLines.slice(-12), titles: bots[0]?.titlePackets.slice(-15) }));
  throw error;
} finally {
  for (const bot of bots) bot.quit();
}
