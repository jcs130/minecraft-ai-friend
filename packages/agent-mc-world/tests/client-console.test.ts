import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
async function setup(action: (name: string) => Promise<void> = async () => {}, withAssets = true, embedOrigins?: string[], nativeClients = true) {
  const assets = mkdtempSync(join(tmpdir(), 'mc-console-test-'));
  cleanups.push(() => rmSync(assets, { recursive: true, force: true }));
  if (withAssets) for (const file of ['index.html', 'console.js', 'console.css', 'metrics.html', 'metrics.js', 'metrics.css']) writeFileSync(join(assets, file), 'fixture');
  const runtime = { operatorState: async () => ({ schema: 'minecraft-client-console/v1', runtime: { phase: 'disconnected' },
    connection: { accounts: { agent: { mode: 'microsoft', phase: 'awaiting-user', challenge: { userCode: 'FIXTURE-1234' } } } } }),
    operatorAction: vi.fn(action), metrics: { snapshot: () => ({ schema: 'metrics', phase: 'disconnected' }) }, status: () => ({ phase: 'disconnected' }) };
  const server = await serveClientConsole(0, runtime, assets, undefined, {embedOrigins,nativeClients}); cleanups.push(() => server.close());
  const state = await (await fetch(server.url + 'api/client')).json() as { controlToken: string };
  const post = (body: string, headers = {}) => fetch(server.url + 'api/client/action', { method: 'POST', body,
    headers: { 'content-type': 'application/json', origin: server.url.slice(0, -1), 'x-mc-control': state.controlToken, ...headers } });
  return { ...server, runtime, state, post };
}
it('lets hosts disable native launchers in both operator metadata and authenticated actions',async()=>{
  const app=await setup(undefined,true,undefined,false);
  expect(app.state).toMatchObject({capabilities:{nativeClients:false}});
  for(const action of ['observer.start','observer.stop','player.start','player.stop'])
    expect((await app.post(JSON.stringify({action}))).status).toBe(403);
  expect(app.runtime.operatorAction).not.toHaveBeenCalled();
  expect((await app.post('{"action":"connect"}')).status).toBe(202);
  expect(app.runtime.operatorAction).toHaveBeenCalledWith('connect');
  expect((await app.post('{"action":"viewer.retry"}')).status).toBe(202);
  expect(app.runtime.operatorAction).toHaveBeenCalledWith('viewer.retry');
});
it('serves the operator UI and private challenge separately from read-only model metrics', async () => {
  const app = await setup(), page = await fetch(app.url);
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(page.headers.get('cache-control')).toBe('no-store'); expect(await page.text()).toBe('fixture');
  const metrics = await (await fetch(app.url + 'api/harness/metrics')).json();
  expect(JSON.stringify(metrics)).not.toMatch(/FIXTURE|controlToken/);
  expect((await fetch(app.url + 'auth/agent')).status).toBe(404);
  expect((await fetch(app.url + 'metrics')).headers.get('content-type')).toContain('text/html');
});
it('embeds only for explicit local host pages without authorizing cross-origin control', async () => {
  const app = await setup(undefined, true, ['http://127.0.0.1:17850']);
  const policy = (await fetch(app.url)).headers.get('content-security-policy');
  expect(policy).toContain('frame-ancestors http://127.0.0.1:17850;');
  expect(policy).toContain('frame-src http://127.0.0.1:*;');
  expect((await fetch(app.url+'metrics')).headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect((await app.post('{"action":"connect"}', {origin:'http://127.0.0.1:17850'})).status).toBe(403);
  expect((await fetch(app.url+'api/client', {headers:{origin:'http://127.0.0.1:17850'}})).status).toBe(403);
  expect(app.runtime.operatorAction).not.toHaveBeenCalled();
});
it('accepts the precise Desktop frame origin without granting its cross-origin APIs',async()=>{
  const app=await setup(undefined,true,['dsh-app://app']);
  expect((await fetch(app.url)).headers.get('content-security-policy')).toContain('frame-ancestors dsh-app://app;');
  expect((await app.post('{"action":"connect"}',{origin:'dsh-app://app'})).status).toBe(403);
  const snapshot=await(await fetch(app.url+'api/experiments')).json();
  expect(snapshot).toMatchObject({schema:'agent-mc.experiments/v1',enabled:false,jobs:[]});
  expect((await fetch(app.url+'api/experiments',{headers:{origin:'dsh-app://app'}})).status).toBe(403);
  const headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'iframe'};
  const request=(path:string,extra={})=>new Promise<number>((resolve,reject)=>{
    get(app.url+path,{headers:{...headers,...extra}},res=>{res.resume();resolve(res.statusCode!);}).on('error',reject);
  });
  expect(await request('')).toBe(200);
  expect(await request('api/experiments')).toBe(403);
  expect(await request('api/client')).toBe(403);
  expect(await request('',{'sec-fetch-dest':'document'})).toBe(403);
  expect(app.runtime.operatorAction).not.toHaveBeenCalled();
});
it.each(['*','http://remote.test:17850','http://127.0.0.1:17850/','http://127.0.0.1:17850; script-src *', 'https://127.0.0.1:17850','dsh-app://app/','dsh-app://other','dsh-app:','null'])('refuses unsafe embedding policy %s before opening a port', async origin => {
  await expect(serveClientConsole(0, {} as never, undefined, undefined, {embedOrigins:[origin]})).rejects.toThrow();
});
it('keeps the local control API usable without optional viewer assets', async () => {
  const app = await setup(undefined, false);
  const page = await fetch(app.url);
  expect(page.status).toBe(503);
  expect(await page.text()).toContain('未随附网页控制台');
  expect((await fetch(app.url + 'metrics')).status).toBe(503);
  expect(await (await fetch(app.url + 'api/client')).json()).toMatchObject({ webConsoleAvailable: false });
  expect((await app.post('{"action":"disconnect"}')).status).toBe(202);
  expect(app.runtime.operatorAction).toHaveBeenCalledWith('disconnect');
});
it('binds the engine-only human page to its owned descriptor and rejects stale instances', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mc-account-binding-'));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = { operatorState: vi.fn(async () => ({ schema:'minecraft-client-console/v1', connection:{accounts:{agent:{challenge:{userCode:'FIXTURE-1234'}}}} })),
    operatorAction: vi.fn(async () => {}), metrics:{snapshot:() => ({schema:'metrics'})}, status:() => ({phase:'disconnected'}) };
  const app = await serveClientConsole(0, runtime, directory, {directory,identity:'a'.repeat(24)});
  try {
    const descriptor = JSON.parse(readFileSync(join(directory, 'operator.json'), 'utf8'));
    expect(Object.keys(descriptor).sort()).toEqual(['identity','instanceId','port','schema']);
    expect(app.accountUrl).toBe(app.url + 'account/' + descriptor.instanceId);
    const page = await fetch(app.accountUrl);
    expect(page.status).toBe(200); expect(await page.text()).toContain('取消授权');
    expect((await fetch(app.url + 'account/' + 'b'.repeat(64))).status).toBe(404);
    expect((await fetch(app.url + 'api/client')).status).toBe(409);
    expect(runtime.operatorState).not.toHaveBeenCalled();
    const headers = {'x-mc-instance':descriptor.instanceId};
    const state = await (await fetch(app.url + 'api/client', {headers})).json() as {controlToken:string};
    const post = (extra = {}) => fetch(app.url + 'api/client/action', {method:'POST',body:'{"action":"disconnect"}',headers:{...headers,
      origin:app.url.slice(0,-1),'content-type':'application/json','x-mc-control':state.controlToken,...extra}});
    expect((await post({'x-mc-instance':'b'.repeat(64)})).status).toBe(403);
    expect((await post({origin:'https://attacker.test'})).status).toBe(403);
    expect((await post({'x-mc-control':'invalid'})).status).toBe(403);
    expect(runtime.operatorAction).not.toHaveBeenCalled();
    expect((await post()).status).toBe(202);
    expect(runtime.operatorAction).toHaveBeenCalledWith('disconnect');
    const metrics = await (await fetch(app.url + 'api/harness/metrics')).text();
    expect(metrics).not.toMatch(/FIXTURE|controlToken|instanceId/);
  } finally { await app.close(); }
  expect(existsSync(join(directory, 'operator.json'))).toBe(false);
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
