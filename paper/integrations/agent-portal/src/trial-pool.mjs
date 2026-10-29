import { createHmac, randomUUID } from 'node:crypto';
import { digest } from './store.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// The pool is custody for new trial bodies, never a website login or an admin.
// A normal owner may take custody only after the existing LoginGuard game proof.
export function trialPoolOwnerId(store) {
  if (!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_trial_pool'").get()) return null;
  return store.db.prepare('SELECT owner_id FROM agent_trial_pool WHERE singleton=1').get()?.owner_id ?? null;
}
export function isTrialAgent(store, uuid) {
  const ownerId = trialPoolOwnerId(store);
  if (!ownerId) return false;
  return !!store.db.prepare(`SELECT 1 FROM agent_clients c JOIN agent_trial_invites t ON t.invite_id=c.invite_id
    JOIN ownerships o ON o.agent_uuid=c.expected_uuid JOIN account_jobs j ON j.id=c.game_request_id
    WHERE c.expected_uuid=? AND c.owner_id=? AND o.owner_id=? AND j.owner_id=? AND j.state='succeeded'`).get(uuid, ownerId, ownerId, ownerId);
}
export function transferTrialAgent(store, uuid, owner, proof) {
  const pool = trialPoolOwnerId(store);
  if (!pool || owner.id === pool || !isTrialAgent(store, uuid)) throw fail(409, 'TRIAL_ALREADY_CLAIMED', '体验角色的归属已变化，请刷新角色列表');
  const client = store.db.prepare('SELECT id,game_request_id FROM agent_clients WHERE expected_uuid=? AND owner_id=?').get(uuid, pool);
  const changed = store.db.prepare('UPDATE ownerships SET owner_id=?,proof=?,created_at=? WHERE agent_uuid=? AND owner_id=?').run(owner.id, proof, Date.now(), uuid, pool);
  if (changed.changes !== 1) throw fail(409, 'TRIAL_ALREADY_CLAIMED', '体验角色已被认领，请刷新角色列表');
  store.db.prepare('UPDATE agent_clients SET owner_id=? WHERE id=? AND owner_id=?').run(owner.id, client.id, pool);
  // Keep the original creation receipt reachable by the same Agent identity.
  // No game password, UUID, inventory or login session is recreated here.
  store.db.prepare("UPDATE account_jobs SET owner_id=? WHERE id=? AND owner_id=? AND state='succeeded'").run(owner.id, client.game_request_id, pool);
  // Self-service appearances follow the verified body through pool claiming.
  // Preserve pending/in-flight receipts and original assets, scoped by UUID.
  for (const table of ['appearance_assets', 'appearance_jobs']) {
    if (store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) store.db.prepare('UPDATE ' + table + ' SET owner_id=? WHERE player_uuid=? AND owner_id=?').run(owner.id, uuid, pool);
  }
  store.audit(owner.id, 'agent.trial.claim', client.id);
}

export class TrialPool {
  constructor(store) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS agent_trial_pool(singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner_id TEXT NOT NULL UNIQUE REFERENCES owners(id));
      CREATE TABLE IF NOT EXISTS agent_trial_batches(id TEXT PRIMARY KEY,issuer_id TEXT NOT NULL REFERENCES owners(id),secret_hash TEXT NOT NULL,count INTEGER NOT NULL,hours INTEGER NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_trial_invites(invite_id TEXT PRIMARY KEY REFERENCES agent_invites(id),batch_id TEXT NOT NULL REFERENCES agent_trial_batches(id),ordinal INTEGER NOT NULL,UNIQUE(batch_id,ordinal));`);
  }
  invitation(inviteId) {
    return !!this.store.db.prepare('SELECT 1 FROM agent_trial_invites WHERE invite_id=?').get(inviteId);
  }
  issue(owner, body) {
    if (owner.role !== 'admin') throw fail(403, 'ADMIN_REQUIRED', '体验池邀请码由服主发放');
    const { requestId, clientSecret, count = 20, expiresInHours: hours = 720, label = '千灯纪体验邀请' } = body;
    if (!UUID.test(requestId || '') || !/^[A-Za-z0-9_-]{43}$/.test(clientSecret || '')) throw fail(400, 'BATCH_IDENTITY_REQUIRED', '请先保存批次 requestId 和随机 32 字节 clientSecret；中断后使用原参数查询');
    if (!Number.isInteger(count) || count < 1 || count > 20 || !Number.isInteger(hours) || hours < 1 || hours > 720 || typeof label !== 'string' || !label.trim() || label.length > 40) throw fail(400, 'INVALID_TRIAL_BATCH', '每批 1–20 个邀请码，有效期 1–720 小时，备注限 40 字');
    const db = this.store.db;
    let duplicate = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT * FROM agent_trial_batches WHERE id=?').get(requestId);
      if (previous) {
        if (previous.issuer_id !== owner.id || previous.secret_hash !== digest(clientSecret) || previous.count !== count || previous.hours !== hours || previous.label !== label.trim()) throw fail(409, 'TRIAL_BATCH_CONFLICT', '批次标识已使用，请使用原参数，不能重复生成');
        duplicate = true;
      } else {
        const pool = trialPoolOwnerId(this.store), now = Date.now();
        const waiting = db.prepare('SELECT count(*) AS n FROM agent_trial_invites t JOIN agent_invites i ON i.id=t.invite_id WHERE i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?').get(now).n;
        const active = pool ? db.prepare('SELECT count(*) AS n FROM agent_clients WHERE owner_id=?').get(pool).n : 0;
        if (waiting + active + count > 100) throw fail(409, 'TRIAL_POOL_FULL', '体验池最多保留 100 个待用邀请或未认领角色，请先处理旧邀请或认领角色');
        let poolId = pool;
        if (!poolId) {
          poolId = randomUUID();
          const name = '__trial_pool_' + randomUUID().slice(0, 8);
          // This hash can never pass verifyPassword; the service owner has no
          // password reset identity, browser session, or administrator role.
          db.prepare('INSERT INTO owners VALUES(?,?,?,?,?,?)').run(poolId, name, name, 'disabled:trial-pool', 'owner', now);
          db.prepare('INSERT INTO agent_trial_pool VALUES(1,?)').run(poolId);
        }
        db.prepare('INSERT INTO agent_trial_batches VALUES(?,?,?,?,?,?,?,?)').run(requestId, owner.id, digest(clientSecret), count, hours, label.trim(), now, now + hours * 3600000);
        for (let i = 0; i < count; i++) {
          const id = randomUUID(), token = this.token(requestId, clientSecret, i);
          db.prepare('INSERT INTO agent_invites VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(id, poolId, label.trim() + ' ' + (i + 1), null, digest(token), now, now + hours * 3600000);
          db.prepare('INSERT INTO agent_trial_invites VALUES(?,?,?)').run(id, requestId, i);
        }
        this.store.audit(owner.id, 'agent.trial.batch', requestId);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    // The server persists only hashes. The operator's private batch secret
    // reconstructs the same tokens after a lost response, never a new batch.
    const invites = db.prepare('SELECT i.*,t.ordinal FROM agent_invites i JOIN agent_trial_invites t ON t.invite_id=i.id WHERE t.batch_id=? ORDER BY t.ordinal').all(requestId).map(row => ({
      id: row.id, label: row.label, token: this.token(requestId, clientSecret, row.ordinal), ownership: 'experience_pool',
      state: row.revoked_at ? 'revoked' : row.used_at ? 'used' : row.expires_at <= Date.now() ? 'expired' : 'available',
      expiresAt: new Date(row.expires_at).toISOString(), username: null,
    }));
    return { requestId, duplicate, ownership: 'experience_pool', invites };
  }
  token(id, secret, index) {
    return 'qdi_' + createHmac('sha256', secret).update(`qiandengji:trial-invite:v1:${id}:${index}`).digest('base64url');
  }
}
