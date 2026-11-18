const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');

const [directory, javaModules, bedrockModules, mode = 'candidate'] = process.argv.slice(2);
const stage = path.resolve(directory);
assert.equal(fs.readFileSync(path.join(stage, '.better-combat-crossplay-test'), 'utf8'), 'SYNTHETIC_ONLY');
const ports = JSON.parse(fs.readFileSync(path.join(stage, 'ready.json'), 'utf8'));
assert.equal(ports.syntheticOnly, true);
const log = path.join(stage, 'logs/latest.log');
const host = '127.0.0.1';
const viewerName = 'BCQAViewer';
const nativeName = 'BCQANative';
const agentName = 'BCQAAgent';
const bedrockName = 'BCQABedrock';
const read = () => fs.readFileSync(log, 'utf8');
const rows = [];

async function waitFor(predicate, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await sleep(80);
  }
  throw Error('Fixture state did not arrive');
}

async function rcon(command) {
  const socket = net.createConnection({ host, port: ports.rconPort });
  let data = Buffer.alloc(0);
  const completion = new Promise((resolve, reject) => {
    socket.setTimeout(4000, () => reject(Error('RCON timeout')));
    socket.on('error', reject);
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      while (data.length >= 4 && data.length >= 4 + data.readInt32LE(0)) {
        const length = data.readInt32LE(0);
        const id = data.readInt32LE(4);
        const type = data.readInt32LE(8);
        const result = data.subarray(12, length + 2).toString('utf8');
        data = data.subarray(length + 4);
        if (id === -1) reject(Error('Fixture RCON authentication failed'));
        else if (id === 1 && type === 2) send(2, 2, command);
        else if (id === 2) resolve(result);
      }
    });
  });
  function send(id, type, text) {
    const bytes = Buffer.from(text, 'utf8');
    const packet = Buffer.alloc(14 + bytes.length);
    packet.writeInt32LE(10 + bytes.length, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(type, 8);
    bytes.copy(packet, 12);
    socket.write(packet);
  }
  try {
    await once(socket, 'connect');
    send(1, 3, ports.rconPassword);
    return await completion;
  } finally {
    socket.destroy();
  }
}

function entityId(name) {
  return Number([...read().matchAll(new RegExp(`BCQA_READY ${name} (\\d+)`, 'g'))].at(-1)?.[1]);
}

function packets(text, actor) {
  return [...text.matchAll(/BCQA_ANIMATION (\w+) (\d+) (\w+) (\S+) (\S+)/g)]
    .filter(match => Number(match[2]) === entityId(actor))
    .map(([, to, , hand, animation, ticks]) => ({ to, hand, animation, ticks: Number(ticks) }));
}

async function setup(key, actor, main, off = 'air', extra = '', distance = 2) {
  await rcon('kill @e[tag=bcqa_target]');
  await sleep(1100);
  await rcon(`tp ${actor} 1.5 -60 0.5 0 0`);
  await rcon(`item replace entity ${actor} weapon.mainhand with minecraft:${main}`);
  await rcon(`item replace entity ${actor} weapon.offhand with minecraft:${off}`);
  await rcon(`summon minecraft:zombie 1.5 -60 ${0.5 + distance} {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["bcqa_target","bcqa_case_${key}"${extra ? `,"bcqa_${extra}"` : ''}]}`);
  await sleep(780);
}

async function check(key, actor, attack, { damage = 1, animation = mode === 'candidate' ? 1 : 0, cancelled = 0 } = {}) {
  const offset = read().length;
  await attack();
  await sleep(1250);
  const result = read().slice(offset);
  const events = [...result.matchAll(new RegExp(`BCQA_DAMAGE bcqa_case_${key} \\S+ (\\w+) (true|false) ([\\d.]+)`, 'g'))];
  const accepted = events.filter(event => event[2] === 'false' && Number(event[3]) > 0);
  const rejected = events.filter(event => event[2] === 'true');
  const sent = packets(result, actor);
  const watched = sent.filter(packet => packet.to === viewerName);
  const row = { key, actor, accepted: accepted.length, cancelled: rejected.length, events: events.map(event => event.slice(1)), packets: sent };
  rows.push(row);
  assert.equal(accepted.length, damage, JSON.stringify(row));
  assert.equal(rejected.length, cancelled, JSON.stringify(row));
  assert.equal(watched.length, animation, JSON.stringify(row));
  assert.ok(sent.every(packet => packet.to === viewerName || (actor === nativeName && packet.to === nativeName)), JSON.stringify(row));
  return watched[0];
}

async function main() {
  const java = createRequire(path.resolve(javaModules));
  const bedrock = createRequire(path.resolve(bedrockModules))('bedrock-protocol');
  await waitFor(() => entityId(viewerName), 30000);
  await rcon('gamerule doMobSpawning false');
  await rcon('time set midnight');
  await rcon(`gamemode spectator ${viewerName}`);
  await rcon(`tp ${viewerName} 3.6 -59.8 3.6 facing 1.5 -59 1.1`);
  if (mode === 'candidate') {
    await waitFor(() => entityId(nativeName), 30000);
    await rcon(`tp ${nativeName} 1024.5 -60 1024.5`);
  }
  const options = { host, port: ports.javaPort, version: '1.21.1', auth: 'offline' };
  let bot = java('mineflayer').createBot({ ...options, username: agentName });
  const plainViewer = java('mineflayer').createBot({ ...options, username: 'BCQAPlainViewer' });
  const bed = bedrock.createClient({ host, port: ports.bedrockPort, username: bedrockName, version: '1.26.60',
    offline: true, skipPing: true, transport: 'raknet', raknetBackend: 'raknet-native', connectTimeout: 16000 });
  const errors = [];
  const bedEntities = new Map();
  const bedItems = new Map();
  let bedPosition;
  let bedReady = false;
  let bedSwing = 0;
  bed.on('start_game', packet => { bedPosition = packet.player_position; });
  bed.on('move_player', packet => {
    if (packet.mode === 'teleport' && BigInt(packet.runtime_id) === BigInt(bed.entityId)) bedPosition = packet.position;
  });
  bed.on('add_entity', packet => bedEntities.set(String(packet.unique_id), packet));
  bed.on('remove_entity', packet => bedEntities.delete(String(packet.entity_id_self)));
  bed.on('inventory_slot', packet => { if (packet.window_id === 'inventory') bedItems.set(packet.slot, packet.item); });
  bed.on('inventory_content', packet => {
    if (packet.window_id === 'inventory') packet.input.forEach((item, slot) => bedItems.set(slot, item));
  });
  bed.on('animate', () => { bedSwing++; });
  bed.on('spawn', () => { bedReady = true; });
  bed.on('error', error => errors.push('Bedrock: ' + error.message));
  bed.on('disconnect', packet => errors.push('Bedrock: ' + packet.message));
  function monitor(client) {
    client.on('error', error => errors.push(client.username + ': ' + error.message));
    client.on('kicked', error => errors.push(client.username + ': ' + JSON.stringify(error)));
  }
  monitor(bot);
  monitor(plainViewer);
  try {
    await waitFor(() => bot.entity && plainViewer.entity && entityId(agentName) && entityId(plainViewer.username));
    await rcon(`tp ${plainViewer.username} 4.5 -60 3.5`);
    const botAttack = async () => {
      const target = bot.nearestEntity(entity => entity.name === 'zombie');
      assert.ok(target, 'Mineflayer received the target');
      await bot.lookAt(target.position.offset(0, 1.2, 0), true);
      bot.attack(target);
    };

    await setup('sword', agentName, 'iron_sword');
    const sword = await check('sword', agentName, botAttack);
    await setup('air', agentName, 'iron_sword');
    await check('air', agentName, () => bot.swingArm('right'), { damage: 0, animation: 0 });
    await setup('unarmed', agentName, 'air', 'iron_sword');
    await check('unarmed', agentName, botAttack, { animation: 0 });
    await setup('cancelled', agentName, 'iron_sword', 'air', 'cancel');
    await check('cancelled', agentName, botAttack, { damage: 0, animation: 0, cancelled: 1 });
    await setup('range', agentName, 'iron_sword', 'air', '', 22);
    await check('range', agentName, botAttack, { damage: 0, animation: 0 });
    await setup('arrow', agentName, 'bow', 'air', '', 6);
    await rcon(`give ${agentName} arrow 4`);
    await check('arrow', agentName, async () => {
      const target = bot.nearestEntity(entity => entity.name === 'zombie');
      assert.ok(target, 'Mineflayer received the arrow target');
      await bot.lookAt(target.position.offset(0, 1.3, 0), true);
      bot.activateItem();
      await sleep(1250);
      bot.deactivateItem();
    }, { animation: 0 });
    await setup('swap', agentName, 'iron_sword', 'iron_axe', 'swap');
    const swap = await check('swap', agentName, botAttack);
    await setup('axe', agentName, 'iron_axe', 'iron_sword');
    const axe = await check('axe', agentName, botAttack);
    if (mode === 'candidate') {
      assert.equal(swap.animation, sword.animation, 'Use the weapon at impact despite a damage-listener swap');
      assert.equal(swap.hand, 'MAIN_HAND');
      assert.equal(axe.hand, 'MAIN_HAND');
      assert.ok(axe.ticks > swap.ticks, 'Keep the pre-hit sword timing, and use the axe timing when it is the main weapon');
      assert.ok(sword.ticks > 1 && axe.ticks > 1, 'Better Combat animation duration is measured in ticks');
    }

    if (mode === 'candidate') {
      const oldTarget = bot.nearestEntity(entity => entity.name === 'zombie').id;
      const oldSession = entityId(agentName);
      const ended = once(bot, 'end');
      bot.quit();
      await ended;
      await rcon('kill @e[tag=bcqa_target]');
      bot = java('mineflayer').createBot({ ...options, username: agentName });
      monitor(bot);
      await waitFor(() => bot.entity && entityId(agentName) !== oldSession);
      await sleep(1200);
      await check('old_target', agentName, () => bot._client.write('use_entity', {
        target: oldTarget, mouse: 1, sneaking: false,
      }), { damage: 0, animation: 0 });
      await setup('reconnect', agentName, 'iron_sword');
      await check('reconnect', agentName, botAttack);
      await waitFor(() => bedReady && entityId(bedrockName), 18000);
      await setup('bedrock', bedrockName, 'iron_sword');
      await check('bedrock', bedrockName, async () => {
        const target = [...bedEntities.values()].find(entity => entity.entity_type === 'minecraft:zombie'
          && Math.abs(entity.position.z - 2.5) < 0.2);
        assert.ok(target && bedPosition, 'Geyser supplied the real target and local player position');
        const vec = { x: 0, y: 0, z: 0 };
        bed.write('inventory_transaction', { transaction: {
          legacy: { legacy_request_id: 0 }, transaction_type: 'item_use_on_entity', actions: [],
          transaction_data: { entity_runtime_id: target.runtime_id, action_type: 'attack', hand: 'main_hand', hotbar_slot: 0,
            held_item: bedItems.get(0), player_pos: bedPosition, click_pos: vec },
        } });
      });
      await setup('native', nativeName, 'iron_sword');
      await check('native', nativeName, () => fs.writeFileSync(path.join(stage, 'native/attack-once'), ''), { animation: 1 });
      assert.ok(bedSwing > 0, 'Geyser still sends normal Bedrock animation events');
    }
    assert.deepEqual(errors, []);
  } finally {
    const report = { mode, rows, bedrockSpawned: bedReady, bedrockAnimations: bedSwing, errors };
    fs.writeFileSync(path.join(stage, 'matrix.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    bot.quit();
    plainViewer.quit();
    bed.close();
  }
}

main().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
});
