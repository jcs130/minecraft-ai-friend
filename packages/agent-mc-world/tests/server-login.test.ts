import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { installServerLogin, readProtectedCredential } from '../core/server-login.mjs';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'server-login-')); dirs.push(dir);
  const credential = join(dir, 'credential'), configFile = join(dir, 'accounts.json');
  writeFileSync(credential, 'fixture-pass');
  const account = { server: 'example.test:25565', username: 'Agent', credentialFile: credential, command: 'login',
    requestMarkers: ['AUTH_LOGIN'], successMarkers: ['AUTH_SUCCESS'], failureMarkers: ['AUTH_FAILED', 'AUTH_2FA'] };
  writeFileSync(configFile, JSON.stringify({ enabled: true, accounts: [account] }));
  const sent: string[] = [], reports: unknown[] = [];
  const bot = Object.assign(new EventEmitter(), { chat: (text: string) => sent.push(text) });
  const messages = (text: string, position = 'system') => bot.emit('message', { toString: () => text }, position);
  const options = { server: 'example.test', username: 'Agent', configFile,
    readCredential: (file: string) => readFile(file), report: (status: unknown) => reports.push(status) };
  return { dir, credential, configFile, account, bot, sent, reports, messages, options };
}
async function settle(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() > end) throw new Error('authentication callback timeout'); await new Promise(r => setTimeout(r, 10)); }
}
describe('scoped automatic server authentication', () => {
  it('repeats a registration secret only when explicitly configured, without logging it', async () => {
    const r = fixture();
    writeFileSync(r.configFile, JSON.stringify({ enabled: true, accounts: [{ ...r.account,
      command: 'register', repeatPassword: true }] }));
    const login = installServerLogin(r.bot, r.options);
    r.messages('AUTH_LOGIN');
    await settle(() => r.sent.length === 1);
    expect(r.sent).toEqual(['/register fixture-pass fixture-pass']);
    expect(JSON.stringify(r.reports)).not.toContain('fixture-pass');
    login.stop();
  });
  it('supports explicit portable secret references and never enables play on password submission alone', async () => {
    const r = fixture();
    writeFileSync(r.configFile, JSON.stringify({ enabled: true, accounts: [{ ...r.account,
      credentialFile: undefined, credentialEnv: 'AGENT_MC_TEST_PASSWORD' }] }));
    vi.stubEnv('AGENT_MC_TEST_PASSWORD', 'portable-fixture');
    try {
      const login = installServerLogin(r.bot, { ...r.options, readCredential: undefined });
      expect(login.ready()).toBe(false);
      r.messages('AUTH_LOGIN');
      await settle(() => r.sent.length === 1);
      expect(r.sent).toEqual(['/login portable-fixture']);
      expect(login.ready()).toBe(false);
      r.messages('AUTH_SUCCESS');
      expect(login.ready()).toBe(true);
      expect(JSON.stringify(r.reports)).not.toContain('portable-fixture');
      login.stop(); expect(login.ready()).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });
  it('reads an explicitly selected private file relative to its account config', async () => {
    const r = fixture();
    writeFileSync(r.credential, 'file-fixture\n', { mode: 0o600 });
    writeFileSync(r.configFile, JSON.stringify({ enabled: true, accounts: [{ ...r.account,
      credentialFile: 'credential', credentialFormat: 'file' }] }));
    const login = installServerLogin(r.bot, { ...r.options, readCredential: undefined });
    r.messages('AUTH_LOGIN');
    await settle(() => r.sent.length === 1);
    expect(r.sent).toEqual(['/login file-fixture']);
    login.stop();
  });
  it('times out without confirmation and discards delayed success or credential results', async () => {
    vi.useFakeTimers();
    try {
      const r = fixture();
      writeFileSync(r.configFile, JSON.stringify({ enabled: true, accounts: [{ ...r.account, timeoutMs: 1000 }] }));
      let finish!: (value: Buffer) => void;
      const login = installServerLogin(r.bot, { ...r.options, readCredential: () => new Promise(resolve => { finish = resolve; }) });
      r.messages('AUTH_LOGIN');
      await vi.advanceTimersByTimeAsync(1000);
      expect(login.detail()).toMatchObject({ stage: 'blocked', reason: 'confirmation-timeout' });
      const bytes = Buffer.from('must-not-send'); finish(bytes);
      await Promise.resolve();
      r.messages('AUTH_SUCCESS');
      expect(login.ready()).toBe(false); expect(r.sent).toEqual([]);
      expect(bytes.every(byte => byte === 0)).toBe(true);
      login.stop();
    } finally { vi.useRealTimers(); }
  });
  it('submits once per connection, confirms separately and never reports the credential', async () => {
    const r = fixture(), login = installServerLogin(r.bot, r.options);
    r.messages('AUTH_LOGIN: required', 'chat'); r.messages('<Player> AUTH_LOGIN: required');
    expect(r.sent).toEqual([]);
    r.messages('§a[AUTH_LOGIN] required'); r.messages('AUTH_LOGIN: repeated');
    await settle(() => r.sent.length === 1);
    expect(r.sent).toEqual(['/login fixture-pass']);
    expect(login.status()).toEqual({ stage: 'submitted', attempted: true });
    r.messages('AUTH_LOGIN: repeated'); r.messages('AUTH_SUCCESS: welcome');
    expect(login.status().stage).toBe('confirmed');
    expect(JSON.stringify(r.reports)).not.toContain('fixture-pass');
    r.bot.emit('end'); expect(r.bot.listenerCount('message')).toBe(0);
    const second = fixture(); installServerLogin(second.bot, second.options); second.messages('AUTH_LOGIN');
    await settle(() => second.sent.length === 1);
  });
  it('does not read credentials for another account/server or duplicate account configuration', async () => {
    for (const options of [{ server: 'elsewhere.test' }, { username: 'Other' }]) {
      const r = fixture(); installServerLogin(r.bot, { ...r.options, ...options }); r.messages('AUTH_LOGIN');
      await new Promise(resolve => setTimeout(resolve, 20)); expect(r.sent).toEqual([]);
    }
    const r = fixture(); writeFileSync(r.configFile, JSON.stringify({ enabled: true, accounts: [r.account, r.account] }));
    const login = installServerLogin(r.bot, r.options); r.messages('AUTH_LOGIN');
    expect(login.status().stage).toBe('blocked'); expect(r.sent).toEqual([]);
  });
  it('halts on failure/2FA and cancels a credential read when the connection ends', async () => {
    for (const marker of ['AUTH_FAILED', 'AUTH_2FA']) {
      const r = fixture(), login = installServerLogin(r.bot, r.options);
      r.messages(marker); r.messages('AUTH_LOGIN'); expect(login.status().stage).toBe('blocked'); expect(r.sent).toEqual([]);
    }
    const r = fixture(); installServerLogin(r.bot, r.options);
    r.messages('AUTH_LOGIN'); r.bot.emit('end');
    await new Promise(resolve => setTimeout(resolve, 30)); expect(r.sent).toEqual([]);
    const unreadable = fixture(); rmSync(unreadable.credential);
    const login = installServerLogin(unreadable.bot, unreadable.options); unreadable.messages('AUTH_LOGIN');
    await settle(() => login.status().stage === 'blocked'); unreadable.messages('AUTH_LOGIN'); expect(unreadable.sent).toEqual([]);
  });
  it.skipIf(process.platform !== 'win32')('reads a real current-user DPAPI credential without plaintext process arguments', async () => {
    const r = fixture(), encrypted = join(r.dir, 'private.dpapi');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Security; $bytes=[Text.Encoding]::UTF8.GetBytes($env:CORTICO_TEST_VALUE); [IO.File]::WriteAllBytes($env:CORTICO_TEST_FILE,[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)); [Array]::Clear($bytes,0,$bytes.Length)'],
    { windowsHide: true, env: { ...process.env, CORTICO_TEST_VALUE: 'fixture-value', CORTICO_TEST_FILE: encrypted } });
    const bytes = await readProtectedCredential(encrypted);
    try { expect(bytes.toString('utf8')).toBe('fixture-value'); } finally { bytes.fill(0); }
  });
});
