import { createHash } from 'node:crypto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_BUCKETS = 20000;
const limited = seconds => Object.assign(new Error(`登录尝试过多，请在 ${seconds} 秒后重试。`), {
  status: 429, reason: 'LOGIN_THROTTLED', retryAfterSeconds: seconds,
});

// CSRF is a different boundary. These counters survive new cookies, changing
// login aliases and process restarts. Store salted hashes, never passwords or IPs.
export class LoginThrottle {
  constructor(store, now = Date.now) {
    this.store = store; this.now = now;
    store.db.exec(`CREATE TABLE IF NOT EXISTS login_throttles(
      key_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL,
      started_at INTEGER NOT NULL, next_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS login_throttles_expiry ON login_throttles(expires_at);`);
  }
  key(scope, value) {
    return createHash('sha256').update(this.store.salt).update('\0' + scope + '\0' + value).digest('hex');
  }
  reserve(address, account) {
    const now = this.now(), db = this.store.db;
    const peer = String(address).toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
    const rules = [
      { key: this.key('address', peer), max: 30, lockMs: 5 * 60 * 1000 },
      { key: this.key('account', account), max: 10, lockMs: 60 * 1000 },
      { key: this.key('pair', peer + '\0' + account), max: 5, lockMs: 5 * 60 * 1000, cooldown: true },
    ];
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM login_throttles WHERE expires_at<=?').run(now);
      const rows = rules.map(rule => ({ rule, entry: db.prepare('SELECT * FROM login_throttles WHERE key_hash=?').get(rule.key) }));
      const retryAt = Math.max(0, ...rows.map(({ entry }) => entry?.next_at || 0));
      if (retryAt > now) throw limited(Math.max(1, Math.ceil((retryAt - now) / 1000)));
      const missing = rows.filter(row => !row.entry).length;
      if (Number(db.prepare('SELECT count(*) AS count FROM login_throttles').get().count) + missing > MAX_BUCKETS) throw limited(60);
      for (const { rule, entry } of rows) {
        const previous = entry && entry.started_at + WINDOW_MS > now ? entry : null;
        const attempts = (previous?.attempts || 0) + 1, started = previous?.started_at ?? now;
        const wait = attempts >= rule.max ? rule.lockMs
          : rule.cooldown && attempts >= 3 ? Math.min(10000, 1000 * 2 ** (attempts - 3)) : 0;
        const next = now + wait;
        db.prepare(`INSERT INTO login_throttles VALUES(?,?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET
          attempts=excluded.attempts,started_at=excluded.started_at,next_at=excluded.next_at,expires_at=excluded.expires_at`)
          .run(rule.key, attempts, started, next, Math.max(started + WINDOW_MS, next));
      }
      db.exec('COMMIT');
      // Reserve before async password verification so parallel requests cannot
      // all pass a stale counter. Interrupted attempts conservatively count.
      return { account: rules[1].key, pair: rules[2].key };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  succeeded(ticket) {
    // A successful password clears only this account and pair. Keep the source
    // address budget so logging into one's own account cannot reset spraying.
    this.store.db.prepare('DELETE FROM login_throttles WHERE key_hash IN (?,?)').run(ticket.account, ticket.pair);
  }
}
