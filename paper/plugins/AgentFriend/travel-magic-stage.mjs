// Isolated 25567 protocol test: voluntary travel spends mana and shows a cast cue.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';

const require = createRequire('E:/MC/probe/package.json');
fix1206PotionProtocol(require);
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/life-buildings-20261003/rcon-stage.mjs', command], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label, timeout = 12000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (check()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}; ${JSON.stringify(bots.map(x => ({ name: x.name,
    pos: x.bot.entity?.position, messages: x.messages.slice(-9), errors: x.errors })))}`);
};
const bots = [];
async function join(prefix) {
  const name = `${prefix}${String(Date.now()).slice(-8)}`;
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567,
    username: name, auth: 'offline', version: '1.20.6' });
  const messages = [], states = [], packets = [], errors = [];
  bot.on('messagestr', line => messages.push(line));
  bot.on('error', error => errors.push(error.message));
  bot.on('kicked', reason => errors.push(`kicked: ${JSON.stringify(reason)}`));
  bot._client.on('packet', (packet, meta) => {
    if (meta.name === 'custom_payload' && packet.channel === 'mcviewer:state')
      states.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
    if (/title|sound|particle/.test(meta.name)) packets.push({ name: meta.name, body: JSON.stringify(packet) });
  });
  const client = { name, bot, messages, states, packets, errors };
  bots.push(client);
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  bot._client.write('custom_payload', {
    channel: 'minecraft:register', data: Buffer.from('mcviewer:state'),
  });
  await until(() => states.at(-1)?.mana, `${name} mana loaded`);
  return client;
}
const mana = client => client.states.at(-1).mana.current;
const travelLines = client => client.messages.filter(line => line.startsWith('MC_TRAVEL '));
const moved = (client, x, z, radius = 5) =>
  Math.abs(client.bot.entity.position.x - x) < radius &&
  Math.abs(client.bot.entity.position.z - z) < radius;
async function cost(client, command, expected, id, amount, label) {
  const before = mana(client), count = travelLines(client).length;
  const packetCount = client.packets.length;
  client.bot.chat(command);
  await until(() => travelLines(client).length > count, label);
  await until(() => mana(client) <= before - amount + .5, `${label} mana`);
  assert.ok(travelLines(client).at(-1).includes(`id=${id} mana=${amount}`),
    `${label} machine receipt: ${travelLines(client).at(-1)}`);
  if (expected) await until(() => moved(client, expected.x, expected.z, expected.radius), `${label} location`);
  const packets = client.packets.slice(packetCount);
  assert.ok(packets.some(packet => packet.name.includes('title')), `${label} title`);
  assert.ok(packets.some(packet => packet.name.includes('particle')), `${label} particles`);
  assert.ok(packets.some(packet => packet.name.includes('sound')), `${label} sound`);
  return { command, before, after: mana(client), receipt: travelLines(client).at(-1) };
}

try {
  const a = await join('TravelA');
  const b = await join('TravelB');
  const baseline = mana(a);
  rcon(`minecraft:tp ${a.name} -589.5 91 -329.5`);
  await until(() => moved(a, -589.5, -329.5), 'admin placement');
  await sleep(200);
  assert.equal(mana(a), baseline, 'server rescue command must not charge the player');

  a.bot.chat('/mycli spells explain home');
  await until(() => a.messages.some(line => line.startsWith('MC_SPELL_DETAIL ')), 'home guide');
  assert.equal(JSON.parse(a.messages.find(line => line.startsWith('MC_SPELL_DETAIL ')).slice(16)).mana, 6);

  const results = [];
  results.push(await cost(a, '/mycli cast home', { x: -543.5, z: -439.5, radius: 12 },
    'home', 6, 'home spell'));
  assert.ok(a.packets.some(packet => packet.name.includes('title')
    && packet.body.includes('空间之力')), 'home-specific incantation');
  results.push(await cost(a, '/mycli goto cherry', null, 'cherry', 6, 'public warp'));
  results.push(await cost(a, '/warp village', { x: -543.5, z: -439.5, radius: 12 },
    'command', 6, 'direct Essentials warp'));

  const deniedMana = mana(a), deniedPosition = a.bot.entity.position.clone();
  const deniedCount = travelLines(a).length, deniedTitles = a.packets.filter(p => p.name.includes('title')).length;
  a.bot.chat('/mycli goto cherry');
  await until(() => a.messages.some(line => line.includes('魔力不足')), 'insufficient mana');
  await sleep(350);
  assert.ok(mana(a) >= deniedMana - .01, 'failed cast spent mana');
  assert.equal(travelLines(a).length, deniedCount, 'failed cast sent success receipt');
  assert.equal(a.packets.filter(p => p.name.includes('title')).length, deniedTitles,
    'failed cast played success title');
  assert.ok(a.bot.entity.position.distanceTo(deniedPosition) < 2, 'failed cast moved player');
  a.bot.chat('/warp cherry');
  await until(() => a.messages.filter(line => line.includes('魔力不足')).length >= 2,
    'direct command insufficient mana');
  assert.ok(a.bot.entity.position.distanceTo(deniedPosition) < 2,
    'direct Essentials warp bypassed mana gate');

  const beforeBadTarget = mana(b);
  b.bot.chat('/mycli goto personal:absent');
  await until(() => b.messages.some(line => line.startsWith('MC_WAYPOINT_RESULT ')
    && JSON.parse(line.slice(19)).reason === 'not_found'), 'missing home');
  assert.ok(mana(b) >= beforeBadTarget - .01, 'missing target spent mana');

  results.push(await cost(b, '/mycli goto guild', null, 'guild', 6, 'guild hall'));
  const beforeTeam = mana(b);
  results.push(await cost(b, `/mycli locate tp ${a.name}`, null, 'team', 8, 'team travel'));
  assert.ok(mana(b) <= beforeTeam - 7.5, 'team travel needs eight mana');
  const cooldownCount = travelLines(b).length;
  b.bot.chat(`/mycli locate tp ${a.name}`);
  await until(() => b.messages.some(line => line.includes('传送冷却还剩')), 'team cooldown');
  assert.equal(travelLines(b).length, cooldownCount, 'cooldown sent success receipt');

  const blink = await join('TravelC');
  rcon('minecraft:forceload add 992 992 1040 1008');
  rcon('minecraft:fill 996 149 996 1030 149 1005 minecraft:stone');
  rcon('minecraft:fill 1012 150 999 1012 153 1001 minecraft:stone');
  rcon(`minecraft:tp ${blink.name} 1000.5 150 1000.5 -90 0`);
  await until(() => moved(blink, 1000.5, 1000.5), 'blink test platform');
  const blinkMana = mana(blink), blinkTravelCount = travelLines(blink).length;
  blink.bot.chat('/mycli cast blink');
  await until(() => blink.bot.entity.position.x > 1004, 'MagicSpells blink');
  await until(() => mana(blink) <= blinkMana - 3.5, 'blink mana');
  assert.ok(mana(blink) >= blinkMana - 4.5, 'blink was charged twice');
  assert.equal(travelLines(blink).length, blinkTravelCount,
    'MagicSpells blink must keep its own 4-mana spell path');

  rcon(`minecraft:tp ${blink.name} 1000.5 150 1000.5 -90 0`);
  await until(() => moved(blink, 1000.5, 1000.5), 'safe private home platform');
  blink.bot.chat('/mycli waypoint add travelqa');
  await until(() => blink.messages.some(line => line.startsWith('MC_WAYPOINT id=personal:travelqa ')),
    'private home saved');
  const privateAt = blink.bot.entity.position.clone();
  rcon(`minecraft:tp ${blink.name} -543.5 67 -439.5`);
  await until(() => moved(blink, -543.5, -439.5), 'private home departure');
  results.push(await cost(blink, '/mycli goto personal:travelqa',
    { x: privateAt.x, z: privateAt.z, radius: 5 }, 'personal:travelqa', 6, 'private home'));
  // Named points are independent of Essentials. Explicitly create a legacy home for /home coverage.
  blink.bot.chat('/sethome travellegacy');
  await sleep(350);
  rcon(`minecraft:tp ${blink.name} -543.5 67 -439.5`);
  await until(() => moved(blink, -543.5, -439.5), 'direct home departure');
  results.push(await cost(blink, '/home travellegacy',
    { x: privateAt.x, z: privateAt.z, radius: 5 }, 'command', 6, 'direct home'));

  const distant = await join('TravelD');
  results.push(await cost(distant, '/mycli guild travel undead_crypt', null,
    'expedition:undead_crypt', 8, 'expedition'));
  results.push(await cost(distant, '/mycli life visit harvest', null,
    'life:harvest', 6, 'life guild'));
  results.push(await cost(distant, '/mycli pvp lobby', null,
    'pvp:lobby', 6, 'pvp lobby'));

  const store = await join('TravelE');
  const storageLines = () => store.messages.filter(line => line.startsWith('MC_STORAGE_MAGIC '));
  const storageMana = mana(store);
  const opening = new Promise(resolve => store.bot.once('windowOpen', resolve));
  store.bot.chat('/mycli arena stash');
  const chest = await opening;
  await until(() => storageLines().length === 1, 'remote chest spell');
  await until(() => mana(store) <= storageMana - 1.5, 'remote chest mana');
  assert.ok(store.packets.some(packet => packet.name.includes('title')
    && packet.body.includes('隔空取物')), 'remote storage incantation');
  store.bot.closeWindow(chest);
  rcon(`minecraft:give ${store.name} minecraft:cobblestone 3`);
  await sleep(200);
  const beforeDeposit = mana(store);
  store.bot.chat('/mycli arena stash put cobblestone 2');
  await until(() => store.messages.some(line => line.startsWith('MC_STASH_PUT')
    && line.includes('moved=2')), 'remote stash deposit');
  await until(() => storageLines().length === 2, 'deposit spell');
  await until(() => mana(store) <= beforeDeposit - 1.5, 'remote deposit mana');
  store.bot.chat('/mycli arena stash list');
  await until(() => store.messages.some(line => line.startsWith('MC_STASH slot=')
    && line.includes('id=minecraft:cobblestone')), 'stash list');
  const slot = Number(store.messages.find(line => line.startsWith('MC_STASH slot=')
    && line.includes('id=minecraft:cobblestone')).match(/slot=(\d+)/)[1]);
  const beforeTake = mana(store);
  store.bot.chat(`/mycli arena stash take ${slot} 1`);
  await until(() => store.messages.some(line => line.startsWith(`MC_STASH_TAKE slot=${slot}`)
    && line.includes('moved=1')), 'remote stash take');
  await until(() => storageLines().length === 3, 'take spell');
  await until(() => mana(store) <= beforeTake - 1.5, 'remote take mana');
  rcon(`minecraft:tp ${store.name} -594.5 91 -313.5`);
  await until(() => moved(store, -594.5, -313.5), 'physical chest vicinity');
  const beforePhysical = mana(store), beforeStorageLines = storageLines().length;
  const physicalOpening = new Promise(resolve => store.bot.once('windowOpen', resolve));
  store.bot.chat('/mycli arena stash');
  const physicalChest = await physicalOpening;
  await sleep(300);
  assert.ok(mana(store) >= beforePhysical - .01, 'physical chest charged mana');
  assert.equal(storageLines().length, beforeStorageLines, 'physical chest played storage spell');
  store.bot.closeWindow(physicalChest);

  const duel = await join('TravelF');
  const beforeRest = mana(duel), beforeRestTravel = travelLines(duel).length;
  duel.bot.chat('/mycli arena rest');
  await until(() => duel.messages.some(line => line.includes('先通关第六层')), 'locked checkpoint');
  assert.ok(mana(duel) >= beforeRest - .01, 'locked checkpoint charged mana');
  assert.equal(travelLines(duel).length, beforeRestTravel, 'locked checkpoint teleported');
  results.push(await cost(duel, '/mycli pvp join', null, 'pvp:join', 6, 'pvp join'));
  const beforePvpLeave = mana(duel), beforeLeaveTravel = travelLines(duel).length;
  duel.bot.chat('/mycli pvp leave');
  await until(() => duel.messages.some(line => line.includes('queue_left')), 'pvp queue exit');
  await sleep(200);
  assert.ok(mana(duel) >= beforePvpLeave - .01, 'pvp return charged mana twice');
  assert.equal(travelLines(duel).length, beforeLeaveTravel, 'pvp return cast another teleport');

  const requester = await join('TravelG'), acceptor = await join('TravelH');
  rcon(`minecraft:tp ${acceptor.name} -589.5 91 -329.5`);
  await until(() => moved(acceptor, -589.5, -329.5), 'tpa target placement');
  const beforeRequest = mana(requester);
  requester.bot.chat(`/tpa ${acceptor.name}`);
  await sleep(250);
  acceptor.bot.chat('/tpaccept');
  await until(() => moved(requester, -589.5, -329.5), 'Essentials tpa arrival');
  await until(() => travelLines(requester).some(line => line.includes('id=command mana=6')),
    'Essentials tpa charged requestor');
  await until(() => mana(requester) <= beforeRequest - 5.5, 'Essentials tpa mana');
  assert.deepEqual(bots.flatMap(client => client.errors), [], 'client errors');
  console.log(JSON.stringify({ verdict: 'PASS', results, baseline,
    blinkMana: mana(blink), storageSpells: storageLines().length,
    tpaManaBefore: beforeRequest, tpaManaAfter: mana(requester) }));
} finally {
  for (const client of bots) client.bot.quit();
  try { rcon('minecraft:forceload remove 992 992 1040 1008'); } catch { }
}
