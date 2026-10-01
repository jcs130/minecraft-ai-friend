// Isolated Paper 1.20.6 contract: protection replies use only the requester's
// clientbound plugin channel. The observer and ordinary player see no chat copy.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command],
  { encoding: 'utf8', timeout: 10000 });
const clients = new Map();

async function connect(name) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username: name, auth: 'offline', version: '1.20.6' });
  const state = { bot, chat: [], payloads: [], errors: [] };
  clients.set(name, state);
  bot.on('messagestr', line => state.chat.push(line));
  bot.on('error', error => state.errors.push(error.message));
  bot.on('kicked', reason => state.errors.push(`kicked: ${JSON.stringify(reason)}`));
  bot._client.on('custom_payload', packet => {
    if (packet.channel !== 'mcagent:protection') return;
    state.payloads.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
  });
  await Promise.race([
    new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); }),
    sleep(20000).then(() => { throw new Error(`${name} spawn timeout`); }),
  ]);
  if (name.startsWith('PGuest')) {
    bot._client.write('custom_payload', {
      channel: 'minecraft:register', data: Buffer.from('mcagent:protection'),
    });
    await sleep(150);
  }
  return state;
}

async function ask(state, action, target, near, expectedStatus) {
  rcon(`minecraft:tp ${state.bot.username} ${near.join(' ')}`);
  await sleep(500);
  const before = state.payloads.length;
  state.bot.chat(`/mycli protect ${action} ${target.join(' ')}`);
  for (let i = 0; i < 30 && state.payloads.length === before; i++) await sleep(100);
  assert.equal(state.payloads.length, before + 1, `${state.bot.username}: missing plugin reply`);
  const result = state.payloads.at(-1);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.action, action);
  assert.deepEqual([result.x, result.y, result.z], target);
  assert.equal(result.status, expectedStatus);
  assert.equal(result.world, 'minecraft:overworld');
  assert.equal(typeof result.reason, 'string');
  await sleep(180); // Avoid the existing 100 ms query rate limit.
  return result;
}

try {
  const corti = await connect('CortiLan');
  const eye = await connect('CortiEye');
  const guest = await connect(`PGuest${String(Date.now()).slice(-6)}`);
  await sleep(500);
  // CortiLan stays unregistered, like the live connection; the guest registers.
  assert.match(rcon('mycli admin protectchannel CortiLan'), /registered=false/);
  assert.match(rcon('mycli admin protectchannel CortiEye'), /registered=false/);
  const denied = await ask(corti, 'break', [-551, 68, -432],
    [-550.5, 69, -431.5], 'deny');
  assert.equal(denied.reason, 'village_structure');
  assert.equal(denied.allowed, false);
  const unknown = await ask(corti, 'break', [-551, -100, -432],
    [-550.5, 69, -431.5], 'unknown');
  assert.equal(unknown.reason, 'unknown_invalid_y');
  assert.equal(unknown.allowed, null);
  const allowed = await ask(corti, 'break', [-554, 67, -440],
    [-553.5, 68, -439.5], 'allow_likely');
  assert.equal(allowed.allowed, true);
  assert.equal(corti.payloads.length, 3);
  assert.equal(eye.payloads.length, 0, 'CortiEye received CortiLan protection payload');
  assert.equal(guest.payloads.length, 0, 'Guest received CortiLan protection payload');
  await ask(guest, 'break', [-554, 67, -440],
    [-553.5, 68, -439.5], 'allow_likely');
  assert.equal(corti.payloads.length, 3, 'CortiLan received guest protection payload');
  assert.equal(eye.payloads.length, 0);
  for (const [name, state] of clients) {
    assert.ok(!state.chat.some(line => line.includes('MC_PROTECT')),
      `${name} received MC_PROTECT in chat: ${state.chat}`);
    assert.equal(state.errors.length, 0, `${name} client errors: ${state.errors}`);
  }
  console.log(JSON.stringify({ verdict: 'PASS', cortiPayloads: corti.payloads.length,
    guestPayloads: guest.payloads.length, eyePayloads: eye.payloads.length,
    statuses: corti.payloads.map(payload => payload.status), chatCopies: 0 }));
} finally {
  for (const state of clients.values()) state.bot.quit();
}
