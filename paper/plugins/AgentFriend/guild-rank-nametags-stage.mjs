// Isolated 1.20.6 wire check for guild rank and Agent nameplate prefixes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const live = process.argv.includes('--live');
const teams = [];
const errors = [];

function connect(username) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: live ? 25565 : 25566,
    username, auth: 'offline', version: '1.20.6' });
  bot.on('error', error => errors.push(`${username}: ${error.message}`));
  bot.on('kicked', reason => errors.push(`${username}: kicked ${JSON.stringify(reason)}`));
  return bot;
}

async function spawned(bot) {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
  });
}

const viewer = connect('RankViewerQA');
viewer._client.on('packet', (packet, meta) => {
  if (meta.name === 'teams') teams.push(packet);
});
let human;
let agent;
try {
  await spawned(viewer);
  if (!live) {
    human = connect('RankHumanQA');
    await spawned(human);
    agent = connect('CortiLan');
    await spawned(agent);
  }
  await sleep(3200);
  assert.deepEqual(errors, []);
  const packets = teams.map(packet => JSON.stringify(packet));
  if (!live) {
    assert.ok(packets.some(raw => raw.includes('qd_rank_5') && raw.includes('◆钻石')),
      'The viewer did not receive the diamond rank team prefix');
    assert.ok(packets.some(raw => raw.includes('qd_rank_5') && raw.includes('RankHumanQA')),
      'The human guild member did not enter the diamond rank team');
  }
  assert.ok(packets.some(raw => raw.includes('qd_arank_4') && raw.includes('◆白金') && raw.includes('[Agent]')),
    'The viewer did not receive the Agent platinum prefix');
  assert.ok(packets.some(raw => raw.includes('qd_arank_4') && raw.includes('CortiLan')),
    'The Agent guild member did not enter the platinum rank team');
  assert.ok(!packets.some(raw => raw.includes('RankViewerQA') && raw.includes('qd_rank_')),
    'A nonmember received a guild rank');
  console.log(JSON.stringify({ result: 'PASS', live, teamPackets: teams.length,
    diamond: packets.filter(raw => raw.includes('qd_rank_5')).slice(-2),
    agentPlatinum: packets.filter(raw => raw.includes('qd_arank_4')).slice(-2) }, null, 2));
} finally {
  viewer.quit();
  human?.quit();
  agent?.quit();
}
