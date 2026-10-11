// Real BossBar and compass packets. Run only against this loopback test world.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fix1206PotionProtocol } from '../ops/minecraft-1206-potion.mjs';

const stage = resolve(process.env.MC_STAGE ?? 'E:/MC/staging/compass-tracking-20261011');
const properties = readFileSync(`${stage}/server.properties`, 'utf8');
assert.match(properties, /^server-ip=127\.0\.0\.1\r?$/m);
assert.match(properties, /^server-port=25567\r?$/m);
assert.match(properties, /^motd=Compass direction isolated check\r?$/m);
const require = createRequire(process.env.MC_PROBE_PACKAGE ?? 'E:/MC/probe/package.json');
fix1206PotionProtocol(require);
const { createBot } = require('mineflayer');
const { command } = await import(process.env.MC_RCON_MODULE ?? 'file:///E:/MC/ops/rcon-client.mjs');
const rcon = q => command(q, 15000, { properties: `${stage}/server.properties`, port: 25587 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { at: new Date().toISOString(), checks: [], errors: [] }, bots = [];
function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail });
  assert.ok(pass, name);
}
async function until(condition, label) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await sleep(100); }
  throw new Error(`timeout: ${label}`);
}
function tracking(bot) { return bot.bossBars.find(bar => bar.title.toString().includes('追踪 TrackTarget')); }
function title(bot) { return tracking(bot)?.title.toString() ?? ''; }
async function connect(username) {
  const bot = createBot({ host: '127.0.0.1', port: 25567, username, auth: 'offline', version: '1.20.6', physicsEnabled: false });
  bots.push(bot);
  bot.on('error', error => report.errors.push(`${username}: ${error.message}`));
  bot.on('kicked', reason => report.errors.push(`${username}: ${JSON.stringify(reason)}`));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('login timeout')), 20000);
    bot.once('spawn', () => { clearTimeout(timer); bot.physicsEnabled = false; resolve(); });
    bot.once('error', error => { clearTimeout(timer); reject(error); });
    bot.once('kicked', reason => { clearTimeout(timer); reject(new Error(JSON.stringify(reason))); });
  });
  return bot;
}
try {
  check('candidate version', (await rcon('version AgentFriend')).includes('0.4.20'));
  const viewer = await connect('TrackQA'), target = await connect('TrackTarget');
  await sleep(1700); // Let Mineflayer finish its initial forced-position reply.
  for (const bot of [viewer, target]) await rcon(`minecraft:gamemode creative ${bot.username}`);
  await rcon('minecraft:tp TrackTarget TrackQA');
  await rcon('minecraft:tp TrackQA 100.5 101 100.5 0 0');
  await rcon('minecraft:tp TrackTarget 100.5 101 116.5');
  const eye = await connect('TrackQA_eye');
  await sleep(2500);
  check('Eye is actually attached', (await rcon('cortieye')).includes('attached=true'));
  viewer.chat('/mycli locate TrackTarget');
  await until(() => title(viewer).includes('↑'), 'initial tracking');
  await until(() => title(eye).includes('追踪 TrackTarget'), 'attached Eye tracking BossBar');
  const positions = [[0, 16], [-16, 16], [-16, 0], [-16, -16], [0, -16], [16, -16], [16, 0], [16, 16]];
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  // South, west, north and east, plus equivalent wrapped rotations.
  for (const [yaw, facing] of [[0, 0], [90, 2], [180, 4], [-90, 6], [810, 2], [-810, 6]]) {
    await rcon(`minecraft:tp TrackQA 100.5 101 100.5 ${yaw} 0`);
    for (let index = 0; index < positions.length; index++) {
      const [dx, dz] = positions[index], x = 100 + dx, z = 100 + dz;
      await rcon(`minecraft:tp TrackTarget ${x + 0.5} 101 ${z + 0.5}`);
      const expected = arrows[(index - facing + 8) % 8];
      await until(() => title(viewer).includes(expected) && title(viewer).endsWith(`${x}, 101, ${z}`), `yaw=${yaw}, target=${index}`);
      check(`yaw=${yaw}, target=${index}: correct relative arrow`, title(viewer).includes(expected), title(viewer));
      await until(() => title(eye) === title(viewer), 'Eye gets same corrected tracking');
    }
  }
  check('Eye received corrected arrows', title(eye) === title(viewer), title(eye));
  await rcon('minecraft:tp TrackTarget 102.5 101 100.5');
  await until(() => title(viewer).includes('●'), 'near target');
  check('nearby marker retained', title(viewer).includes('●'), title(viewer));
  await rcon('minecraft:tp TrackTarget 103.5 101 100.5');
  await until(() => title(viewer).includes('↑'), 'three-block boundary');
  check('three blocks still show direction', !title(viewer).includes('●'), title(viewer));
  // A console execute->tp is intentionally charged as magic. Direct console
  // tp to a spectator anchor exercises dimension changes without that charge.
  const anchor = await connect('TrackEndAnchor');
  await sleep(1700);
  await rcon(`minecraft:gamemode spectator ${anchor.username}`);
  await rcon('minecraft:execute in minecraft:the_end run tp TrackEndAnchor 100.5 101 100.5');
  await until(() => anchor.game.dimension === 'the_end', 'spectator anchor dimension');
  await rcon('minecraft:tp TrackTarget TrackEndAnchor');
  await until(() => title(viewer).includes('不同维度'), 'cross dimension');
  check('cross dimension has no horizontal arrow', !/[↑↗→↘↓↙←↖●]/u.test(title(viewer)), title(viewer));
  await rcon('minecraft:tp TrackTarget TrackQA');
  await rcon('minecraft:tp TrackTarget 84.5 101 100.5');
  await rcon('minecraft:tp TrackQA 100.5 101 100.5 0 0');
  await until(() => title(viewer).includes('→'), 'same dimension restore');
  check('returning target restores direction', title(viewer).includes('→'), title(viewer));
  viewer.chat('/mycli locate off');
  await until(() => !tracking(viewer) && !tracking(eye), 'tracking stops for player and Eye');
  check('off removes player and Eye BossBar', !tracking(viewer) && !tracking(eye));
  // Equipping the special compass starts the automatic nearest-player path.
  await rcon('minecraft:clear TrackQA');
  await sleep(1200);
  viewer.chat('/mycli compass');
  await until(() => viewer.inventory.items().some(item => item.name === 'compass'), 'special compass received');
  await viewer.equip(viewer.inventory.items().find(item => item.name === 'compass'), 'hand');
  await until(() => title(viewer).includes('→'), 'automatic compass tracking');
  check('automatic compass uses corrected right arrow', title(viewer).includes('→'), title(viewer));
  check('native compass packet points at actual target', viewer.spawnPoint?.x === 84 && viewer.spawnPoint?.z === 100, viewer.spawnPoint);
  check('test players remain non-OP', JSON.parse(readFileSync(`${stage}/ops.json`, 'utf8')).length === 0);
  check('no protocol errors', report.errors.length === 0, report.errors);
  report.pass = true;
} catch (error) { report.pass = false; report.failure = error.stack; process.exitCode = 1; }
finally {
  for (const bot of bots) bot.quit('compass regression complete');
  if (process.env.MC_PROBE_REPORT) writeFileSync(process.env.MC_PROBE_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, failure: report.failure }));
}
