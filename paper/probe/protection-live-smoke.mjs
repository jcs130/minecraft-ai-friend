import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync(process.execPath, ['E:/MC/probe/rcon.mjs', command], { encoding: 'utf8' });
const username = `PQA${Date.now().toString(36).slice(-7)}`;
const chat = [], payloads = [];
let bot;

async function ask(action, x, y, z, near) {
  rcon(`minecraft:tp ${username} ${near.join(' ')}`);
  await sleep(500);
  const before = payloads.length;
  bot.chat(`/mycli protect ${action} ${x} ${y} ${z}`);
  for (let i = 0; i < 30 && payloads.length === before; i++) await sleep(100);
  assert.equal(payloads.length, before + 1, 'missing protection plugin response');
  const result = payloads.at(-1);
  assert.equal(result.action, action);
  assert.deepEqual([result.x, result.y, result.z], [x, y, z]);
  return result;
}

try {
  const add = rcon(`minecraft:whitelist add ${username}`);
  assert.match(add, /Added|added|白名单/, 'temporary account was not whitelisted');
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username, auth: 'offline', version: '1.20.6' });
  bot.on('messagestr', line => chat.push(line));
  bot._client.on('custom_payload', packet => {
    if (packet.channel === 'mcagent:protection') payloads.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
  });
  await Promise.race([
    new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reason => reject(new Error(JSON.stringify(reason)))); }),
    sleep(20000).then(() => { throw new Error('spawn timeout'); }),
  ]);
  assert.match(rcon(`mycli admin protectchannel ${username}`), /registered=false/,
    'probe should exercise the unregistered Mineflayer path used by CortiLan');
  const house = await ask('break', -551, 68, -432, [-550.5, 69, -431.5]);
  assert.equal(house.reason, 'village_structure');
  assert.equal(house.allowed, false);
  const road = await ask('place', -568, 64, -388, [-567.5, 64, -387.5]);
  assert.equal(road.reason, 'trial_road');
  assert.equal(road.allowed, false);
  const unknown = await ask('break', -551, -100, -432, [-550.5, 69, -431.5]);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.allowed, null);
  const outdoor = await ask('break', -554, 67, -440, [-553.5, 68, -439.5]);
  assert.equal(outdoor.status, 'allow_likely');
  await sleep(300);
  assert.ok(!chat.some(line => line.includes('MC_PROTECT')), 'protection result leaked into chat');
  console.log(JSON.stringify({ ok: true, version: 1, house: house.reason, road: road.reason,
    unknown: unknown.status, outdoor: outdoor.status, payloads: payloads.length, chatCopies: 0 }));
} finally {
  if (bot) bot.quit();
  rcon(`minecraft:whitelist remove ${username}`);
}
