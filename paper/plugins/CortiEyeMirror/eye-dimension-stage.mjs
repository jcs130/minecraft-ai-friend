// Real Paper 1.20.6 protocol regression; run only after the isolated stage is idle.
// Example: node eye-dimension-stage.mjs --port 25567 --rcon-port 25587
// No watcher is started and no corrective /spectate is issued during world hops.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { readFile, writeFile, unlink, mkdir, realpath, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert.ok(['--stage-dir', '--port', '--rcon-port', '--output', '--package', '--observe-ms', '--agent-name', '--eye-name'].includes(key)
    && value && !value.startsWith('--'), `Unknown or incomplete option: ${key}`);
  assert.ok(!options.has(key), `Repeated option: ${key}`);
  options.set(key, value);
}
const stage = resolve(options.get('--stage-dir') ?? process.env.MC_STAGE_DIR
  ?? 'E:/MC/staging/life-buildings-20261003');
const port = Number(options.get('--port') ?? process.env.MC_STAGE_PORT ?? 25567);
const rconPort = Number(options.get('--rcon-port') ?? process.env.MC_STAGE_RCON_PORT ?? 25587);
const observeMs = Number(options.get('--observe-ms') ?? 20000);
const output = resolve(options.get('--output') ?? join(stage, 'performance-results', `eye-dimension-${Date.now()}.json`));
const require = createRequire(options.get('--package') ?? process.env.MC_MINEFLAYER_PACKAGE ?? 'E:/MC/probe/package.json');
const mineflayer = require('mineflayer');
const registry = join(stage, 'agent-eye-pairs.json');
const suffix = Date.now().toString(36).slice(-5);
const agentName = options.get('--agent-name') ?? `DimA${suffix}`;
const eyeName = options.get('--eye-name') ?? `${agentName}_eye`;
assert.ok(/^[A-Za-z0-9_]{1,16}$/.test(agentName) && /^[A-Za-z0-9_]{1,16}$/.test(eyeName)
  && agentName.toLowerCase() !== eyeName.toLowerCase()
  && ![agentName.toLowerCase(), eyeName.toLowerCase()].includes('goddess'), 'Invalid isolated test pair');
const bots = [];
const anchors = new Map();
const ownedForceloads = new Map();
const homeFixtures = new Map();
const errors = [];
const failures = [];
const cliMarker = 'MC_WAYPOINT id=arena';
const report = { started: new Date().toISOString(), port, rconPort, observeMs, agentName, eyeName,
  note: 'Creative top-level admin tp to temporary marker UUIDs; one-home /mycli waypoint query checks world, position and mana; no watcher or corrective attach during hops. Stage userdata bytes are restored; markers and owned forceloads are removed.', phases: [] };
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
let password, originalRegistry, registryChanged = false, interrupted;
const interrupt = signal => { interrupted = `Interrupted by ${signal}`; };
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const normalPath = path => resolve(path).replaceAll('\\', '/').toLowerCase();
const validOutput = () => normalPath(output).startsWith(normalPath(stage) + '/')
  || normalPath(output).startsWith('e:/mc/ops/repairs/performance-scale-20261005/');

async function rcon(command) {
  return await new Promise((resolveReply, reject) => {
    const socket = net.connect(rconPort, '127.0.0.1');
    let buffer = Buffer.alloc(0), authenticated = false, finished = false, settle, response = '';
    const frame = (id, type, body) => {
      const text = Buffer.from(body, 'utf8'), result = Buffer.alloc(text.length + 14);
      result.writeInt32LE(text.length + 10, 0); result.writeInt32LE(id, 4); result.writeInt32LE(type, 8);
      text.copy(result, 12); return result;
    };
    const finish = error => {
      if (finished) return;
      finished = true; clearTimeout(timeout); clearTimeout(settle); socket.destroy();
      if (error) reject(error); else resolveReply(response.replace(/§[0-9a-fk-or]/gi, '').trim());
    };
    const timeout = setTimeout(() => finish(new Error(`Isolated RCON timeout: ${command}`)), 10000);
    socket.on('error', finish);
    socket.on('connect', () => socket.write(frame(41, 3, password)));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 12) {
        const length = buffer.readInt32LE(0);
        if (length < 10 || length > 1024 * 1024) return finish(new Error('Invalid RCON frame'));
        if (buffer.length < length + 4) return;
        const id = buffer.readInt32LE(4), type = buffer.readInt32LE(8);
        const body = buffer.subarray(12, length + 2).toString('utf8');
        buffer = buffer.subarray(length + 4);
        if (id === -1) return finish(new Error('Isolated RCON authentication failed'));
        if (!authenticated && id === 41 && type === 2) {
          authenticated = true; socket.write(frame(42, 2, command));
        } else if (authenticated && id === 42 && type === 0) {
          response += body; clearTimeout(settle); settle = setTimeout(() => finish(), 100);
        }
      }
    });
  });
}

function healthy() {
  assert.equal(interrupted, undefined, interrupted);
  assert.deepEqual(errors, [], 'Client protocol/disconnect errors');
}
async function until(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    healthy();
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await sleep(100);
  }
  healthy();
}
function snapshot(client) {
  return { entityId: client.bot.entity?.id, cameraId: client.cameraId,
    dimension: client.bot.game?.dimension, protocolWorld: client.protocolWorld,
    position: client.bot.entity?.position?.toArray(), respawns: client.respawns,
    stateChannels: Object.fromEntries([...client.states].map(([channel, values]) => [channel, values.length])) };
}
function attached(agent, eye, dimension) {
  return agent.bot.game?.dimension === dimension && eye.bot.game?.dimension === dimension
    && agent.protocolWorld === `minecraft:${dimension}` && eye.protocolWorld === `minecraft:${dimension}`
    && eye.cameraId === agent.bot.entity?.id;
}
function packetsSince(client, offset, marker, type) {
  return client.presentation.slice(offset).filter(packet => (!type || packet.type === type) && packet.text.includes(marker));
}
function uuidText(bytes) {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function prepareOneHome(username, worldName) {
  const uuid = createHash('md5').update(`OfflinePlayer:${username}`).digest();
  uuid[6] = (uuid[6] & 15) | 48; uuid[8] = (uuid[8] & 63) | 128;
  const folder = join(stage, 'plugins', 'Essentials', 'userdata');
  assert.ok(normalPath(await realpath(folder)).startsWith(normalPath(await realpath(stage)) + '/'),
    'Essentials userdata must stay inside this stage');
  const path = join(folder, `${uuidText(uuid)}.yml`);
  let original;
  try {
    assert.equal((await lstat(path)).isSymbolicLink(), false, 'Userdata must not be a symbolic link');
    original = await readFile(path);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const worldUuid = await readFile(join(stage, worldName, 'uid.dat'));
  assert.equal(worldUuid.length, 16, 'Unexpected stage world UUID format');
  const before = original?.toString('utf8') ?? `last-account-name: ${username}\n`;
  const homes = `homes:\n  eye_dim:\n    world: ${uuidText(worldUuid)}\n    world-name: ${worldName}\n    x: 64.5\n    y: 200.0\n    z: 64.5\n    yaw: 0.0\n    pitch: 0.0\n`;
  const pattern = /^homes:[^\r\n]*(?:\r?\n(?:[ \t]+[^\r\n]*|[ \t]*))*/m;
  const after = pattern.test(before) ? before.replace(pattern, homes)
    : `${before.trimEnd()}\n${homes}`;
  homeFixtures.set(username, { path, original }); // Preserve even a partially successful write.
  await writeFile(path, after);
  assert.equal((after.match(/^homes:/gm) ?? []).length, 1, 'Duplicate homes sections');
  assert.equal((after.match(/^  eye_dim:/gm) ?? []).length, 1, 'Single fixture home was not created');
  return { username, home: 'eye_dim', world: worldName, originalFileExisted: original !== undefined };
}
function mana(client) {
  return client.states.get('mcagent:state')?.at(-1)?.state.mana?.current;
}

async function joinClient(username, role) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, auth: 'offline', version: '1.20.6' });
  const client = { bot, username, role, cameraId: null, protocolWorld: null, respawns: 0,
    ending: false, presentation: [], states: new Map(), effects: [], cameraEvents: [], worldEvents: [] };
  bots.push(client);
  bot.on('error', error => errors.push(`${username}: ${error.message}`));
  bot.on('kicked', reason => errors.push(`${username}: kicked ${JSON.stringify(reason)}`));
  bot.on('end', reason => { if (!client.ending) errors.push(`${username}: disconnected ${reason}`); });
  for (const event of ['login', 'respawn']) bot._client.on(event, packet => {
    const state = packet.worldState ?? packet;
    client.protocolWorld = state.name ?? state.worldName ?? null;
    if (event === 'respawn') client.respawns++;
    client.worldEvents.push({ time: new Date().toISOString(), event, worldName: client.protocolWorld });
  });
  bot._client.on('camera', packet => {
    client.cameraId = packet.cameraId;
    client.cameraEvents.push({ time: new Date().toISOString(), cameraId: packet.cameraId });
  });
  bot._client.on('entity_effect', packet => client.effects.push({ ...packet, at: Date.now() }));
  bot._client.on('packet', (packet, meta) => {
    if (['system_chat', 'profileless_chat', 'action_bar', 'set_title_text'].includes(meta.name))
      client.presentation.push({ type: meta.name, text: JSON.stringify(packet) ?? '', at: Date.now() });
  });
  bot._client.on('custom_payload', packet => {
    if (!['mcagent:state', 'mcviewer:state'].includes(packet.channel)) return;
    try {
      const bytes = Buffer.from(packet.data);
      assert.ok(bytes.length <= 16384 && bytes[0] === 123, 'Expected bounded raw UTF-8 JSON');
      const state = JSON.parse(bytes.toString('utf8'));
      assert.equal(state.schemaVersion, 1);
      assert.ok(state.mana === null || (Number.isFinite(state.mana.current) && Number.isFinite(state.mana.max)));
      const states = client.states.get(packet.channel) ?? [];
      states.push({ at: Date.now(), state }); client.states.set(packet.channel, states);
    } catch (error) { errors.push(`${username}: invalid ${packet.channel}: ${error.message}`); }
  });
  await until(() => bot.entity && bot.game?.dimension, 30000, `${username} spawn`);
  bot._client.write('custom_payload', { channel: 'minecraft:register',
    data: Buffer.from(role === 'agent' ? 'mcagent:state' : 'mcviewer:state') });
  // The spectator's client movement must not fight the server camera position.
  if (role === 'eye') bot.physicsEnabled = false;
  return client;
}

async function checkRoutes(agent, eye, label) {
  const a0 = agent.presentation.length, e0 = eye.presentation.length, fx0 = eye.effects.length;
  const queryBefore = { ...snapshot(agent), mana: mana(agent) };
  assert.ok(Number.isFinite(queryBefore.mana), 'Waypoint query needs a known initial mana value');
  const stateOffset = agent.states.get('mcagent:state')?.length ?? 0;
  const queryStarted = Date.now();
  const marker = `EYE_DIM_${suffix}_${label}`;
  agent.bot.chat('/mycli waypoint');
  await rcon(`minecraft:tellraw ${agentName} ${JSON.stringify({ text: `${marker}_PRIVATE` })}`);
  await rcon(`minecraft:title ${agentName} actionbar ${JSON.stringify({ text: `${marker}_HUD` })}`);
  await rcon(`minecraft:effect give ${agentName} minecraft:speed 8 0 true`);
  try {
    await until(() => packetsSince(agent, a0, `${marker}_PRIVATE`, 'system_chat').length >= 1
      && packetsSince(eye, e0, `${marker}_PRIVATE`, 'system_chat').length >= 1
      && packetsSince(eye, e0, `${marker}_HUD`, 'action_bar').length >= 1
      && packetsSince(agent, a0, cliMarker, 'system_chat').length >= 1
      && packetsSince(eye, e0, cliMarker, 'system_chat').length >= 1
      && eye.effects.slice(fx0).some(effect => effect.effectId === 0 && effect.entityId === eye.bot.entity?.id),
    5000, `${label}: private CLI/chat, actionbar and target speed HUD`);
    await sleep(Math.max(300, 1200 - (Date.now() - queryStarted)));
    assert.equal(packetsSince(eye, e0, `${marker}_PRIVATE`, 'system_chat').length, 1, 'Private message duplicated');
    assert.equal(packetsSince(eye, e0, cliMarker, 'system_chat').length, 1, 'CLI response duplicated');
    for (const [client, offset] of [[agent, a0], [eye, e0]]) {
      assert.equal(packetsSince(client, offset, 'MC_WAYPOINT id=personal:', 'system_chat').length, 1,
        `${client.username}: waypoint query must enumerate exactly one private home`);
      assert.equal(packetsSince(client, offset, 'MC_WAYPOINT id=personal:eye_dim ', 'system_chat').length, 1,
        `${client.username}: the stage fixture home was not enumerated`);
    }
    const queryAfter = { ...snapshot(agent), mana: mana(agent) };
    const positionDelta = Math.hypot(...queryAfter.position.map((value, index) => value - queryBefore.position[index]));
    assert.equal(queryAfter.dimension, queryBefore.dimension, 'Waypoint query changed Agent dimension');
    assert.equal(queryAfter.protocolWorld, queryBefore.protocolWorld, 'Waypoint query sent a world transition');
    assert.equal(queryAfter.respawns, queryBefore.respawns, 'Waypoint query caused a respawn');
    assert.ok(positionDelta < 0.02, `Waypoint query moved the Agent by ${positionDelta} blocks`);
    const observedMana = [queryAfter.mana, ...agent.states.get('mcagent:state').slice(stateOffset)
      .map(packet => packet.state.mana?.current).filter(Number.isFinite)];
    const minMana = Math.min(...observedMana);
    assert.ok(minMana >= queryBefore.mana - 0.001, 'Waypoint query reduced Agent mana');
    return { privateChat: true, privateCli: true, actionBar: true, speedEffectOnEye: true,
      waypointQuery: { before: queryBefore, after: queryAfter, positionDelta, minMana,
        exactlyOneHome: true, worldUnchanged: true, positionUnchanged: true, manaNotReduced: true } };
  } finally { await rcon(`minecraft:effect clear ${agentName} minecraft:speed`); }
}

async function anchor(dimension, index) {
  const key = `${dimension}:${index}`;
  if (anchors.has(key)) return anchors.get(key);
  const value = { dimension, x: 64 + index * 32, y: 200, z: 64, tag: `eye_dim_${suffix}_${index}` };
  anchors.set(key, value); // Cleanup also covers a summon whose response is lost.
  const query = await rcon(`minecraft:execute in minecraft:${dimension} run minecraft:forceload query ${value.x} ${value.z}`);
  if (/is not marked for force loading/i.test(query)) {
    await rcon(`minecraft:execute in minecraft:${dimension} run minecraft:forceload add ${value.x} ${value.z}`);
    ownedForceloads.set(`${dimension}:${value.x}:${value.z}`, value);
  } else assert.match(query, /is marked for force loading/i, `Unexpected forceload result: ${query}`);
  const deadline = Date.now() + 15000;
  while (true) {
    const reply = await rcon(`minecraft:execute in minecraft:${dimension} if loaded ${value.x} ${value.y} ${value.z} run minecraft:summon minecraft:marker ${value.x} ${value.y} ${value.z} ${JSON.stringify({ Tags: [value.tag] })}`);
    if (/Summoned/i.test(reply)) break;
    healthy(); assert.ok(Date.now() < deadline, `Could not create loaded ${dimension} admin destination: ${reply}`);
    await sleep(250);
  }
  const reply = await rcon(`minecraft:execute in minecraft:${dimension} run minecraft:data get entity @e[type=minecraft:marker,tag=${value.tag},limit=1] UUID`);
  const words = reply.match(/\[\s*I;\s*([\d,\s-]+)\]/)?.[1].split(',').map(Number);
  assert.ok(words?.length === 4 && words.every(Number.isInteger), `Cannot read marker UUID: ${reply}`);
  const hex = words.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('');
  value.uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return value;
}

async function adminTeleport(agent, dimension, index) {
  const destination = await anchor(dimension, index);
  // TravelMagic identifies top-level console tp as admin travel. An execute-in
  // wrapper is charged as player magic and can be cancelled when mana runs out.
  // Paper 1.20.6 resolves an entity UUID across all worlds, so this remains an
  // actual admin teleport without moving the Eye or changing the magic rules.
  const reply = await rcon(`minecraft:tp ${agentName} ${destination.uuid}`);
  assert.match(reply, /Teleported/i, `Admin teleport failed: ${reply}`);
  await until(() => agent.bot.game?.dimension === dimension && agent.protocolWorld === `minecraft:${dimension}`
    && agent.bot.entity?.position?.distanceTo({ x: destination.x, y: destination.y, z: destination.z }) < 3,
  10000, `${dimension}: Agent actually accepted admin teleport`);
  return destination;
}

async function phase(agent, eye, dimension, index) {
  const record = { label: dimension, started: new Date().toISOString(), before: { agent: snapshot(agent), eye: snapshot(eye) } };
  report.phases.push(record);
  const eyeRespawnsBefore = eye.respawns;
  record.crossWorldExpected = eye.protocolWorld !== `minecraft:${dimension}`;
  try {
    assert.ok(attached(agent, eye, agent.bot.game?.dimension), 'Hop started without an attached Eye in the Agent world');
    record.adminDestination = await adminTeleport(agent, dimension, index); record.agentTeleportAccepted = true;
  }
  catch (error) {
    record.agentTeleportAccepted = false; record.failure = error.message;
    record.after = { agent: snapshot(agent), eye: snapshot(eye) }; record.ended = new Date().toISOString();
    failures.push(`Test setup ${dimension}: ${error.message}`); return;
  }
  try {
    await until(() => attached(agent, eye, dimension), observeMs, `${dimension}: automatic camera/world follow`);
    await sleep(800);
    assert.ok(attached(agent, eye, dimension), 'Camera detached again after the initial follow');
    if (record.crossWorldExpected) assert.ok(eye.respawns > eyeRespawnsBefore, 'Eye received no dimension respawn packet');
    record.autoFollow = true;
  } catch (error) { record.autoFollow = false; record.failure = error.message; failures.push(`${dimension}: ${error.message}`); }
  try {
    record.routes = await checkRoutes(agent, eye, `${index}_${dimension}`);
    assert.ok(attached(agent, eye, dimension), 'Agent or Eye left the intended world during private presentation probes');
  }
  catch (error) { record.routeFailure = error.message; failures.push(`${dimension}: ${error.message}`); }
  record.eyeRespawnDelta = eye.respawns - eyeRespawnsBefore;
  record.after = { agent: snapshot(agent), eye: snapshot(eye) };
  record.ended = new Date().toISOString();
  console.log(JSON.stringify({ phase: dimension, autoFollow: record.autoFollow, routes: record.routes,
    failure: record.failure, routeFailure: record.routeFailure, after: record.after }));
}

try {
  assert.ok(normalPath(stage).includes('/staging/'), 'Stage must be inside an isolated staging directory');
  assert.ok(normalPath(await realpath(stage)).includes('/staging/'), 'Stage resolves outside staging');
  for (const value of [port, rconPort]) assert.ok(Number.isInteger(value) && value >= 1024 && value <= 65535);
  assert.ok(![25565, 25575].includes(port) && ![25565, 25575].includes(rconPort) && port !== rconPort,
    'Refusing production or overlapping ports');
  assert.ok(Number.isInteger(observeMs) && observeMs >= 15000 && observeMs <= 30000,
    'Observe automatic following for 15–30 seconds, not the external watcher refresh interval');
  assert.ok(validOutput(), 'Report must stay inside the isolated stage or the performance repair folder');
  try {
    const previous = JSON.parse(await readFile(output, 'utf8'));
    if (previous.previousFailedAttempts?.length) report.previousFailedAttempts = previous.previousFailedAttempts.slice(-3);
    if (previous.verdict === 'FAIL') report.previousFailedAttempts = [...(previous.previousFailedAttempts ?? []),
      { started: previous.started, ended: previous.ended, failures: previous.failures,
        phases: previous.phases, clients: previous.clients, registryRestored: previous.registryRestored }].slice(-3);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const properties = await readFile(join(stage, 'server.properties'), 'utf8');
  assert.equal(Number(properties.match(/^server-port=(\d+)\s*$/m)?.[1]), port);
  assert.equal(Number(properties.match(/^rcon\.port=(\d+)\s*$/m)?.[1]), rconPort);
  password = properties.match(/^rcon\.password=(.*)$/m)?.[1].trim();
  assert.ok(password, 'Isolated RCON password is missing');
  assert.match(properties, /^online-mode=false\s*$/m, 'Home UUID fixtures require an offline isolated stage');
  const worldName = properties.match(/^level-name=(.*)$/m)?.[1].trim() ?? 'world';
  assert.ok(/^[A-Za-z0-9_-]+$/.test(worldName), 'Unexpected isolated world folder name');
  for (const [plugin, pattern] of [['AgentFriend', /^\s*eye-pairs-file:\s*(.+)$/m],
    ['CortiEyeMirror', /^pairs-file:\s*(.+)$/m]]) {
    const config = await readFile(join(stage, 'plugins', plugin, 'config.yml'), 'utf8');
    const configured = config.match(pattern)?.[1].trim().replace(/^['"]|['"]$/g, '');
    assert.ok(configured && normalPath(configured) === normalPath(registry), `${plugin} must use this stage registry`);
  }
  try {
    assert.equal((await lstat(registry)).isSymbolicLink(), false, 'Registry must not be a symbolic link');
    assert.equal(normalPath(await realpath(registry)), normalPath(join(await realpath(stage), 'agent-eye-pairs.json')));
    originalRegistry = await readFile(registry);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const online = await rcon('minecraft:list');
  const onlineCount = online.match(/There are (\d+) of a max of \d+ players online/i);
  assert.ok(onlineCount, `Cannot establish stage online count: ${online}`);
  assert.equal(Number(onlineCount[1]), 0, 'Stage must have zero online players before replacing its registry');
  for (const dimension of ['overworld', 'the_nether', 'the_end']) {
    const reply = await rcon(`minecraft:execute in minecraft:${dimension} run minecraft:gamerule spectatorsGenerateChunks`);
    assert.match(reply, /spectatorsGenerateChunks.*true/i, `${dimension}: keep spectatorsGenerateChunks=true`);
  }
  report.homeFixtures = [];
  for (const username of [agentName, eyeName]) report.homeFixtures.push(await prepareOneHome(username, worldName));
  registryChanged = true;
  await writeFile(registry, JSON.stringify({ schemaVersion: 1, pairs: [{ agent: agentName, eye: eyeName }] }));
  // Both tag and mirror readers must have time to consume the stage-only pair.
  await sleep(6500);
  const agent = await joinClient(agentName, 'agent');
  const eye = await joinClient(eyeName, 'eye');
  await sleep(5000); // The primary join attach callbacks run at 40 ticks; let them settle.
  await rcon(`minecraft:gamemode creative ${agentName}`);
  agent.bot.creative.startFlying();
  await rcon(`minecraft:gamemode spectator ${eyeName}`);
  await adminTeleport(agent, 'overworld', 0);
  const initialAttach = await rcon(`minecraft:spectate ${agentName} ${eyeName}`);
  assert.match(initialAttach, /Now spectating/i, `Initial attach refused: ${initialAttach}`);
  await until(() => attached(agent, eye, 'overworld'), observeMs, 'initial camera/world attachment');
  await until(() => agent.states.get('mcagent:state')?.some(packet => packet.state.mana !== null)
    && eye.states.get('mcviewer:state')?.some(packet => packet.state.mana !== null),
  observeMs, 'loaded Agent raw state and Eye personal viewer state');
  for (const [index, dimension] of ['overworld', 'the_nether', 'the_end', 'overworld'].entries())
    await phase(agent, eye, dimension, index);
  const detachReply = await rcon(`minecraft:execute as ${eyeName} run minecraft:spectate`);
  assert.match(detachReply, /No longer spectating/i, `Detach refused: ${detachReply}`);
  await until(() => eye.cameraId === eye.bot.entity?.id, 5000, 'explicit /spectate camera detach');
  const detachedOffset = eye.presentation.length, detachedMarker = `EYE_DIM_${suffix}_DETACHED`;
  await rcon(`minecraft:tellraw ${agentName} ${JSON.stringify({ text: detachedMarker })}`);
  await sleep(1200);
  assert.equal(packetsSince(eye, detachedOffset, detachedMarker).length, 0, 'Detached Eye still received private target chat');
  const detachedWorld = eye.protocolWorld, detachedRespawns = eye.respawns;
  await adminTeleport(agent, 'the_nether', 4);
  await sleep(2500);
  assert.equal(eye.cameraId, eye.bot.entity?.id, 'Detached Eye was forced to reattach on Agent world change');
  assert.equal(eye.protocolWorld, detachedWorld, 'Detached Eye was teleported along with its former Agent');
  assert.equal(eye.respawns, detachedRespawns, 'Detached Eye received a world respawn packet');
  const detachedHopOffset = eye.presentation.length, detachedHopMarker = `${detachedMarker}_HOP`;
  await rcon(`minecraft:tellraw ${agentName} ${JSON.stringify({ text: detachedHopMarker })}`);
  await sleep(500);
  assert.equal(packetsSince(eye, detachedHopOffset, detachedHopMarker).length, 0, 'Detached Eye received private chat after Agent world change');
  report.detachedWorldHop = { agent: snapshot(agent), eye: snapshot(eye), notForcedToAttach: true, privateChatBlocked: true };
  await adminTeleport(agent, 'overworld', 5);
  const reattachReply = await rcon(`minecraft:spectate ${agentName} ${eyeName}`);
  assert.match(reattachReply, /Now spectating/i, `Reattach refused: ${reattachReply}`);
  await until(() => attached(agent, eye, 'overworld'), observeMs, 'explicit reattachment');
  report.detachReattach = { detachedPrivateChatBlocked: true, routes: await checkRoutes(agent, eye, 'REATTACHED') };
  await writeFile(registry, JSON.stringify({ schemaVersion: 1, pairs: [] }));
  await sleep(6500);
  const revokedAgentOffset = agent.presentation.length, revokedEyeOffset = eye.presentation.length;
  const revokedEffectOffset = eye.effects.length, revokedMarker = `EYE_DIM_${suffix}_REVOKED`;
  agent.bot.chat('/mycli waypoint');
  await rcon(`minecraft:tellraw ${agentName} ${JSON.stringify({ text: `${revokedMarker}_PRIVATE` })}`);
  await rcon(`minecraft:title ${agentName} actionbar ${JSON.stringify({ text: `${revokedMarker}_HUD` })}`);
  await rcon(`minecraft:effect give ${agentName} minecraft:speed 8 0 true`);
  await sleep(1000);
  assert.ok(packetsSince(agent, revokedAgentOffset, `${revokedMarker}_PRIVATE`, 'system_chat').length,
    'Revocation probe did not reach the Agent');
  assert.ok(packetsSince(agent, revokedAgentOffset, cliMarker, 'system_chat').length,
    'Revocation CLI probe did not reach the Agent');
  assert.equal(packetsSince(eye, revokedEyeOffset, `${revokedMarker}_PRIVATE`).length, 0, 'Revoked Eye received private chat');
  assert.equal(packetsSince(eye, revokedEyeOffset, `${revokedMarker}_HUD`).length, 0, 'Revoked Eye received target actionbar');
  assert.equal(packetsSince(eye, revokedEyeOffset, cliMarker).length, 0, 'Revoked Eye received private CLI output');
  assert.ok(!eye.effects.slice(revokedEffectOffset).some(effect => effect.effectId === 0 && effect.entityId === eye.bot.entity?.id),
    'Revoked Eye received target speed HUD');
  await rcon(`minecraft:effect clear ${agentName} minecraft:speed`);
  report.revocation = { privateChatBlocked: true, privateCliBlocked: true, actionBarBlocked: true, speedHudBlocked: true };
  healthy();
} catch (error) { failures.push(error.stack ?? error.message); }
finally {
  // Preserve cleanup failures as failures too; never print PASS before cleanup.
  for (const client of bots) {
    client.ending = true;
    try { client.bot.quit('Isolated Eye dimension test finished'); }
    catch (error) { failures.push(`Client cleanup: ${error.message}`); }
  }
  await sleep(300);
  for (const client of bots) {
    if (!client.bot._client.ended) client.bot._client.end('Isolated test cleanup');
  }
  for (const value of anchors.values()) {
    try {
      await rcon(`minecraft:execute in minecraft:${value.dimension} run minecraft:kill @e[type=minecraft:marker,tag=${value.tag}]`);
    } catch (error) { failures.push(`Marker cleanup ${value.dimension}: ${error.message}`); }
  }
  for (const value of ownedForceloads.values()) {
    try {
      await rcon(`minecraft:execute in minecraft:${value.dimension} run minecraft:forceload remove ${value.x} ${value.z}`);
    } catch (error) { failures.push(`Forceload cleanup ${value.dimension}: ${error.message}`); }
  }
  report.scratchMarkersRemoved = !failures.some(value => value.startsWith('Marker cleanup'));
  report.forceloadsRestored = !failures.some(value => value.startsWith('Forceload cleanup'));
  if (registryChanged) {
    try {
      if (originalRegistry === undefined) await unlink(registry);
      else await writeFile(registry, originalRegistry);
      if (originalRegistry !== undefined) assert.ok((await readFile(registry)).equals(originalRegistry),
        'Restored registry differs from its original bytes');
      report.registryRestored = true;
    } catch (error) { failures.push(`Registry restoration failed: ${error.message}`); report.registryRestored = false; }
  }
  if (bots.length) {
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const reply = await rcon('minecraft:list');
        const count = reply.match(/There are (\d+) of a max of \d+ players online/i);
        assert.ok(count, `Cannot verify client cleanup: ${reply}`);
        report.onlineAfter = Number(count[1]);
        if (report.onlineAfter === 0) break;
        await sleep(200);
      }
      assert.equal(report.onlineAfter, 0, 'Test clients remain online after cleanup');
    } catch (error) { failures.push(`Client cleanup verification: ${error.message}`); }
  }
  if (homeFixtures.size) {
    // Let the logout userdata save finish before restoring the preserved bytes.
    await sleep(1200);
    report.homeFixtureDataRestored = true;
    for (const [username, value] of homeFixtures) {
      try {
        if (value.original === undefined) {
          try { await unlink(value.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          await assert.rejects(readFile(value.path), error => error.code === 'ENOENT');
        } else {
          await writeFile(value.path, value.original);
          assert.ok((await readFile(value.path)).equals(value.original), 'Userdata differs from its original bytes');
        }
      } catch (error) { failures.push(`Home userdata restoration ${username}: ${error.message}`); report.homeFixtureDataRestored = false; }
    }
  }
  report.clients = bots.map(client => ({ username: client.username, ...snapshot(client),
    cameraEvents: client.cameraEvents, worldEvents: client.worldEvents }));
  report.errors = errors; report.failures = failures; report.verdict = failures.length || errors.length ? 'FAIL' : 'PASS';
  report.ended = new Date().toISOString();
  try {
    if (validOutput() && normalPath(stage).includes('/staging/')) {
      await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
    }
  } catch (error) { failures.push(`Report write failed: ${error.message}`); report.verdict = 'FAIL'; }
  console.log(JSON.stringify(report, null, 2));
  if (report.verdict !== 'PASS') process.exitCode = 1;
}
