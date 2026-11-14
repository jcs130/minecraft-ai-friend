import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installServerLogin } from '../src/client/index.ts';
import { authMePasswordNbt } from '../core/nbt-text.mjs';
import { encodeLengthPrefixedAnonymousNbt, encodeOptionalAnonymousNbt } from '../core/custom-click-action.mjs';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'server-login-dialog-')); dirs.push(dir);
  const credential = join(dir, 'credential'), configFile = join(dir, 'accounts.json');
  writeFileSync(credential, 'fixture-pass', { mode: 0o600 });
  writeFileSync(configFile, JSON.stringify({
    enabled: true,
    accounts: [{
      server: 'example.test:25565', username: 'Agent', credentialFile: credential, command: 'login',
      requestMarkers: ['AUTH_LOGIN'], successMarkers: ['AUTH_SUCCESS'], failureMarkers: ['AUTH_FAILED'],
    }],
  }));
  const sentChat: string[] = [], raw: Buffer[] = [], reports: unknown[] = [];
  const client = Object.assign(new EventEmitter(), {
    state: 'configuration',
    version: '26.1',
    writeRaw(buf: Buffer) { raw.push(Buffer.from(buf)); },
    write() { throw new Error('library custom_click_action writer must not be used'); },
  });
  const bot = Object.assign(new EventEmitter(), {
    chat: (text: string) => sentChat.push(text),
    _client: client,
  });
  const login = installServerLogin(bot, {
    server: 'example.test', username: 'Agent', configFile,
    readCredential: (file: string) => readFile(file),
    report: (status: unknown) => reports.push(status),
  });
  return { bot, client, sentChat, raw, reports, login, messages: (text: string, position = 'system') => bot.emit('message', { toString: () => text }, position) };
}

async function settle(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() > end) throw new Error('authentication callback timeout'); await new Promise(r => setTimeout(r, 10)); }
}

const dialogNbt = {
  type: 'compound',
  value: {
    type: { type: 'string', value: 'minecraft:multi_action' },
    title: { type: 'compound', value: { text: { type: 'string', value: '登录' } } },
    inputs: { type: 'list', value: { type: 'compound', value: [{ key: { type: 'string', value: 'password' } }] } },
    actions: { type: 'list', value: { type: 'compound', value: [
      { action: { type: 'compound', value: { id: { type: 'string', value: 'authme:prejoin-login/submit' } } } },
      { action: { type: 'compound', value: { id: { type: 'string', value: 'authme:prejoin-login/cancel' } } } },
    ] } },
  },
};

describe('AuthMe configuration-phase dialog login', () => {
  it('submits a length-prefixed password payload once and waits for the success receipt', async () => {
    const r = fixture();
    r.client.emit('show_dialog', { dialog: dialogNbt });
    await settle(() => r.raw.length === 1);
    expect(r.sentChat).toEqual([]);
    const payload = encodeLengthPrefixedAnonymousNbt(authMePasswordNbt('fixture-pass')).payload;
    expect(r.raw[0].includes(payload)).toBe(true);
    expect(r.raw[0].includes(encodeOptionalAnonymousNbt(authMePasswordNbt('fixture-pass')))).toBe(false);
    expect(JSON.stringify(r.reports)).not.toContain('fixture-pass');
    expect(r.login.ready()).toBe(false);
    r.messages('登录数据异常，请等待登录结束');
    expect(r.login.ready()).toBe(false);
    r.client.emit('show_dialog', { dialog: dialogNbt });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(r.raw).toHaveLength(1);
    r.messages('[玩家系统] 已成功登录！');
    expect(r.login.ready()).toBe(true);
    r.login.stop();
  });

  it('still accepts a later chat /login prompt as a one-shot fallback', async () => {
    const r = fixture();
    r.messages('Please, login with the command: /login <password>');
    await settle(() => r.sentChat.length === 1);
    expect(r.sentChat).toEqual(['/login fixture-pass']);
    expect(r.raw).toEqual([]);
    r.login.stop();
  });
});
