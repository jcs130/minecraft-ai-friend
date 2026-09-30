// Isolated 25566 test. The stage config sets short coach timers and 2 deaths.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], { encoding: 'utf8' });
rcon('minecraft:forceload add 2192 2192 2208 2208');
rcon('minecraft:fill 2192 180 2192 2208 185 2208 minecraft:air');
rcon('minecraft:fill 2192 179 2192 2208 179 2208 minecraft:stone');
rcon('minecraft:setworldspawn 2200 180 2200');
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
  username: `CoachQA${String(Date.now()).slice(-7)}`, auth: 'offline', version: '1.20.6' });
const lines = [], failures = [];
let respawns = 0;
bot.on('messagestr', (line) => lines.push(line));
bot.on('respawn', () => respawns++);
bot.on('error', (error) => failures.push(error.message));
bot.on('kicked', (reason) => failures.push(JSON.stringify(reason)));
const until = async (test, label, timeout = 16_000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}: ${JSON.stringify(lines.slice(-12))}`);
};
const coach = () => lines.filter((line) => line.startsWith('MC_COACH '))
  .map((line) => JSON.parse(line.slice('MC_COACH '.length)));
const query = async (command, test) => {
  const previous = coach().length;
  bot.chat(command);
  await until(() => coach().length > previous && test(coach().at(-1)), command);
};

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  assert.ok(Math.abs(bot.entity.position.x - 2200) < 3, 'test player did not join on safe platform');
  await query('/mycli coach status', (item) => item.type === 'status' && item.enabled === true
    && item.deathThreshold === 2 && item.idleSeconds === 5);
  bot.chat('/mycli list coach');
  await until(() => lines.some((line) => line.startsWith('MC_CLI_ITEM ')
    && JSON.parse(line.slice('MC_CLI_ITEM '.length)).id === 'coach.off'), 'coach catalog');
  bot.chat('/mycli explain coach.off');
  await until(() => lines.some((line) => line.startsWith('MC_CLI_DETAIL ')
    && JSON.parse(line.slice('MC_CLI_DETAIL '.length)).id === 'coach.off'), 'coach explanation');
  bot.chat('/mycli coach invalid');
  await until(() => lines.some((line) => line.startsWith('MC_COACH_ERROR ')
    && JSON.parse(line.slice('MC_COACH_ERROR '.length)).code === 'UNKNOWN_ACTION'),
  'coach error');
  await query('/mycli coach off', (item) => item.type === 'status' && item.enabled === false);
  await sleep(6100);
  assert.ok(Math.abs(bot.entity.position.x - 2200) < 3, 'test player left safe platform');
  assert.equal(coach().filter((item) => item.type === 'reminder').length, 0,
    'opted-out player received a reminder');
  await query('/mycli coach on', (item) => item.type === 'status' && item.enabled === true);
  await until(() => coach().some((item) => item.reason === 'idle'), 'idle reminder', 9000);
  const idle = coach().find((item) => item.reason === 'idle');
  assert.ok(idle.commands.includes('/mycli list'));
  await sleep(6100);
  assert.equal(coach().filter((item) => item.reason === 'idle').length, 1,
    'idle reminder repeated without new activity');
  assert.equal(coach().filter((item) => item.reason === 'mycli_unused').length, 0,
    'idle player also received a no-/mycli reminder');

  await query('/mycli coach status', (item) => item.type === 'status');
  for (let count = 0; count < 2; count++) {
    const before = respawns;
    assert.match(rcon(`minecraft:kill ${bot.username}`), /Killed|已杀死/);
    await until(() => respawns > before && bot.health > 0, `death ${count + 1}`);
    await sleep(1200);
  }
  await until(() => coach().some((item) => item.reason === 'deaths'), 'death reminder', 9000);
  const death = coach().find((item) => item.reason === 'deaths');
  assert.equal(death.deaths, 2);
  assert.ok(death.commands.includes('/mycli explain cast.selfheal'));

  await query('/mycli coach status', (item) => item.type === 'status');
  for (let count = 0; count < 5; count++) {
    await sleep(1900);
    bot.chat('/minecraft:me stays active');
  }
  await until(() => coach().some((item) => item.reason === 'mycli_unused'),
    'unused /mycli reminder', 5000);
  assert.equal(coach().filter((item) => item.reason === 'idle').length, 1,
    'active player received an extra idle reminder');
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ verdict: 'PASS', reasons: coach().filter((item) => item.type === 'reminder')
    .map((item) => item.reason) }));
} finally {
  bot.quit();
  try { rcon('minecraft:setworldspawn -543 68 -439'); } catch { }
  try { rcon('minecraft:fill 2192 179 2192 2208 185 2208 minecraft:air'); } catch { }
  try { rcon('minecraft:forceload remove 2192 2192 2208 2208'); } catch { }
}
