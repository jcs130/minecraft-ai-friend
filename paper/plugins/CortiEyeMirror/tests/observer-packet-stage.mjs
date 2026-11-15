import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../../../ops/rcon-client.mjs';
import { installRecipePacketBypass } from '../../../ops/mineflayer-client-compat.mjs';

const [stage, mode] = process.argv.slice(2);
assert(stage && ['before', 'after'].includes(mode));
assert.equal(await readFile(stage + '/.observer-packets-qa', 'utf8'), 'SYNTHETIC_OBSERVER_QA_ONLY');
const properties = stage + '/server.properties';
const config = (await readFile(properties, 'utf8')).split(/\r?\n/);
for (const line of ['server-ip=127.0.0.1', 'server-port=26473', 'rcon.port=26474']) assert(config.includes(line));
const require = createRequire(process.env.MINEFLAYER_PACKAGE);
const { createBot } = require('mineflayer');
const rc = body => command(body, 12000, { port: 26474, properties });
const watched = new Set([
  'open_window', 'entity_effect', 'remove_entity_effect', 'entity_sound_effect', 'camera',
]);
const clients = [];
const checks = {};
const diagnostics = {};

function check(label, status) {
  checks[label] = Boolean(status);
  console.log(status ? 'PASS' : 'FAIL', label);
}

async function connect(username) {
  const bot = createBot({
    username, host: '127.0.0.1', port: 26473, auth: 'offline', version: '1.21.1', hideErrors: true,
  });
  clients.push(bot);
  bot.events = [];
  bot.problem = null;
  bot.on('error', err => { bot.problem = err.message; });
  bot.on('kicked', reason => { bot.problem = String(reason); });
  bot.on('spawn', () => { bot.physicsEnabled = false; });
  bot._client.on('packet', (data, info) => {
    if (watched.has(info.name)) bot.events.push({ type: info.name, data });
  });
  installRecipePacketBypass(bot._client);
  for (let n = 0; n < 100 && !bot.entity && !bot.problem; n++) await delay(250);
  assert(bot.entity && !bot.problem, username + ': ' + (bot.problem ?? 'spawn timeout'));
  return bot;
}

const packets = (bot, type) => bot.events.filter(event => event.type === type).map(event => event.data);
const titles = bot => packets(bot, 'open_window').map(packet => JSON.stringify(packet));

try {
  const eyeVersion = await rc('version CortiEyeMirror');
  const spectatorVersion = await rc('version SpectatorPlus');
  assert(eyeVersion.includes(mode === 'after' ? '0.1.22-native-presentation' : '0.1.21-hud-baseline'));
  assert(spectatorVersion.includes(mode === 'after' ? '1.2.1-qd-screen-target' : '1.2.1'));

  const first = await connect('QAAlpha');
  const second = await connect('QABeta');
  const switcher = await connect('QASwitcher');
  for (const [scenario, desired] of [['detach', null], ['close', null], ['switch', 'B'], ['stable', 'A']]) {
    switcher.events.length = 0;
    await rc('observerprobe transition QASwitcher QAAlpha ' + scenario + ' QABeta');
    await delay(650);
    const opened = titles(switcher);
    const result = await rc('observerprobe screen QASwitcher');
    diagnostics[scenario] = { opened, result };
    const hasDesired = desired == null ? opened.length === 0 :
      opened.length === 1 && opened[0].includes('QA_CHEST_' + desired);
    check('container ' + scenario, hasDesired && result.includes('synced=' + (desired != null)));
  }
  await rc('minecraft:gamemode survival QASwitcher');
  const gallery = await connect('QAAlpha_eye');
  const primary = await connect('QAPrimary');
  const camera = await connect('QAPrimaryEye');
  for (const [actor, viewer] of [[first, gallery], [primary, camera]]) {
    await rc('minecraft:gamemode spectator ' + viewer.username);
    await rc('minecraft:spectate ' + actor.username + ' ' + viewer.username);
  }
  await delay(2000);
  const routes = [[first, gallery, camera], [primary, camera, gallery]];
  for (const [actor, viewer] of routes) {
    check(viewer.username + ' attached to target', packets(viewer, 'camera').some(p => p.cameraId === actor.entity.id));
  }
  for (const [actor, viewer, unrelated] of routes) {
    const route = viewer.username;
    for (const bot of clients) bot.events.length = 0;
    await rc('minecraft:effect give ' + actor.username + ' minecraft:speed 60 2 true');
    await rc('observerprobe sound ' + actor.username);
    await delay(650);
    await rc('minecraft:effect clear ' + actor.username + ' minecraft:speed');
    await delay(650);

    const source = packets(actor, 'entity_effect').find(p => p.entityId === actor.entity.id && p.amplifier === 2);
    const receipt = packets(viewer, 'entity_effect').filter(p =>
      p.entityId === viewer.entity.id && p.amplifier === 2 && p.effectId === source?.effectId);
    check(route + ' forwards native effect once', source && receipt.length === 1 &&
      receipt[0].duration === source.duration && receipt[0].flags === source.flags);
    check(route + ' removes native effect once', packets(viewer, 'remove_entity_effect').filter(p =>
      p.entityId === viewer.entity.id && p.effectId === source?.effectId).length === 1);
    const isTestSound = p => Math.abs(p.volume - 0.625) < 0.001 && Math.abs(p.pitch - 1.25) < 0.001;
    const sentSound = packets(actor, 'entity_sound_effect').find(isTestSound);
    const recvdSound = packets(viewer, 'entity_sound_effect').filter(isTestSound);
    check(route + ' forwards entity sound once', sentSound && recvdSound.length === 1 &&
      JSON.stringify(recvdSound[0]) === JSON.stringify(sentSound));
    check(route + ' isolates unrelated Eye', !packets(unrelated, 'entity_effect').some(p =>
      p.entityId === unrelated.entity.id && p.amplifier === 2) &&
      !packets(unrelated, 'entity_sound_effect').some(isTestSound));
    diagnostics[route] = {
      source, receipt, sentSound, recvdSound, removed: packets(viewer, 'remove_entity_effect'),
    };
  }
  check('all test players remain connected', clients.every(bot => !bot.problem));

  await delay(600);
  const log = await readFile(stage + '/logs/latest.log', 'utf8');
  const nullTargets = (log.match(/getSpectatorTarget\(\)" is null/g) ?? []).length;
  const cloneErrors = (log.match(/Cannot create instance of class net\.minecraft\.network\.protocol\.game\.Clientbound(?:UpdateMobEffect|SoundEntity)Packet/g) ?? []).length;
  check('zero stale target and clone exceptions', nullTargets === 0 && cloneErrors === 0);
  await writeFile(stage + '/observer-packets.json', JSON.stringify({
    mode, checks, diagnostics, nullTargets, cloneErrors,
  }, null, 2) + '\n');
  if (mode === 'after') {
    assert(Object.values(checks).every(Boolean), 'Candidate has failed checks');
  } else {
    assert(nullTargets && cloneErrors && !checks['container switch'], 'Both original defects must reproduce');
  }
} finally {
  for (const bot of clients.reverse()) bot.quit();
}
