import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, createHash, privateDecrypt, constants } from 'node:crypto';
import { issueMusicGrant } from '../scripts/issue-music-grant.mjs';
import { musicFixture, metadata } from './music-fixtures.mjs';
import { randomUUID } from 'node:crypto';
const SUBJECT = { uuid: '11111111-1111-3111-8111-111111111111', name: 'ag_MusicFixture' };
const approval = { source: 'server-owner-delegation', requestId: '22222222-2222-3222-8222-222222222222', subjectUuid: SUBJECT.uuid, scope: 'music.write' };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'isolated-music-grant-'));
  t.after(async () => { assert.ok(path.basename(root).startsWith('isolated-music-grant-')); await fs.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'portal.sqlite'), baseline = path.join(root, 'baseline.sqlite');
  const db = new DatabaseSync(file); db.exec(`CREATE TABLE owners(id TEXT PRIMARY KEY); INSERT INTO owners VALUES('original-owner'); CREATE TABLE ownerships(agent_uuid TEXT PRIMARY KEY,owner_id TEXT); CREATE TABLE credentials(id TEXT PRIMARY KEY,owner_id TEXT,agent_uuid TEXT,label TEXT,token_hash TEXT,scopes TEXT,created_at INTEGER,expires_at INTEGER,revoked_at INTEGER); CREATE TABLE audit_events(id TEXT PRIMARY KEY,owner_id TEXT,action TEXT,target TEXT,result TEXT,created_at INTEGER);`);
  db.prepare('INSERT INTO ownerships VALUES(?,?)').run(SUBJECT.uuid, 'original-owner'); db.prepare('INSERT INTO credentials VALUES(?,?,?,?,?,?,?,?,NULL)').run('old-read-token', 'original-owner', SUBJECT.uuid, 'untouched', 'old-hash', '["state.read"]', 1, Date.now() + 86400000); db.close(); await fs.copyFile(file, baseline);
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }), expectedFingerprint = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  return { root, file, baseline, keys, options: { database: file, baselineDatabase: baseline, publicKeyPem, expectedFingerprint, stateDirectory: path.join(root, 'grant'), approval, subject: SUBJECT } };
}
test('operator grant is scoped to original owner and role, encrypted only to recipient, and idempotent', async t => {
  const f = await fixture(t); let received;
  const result = await issueMusicGrant({ ...f.options, probe: async token => { assert.match(token, /^pat_[A-Za-z0-9_-]{43}$/); received = token; } });
  assert.deepEqual(result.completion.scopes, ['music.write']); assert.equal(result.completion.apiVerified, true); assert.ok(!JSON.stringify(result).includes(received));
  const plaintext = privateDecrypt({ key: f.keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(result.envelope.ciphertext, 'base64'));
  const decoded = JSON.parse(plaintext); assert.equal(decoded.token, received); assert.equal(decoded.roleUuid, SUBJECT.uuid); plaintext.fill(0);
  const repeated = await issueMusicGrant(f.options); assert.equal(repeated.envelope.ciphertext, result.envelope.ciphertext); assert.equal(repeated.completion.apiVerified, true);
  const db = new DatabaseSync(f.file); try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 2); assert.equal(db.prepare('SELECT scopes FROM credentials WHERE id=?').get('old-read-token').scopes, '["state.read"]'); assert.equal(db.prepare('SELECT owner_id FROM audit_events').get().owner_id, null); } finally { db.close(); }
  const prepared = await fs.readFile(path.join(f.root, 'grant/grant.prepared.private.json'), 'utf8'); assert.ok(!prepared.includes(received));
});
test('a missing authorization, wrong recipient fingerprint or ownership transfer cannot issue a grant', async t => {
  const f = await fixture(t);
  await assert.rejects(issueMusicGrant({ ...f.options, approval: null }), { reason: 'EXPLICIT_DELEGATION_REQUIRED' });
  await assert.rejects(issueMusicGrant({ ...f.options, expectedFingerprint: '0'.repeat(64) }), { reason: 'RECIPIENT_FINGERPRINT_MISMATCH' });
  const db = new DatabaseSync(f.file); db.exec("INSERT INTO owners VALUES('another-owner'); UPDATE ownerships SET owner_id='another-owner'"); db.close();
  await assert.rejects(issueMusicGrant(f.options), { reason: 'ROLE_OWNERSHIP_CHANGED' });
  const actual = new DatabaseSync(f.file); try { assert.equal(actual.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 1); } finally { actual.close(); }
});

test('a private key, weak key or wider scope is refused without issuing credentials', async t => {
  const f = await fixture(t);
  await assert.rejects(issueMusicGrant({ ...f.options, publicKeyPem: f.keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { reason: 'RECIPIENT_PUBLIC_KEY_ONLY' });
  const weak = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await assert.rejects(issueMusicGrant({ ...f.options, publicKeyPem: weak.publicKey.export({ type: 'spki', format: 'pem' }) }), { reason: 'RECIPIENT_RSA_3072_REQUIRED' });
  await assert.rejects(issueMusicGrant({ ...f.options, approval: { ...approval, scope: '*' } }), { reason: 'EXPLICIT_DELEGATION_REQUIRED' });
  const db = new DatabaseSync(f.file); try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 1); } finally { db.close(); }
});

test('a long multibyte display name gives an actionable encryption error before any grant is written', async t => {
  const f = await fixture(t), subject = { ...SUBJECT, name: '音'.repeat(32) };
  await assert.rejects(issueMusicGrant({ ...f.options, subject }), { reason: 'RECIPIENT_KEY_TOO_SMALL_FOR_SUBJECT' });
  const db = new DatabaseSync(f.file); try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 1); } finally { db.close(); }
  const larger = generateKeyPairSync('rsa', { modulusLength: 4096 });
  const result = await issueMusicGrant({ ...f.options, subject, publicKeyPem: larger.publicKey.export({ type: 'spki', format: 'pem' }), expectedFingerprint: createHash('sha256').update(larger.publicKey.export({ type: 'spki', format: 'der' })).digest('hex') });
  assert.equal(result.completion.issued, true);
  assert.equal(JSON.parse(privateDecrypt({ key: larger.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(result.envelope.ciphertext, 'base64'))).username, subject.name);
});

test('revocation, a different operation or recipient, and expiry cannot silently create replacement grants', async t => {
  const f = await fixture(t), first = await issueMusicGrant(f.options);
  await assert.rejects(issueMusicGrant({ ...f.options, approval: { ...approval, requestId: randomUUID() } }), { reason: 'ISSUANCE_STATE_CONFLICT' });
  const other = generateKeyPairSync('rsa', { modulusLength: 3072 }), fingerprint = createHash('sha256').update(other.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  await assert.rejects(issueMusicGrant({ ...f.options, publicKeyPem: other.publicKey.export({ type: 'spki', format: 'pem' }), expectedFingerprint: fingerprint }), { reason: 'ISSUANCE_STATE_CONFLICT' });
  await assert.rejects(issueMusicGrant({ ...f.options, now: Date.now() + 31 * 86400000 }), { reason: 'GRANT_EXPIRED' });
  const db = new DatabaseSync(f.file); db.prepare('UPDATE credentials SET revoked_at=? WHERE id=?').run(Date.now(), first.completion.credentialId); db.close();
  await assert.rejects(issueMusicGrant(f.options), { reason: 'EXISTING_GRANT_CHANGED_OR_EXPIRED' });
  const reopened = new DatabaseSync(f.file); try { assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 2); } finally { reopened.close(); }
});

test('real HTTP authentication accepts only this role music permission and preserves read-only tokens', async t => {
  const f = await musicFixture(t), baseline = path.join(f.root, 'operator-baseline.sqlite');
  f.portal.store.db.prepare('VACUUM INTO ?').run(baseline);
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072 }), expectedFingerprint = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  let token;
  const result = await issueMusicGrant({ database: path.join(f.config.dataDir, 'portal.sqlite'), baselineDatabase: baseline, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }), expectedFingerprint,
    stateDirectory: path.join(f.root, 'operator-grant'), subject: { uuid: f.uuid, name: f.agent.name }, approval: { ...approval, requestId: randomUUID(), subjectUuid: f.uuid, privateOperatorNote: 'not for transport' },
    probe: async value => { token = value; assert.equal((await f.api('', 'GET', undefined, value)).status, 200); } });
  assert.equal(result.completion.apiVerified, true); assert.ok(!JSON.stringify(result).includes('not for transport'));
  const added = await f.api('', 'POST', { ...metadata, requestId: randomUUID(), author: 'someone else' }, token);
  assert.equal(added.status, 201); assert.equal(added.data.author, f.agent.name); assert.equal(added.data.published, false);
  for (const route of ['/api/v1/agents/' + f.agent.id + '/state', '/api/v1/agent-access/photos', '/api/v1/client-credentials']) {
    const response = await fetch(f.origin + route, { headers: { Authorization: 'Bearer ' + token } }); assert.equal(response.status, 403, route); await response.body?.cancel();
  }
  const row = f.portal.store.db.prepare('SELECT scopes FROM credentials WHERE id=?').get(result.completion.credentialId); assert.deepEqual(JSON.parse(row.scopes), ['music.write']);
  f.portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(f.uuid);
  assert.equal((await f.api('', 'GET', undefined, token)).status, 403);
});
