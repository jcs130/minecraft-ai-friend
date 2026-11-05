/** Local-only validation, intentionally separate from Mineflayer/RCON imports. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const MARKER = '127.0.0.1:29397 20261030';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
export function properties(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const match = /^([a-z.-]+)=(.*)$/.exec(line);
    if (!match) fail('Noncanonical server.properties; export canonical Java properties first');
    if (Object.hasOwn(result, match[1])) fail('Duplicate server property');
    result[match[1]] = match[2].trim();
  }
  return result;
}
function localFile(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')) fail('Relative fixture file required');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep) || fs.realpathSync(resolved) !== resolved) fail('Fixture file escapes stage or uses symlink');
  return resolved;
}
export function preflight(stage, output, manifestPath, dependencyRoot) {
  if (![stage, output, manifestPath, dependencyRoot].every(v => typeof v === 'string' && path.isAbsolute(v))) fail('Absolute paths required');
  const root = path.resolve(stage);
  if (fs.realpathSync(root) !== root || fs.existsSync(output)) fail('Real stage and fresh output required');
  const parent = path.dirname(path.resolve(output));
  if (fs.realpathSync(parent) !== parent || path.resolve(output).startsWith(root + path.sep)) fail('Result must be outside the stage in an existing real directory');
  if (fs.readFileSync(localFile(root, '.communication-qa'), 'utf8').trim() !== MARKER) fail('Marked loopback fixture required');
  const p = properties(fs.readFileSync(localFile(root, 'server.properties'), 'utf8'));
  for (const [key, value] of Object.entries({'server-ip': '127.0.0.1', 'server-port': '29397', 'rcon.port': '29398', 'enable-rcon': 'true', 'online-mode': 'false'})) {
    if (p[key] !== value) fail('Loopback fixture property mismatch: ' + key);
  }
  if (!p['rcon.password']) fail('Fixture RCON password missing');
  const manifestBytes = fs.readFileSync(manifestPath), manifest = JSON.parse(manifestBytes);
  const lock = JSON.parse(fs.readFileSync(localFile(root, '.party4-artifacts.json'), 'utf8'));
  if (lock.schema !== 'party4-stage-lock/v1' || lock.deploymentSha256 !== sha(manifestBytes)) fail('Review stage artifacts against this current deployment manifest');
  const artifacts = {};
  for (const [kind, component] of Object.entries({native: 'VortexRPG', bridge: 'QiandengjiRpg', friend: 'AgentFriend', fixture: 'CooperationFixture'})) {
    const item = lock.artifacts?.[kind];
    if (!item || !item.file.startsWith('plugins/') || !item.file.endsWith('.jar') || !/^[a-f0-9]{64}$/.test(item.sha256)) fail('Missing locked plugin: ' + kind);
    const digest = sha(fs.readFileSync(localFile(root, item.file)));
    if (digest !== item.sha256) fail('Stage plugin hash mismatch: ' + kind);
    if (kind !== 'fixture') {
      const candidates = [...new Set(Object.entries(manifest.liveArtifactDigests ?? {}).filter(([name]) => {
        const base = path.posix.basename(name.replaceAll('\\', '/'));
        return base === component + '.jar' || base.startsWith(component + '-');
      }).map(([, value]) => value.toLowerCase()))];
      if (candidates.length !== 1 || !candidates.includes(item.baselineSha256)) fail('Stale baseline or ambiguous manifest: ' + kind);
      if (kind === 'native' && digest !== item.baselineSha256) fail('Use the unchanged current native manager');
      if (digest !== item.baselineSha256 && (!item.buildReport || !/^[a-f0-9]{64}$/.test(item.buildReportSha256 ?? ''))) fail('Rebased candidate build proof required');
      if (digest !== item.baselineSha256 && sha(fs.readFileSync(localFile(root, item.buildReport))) !== item.buildReportSha256) fail('Candidate build proof changed');
    }
    artifacts[kind] = {file: item.file, sha256: digest};
  }
  const packagePath = path.join(dependencyRoot, 'package.json');
  if (!fs.statSync(packagePath).isFile()) fail('Explicit Mineflayer consumer package required');
  return {root, output: path.resolve(output), packagePath, artifacts, deploymentSha256: sha(manifestBytes),
    productionChanged: false, networkCalled: false, modelCalled: false, runtimeVerified: false};
}

export function validateMembership(statuses, selfUuids) {
  if (statuses.length !== 4 || selfUuids.length !== 4 || new Set(selfUuids).size !== 4 || selfUuids.some(v => !v)) return false;
  const expected = [...selfUuids].sort().join(','), partyId = statuses[0]?.partyId;
  return Boolean(partyId) && statuses.every((value, index) => value?.type === 'party' && value.queryOnly === true
    && value.inParty === true && value.selfUuid === selfUuids[index] && value.partyId === partyId && value.memberCount === 4
    && Array.isArray(value.members) && value.members.length === 4 && value.members.map(m => m.uuid).sort().join(',') === expected);
}
