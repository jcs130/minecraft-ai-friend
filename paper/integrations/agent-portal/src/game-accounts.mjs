import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { prepareReviewedRoles } from './ownership-review.mjs';
import { trialPoolOwnerId, isTrialAgent, transferTrialAgent } from './trial-pool.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
export function offlineUuid(name) {
  const bytes = createHash('md5').update('OfflinePlayer:' + name).digest();
  bytes[6] = bytes[6] & 15 | 48; bytes[8] = bytes[8] & 63 | 128;
  const value = bytes.toString('hex');
  return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join('-');
}

// Shared with the optional LoginGuard adapter. Only encrypted requests cross
// this local IPC directory; neither component stores plaintext game passwords.
export function seal(key, label, value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('qiandengji:portal:1:' + label));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ schemaVersion: 1, iv: iv.toString('base64'), data: bytes.toString('base64') });
}
export function unseal(key, label, encoded) {
  if (encoded.length > 32768) throw Error('BRIDGE_ENVELOPE_TOO_LARGE');
  const envelope = JSON.parse(encoded), iv = Buffer.from(envelope.iv, 'base64'), bytes = Buffer.from(envelope.data, 'base64');
  if (envelope.schemaVersion !== 1 || iv.length !== 12 || bytes.length < 17 || bytes.length > 16384) throw Error('BRIDGE_ENVELOPE_INVALID');
  const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from('qiandengji:portal:1:' + label));
  cipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]).toString('utf8'));
}

export class GameAccounts {
  constructor(config, store, game, remote = null) {
    prepareReviewedRoles(store);
    this.config = config; this.store = store; this.game = game; this.remote = remote;
    store.db.exec(`CREATE TABLE IF NOT EXISTS portal_agents(player_uuid TEXT PRIMARY KEY, name TEXT NOT NULL, normalized TEXT NOT NULL UNIQUE, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_jobs(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), operation TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, expected_uuid TEXT);`);
    if (!store.db.prepare('PRAGMA table_info(account_jobs)').all().some(column => column.name === 'expected_uuid')) store.db.exec('ALTER TABLE account_jobs ADD COLUMN expected_uuid TEXT');
    game.portalIdentities = () => store.db.prepare('SELECT player_uuid AS uuid,name FROM portal_agents').all();
  }
  async key() {
    if (!this.config.authBridge.enabled || !this.config.authBridge.directory || !this.config.authBridge.keyFile) throw fail(503, 'AUTH_BRIDGE_NOT_CONNECTED', '游戏账号桥暂不可用，网站登录仍可用；稍后查询原请求，服主可检查认证桥配置。');
    const encoded = (await fs.readFile(this.config.authBridge.keyFile, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/i.test(encoded)) throw Error('INVALID_BRIDGE_KEY');
    return Buffer.from(encoded, 'hex');
  }
  async capabilities() {
    if (this.remote) return this.remote.capabilities();
    if (this.config.sourceMode === 'cloud') return { ready: false, create: false, claim: false, gamePassword: false, source: null,
      reason: 'CLOUD_AUTH_BRIDGE_PENDING', message: '游戏角色建号、本人认领和改密等待认证桥上线；现有游戏登录保持。' };
    try {
      const key = await this.key();
      const raw = await fs.readFile(path.join(this.config.authBridge.directory, 'heartbeat.json'), 'utf8');
      const heartbeat = unseal(key, 'heartbeat', raw);
      const ready = heartbeat.ready === true && Number.isFinite(heartbeat.at) && heartbeat.at <= Date.now() + 1000 && Date.now() - heartbeat.at < 5000;
      return { ready, create: ready, claim: ready, gamePassword: ready, source: ready ? 'LoginGuard.private-portal-bridge' : null };
    } catch { return { ready: false, create: false, claim: false, gamePassword: false, source: null }; }
  }
  assertCreateQuota(owner) {
    if (owner.id === trialPoolOwnerId(this.store)) return;
    const maximum = this.config.cloudAccounts?.maxAgentsPerOwner || 5;
    const owned = this.store.db.prepare('SELECT count(*) AS n FROM ownerships o WHERE owner_id=? AND NOT EXISTS (SELECT 1 FROM reviewed_role_identities r WHERE r.player_uuid=o.agent_uuid)').get(owner.id).n;
    const pending = this.store.db.prepare("SELECT count(*) AS n FROM account_jobs WHERE owner_id=? AND operation='create' AND state IN ('pending','unknown')").get(owner.id).n;
    if (owner.role !== 'admin' && owned + pending >= maximum) throw fail(409, 'AGENT_LIMIT', `每个网站账号最多 ${maximum} 个 Agent；请先查询已有请求或联系服主。`);
  }
  async start(owner, operation, body) {
    const capability = await this.capabilities();
    if (!capability.ready) throw fail(503, capability.reason || 'AUTH_BRIDGE_NOT_CONNECTED', capability.message || '游戏账号桥暂不可用；请稍后查询原请求，不要重复建号或改密。');
    const name = body.username;
    if (typeof name !== 'string' || !(operation === 'create' ? /^ag_[A-Za-z0-9_]{1,13}$/i : /^\.?[A-Za-z0-9_]{1,16}$/).test(name)) throw fail(400, 'INVALID_AGENT_NAME', '新 Agent 角色名应为 ag_ 开头，总长不超过 16 个字母、数字或下划线；已有角色请填写原游戏名。');
    if (/eye$/i.test(name) || ['ag_goddess', 'ag_player', 'ag_corti', 'ag_corticam'].includes(name.toLowerCase())) throw fail(403, 'RESERVED_ACCOUNT', '观战与管理身份不能从网站注册或认领');
    if (this.store.db.prepare('SELECT 1 FROM archived_test_roles WHERE lower(name)=?').get(name.toLowerCase())) throw fail(403, 'RETIRED_TEST_ACCOUNT', '历史测试角色已归档，请选择新的角色名');
    const id = body.requestId;
    if (!UUID.test(id || '')) throw fail(400, 'REQUEST_ID_REQUIRED', '请提供一次操作对应的 requestId，超时后查询同一请求，不要重复提交');
    const previous = this.store.db.prepare('SELECT * FROM account_jobs WHERE id=?').get(id);
    if (previous) {
      if (previous.owner_id !== owner.id || previous.operation !== operation || previous.name.toLowerCase() !== name.toLowerCase()) throw fail(409, 'REQUEST_ID_CONFLICT', '此请求标识已用于另一项操作');
      return this.job(owner, id);
    }
    if (operation === 'create') this.assertCreateQuota(owner);
    const roster = await this.game.roster();
    const existing = roster.find(row => row.name.toLowerCase() === name.toLowerCase());
    if (existing?.historical) throw fail(409, 'HISTORICAL_ROLE_READ_ONLY', '这是按原 UUID 保存的历史身体，不能按名字认领或改密；请使用当前游戏角色，或联系服主核验。');
    if (existing?.isReserved || existing?.identityConflict) throw fail(403, 'RESERVED_ACCOUNT', '这个角色不可自助绑定，请联系服主核验');
    if (operation === 'create' && existing) throw fail(409, 'ACCOUNT_EXISTS', '角色已经存在，请通过游戏内绑定原角色，保留 UUID 和原物品');
    if (operation !== 'create' && !existing?.playerUuid) throw fail(404, 'AGENT_NOT_FOUND', '请先选择已有角色');
    const ownership = existing?.playerUuid ? this.store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(existing.playerUuid) : null;
    if (ownership && ownership.owner_id !== owner.id && !(operation === 'claim' && isTrialAgent(this.store, existing.playerUuid))) throw fail(409, 'ALREADY_OWNED', '角色已绑定其他网站账号，请联系服主核验');
    if (operation === 'password' && ownership?.owner_id !== owner.id) throw fail(403, 'OWNERSHIP_REQUIRED', '先在游戏内绑定这个角色，再修改游戏密码');
    if (operation === 'create' || operation === 'password') {
      if (typeof body.gamePassword !== 'string' || body.gamePassword.length < 6 || body.gamePassword.length > 64 || /\s/.test(body.gamePassword) || /^(123456|password|qwerty|12345678)$/i.test(body.gamePassword)) throw fail(400, 'INVALID_GAME_PASSWORD', '游戏密码需为 6–64 位且不含空格，请避免常见弱密码');
    }
    if (operation === 'password' && (typeof body.currentGamePassword !== 'string' || body.currentGamePassword.length > 128)) throw fail(400, 'CURRENT_PASSWORD_REQUIRED', '请输入当前游戏密码；正版或两步验证账号请在游戏内改密');
    const now = Date.now(), expires = now + (operation === 'claim' ? 300000 : 120000);
    const expectedUuid = operation === 'create' ? offlineUuid(name) : existing.playerUuid;
    const code = operation === 'claim' ? randomBytes(24).toString('hex') : null;
    const request = { schemaVersion: 1, requestId: id, operation, username: name, playerUuid: existing?.playerUuid || null,
      expiresAt: expires, createdAt: now, ...(operation === 'claim' ? { code } : { password: body.gamePassword }),
      ...(operation === 'password' ? { currentPassword: body.currentGamePassword } : {}) };
    const result = { state: 'pending', ...(code ? { nextCommand: `/portal bind ${id} ${code}`, instruction: '用已登录的原角色执行此命令，再查询本请求。无密码或弱默认密码不能证明归属，请先设置自己的密码。' } : {}) };
    // roster() yielded above. Recheck directly before persistence so parallel
    // API/browser requests cannot pass the same final quota slot or insert the
    // same id twice. No bridge operation is sent before this job exists.
    const raced = this.store.db.prepare('SELECT * FROM account_jobs WHERE id=?').get(id);
    if (raced) {
      if (raced.owner_id !== owner.id || raced.operation !== operation || raced.name.toLowerCase() !== name.toLowerCase()) throw fail(409, 'REQUEST_ID_CONFLICT', '此请求标识已用于另一项操作');
      return this.job(owner, id);
    }
    if (operation === 'create') this.assertCreateQuota(owner);
    this.store.db.prepare('INSERT INTO account_jobs VALUES(?,?,?,?,?,?,?,?,?)').run(id, owner.id, operation, name, 'pending', JSON.stringify(result), now, expires, expectedUuid);
    try {
      if (this.remote) await this.remote.writeRequest(id, request);
      else {
      const key = await this.key(), directory = path.join(this.config.authBridge.directory, 'requests');
      await fs.mkdir(directory, { recursive: true });
      const temporary = path.join(directory, id + '.tmp');
      await fs.writeFile(temporary, seal(key, 'request:' + id, request), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, path.join(directory, id + '.json'));
      }
    } catch {
      this.store.db.prepare('UPDATE account_jobs SET state=? WHERE id=?').run('unknown', id);
      throw fail(503, 'ACCOUNT_RESULT_UNKNOWN', `请求 ${id} 的结果尚未确认，请查询原请求，不要重复操作`);
    }
    this.store.audit(owner.id, 'game.' + operation + '.requested', id);
    return { id, operation, username: name, ...(this.remote && operation === 'claim' ? this.remote.claimStatus(id, result) : result), expiresAt: new Date(expires).toISOString(), query: `/api/v1/jobs/${id}` };
  }
  async job(owner, id) {
    const job = this.store.db.prepare('SELECT * FROM account_jobs WHERE id=? AND owner_id=?').get(id, owner.id);
    if (!job) throw fail(404, 'JOB_NOT_FOUND', '未找到属于你的请求');
    let result = JSON.parse(job.result || '{}');
    if (['pending', 'unknown'].includes(job.state)) {
      try {
        const value = this.remote ? await this.remote.readResult(id) : unseal(await this.key(), 'result:' + id, await fs.readFile(path.join(this.config.authBridge.directory, 'results', id + '.json'), 'utf8'));
        if (value.requestId !== id || value.username?.toLowerCase() !== job.name.toLowerCase() || !['succeeded', 'failed', 'waiting', 'running', 'unknown'].includes(value.state)) throw Error('BRIDGE_RESULT_MISMATCH');
        if (value.state === 'succeeded') {
          if (!UUID.test(value.playerUuid || '') || value.playerUuid !== job.expected_uuid) throw Error('BRIDGE_IDENTITY_INVALID');
          this.store.db.exec('BEGIN IMMEDIATE');
          try {
            if (job.operation !== 'password') {
              const original = this.store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(value.playerUuid);
              if (original && original.owner_id !== owner.id) {
                if (job.operation !== 'claim' || !isTrialAgent(this.store, value.playerUuid)) throw Error('OWNERSHIP_CONFLICT');
                transferTrialAgent(this.store, value.playerUuid, owner, 'Verified LoginGuard request ' + id);
              }
              const known = this.store.db.prepare('SELECT player_uuid FROM portal_agents WHERE normalized=?').get(job.name.toLowerCase());
              if (known && known.player_uuid !== value.playerUuid) throw Error('IDENTITY_CONFLICT');
              this.store.db.prepare('INSERT OR IGNORE INTO portal_agents VALUES(?,?,?,?)').run(value.playerUuid, value.username, value.username.toLowerCase(), 'LoginGuard.verified-portal-bridge');
              this.store.db.prepare('INSERT OR IGNORE INTO ownerships VALUES(?,?,?,?)').run(owner.id, value.playerUuid, 'Verified LoginGuard request ' + id, Date.now());
            }
            result = { state: 'succeeded', playerUuid: value.playerUuid, username: value.username, message: job.operation === 'password' ? '游戏密码已保存，下次离线登录使用新密码。' : '角色身份已核实并绑定，原 UUID 和已有物品保持。' };
            this.store.db.prepare('UPDATE account_jobs SET state=?,result=? WHERE id=?').run('succeeded', JSON.stringify(result), id);
            this.store.db.exec('COMMIT'); this.game.cache?.clear();
          } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
        } else if (value.state === 'failed') {
          result = { state: 'failed', reason: String(value.reason || 'ACCOUNT_REQUEST_FAILED').slice(0, 80), message: String(value.message || '请核对游戏内提示后重新操作').slice(0, 300) };
          this.store.db.prepare('UPDATE account_jobs SET state=?,result=? WHERE id=?').run('failed', JSON.stringify(result), id);
        } else if (value.state === 'unknown') {
          result = { state: 'unknown', message: '服务器已保留本次操作，结果尚未确认。请继续查询同一请求，不要重复创建或改密。' };
          this.store.db.prepare('UPDATE account_jobs SET state=?,result=? WHERE id=?').run('unknown', JSON.stringify(result), id);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') result = { state: 'unknown', message: '身份回执暂未确认，请继续查询原请求，不要重复创建或改密。' };
      }
      if (result.state === 'pending' && Date.now() > job.expires_at) result = { state: 'unknown', message: '请求已超过等待时间，请查询原请求或联系服主核验。没有自动重放操作。' };
    }
    return { id, operation: job.operation, username: job.name, ...(this.remote && job.operation === 'claim' && result.nextCommand ? this.remote.claimStatus(id, result) : result), query: `/api/v1/jobs/${id}`, expiresAt: new Date(job.expires_at).toISOString() };
  }
}
