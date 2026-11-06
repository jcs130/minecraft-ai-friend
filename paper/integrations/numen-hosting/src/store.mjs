import { DatabaseSync } from 'node:sqlite';
import { identity, keyOf, fail } from './protocol.mjs';

export class HostingStore {
  constructor(path) {
    // A separate SQLite write lock is held for the process lifetime. SQLite
    // releases it on crash; no stale-PID deletion race or startup replay occurs.
    this.owner = new DatabaseSync(path === ':memory:' ? ':memory:' : path+'.owner.sqlite');
    try {
      this.owner.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner(id INTEGER);');
    } catch {
      this.owner.close();throw fail('SERVICE_ALREADY_RUNNING','该托管资料目录已由另一个服务进程占用。');
    }
    try {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY, server TEXT NOT NULL, uuid TEXT NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE, binding TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'paused', state TEXT NOT NULL DEFAULT 'detached', problem TEXT,
        UNIQUE(server,uuid), UNIQUE(server,name));
      CREATE TABLE IF NOT EXISTS requests(role TEXT NOT NULL, id TEXT NOT NULL, signature TEXT NOT NULL,
        epoch INTEGER NOT NULL, state TEXT NOT NULL, receipt TEXT, PRIMARY KEY(role,id));
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);
    // Never replay accepted actions or resume a manual controller after restart.
    this.db.exec(`UPDATE requests SET state='unknown' WHERE state='pending';
      UPDATE roles SET epoch=epoch+1,mode='paused',state='recovery_required',problem='SERVICE_RESTART'
      WHERE state!='detached';`);
    } catch(error){this.db?.close();this.owner.close();throw error;}
  }
  bind(value) {
    const role = identity(value), id = keyOf(role), json = JSON.stringify(role);
    const existing = this.get(id);
    if (existing && existing.binding !== json)
      throw fail('IDENTITY_CONFLICT', '角色 UUID 已有不同归属；请核对官网绑定，不会复制或改名创建身体。');
    try { this.db.prepare('INSERT OR IGNORE INTO roles(id,server,uuid,name,binding) VALUES(?,?,?,?,?)').run(id,role.serverId,role.roleUuid,role.name,json); }
    catch { throw fail('IDENTITY_CONFLICT','同服已有同名角色，必须先核对原 UUID。'); }
    const stored = this.get(id);
    if (!stored) throw fail('IDENTITY_CONFLICT','同名角色已经登记为另一 UUID，不能生成第二个身体。');
    return stored;
  }
  get(id) { return this.db.prepare('SELECT * FROM roles WHERE id=?').get(id); }
  rows() { return this.db.prepare('SELECT * FROM roles ORDER BY id').all(); }
  transition(id, mode, state, problem = null) {
    this.db.prepare('UPDATE roles SET epoch=epoch+1,mode=?,state=?,problem=? WHERE id=?').run(mode,state,problem,id);
    return this.get(id);
  }
  state(id, epoch, state, problem = null) {
    this.db.prepare('UPDATE roles SET state=?,problem=? WHERE id=? AND epoch=?').run(state,problem,id,epoch);
    return this.get(id);
  }
  claimGrant(jti, exp, now) {
    this.db.prepare('DELETE FROM grants WHERE expires<?').run(now);
    try { this.db.prepare('INSERT INTO grants VALUES(?,?)').run(jti,exp); }
    catch { throw fail('GRANT_USED','授权已使用，请重新从官网选择角色。',401); }
  }
  request(role, id) { return this.db.prepare('SELECT * FROM requests WHERE role=? AND id=?').get(role,id); }
  reserve(role,id,signature,epoch) {
    this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,NULL)').run(role,id,signature,epoch,'pending');
  }
  finish(role,id,state,receipt) {
    this.db.prepare('UPDATE requests SET state=?,receipt=? WHERE role=? AND id=?').run(state,JSON.stringify(receipt),role,id);
  }
  unknown(role) { return this.db.prepare("SELECT id FROM requests WHERE role=? AND state IN ('unknown','pending') LIMIT 1").get(role); }
  close() { this.db.close(); this.owner.close(); }
}
