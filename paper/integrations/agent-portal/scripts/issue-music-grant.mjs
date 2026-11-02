import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash, createPublicKey, publicEncrypt, constants } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const reject = reason => { throw Object.assign(Error(reason), { reason }); };

// One operator-authorized grant to an already-owned role. This is not a
// new public endpoint, a login/session impersonation, or a role/account import.
// The user's delegation is recorded separately from the website owner's audit.
export async function issueMusicGrant({ database, baselineDatabase, publicKeyPem, expectedFingerprint, stateDirectory, approval, subject, now = Date.now(), probe }) {
  if (!UUID.test(subject?.uuid ?? '') || typeof subject?.name !== 'string' || !subject.name.trim() || subject.name.length > 32 || /[\x00-\x1f]/.test(subject.name)) reject('EXPLICIT_SUBJECT_REQUIRED');
  if (approval?.source !== 'server-owner-delegation' || !UUID.test(approval?.requestId ?? '') || approval?.subjectUuid !== subject.uuid || approval?.scope !== 'music.write') reject('EXPLICIT_DELEGATION_REQUIRED');
  if (!(await fs.stat(database)).isFile() || !(await fs.stat(baselineDatabase)).isFile()) reject('EXISTING_DATABASE_REQUIRED');
  if (typeof publicKeyPem !== 'string' || !publicKeyPem.trim().startsWith('-----BEGIN PUBLIC KEY-----') || !publicKeyPem.trim().endsWith('-----END PUBLIC KEY-----')) reject('RECIPIENT_PUBLIC_KEY_ONLY');
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength < 3072 || publicKey.asymmetricKeyDetails.modulusLength > 8192) reject('RECIPIENT_RSA_3072_REQUIRED');
  const fingerprint = hash(publicKey.export({ format: 'der', type: 'spki' }));
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint ?? '') || expectedFingerprint !== fingerprint) reject('RECIPIENT_FINGERPRINT_MISMATCH');
  const baseline = new DatabaseSync(baselineDatabase, { readOnly: true });
  let ownerId;
  try { ownerId = baseline.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(subject.uuid)?.owner_id; }
  finally { baseline.close(); }
  if (!ownerId) reject('ORIGINAL_ROLE_OWNERSHIP_MISSING');
  await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const preparedFile = path.join(stateDirectory, 'grant.prepared.private.json'), completedFile = path.join(stateDirectory, 'grant.completed.private.json');
  let prepared, token;
  try { prepared = JSON.parse(await fs.readFile(preparedFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prepared) {
    if (prepared.operationId !== approval.requestId || prepared.recipientFingerprint !== fingerprint || prepared.ownerId !== ownerId || prepared.subject !== subject.uuid || !Array.isArray(prepared.scopes) || prepared.scopes.join(',') !== 'music.write') reject('ISSUANCE_STATE_CONFLICT');
    if (prepared.expiresAt <= now) reject('GRANT_EXPIRED');
  } else {
    token = 'pat_' + randomBytes(32).toString('base64url');
    const id = randomUUID(), expiresAt = now + 30 * 86400000;
    const plaintext = Buffer.from(JSON.stringify({ token, credentialId: id, username: subject.name, roleUuid: subject.uuid, scopes: ['music.write'], expiresAt: new Date(expiresAt).toISOString() }));
    let ciphertext;
    try { ciphertext = publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, plaintext).toString('base64'); }
    catch (error) { if (error.code === 'ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_KEY_SIZE') reject('RECIPIENT_KEY_TOO_SMALL_FOR_SUBJECT'); throw error; }
    finally { plaintext.fill(0); }
    prepared = { operationId: approval.requestId, credentialId: id, subject: subject.uuid, ownerId, scopes: ['music.write'], tokenHash: hash(token), createdAt: now, expiresAt, auditId: randomUUID(), recipientFingerprint: fingerprint,
      envelope: { version: 1, algorithm: 'RSA-OAEP-SHA256', operationId: approval.requestId, credentialId: id, username: subject.name, recipientFingerprint: fingerprint, ciphertext } };
    const file = await fs.open(preparedFile, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(prepared)); await file.sync(); } finally { await file.close(); }
  }
  const db = new DatabaseSync(database);
  let inTransaction = false;
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    inTransaction = true;
    const owner = db.prepare('SELECT o.owner_id FROM ownerships o JOIN owners p ON p.id=o.owner_id WHERE o.agent_uuid=?').get(subject.uuid);
    if (owner?.owner_id !== ownerId) reject('ROLE_OWNERSHIP_CHANGED');
    const old = db.prepare('SELECT * FROM credentials WHERE id=?').get(prepared.credentialId);
    const existing = () => hash(JSON.stringify(db.prepare('SELECT * FROM credentials WHERE id<>? ORDER BY id').all(prepared.credentialId)));
    const before = existing();
    if (old) {
      if (old.owner_id !== ownerId || old.agent_uuid !== subject.uuid || old.token_hash !== prepared.tokenHash || old.scopes !== '["music.write"]' || old.revoked_at !== null || old.expires_at <= now) reject('EXISTING_GRANT_CHANGED_OR_EXPIRED');
    } else {
      db.prepare('INSERT INTO credentials VALUES(?,?,?,?,?,?,?,?,NULL)').run(prepared.credentialId, ownerId, subject.uuid, '歌曲发布（服主代办，' + subject.name + '）', prepared.tokenHash, '["music.write"]', prepared.createdAt, prepared.expiresAt);
      db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run(prepared.auditId, null, 'music.credential.operator_issue', prepared.credentialId, JSON.stringify({ authorization: 'server-owner-delegation', operationId: approval.requestId, boundOriginalOwner: true, subject: subject.uuid, scopes: ['music.write'], recipientFingerprint: fingerprint }), now);
    }
    if (existing() !== before) reject('UNRELATED_CREDENTIAL_CHANGED');
    db.exec('COMMIT');
    inTransaction = false;
  } catch (error) { if (inTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
  let verified = false;
  if (token && probe) { await probe(token); verified = true; }
  else {
    try { verified = JSON.parse(await fs.readFile(completedFile, 'utf8')).apiVerified === true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  token = undefined;
  const completion = { issued: true, operationId: approval.requestId, credentialId: prepared.credentialId, username: subject.name, scopes: ['music.write'], recipientFingerprint: fingerprint,
    expiresAt: new Date(prepared.expiresAt).toISOString(), apiVerified: verified, oldCredentialsUnchanged: true, accountOrOwnershipChanged: false, gameRestarted: false, websiteRestarted: false,
    authorization: { source: approval.source, requestId: approval.requestId, subjectUuid: approval.subjectUuid, scope: approval.scope } };
  await fs.writeFile(completedFile, JSON.stringify(completion, null, 2), { mode: 0o600 });
  // Only client-key-encrypted ciphertext is eligible for cross-session output.
  return { completion, envelope: prepared.envelope };
}

// Local maintenance only. Never imported by the HTTP server, MCP or game CLI.
// Secrets and private paths belong in a restricted request file, not arguments.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 5 || process.argv[2] !== '--execute' || process.argv[3] !== '--request-file') {
    console.error('仅供维护者：node issue-music-grant.mjs --execute --request-file /私有目录/签发请求.json');
    process.exitCode = 1;
  } else try {
    const request = JSON.parse(await fs.readFile(process.argv[4], 'utf8'));
    const options = { database: request.databaseFile, baselineDatabase: request.baselineDatabaseFile, publicKeyPem: await fs.readFile(request.recipientPublicKeyFile, 'utf8'),
      expectedFingerprint: request.recipientFingerprint, stateDirectory: request.stateDirectory, approval: request.approval, subject: request.subject };
    console.log(JSON.stringify(await issueMusicGrant(options)));
  } catch (error) {
    console.error(JSON.stringify({ completed: false, reason: error.reason ?? error.code ?? error.name, nextAction: '检查原归属、服主委托、公钥及同一请求的私有回执；只重试同一请求文件，勿新建角色、扩权旧令牌或输出明文凭据。' }));
    process.exitCode = 1;
  }
}
