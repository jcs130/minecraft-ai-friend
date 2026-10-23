import { UUID, reservedIdentityName, websiteIdentity } from './game-data.mjs';

// This is an operator-only, offline repair facility. It is never an HTTP route,
// never infers ownership from a display name and never changes game passwords.
export function prepareReviewedRoles(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS reviewed_role_identities(
    player_uuid TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,
    source TEXT NOT NULL,proof TEXT NOT NULL,reviewed_at INTEGER NOT NULL);`);
}
export function reviewOwnerships(store, { ownerId, ownerName, roles, proof }, apply = false) {
  prepareReviewedRoles(store);
  const owner = store.ownerById(ownerId);
  if (!owner || owner.username.toLowerCase() !== String(ownerName).toLowerCase()) throw Error('REVIEW_OWNER_MISMATCH');
  if (!Array.isArray(roles) || !roles.length || roles.length > 32 || typeof proof !== 'string' || proof.length < 20 || proof.length > 1000) throw Error('REVIEW_INVALID');
  const seen = new Set();
  const checked = roles.map(input => {
    if (!UUID.test(input.playerUuid || '')) throw Error('REVIEW_IDENTITY_INVALID');
    const row={...input,playerUuid:input.playerUuid.toLowerCase()};
    if (!/^\.?[A-Za-z0-9_]{1,16}$/.test(row.name || '') || reservedIdentityName(row.name) || !['player','agent'].includes(row.kind) || seen.has(row.playerUuid)) throw Error('REVIEW_IDENTITY_INVALID');
    seen.add(row.playerUuid);
    if (store.db.prepare('SELECT 1 FROM archived_test_roles WHERE player_uuid=? OR lower(name)=?').get(row.playerUuid,row.name.toLowerCase())) throw Error('REVIEW_ARCHIVED_ROLE');
    const original = store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(row.playerUuid);
    if (original && original.owner_id !== ownerId) throw Error('REVIEW_OWNERSHIP_CONFLICT');
    const identity = store.db.prepare('SELECT name,kind FROM reviewed_role_identities WHERE player_uuid=?').get(row.playerUuid);
    if (identity && (identity.name.toLowerCase() !== row.name.toLowerCase() || identity.kind !== row.kind)) throw Error('REVIEW_IDENTITY_CONFLICT');
    return { ...row, alreadyOwned: !!original };
  });
  if (!apply) return checked;
  store.db.exec('BEGIN IMMEDIATE');
  try {
    // Recheck while holding the write lock: a concurrent valid claim must not
    // be overwritten between preview and commit.
    for (const row of checked) {
      const existing = store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(row.playerUuid);
      if (existing && existing.owner_id !== ownerId) throw Error('REVIEW_OWNERSHIP_CONFLICT');
      store.db.prepare('INSERT OR IGNORE INTO reviewed_role_identities VALUES(?,?,?,?,?,?)').run(row.playerUuid,row.name,row.kind,'Operator.reviewed-original-uuid',proof,Date.now());
      if (!existing) {
        store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(ownerId,row.playerUuid,proof,Date.now());
        store.audit(ownerId,'ownership.operator.review',row.playerUuid);
      }
    }
    store.db.exec('COMMIT');
  } catch(error) { store.db.exec('ROLLBACK'); throw error; }
  return checked;
}

// A verified historical body has its own UUID even when a later Numen body
// reused the same name. It can be read by its owner, but never becomes a new
// login alias or a target for name-only password/appearance operations.
export function mergeReviewedRoles(store, input, idFor) {
  const roster = input.map(websiteIdentity);
  for (const role of store.db.prepare('SELECT * FROM reviewed_role_identities ORDER BY reviewed_at,player_uuid LIMIT 256').all()) {
    if (reservedIdentityName(role.name) || store.db.prepare('SELECT 1 FROM archived_test_roles WHERE player_uuid=? OR lower(name)=?').get(role.player_uuid,role.name.toLowerCase())) continue;
    const exact = roster.find(row => row.playerUuid === role.player_uuid);
    if (exact) {
      if (exact.name.toLowerCase() !== role.name.toLowerCase()) { exact.identityConflict=true; exact.historical=true; }
      else exact.kind=role.kind;
      continue;
    }
    const alias = roster.find(row => row.name.toLowerCase() === role.name.toLowerCase());
    roster.push({ id:idFor(role.player_uuid,role.name),name:role.name,playerUuid:role.player_uuid,kind:role.kind,
      available:true,online:false,authenticated:false,isReserved:false,identityConflict:!!alias,
      historical:true,identitySource:role.source });
  }
  return roster;
}
