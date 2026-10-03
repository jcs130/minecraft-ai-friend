// Keep Eye accounts in spectator mode and attached to their Agent.
// Explicit pairs cover names such as CortiEye -> CortiLan. Other Eye names
// match the online Agent name after removing "eye" (for example fu_eye -> fu).
// This sidecar uses loopback RCON; Paper does not need to restart.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { command } from './rcon-client.mjs';

const once = process.argv.includes('--once');
const dry = process.argv.includes('--dry');
const configFile = fileURLToPath(new URL('./agent-eye-pairs.json', import.meta.url));
const logFile = 'E:/MC/ops/agent-eye-watcher.log';
const namePattern = /^[A-Za-z0-9_]{1,16}$/;
const pollMs = 20_000;
const refreshMs = 120_000;
const attached = new Map();
let pairs = [];
let configError = '';
let hadError = false;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (once) console.log(line);
  else fs.appendFileSync(logFile, `${line}\n`);
}

function loadPairs() {
  try {
    const value = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (value.schemaVersion !== 1 || !Array.isArray(value.pairs) || value.pairs.length > 16)
      throw new Error('expected schemaVersion=1 and at most 16 pairs');
    const seen = new Set();
    const next = value.pairs.map(({ agent, eye }) => {
      if (!namePattern.test(agent) || !namePattern.test(eye) || agent.toLowerCase() === eye.toLowerCase())
        throw new Error('invalid agent or eye name');
      const key = eye.toLowerCase();
      if (seen.has(key) || key === 'goddess' || agent.toLowerCase() === 'goddess')
        throw new Error('duplicate or reserved name');
      seen.add(key);
      return { agent, eye, key };
    });
    pairs = next;
    configError = '';
  } catch (error) {
    if (String(error.message) !== configError) log(`pair config rejected: ${error.message}`);
    configError = String(error.message);
    hadError = true;
  }
}

async function roster() {
  // The plain list command contains display prefixes. "list uuids" uses raw
  // login names, so guild ranks and [Agent] labels cannot break matching.
  const reply = await command('minecraft:list uuids', 10_000);
  const online = new Map();
  for (const match of reply.matchAll(/\b([A-Za-z0-9_]{1,16}) \(([0-9a-f-]{36})\)/gi))
    online.set(match[1].toLowerCase(), { name: match[1], uuid: match[2] });
  if (!/players online:/i.test(reply)) throw new Error('unrecognized roster response');
  return online;
}

async function gameMode(name) {
  const reply = await command(`minecraft:data get entity ${name} playerGameType`, 10_000);
  const match = reply.match(/following entity data:\s*([0-3])\b/);
  if (!match) throw new Error(`cannot read ${name} game mode`);
  return Number(match[1]);
}

async function position(name) {
  const reply = await command(`minecraft:data get entity ${name} Pos`, 10_000);
  const match = reply.match(/\[([-+\d.eE]+)d?,\s*([-+\d.eE]+)d?,\s*([-+\d.eE]+)d?\]/);
  if (!match) throw new Error(`cannot read ${name} position`);
  return match.slice(1).map(Number);
}

async function tick() {
  loadPairs();
  const online = await roster();
  const cameras = new Map(pairs.map(pair => [pair.key, pair]));
  for (const eye of online.values()) {
    const key = eye.name.toLowerCase();
    if (key === 'goddess' || !key.includes('eye') || cameras.has(key)) continue;
    const agentKey = key.replace('eye', '').replace(/^_+|_+$/g, '');
    const agent = online.get(agentKey);
    cameras.set(key, { eye: eye.name, key,
      agent: agent && !agentKey.includes('eye') && agentKey !== 'goddess' ? agent.name : '' });
  }
  for (const pair of cameras.values()) {
    const eye = online.get(pair.key);
    const agent = pair.agent ? online.get(pair.agent.toLowerCase()) : null;
    if (!eye) { attached.delete(pair.key); continue; }
    try {
      let corrected = false;
      if (await gameMode(eye.name) !== 3) {
        if (dry) log(`DRY set ${eye.name} spectator`);
        else {
          const reply = await command(`minecraft:gamemode spectator ${eye.name}`, 10_000);
          if (!reply.includes('Spectator Mode')) throw new Error(`gamemode refused: ${reply.trim()}`);
          log(`set ${eye.name} spectator`);
        }
        corrected = true;
      }
      if (!agent) { attached.delete(pair.key); continue; }
      const previous = attached.get(pair.key);
      let needsAttach = corrected || !previous || previous.agentUuid !== agent.uuid
        || previous.eyeUuid !== eye.uuid || Date.now() - previous.at >= refreshMs;
      if (!needsAttach) {
        const [a, b] = await Promise.all([position(agent.name), position(eye.name)]);
        needsAttach = a.some((coordinate, i) => Math.abs(coordinate - b[i]) > 8);
      }
      if (needsAttach) {
        if (dry) log(`DRY spectate ${agent.name} ${eye.name}`);
        else {
          const reply = await command(`minecraft:spectate ${agent.name} ${eye.name}`, 10_000);
          if (!reply.includes('Now spectating')) throw new Error(`spectate refused: ${reply.trim()}`);
          log(`attached ${eye.name} -> ${agent.name}`);
        }
        attached.set(pair.key, { agentUuid: agent.uuid, eyeUuid: eye.uuid, at: Date.now() });
      }
    } catch (error) {
      attached.delete(pair.key);
      log(`pair ${pair.eye} -> ${pair.agent} failed: ${error.message}`);
      hadError = true;
    }
  }
}

async function loop() {
  try { await tick(); }
  catch (error) { log(`poll failed: ${error.message}`); hadError = true; }
  if (once && hadError) process.exitCode = 1;
  if (!once) setTimeout(loop, pollMs);
}

if (!once) log(`start dry=${dry} once=${once}`);
await loop();
