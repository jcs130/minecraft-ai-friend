import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import mineflayer from 'mineflayer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinecraftAuthentication, protocolVersion, publicDeviceChallenge } from '../src/client/authentication.ts';
import { nullLogger } from '../src/client/index.ts';
import { Bridge } from '../core/bridge.ts';
import { GameClient } from '../core/client.ts';
import { buildClientLaunch } from '../core/client-launch.ts';
import { loadMinecraftClientConfig } from '../src/client/config-file.ts';

const directories: string[] = [], bridges: Bridge[] = [], clients: GameClient[] = [];
const dir = () => { const p = mkdtempSync(join(tmpdir(), 'mc-online-test-')); directories.push(p); return p; };
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stop();
  for (const bridge of bridges.splice(0)) await bridge.stop();
  vi.restoreAllMocks();
  for (const p of directories.splice(0)) {
    if (!resolve(p).startsWith(resolve(tmpdir()) + '\\mc-online-test-') && !resolve(p).startsWith(resolve(tmpdir()) + '/mc-online-test-')) throw Error('Unexpected test path');
    rmSync(p, { recursive: true, force: true });
  }
});
const challenge = { user_code: 'FIXT-1234', device_code: 'private-device-secret',
  verification_uri: 'https://www.microsoft.com/link', verification_uri_complete: 'https://evil.test/token=secret', expires_in: 900 };
const identity = { token: 'private-launch-token', profile: { name: 'ActualName', id: '0123456789abcdef0123456789abcdef' } };

describe('native Microsoft account lifecycle', () => {
  it('shows only a bounded official device challenge, never device secrets or provider messages', () => {
    const result = publicDeviceChallenge({ ...challenge, message: 'private-provider-message', verification_uri: 'https://evil.test/login', expires_in: 999999 }, 1000);
    expect(result).toEqual({ userCode: 'FIXT-1234', verificationUri: 'https://www.microsoft.com/link', expiresAt: new Date(1801000).toISOString() });
    expect(JSON.stringify(result)).not.toMatch(/secret|provider-message|evil/);
    expect(publicDeviceChallenge({ user_code: '<script>' })).toBeNull();
  });
  it('isolates three caches, deduplicates an outstanding Java launch and publishes the verified profile only', async () => {
    const directory = dir(), calls: string[] = [];
    let release!: (value: typeof identity) => void;
    const auth = new MinecraftAuthentication(() => ({ mode: 'microsoft', account: 'cache-alias' }), directory, 'observer',
      async (_account, folder, onCode) => { calls.push(folder); onCode(challenge); return new Promise(r => { release = r; }); });
    const first = auth.javaCredentials(), second = auth.javaCredentials();
    expect(first).toBe(second); await Promise.resolve();
    expect(auth.snapshot()).toMatchObject({ phase: 'awaiting-user', profile: null, challenge: { userCode: 'FIXT-1234' } });
    const other = new MinecraftAuthentication(() => ({ mode: 'microsoft', account: 'another-alias' }), directory, 'agent').botOptions();
    expect(other).toMatchObject({ auth: 'microsoft', profilesFolder: join(directory, 'auth', 'agent') });
    release(identity);
    expect(await first).toEqual({ username: 'ActualName', uuid: identity.profile.id, accessToken: identity.token });
    expect(calls).toEqual([join(directory, 'auth', 'observer')]);
    expect(auth.snapshot()).toMatchObject({ phase: 'ready', profile: { name: 'ActualName' }, challenge: null });
    expect(JSON.stringify(auth.snapshot())).not.toContain(identity.token);
  });
  it('rejects missing Java profiles and authentication errors without offline credentials or raw errors', async () => {
    for (const provider of [async () => { throw Error('sensitive-service-token'); }, async () => ({ token: 'x', profile: {} })]) {
      const auth = new MinecraftAuthentication(() => ({ mode: 'microsoft', account: 'alias' }), dir(), 'player', provider);
      await expect(auth.javaCredentials()).rejects.toThrow('不会回退');
      expect(auth.snapshot()).toMatchObject({ phase: 'failed', challenge: null, profile: null });
      expect(JSON.stringify(auth.snapshot())).not.toContain('sensitive');
    }
  });
  it('invalidates late device challenges and Java completions after cancellation', async () => {
    let code!: (value: unknown) => void, release!: (value: typeof identity) => void;
    const auth = new MinecraftAuthentication(() => ({ mode: 'microsoft', account: 'alias' }), dir(), 'observer',
      async (_account, _folder, onCode) => { code = onCode; return new Promise(r => { release = r; }); });
    const pending = auth.javaCredentials(); await Promise.resolve(); auth.stop(); code(challenge); release(identity);
    await expect(pending).rejects.toThrow('cancelled');
    expect(auth.snapshot()).toMatchObject({ phase: 'stopped', challenge: null, profile: null });
  });
  it('expires a displayed code and keeps a stopped connection from accepting late protocol profiles', () => {
    const auth = new MinecraftAuthentication(() => ({ mode: 'microsoft', account: 'alias' }), dir(), 'agent');
    const options = auth.botOptions();
    if (options.auth !== 'microsoft') throw Error('Expected Microsoft');
    options.onMsaCode({ ...challenge, expires_in: 1 });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
    expect(auth.snapshot()).toMatchObject({ challenge: null, detail: expect.stringContaining('过期') });
    auth.stop(); auth.acceptProtocolSession({ selectedProfile: identity.profile, accessToken: identity.token });
    expect(auth.snapshot().phase).toBe('stopped');
  });
  it('passes Microsoft auth and auto negotiation into the actual Bridge and cancels a late connection', async () => {
    const end = vi.fn(), auth = new MinecraftAuthentication(() => ({ mode: 'microsoft', account: 'alias' }), dir(), 'agent');
    const bot = Object.assign(new EventEmitter(), { version: '1.21.1',
      _client: Object.assign(new EventEmitter(), { end }), loadPlugin() {}, quit() {} });
    const create = vi.spyOn(mineflayer, 'createBot').mockReturnValue(bot as never);
    const bridge = new Bridge({ host: 'example.test', port: 25565, username: 'alias', version: 'auto', viewerPort: 0,
      authentication: auth, log: nullLogger(), onSpawn() {}, onDisconnect() {} }); bridges.push(bridge);
    bridge.start();
    expect(create.mock.calls[0][0]).toMatchObject({ auth: 'microsoft', version: undefined, logErrors: false });
    bot._client.emit('session', { selectedProfile: identity.profile });
    expect(auth.snapshot()).toMatchObject({ phase: 'ready', profile: { name: 'ActualName' } });
    await bridge.stop(); bot._client.emit('connect');
    expect(end).toHaveBeenCalledWith('Connection cancelled');
  });
  it('loads auto version, explicit auth and private cache paths without adding server rules', () => {
    const directory = dir(), path = join(directory, 'client.json');
    writeFileSync(path, JSON.stringify({ dataDir: './private', consolePort: 7796,
      world: { host: 'example.test', username: 'cache-alias@example.test', auth: 'microsoft', profilesFolder: './agent-cache',
        client: { auth: 'microsoft', profilesFolder: './observer-cache' } } }));
    const loaded = loadMinecraftClientConfig(path);
    expect(loaded.consolePort).toBe(7796);
    expect(loaded.cfg).toMatchObject({ version: 'auto', auth: 'microsoft', profilesFolder: join(directory, 'agent-cache') });
    expect(loaded.cfg.client.profilesFolder).toBe(join(directory, 'observer-cache'));
    expect(protocolVersion('auto')).toBe(false); expect(protocolVersion('1.21.1')).toBe('1.21.1');
    expect(() => protocolVersion('bedrock')).toThrow();
  });
});

const launcher = (auth: MinecraftAuthentication, marker: string) => {
  const client = new GameClient({ label: 'Fixture', enabled: () => false, gameDir: () => '', versionId: () => '', javaPath: () => '',
    username: () => 'cache-alias', jvmArgs: () => '', width: () => 800, height: () => 600, autoJoin: () => false,
    server: () => ({ host: 'example.test', port: 25565 }), noPauseOnLostFocus: () => false, chatUsable: () => false,
    authentication: auth, log: nullLogger(), commandOverride: { command: process.execPath,
      args: ['-e', 'require("node:fs").writeFileSync(process.argv[1],"launched");setTimeout(()=>{},1000)', marker] },
    windowPollMs: 1000, findWindow: async () => false }); clients.push(client); return client;
};
describe('Java launcher credentials', () => {
  it('uses the verified name, UUID and token for the private Java command', () => {
    const gameDir = dir(), version = join(gameDir, 'versions', 'fixture'); mkdirSync(version, { recursive: true });
    writeFileSync(join(version, 'fixture.jar'), 'fixture');
    writeFileSync(join(version, 'fixture.json'), JSON.stringify({ id: 'fixture', mainClass: 'example.Main', assetIndex: { id: 'fixture' },
      arguments: { game: ['--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}'] } }));
    const result = buildClientLaunch({ gameDir, versionId: 'fixture', javaPath: 'java', username: 'cache-alias', width: 800, height: 600,
      session: { username: identity.profile.name, uuid: identity.profile.id, accessToken: identity.token } });
    if ('error' in result) throw Error(result.error);
    expect(result.args.slice(-6)).toEqual(['--username', 'ActualName', '--uuid', identity.profile.id, '--accessToken', identity.token]);
  });
  it('does not spawn after cancellation while the human authorizes the account', async () => {
    let release!: (value: typeof identity) => void;
    const auth = new MinecraftAuthentication(() => ({ mode: 'microsoft', account: 'alias' }), dir(), 'observer',
      async () => new Promise(r => { release = r; }));
    const marker = join(dir(), 'marker'), client = launcher(auth, marker), pending = client.start();
    await Promise.resolve(); await client.stop(); release(identity); await pending;
    expect((await client.state()).phase).toBe('stopped'); expect(existsSync(marker)).toBe(false);
  });
  it('reports failed auth and keeps command previews/token caches out of public state', async () => {
    const auth = new MinecraftAuthentication(() => ({ mode: 'microsoft', account: 'alias' }), dir(), 'player',
      async () => { throw Error(identity.token); });
    const marker = join(dir(), 'marker'), client = launcher(auth, marker);
    expect(await client.start()).toMatchObject({ phase: 'error', command: null });
    expect(existsSync(marker)).toBe(false); expect(JSON.stringify(await client.state())).not.toContain(identity.token);
  });
  it('reuses an in-flight launch instead of creating duplicate Java processes', async () => {
    const auth = new MinecraftAuthentication(() => ({ mode: 'microsoft', account: 'alias' }), dir(), 'observer', async () => identity);
    const marker = join(dir(), 'marker'), client = launcher(auth, marker), first = client.start();
    expect(client.start()).toBe(first); await first;
    await vi.waitFor(() => expect(readFileSync(marker, 'utf8')).toBe('launched'));
    const pid = (await client.state()).pid; await client.start(); expect((await client.state()).pid).toBe(pid);
  });
});
