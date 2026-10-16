/** Scoped server authentication; no credential or submitted command enters the event/context log. */
import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { execFile } from 'node:child_process';

export function readProtectedCredential(file) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') { reject(new Error('unsupported credential platform')); return; }
    const script = "Add-Type -AssemblyName System.Security; $cipher=[IO.File]::ReadAllBytes($env:CORTICO_MC_CREDENTIAL_FILE); if($cipher.Length -lt 1 -or $cipher.Length -gt 16384){throw 'Credential size'}; $plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); try {[Convert]::ToBase64String($plain)} finally {[Array]::Clear($plain,0,$plain.Length)}";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 5000, maxBuffer: 32768, encoding: 'utf8',
      env: { ...process.env, CORTICO_MC_CREDENTIAL_FILE: file },
    }, (error, stdout) => {
      if (error) { reject(new Error('private credential unavailable')); return; }
      resolve(Buffer.from(stdout.trim(), 'base64'));
    });
  });
}

const address = value => value.trim().toLowerCase().includes(':') ? value.trim().toLowerCase() : value.trim().toLowerCase() + ':25565';
const matches = (message, markers) => markers.some(marker => message.startsWith(marker) || message.startsWith('[' + marker + ']'));

/** Explicit portable secret source; the legacy file format remains DPAPI by default. */
async function readAccountCredential(account, configFile) {
  if (account.credentialEnv) {
    const value = process.env[account.credentialEnv];
    if (!value) throw new Error('private credential unavailable');
    return Buffer.from(value, 'utf8');
  }
  const file = resolvePath(dirname(configFile), account.credentialFile);
  if (account.credentialFormat !== 'file') return readProtectedCredential(file);
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024
      || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('private credential permissions');
    const bytes = await handle.readFile();
    // A trailing line break is allowed in a mounted secret file, never in the command.
    const result = Buffer.from(bytes.toString('utf8').replace(/\r?\n$/, ''), 'utf8');
    bytes.fill(0);
    return result;
  } finally { await handle.close(); }
}

export function installServerLogin(bot, options) {
  let stage = 'disabled', attempted = false, active = true, account, timer;
  let reason = null, authState = null;
  const report = (status, detail = null) => {
    if (stage === status && reason === detail) return;
    stage = status; reason = detail;
    if (['confirmed', 'blocked', 'closed'].includes(status)) clearTimeout(timer);
    options.report?.({ status, reason, username: options.username, server: options.server });
  };
  try {
    if (options.configFile) {
      const contents = readFileSync(options.configFile, 'utf8');
      if (contents.length > 32768) throw new Error('configuration size');
      const config = JSON.parse(contents);
      if (config.enabled === true && Array.isArray(config.accounts)) {
        const accounts = config.accounts.filter(a => a && typeof a.server === 'string'
          && address(a.server) === address(options.server) && a.username === options.username);
        if (accounts.length > 1) throw new Error('duplicate accounts');
        account = accounts[0] && { requestMarkers: ['MC_AUTH_LOGIN'], successMarkers: ['MC_AUTH_SUCCESS'],
          failureMarkers: ['MC_AUTH_FAILED', 'MC_AUTH_2FA'], ...accounts[0] };
        if (account) {
          const file = typeof account.credentialFile === 'string' && !!account.credentialFile;
          const env = typeof account.credentialEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(account.credentialEnv);
          if (Number(file) + Number(env) !== 1
            || (account.credentialFormat !== undefined && !['dpapi', 'file'].includes(account.credentialFormat))
            || !/^[a-z][a-z0-9_]*$/.test(account.command)
            || ['requestMarkers', 'successMarkers', 'failureMarkers'].some(key => !Array.isArray(account[key])
              || account[key].length > 16 || account[key].some(m => typeof m !== 'string' || !m.trim() || m.length > 160))) throw new Error('incomplete account');
          report('armed');
          const timeoutMs = account.timeoutMs ?? 30000;
          if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('invalid timeout');
          timer = setTimeout(() => { if (active && ['armed', 'submitted'].includes(stage)) report('blocked', 'confirmation-timeout'); }, timeoutMs);
          timer.unref?.();
        } else report('blocked', 'account-not-matched');
      } else if (config.enabled === true) {
        throw new Error('missing accounts');
      }
    }
  } catch { account = undefined; report('blocked', 'invalid-configuration'); }
  const stop = () => { active = false; clearTimeout(timer); bot.off('message', onMessage); bot.off('end', stop); bot.off('kicked', stop); stage = 'closed'; };
  const onMessage = (message, position) => {
    if (!active || !account || !['armed', 'submitted', 'confirmed', 'required'].includes(stage) || position !== 'system') return;
    const value = message.toString().replace(/§[0-9A-FK-OR]/gi, '').trimStart();
    const stateMatch = /^(?:MC_AUTH_STATE|\[MC_AUTH_STATE\])\s+(\{.*\})\s*$/s.exec(value);
    if (stateMatch) {
      // Only a direct system receipt can open the gate. Unknown/malformed
      // JSON is not success, even if a configured text marker matches it.
      try {
        const data = JSON.parse(stateMatch[1]);
        if (!data || typeof data !== 'object' || Array.isArray(data)
          || typeof data.authorized !== 'boolean' || typeof data.status !== 'string'
          || (data.username !== undefined && data.username !== options.username)) return;
        authState = { authorized: data.authorized === true,
          status: typeof data.status === 'string' ? data.status : 'unknown',
          passwordSet: typeof data.passwordSet === 'boolean' ? data.passwordSet : null,
          // Guidance only: never execute an arbitrary command from server text.
          nextCommand: typeof data.nextCommand === 'string' && data.nextCommand.length <= 256
            && !/[\r\n\x00]/.test(data.nextCommand) ? data.nextCommand : null };
        if (authState.authorized && authState.status === 'authenticated') report('confirmed');
        else if (data.authorized === false && ['confirmed', 'required'].includes(stage)) {
          report('required', 'authorization-revoked');
        }
      } catch { /* No authority in invalid JSON. */ }
      return;
    }
    if (/^(?:MC_AUTH_STATE|\[MC_AUTH_STATE\])(?:\s|$)/.test(value)) return;
    if (/^(?:MC_AUTH_DENIED|\[MC_AUTH_DENIED\])(?:\s|$)/.test(value)
      && ['confirmed', 'required'].includes(stage)) {
      authState = { ...authState, authorized: false, status: 'login_required',
        passwordSet: authState?.passwordSet ?? null, nextCommand: null };
      report('required', 'authorization-revoked');
      return;
    }
    if (matches(value, account.failureMarkers)) {
      report(['confirmed', 'required'].includes(stage) ? 'required' : 'blocked', 'server-rejected'); return;
    }
    if (matches(value, account.successMarkers)) {
      if (authState) authState = { ...authState, authorized: true, status: 'authenticated' };
      report('confirmed'); return;
    }
    if (attempted || ['confirmed', 'required'].includes(stage) || !matches(value, account.requestMarkers)) return;
    attempted = true;
    const selected = account;
    void (options.readCredential ? options.readCredential(selected.credentialFile) : readAccountCredential(selected, options.configFile)).then(bytes => {
      try {
        if (!active || stage !== 'armed') return;
        const password = bytes.toString('utf8');
        if (!password || password.length > 128 || /\s/.test(password)) throw new Error('invalid private credential');
        bot.chat('/' + selected.command + ' ' + password + (selected.repeatPassword === true ? ' ' + password : ''));
        report('submitted');
      } finally { bytes.fill(0); }
    }).catch(() => { if (active && stage === 'armed') report('blocked', 'credential-unavailable'); });
  };
  bot.on('message', onMessage);
  bot.once('end', stop);
  bot.once('kicked', stop);
  return { stop, status: () => ({ stage, attempted }), detail: () => ({ stage, attempted, reason,
      ...(authState ? { authState: { ...authState } } : {}) }),
    ready: () => stage === 'disabled' || stage === 'confirmed', authState: () => authState && { ...authState } };
}
