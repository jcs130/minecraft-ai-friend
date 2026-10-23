import { createHash } from 'node:crypto';
import { UUID, RESERVED } from './game-data.mjs';
import { prepareReviewedRoles } from './ownership-review.mjs';

const fail = message => Object.assign(new Error(message), { status: 400, reason: 'NUMEN_IDENTITY_INVALID' });
const ordinaryName = name => typeof name === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(name) && !RESERVED.has(name.toLowerCase()) && !/eye$/i.test(name);

// This is private server evidence received through the independently encrypted
// account bridge. A name, ag_ prefix, browser assertion or public snapshot never
// proves who created a Numen body and cannot grant website ownership.
export function validateNumenObservation(value, now = Date.now()) {
  if (value?.schemaVersion !== 1 || !Number.isFinite(value.observedAt) || Math.abs(now - value.observedAt) > 45000 || !Array.isArray(value.companions) || value.companions.length > 256) throw fail('Numen 归属资料过期或格式无效');
  const seen = new Set();
  return { observedAt: value.observedAt, companions: value.companions.map(row => {
    if (!UUID.test(row.playerUuid || '') || !UUID.test(row.ownerPlayerUuid || '') || row.playerUuid.toLowerCase() === row.ownerPlayerUuid.toLowerCase() || !ordinaryName(row.name) || !['Numen.CompanionRegistry', 'Numen.live-owner-tag'].includes(row.source) || seen.has(row.playerUuid.toLowerCase())) throw fail('Numen 角色或创建者身份无效');
    seen.add(row.playerUuid.toLowerCase());
    return { playerUuid: row.playerUuid.toLowerCase(), ownerPlayerUuid: row.ownerPlayerUuid.toLowerCase(), name: row.name, source: row.source };
  }) };
}

export class NumenOwnerships {
  constructor(store) {
    this.store = store;
    prepareReviewedRoles(store);
    store.db.exec(`CREATE TABLE IF NOT EXISTS numen_creator_relations(player_uuid TEXT PRIMARY KEY,name TEXT NOT NULL,creator_uuid TEXT NOT NULL,source TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS numen_observation(id INTEGER PRIMARY KEY CHECK(id=1),observed_at INTEGER NOT NULL,body_hash TEXT NOT NULL);`);
  }
  // Caller holds the same transaction as the account bridge receipt. Missing
  // creator website bindings stay pending; existing explicit owners are kept.
  ingest(value) {
    const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const previous = this.store.db.prepare('SELECT * FROM numen_observation WHERE id=1').get();
    if (previous && (value.observedAt < previous.observed_at || value.observedAt === previous.observed_at && hash !== previous.body_hash)) throw fail('Numen 归属资料顺序不一致');
    for (const row of value.companions) {
      const known = this.store.db.prepare('SELECT * FROM numen_creator_relations WHERE player_uuid=?').get(row.playerUuid);
      if (known && (known.creator_uuid !== row.ownerPlayerUuid || known.name.toLowerCase() !== row.name.toLowerCase())) {
        this.store.db.prepare("UPDATE numen_creator_relations SET state='identity_conflict' WHERE player_uuid=?").run(row.playerUuid); continue;
      }
      this.store.db.prepare("INSERT INTO numen_creator_relations VALUES(?,?,?,?,?,?,?) ON CONFLICT(player_uuid) DO UPDATE SET last_seen=excluded.last_seen,source=excluded.source").run(row.playerUuid, row.name, row.ownerPlayerUuid, row.source, value.observedAt, value.observedAt, 'pending_creator');
      const alias = this.store.db.prepare('SELECT player_uuid FROM portal_agents WHERE normalized=?').get(row.name.toLowerCase());
      // Reusing a display name does not replace a login identity. The native
      // body/creator UUID pair still proves this separate body's ownership.
      if (alias && alias.player_uuid !== row.playerUuid) continue;
      this.store.db.prepare('INSERT OR IGNORE INTO portal_agents VALUES(?,?,?,?)').run(row.playerUuid, row.name, row.name.toLowerCase(), row.source);
    }
    this.store.db.prepare('INSERT INTO numen_observation VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at,body_hash=excluded.body_hash').run(value.observedAt, hash);
    this.reconcile();
  }
  reconcile() {
    for (const row of this.store.db.prepare("SELECT * FROM numen_creator_relations WHERE state!='identity_conflict' LIMIT 256").all()) {
      const creator = this.store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(row.creator_uuid);
      const existing = this.store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(row.player_uuid);
      const state = !creator ? 'pending_creator' : existing && existing.owner_id !== creator.owner_id ? 'ownership_conflict' : 'bound';
      if (state === 'bound' && !existing) {
        this.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(creator.owner_id, row.player_uuid, 'Verified native Numen creator ' + row.creator_uuid + '; ' + row.source, Date.now());
        this.store.audit(creator.owner_id, 'ownership.numen.creator.bind', row.player_uuid);
      }
      if (state === 'bound') this.store.db.prepare('INSERT OR IGNORE INTO reviewed_role_identities VALUES(?,?,?,?,?,?)').run(row.player_uuid,row.name,'agent',row.source,'Verified native Numen creator '+row.creator_uuid,Date.now());
      this.store.db.prepare('UPDATE numen_creator_relations SET state=? WHERE player_uuid=?').run(state, row.player_uuid);
    }
  }
}
