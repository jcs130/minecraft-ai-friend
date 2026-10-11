// Real Minecraft login/configuration through an isolated gateway. No production
// Paper, access registry, player files or reserved accounts are contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const probe = createRequire(process.env.AGENT_GATEWAY_PROBE_PACKAGE || 'E:/MC/probe/package.json');
const protocol = createRequire(probe.resolve('mineflayer/package.json'))('minecraft-protocol');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('confirmed same-source Agent admits its Eye; failures, disconnects, other sources and hot restrictions do not', { timeout: 30000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'agent-eye-sessions-'));
  const clients = new Set();
  const server = protocol.createServer({ host: '127.0.0.1', port: await freePort(), version: '1.20.6', 'online-mode': false,
    beforeLogin(client) { if (client.username === 'BrokenAgent') client.socket.destroy(); } });
  let gateway;
  t.after(async () => {
    for (const client of clients) client.socket?.destroy();
    if (gateway && gateway.exitCode === null) { gateway.kill(); await once(gateway, 'exit'); }
    server.close();
    await rm(folder, { recursive: true, force: true });
  });
  server.on('error', () => {});
  await once(server, 'listening');
  const access = { schemaVersion: 1, allowUnregisteredGuests: true, accounts: [] };
  const pairs = { schemaVersion: 1, pairs: [{ agent: 'AliasAgent', eye: 'CameraAlias' }] };
  const accessFile = join(folder, 'access.json'), pairsFile = join(folder, 'pairs.json'), opsFile = join(folder, 'ops.json');
  await writeFile(accessFile, JSON.stringify(access));
  await writeFile(pairsFile, JSON.stringify(pairs));
  await writeFile(opsFile, JSON.stringify([{ name: 'AdminAgent' }]));
  const port = await freePort();
  gateway = spawn(process.execPath, [fileURLToPath(new URL('./agent-lan-gateway.mjs', import.meta.url))], { windowsHide: true, env: {
    ...process.env, AGENT_GATEWAY_LISTEN_HOST: '127.0.0.1', AGENT_GATEWAY_LISTEN_PORT: String(port),
    AGENT_GATEWAY_CONTROL_PORT: String(await freePort()), AGENT_GATEWAY_BACKEND_PORT: String(server.socketServer.address().port),
    AGENT_GATEWAY_ACCESS_FILE: accessFile, AGENT_GATEWAY_PAIRS_FILE: pairsFile, AGENT_GATEWAY_OPS_FILE: opsFile
  } });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`gateway readiness timeout: ${output}`)), 5000);
    gateway.stdout.on('data', chunk => { output += chunk; if (output.includes('gateway listening')) { clearTimeout(timer); resolve(); } });
    gateway.stderr.on('data', chunk => { output += chunk; });
    gateway.once('exit', code => { clearTimeout(timer); reject(new Error(`gateway exited ${code}: ${output}`)); });
  });
  async function attempt(name, address = '127.0.0.1', version = '1.20.6') {
    const client = protocol.createClient({ host: '127.0.0.1', port, username: name, version, auth: 'offline',
      connect(c) { c.setSocket(net.connect({ host: '127.0.0.1', port, localAddress: address })); } });
    clients.add(client);
    client.on('error', () => {});
    const joined = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name} timed out`)), 5000);
      client.once('playerJoin', () => { clearTimeout(timer); resolve(true); });
      client.once('end', () => { clearTimeout(timer); resolve(false); });
    });
    return { client, joined };
  }
  async function expectLogin(name, expected, address) {
    const result = await attempt(name, address);
    assert.equal(result.joined, expected, `${name} from ${address || 'same source'}`);
    if (result.joined) result.client.end('test finished');
    await delay(30);
  }
  await expectLogin('ag_neko_eye', false);
  const failed = await attempt('BrokenAgent');
  assert.equal(failed.joined, false, 'backend closed before login success');
  await expectLogin('BrokenAgent_eye', false);
  const agent = await attempt('ag_NEKO');
  assert.equal(agent.joined, true);
  await expectLogin('ag_neko_eye', true);
  await expectLogin('ag_NEKOeye', true);
  await expectLogin('ag_neko_eye', false, '127.0.0.2');
  await expectLogin('OtherEye', false);
  await expectLogin('live', false);
  await expectLogin('Goddess', false);
  await expectLogin('AdminAgent', false);
  await expectLogin('CameraAlias', false);
  access.accounts.push({ name: 'ag_NEKO', allowedIps: [] });
  await writeFile(accessFile, JSON.stringify(access));
  await expectLogin('ag_neko_eye', false);
  access.accounts.length = 0;
  await writeFile(accessFile, JSON.stringify(access));
  await writeFile(pairsFile, JSON.stringify({ ...pairs, autoSameSourceEyes: false }));
  await expectLogin('ag_neko_eye', false);
  await writeFile(pairsFile, JSON.stringify(pairs));
  await expectLogin('ag_neko_eye', true);
  const replacement = await attempt('ag_NEKO');
  assert.equal(replacement.joined, true);
  const oldEnd = once(agent.client, 'end');
  agent.client.end('Agent offline');
  await oldEnd;
  await delay(50);
  await expectLogin('ag_neko_eye', true); // Closing the old socket preserves the new session.
  const replacementEnd = once(replacement.client, 'end');
  replacement.client.end('replacement offline');
  await replacementEnd;
  await delay(50);
  await expectLogin('ag_neko_eye', false);
});
