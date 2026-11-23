/** Scoped server authentication; no credential or submitted command enters the event/context log. */
import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { execFile } from 'node:child_process';
import { authMePasswordNbt, isAuthMeLoginDialog, minecraftTextComponent } from './nbt-text.mjs';
import { writeCustomClickLengthPrefixed } from './custom-click-action.mjs';

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
// Known auth plugins only. Do not strip an arbitrary [Name] prefix: that would
// treat a forwarded player line as a plugin receipt.
const AUTH_PLUGIN_PREFIX = /^\[(?:MaxAuth|AuthMe|玩家系统|LoginSecurity|nLogin|CrazyLogin|AuthMan|LibreLogin|OpeNLogin)\]\s*[»›▸>：:\-—|]?\s*/i;
const COLOR_CODES = /§[0-9A-FK-ORX]/gi;
const TRAILING_PUNCT = /[\s。．.！!？?、,，；;:：…·•]+$/u;
const LEADING_FILLER = /^(?:你|您|已经)+/u;
const PLAYER_WRAPPED = /^(?:\[[^\]\r\n]+\]\s*)?<[^>\r\n]+>\s/;
const NEGATION_BEFORE = /(?:未|没有|尚未|未能|没能|不是|非|not\s+(?:a\s+)?|un)$/i;

/** Plain text of a system receipt: colors, chat components, then known plugin prefix/separator. */
export function normalizeAuthReceipt(value) {
  let text = typeof value === 'string' ? value
    : (value && typeof value === 'object') ? (minecraftTextComponent(value) || (typeof value.toString === 'function' && value.toString !== Object.prototype.toString ? value.toString() : ''))
    : String(value ?? '');
  if (typeof text !== 'string') text = String(text ?? '');
  text = text.replace(COLOR_CODES, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const next = text.replace(AUTH_PLUGIN_PREFIX, '').trim();
    if (next === text) break;
    text = next;
  }
  return text.replace(TRAILING_PUNCT, '').trim();
}

function receiptKey(value) {
  return normalizeAuthReceipt(value).toLowerCase();
}

function residualReceipt(text) {
  return text.replace(LEADING_FILLER, '').replace(TRAILING_PUNCT, '').trim();
}

function isPlayerWrapped(value) {
  const raw = String(value ?? '').replace(COLOR_CODES, '').trim();
  return PLAYER_WRAPPED.test(raw);
}

function hasNegation(text, marker) {
  const n = text.toLowerCase(), m = marker.toLowerCase();
  if (!m) return false;
  const idx = n.lastIndexOf(m);
  if (idx < 0) return false;
  return NEGATION_BEFORE.test(n.slice(0, idx).replace(/\s+/g, ' ').trimEnd());
}

function remainderIsSeparator(text, marker) {
  const rest = text.slice(marker.length);
  return rest === '' || /^[:：,，.\s»›\-—]/.test(rest);
}

/** Configured markers keep startsWith (AUTH_SUCCESS: welcome) and [marker] form; also match after prefix/filler. Never bare includes. */
function matchesConfigured(message, markers) {
  const colored = String(message ?? '').replace(COLOR_CODES, '').replace(/\s+/g, ' ').trim();
  const stripped = receiptKey(message);
  const residual = residualReceipt(stripped);
  return markers.some((marker) => {
    const mColored = String(marker ?? '').replace(COLOR_CODES, '').trim();
    const m = receiptKey(marker);
    if (!m && !mColored) return false;
    if ((m && hasNegation(stripped, m)) || (mColored && hasNegation(colored, mColored))) return false;
    if (mColored && (colored.startsWith(mColored) || colored.startsWith('[' + mColored + ']'))) {
      return remainderIsSeparator(colored.startsWith(mColored) ? colored : colored.slice(1), mColored) || colored.startsWith('[' + mColored + ']');
    }
    if (m && (stripped === m || residual === m)) return true;
    if (m && stripped.startsWith(m) && remainderIsSeparator(stripped, m)) return true;
    if (m && residual.startsWith(m) && remainderIsSeparator(residual, m)) return true;
    return false;
  });
}

function matchesBuiltIn(message, receipts) {
  const stripped = receiptKey(message);
  const residual = residualReceipt(stripped);
  for (const candidate of [stripped, residual]) {
    if (receipts.has(candidate)) {
      if (hasNegation(stripped, candidate)) return false;
      return true;
    }
  }
  return false;
}

// Exact standard AuthMe / MaxAuth receipts, not a broad "success" or "login" substring.
// Custom markers remain available; authoritative structured state takes priority
// over these compatibility receipts. Registration is never inferred here.
// Stored already-normalized (lowercase, no trailing punctuation).
const loginSuccessReceipts = new Set([
  'successful login',
  'logged-in due to session reconnection',
  "you're already logged in",
  '已成功登录',
  '登录成功',
]);
const loginFailureReceipts = new Set(['wrong password', '密码错误', '密码不正确', '错误的密码']);
const loginPendingNotices = ['登录数据异常，请等待登录结束', '登录数据异常,请等待登录结束'];
const failureMessages = {
  'request-not-detected': '未识别到服务器登录提示，尚未提交密码',
  'credential-read-timeout': '服务器登录凭据读取超时，尚未提交密码',
  'confirmation-timeout': '服务器登录确认超时（密码已提交；不等于密码错误）',
  'reauthentication-timeout': '服务器重新登录等待超时',
  'server-rejected': '服务器拒绝了本次登录',
  'credential-unavailable': '配置的登录凭据不可用',
  'account-not-matched': '没有匹配当前服务器与账号的登录配置',
  'invalid-configuration': '登录配置无效',
};
export function serverLoginFailureText(reason) {
  return typeof reason === 'string' && Object.hasOwn(failureMessages, reason) ? failureMessages[reason] : null;
}

/** Explicit portable secret source; the legacy file format remains DPAPI by default. */
async function readAccountCredential(account, configFile) {
  if (account.credentialEnv) {
    const value = process.env[account.credentialEnv];
    if (!value) throw new Error('private credential unavailable');
    return Buffer.from(value, 'utf8');
  }
  const file = resolvePath(dirname(configFile), account.credentialFile);
  if (!['file', 'json'].includes(account.credentialFormat)) return readProtectedCredential(file);
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > (account.credentialFormat === 'json' ? 16384 : 1024)
      || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('private credential permissions');
    const bytes = await handle.readFile();
    try {
      if (account.credentialFormat === 'json') {
        const identity = JSON.parse(bytes.toString('utf8'));
        if (!identity || typeof identity !== 'object' || Array.isArray(identity)
          || !Object.hasOwn(identity, account.credentialField)
          || typeof identity[account.credentialField] !== 'string') throw new Error('private credential unavailable');
        return Buffer.from(identity[account.credentialField], 'utf8');
      }
      // A trailing line break is allowed in a mounted secret file, never in the command.
      return Buffer.from(bytes.toString('utf8').replace(/\r?\n$/, ''), 'utf8');
    } finally { bytes.fill(0); }
  } finally { await handle.close(); }
}

export function installServerLogin(bot, options) {
  let stage = 'disabled', attempted = false, active = true, account, timer;
  let reason = null, authState = null, recoveryAttempted = false, recovering = false;
  let dialogSubmit = false;
  let credentialGeneration = 0, timeoutMs = 30000, recoveredAt = null;
  const report = (status, detail = null) => {
    if (stage === status && reason === detail) return;
    if (status === 'confirmed' && recovering) { recoveredAt = Date.now(); recovering = false; }
    stage = status; reason = detail;
    // armed: wait for a login prompt (timer starts at arm).
    // submitted: wait for a success/failure receipt (timer restarts at submit, not left running from arm).
    // confirmed/blocked/required/retrying/closed: stop the timer. Never treat body/network ready as success.
    if (status === 'submitted' || status === 'armed') armTimer();
    else if (['confirmed', 'required', 'retrying', 'blocked', 'closed'].includes(status)) clearTimeout(timer);
    options.report?.({ status, reason, username: options.username, server: options.server });
  };
  const armTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (active && ['armed', 'submitted'].includes(stage)) {
        credentialGeneration++;
        const detail = recovering ? 'reauthentication-timeout' : !attempted ? 'request-not-detected'
          : stage === 'armed' ? 'credential-read-timeout' : 'confirmation-timeout';
        report(recovering ? 'required' : 'retrying', detail);
      }
    }, timeoutMs);
    timer.unref?.();
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
            || (account.credentialFormat !== undefined && !['dpapi', 'file', 'json'].includes(account.credentialFormat))
            || (account.credentialFormat === 'json' && (!file || typeof account.credentialField !== 'string'
              || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(account.credentialField)))
            || (account.credentialFormat !== 'json' && account.credentialField !== undefined)
            || !/^[a-z][a-z0-9_]*$/.test(account.command)
            || (account.reauthenticateOnRevoked !== undefined && typeof account.reauthenticateOnRevoked !== 'boolean')
            || ['requestMarkers', 'successMarkers', 'failureMarkers'].some(key => !Array.isArray(account[key])
              || account[key].length > 16 || account[key].some(m => typeof m !== 'string' || !m.trim() || m.length > 160))) throw new Error('incomplete account');
          timeoutMs = account.timeoutMs ?? 30000;
          if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('invalid timeout');
          // Missing final authorization is unknown, not a rejected credential.
          // End this attempt and let the connection owner use its normal backoff.
          // report('armed') starts the prompt-wait timer with the validated timeout.
          report('armed');
        } else report('blocked', 'account-not-matched');
      } else if (config.enabled === true) {
        throw new Error('missing accounts');
      }
    }
  } catch { account = undefined; report('blocked', 'invalid-configuration'); }
  const stop = () => {
    active = false; clearTimeout(timer);
    bot.off('message', onMessage); bot.off('title', onTitle); bot.off('end', stop); bot.off('kicked', stop);
    bot._client?.off?.('show_dialog', onDialog); bot._client?.off?.('clear_dialog', onClearDialog);
    stage = 'closed';
  };
  const submitCredential = (recovery = false) => {
    if (recovery) dialogSubmit = false;
    attempted = true; recovering = recovery;
    if (recovery) { recoveryAttempted = true; report('armed', 'reauthentication'); armTimer(); }
    const selected = account, generation = ++credentialGeneration;
    let credential;
    try { credential = options.readCredential ? options.readCredential(selected.credentialFile)
      : readAccountCredential(selected, options.configFile); }
    catch { if (active && generation === credentialGeneration && stage === 'armed') report('blocked', 'credential-unavailable'); return; }
    void credential.then(bytes => {
      try {
        if (!active || generation !== credentialGeneration || stage !== 'armed') return;
        const password = bytes.toString('utf8');
        if (!password || password.length > 128 || /\s/.test(password)) throw new Error('invalid private credential');
        if (dialogSubmit && bot._client && typeof bot._client.writeRaw === 'function') {
          writeCustomClickLengthPrefixed(bot._client, 'authme:prejoin-login/submit', authMePasswordNbt(password));
        } else {
          bot.chat('/' + selected.command + ' ' + password + (selected.repeatPassword === true ? ' ' + password : ''));
        }
        report('submitted', recovery ? 'reauthentication' : null);
      } finally { bytes.fill(0); }
    }).catch(() => { if (active && generation === credentialGeneration && stage === 'armed') report('blocked', 'credential-unavailable'); });
  };
  const revoke = (loginRequired) => {
    const wasConfirmed = stage === 'confirmed';
    credentialGeneration++;
    report('required', 'authorization-revoked');
    // One attempt per revocation; a stable authorized interval permits a later renewal.
    if (wasConfirmed && loginRequired && account.command === 'login'
      && account.reauthenticateOnRevoked !== false
      && (!recoveryAttempted || (recoveredAt !== null && Date.now() - recoveredAt >= 30000))) queueMicrotask(() => {
      if (active && stage === 'required' && reason === 'authorization-revoked') submitCredential(true);
    });
  };
  const onDialog = (packet) => {
    if (!active || !account || !['armed', 'submitted', 'required'].includes(stage)) return;
    const dialog = packet?.dialog ?? packet;
    if (!isAuthMeLoginDialog(dialog)) return;
    if (attempted || ['submitted', 'confirmed'].includes(stage)) return;
    if (account.command !== 'login') return;
    dialogSubmit = true;
    submitCredential();
  };
  const onClearDialog = () => { dialogSubmit = false; };
  const displayText = (message) => {
    if (typeof message === 'string') return message;
    if (message && typeof message.toString === 'function' && message.toString !== Object.prototype.toString) return message.toString();
    return minecraftTextComponent(message) || '';
  };
  const onReceipt = (message, position) => {
    if (!active || !account || !['armed', 'submitted', 'confirmed', 'required'].includes(stage)) return;
    if (position !== 'system' && position !== 'title' && position !== 'subtitle') return;
    const value = displayText(message).replace(COLOR_CODES, '').trimStart();
    if (loginPendingNotices.some(notice => value.includes(notice))) return;
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
          revoke(authState.status === 'login_required');
        }
      } catch { /* No authority in invalid JSON. */ }
      return;
    }
    if (/^(?:MC_AUTH_STATE|\[MC_AUTH_STATE\])(?:\s|$)/.test(value)) return;
    if (/^(?:MC_AUTH_DENIED|\[MC_AUTH_DENIED\])(?:\s|$)/.test(value)
      && ['confirmed', 'required'].includes(stage)) {
      authState = { ...authState, authorized: false, status: 'login_required',
        passwordSet: authState?.passwordSet ?? null, nextCommand: null };
      revoke(true);
      return;
    }
    const playerChat = isPlayerWrapped(value);
    if (playerChat) return;
    const loginReceiptAllowed = account.command === 'login' && !authState;
    if (matchesConfigured(value, account.failureMarkers) || (loginReceiptAllowed && matchesBuiltIn(value, loginFailureReceipts))) {
      report(['confirmed', 'required'].includes(stage) ? 'required' : 'blocked', 'server-rejected'); return;
    }
    if (matchesConfigured(value, account.successMarkers) || (loginReceiptAllowed && matchesBuiltIn(value, loginSuccessReceipts))) {
      if (authState) authState = { ...authState, authorized: true, status: 'authenticated' };
      report('confirmed'); return;
    }
    // Titles are not login prompts. AuthMe wording and plugin prefixes vary.
    // Only the configured login action may use this fallback; it never selects
    // register or a command from text. Player-chat wrappers are rejected above.
    if (position === 'title' || position === 'subtitle') return;
    const wantsLogin = matchesConfigured(value, account.requestMarkers) || (account.command === 'login'
      && /\/login\b/i.test(value));
    if (attempted || ['confirmed', 'required'].includes(stage) || !wantsLogin) return;
    submitCredential();
  };
  const onMessage = (message, position) => onReceipt(message, position);
  const onTitle = (text, kind) => {
    if (kind && kind !== 'title' && kind !== 'subtitle') return;
    onReceipt(text, kind === 'subtitle' ? 'subtitle' : 'title');
  };
  bot.on('message', onMessage);
  bot.on('title', onTitle);
  bot._client?.on?.('show_dialog', onDialog);
  bot._client?.on?.('clear_dialog', onClearDialog);
  bot.once('end', stop);
  bot.once('kicked', stop);
  return { stop, status: () => ({ stage, attempted }), detail: () => ({ stage, attempted, reason,
      ...(authState ? { authState: { ...authState } } : {}) }),
    ready: () => stage === 'disabled' || stage === 'confirmed', authState: () => authState && { ...authState } };
}
