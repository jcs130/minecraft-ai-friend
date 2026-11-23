import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const owner = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const sha256 = /^[0-9a-f]{64}$/;
const signatureFormat = /^[a-zA-Z0-9_-]{86}$/;
const purpose = 'qiandengji:character-history-catalog:v1\n';

function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError('Invalid character history fields');
  }
}

function identityProof(value, expectedState) {
  fields(value, ['uuid', 'ownerId', 'identitySha256', 'state']);
  if (typeof value.uuid !== 'string' || !uuid.test(value.uuid) ||
      typeof value.ownerId !== 'string' || !owner.test(value.ownerId) ||
      typeof value.identitySha256 !== 'string' || !sha256.test(value.identitySha256) ||
      value.state !== expectedState) throw new TypeError('Missing exact character ownership proof');
  return { uuid: value.uuid, ownerId: value.ownerId, identitySha256: value.identitySha256, state: value.state };
}

function normalizePlan(plan) {
  fields(plan, ['schemaVersion', 'realmId', 'notBefore', 'expiresAt', 'roles']);
  if (plan.schemaVersion !== 1 || typeof plan.realmId !== 'string' || !owner.test(plan.realmId) ||
      !Number.isSafeInteger(plan.notBefore) || plan.notBefore < 1 ||
      !Number.isSafeInteger(plan.expiresAt) || plan.expiresAt <= plan.notBefore ||
      !Array.isArray(plan.roles) || !plan.roles.length) throw new TypeError('Invalid character history plan');
  const used = new Set();
  const roles = plan.roles.map(row => {
    fields(row, ['authoritative', 'history']);
    if (!Array.isArray(row.history) || !row.history.length) throw new TypeError('Missing archived identity');
    const authoritative = identityProof(row.authoritative, 'active');
    const history = row.history.map(proof => identityProof(proof, 'archived'))
      .sort((left, right) => left.uuid.localeCompare(right.uuid));
    for (const proof of [authoritative, ...history]) {
      if (proof.ownerId !== authoritative.ownerId) throw new TypeError('Character ownership conflict');
      if (used.has(proof.uuid)) throw new TypeError('Ambiguous character history');
      used.add(proof.uuid);
    }
    return { authoritative, history };
  }).sort((left, right) => left.authoritative.uuid.localeCompare(right.authoritative.uuid));
  return { schemaVersion: 1, realmId: plan.realmId, notBefore: plan.notBefore, expiresAt: plan.expiresAt, roles };
}

const message = plan => Buffer.from(purpose + JSON.stringify(plan));
const matches = (old, current) => old.uuid === current?.uuid && old.ownerId === current.ownerId &&
  old.identitySha256 === current.identitySha256 && old.state === current.state;
const inWindow = (plan, time) => time >= plan.notBefore && time < plan.expiresAt;

function requireKey(value, type) {
  const key = value?.type === type ? value : type === 'private' ? createPrivateKey(value) : createPublicKey(value);
  if (key.type !== type || key.asymmetricKeyType !== 'ed25519') throw new TypeError('Expected Ed25519 signing key');
  return key;
}

/** An operator chooses the authoritative role. Identity facts must have been
 * verified independently against the current account and role registries. */
export function signCharacterHistory(plan, proofs, privateKey) {
  const normalized = normalizePlan(plan);
  if (!Array.isArray(proofs)) throw new TypeError('Missing current identity proofs');
  const evidence = new Map();
  for (const row of proofs) {
    if (!['active', 'archived'].includes(row?.state)) throw new TypeError('Unsupported character identity state');
    const proof = identityProof(row, row.state);
    if (evidence.has(proof.uuid)) throw new TypeError('Ambiguous identity evidence');
    evidence.set(proof.uuid, proof);
  }
  for (const { authoritative, history } of normalized.roles) {
    if (![authoritative, ...history].every(proof => matches(proof, evidence.get(proof.uuid)))) {
      throw new TypeError('Character ownership or identity record changed');
    }
  }
  const signature = sign(null, message(normalized), requireKey(privateKey, 'private')).toString('base64url');
  return { plan: normalized, signature };
}

export function verifyCharacterHistory(envelope, publicKey) {
  fields(envelope, ['plan', 'signature']);
  const plan = normalizePlan(envelope.plan);
  if (typeof envelope.signature !== 'string' || !signatureFormat.test(envelope.signature) ||
      !verify(null, message(plan), requireKey(publicKey, 'public'), Buffer.from(envelope.signature, 'base64url'))) {
    throw new TypeError('Character history approval is invalid');
  }
  return plan;
}

/** A read-only catalogue resolver. Its proof reader must consult the current
 * trusted identity store, never a name lookup or a body supplied by the caller. */
export function characterHistoryCatalog({ envelope, publicKey, realmId, readProofs, now = Date.now }) {
  const plan = verifyCharacterHistory(envelope, publicKey);
  if (plan.realmId !== realmId || typeof readProofs !== 'function') throw new TypeError('Character history realm mismatch');
  const aliases = new Map();
  for (const { authoritative, history } of plan.roles) {
    for (const previous of history) aliases.set(previous.uuid, { authoritative, previous });
  }
  return Object.freeze({
    async resolveCatalog(uuid, ownerId) {
      const link = aliases.get(uuid);
      if (!link || ownerId !== link.authoritative.ownerId || !inWindow(plan, now())) return null;
      const ids = [link.authoritative.uuid, link.previous.uuid];
      const current = await readProofs(ownerId, ids);
      if (!Array.isArray(current) || current.length !== 2 || !inWindow(plan, now())) return null;
      if (![link.authoritative, link.previous].every(proof => current.some(row => matches(proof, row)))) return null;
      return link.authoritative.uuid;
    },
  });
}
