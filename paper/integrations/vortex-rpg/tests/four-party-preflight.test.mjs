import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MARKER, preflight, properties, validateMembership} from './four-party-preflight.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'party4-preflight-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const stage = path.join(root, 'stage'), deps = path.join(root, 'deps'), manifest = path.join(root, 'current.json'), output = path.join(root, 'fresh.json');
  fs.mkdirSync(stage); fs.mkdirSync(path.join(stage, 'plugins')); fs.mkdirSync(deps);
  fs.writeFileSync(path.join(deps, 'package.json'), '{}');
  fs.writeFileSync(path.join(stage, '.communication-qa'), MARKER);
  fs.writeFileSync(path.join(stage, 'server.properties'), 'server-ip=127.0.0.1\nserver-port=29397\nrcon.port=29398\nenable-rcon=true\nonline-mode=false\nrcon.password=local-test-fixture\n');
  const artifacts = {}, liveArtifactDigests = {};
  for (const [kind, name] of Object.entries({native: 'VortexRPG', bridge: 'QiandengjiRpg', friend: 'AgentFriend', fixture: 'CooperationFixture'})) {
    const file = 'plugins/' + name + '-fixture.jar', bytes = Buffer.from('synthetic-' + kind), digest = sha(bytes);
    fs.writeFileSync(path.join(stage, file), bytes);
    artifacts[kind] = {file, sha256: digest, baselineSha256: digest};
    if (kind !== 'fixture') liveArtifactDigests['E:\\MC\\server\\' + file] = digest;
  }
  fs.writeFileSync(manifest, JSON.stringify({liveArtifactDigests}));
  const lock = {schema: 'party4-stage-lock/v1', deploymentSha256: sha(fs.readFileSync(manifest)), artifacts};
  const lockPath = path.join(stage, '.party4-artifacts.json');
  const saveLock = () => fs.writeFileSync(lockPath, JSON.stringify(lock)); saveLock();
  return {root, stage, deps, manifest, output, lock, saveLock, run: () => preflight(stage, output, manifest, deps)};
}
test('local preflight does not load Mineflayer or contact game; leaves input bytes intact', t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.stage, 'server.properties'));
  const result = f.run();
  assert.equal(result.networkCalled, false); assert.equal(result.runtimeVerified, false);
  assert.equal(fs.existsSync(f.output), false);
  assert.deepEqual(before, fs.readFileSync(path.join(f.stage, 'server.properties')));
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./four-party-stage.mjs', import.meta.url)), '--preflight', f.stage, f.output, f.manifest, f.deps], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).modelCalled, false);
  assert.equal(fs.existsSync(f.output), false);
});
test('refuses unmarked, public, different-port and duplicate-property fixtures', t => {
  const f = fixture(t), props = path.join(f.stage, 'server.properties'), original = fs.readFileSync(props, 'utf8');
  for (const text of [original.replace('127.0.0.1', '0.0.0.0'), original.replace('29397', '25565'), original + 'server-port=25565\n']) {
    fs.writeFileSync(props, text); assert.throws(f.run);
  }
  fs.writeFileSync(props, original); fs.writeFileSync(path.join(f.stage, '.communication-qa'), 'production'); assert.throws(f.run);
});
test('refuses stale manifest and old candidate baseline even when JAR itself matches lock', t => {
  const f = fixture(t);
  f.lock.artifacts.bridge.baselineSha256 = 'a'.repeat(64); f.saveLock(); assert.throws(f.run, /Stale baseline/);
  f.lock.deploymentSha256 = 'b'.repeat(64); f.saveLock(); assert.throws(f.run, /current deployment/);
});
test('refuses changed plugins, missing proof and changes to native manager', t => {
  const f = fixture(t), item = f.lock.artifacts.bridge;
  fs.writeFileSync(path.join(f.stage, item.file), 'candidate'); assert.throws(f.run, /hash mismatch/);
  item.sha256 = sha(Buffer.from('candidate')); f.saveLock(); assert.throws(f.run, /build proof required/);
  item.buildReport = 'build.json'; item.buildReportSha256 = sha(Buffer.from('{}'));
  fs.writeFileSync(path.join(f.stage, item.buildReport), '{}'); f.saveLock(); assert.doesNotThrow(f.run);
  const native = f.lock.artifacts.native; fs.writeFileSync(path.join(f.stage, native.file), 'new-native'); native.sha256 = sha(Buffer.from('new-native')); f.saveLock();
  assert.throws(f.run, /unchanged current native/);
});
test('refuses reused output and symlinked input', t => {
  const f = fixture(t); fs.writeFileSync(f.output, 'retain'); assert.throws(f.run, /fresh output/);
  fs.unlinkSync(f.output); const item = f.lock.artifacts.friend, target = path.join(f.stage, item.file), bytes = fs.readFileSync(target);
  if (process.platform === 'win32') {
    // Directory junctions exercise the same real-path escape without requiring
    // Windows symlink privileges or skipping the production-path boundary.
    const plugins = path.join(f.stage, 'plugins'), external = path.join(f.root, 'external-plugins');
    fs.renameSync(plugins, external);
    fs.symlinkSync(external, plugins, 'junction');
  } else {
    fs.unlinkSync(target); const external = path.join(f.root, 'external.jar'); fs.writeFileSync(external, bytes); fs.symlinkSync(external, target);
  }
  assert.throws(f.run, /symlink/);
});
test('refuses traversal and writes inside server', t => {
  const f = fixture(t); assert.throws(() => preflight(f.stage, path.join(f.stage, 'result.json'), f.manifest, f.deps), /outside/);
  f.lock.artifacts.bridge.file = 'plugins/../../outside.jar'; f.saveLock(); assert.throws(f.run);
});
test('four status counts alone are insufficient; compare UUID sets, self and party ID', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const statuses = ids.map(id => ({type: 'party', queryOnly: true, inParty: true, selfUuid: id, partyId: 'p', memberCount: 4, members: ids.map(uuid => ({uuid}))}));
  assert.equal(validateMembership(statuses, ids), true);
  for (const alter of [s => {s[0].members[3].uuid = 'outsider';}, s => {s[1].partyId = 'other';}, s => {s[2].selfUuid = 'wrong';}, s => {s[3].members.push({uuid: 'fifth'});}, s => {s[0].inParty = false;}]) {
    const changed = structuredClone(statuses); alter(changed); assert.equal(validateMembership(changed, ids), false);
  }
});
test('properties reject unsupported syntax without exposing secrets', () => {
  assert.throws(() => properties('server-ip:127.0.0.1'), /Noncanonical/);
});
