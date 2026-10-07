// Independent, destructive only to the isolated copy's newly generated chunks.
// This measures real vanilla walking after positioning, not a teleport spike.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const count = Number(process.env.MC_PERF_COLD_AGENTS ?? 16);
const durationMs = Number(process.env.MC_PERF_COLD_DURATION_MS ?? 75000);
const output = resolve(process.env.MC_PERF_OUTPUT ?? 'E:/MC/ops/repairs/performance-scale-20261005/coldwalk.json');
assert.ok(Number.isInteger(count) && count >= 1 && count <= 16);
assert.ok(durationMs >= 65000 && durationMs <= 180000);
process.env.MC_PERF_AGENTS = String(count);
process.env.MC_PERF_GROUND_AGENTS = '0';
process.env.MC_PERF_SKILL_BURST_AGENTS = '0';
process.env.MC_PERF_OUTPUT = output;
process.env.MC_PERF_SCENARIO = 'helpers';
const { stage, registryFile, originalRegistry, rcon, sleep, until, generatedChunkIndex,
  createClient, spawn, snapshot, delta, worldEvidence, fixtureArtifacts } = await import('./performance-stage.mjs');
const require = createRequire(process.env.MC_MINEFLAYER_PACKAGE ?? 'E:/Cortico/package.json');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const properties = await readFile(join(stage, 'server.properties'), 'utf8');
const radius = Number(properties.match(/^view-distance=(\d+)$/m)?.[1] ?? 8) + 1;
const clients = [], errors = [], namesWithLabels = new Set();
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
let distanceTimer;
const report = { schemaVersion: 1, scenario: 'cold-ground-walk', createdAt: new Date().toISOString(), count, durationMs,
  scope: 'real survival pathfinder walking into missing chunk-index entries; no LLM, mining, building, or combat', errors, cleanup: {} };
// Protodef's FullPacketParser drops partial reads after logging them, without a
// bot error event. Audit these explicitly, and bound console noise per fixture.
const originalConsoleLog = console.log;
report.protocolDecodeWarnings = { count: 0, examples: [] };
console.log = (...args) => {
  if (typeof args[0] === 'string' && (args[0].startsWith('PartialReadError:') || args[0].startsWith('Chunk size is '))) {
    report.protocolDecodeWarnings.count++;
    if (report.protocolDecodeWarnings.examples.length < 3) {
      report.protocolDecodeWarnings.examples.push(args[0].slice(0, 1500));
      originalConsoleLog(...args);
    }
    return;
  }
  originalConsoleLog(...args);
};

function boundaries(index) {
  const candidates = [];
  for (const key of index) {
    const [x, z] = key.split(',').map(Number);
    let complete = true;
    for (let dx = -radius; dx <= radius && complete; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (!index.has(`${x + dx},${z + dz}`)) { complete = false; break; }
    }
    if (!complete) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let step = radius + 1; step <= radius + 16; step++) {
        if (!index.has(`${x + dx * step},${z + dz * step}`)) {
          candidates.push({ chunkX: x, chunkZ: z, x: x * 16 + 8, z: z * 16 + 8, dx, dz, firstMissingChunksAway: step });
          break;
        }
      }
    }
  }
  candidates.sort((a, b) => a.firstMissingChunksAway - b.firstMissingChunksAway);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some(other => Math.max(Math.abs(other.chunkX - candidate.chunkX), Math.abs(other.chunkZ - candidate.chunkZ)) < 16)) continue;
    selected.push(candidate);
    if (selected.length === count * 4) break;
  }
  assert.ok(selected.length >= count, `Only ${selected.length} complete generated edge neighborhoods fit ${count} clients`);
  return selected;
}

function safeNaturalSurface(client, anchor) {
  const safe = /^(grass_block|dirt|coarse_dirt|podzol|sand|red_sand|stone|gravel|snow_block|terracotta|.*_terracotta|packed_ice|ice)$/;
  const offsets = [];
  for (let dx = -12; dx <= 12; dx += 4) for (let dz = -12; dz <= 12; dz += 4) offsets.push([dx, dz]);
  offsets.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  const rejections = {};
  for (const [dx, dz] of offsets) {
    for (let y = 157; y >= 0; y--) {
      const position = client.bot.entity.position.clone().set(anchor.x + dx, y, anchor.z + dz);
      const block = client.bot.blockAt(position);
      if (!block) { rejections.unloaded = (rejections.unloaded ?? 0) + 1; break; }
      if (['air', 'cave_air', 'void_air'].includes(block.name)) continue;
      if (safe.test(block.name)) {
        const head = client.bot.blockAt(position.offset(0, 1, 0));
        const above = client.bot.blockAt(position.offset(0, 2, 0));
        if (head?.boundingBox === 'empty' && above?.boundingBox === 'empty'
          && !/water|lava|berry|cactus/.test(head.name + above.name)) return { ...anchor, x: anchor.x + dx + 0.5, y: y + 1, z: anchor.z + dz + 0.5, surface: block.name };
      }
      if (block.name.endsWith('_leaves') || (block.boundingBox === 'empty'
        && !/water|lava|berry|cactus/.test(block.name))) continue;
      rejections[block.name] = (rejections[block.name] ?? 0) + 1;
      break; // Reject roofs, solid obstacles and water; safe tree-canopy gaps remain usable.
    }
  }
  return { rejected: true, rejections };
}

function parseRecent(raw) {
  const match = raw.match(/(\d+\.\d+)\s*\/\s*(\d+\.\d+)\s*\/\s*(\d+\.\d+)/);
  assert.ok(match, raw);
  return { averageMs: Number(match[1]), minMs: Number(match[2]), maxMs: Number(match[3]) };
}

try {
  assert.match(await rcon('minecraft:list'), /There are 0 of a max/i, 'Cold check requires an empty isolated server');
  report.fixtureArtifacts = await fixtureArtifacts();
  report.pluginVersionRaw = await rcon('version AgentFriend');
  await rcon('minecraft:save-all flush');
  const initialIndex = await generatedChunkIndex();
  const candidates = boundaries(initialIndex), anchors = [];
  report.initialGeneratedChunks = initialIndex.size; report.boundaryAnchors = anchors; report.rejectedBoundaries = [];
  const suffix = Date.now().toString(36).slice(-5);
  const pairs = Array.from({ length: count }, (_, i) => ({ agent: `C${suffix}A${i + 1}`, eye: `C${suffix}E${i + 1}` }));
  await writeFile(registryFile, JSON.stringify({ schemaVersion: 1, pairs }));
  const setupStarted = Date.now();
  console.log(JSON.stringify({ progress: 'cold setup', agents: count, eyes: count, initialGeneratedChunks: initialIndex.size }));
  let nextCandidate = 0;
  for (let i = 0; i < count; i++) {
    const agent = createClient(pairs[i].agent, 'agent', errors, namesWithLabels); clients.push(agent); await spawn(agent);
    const eye = createClient(pairs[i].eye, 'eye', errors, namesWithLabels); clients.push(eye); await spawn(eye);
    await rcon(`minecraft:gamemode spectator ${agent.username}`);
    while (anchors.length <= i && nextCandidate < candidates.length) {
      const candidate = candidates[nextCandidate++];
      await rcon(`minecraft:tp ${agent.username} ${candidate.x + 0.5} 200 ${candidate.z + 0.5}`);
      await until(() => agent.bot.blockAt(agent.bot.entity.position.clone().set(candidate.x, 64, candidate.z)) !== null,
        10000, `${agent.username}: boundary chunk did not load`);
      const surface = safeNaturalSurface(agent, candidate);
      if (surface.rejected) report.rejectedBoundaries.push({ candidate, rejections: surface.rejections });
      else anchors.push(surface);
    }
    assert.equal(anchors.length, i + 1, `${agent.username}: no safe natural low surface among remaining generated boundaries`);
    await rcon(`minecraft:tp ${agent.username} ${anchors[i].x} ${anchors[i].y} ${anchors[i].z}`);
    await rcon(`minecraft:gamemode survival ${agent.username}`);
    await rcon(`minecraft:effect give ${agent.username} minecraft:resistance 600 4 true`);
    await rcon(`minecraft:gamemode spectator ${eye.username}`);
    await rcon(`minecraft:spectate ${agent.username} ${eye.username}`);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ progress: 'cold positioned', agents: i + 1, rejectedBoundaries: report.rejectedBoundaries.length,
      x: anchors[i].x, y: anchors[i].y, z: anchors[i].z }));
  }
  const agents = clients.filter(client => client.role === 'agent');
  const eyes = clients.filter(client => client.role === 'eye');
  await until(() => eyes.every((eye, i) => eye.cameraId === agents[i].bot.entity.id), 15000, 'A cold test Eye did not attach');
  await sleep(15000);
  await rcon('minecraft:save-all flush');
  const walkingIndex = await generatedChunkIndex();
  report.positioning = { elapsedMs: Date.now() - setupStarted, generatedChunksAfterPositioning: walkingIndex.size,
    newChunksBeforeWalking: [...walkingIndex].filter(key => !initialIndex.has(key)).length, msptRaw: await rcon('mspt') };
  for (const agent of agents) assert.ok(agent.bot.game.gameMode === 'survival' && agent.bot.entity.position.y < 160);
  report.worldAtStart = agents.map(worldEvidence);
  const before = clients.map(snapshot), positions = agents.map(client => client.bot.entity.position.clone());
  report.pathUpdates = Object.fromEntries(agents.map(agent => [agent.username, {}]));
  for (let i = 0; i < agents.length; i++) {
    const bot = agents[i].bot;
    bot.loadPlugin(pathfinder);
    const movements = new Movements(bot);
    movements.canDig = false; movements.allow1by1towers = false; movements.allowParkour = false;
    movements.allowSprinting = false; movements.maxDropDown = 3; movements.scafoldingBlocks = [];
    bot.pathfinder.tickTimeout = 5; bot.pathfinder.thinkTimeout = 2000;
    bot.pathfinder.setMovements(movements);
    bot.on('path_update', result => {
      const stats = report.pathUpdates[agents[i].username]; stats[result.status] = (stats[result.status] ?? 0) + 1;
    });
    bot.pathfinder.setGoal(new goals.GoalXZ(Math.floor(anchors[i].x + anchors[i].dx * 512), Math.floor(anchors[i].z + anchors[i].dz * 512)));
  }
  distanceTimer = setInterval(() => agents.forEach((client, i) => {
    const current = client.bot.entity?.position;
    if (!current) return;
    const distance = current.distanceTo(positions[i]);
    if (distance < 5 && Date.now() >= client.skipMovementUntil) client.distance += distance;
    positions[i] = current.clone();
  }), 200);
  eventLoop.enable(); eventLoop.reset();
  const started = Date.now(); report.walkingStartedAt = new Date(started).toISOString(); report.samples = [];
  console.log(JSON.stringify({ progress: 'cold walking', agents: count, eyes: count, startedAt: report.walkingStartedAt, durationMs }));
  let overBudget = 0;
  while (Date.now() - started < durationMs) {
    await sleep(5000);
    assert.deepEqual(errors, []);
    const raw = await rcon('mspt'), recent = parseRecent(raw);
    report.samples.push({ at: new Date().toISOString(), last5s: recent, raw });
    overBudget = recent.averageMs > 50 ? overBudget + 1 : 0;
    if (overBudget >= 2) { report.abortReason = 'Two consecutive five-second MSPT windows exceed 50 ms'; break; }
    if (recent.maxMs > 3000 || process.memoryUsage().heapUsed > 2800 * 1024 * 1024) {
      report.abortReason = 'Shared-host safety or load-client memory budget exceeded'; break;
    }
  }
  const seconds = (Date.now() - started) / 1000;
  clearInterval(distanceTimer); eventLoop.disable();
  for (const agent of agents) { agent.bot.pathfinder.setGoal(null); agent.bot.clearControlStates(); }
  report.recipients = clients.map((client, i) => delta(client, before[i], seconds));
  report.clientEventLoop = { p99Ms: Number((eventLoop.percentile(99) / 1e6).toFixed(2)), maxMs: Number((eventLoop.max / 1e6).toFixed(2)) };
  report.walkingSeconds = seconds; report.worldAtEnd = agents.map(worldEvidence);
  report.msptAfterWalkingRaw = await rcon('mspt'); report.tpsRaw = await rcon('spigot:tps');
  // Release clients before saving/reading the post-walking generated index.
  for (const client of clients) { client.ending = true; client.bot.quit(); }
  await sleep(750); await rcon('minecraft:save-all flush');
  const finalIndex = await generatedChunkIndex();
  report.newChunksDuringWalking = [...finalIndex].filter(key => !walkingIndex.has(key));
  report.finalGeneratedChunks = finalIndex.size;
  if (report.abortReason) report.verdict = 'ABORTED_OVER_BUDGET';
  else {
    assert.ok(report.recipients.filter(client => client.role === 'agent').every(client => client.movementBlocks >= 80), 'A cold pathfinder did not walk at least 80 blocks');
    assert.ok(report.newChunksDuringWalking.length > 0, 'No new chunk-index entries appeared during walking');
    assert.equal(report.protocolDecodeWarnings.count, 0, 'Client dropped protocol packets during cold walking');
    report.verdict = 'PASS';
  }
} catch (error) {
  report.verdict = 'FAIL'; report.failure = error.stack; process.exitCode = 1;
  console.error(error.stack);
} finally {
  console.log = originalConsoleLog;
  clearInterval(distanceTimer); eventLoop.disable();
  for (const client of clients) {
    client.ending = true; client.bot.pathfinder?.setGoal(null); client.bot.clearControlStates(); client.bot.quit();
  }
  await sleep(750); await writeFile(registryFile, originalRegistry);
  report.cleanup.registryRestored = (await readFile(registryFile, 'utf8')) === originalRegistry;
  report.cleanup.forcedChunksAdded = 0;
  try { report.cleanup.serverPlayers = await rcon('minecraft:list'); report.cleanup.clientsDisconnected = /There are 0 of a max/i.test(report.cleanup.serverPlayers); }
  catch (error) { report.cleanup.rconError = error.message; }
  await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verdict: report.verdict, output, abortReason: report.abortReason,
    newlyGeneratedDuringWalking: report.newChunksDuringWalking?.length, cleanup: report.cleanup }));
}
