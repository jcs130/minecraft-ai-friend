// Default: isolated Paper 25566. Set MC_PORT=25565 for a non-destructive live smoke.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = Number(process.env.MC_PORT ?? 25566);
assert.ok(port === 25565 || port === 25566, 'unexpected target port');
const rcon = command => execFileSync(process.execPath, [port === 25565
  ? 'E:/MC/probe/rcon.mjs'
  : 'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], { encoding: 'utf8' });
const suffix = Date.now().toString(36).slice(-6);
const names = [`StateA${suffix}`, `StateB${suffix}`];
const bots = names.map(username => mineflayer.createBot({
  host: '127.0.0.1', port, username, auth: 'offline', version: '1.20.6',
}));
const packets = new Map(names.map(name => [name, []]));
const chats = new Map(names.map(name => [name, []]));
const errors = [];

for (const bot of bots) {
  bot.on('error', error => errors.push(`${bot.username}: ${error.message}`));
  bot.on('kicked', reason => errors.push(`${bot.username}: kicked ${JSON.stringify(reason)}`));
  bot.on('messagestr', line => chats.get(bot.username).push(line));
  bot._client.on('custom_payload', packet => {
    if (packet.channel !== 'mcagent:state') return;
    const raw = Buffer.from(packet.data);
    assert.equal(raw[0], 0x7b, 'payload must be raw UTF-8 JSON');
    const state = JSON.parse(raw.toString('utf8'));
    assert.equal(state.schemaVersion, 1);
    assert.ok(state.mana === null ||
      (Number.isFinite(state.mana.current) && Number.isFinite(state.mana.max)));
    packets.get(bot.username).push({ at: Date.now(), bytes: raw.length, state });
  });
}

const waitFor = async (condition, label, timeout = 10000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (condition()) return;
    await sleep(50);
  }
  throw new Error(`timeout: ${label}`);
};
const own = name => packets.get(name);
const mana = name => own(name).at(-1)?.state.mana;

try {
  await Promise.all(bots.map(bot => new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reason => reject(new Error(JSON.stringify(reason))));
  })));
  // Only B registers; A exercises the raw per-connection fallback used by
  // existing Mineflayer Agent clients.
  bots[1]._client.write('custom_payload', {
    channel: 'minecraft:register', data: Buffer.from('mcagent:state'),
  });
  await waitFor(() => mana(names[0])?.max > 0 && mana(names[1])?.max > 0, 'both loaded mana');
  await sleep(1200);
  const stableA = own(names[0]).length;
  const stableB = own(names[1]).length;
  await sleep(1250);
  assert.equal(own(names[0]).length, stableA, 'unchanged A sent a periodic state');
  assert.equal(own(names[1]).length, stableB, 'unchanged B sent a periodic state');

  const beforeA = mana(names[0]).current;
  const beforeB = mana(names[1]).current;
  bots[0].chat('/mycli cast fireworks');
  await waitFor(() => own(names[0]).some(p => p.state.mana?.current < beforeA), 'cast state');
  const castAt = own(names[0]).find(p => p.state.mana?.current < beforeA).at;
  assert.equal(mana(names[1]).current, beforeB, 'A mana leaked into B state');
  await waitFor(() => mana(names[0])?.current > beforeA - 1, 'natural recovery', 15000);
  const recovery = own(names[0]).filter(p => p.at > castAt && p.state.mana?.current > beforeA - 1);
  assert.ok(recovery.length >= 1, 'no recovery state');
  const recoveryPackets = own(names[0]).filter(p => p.at > castAt);
  for (let i = 1; i < recoveryPackets.length; i++) {
    assert.ok(recoveryPackets[i].at - recoveryPackets[i - 1].at >= 900,
      'recovery sent faster than one state per second');
  }

  if (port === 25566) {
    const countBeforeRespawn = own(names[0]).length;
    bots[0].once('death', () => bots[0].respawn());
    rcon(`minecraft:kill ${names[0]}`);
    await waitFor(() => own(names[0]).length > countBeforeRespawn, 'respawn state');
    assert.equal(mana(names[1]).current, beforeB, 'respawn leaked into B state');
  }
  for (const name of names) {
    assert.ok(!chats.get(name).some(line => line.includes('mcagent:state') ||
      line.includes('"schemaVersion":1,"mana"')), 'state appeared in chat');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS',
    recipients: names.map(name => ({ name, packets: own(name).length,
      maxBytes: Math.max(...own(name).map(p => p.bytes)) })),
    cast: true, recovery: true, respawn: port === 25566, chatCopies: 0 }));
} finally {
  for (const bot of bots) bot.quit();
}
