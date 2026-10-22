import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { siteFixture, testPassword } from './helpers.mjs';
import { newSecret, digest } from '../src/store.mjs';
import { pngInfo, ysmArchive } from '../src/appearance-files.mjs';
import { AppearanceWorker, identifier } from '../scripts/appearance-worker.mjs';
import { png, zip, modelFiles } from './appearance-fixtures.mjs';

const headers = { 'X-Appearance-Label': encodeURIComponent('日常服'), 'X-Skin-Variant': 'slim', 'X-Appearance-Consent': 'public-game-appearance' };
async function own(f) { const owner = f.portal.store.ownerByName('fixture-admin'); f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, f.uuid, 'isolated test', Date.now()); return owner; }
const upload = (f, kind = 'skin', bytes = png()) => f.admin.binary(`/agents/${f.agent.id}/appearance/${kind}`, 'POST', bytes, kind === 'skin' ? 'image/png' : 'application/zip', headers);
async function poll(f, token, body = {}) { const response = await fetch(f.origin + '/api/v1/internal/appearance/poll', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ at: Date.now(), ready: true, results: [], ...body }) }); return { status: response.status, data: await response.json() }; }

test('PNG and YSM accept actual complete resources, including a single enclosing directory', () => {
  assert.equal(pngInfo(png(), true).width, 64); assert.equal(pngInfo(png(64, 32), true).height, 32);
  const model = ysmArchive(zip(modelFiles())); assert.equal(model.webConvertible, true); assert.equal(model.textures[0].name, 'default');
  assert.equal(ysmArchive(zip(Object.fromEntries(Object.entries(modelFiles()).map(([key, value]) => ['cat/' + key, value])))).textures.length, 1);
});
test('PNG refuses corrupt pixels, missing ends, invalid dimensions and arbitrary disguised data', () => {
  const bad = png(); bad[50] ^= 1;
  for (const bytes of [bad, png().subarray(0, 50), Buffer.from('not-a-png'), png(128, 128)]) assert.throws(() => pngInfo(bytes, true));
});
test('YSM rejects traversal, links, duplicates, encryption, expansion bombs and code', () => {
  for (const extra of [{ '../x.png': png() }, { 'C:/x.json': '{}' }, { 'evil.mjs': 'process.exit()' }, { 'same.json': '{}', 'SAME.json': '{}' }]) assert.throws(() => ysmArchive(zip({ ...modelFiles(), ...extra })));
  assert.throws(() => ysmArchive(zip(modelFiles(), { mode: 0o120777 })));
  assert.throws(() => ysmArchive(zip({ ...modelFiles(), 'bomb.json': 'x'.repeat(8 * 1024 * 1024 + 1) })));
  const encrypted = zip(modelFiles()); encrypted.writeUInt16LE(1, 6); assert.throws(() => ysmArchive(encrypted));
});
test('YSM refuses nonpublic sources, missing references, incomplete geometry and unknown textures', () => {
  const cases = [ { ...modelFiles(), 'ysm.json': '{"spec":2,"properties":{"free":false}}' }, { ...modelFiles(), 'model.json': '{}' }, { ...modelFiles(), 'animation.json': 'bad' } ];
  const missing = modelFiles(); delete missing['default.png']; cases.push(missing);
  for (const files of cases) assert.throws(() => ysmArchive(zip(files)));
  const missingArm = modelFiles(), definition = JSON.parse(missingArm['ysm.json']); delete definition.files.player.model.arm; missingArm['ysm.json'] = JSON.stringify(definition);
  assert.throws(() => ysmArchive(zip(missingArm)), /资源缺失/);
});
test('appearance uploads are owned, consented, private, deduplicated and do not apply implicitly', async t => {
  const f = await siteFixture(t); assert.equal((await upload(f)).status, 403); await own(f);
  const noConsent = await f.admin.binary(`/agents/${f.agent.id}/appearance/skin`, 'POST', png(), 'image/png', { ...headers, 'X-Appearance-Consent': '' }); assert.equal(noConsent.status, 400);
  const response = await upload(f), data = await response.json(); assert.equal(response.status, 201); assert.equal(data.assets.length, 1); assert.equal(data.jobs.length, 0); assert.equal(data.capabilities.ready, false);
  assert.equal((await (await upload(f)).json()).assets.length, 1);
  assert.equal((await fetch(f.origin + data.assets[0].image)).status, 401);
  assert.equal((await fetch(f.origin + '/appearance/skins/' + data.assets[0].sha256 + '.png')).status, 404);
});
test('appearance application is idempotent and pending requests cannot be duplicated', async t => {
  const f = await siteFixture(t); await own(f); const data = await (await upload(f)).json(), body = { requestId: randomUUID(), assetId: data.assets[0].id };
  assert.equal((await f.admin.request(`/agents/${f.agent.id}/appearance/apply`, 'POST', body)).status, 202);
  const again = await f.admin.request(`/agents/${f.agent.id}/appearance/apply`, 'POST', body); assert.equal(again.data.jobs.length, 1);
  assert.equal((await f.admin.request(`/agents/${f.agent.id}/appearance/apply`, 'POST', { ...body, requestId: randomUUID() })).status, 409);
  assert.equal((await f.admin.request(`/agents/${f.agent.id}/appearance/assets/${body.assetId}`, 'DELETE')).status, 409);
});
test('worker reports require exact UUID and hash, and confirmed model and texture', async t => {
  const token = 'app_' + newSecret(), f = await siteFixture(t, { appearance: { bridgeEnabled: true, tokenHash: digest(token) } }); await own(f);
  const data = await (await upload(f, 'ysm', zip(modelFiles()))).json(); const requestId = randomUUID(); await f.admin.request(`/agents/${f.agent.id}/appearance/apply`, 'POST', { requestId, assetId: data.assets[0].id, texture: 'default' });
  assert.equal((await poll(f, 'app_' + newSecret())).status, 401);
  const first = (await poll(f, token)).data.requests[0]; assert.ok(first.base64); assert.equal(first.reconciliationOnly, false);
  const second = (await poll(f, token)).data.requests[0]; assert.equal(second.base64, undefined); assert.equal(second.reconciliationOnly, true);
  const result = { id: first.id, playerUuid: first.playerUuid, sha256: first.sha256, state: 'applied', reason: 'YSM_BOUND', message: '已核对', identifier: identifier(first), texture: 'default', webAvailable: true };
  assert.equal((await poll(f, token, { results: [{ ...result, playerUuid: randomUUID() }] })).status, 400);
  assert.equal((await poll(f, token, { results: [{ ...result, webAvailable: false }] })).status, 400);
  assert.equal((await poll(f, token, { results: [result] })).status, 200);
  const final = (await f.admin.request(`/agents/${f.agent.id}/appearance`)).data; assert.equal(final.jobs[0].state, 'applied');
  assert.equal((await poll(f, token, { results: [{ ...result, state: 'failed' }] })).status, 409);
});
test('owner changes block a queued appearance before it reaches the game', async t => {
  const token = 'app_' + newSecret(), f = await siteFixture(t, { appearance: { bridgeEnabled: true, tokenHash: digest(token) } }); await own(f);
  const data = await (await upload(f)).json(); await f.admin.request(`/agents/${f.agent.id}/appearance/apply`, 'POST', { requestId: randomUUID(), assetId: data.assets[0].id });
  f.portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(f.uuid);
  assert.equal((await poll(f, token)).data.requests.length, 0); assert.equal(f.portal.store.db.prepare('SELECT state FROM appearance_jobs').get().state, 'failed');
});
test('identical existing-model reuse needs proof of the exact uploaded source, never an arbitrary model name', async t => {
  const token = 'app_' + newSecret(), f = await siteFixture(t, { appearance: { bridgeEnabled: true, tokenHash: digest(token) } }); await own(f);
  const data = await (await upload(f, 'ysm', zip(modelFiles()))).json(), asset = data.assets[0];
  await f.admin.request(`/agents/${f.agent.id}/appearance/apply`, 'POST', { requestId: randomUUID(), assetId: asset.id });
  const job = (await poll(f, token)).data.requests[0], receipt = { id: job.id, playerUuid: job.playerUuid, sha256: job.sha256, state: 'applied', identifier: 'existing_public_cat', texture: 'default', webAvailable: true, reusedExisting: true, sourceSha256: '0'.repeat(64), reason: 'YSM_BOUND', message: '已核对原始资源' };
  assert.equal((await poll(f, token, { results: [receipt] })).status, 400);
  assert.equal((await poll(f, token, { results: [{ ...receipt, sourceSha256: asset.sourceSha256 }] })).status, 200);
});
test('replaced files can be removed without losing receipts, while the currently bound file stays protected', async t => {
  const token = 'app_' + newSecret(), f = await siteFixture(t, { appearance: { bridgeEnabled: true, tokenHash: digest(token) } }); await own(f);
  const first = (await (await upload(f)).json()).assets[0];
  for (const asset of [first, null]) {
    const selected = asset || (await (await f.admin.binary(`/agents/${f.agent.id}/appearance/skin`, 'POST', png(), 'image/png', { ...headers, 'X-Skin-Variant': 'classic' })).json()).assets.find(row => row.variant === 'classic');
    await f.admin.request(`/agents/${f.agent.id}/appearance/apply`, 'POST', { requestId: randomUUID(), assetId: selected.id });
    const job = (await poll(f, token)).data.requests[0];
    assert.equal((await poll(f, token, { results: [{ id: job.id, playerUuid: job.playerUuid, sha256: job.sha256, state: 'applied', identifier: identifier(job), reason: 'SKIN_BOUND', message: '签名与原 UUID 已核对' }] })).status, 200);
  }
  const removed = await f.admin.request(`/agents/${f.agent.id}/appearance/assets/${first.id}`, 'DELETE'); assert.equal(removed.status, 200); assert.equal(removed.data.assets.length, 1); assert.equal(removed.data.jobs.length, 2);
  assert.equal((await f.admin.request(`/agents/${f.agent.id}/appearance/assets/${removed.data.assets[0].id}`, 'DELETE')).status, 409);
  assert.equal(f.portal.store.db.prepare('SELECT length(bytes) AS n FROM appearance_assets WHERE id=?').get(first.id).n, 0);
});
test('a signed skin receipt uses the uploaded arm variant and completes the original HTTP job', async t => {
  const token = 'app_' + newSecret(), f = await siteFixture(t, { appearance: { bridgeEnabled: true, tokenHash: digest(token) } }); await own(f);
  const uploaded = await (await upload(f)).json(); await f.admin.request(`/agents/${f.agent.id}/appearance/apply`, 'POST', { requestId: randomUUID(), assetId: uploaded.assets[0].id });
  const job = (await poll(f, token)).data.requests[0], result = { id: job.id, playerUuid: job.playerUuid, sha256: job.sha256, state: 'applied', identifier: identifier(job), reason: 'SKIN_BOUND', message: '签名皮肤与原 UUID 已核对' };
  assert.match(result.identifier, /_slim$/); assert.equal((await poll(f, token, { results: [result] })).status, 200);
  assert.equal((await f.admin.request(`/agents/${f.agent.id}/appearance`)).data.jobs[0].state, 'applied');
});

async function workerFixture(t) {
  const f = await siteFixture(t), root = path.join(f.root, 'worker'), server = path.join(root, 'server'), modelRoot = path.join(root, 'custom');
  for (const folder of [modelRoot, path.join(server, 'plugins/SkinsRestorer/skins'), path.join(server, 'plugins/SkinsRestorer/players')]) await fs.mkdir(folder, { recursive: true });
  const config = { endpoint: f.origin, journalDirectory: path.join(root, 'journal'), serverDir: server, modelRoot, appearanceStateFile: path.join(root, 'state.json'), ysmServicesConfig: path.join(root, 'ysm.json'), rconClientModule: path.join(root, 'rcon.mjs'), tokenFile: path.join(root, 'token') };
  const calls = [], controls = [], bytes = Buffer.from(f.uuid.replaceAll('-', ''), 'hex'), expected = Array.from({ length: 4 }, (_, i) => bytes.readInt32BE(i * 4));
  const worker = await new AppearanceWorker(config, { command: async text => { calls.push(text); return text.endsWith('UUID') ? 'UUID: [I; ' + expected.join(', ') + ']' : ''; }, control: async text => { controls.push(text); return { accepted: true }; } }).initialize();
  return { ...f, worker, config, calls, controls, expected };
}
test('worker waits for real UUID, sends skin generation only once, and confirms saved UUID binding before success', async t => {
  const f = await workerFixture(t), bytes = png(), job = { id: randomUUID(), playerUuid: f.uuid, username: f.agent.name, kind: 'skin', sha256: digest(bytes), variant: 'slim', texture: null, reconciliationOnly: false, base64: bytes.toString('base64') };
  assert.equal((await f.worker.process(job)).state, 'applying'); assert.equal((await f.worker.process(job)).state, 'applying');
  assert.equal(f.calls.filter(text => text.includes('createcustom')).length, 1);
  const name = identifier(job), skin = { skinName: name, value: Buffer.from(JSON.stringify({ textures: { SKIN: { url: 'https://textures.minecraft.net/texture/' + 'a'.repeat(64), metadata: { model: 'slim' } } } })).toString('base64'), signature: 'b'.repeat(100) };
  await fs.writeFile(path.join(f.config.serverDir, 'plugins/SkinsRestorer/skins', name + '.customskin'), JSON.stringify(skin));
  assert.equal((await f.worker.process(job)).state, 'applying'); assert.equal((await f.worker.process(job)).state, 'applying'); assert.equal(f.calls.filter(text => text.includes(':skin set')).length, 1);
  await fs.writeFile(path.join(f.config.serverDir, 'plugins/SkinsRestorer/players', f.uuid + '.player'), JSON.stringify({ uniqueId: f.uuid, skinIdentifier: { identifier: name, type: 'CUSTOM' } }));
  assert.equal((await f.worker.process(job)).state, 'applied');
  f.worker.command = async () => 'UUID: [I; 0, 0, 0, 1]'; const other = { ...job, id: randomUUID() }; assert.equal((await f.worker.process(other)).state, 'waiting_player');
});
test('worker never replays an uncertain dispatch after restart or with a missing local journal', async t => {
  const f = await workerFixture(t), bytes = png(), job = { id: randomUUID(), playerUuid: f.uuid, username: f.agent.name, kind: 'skin', sha256: digest(bytes), variant: 'slim', texture: null, base64: bytes.toString('base64') };
  f.worker.command = async text => { f.calls.push(text); if (!text.endsWith('UUID')) throw Error('response lost'); return 'UUID: [I; ' + f.expected.join(', ') + ']'; };
  assert.equal((await f.worker.process(job)).state, 'unknown'); await f.worker.process({ ...job, reconciliationOnly: true, base64: undefined }); assert.equal(f.calls.filter(text => text.includes('createcustom')).length, 1);
  const missing = await f.worker.process({ ...job, id: randomUUID(), reconciliationOnly: true, base64: undefined }); assert.equal(missing.state, 'unknown'); assert.equal(f.calls.filter(text => text.includes('createcustom')).length, 1);
});
test('YSM worker installs original ZIP atomically, dispatches once and needs fresh native plus Web confirmation', async t => {
  const f = await workerFixture(t), bytes = zip(modelFiles()), job = { id: randomUUID(), playerUuid: f.uuid, username: f.agent.name, kind: 'ysm', sha256: digest(bytes), variant: null, texture: 'default', base64: bytes.toString('base64') };
  assert.equal((await f.worker.process(job)).reason, 'YSM_CONVERTING'); assert.equal(f.controls.length, 0);
  assert.deepEqual(await fs.readFile(path.join(f.config.modelRoot, identifier(job), 'model.json')), Buffer.from(modelFiles()['model.json']));
  const journalPath = path.join(f.config.journalDirectory, job.id, 'journal.json'), journal = JSON.parse(await fs.readFile(journalPath)); journal.installedAt -= 50000; await fs.writeFile(journalPath, JSON.stringify(journal));
  await f.worker.process(job); await f.worker.process(job); assert.equal(f.controls.length, 1);
  const state = { writtenAt: Date.now(), players: [{ playerUuid: f.uuid, playerName: f.agent.name, modelId: identifier(job), texture: 'default', stateStatus: 'confirmed', available: true, webAvailable: true }] };
  await fs.writeFile(f.config.appearanceStateFile, JSON.stringify({ ...state, writtenAt: Date.now() - 20000 })); assert.notEqual((await f.worker.process(job)).state, 'applied');
  await fs.writeFile(f.config.appearanceStateFile, JSON.stringify(state)); assert.equal((await f.worker.process(job)).state, 'applied'); assert.equal(f.controls.length, 1);
});
test('worker reuses byte-identical public sources and does not add a duplicate native model', async t => {
  const f = await workerFixture(t), files = modelFiles(), existing = path.join(f.config.modelRoot, 'existing_cat'); await fs.mkdir(existing);
  for (const [name, value] of Object.entries(files)) await fs.writeFile(path.join(existing, name), value);
  const bytes = zip(files), metadata = ysmArchive(bytes), job = { id: randomUUID(), playerUuid: f.uuid, username: f.agent.name, kind: 'ysm', sha256: digest(bytes), sourceSha256: metadata.sourceSha256, variant: null, texture: 'default', base64: bytes.toString('base64') };
  assert.equal((await f.worker.process(job)).reason, 'YSM_EXISTING_SOURCE'); await f.worker.process(job); assert.equal(f.controls.length, 1); assert.match(f.controls[0], /existing_cat default$/);
  await fs.writeFile(f.config.appearanceStateFile, JSON.stringify({ writtenAt: Date.now(), players: [{ playerUuid: f.uuid, playerName: f.agent.name, modelId: 'existing_cat', texture: 'default', stateStatus: 'confirmed', available: true, webAvailable: true }] }));
  const result = await f.worker.process(job); assert.equal(result.state, 'applied'); assert.equal(result.reusedExisting, true); assert.equal(result.sourceSha256, metadata.sourceSha256);
  assert.equal((await fs.readdir(f.config.modelRoot)).length, 1);
});
