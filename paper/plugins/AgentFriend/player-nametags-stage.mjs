// Isolated 1.20.6 wire check: a viewer receives the native team prefix for
// the Agent account, while an ordinary player's name is left alone.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const viewerName = `TagQA${String(Date.now()).slice(-7)}`;
const agentName = 'TagAgentQA';
const teams = [];
const errors = [];

function connect(username) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username, auth: 'offline', version: '1.20.6' });
  bot.on('error', error => errors.push(`${username}: ${error.message}`));
  bot.on('kicked', reason => errors.push(`${username}: kicked ${JSON.stringify(reason)}`));
  return bot;
}

const viewer = connect(viewerName);
viewer._client.on('packet', (packet, meta) => {
  if (meta.name === 'teams') teams.push(packet);
});
let agent;

try {
  await new Promise((resolve, reject) => {
    viewer.once('spawn', resolve);
    viewer.once('error', reject);
  });
  agent = connect(agentName);
  await new Promise((resolve, reject) => {
    agent.once('spawn', resolve);
    agent.once('error', reject);
  });
  await sleep(3200);
  assert.deepEqual(errors, []);
  const agentTeam = teams.filter(packet => JSON.stringify(packet).includes('qd_agents'));
  assert.ok(agentTeam.length, `No qd_agents packet; received ${teams.length} team packets`);
  assert.ok(agentTeam.some(packet => JSON.stringify(packet).includes(agentName)),
    'The viewer never received Agent membership');
  assert.ok(agentTeam.some(packet => JSON.stringify(packet).includes('[Agent]')),
    'The viewer never received the Agent prefix');
  assert.ok(!agentTeam.some(packet => JSON.stringify(packet).includes(viewerName)),
    'An ordinary player was placed on the Agent team');
  console.log(JSON.stringify({ result: 'PASS', viewer: viewerName,
    agent: agentName, teamPackets: agentTeam.length,
    samples: agentTeam.slice(-2) }, null, 2));
} finally {
  viewer.quit();
  agent?.quit();
}
