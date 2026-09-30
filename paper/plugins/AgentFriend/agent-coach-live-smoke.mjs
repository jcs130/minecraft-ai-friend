// Read-only/self-account smoke for Paper 25565; caller temporarily whitelists username.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const username = process.env.COACH_LIVE_NAME;
if (!username) throw new Error('COACH_LIVE_NAME is required');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function join() {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565,
    username, auth: 'offline', version: '1.20.6' });
  const lines = [];
  bot.on('messagestr', (line) => lines.push(line));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  return { bot, lines };
}

async function ask(client, command, prefix) {
  const start = client.lines.length;
  client.bot.chat(command);
  for (let elapsed = 0; elapsed < 8000; elapsed += 50) {
    const line = client.lines.slice(start).find((candidate) => candidate.startsWith(prefix));
    if (line) return JSON.parse(line.slice(prefix.length));
    await sleep(50);
  }
  throw new Error(`No ${prefix} for ${command}: ${JSON.stringify(client.lines.slice(-8))}`);
}

let client;
try {
  client = await join();
  const initial = await ask(client, '/mycli coach status', 'MC_COACH ');
  assert.equal(initial.enabled, true);
  assert.equal(initial.deathThreshold, 3);
  assert.equal(initial.idleSeconds, 900);
  assert.equal(initial.unusedSeconds, 2700);
  assert.equal(initial.cooldownSeconds, 1800);
  assert.equal((await ask(client, '/mycli coach off', 'MC_COACH ')).enabled, false);
  client.bot.quit();
  await sleep(1200);
  client = await join();
  assert.equal((await ask(client, '/mycli coach status', 'MC_COACH ')).enabled, false,
    'personal preference did not survive reconnect');
  assert.equal((await ask(client, '/mycli coach on', 'MC_COACH ')).enabled, true);
  const detail = await ask(client, '/mycli explain coach.off', 'MC_CLI_DETAIL ');
  assert.equal(detail.id, 'coach.off');
  console.log(JSON.stringify({ verdict: 'PASS', defaults: initial, persistedOff: true }));
} finally {
  client?.bot.quit();
}
