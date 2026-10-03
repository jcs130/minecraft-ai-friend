// Run against the isolated Paper stage on 25567; never changes production.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const require = createRequire('E:/MC/probe/package.json');
const mineflayer = require('mineflayer');
const accessPath = 'E:/MC/staging/life-buildings-20261003/agent-gateway-access.json';
const node = 'C:/Users/lzl19/AppData/Local/hermes/node/node.exe';
const gateway = 'E:/minecraft-ai-friend-prospect-coords/paper/ops/agent-lan-gateway.mjs';
const entries = [
  { name: 'MirrorAgent', allowedIps: ['127.0.0.1'] },
  { name: 'MirrorAgent_eye', allowedIps: ['127.0.0.1'] },
  { name: 'OtherAgent', allowedIps: ['192.0.2.10'] },
  { name: 'OtherAgent_eye', allowedIps: ['192.0.2.10'] }
];
const writeAccess = async (allowUnregisteredGuests = true) => fs.writeFile(accessPath,
  JSON.stringify({ schemaVersion: 1, allowUnregisteredGuests, accounts: entries }));
await writeAccess();

const child = spawn(node, [gateway], { windowsHide: true, env: {
  ...process.env,
  AGENT_GATEWAY_LISTEN_HOST: '127.0.0.1',
  AGENT_GATEWAY_LISTEN_PORT: '25568',
  AGENT_GATEWAY_BACKEND_PORT: '25567',
  AGENT_GATEWAY_CONTROL_PORT: '25578',
  AGENT_GATEWAY_PAIRS_FILE: 'E:/MC/staging/life-buildings-20261003/agent-eye-pairs.json',
  AGENT_GATEWAY_ACCESS_FILE: accessPath,
  AGENT_GATEWAY_OPS_FILE: 'E:/MC/staging/life-buildings-20261003/ops.json'
} });

async function waitReady() {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('gateway start timeout')), 5000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`gateway exited ${code}`)); });
    child.stdout.on('data', chunk => {
      if (!chunk.toString().includes('Agent LAN gateway listening')) return;
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function attempt(name) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25568,
    version: '1.20.6', username: name, auth: 'offline', hideErrors: true });
  bot.on('error', () => {});
  bot._client.on('error', () => {});
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name} login timeout`)), 6000);
    bot.once('spawn', () => { clearTimeout(timeout); resolve(true); });
    bot.once('end', () => { clearTimeout(timeout); resolve(false); });
  });
  if (result) bot.quit();
  return result;
}

try {
  await waitReady();
  for (const [name, expected] of [
    ['MirrorAgent', true], ['MirrorAgent_eye', true],
    ['OtherAgent', false], ['OtherAgent_eye', false],
    ['UnknownEye', false], ['GuestHuman', true]
  ]) {
    const actual = await attempt(name);
    if (actual !== expected) throw new Error(`${name}: expected login ${expected}, got ${actual}`);
  }
  entries[2].allowedIps = ['127.0.0.1'];
  await writeAccess();
  if (!await attempt('OtherAgent')) throw new Error('hot access update did not take effect');
  await writeAccess(false);
  if (await attempt('GuestHuman')) throw new Error('unregistered guest was admitted in closed mode');
  if (!await attempt('MirrorAgent')) throw new Error('registered Agent lost access in closed mode');
  console.log('PASS: registered names IP-bound; unknown Eye blocked; guest policy and hot updates work');
} finally {
  child.kill();
}
