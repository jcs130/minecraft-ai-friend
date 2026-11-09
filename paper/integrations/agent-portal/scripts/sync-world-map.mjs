import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mapFileKey, MAP_FILE_LIMIT } from '../src/world-map.mjs';
import { parseMapObservation, readCommands, fileDigest } from './world-map-source.mjs';

const configPath = process.argv[process.argv.indexOf('--config') + 1];
if (!process.argv.includes('--config') || !path.isAbsolute(configPath)) throw Error('Use --config with an absolute private configuration path');
const settings = JSON.parse(await fs.readFile(configPath, 'utf8'));
const source = JSON.parse(await fs.readFile(settings.sourceConfig, 'utf8'));
const destination = new URL(source.endpoint);
if (destination.protocol !== 'https:' || destination.username || destination.password || destination.search || destination.hash
    || destination.pathname !== '/api/v1/internal/snapshot') throw Error('Use the existing HTTPS snapshot destination');
const token = (await fs.readFile(source.tokenFile, 'utf8')).trim();
if (!/^srv_[A-Za-z0-9_-]{43}$/.test(token)) throw Error('Invalid existing snapshot credential');
if (![settings.webRoot, settings.usercache, settings.rconModule].every(value => path.isAbsolute(value || ''))) throw Error('Use absolute local source paths');
const { command } = await import(pathToFileURL(settings.rconModule).href);
const webRoot = await fs.realpath(settings.webRoot), workRoot = path.dirname(configPath);
const lockPath = path.join(workRoot, 'sync.lock'), ledgerPath = path.join(workRoot, 'sync-ledger.json');
let lock;
try { lock = await fs.open(lockPath, 'wx'); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const previous = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  if (!Number.isInteger(previous.pid) || previous.pid < 1) throw Error('Inspect world map lock');
  try { process.kill(previous.pid, 0); throw Error('World map synchronization is already running'); }
  catch (reason) { if (reason.code !== 'ESRCH') throw reason; }
  await fs.unlink(lockPath); lock = await fs.open(lockPath, 'wx');
}
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
let ledger = { files: {}, sequence: 0 }, stopping = false, report = '';
try { ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
async function persist() { const tmp = ledgerPath + '.tmp'; await fs.writeFile(tmp, JSON.stringify(ledger)); await fs.rename(tmp, ledgerPath); }
async function send(route, bytes, type, extra = {}) {
  const response = await fetch(new URL(route, destination), { method: 'PUT', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': type, ...extra }, body: bytes, signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(data.error?.reason || 'MAP_PUBLISH_FAILED'), { status: response.status, currentSequence: data.error?.currentSequence });
  return data;
}
async function publishState() {
  const results = {};
  for (const [field, text] of Object.entries(readCommands)) results[field] = await command(text, 8000);
  const usercache = JSON.parse(await fs.readFile(settings.usercache, 'utf8'));
  const players = parseMapObservation(results, usercache, { excludeNames: settings.excludeNames || [] });
  ledger.sequence = Math.max(ledger.sequence + 1, Date.now()); await persist();
  const state = { schemaVersion: 1, sequence: ledger.sequence, observedAt: new Date().toISOString(), players, maps: settings.maps };
  await send('/api/v1/internal/world-map/state', JSON.stringify(state), 'application/json');
  return players.length;
}
async function files(directory = webRoot, prefix = '') {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const key = prefix + entry.name, file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { if (!key.split('/').some(part => part.startsWith('.')) && !key.endsWith('/live')) output.push(...await files(file, key + '/')); }
    else if (entry.isFile()) { try { mapFileKey(key); output.push({ key, file }); } catch { /* Not a reviewed public map file. */ } }
  }
  // Upload model/textures first; index and settings last so a new view never
  // advertises a world whose resources have not reached the cloud yet.
  return output.sort((a, b) => Number(/(?:^|\/)(?:settings\.json|index\.html)$/.test(a.key)) - Number(/(?:^|\/)(?:settings\.json|index\.html)$/.test(b.key)));
}
async function publishFiles() {
  let changed = 0;
  const pending = await files();
  const upload = async row => {
    const before = await fs.stat(row.file), fingerprint = `${before.size}:${before.mtimeMs}`;
    if (before.size > MAP_FILE_LIMIT || ledger.files[row.key]?.fingerprint === fingerprint) return;
    const bytes = await fs.readFile(row.file), after = await fs.stat(row.file);
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) return;
    const sha256 = fileDigest(bytes);
    if (ledger.files[row.key]?.sha256 !== sha256) {
      await send('/api/v1/internal/world-map/files/' + row.key, bytes, 'application/octet-stream', { 'X-Content-Sha256': sha256 }); changed++;
    }
    ledger.files[row.key] = { sha256, fingerprint };
  };
  for (let index = 0; index < pending.length; index += 6) {
    if (stopping) break;
    const batch = pending.slice(index, index + 6);
    const results = await Promise.allSettled(batch.map(upload));
    await persist();
    const failed = results.find(row => row.status === 'rejected');
    if (failed) throw failed.reason;
    // Keep position updates moving even while the first terrain upload runs.
    if (Date.now() - lastState > 5000) { await publishState(); lastState = Date.now(); }
  }
  return changed;
}
let lastState = 0, lastFiles = 0;
try {
  do {
    try { await fs.access(path.join(workRoot, 'stop.request')); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      const count = await publishState(); lastState = Date.now();
      let changed = 0;
      if (Date.now() - lastFiles >= 30000 || process.argv.includes('--once')) { changed = await publishFiles(); lastFiles = Date.now(); }
      await fs.writeFile(path.join(workRoot, 'status.json'), JSON.stringify({ available: true, observedAt: new Date().toISOString(), players: count, changedFiles: changed, sequence: ledger.sequence }));
      const next = `World map connected; ${count} visible residents.`;
      if (next !== report) { console.log(next); report = next; }
    } catch (error) {
      await fs.writeFile(path.join(workRoot, 'status.json'), JSON.stringify({ available: false, observedAt: new Date().toISOString(), reason: error.status ? 'MAP_REMOTE_' + error.status : error.message }));
      if (error.status === 409 && Number.isSafeInteger(error.currentSequence)) { ledger.sequence = Math.max(ledger.sequence, error.currentSequence); await persist(); }
      if ([401, 403].includes(error.status)) throw Error('World map authorization revoked');
      if (report !== 'disconnected') { console.warn('World map temporarily unavailable; retaining terrain and expiring positions.'); report = 'disconnected'; }
    }
    if (process.argv.includes('--once')) { if (report === 'disconnected') process.exitCode = 1; break; }
    await new Promise(resolve => setTimeout(resolve, 5000));
  } while (!stopping);
} finally { await lock.close(); await fs.unlink(lockPath).catch(() => {}); }
