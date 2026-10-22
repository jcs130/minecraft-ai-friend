import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { seal, unseal } from '../src/game-accounts.mjs';
import { readNumenIdentities } from './numen-identities.mjs';

const uuid = /^[a-f0-9-]{36}$/;
async function keyFile(file) {
  const text = (await fs.readFile(file, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/i.test(text)) throw Error('INVALID_ACCOUNT_KEY');
  return Buffer.from(text, 'hex');
}

// One id is one account action. A lost HTTP response can redeliver the same id,
// but never overwrites a local request, result, or in-flight password operation.
export async function deliverAccountRequest(directory, localKey, remoteKey, item) {
  if (!uuid.test(item.id || '')) throw Error('ACCOUNT_ID_INVALID');
  const request = unseal(remoteKey, 'request:' + item.id, item.envelope);
  if (request.requestId !== item.id || request.schemaVersion !== 1 || !['create', 'claim', 'password'].includes(request.operation)) throw Error('ACCOUNT_REQUEST_INVALID');
  const filename = path.join(directory, 'requests', item.id + '.json');
  const result = path.join(directory, 'results', item.id + '.json');
  try { await fs.access(result); return false; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    const existing = unseal(localKey, 'request:' + item.id, await fs.readFile(filename, 'utf8'));
    if (JSON.stringify(existing) !== JSON.stringify(request)) throw Error('ACCOUNT_REQUEST_CONFLICT');
    return false;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!Number.isFinite(request.expiresAt) || request.expiresAt < Date.now()) return false;
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = filename + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, seal(localKey, 'request:' + item.id, request), { flag: 'wx', mode: 0o600 });
    // Hard-link gives atomic create-if-absent; rename would replace an earlier
    // request if another process raced this worker.
    try { await fs.link(temporary, filename); }
    catch (error) { if (error.code !== 'EEXIST') throw error; return false; }
    return true;
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

export async function accountSyncOnce(settings, state = { watch: [] }, fetcher = fetch) {
  const endpoint = new URL(settings.endpoint);
  if (endpoint.pathname !== '/api/v1/internal/accounts/poll' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))) throw Error('ACCOUNT_ENDPOINT_INVALID');
  if (!path.isAbsolute(settings.bridgeDirectory)) throw Error('ACCOUNT_DIRECTORY_INVALID');
  const token = (await fs.readFile(settings.tokenFile, 'utf8')).trim();
  if (!/^acc_[A-Za-z0-9_-]{43}$/.test(token)) throw Error('ACCOUNT_TOKEN_INVALID');
  const localKey = await keyFile(settings.localKeyFile), remoteKey = await keyFile(settings.remoteKeyFile);
  let ready = false, verify = false;
  try {
    const value = unseal(localKey, 'heartbeat', await fs.readFile(path.join(settings.bridgeDirectory, 'heartbeat.json'), 'utf8'));
    verify = value.verify === true; ready = value.ready === true && Number.isFinite(value.at) && Math.abs(Date.now() - value.at) < 5000;
  } catch { }
  const results = [], completed = [], delivered = [];
  for (const id of state.watch.filter(id => uuid.test(id)).slice(0, 64)) {
    try { const request = unseal(localKey, 'request:' + id, await fs.readFile(path.join(settings.bridgeDirectory, 'requests', id + '.json'), 'utf8')); if (request.requestId === id) delivered.push(id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      const value = unseal(localKey, 'result:' + id, await fs.readFile(path.join(settings.bridgeDirectory, 'results', id + '.json'), 'utf8'));
      if (value.requestId !== id) throw Error('ACCOUNT_LOCAL_RESULT_INVALID');
      if (!delivered.includes(id)) delivered.push(id);
      results.push({ id, envelope: seal(remoteKey, 'result:' + id, value) });
      if (value.state === 'succeeded') completed.push(value);
      if (results.length >= 8) break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let numen;
  if (settings.numen?.enabled === true && Date.now() - (state.numenAttemptAt || 0) >= 30000) {
    state.numenAttemptAt = Date.now();
    try { state.numenObservation = await readNumenIdentities(settings.numen); }
    catch { state.numenObservation = null; } // Unknown evidence cannot grant ownership; account login keeps working.
  }
  if (state.numenObservation && Date.now() - state.numenObservation.observedAt < 40000) numen = seal(remoteKey, 'numen-identities', state.numenObservation);
  const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ heartbeat: { ready, verify: ready && verify, at: Date.now() }, results, delivered, ...(numen ? { numen } : {}) }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Object.assign(Error('ACCOUNT_SYNC_REJECTED'), { status: response.status });
  const text = await response.text(); if (Buffer.byteLength(text) > 256 * 1024) throw Error('ACCOUNT_RESPONSE_TOO_LARGE');
  const value = JSON.parse(text);
  if (!Array.isArray(value.requests) || value.requests.length > 4 || !Array.isArray(value.watch) || value.watch.length > 64 || value.watch.some(id => !uuid.test(id))) throw Error('ACCOUNT_RESPONSE_INVALID');
  if (settings.portalIdentitiesFile && (completed.length || state.numenObservation)) {
    const identities = new Map();
    try { for (const row of JSON.parse(await fs.readFile(settings.portalIdentitiesFile, 'utf8')).identities || []) identities.set(row.name.toLowerCase(), row); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const row of completed.filter(row => value.acknowledged?.includes(row.requestId))) {
      if (!/^\.?[A-Za-z0-9_]{1,16}$/.test(row.username || '') || !uuid.test(row.playerUuid || '')) throw Error('ACCOUNT_REGISTRY_IDENTITY_INVALID');
      const previous = identities.get(row.username.toLowerCase());
      if (previous && previous.uuid !== row.playerUuid) throw Error('ACCOUNT_REGISTRY_IDENTITY_CONFLICT');
      identities.set(row.username.toLowerCase(), { ...previous, name: row.username, uuid: row.playerUuid });
    }
    for (const row of state.numenObservation?.companions || []) {
      const previous = identities.get(row.name.toLowerCase());
      // A reused name is never allowed to silently replace another UUID.
      if (previous && previous.uuid !== row.playerUuid) continue;
      identities.set(row.name.toLowerCase(), { name: row.name, uuid: row.playerUuid, kind: 'agent', source: row.source });
    }
    if (identities.size > 256) throw Error('ACCOUNT_REGISTRY_FULL');
    const temporary = settings.portalIdentitiesFile + '.tmp';
    await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, identities: [...identities.values()] }), { mode: 0o600 }); await fs.rename(temporary, settings.portalIdentitiesFile);
  }
  state.watch = [...new Set([...state.watch, ...value.watch, ...value.requests.map(item => item.id)])].slice(-64);
  // Persist the watch list before dispatch. A process crash cannot forget a
  // request whose game-side execution may already have started.
  if (settings.stateFile) {
    const temporary = settings.stateFile + '.tmp'; await fs.writeFile(temporary, JSON.stringify(state), { mode: 0o600 }); await fs.rename(temporary, settings.stateFile);
  }
  let dispatched = 0;
  if (ready) for (const item of value.requests) if (await deliverAccountRequest(settings.bridgeDirectory, localKey, remoteKey, item)) dispatched++;
  state.watch = state.watch.filter(id => !value.acknowledged?.includes(id) || value.watch.includes(id));
  return { ready, delivered: dispatched, reported: results.length };
}

async function main() {
  const option = process.argv.indexOf('--config'), file = process.argv[option + 1];
  if (option < 0 || !path.isAbsolute(file || '')) throw Error('Use --config with an absolute private configuration path');
  const settings = JSON.parse(await fs.readFile(file, 'utf8')), lockFile = path.join(path.dirname(file), 'accounts.lock');
  settings.stateFile ||= path.join(path.dirname(file), 'accounts-state.json');
  let lock;
  try { lock = await fs.open(lockFile, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await fs.readFile(lockFile, 'utf8')); if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Inspect account worker lock');
    try { process.kill(pid, 0); throw Error('Account worker already running'); } catch (reason) { if (reason.code !== 'ESRCH') throw reason; }
    await fs.unlink(lockFile); lock = await fs.open(lockFile, 'wx');
  }
  await lock.writeFile(String(process.pid));
  let state = { watch: [] }, stopping = false, previous;
  try { const saved = JSON.parse(await fs.readFile(settings.stateFile, 'utf8')); if (Array.isArray(saved.watch)) state = { watch: saved.watch.filter(id => uuid.test(id)).slice(-64) }; } catch { }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
  try {
    do {
      let report;
      try { const result = await accountSyncOnce(settings, state); report = result.ready ? '游戏账号通道已连接。' : '等待游戏认证桥上线；未派发建号操作。'; }
      catch (error) { report = '账号同步暂未确认' + (Number.isInteger(error.status) ? `（HTTP ${error.status}）` : '') + '；原请求不重放。'; }
      if (report !== previous) { console.log(report); previous = report; }
      if (process.argv.includes('--once')) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(10000, Math.max(3000, settings.intervalMs || 5000))));
    } while (!stopping);
  } finally { await lock.close(); await fs.unlink(lockFile).catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
