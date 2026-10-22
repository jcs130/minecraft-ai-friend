import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { GameData } from '../src/game-data.mjs';
import { WorldCatalog } from '../src/world-catalog.mjs';
import { buildSnapshot } from '../src/cloud-source.mjs';

const configPath = process.argv[process.argv.indexOf('--config') + 1];
if (!process.argv.includes('--config') || !path.isAbsolute(configPath)) throw Error('Use --config with an absolute private configuration file');
const settings = JSON.parse(await fs.readFile(configPath, 'utf8'));
const endpoint = new URL(settings.endpoint);
if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname))) throw Error('Use HTTPS or loopback for snapshot synchronization');
if (endpoint.pathname !== '/api/v1/internal/snapshot') throw Error('Unexpected synchronization endpoint');
const token = (await fs.readFile(settings.tokenFile, 'utf8')).trim();
if (!/^srv_[A-Za-z0-9_-]{43}$/.test(token)) throw Error('Invalid synchronization credential');
const config = loadConfig({ ...settings.game, sourceMode: 'local', authBridge: { enabled: false }, dataDir: settings.sourceDataDir });
const stateFile = path.join(path.dirname(configPath), 'sequence.json'), lockFile = path.join(path.dirname(configPath), 'sync.lock');
let lock;
try { lock = await fs.open(lockFile, 'wx'); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const owner = Number(await fs.readFile(lockFile, 'utf8'));
  if (!Number.isInteger(owner) || owner <= 0) throw Error('Inspect the synchronization lock');
  try { process.kill(owner, 0); throw Error('Synchronization is already running'); }
  catch (reason) { if (reason.code !== 'ESRCH') throw reason; }
  await fs.unlink(lockFile); lock = await fs.open(lockFile, 'wx');
}
await lock.writeFile(String(process.pid));
const store = new Store(config.dataDir), game = new GameData(config, store.salt), world = new WorldCatalog(config, game, store);
let sequence = 0, stopping = false, lastReport;
try { sequence = JSON.parse(await fs.readFile(stateFile, 'utf8')).sequence; } catch { }
const report = text => { if (lastReport !== text) { console.log(text); lastReport = text; } };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
async function persistSequence() {
  await fs.writeFile(stateFile + '.tmp', JSON.stringify({ sequence }), { mode: 0o600 });
  await fs.rename(stateFile + '.tmp', stateFile);
}
try {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw Error('Inspect the synchronization sequence file');
  do {
    try {
      sequence++; await persistSequence();
      const snapshot = await buildSnapshot(game, world, sequence), body = JSON.stringify(snapshot);
      if (Buffer.byteLength(body) > 2097152) throw Error('Snapshot exceeds the configured size');
      if (process.argv.includes('--dry-run')) { console.log(JSON.stringify({ sequence, roster: snapshot.roster.length, privateProfiles: Object.keys(snapshot.states).length, events: snapshot.events.length, bytes: Buffer.byteLength(body) })); break; }
      const response = await fetch(endpoint, { method: 'PUT', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (response.status === 409 && Number.isSafeInteger(result.error?.currentSequence)) { sequence = Math.max(sequence, result.error.currentSequence); await persistSequence(); }
      else if (!response.ok) throw Object.assign(Error('Synchronization rejected'), { status: response.status });
      else report('云端资料同步已连接。');
      if (process.argv.includes('--once') && !response.ok) process.exitCode = 1;
    } catch (error) {
      report('云端资料同步暂不可用' + (error.status ? `（HTTP ${error.status}）` : error.reason ? `（${error.reason}）` : '') + '；保留保存资料，等待恢复。');
      if ([401, 403].includes(error.status)) { process.exitCode = 1; break; }
      if (process.argv.includes('--once') || process.argv.includes('--dry-run')) process.exitCode = 1;
    }
    if (process.argv.includes('--once') || process.argv.includes('--dry-run')) break;
    const until = Date.now() + Math.max(10000, Number(settings.intervalMs) || 15000);
    while (!stopping && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 500));
  } while (!stopping);
} finally { store.close(); await lock.close(); await fs.unlink(lockFile); }
