// Isolated Paper 1.20.6 check: Agent labels follow the Eye registry without reload.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

const require = createRequire('E:/MC/probe/package.json');
const mineflayer = require('mineflayer');
const registry = 'E:/MC/staging/life-buildings-20261003/agent-eye-pairs.json';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const options = { host: '127.0.0.1', port: 25567, auth: 'offline', version: '1.20.6' };
const events = [];
const errors = [];
const bots = [];
const original = await readFile(registry, 'utf8');
const pairs = { schemaVersion: 1, pairs: [
  { agent: 'CortiLan', eye: 'CortiEye' }, { agent: 'MirrorAgent' }
] };

async function connect(username) {
  const bot = mineflayer.createBot({ ...options, username });
  bots.push(bot);
  bot.on('error', error => errors.push(`${username}: ${error.message}`));
  bot.on('kicked', reason => errors.push(`${username}: kicked ${JSON.stringify(reason)}`));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
  });
  return bot;
}

const hasAgentAdd = event => event.team === 'qd_agents' && event.mode === 3
  && event.players?.includes('MirrorAgent');
const hasAgentRemove = event => event.team === 'qd_agents' && event.mode === 4
  && event.players?.includes('MirrorAgent');

try {
  await writeFile(registry, JSON.stringify(pairs));
  const viewer = await connect('AgentTagViewer');
  viewer._client.on('packet', (packet, meta) => {
    if (meta.name === 'teams') events.push(packet);
  });
  await connect('MirrorAgent');
  await connect('TagHumanQA');
  await sleep(7000);
  assert.deepEqual(errors, []);
  assert.ok(events.some(hasAgentAdd), 'registered Agent was not labeled');
  assert.ok(!events.some(event => event.players?.includes('TagHumanQA')
    && event.team?.startsWith('qd_a')), 'unregistered guest received Agent label');

  let mark = events.length;
  await writeFile(registry, JSON.stringify({ schemaVersion: 1, pairs: [pairs.pairs[0]] }));
  await sleep(12000);
  assert.ok(events.slice(mark).some(hasAgentRemove), 'removing pair did not revoke label');
  const lastChange = events.filter(event => hasAgentAdd(event) || hasAgentRemove(event)).at(-1);
  assert.ok(hasAgentRemove(lastChange), 'revoked Agent was re-added');

  mark = events.length;
  await writeFile(registry, '{bad json');
  await sleep(7000);
  assert.ok(!events.slice(mark).some(hasAgentAdd), 'invalid registry granted Agent label');

  mark = events.length;
  await writeFile(registry, JSON.stringify(pairs));
  await sleep(8000);
  assert.ok(events.slice(mark).some(hasAgentAdd), 'restored pair was not re-labeled');
  console.log(JSON.stringify({ result: 'PASS', add: events.filter(hasAgentAdd).length,
    remove: events.filter(hasAgentRemove).length, errors }));
} finally {
  await writeFile(registry, original);
  for (const bot of bots) bot.quit();
}
