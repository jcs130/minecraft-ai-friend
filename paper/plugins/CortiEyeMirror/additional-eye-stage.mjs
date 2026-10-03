// Isolated Paper 1.20.6 test for multiple registered Eye camera packet routes.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import net from 'node:net';

const require = createRequire('E:/MC/probe/package.json');
const mineflayer = require('mineflayer');
const registry = 'E:/MC/staging/life-buildings-20261003/agent-eye-pairs.json';
const password = readFileSync('E:/MC/staging/life-buildings-20261003/server.properties', 'utf8')
  .match(/^rcon\.password=(.*)$/m)?.[1].trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const names = ['MirrorAgent', 'MirrorAgent_eye', 'OtherAgent', 'OtherAgent_eye',
  'UnknownEye', 'CortiLan', 'CortiEye'];
const bots = new Map();
const received = new Map(names.map(name => [name, []]));
const basePairs = { schemaVersion: 1, pairs: [
  { agent: 'CortiLan', eye: 'CortiEye' },
  { agent: 'MirrorAgent' }, { agent: 'OtherAgent' }
] };

async function rcon(command) {
  const packet = (id, type, body) => {
    const data = Buffer.from(body, 'utf8');
    const out = Buffer.alloc(data.length + 14);
    out.writeInt32LE(out.length - 4, 0);
    out.writeInt32LE(id, 4);
    out.writeInt32LE(type, 8);
    data.copy(out, 12);
    return out;
  };
  return new Promise((resolve, reject) => {
    const socket = net.connect(25587, '127.0.0.1');
    let buffer = Buffer.alloc(0);
    let authed = false;
    let answer = '';
    let settle;
    const finish = error => {
      clearTimeout(timeout);
      clearTimeout(settle);
      socket.destroy();
      error ? reject(error) : resolve(answer);
    };
    const timeout = setTimeout(() => finish(authed ? null : new Error('RCON auth timeout')), 1500);
    socket.on('error', finish);
    socket.on('connect', () => socket.write(packet(1, 3, password)));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readInt32LE(0);
        if (length < 10 || length > 65536) return finish(new Error('invalid RCON frame'));
        if (buffer.length < length + 4) break;
        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const body = buffer.subarray(12, length + 2).toString('utf8');
        buffer = buffer.subarray(length + 4);
        if (id === -1) return finish(new Error('RCON auth failed'));
        if (!authed && id === 1 && type === 2) {
          authed = true;
          socket.write(packet(2, 2, command));
        } else if (authed && id === 2 && type === 0) {
          answer += body;
          clearTimeout(settle);
          settle = setTimeout(() => finish(), 150);
        }
      }
    });
  });
}

async function join(name) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567,
    version: '1.20.6', username: name, auth: 'offline' });
  bots.set(name, bot);
  bot._client.on('packet', (data, meta) => {
    const text = JSON.stringify(data) ?? '';
    if (text.includes('EYE_ROUTE_')) received.get(name).push({ type: meta.name, text });
  });
  bot.on('error', error => console.error(`${name}: ${error.message}`));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('end', reason => reject(new Error(`${name} left before spawn: ${reason}`)));
  });
}

function count(name, marker) {
  return received.get(name).filter(packet => packet.text.includes(marker)).length;
}

function expect(marker, wanted) {
  for (const name of names) {
    const actual = count(name, marker);
    const expected = wanted[name] ?? 0;
    if (actual !== expected)
      throw new Error(`${marker}: ${name} expected ${expected}, got ${actual}`);
  }
}

try {
  await fs.writeFile(registry, JSON.stringify(basePairs));
  for (const name of names) await join(name);
  for (const [agent, eye] of [['MirrorAgent', 'MirrorAgent_eye'],
    ['OtherAgent', 'OtherAgent_eye'], ['MirrorAgent', 'UnknownEye'],
    ['CortiLan', 'CortiEye']]) {
    await rcon(`minecraft:gamemode spectator ${eye}`);
    await rcon(`minecraft:spectate ${agent} ${eye}`);
  }
  await pause(1500);
  await rcon('minecraft:tellraw MirrorAgent {"text":"EYE_ROUTE_A_PRIVATE"}');
  await rcon('minecraft:title MirrorAgent title {"text":"EYE_ROUTE_A_TITLE"}');
  await rcon('minecraft:tellraw OtherAgent {"text":"EYE_ROUTE_B_PRIVATE"}');
  await rcon('minecraft:tellraw CortiLan {"text":"EYE_ROUTE_CORTI_PRIVATE"}');
  await rcon('minecraft:tellraw @a {"text":"EYE_ROUTE_BROADCAST"}');
  await pause(1200);
  expect('EYE_ROUTE_A_PRIVATE', { MirrorAgent: 1, MirrorAgent_eye: 1 });
  expect('EYE_ROUTE_A_TITLE', { MirrorAgent: 1, MirrorAgent_eye: 1 });
  expect('EYE_ROUTE_B_PRIVATE', { OtherAgent: 1, OtherAgent_eye: 1 });
  expect('EYE_ROUTE_CORTI_PRIVATE', { CortiLan: 1, CortiEye: 1 });
  expect('EYE_ROUTE_BROADCAST', Object.fromEntries(names.map(name => [name, 1])));

  const routedEffects = [];
  bots.get('MirrorAgent_eye')._client.on('entity_effect', data => routedEffects.push(data));
  await rcon('minecraft:effect give MirrorAgent minecraft:speed 30 0 true');
  await pause(350);
  if (!routedEffects.some(effect => effect.effectId === 0
      && effect.entityId === bots.get('MirrorAgent_eye').entity.id))
    throw new Error('Target speed did not reach the Eye HUD');
  await rcon('minecraft:effect clear MirrorAgent minecraft:speed');

  await fs.writeFile(registry, JSON.stringify({ ...basePairs,
    pairs: basePairs.pairs.filter(pair => pair.agent !== 'OtherAgent') }));
  await pause(6500);
  await rcon('minecraft:tellraw OtherAgent {"text":"EYE_ROUTE_REVOKED"}');
  await pause(1000);
  expect('EYE_ROUTE_REVOKED', { OtherAgent: 1 });
  const detach = await rcon('minecraft:execute as OtherAgent_eye run minecraft:spectate');
  if (!/no longer spectating/i.test(detach)) throw new Error(`Camera detach failed: ${detach}`);
  await fs.writeFile(registry, JSON.stringify(basePairs));
  await pause(6500);
  await rcon('minecraft:spectate OtherAgent OtherAgent_eye');
  await pause(250);
  await rcon('minecraft:tellraw OtherAgent {"text":"EYE_ROUTE_RESTORED"}');
  await pause(1000);
  expect('EYE_ROUTE_RESTORED', { OtherAgent: 1, OtherAgent_eye: 1 });
  await fs.writeFile(registry, JSON.stringify({ ...basePairs,
    pairs: basePairs.pairs.filter(pair => pair.agent !== 'CortiLan') }));
  await pause(6500);
  await rcon('minecraft:tellraw CortiLan {"text":"EYE_ROUTE_CORTI_REVOKED"}');
  await pause(700);
  expect('EYE_ROUTE_CORTI_REVOKED', { CortiLan: 1 });
  await fs.writeFile(registry, JSON.stringify(basePairs));
  await pause(6500);
  await rcon('minecraft:spectate CortiLan CortiEye');
  await pause(300);
  await rcon('minecraft:tellraw CortiLan {"text":"EYE_ROUTE_CORTI_RESTORED"}');
  await pause(700);
  expect('EYE_ROUTE_CORTI_RESTORED', { CortiLan: 1, CortiEye: 1 });
  console.log('PASS: two new Eye routes, Corti regression, effect HUD, broadcast dedup, unregistered isolation, live revocation');
} finally {
  await fs.writeFile(registry, JSON.stringify(basePairs));
  for (const bot of bots.values()) bot.quit();
}
