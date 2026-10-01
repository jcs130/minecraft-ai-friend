// Read-only game check apart from a temporary test whitelist entry.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const name = `TagLive${String(Date.now()).slice(-6)}`;
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/probe/rcon.mjs', command], { encoding: 'utf8', timeout: 10000 });
const packets = [];
const errors = [];
let bot;

try {
  assert.match(rcon('list'), /CortiLan/, 'CortiLan must be online for this live check');
  rcon(`whitelist add ${name}`);
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565,
    username: name, auth: 'offline', version: '1.20.6' });
  bot.on('error', error => errors.push(error.message));
  bot.on('kicked', reason => errors.push(`kicked: ${JSON.stringify(reason)}`));
  bot._client.on('packet', (packet, meta) => {
    if (meta.name === 'teams' && packet.team === 'qd_agents') packets.push(packet);
  });
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
  });
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.deepEqual(errors, []);
  assert.ok(packets.some(packet => JSON.stringify(packet).includes('[Agent]')),
    'Agent prefix missing from viewer connection');
  assert.ok(packets.some(packet => JSON.stringify(packet).includes('CortiLan')),
    'CortiLan team membership missing from viewer connection');
  assert.ok(!packets.some(packet => JSON.stringify(packet).includes(name)),
    'Ordinary viewer was put on the Agent team');
  console.log(JSON.stringify({ result: 'PASS', viewer: name,
    packetCount: packets.length, team: 'qd_agents', agent: 'CortiLan' }));
} finally {
  bot?.quit();
  try { rcon(`whitelist remove ${name}`); } catch (error) {
    console.error(`Whitelist cleanup failed for ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
