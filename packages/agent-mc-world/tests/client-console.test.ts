import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { serveClientConsole } from '../src/client/console-server.ts';
import { startMcpStdio } from '../src/mcp/stdio.ts';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function setup(action: (name: string) => Promise<void> = async () => {}) {
  const assets = mkdtempSync(join(tmpdir(), 'mc-console-test-'));
  cleanups.push(() => rmSync(assets, { recursive: true, force: true }));
  for (const file of ['index.html', 'console.js', 'console.css', 'metrics.html', 'metrics.js', 'metrics.css']) writeFileSync(join(assets, file), 'fixture');
  const runtime = { operatorState: async () => ({ schema: 'minecraft-client-console/v1', runtime: { phase: 'disconnected' },
    connection: { accounts: { agent: { mode: 'microsoft', phase: 'awaiting-user', challenge: { userCode: 'FIXTURE-1234' } } } } }),
    operatorAction: vi.fn(action), metrics: { snapshot: () => ({ schema: 'metrics', phase: 'disconnected' }) }, status: () => ({ phase: 'disconnected' }) };
  const server = await serveClientConsole(0, runtime, assets); cleanups.push(() => server.close());
  const state = await (await fetch(server.url + 'api/client')).json() as { controlToken: string };
  const post = (body: string, headers = {}) => fetch(server.url + 'api/client/action', { method: 'POST', body,
    headers: { 'content-type': 'application/json', origin: server.url.slice(0, -1), 'x-mc-control': state.controlToken, ...headers } });
  return { ...server, runtime, state, post };
}
it('serves the operator UI and private challenge separately from read-only model metrics', async () => {
  const app = await setup(), page = await fetch(app.url);
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(page.headers.get('cache-control')).toBe('no-store'); expect(await page.text()).toBe('fixture');
  const metrics = await (await fetch(app.url + 'api/harness/metrics')).json();
  expect(JSON.stringify(metrics)).not.toMatch(/FIXTURE|controlToken/);
  expect((await fetch(app.url + 'auth/agent')).status).toBe(404);
  expect((await fetch(app.url + 'metrics')).headers.get('content-type')).toContain('text/html');
});
it('requires local Host/Origin and the process nonce; GET cannot execute game or launcher actions', async () => {
  const app = await setup();
  const hostileHost = await new Promise<number | undefined>((resolve, reject) => {
    get(app.url + 'api/client', { headers: { host: 'attacker.test' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  expect(hostileHost).toBe(403);
  expect((await app.post('{"action":"connect"}', { origin: 'https://attacker.test' })).status).toBe(403);
  expect((await app.post('{"action":"connect"}', { 'x-mc-control': 'invalid' })).status).toBe(403);
  expect((await fetch(app.url + 'api/client/action?action=connect')).status).toBe(404);
  expect((await app.post('{"action":"execute-command"}')).status).toBe(400);
  expect((await app.post('x'.repeat(5000))).status).toBe(413);
  expect((await app.post('{')).status).toBe(400); expect(app.runtime.operatorAction).not.toHaveBeenCalled();
});
it('accepts a pending human login asynchronously, prevents duplicates and allows cancellation', async () => {
  let release!: () => void;
  const app = await setup(async name => { if (name === 'connect') await new Promise<void>(r => { release = r; }); });
  expect((await app.post('{"action":"connect"}')).status).toBe(202);
  expect((await app.post('{"action":"connect"}')).status).toBe(409);
  expect((await app.post('{"action":"disconnect"}')).status).toBe(202);
  expect(app.runtime.operatorAction).toHaveBeenCalledWith('disconnect'); release();
  await vi.waitFor(async () => {
    const state = await (await fetch(app.url + 'api/client')).json() as { operations: Record<string, { status: string }> };
    expect(state.operations.connect.status).toBe('completed');
  });
});
it('keeps raw operation failures and launch tokens out of HTTP responses', async () => {
  const app = await setup(async () => { throw Error('private-access-token'); });
  expect((await app.post('{"action":"observer.start"}')).status).toBe(202);
  await vi.waitFor(async () => {
    const state = await (await fetch(app.url + 'api/client')).json() as { operations: Record<string, { status: string }> };
    expect(state.operations['observer.start'].status).toBe('failed'); expect(JSON.stringify(state)).not.toContain('private-access-token');
  });
});
it('releases the operator port if a later MCP listener cannot start', async () => {
  const blocker = createServer(), probe = createServer();
  const listen = (server: ReturnType<typeof createServer>, port = 0) => new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve((server.address() as { port: number }).port); });
  });
  const stop = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  const metricsPort = await listen(blocker), consolePort = await listen(probe);
  await stop(probe); cleanups.push(() => stop(blocker));
  const dir = mkdtempSync(join(tmpdir(), 'mc-console-bootstrap-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, 'client.json'), args = process.argv;
  writeFileSync(config, JSON.stringify({ dataDir: './data', consolePort, metricsPort,
    world: { host: 'fixture.invalid', username: 'Fixture' } }));
  try {
    process.argv = [process.execPath, 'minecraft-agent-mcp', config];
    await expect(startMcpStdio()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  } finally { process.argv = args; }
  await listen(probe, consolePort); await stop(probe);
});
it('starts the standalone CLI on supported Node without connecting a game', async () => {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const dir = mkdtempSync(join(tmpdir(), 'mc-console-cli-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, 'client.json');
  writeFileSync(config, JSON.stringify({ dataDir: './data', consolePort: port,
    world: { host: 'fixture.invalid', username: 'cache-alias', auth: 'microsoft' } }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/minecraft-agent-client.mjs', import.meta.url)), config],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('CLI did not start')), 10000);
      let output = '';
      child.stderr.on('data', chunk => {
        output += String(chunk);
        if (output.includes('Minecraft connection console:')) { clearTimeout(timer); resolve(); }
      });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`CLI exited ${code}: ${output}`)); });
    });
    const state = await (await fetch(`http://127.0.0.1:${port}/api/client`)).json() as {
      runtime: { phase: string }; configuredAuthentication: { agent: string }; connection: { server: { actualVersion: null } };
    };
    expect(state.runtime.phase).toBe('disconnected'); expect(state.connection.server.actualVersion).toBeNull();
    expect(state.configuredAuthentication.agent).toBe('microsoft');
  } finally {
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; }
  }
}, 15000);
