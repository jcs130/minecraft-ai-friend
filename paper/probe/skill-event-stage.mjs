// Isolated Paper 1.20.6 / port 25566 only: success, failure, coordinates and unicast.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync(process.execPath, [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const suffix = Date.now().toString(36).slice(-6);
const names = [`EventA${suffix}`, `EventB${suffix}`];
const bots = names.map(username => mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username, auth: 'offline', version: '1.20.6',
}));
const events = new Map(names.map(name => [name, []]));
const states = new Map(names.map(name => [name, []]));
const chats = new Map(names.map(name => [name, []]));

for (const bot of bots) {
  bot.on('messagestr', line => chats.get(bot.username).push(line));
  bot._client.on('custom_payload', packet => {
    if (packet.channel === 'mcagent:state') {
      states.get(bot.username).push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
      return;
    }
    if (packet.channel !== 'mcagent:event') return;
    const raw = Buffer.from(packet.data);
    assert.equal(raw[0], 0x7b, 'payload is raw JSON, without writeUTF prefix');
    assert.ok(raw.length <= 16_384, 'event payload limit');
    const event = JSON.parse(raw.toString('utf8'));
    assert.equal(event.schemaVersion, 1);
    assert.equal(event.kind, 'skill');
    assert.ok(event.id && event.title && event.body && event.tone);
    assert.ok(['x', 'y', 'z'].every(axis => Number.isFinite(event.position?.[axis])));
    events.get(bot.username).push(event);
  });
}

const until = async (test, label, limit = 12000) => {
  for (let elapsed = 0; elapsed < limit; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}; chat=${chats.get(names[0]).slice(-8).join(' | ')}`);
};
const own = index => events.get(names[index]);
const ability = (index, id) => states.get(names[index]).at(-1)?.abilities?.find(item => item.id === id);
const cast = async (index, id) => {
  const before = own(index).length;
  bots[index].chat(`/mycli cast ${id}`);
  await until(() => own(index).length > before, `${id} event`);
  assert.equal(own(index).length, before + 1, 'one event per cast');
  return own(index).at(-1);
};

try {
  await Promise.all(bots.map(bot => new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reason => reject(new Error(String(reason))));
  })));
  // B uses Bukkit's registered-channel path; A tests the Mineflayer fallback.
  bots[1]._client.write('custom_payload', {
    channel: 'minecraft:register', data: Buffer.from('mcagent:event'),
  });
  await sleep(2500);
  await until(() => ability(0, 'mycli:starbolt') && ability(1, 'mycli:starbolt'), 'initial states');
  assert.equal(own(0).length + own(1).length, 0, 'login did not cast a skill');

  const fireA = await cast(0, 'fireworks');
  assert.equal(fireA.id, 'fireworks');
  assert.equal(own(1).length, 0, 'A event leaked to B');
  bots[0].chat('/mycli cast fireworks');
  await sleep(450);
  assert.equal(own(0).length, 1, 'cooldown emitted a success event');
  const fireB = await cast(1, 'fireworks');
  assert.equal(fireB.id, 'fireworks');
  assert.equal(own(0).length, 1, 'B event leaked to A');

  rcon(`minecraft:tp ${names[0]} -589.5 91 -329.5`);
  await until(() => bots[0].entity.position.distanceTo(new Vec3(-589.5, 91, -329.5)) < 2,
    'arena arrival');
  rcon('minecraft:summon minecraft:zombie -589.5 91 -325.5 {NoAI:1b,Tags:["SkillEventProbe"]}');
  await until(() => Object.values(bots[0].entities).some(entity =>
    entity.name === 'zombie' && entity.position.distanceTo(new Vec3(-589.5, 91, -325.5)) < 2),
  'zombie spawned');
  await bots[0].lookAt(new Vec3(-589.5, 92.6, -325.5), true);
  const bolt = await cast(0, 'starbolt');
  await until(() => ability(0, 'mycli:starbolt')?.cooldownRemainingMs > 0,
    'starbolt state begins cooldown');
  assert.equal(ability(0, 'mycli:starbolt')?.cooldownMs, 3000);
  assert.equal(ability(1, 'mycli:starbolt')?.cooldownRemainingMs, 0,
    'starbolt cooldown leaked to other player');
  assert.equal(bolt.title, '星芒箭');
  assert.match(bolt.body, /^命中/);
  assert.equal(bolt.tone, 'arcane');
  assert.ok(Math.abs(bolt.position.x + 589.5) < 2 && Math.abs(bolt.position.z + 325.5) < 2,
    'starbolt position must be the hit point');
  assert.equal(own(1).length, 1, 'combat event leaked to B');
  bots[0].chat('/mycli cast starbolt');
  await sleep(450);
  assert.equal(own(0).length, 2, 'combat cooldown emitted a success event');

  const frost = await cast(0, 'frostnova');
  assert.equal(frost.title, '霜环术');
  assert.match(frost.body, /^命中/);
  assert.ok(Math.abs(frost.position.x + 589.5) < 2
    && Math.abs(frost.position.z + 329.5) < 2, 'frostnova position is the range center');

  const home = await cast(0, 'home');
  assert.equal(home.id, 'home');
  assert.ok(Math.abs(home.position.x + 543.5) < 3
    && Math.abs(home.position.z + 439.5) < 3, 'home position is the arrival point');
  rcon(`minecraft:attribute ${names[0]} minecraft:generic.max_health base set 40`);
  await sleep(250);
  const healthBefore = bots[0].health;
  const heal = await cast(0, 'selfheal');
  await until(() => ability(0, 'magicspells:selfheal')?.cooldownRemainingMs > 0,
    'selfheal state begins cooldown');
  assert.equal(ability(0, 'magicspells:selfheal')?.cooldownMs, 15000);
  assert.equal(heal.title, '圣愈术');
  await until(() => bots[0].health > healthBefore, 'MagicSpells healing took effect');
  assert.ok(Math.abs(heal.position.x - bots[0].entity.position.x) < 2,
    'MagicSpells self-heal position belongs to the caster');
  bots[0].chat('/mycli cast selfheal');
  await sleep(450);
  assert.equal(own(0).filter(event => event.id === 'selfheal').length, 1,
    'MagicSpells cooldown emitted a success event');
  await sleep(3200);
  await until(() => ability(0, 'mycli:starbolt')?.cooldownRemainingMs === 0,
    'starbolt cooldown expiry');
  const noTargetBefore = own(0).length;
  const chatBefore = chats.get(names[0]).length;
  bots[0].chat('/mycli cast starbolt');
  await until(() => chats.get(names[0]).slice(chatBefore).some(line =>
    line.includes('没找到怪物')), 'starbolt no-target result');
  assert.equal(own(0).length, noTargetBefore, 'no target emitted a success event');
  assert.ok([...chats.values()].flat().every(line =>
    !line.includes('mcagent:event') && !line.includes('"schemaVersion":1,"kind":"skill"')),
  'custom payload was copied to chat');
  console.log(JSON.stringify({ verdict: 'PASS', unregistered: names[0], registered: names[1],
    eventIdsA: own(0).map(event => event.id), eventIdsB: own(1).map(event => event.id),
    starboltPosition: bolt.position, homePosition: home.position,
    starboltCooldown: true, magicSpellsCooldown: true }));
} finally {
  try { rcon('minecraft:kill @e[type=minecraft:zombie,tag=SkillEventProbe]'); } catch { /* stage only */ }
  for (const bot of bots) bot.quit();
}
