import fs from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { digest } from './store.mjs';
import { seal, unseal } from './game-accounts.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const uuid = /^[a-f0-9-]{36}$/;

// A separate credential and encryption key from read-only world publishing.
// Only this outbox crosses the existing HTTPS connection; the cloud cannot
// execute commands, open RCON, or write LibreLogin's database.
export class CloudAccounts {
  constructor(config, store) {
    this.config = config; this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS account_outbox(id TEXT PRIMARY KEY REFERENCES account_jobs(id),request TEXT NOT NULL,reply TEXT,dispatched_at INTEGER);
      CREATE TABLE IF NOT EXISTS account_bridge_heartbeat(id INTEGER PRIMARY KEY CHECK(id=1),ready INTEGER NOT NULL,received_at INTEGER NOT NULL);`);
    if (!store.db.prepare('PRAGMA table_info(account_outbox)').all().some(column => column.name === 'delivered_at')) store.db.exec('ALTER TABLE account_outbox ADD COLUMN delivered_at INTEGER');
  }
  async key() {
    const value = (await fs.readFile(this.config.cloudAccounts.keyFile, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/i.test(value)) throw Error('INVALID_ACCOUNT_BRIDGE_KEY');
    return Buffer.from(value, 'hex');
  }
  authorize(req) {
    const token = /^Bearer (acc_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
    const expected = this.config.cloudAccounts.tokenHash || '';
    if (!token || !/^[a-f0-9]{64}$/.test(expected) || !timingSafeEqual(Buffer.from(digest(token)), Buffer.from(expected))) throw fail(401, 'ACCOUNT_BRIDGE_CREDENTIAL', '账号同步凭据无效');
  }
  capabilities() {
    const heartbeat = this.store.db.prepare('SELECT * FROM account_bridge_heartbeat WHERE id=1').get();
    const ready = !!heartbeat?.ready && Date.now() - heartbeat.received_at < 20000;
    return { ready, create: ready, claim: ready, gamePassword: ready, source: ready ? 'LoginGuard.encrypted-outbound-bridge' : null,
      ...(!ready ? { reason: 'AUTH_BRIDGE_NOT_CONNECTED', message: '网站账号已可使用；游戏建号服务正在等待登录代理上线，请稍后刷新。' } : {}) };
  }
  async writeRequest(id, request) {
    this.store.db.prepare('INSERT INTO account_outbox(id,request) VALUES(?,?)').run(id, seal(await this.key(), 'request:' + id, request));
  }
  async readResult(id) {
    const row = this.store.db.prepare('SELECT reply FROM account_outbox WHERE id=?').get(id);
    if (!row?.reply) throw Object.assign(Error('Result is not available'), { code: 'ENOENT' });
    return unseal(await this.key(), 'result:' + id, row.reply);
  }
  claimStatus(id, result) {
    const row = this.store.db.prepare('SELECT delivered_at FROM account_outbox WHERE id=?').get(id);
    if (row?.delivered_at) return { ...result, delivery: 'delivered' };
    const { nextCommand, ...pending } = result;
    return { ...pending, delivery: 'queued', instruction: '绑定请求正在送往游戏。请先查询处理结果，显示绑定命令后，再用原角色执行。' };
  }
  async poll(body) {
    if (!body.heartbeat || typeof body.heartbeat.ready !== 'boolean' || !Number.isFinite(body.heartbeat.at) || Math.abs(Date.now() - body.heartbeat.at) > 10000 || !Array.isArray(body.results) || body.results.length > 16) throw fail(400, 'ACCOUNT_POLL_INVALID', '账号同步内容无效');
    const delivered = body.delivered || [];
    if (!Array.isArray(delivered) || delivered.length > 64 || delivered.some(id => !uuid.test(id))) throw fail(400, 'ACCOUNT_DELIVERY_INVALID', '账号送达回执无效');
    for (const id of delivered) if (!this.store.db.prepare('SELECT id FROM account_outbox WHERE id=? AND dispatched_at IS NOT NULL').get(id)) throw fail(400, 'ACCOUNT_DELIVERY_UNKNOWN', '账号送达回执没有对应请求');
    const key = await this.key(), accepted = [], replies = [];
    for (const item of body.results) {
      if (!uuid.test(item.id || '') || typeof item.envelope !== 'string' || item.envelope.length > 32768) throw fail(400, 'ACCOUNT_RESULT_INVALID', '账号回执无效');
      const job = this.store.db.prepare('SELECT j.*,o.reply FROM account_jobs j JOIN account_outbox o ON o.id=j.id WHERE j.id=?').get(item.id);
      if (!job) throw fail(404, 'ACCOUNT_RESULT_UNKNOWN', '没有对应的账号作业');
      let result;
      try { result = unseal(key, 'result:' + item.id, item.envelope); } catch { throw fail(400, 'ACCOUNT_RESULT_INVALID', '账号回执校验失败'); }
      if (result.requestId !== item.id || result.username?.toLowerCase() !== job.name.toLowerCase() || !['succeeded', 'failed', 'waiting', 'running', 'unknown'].includes(result.state) || result.state === 'succeeded' && result.playerUuid !== job.expected_uuid) throw fail(400, 'ACCOUNT_RESULT_IDENTITY', '账号回执身份不一致');
      if (job.reply) {
        const previous = unseal(key, 'result:' + item.id, job.reply);
        if (['succeeded', 'failed'].includes(previous.state) && JSON.stringify(previous) !== JSON.stringify(result)) throw fail(409, 'ACCOUNT_RESULT_FINAL', '最终回执不可覆盖');
      }
      replies.push(item); accepted.push(item.id);
    }
    const now = Date.now();
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of replies) this.store.db.prepare('UPDATE account_outbox SET reply=? WHERE id=?').run(item.envelope, item.id);
      for (const id of delivered) this.store.db.prepare('UPDATE account_outbox SET delivered_at=COALESCE(delivered_at,?) WHERE id=?').run(now, id);
      this.store.db.prepare('INSERT INTO account_bridge_heartbeat VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET ready=excluded.ready,received_at=excluded.received_at').run(body.heartbeat.ready ? 1 : 0, now);
      // An undelivered expired request provably did not reach the game. A
      // dispatched request stays queryable, including after its deadline.
      const expired = this.store.db.prepare("SELECT j.id FROM account_jobs j JOIN account_outbox o ON o.id=j.id WHERE j.state='pending' AND j.expires_at<? AND o.dispatched_at IS NULL").all(now);
      for (const row of expired) this.store.db.prepare('UPDATE account_jobs SET state=?,result=? WHERE id=?').run('failed', JSON.stringify({ state: 'failed', reason: 'ACCOUNT_REQUEST_EXPIRED', message: '请求在送达游戏前过期，没有执行。请重新发起。' }), row.id);
      const requests = body.heartbeat.ready ? this.store.db.prepare("SELECT j.id,o.request AS envelope FROM account_jobs j JOIN account_outbox o ON o.id=j.id WHERE j.state IN ('pending','unknown') AND j.expires_at>? AND o.reply IS NULL ORDER BY j.created_at LIMIT 4").all(now) : [];
      for (const row of requests) this.store.db.prepare('UPDATE account_outbox SET dispatched_at=COALESCE(dispatched_at,?) WHERE id=?').run(now, row.id);
      this.store.db.exec('COMMIT');
      const watch = this.store.db.prepare("SELECT j.id FROM account_jobs j JOIN account_outbox o ON o.id=j.id WHERE j.state IN ('pending','unknown') AND o.dispatched_at IS NOT NULL ORDER BY j.created_at LIMIT 64").all().map(row => row.id);
      return { requests, watch, acknowledged: accepted };
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
}
