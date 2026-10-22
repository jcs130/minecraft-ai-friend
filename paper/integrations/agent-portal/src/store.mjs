import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const derive = promisify(scrypt);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const parts = (encoded || '').split('$');
  const salt = parts[2] || '00000000000000000000000000000000';
  const expected = /^[a-f0-9]{128}$/.test(parts[3] || '') ? Buffer.from(parts[3], 'hex') : Buffer.alloc(64);
  const actual = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return parts[0] === 'scrypt' && timingSafeEqual(expected, actual);
}

export class Store {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dataDir, 'portal.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY, username TEXT NOT NULL, normalized TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin')), created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY, owner_id TEXT REFERENCES owners(id) ON DELETE CASCADE, csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, verified_at INTEGER NOT NULL, device TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ownerships(owner_id TEXT NOT NULL REFERENCES owners(id), agent_uuid TEXT NOT NULL UNIQUE, proof TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id,agent_uuid));
      CREATE TABLE IF NOT EXISTS archived_test_roles(player_uuid TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL,proof TEXT NOT NULL,original_created_at INTEGER NOT NULL,archived_at INTEGER NOT NULL,reason TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), agent_uuid TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), agent_uuid TEXT NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY, owner_id TEXT, action TEXT NOT NULL, target TEXT, result TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS public_events(id TEXT PRIMARY KEY, kind TEXT NOT NULL, player_name TEXT, title TEXT NOT NULL, body TEXT NOT NULL, occurred_at INTEGER NOT NULL, precision TEXT NOT NULL, source TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS public_events_time ON public_events(occurred_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS live_channels(id TEXT PRIMARY KEY, title TEXT NOT NULL, player_name TEXT NOT NULL, player_uuid TEXT, visibility TEXT NOT NULL CHECK(visibility IN ('public','owner','members')), publisher_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      PRAGMA user_version=3;`);
    const channelColumns = this.db.prepare('PRAGMA table_info(live_channels)').all();
    if (!channelColumns.some(column => column.name === 'player_uuid')) {
      this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE live_channels RENAME TO legacy_live_channels;
        CREATE TABLE live_channels(id TEXT PRIMARY KEY,title TEXT NOT NULL,player_name TEXT NOT NULL,player_uuid TEXT,visibility TEXT NOT NULL CHECK(visibility IN ('public','owner','members')),publisher_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
        INSERT INTO live_channels SELECT id,title,player_name,NULL,CASE WHEN visibility='members' THEN 'owner' ELSE visibility END,publisher_hash,created_at FROM legacy_live_channels;
        DROP TABLE legacy_live_channels; COMMIT;`);
    }
    let row = this.db.prepare('SELECT value FROM settings WHERE key=?').get('publicIdSalt');
    if (!row) {
      const value = newSecret();
      this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('publicIdSalt', value);
      row = { value };
    }
    this.salt = row.value;
    this.cleanup();
  }
  close() { this.db.close(); }
  cleanup() { this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }
  countOwners() { return this.db.prepare('SELECT count(*) AS count FROM owners').get().count; }
  ownerByName(username) { return this.db.prepare('SELECT * FROM owners WHERE normalized=?').get(username.toLowerCase()); }
  ownerById(id) { return typeof id === 'string' ? this.db.prepare('SELECT * FROM owners WHERE id=?').get(id) : null; }
  ownerPublic(row) { return row ? { id: row.id, username: row.username, role: row.role, createdAt: new Date(row.created_at).toISOString() } : null; }
  createOwner(username, passwordHash, role = 'owner', setup = false) {
    const owner = { id: randomUUID(), username, normalized: username.toLowerCase(), password_hash: passwordHash, role, created_at: Date.now() };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (setup && this.countOwners() > 0) throw new Error('SETUP_COMPLETE');
      this.db.prepare('INSERT INTO owners VALUES(?,?,?,?,?,?)').run(...Object.values(owner));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return owner;
  }
  createSession(ownerId, device = '浏览器') {
    const token = newSecret(); const now = Date.now();
    const session = { id_hash: digest(token), owner_id: ownerId || null, csrf: newSecret(), created_at: now, expires_at: now + (ownerId ? 7 * 86400000 : 3600000), verified_at: ownerId ? now : 0, device: device.slice(0, 80) };
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)').run(...Object.values(session));
    return { token, session };
  }
  getSession(token) { return token ? this.db.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires_at>?').get(digest(token), Date.now()) : null; }
  deleteSession(hash) { this.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(hash); }
  revokeOtherSessions(ownerId, hash) { this.db.prepare('DELETE FROM sessions WHERE owner_id=? AND id_hash<>?').run(ownerId, hash); }
  ownedUuids(ownerId) { return this.db.prepare('SELECT agent_uuid FROM ownerships WHERE owner_id=?').all(ownerId).map(row => row.agent_uuid); }
  // Count identities once across worlds, including reserved registrations and
  // durable in-flight creations. Older standalone schemas remain readable.
  characterUuids(ownerId) {
    const ids=new Set(this.ownedUuids(ownerId)), tables=new Set(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    for(const [table,column,condition] of [
      ['agent_clients','expected_uuid','revoked_at IS NULL'],
      ['account_jobs','expected_uuid',"operation='create' AND state IN ('pending','unknown')"],
      ['network_memberships','player_uuid','1=1'],
      ['network_flows','player_uuid',"state IN ('pending','unknown')"]
    ])if(tables.has(table))for(const row of this.db.prepare(`SELECT ${column} AS uuid FROM ${table} WHERE owner_id=? AND ${condition}`).all(ownerId))ids.add(row.uuid);
    return ids;
  }

  audit(ownerId, action, target = null, result = 'succeeded') {
    this.db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run(randomUUID(), ownerId || null, action, target, result, Date.now());
  }
  events(owner) {
    const rows = owner.role === 'admin' ? this.db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 40').all()
      : this.db.prepare('SELECT * FROM audit_events WHERE owner_id=? ORDER BY created_at DESC LIMIT 40').all(owner.id);
    return rows.map(row => ({ id: row.id, action: row.action, target: row.target, result: row.result, observedAt: new Date(row.created_at).toISOString() }));
  }
}
