// Paper 1.20.6 multi-connection load check. Run only against an isolated world.
// The clients exercise vanilla movement and the real Agent/Viewer channels;
// this is not a test of autonomous LLM play, combat, or new-chunk exploration.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, open, mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const stage = resolve(process.env.MC_STAGE_DIR ?? 'E:/MC/staging/life-buildings-20261003');
const port = Number(process.env.MC_STAGE_PORT ?? 25567);
const rconFile = resolve(process.env.MC_STAGE_RCON ?? join(stage, 'rcon-stage.mjs'));
const levels = (process.env.MC_PERF_AGENTS ?? '8,16').split(',').map(Number);
const durationMs = Number(process.env.MC_PERF_DURATION_MS ?? 75000);
const warmupMs = Number(process.env.MC_PERF_WARMUP_MS ?? 15000);
const groundAgents = Number(process.env.MC_PERF_GROUND_AGENTS ?? 0);
const skillBurstAgents = Number(process.env.MC_PERF_SKILL_BURST_AGENTS ?? 0);
const requestedModes = process.env.MC_PERF_MODES?.split(',').map(mode => ({
  idle: 'same-area-idle', walk: 'generated-distributed-walk', 'ground-walk': 'ground-distributed-walk',
}[mode] ?? mode));
const output = resolve(process.env.MC_PERF_OUTPUT ?? join(stage, 'performance-results', `${Date.now()}.json`));
const require = createRequire(process.env.MC_MINEFLAYER_PACKAGE ?? 'E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const registryFile = join(stage, 'agent-eye-pairs.json');
const ownedForceload = new Map();
const suffix = Date.now().toString(36).slice(-5);
const strip = value => value.replace(/\u001b\[[0-9;]*m/g, '').replace(/§[0-9a-fk-or]/gi, '');

assert.match(stage.replaceAll('\\', '/'), /\/staging\//i, 'MC_STAGE_DIR must be inside an isolated staging directory');
assert.notEqual(port, 25565, 'Refusing the live Java port');
assert.ok(port >= 1024 && port <= 65535);
assert.equal(resolve(rconFile).toLowerCase(), resolve(join(stage, 'rcon-stage.mjs')).toLowerCase(),
  'RCON helper must belong to the same isolated stage');
assert.ok(levels.length > 0 && levels.every(n => Number.isInteger(n) && n >= 1 && n <= 16),
  'Current registry accepts at most 16 pairs; expand and verify that boundary before testing more');
assert.ok(durationMs >= 65000 && durationMs <= 600000, 'Use a full, unmixed 1-minute MSPT window');
assert.ok(warmupMs >= 5000 && warmupMs <= 120000);
assert.ok(Number.isInteger(groundAgents) && groundAgents >= 0 && groundAgents <= levels.at(-1));
assert.ok(Number.isInteger(skillBurstAgents) && skillBurstAgents >= 0 && skillBurstAgents <= groundAgents);
assert.ok(!requestedModes || (requestedModes.length > 0 && requestedModes.every(mode =>
  ['same-area-idle', 'generated-distributed-walk', 'ground-distributed-walk'].includes(mode))));
if (requestedModes?.includes('ground-distributed-walk')) assert.ok(groundAgents > 0 && levels.length === 1);
const runtimeOutput = output.replaceAll('\\', '/').toLowerCase();
assert.ok(runtimeOutput.startsWith(stage.replaceAll('\\', '/').toLowerCase() + '/')
  || runtimeOutput.startsWith('e:/mc/ops/repairs/performance-scale-20261005/'), 'Write reports in the isolated stage or this repair folder');
const properties = await readFile(join(stage, 'server.properties'), 'utf8');
assert.equal(Number(properties.match(/^server-port=(\d+)$/m)?.[1]), port);
const rconPort = Number(properties.match(/^rcon\.port=(\d+)$/m)?.[1]);
const rconPassword = properties.match(/^rcon\.password=(.*)$/m)?.[1].trim();
assert.ok(rconPassword && Number.isInteger(rconPort) && rconPort >= 1024 && rconPort <= 65535 && rconPort !== 25575,
  'Refusing an invalid or production RCON endpoint');
assert.ok(Number(properties.match(/^max-players=(\d+)$/m)?.[1]) >= Math.max(...levels) * 2,
  'Isolated max-players must fit every Agent plus its Eye');
const tagConfig = await readFile(join(stage, 'plugins', 'AgentFriend', 'config.yml'), 'utf8');
const eyeConfig = await readFile(join(stage, 'plugins', 'CortiEyeMirror', 'config.yml'), 'utf8');
for (const [name, config, pattern] of [
  ['AgentFriend', tagConfig, /^\s*eye-pairs-file:\s*(.+)$/m],
  ['CortiEyeMirror', eyeConfig, /^pairs-file:\s*(.+)$/m],
]) {
  const configured = config.match(pattern)?.[1].trim().replace(/^['"]|['"]$/g, '');
  assert.ok(configured, `${name} must explicitly select the isolated registry`);
  assert.equal(resolve(configured).toLowerCase(), resolve(registryFile).toLowerCase(),
    `${name} registry must point at this stage, never at the production ops registry`);
}

async function rcon(command) {
  // The older stage helper treats empty successful replies as timeouts.
  // Use this fixed loopback endpoint and accept the command's empty response.
  return await new Promise((resolveResponse, reject) => {
    const socket = net.connect(rconPort, '127.0.0.1');
    let buffered = Buffer.alloc(0), authenticated = false, finished = false;
    const packet = (id, type, body) => {
      const data = Buffer.from(body, 'utf8'), result = Buffer.alloc(data.length + 14);
      result.writeInt32LE(data.length + 10, 0); result.writeInt32LE(id, 4); result.writeInt32LE(type, 8);
      data.copy(result, 12); return result;
    };
    const finish = (error, response) => {
      if (finished) return; finished = true; clearTimeout(timeout); socket.destroy();
      if (error) reject(error); else resolveResponse(strip(response).trim());
    };
    const timeout = setTimeout(() => finish(new Error(`Isolated RCON timed out: ${command}`)), 10000);
    socket.on('error', error => finish(error));
    socket.on('connect', () => socket.write(packet(41, 3, rconPassword)));
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 12) {
        const length = buffered.readInt32LE(0);
        if (length < 10 || length > 1024 * 1024) { finish(new Error('Invalid isolated RCON frame')); return; }
        if (buffered.length < length + 4) return;
        const id = buffered.readInt32LE(4), type = buffered.readInt32LE(8);
        const body = buffered.subarray(12, length + 2).toString('utf8');
        buffered = buffered.subarray(length + 4);
        if (!authenticated && id === -1) { finish(new Error('Isolated RCON authentication failed')); return; }
        if (!authenticated && id === 41 && type === 2) {
          authenticated = true; socket.write(packet(42, 2, command));
        } else if (authenticated && id === 42 && type === 0) finish(null, body);
      }
    });
  });
}

async function until(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await sleep(100);
  }
}

async function fixtureArtifacts() {
  const plugins = {};
  for (const prefix of ['AgentFriend', 'CortiEyeMirror']) {
    const jars = (await readdir(join(stage, 'plugins'))).filter(name => name.startsWith(prefix) && name.endsWith('.jar'));
    assert.equal(jars.length, 1, `Expected one enabled ${prefix} artifact`);
    plugins[prefix] = { file: jars[0], sha256: createHash('sha256').update(await readFile(join(stage, 'plugins', jars[0]))).digest('hex') };
  }
  return { plugins, serverProperties: Object.fromEntries(['max-players', 'view-distance', 'simulation-distance']
    .map(key => [key, Number(properties.match(new RegExp(`^${key}=(\\d+)$`, 'm'))?.[1])])) };
}

// Anvil location headers let us choose fully generated view neighborhoods.
// A present chunk is not necessarily warm in RAM; each phase warms it first.
async function generatedChunkIndex() {
  const regionDir = join(stage, 'world', 'region');
  const generated = new Set();
  for (const file of await readdir(regionDir)) {
    const match = file.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/);
    if (!match) continue;
    const handle = await open(join(regionDir, file), 'r');
    const header = Buffer.alloc(4096);
    try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
    for (let i = 0; i < 1024; i++) if (header.readUIntBE(i * 4, 3) > 0 && header[i * 4 + 3] > 0) {
      generated.add(`${Number(match[1]) * 32 + i % 32},${Number(match[2]) * 32 + Math.floor(i / 32)}`);
    }
  }
  return generated;
}

async function selectAnchors(count, radius) {
  const generated = await generatedChunkIndex();
  const candidates = [...generated].map(key => key.split(',').map(Number))
    .filter(([x, z]) => Math.abs(x + 35) <= 80 && Math.abs(z - 55) <= 80)
    .sort((a, b) => (a[0] + 35) ** 2 + (a[1] - 55) ** 2 - (b[0] + 35) ** 2 - (b[1] - 55) ** 2);
  const selected = [];
  for (const [x, z] of candidates) {
    if (selected.some(other => Math.max(Math.abs(other.chunkX - x), Math.abs(other.chunkZ - z)) < 16)) continue;
    let full = true;
    for (let dx = -radius; dx <= radius && full; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (!generated.has(`${x + dx},${z + dz}`)) { full = false; break; }
    }
    if (full) selected.push({ chunkX: x, chunkZ: z, x: x * 16 + 8, y: 301, z: z * 16 + 8 });
    if (selected.length === count) break;
  }
  assert.equal(selected.length, count, 'Not enough complete generated neighborhoods for distributed movement');
  return { anchors: selected, generatedChunksOnDisk: generated.size, checkedChunkRadius: radius };
}

async function platform(anchor, halfSize) {
  const x0 = anchor.x - halfSize, x1 = anchor.x + halfSize;
  const z0 = anchor.z - halfSize, z1 = anchor.z + halfSize;
  const added = [];
  for (let cx = Math.floor(x0 / 16); cx <= Math.floor(x1 / 16); cx++) {
    for (let cz = Math.floor(z0 / 16); cz <= Math.floor(z1 / 16); cz++) {
      const query = await rcon(`minecraft:forceload query ${cx * 16} ${cz * 16}`);
      if (/is not marked for force loading/i.test(query)) {
        const coordinate = { x: cx * 16, z: cz * 16 };
        await rcon(`minecraft:forceload add ${coordinate.x} ${coordinate.z}`);
        ownedForceload.set(`${cx},${cz}`, coordinate); added.push(`${cx},${cz}`);
      } else assert.match(query, /is marked for force loading/i, `Unexpected forceload query: ${query}`);
    }
  }
  try {
    // /fill only edits loaded chunks, even when their Anvil data already exists.
    await sleep(250);
  // These explicitly documented scratch platforms remain in the isolated copy.
  // Do not erase existing blocks or pretend the full copied world was restored.
  const fill = async command => {
    const response = await rcon(command);
    assert.ok(!/not loaded|outside|too many|Unknown|Incorrect|Error/i.test(response), `Platform command failed: ${response}`);
    assert.match(response, /filled|No blocks/i, `Unrecognized platform response: ${response}`);
  };
  await fill(`minecraft:fill ${x0} 300 ${z0} ${x1} 300 ${z1} minecraft:stone replace minecraft:air`);
  for (const command of [
    `minecraft:fill ${x0} 301 ${z0} ${x1} 302 ${z0} minecraft:barrier replace minecraft:air`,
    `minecraft:fill ${x0} 301 ${z1} ${x1} 302 ${z1} minecraft:barrier replace minecraft:air`,
    `minecraft:fill ${x0} 301 ${z0} ${x0} 302 ${z1} minecraft:barrier replace minecraft:air`,
    `minecraft:fill ${x1} 301 ${z0} ${x1} 302 ${z1} minecraft:barrier replace minecraft:air`,
  ]) await fill(command);
  } finally {
    for (const key of added) {
      const coordinate = ownedForceload.get(key);
      await rcon(`minecraft:forceload remove ${coordinate.x} ${coordinate.z}`);
      ownedForceload.delete(key);
    }
  }
}

async function groundAnchor(client, skyAnchor) {
  let highest = -65;
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    for (let y = 299; y >= -64; y--) {
      const position = client.bot.entity.position.clone().set(skyAnchor.x + dx, y, skyAnchor.z + dz);
      const block = client.bot.blockAt(position);
      assert.ok(block, `${client.username}: ground column is not loaded`);
      if (!['air', 'cave_air', 'void_air'].includes(block.name)) { highest = Math.max(highest, y); break; }
    }
  }
  // Exclude the scratch sky platform and reject mountain/structure heights
  // whose result would still fail to represent normal ground entity activity.
  assert.ok(highest >= 0 && highest + 2 < 160, `${client.username}: no suitable low ground surface (${highest})`);
  const platformY = highest + 1;
  const response = await rcon(`minecraft:fill ${skyAnchor.x - 3} ${platformY} ${skyAnchor.z - 3} ${skyAnchor.x + 3} ${platformY} ${skyAnchor.z + 3} minecraft:stone replace minecraft:air`);
  assert.match(response, /Successfully filled 49/i, `Ground pad must add exactly 49 air blocks: ${response}`);
  return { ...skyAnchor, y: platformY + 1, terrainHighestY: highest, platformY, halfSize: 3 };
}

function createClient(username, role, errors, namesWithLabels) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, auth: 'offline', version: '1.20.6', viewDistance: 'far' });
  const client = { bot, username, role, packets: 0, protocolBytes: 0, channels: new Map(), distance: 0,
    cameraId: null, ending: false, agentState: null, prospectMessages: [], lifeEvents: [], skipMovementUntil: 0 };
  bot.on('error', error => errors.push(`${username}: ${error.message}`));
  bot.on('kicked', reason => errors.push(`${username}: kicked ${JSON.stringify(reason)}`));
  bot.on('end', reason => { if (!client.ending) errors.push(`${username}: disconnected ${reason}`); });
  bot.on('death', () => {
    client.lifeEvents.push({ at: new Date().toISOString(), event: 'death' });
    client.skipMovementUntil = Date.now() + 2000;
    errors.push(`${username}: died during the load fixture`);
  });
  bot.on('respawn', () => {
    client.lifeEvents.push({ at: new Date().toISOString(), event: 'respawn' });
    client.skipMovementUntil = Date.now() + 2000;
  });
  bot._client.on('raw', buffer => { client.packets++; client.protocolBytes += buffer.length; });
  bot._client.on('camera', packet => { client.cameraId = packet.cameraId; });
  bot._client.on('teams', packet => {
    if (!packet.team?.startsWith('qd_a')) return;
    if (packet.mode === 0 || packet.mode === 3) for (const name of packet.players ?? []) namesWithLabels.add(name);
    if (packet.mode === 4) for (const name of packet.players ?? []) namesWithLabels.delete(name);
  });
  bot._client.on('custom_payload', packet => {
    if (!['mcagent:state', 'mcviewer:state', 'corti:viewer_state', 'mcagent:event'].includes(packet.channel)) return;
    const data = Buffer.from(packet.data);
    const previous = client.channels.get(packet.channel) ?? { packets: 0, bytes: 0, maxBytes: 0, validStates: 0 };
    previous.packets++; previous.bytes += data.length; previous.maxBytes = Math.max(previous.maxBytes, data.length);
    try {
      assert.equal(data[0], 123, 'Expected raw UTF-8 JSON');
      assert.ok(data.length <= 16384);
      const state = JSON.parse(data.toString('utf8'));
      if (packet.channel === 'mcagent:state') client.agentState = state;
      if (packet.channel.endsWith(':state')) {
        assert.ok(state.mana === null || (Number.isFinite(state.mana.current) && Number.isFinite(state.mana.max)));
        if (state.mana !== null) previous.validStates++;
      }
    } catch (error) { errors.push(`${username}: invalid ${packet.channel}: ${error.message}`); }
    client.channels.set(packet.channel, previous);
  });
  bot.on('messagestr', text => {
    if (/探矿术|没有发现这种矿脉|未消耗魔力/.test(text)) {
      client.prospectMessages.push({ at: Date.now(), text });
      if (client.prospectMessages.length > 50) client.prospectMessages.shift();
    }
    if (text.includes('"requiredXp"') || (text.includes('"schemaVersion"') && text.includes('"mana"')))
      errors.push(`${username}: state JSON leaked to chat`);
  });
  return client;
}

async function spawn(client) {
  await until(() => client.bot.entity !== undefined, 30000, `${client.username} did not spawn`);
  client.bot._client.write('custom_payload', { channel: 'minecraft:register',
    data: Buffer.from(client.role === 'agent' ? 'mcagent:state' : 'mcviewer:state') });
}

function snapshot(client) {
  return { packets: client.packets, protocolBytes: client.protocolBytes, distance: client.distance,
    channels: Object.fromEntries([...client.channels].map(([key, value]) => [key, { ...value }])) };
}

function worldEvidence(client) {
  const nearby = Object.values(client.bot.entities).filter(entity => entity.type !== 'player'
    && entity.position && entity.position.distanceTo(client.bot.entity.position) < 48);
  const names = {};
  for (const entity of nearby) names[entity.name ?? entity.type ?? 'unknown'] = (names[entity.name ?? entity.type ?? 'unknown'] ?? 0) + 1;
  return { username: client.username, y: Number(client.bot.entity.position.y.toFixed(2)),
    nearbyNonPlayerEntitiesWithin48: nearby.length, entityNames: names };
}

function prospectResources(client) {
  const state = client.agentState;
  return { mana: state?.mana?.current ?? null, maxMana: state?.mana?.max ?? null,
    cooldownRemainingMs: state?.abilities?.find(ability => ability.id === 'mycli:prospect')?.cooldownRemainingMs ?? null };
}

async function skillBurst(agents, count, receipt) {
  const casters = agents.slice(0, count);
  assert.equal(casters.length, count);
  for (const caster of casters) {
    assert.equal(caster.bot.game.dimension, 'overworld', 'No-target ancient test must be in the Overworld');
    assert.ok(caster.bot.entity.position.y < 160);
    assert.ok(Number.isFinite(prospectResources(caster).mana));
    assert.equal(prospectResources(caster).cooldownRemainingMs, 0);
  }
  const marks = casters.map(caster => caster.prospectMessages.length);
  receipt.command = '/mycli cast prospect ancient'; receipt.agents = count;
  receipt.msptBeforeRaw = await rcon('mspt');
  receipt.startedAt = new Date().toISOString();
  receipt.casters = casters.map(caster => ({ username: caster.username, before: prospectResources(caster) }));
  const start = Date.now();
  console.log(JSON.stringify({ progress: 'skill burst', agents: count, startedAt: receipt.startedAt, command: receipt.command }));
  for (const caster of casters) caster.bot.chat(receipt.command);
  const noTarget = (caster, i) => caster.prospectMessages.slice(marks[i])
    .find(message => message.text.includes('周围 24 格内没有发现这种矿脉') && message.text.includes('未消耗魔力'));
  await until(() => casters.every((caster, i) => noTarget(caster, i)), 10000, 'An R24 no-target cast did not return its real failure receipt');
  receipt.responses = casters.map((caster, i) => ({ username: caster.username,
    elapsedMs: noTarget(caster, i).at - start, ...noTarget(caster, i) }));
  receipt.msptSamples = [{ at: new Date().toISOString(), raw: await rcon('mspt') }];
  // Retry one actual command inside the existing 5-second attempt gate.
  const retryMark = casters[0].prospectMessages.length;
  casters[0].bot.chat(receipt.command);
  await until(() => casters[0].prospectMessages.slice(retryMark).some(message => message.text.includes('请稍等 5 秒再试')),
    2000, 'Immediate retry did not respect the normal attempt gate');
  receipt.retryResponse = casters[0].prospectMessages.slice(retryMark).find(message => message.text.includes('请稍等 5 秒再试'));
  await sleep(1500);
  receipt.msptSamples.push({ at: new Date().toISOString(), raw: await rcon('mspt') });
  for (let i = 0; i < casters.length; i++) {
    const after = prospectResources(casters[i]); receipt.casters[i].after = after;
    assert.ok(after.mana >= receipt.casters[i].before.mana, 'No-target cast or blocked retry deducted mana');
    assert.equal(after.cooldownRemainingMs, 0, 'No-target cast started the paid spell cooldown');
  }
  receipt.observedLast5sMaxMs = Math.max(...receipt.msptSamples.map(sample => {
    const match = sample.raw.match(/(\d+\.\d+)\s*\/\s*(\d+\.\d+)\s*\/\s*(\d+\.\d+)/);
    assert.ok(match, sample.raw); return Number(match[3]);
  }));
  receipt.verdict = 'PASS';
  receipt.scope = `${count} concurrent real R24 no-target scans; failure skips mana/cooldown, retry uses normal 5-second attempt gate; no mana/level/reset cheats`;
  console.log(JSON.stringify({ progress: 'skill burst complete', agents: count, maxReplyMs: Math.max(...receipt.responses.map(response => response.elapsedMs)),
    observedLast5sMaxMs: receipt.observedLast5sMaxMs, verdict: receipt.verdict }));
}

function delta(client, before, seconds) {
  const after = snapshot(client);
  return { username: client.username, role: client.role, movementBlocks: Number((after.distance - before.distance).toFixed(2)),
    lifeEvents: [...client.lifeEvents],
    packetsPerSecond: Number(((after.packets - before.packets) / seconds).toFixed(2)),
    decodedProtocolBytesPerSecond: Math.round((after.protocolBytes - before.protocolBytes) / seconds),
    channels: Object.fromEntries(Object.entries(after.channels).map(([key, value]) => [key, {
      packets: value.packets - (before.channels[key]?.packets ?? 0), bytes: value.bytes - (before.channels[key]?.bytes ?? 0),
      packetsPerSecond: Number(((value.packets - (before.channels[key]?.packets ?? 0)) / seconds).toFixed(3)),
      bytesPerSecond: Math.round((value.bytes - (before.channels[key]?.bytes ?? 0)) / seconds), maxBytes: value.maxBytes,
    }])) };
}

const originalRegistry = await readFile(registryFile, 'utf8');
const errors = [], clients = [], namesWithLabels = new Set();
const report = { schemaVersion: 1, createdAt: new Date().toISOString(), stage: basename(stage), javaPort: port,
  version: '1.20.6', scope: 'same-area idle and generated-chunk distributed vanilla walking; no LLM/combat/exploration',
  durationMs, warmupMs, levels, groundAgents, skillBurstAgents, requestedModes,
  protection: 'survival; resistance V for test damage protection, ordinary mobs/AI remain enabled',
  connectionPeak: 0, connectionWaves: [], phases: [], errors, cleanup: {} };
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
let movementTimer;
if (process.env.MC_PERF_SCENARIO !== 'helpers') {
try {
  const existing = await rcon('minecraft:list');
  assert.match(existing, /There are 0 of a max/i, 'Start with no other clients in this isolated server');
  report.fixtureArtifacts = await fixtureArtifacts();
  const viewDistance = Number(properties.match(/^view-distance=(\d+)$/m)?.[1] ?? 8);
  const selected = await selectAnchors(Math.max(...levels), Math.max(viewDistance, 8) + 1);
  report.generatedRegionCheck = selected;
  console.log(JSON.stringify({ progress: 'preparing generated neighborhoods', anchors: selected.anchors.length, checkedRadius: selected.checkedChunkRadius }));
  await platform(selected.anchors[0], 22);
  for (const anchor of selected.anchors.slice(1)) await platform(anchor, 8);
  const pairs = Array.from({ length: Math.max(...levels) }, (_, i) => ({ agent: `P${suffix}A${i + 1}`, eye: `P${suffix}E${i + 1}` }));
  await writeFile(registryFile, JSON.stringify({ schemaVersion: 1, pairs }));
  report.pairs = pairs;
  for (const count of levels) {
    const connectStarted = Date.now();
    const priorConnections = clients.length;
    for (let i = clients.length / 2; i < count; i++) {
      const agent = createClient(pairs[i].agent, 'agent', errors, namesWithLabels); clients.push(agent); await spawn(agent);
      const eye = createClient(pairs[i].eye, 'eye', errors, namesWithLabels); clients.push(eye); await spawn(eye);
      await sleep(200);
    }
    report.connectionPeak = Math.max(report.connectionPeak, clients.length);
    const wave = { priorConnections, connectionsAfter: clients.length, startedAt: new Date(connectStarted).toISOString(),
      elapsedMs: Date.now() - connectStarted, msptAfterLoginRaw: await rcon('mspt') };
    report.connectionWaves.push(wave);
    console.log(JSON.stringify({ progress: 'connections ready', agents: count, eyes: count, wave }));
    await sleep(6500); // Both plugins reread the legitimate isolated registry.
    await until(() => pairs.slice(0, count).every(pair => namesWithLabels.has(pair.agent)), 10000, 'A test Agent was not identified by the registry');
    let agents = clients.filter(client => client.role === 'agent');
    let eyes = clients.filter(client => client.role === 'eye');
    const modes = requestedModes ? [...requestedModes] : ['same-area-idle', 'generated-distributed-walk'];
    if (!requestedModes && groundAgents > 0 && count === levels.at(-1)) modes.push('ground-distributed-walk');
    for (const mode of modes) {
      let phaseAnchors = selected.anchors;
      if (mode === 'ground-distributed-walk') {
        for (const client of clients.splice(groundAgents * 2)) {
          client.ending = true; client.bot.clearControlStates(); client.bot.quit();
        }
        agents = clients.filter(client => client.role === 'agent'); eyes = clients.filter(client => client.role === 'eye');
        phaseAnchors = [];
        report.groundPreparation = { requestedAgents: groundAgents, anchors: phaseAnchors,
          protection: 'survival; resistance V for test fall protection; normal mobs/AI unchanged' };
        for (let i = 0; i < agents.length; i++) {
          const anchor = selected.anchors[i];
          await rcon(`minecraft:effect give ${agents[i].username} minecraft:resistance 600 4 true`);
          await rcon(`minecraft:tp ${agents[i].username} ${anchor.x + 0.5} 301 ${anchor.z + 0.5}`);
          await until(() => agents[i].bot.blockAt(agents[i].bot.entity.position.clone().set(anchor.x, 64, anchor.z)) !== null,
            15000, `${agents[i].username}: original generated ground column did not load`);
          phaseAnchors.push(await groundAnchor(agents[i], anchor));
        }
      }
      for (let i = 0; i < agents.length; i++) {
        agents[i].bot.clearControlStates();
        const anchor = mode === 'same-area-idle' ? phaseAnchors[0] : phaseAnchors[i];
        const dx = mode === 'same-area-idle' ? (i % 4 - 1.5) * 5 : 0;
        const dz = mode === 'same-area-idle' ? (Math.floor(i / 4) - 1.5) * 5 : 0;
        await rcon(`minecraft:gamemode survival ${agents[i].username}`);
        await rcon(`minecraft:effect give ${agents[i].username} minecraft:resistance 600 4 true`);
        await rcon(`minecraft:tp ${agents[i].username} ${anchor.x + dx + 0.5} ${anchor.y} ${anchor.z + dz + 0.5}`);
        await rcon(`minecraft:gamemode spectator ${eyes[i].username}`);
        await rcon(`minecraft:spectate ${agents[i].username} ${eyes[i].username}`);
      }
      await until(() => agents.every(client => (client.channels.get('mcagent:state')?.validStates ?? 0) > 0)
        && eyes.every(client => (client.channels.get('mcviewer:state')?.validStates ?? 0) > 0), 20000, 'Missing real personal state');
      await until(() => eyes.every((eye, i) => eye.cameraId === agents[i].bot.entity.id), 10000, 'Eye was not attached to its registered Agent');
      if (mode.endsWith('-walk')) {
        const previousPositions = agents.map(client => client.bot.entity.position.clone());
        const waypointIndices = agents.map(() => 0);
        movementTimer = setInterval(() => {
          agents.forEach((client, i) => {
            const position = client.bot.entity?.position;
            if (!position) return;
            const travelled = position.distanceTo(previousPositions[i]);
            if (travelled < 3 && Date.now() >= client.skipMovementUntil) client.distance += travelled;
            previousPositions[i] = position.clone();
            const reach = mode === 'ground-distributed-walk' ? 1.5 : 4;
            const offsets = [[-reach, -reach], [reach, -reach], [reach, reach], [-reach, reach]];
            let [dx, dz] = offsets[waypointIndices[i]];
            const anchor = phaseAnchors[i];
            if (Math.hypot(position.x - anchor.x - dx, position.z - anchor.z - dz) < (mode === 'ground-distributed-walk' ? 0.6 : 1)) {
              waypointIndices[i] = (waypointIndices[i] + 1) % offsets.length;
              [dx, dz] = offsets[waypointIndices[i]];
            }
            void client.bot.lookAt(position.clone().set(anchor.x + dx, position.y + 1.62, anchor.z + dz), true)
              .catch(error => errors.push(`${client.username}: look ${error.message}`));
            client.bot.setControlState('forward', true);
          });
        }, 200);
      }
      console.log(JSON.stringify({ progress: 'warmup', agents: agents.length, eyes: eyes.length, mode, warmupMs }));
      await sleep(warmupMs);
      assert.deepEqual(errors, []);
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const targetY = mode === 'same-area-idle' ? phaseAnchors[0].y : phaseAnchors[i].y;
        assert.ok(Math.abs(agent.bot.entity.position.y - targetY) < 0.1
        && agent.bot.blockAt(agent.bot.entity.position.offset(0, -0.1, 0))?.name === 'stone',
      `${agent.username} is not standing on its verified scratch platform`);
      }
      eventLoop.enable(); eventLoop.reset();
      const before = clients.map(snapshot);
      const worldAtStart = agents.map(worldEvidence);
      const start = Date.now();
      console.log(JSON.stringify({ progress: 'measuring', agents: agents.length, eyes: eyes.length, mode, startedAt: new Date(start).toISOString(), durationMs }));
      const safetySamples = [];
      while (Date.now() - start < durationMs) {
        await sleep(Math.min(15000, durationMs - (Date.now() - start)));
        assert.deepEqual(errors, []);
        const sample = await rcon('mspt');
        const recent = [...sample.matchAll(/(\d+\.\d+)\s*\/\s*(\d+\.\d+)\s*\/\s*(\d+\.\d+)/g)][0];
        assert.ok(recent, sample);
        safetySamples.push({ at: new Date().toISOString(), last5sAverageMs: Number(recent[1]), last5sMaxMs: Number(recent[3]) });
        assert.ok(Number(recent[1]) <= 100 && Number(recent[3]) <= 3000,
          'Isolated tick load is uncontrolled; release test clients to protect shared host resources');
        assert.ok(process.memoryUsage().heapUsed < 2800 * 1024 * 1024, 'Load client reached its own memory budget');
      }
      const end = Date.now();
      eventLoop.disable();
      const seconds = (end - start) / 1000;
      const recipients = clients.map((client, i) => delta(client, before[i], seconds));
      const msptRaw = await rcon('mspt');
      const triples = [...msptRaw.matchAll(/(\d+\.\d+)\s*\/\s*(\d+\.\d+)\s*\/\s*(\d+\.\d+)/g)]
        .map(match => ({ averageMs: Number(match[1]), minMs: Number(match[2]), maxMs: Number(match[3]) }));
      assert.equal(triples.length, 3, `Unrecognized MSPT response: ${msptRaw}`);
      const phase = { agentCount: agents.length, eyeCount: eyes.length, mode, startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(),
        seconds, mspt: { last5s: triples[0], last10s: triples[1], last1m: triples[2] }, msptRaw, safetySamples,
        worldAtStart, worldAtEnd: agents.map(worldEvidence),
        tpsRaw: await rcon('spigot:tps'), clientEventLoop: { p99Ms: Number((eventLoop.percentile(99) / 1e6).toFixed(2)),
          maxMs: Number((eventLoop.max / 1e6).toFixed(2)) }, recipients };
      report.phases.push(phase);
      if (mode.endsWith('-walk')) assert.ok(recipients.filter(client => client.role === 'agent')
        .every(client => client.movementBlocks >= seconds * 1.5),
      `A movement client stalled; do not count this as moving load: ${JSON.stringify(recipients.filter(client => client.role === 'agent').map(client => ({ username: client.username, blocks: client.movementBlocks })))}`);
      console.log(JSON.stringify({ progress: 'phase complete', agents: agents.length, eyes: eyes.length, mode, mspt: phase.mspt.last1m,
        minimumMovementBlocks: Math.min(...recipients.filter(client => client.role === 'agent').map(client => client.movementBlocks)),
        clientEventLoop: phase.clientEventLoop }));
      clearInterval(movementTimer); movementTimer = undefined;
      for (const agent of agents) agent.bot.clearControlStates();
      assert.deepEqual(errors, []);
      await mkdir(resolve(output, '..'), { recursive: true });
      await writeFile(output, JSON.stringify(report, null, 2));
    }
  }
  if (skillBurstAgents > 0) {
    report.skillBurst = { verdict: 'PENDING' };
    await skillBurst(clients.filter(client => client.role === 'agent'), skillBurstAgents, report.skillBurst);
  }
  report.verdict = 'PASS';
} catch (error) {
  report.verdict = 'FAIL'; report.failure = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  clearInterval(movementTimer); eventLoop.disable();
  for (const client of clients) { client.ending = true; client.bot.clearControlStates(); client.bot.quit(); }
  await sleep(750);
  for (const [key, coordinate] of ownedForceload) {
    try { await rcon(`minecraft:forceload remove ${coordinate.x} ${coordinate.z}`); ownedForceload.delete(key); }
    catch (error) { errors.push(`Could not release isolated forceload ${key}: ${error.message}`); }
  }
  report.cleanup.ownedForcedChunksRemaining = ownedForceload.size;
  await writeFile(registryFile, originalRegistry);
  report.cleanup.registryRestored = (await readFile(registryFile, 'utf8')) === originalRegistry;
  report.cleanup.scratchPlatformsRetainedOnlyInStage = true;
  try {
    report.cleanup.serverPlayers = await rcon('minecraft:list');
    report.cleanup.testClientsDisconnected = /There are 0 of a max/i.test(report.cleanup.serverPlayers);
  } catch (error) { report.cleanup.rconError = error.message; report.cleanup.testClientsDisconnected = false; }
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verdict: report.verdict, output, cleanup: report.cleanup, errors }));
}
}

export { stage, port, registryFile, originalRegistry, rcon, sleep, until, generatedChunkIndex,
  createClient, spawn, snapshot, delta, worldEvidence, fixtureArtifacts };
