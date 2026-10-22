import { randomUUID, timingSafeEqual } from 'node:crypto';
import { digest, newSecret } from './store.mjs';
import { offlineUuid } from './game-accounts.mjs';
import { UUID } from './game-data.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { agentSkill } from './agent-skill.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const validName = name => typeof name === 'string' && /^ag_[A-Za-z0-9_]{1,13}$/.test(name);
const equalHash = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === 64 && b.length === 64 && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const publicInvite = row => ({ id: row.id, label: row.label, username: row.name || null,
  state: row.revoked_at ? 'revoked' : row.used_at ? 'used' : row.expires_at <= Date.now() ? 'expired' : 'available',
  createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() });

// An invitation delegates ONE new ordinary Agent to its website owner. It
// cannot claim existing players, create website administrators, or reuse the
// owner's browser session. The Agent generates its own high-entropy login
// secret before exchange so a lost HTTP response is safely recoverable.
export class AgentAccess {
  constructor(config, store, game, accounts) {
    Object.assign(this, { config, store, game, accounts });
    this.preparing = new Set();
    this.helperSha256 = digest(fs.readFileSync(path.join(config.publicDir, 'agent-register.mjs')));
    store.db.exec(`CREATE TABLE IF NOT EXISTS agent_invites(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES owners(id),label TEXT NOT NULL,name TEXT,token_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER,revoked_at INTEGER);
      CREATE TABLE IF NOT EXISTS agent_clients(id TEXT PRIMARY KEY,invite_id TEXT NOT NULL UNIQUE REFERENCES agent_invites(id),owner_id TEXT NOT NULL REFERENCES owners(id),name TEXT NOT NULL,normalized TEXT NOT NULL UNIQUE,expected_uuid TEXT NOT NULL,secret_hash TEXT NOT NULL,created_at INTEGER NOT NULL,revoked_at INTEGER,game_request_id TEXT);
      CREATE TABLE IF NOT EXISTS agent_access_sessions(id_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES agent_clients(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);
      CREATE INDEX IF NOT EXISTS agent_access_client_sessions ON agent_access_sessions(client_id);`);
  }
  async capabilities() {
    return { schemaVersion: 1, enabled: this.config.agentAccess.enabled === true, invitationRequired: true,
      ownership: 'inviter', createsWebsiteOwner: false, game: await this.accounts.capabilities(),
      gameAddress: this.config.publicGameAddress, gameVersion: '1.21.1',
      skill: agentSkill, joinPage: '/join',
      helper: { url: '/agent-register.mjs', sha256: this.helperSha256, node: '>=22.13.0' },
      endpoints: { register: '/api/v1/agent-access/register', login: '/api/v1/agent-access/sessions', status: '/api/v1/agent-access/status', activate: '/api/v1/agent-access/activate', state: '/api/v1/agent-access/state', logout: '/api/v1/agent-access/session' },
      memories: { page: '/#memories', endpoint: '/api/v1/agent-access/memories', publication: 'explicit-confirmation', needsCreatedGameAccount: true },
      help: '/agent-api.html' };
  }
  enabled() { if (this.config.agentAccess.enabled !== true) throw fail(403, 'AGENT_ACCESS_DISABLED', '邀请码接入暂未开放，请联系角色主人'); }
  invitation(token) {
    this.enabled();
    const row = typeof token === 'string' && /^qdi_[A-Za-z0-9_-]{43}$/.test(token)
      ? this.store.db.prepare('SELECT * FROM agent_invites WHERE token_hash=?').get(digest(token)) : null;
    if (!row) throw fail(401, 'INVITE_INVALID', '邀请链接无效，请向角色主人申请新邀请');
    const { username, state, expiresAt } = publicInvite(row);
    // Reading a link never consumes it, logs in, or exposes the owner's name.
    return { schemaVersion: 1, username, state, expiresAt };
  }
  list(owner) {
    return { invites: this.store.db.prepare('SELECT * FROM agent_invites WHERE owner_id=? ORDER BY created_at DESC LIMIT 50').all(owner.id).map(row => ({ ...publicInvite(row),
      agent: this.store.db.prepare('SELECT name FROM agent_clients WHERE invite_id=?').get(row.id)?.name || null })) };
  }
  checkName(name) {
    if (!validName(name)) throw fail(400, 'INVALID_AGENT_NAME', '新角色名需为小写 ag_ 开头，总长不超过 16 位，只含字母、数字和下划线');
    if (/eye$/i.test(name) || ['ag_goddess', 'ag_player', 'ag_corti', 'ag_corticam', 'ag_live'].includes(name.toLowerCase())) throw fail(403, 'RESERVED_ACCOUNT', 'Eye 观战和管理员身份不能通过邀请码注册');
    if (this.store.db.prepare('SELECT 1 FROM archived_test_roles WHERE lower(name)=?').get(name.toLowerCase())) throw fail(403, 'RETIRED_TEST_ACCOUNT', '这个历史测试角色已归档，请为新 Agent 选择新名字');
  }
  quota(owner) {
    if (owner.role === 'admin') return;
    const owned = this.store.ownedUuids(owner.id).length;
    const clients = this.store.db.prepare('SELECT count(*) AS n FROM agent_clients c WHERE c.owner_id=? AND c.revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM ownerships o WHERE o.agent_uuid=c.expected_uuid)').get(owner.id).n;
    const otherPending = this.store.db.prepare("SELECT count(*) AS n FROM account_jobs j WHERE j.owner_id=? AND j.operation='create' AND j.state IN ('pending','unknown') AND NOT EXISTS (SELECT 1 FROM agent_clients c WHERE c.game_request_id=j.id AND c.revoked_at IS NULL)").get(owner.id).n;
    const maximum = this.config.cloudAccounts.maxAgentsPerOwner || 5;
    if (owned + clients + otherPending >= maximum) throw fail(409, 'AGENT_LIMIT', `角色主人最多管理 ${maximum} 个 Agent；请先处理已有注册或联系服主`);
  }
  issue(owner, body) {
    this.enabled(); this.quota(owner);
    if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 60) throw fail(400, 'INVALID_LABEL', '请填写 1–60 字的邀请码用途');
    const name = body.username === undefined || body.username === '' ? null : body.username;
    if (name !== null) this.checkName(name);
    const hours = body.expiresInHours ?? 24;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw fail(400, 'INVALID_EXPIRY', '邀请码有效期为 1–168 小时');
    if (this.store.db.prepare('SELECT count(*) AS n FROM agent_invites WHERE owner_id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').get(owner.id, Date.now()).n >= 20) throw fail(409, 'INVITE_LIMIT', '最多保留 20 个有效邀请码，请先撤销不再使用的邀请');
    const token = 'qdi_' + newSecret(), now = Date.now(), id = randomUUID();
    this.store.db.prepare('INSERT INTO agent_invites VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(id, owner.id, body.label.trim(), name, digest(token), now, now + hours * 3600000);
    this.store.audit(owner.id, 'agent.invite.create', id);
    return { ...publicInvite(this.store.db.prepare('SELECT * FROM agent_invites WHERE id=?').get(id)), token,
      usage: '一次性邀请，仅用于新 Agent；角色属于你的账号。请私下交给可信程序，别放进公开对话。' };
  }
  revoke(owner, id) {
    const invite = this.store.db.prepare('SELECT * FROM agent_invites WHERE id=? AND owner_id=?').get(id, owner.id);
    if (!invite) throw fail(404, 'INVITE_NOT_FOUND', '未找到属于你的邀请');
    const now = Date.now();
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.db.prepare('UPDATE agent_invites SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(now, id);
      this.store.db.prepare('UPDATE agent_clients SET revoked_at=COALESCE(revoked_at,?) WHERE invite_id=?').run(now, id);
      this.store.db.prepare('UPDATE agent_access_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE client_id IN (SELECT id FROM agent_clients WHERE invite_id=?)').run(now, id);
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.store.audit(owner.id, 'agent.invite.revoke', id);
    return { ok: true, message: '邀请及对应 API 凭据已撤销；已有游戏角色和游戏密码保留。' };
  }
  async register(token, body) {
    this.enabled();
    if (!/^qdi_[A-Za-z0-9_-]{43}$/.test(token || '')) throw fail(401, 'INVITE_REQUIRED', '请在 Authorization 中提供一次性邀请码');
    if (typeof body.requestId !== 'string' || !UUID.test(body.requestId) || typeof body.clientSecret !== 'string' || !secretPattern.test(body.clientSecret)) throw fail(400, 'CLIENT_IDENTITY_REQUIRED', '先在本机保存随机 requestId 和 32 字节 base64url clientSecret，再兑换；超时后使用同一组参数查询或重试');
    this.checkName(body.username);
    const invite = this.store.db.prepare('SELECT * FROM agent_invites WHERE token_hash=?').get(digest(token));
    if (!invite || invite.revoked_at || invite.expires_at <= Date.now()) throw fail(401, 'INVITE_INVALID', '邀请码无效、已过期或已撤销，请向角色主人申请新邀请');
    if (invite.name && invite.name !== body.username) throw fail(403, 'INVITE_NAME_MISMATCH', '请使用邀请码限定的原始角色名');
    const owner = this.store.ownerById(invite.owner_id);
    if (!owner) throw fail(401, 'INVITE_INVALID', '邀请码已失效');
    const roster = await this.game.roster();
    let duplicate = false;
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      // Recheck inside the transaction: parallel exchanges cannot consume an
      // invitation twice, reserve the same name twice, or bypass the quota.
      const current = this.store.db.prepare('SELECT * FROM agent_invites WHERE id=?').get(invite.id);
      if (!current || current.revoked_at || current.expires_at <= Date.now()) throw fail(401, 'INVITE_INVALID', '邀请码已失效');
      const previous = this.store.db.prepare('SELECT * FROM agent_clients WHERE id=?').get(body.requestId);
      if (previous) {
        if (previous.invite_id !== invite.id || previous.name !== body.username || previous.revoked_at || !equalHash(previous.secret_hash, digest(body.clientSecret))) throw fail(409, 'REGISTRATION_CONFLICT', '注册标识已使用，请核对原先保存的身份，不能替换参数');
        duplicate = true;
      } else {
        if (current.used_at) throw fail(409, 'INVITE_USED', '邀请码已使用；原客户端请用已保存的 clientId 和 clientSecret 登录');
        this.quota(owner);
        if (roster.some(row => row.name.toLowerCase() === body.username.toLowerCase()) || this.store.db.prepare('SELECT 1 FROM portal_agents WHERE normalized=?').get(body.username.toLowerCase()) || this.store.db.prepare('SELECT 1 FROM ownerships WHERE agent_uuid=?').get(offlineUuid(body.username))) throw fail(409, 'ACCOUNT_EXISTS', '该游戏角色已存在；邀请码不能认领或改密，请另选新名字');
        if (this.store.db.prepare('SELECT 1 FROM agent_clients WHERE normalized=?').get(body.username.toLowerCase())) throw fail(409, 'AGENT_NAME_RESERVED', '这个名字已被注册，请另选名字或联系角色主人');
        const now = Date.now();
        this.store.db.prepare('INSERT INTO agent_clients VALUES(?,?,?,?,?,?,?,?,NULL,NULL)').run(body.requestId, invite.id, owner.id, body.username, body.username.toLowerCase(), offlineUuid(body.username), digest(body.clientSecret), now);
        this.store.db.prepare('UPDATE agent_invites SET used_at=? WHERE id=? AND used_at IS NULL').run(now, invite.id);
        this.store.audit(owner.id, 'agent.invite.redeem', body.requestId);
      }
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    return { schemaVersion: 1, clientId: body.requestId, username: body.username, state: 'registered', duplicate,
      registrationOnly: true, nextAction: 'login', login: '/api/v1/agent-access/sessions', ownership: 'inviter' };
  }
  login(body) {
    this.enabled();
    const client = typeof body.clientId === 'string' && UUID.test(body.clientId) ? this.store.db.prepare('SELECT * FROM agent_clients WHERE id=? AND revoked_at IS NULL').get(body.clientId) : null;
    if (!client || typeof body.clientSecret !== 'string' || !secretPattern.test(body.clientSecret) || !equalHash(client.secret_hash, digest(body.clientSecret))) throw fail(401, 'AGENT_LOGIN_FAILED', 'Agent 接入身份或密钥不正确，请使用注册前本机保存的身份文件');
    const now = Date.now(), token = 'qda_' + newSecret();
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.db.prepare('UPDATE agent_access_sessions SET revoked_at=? WHERE client_id=? AND revoked_at IS NULL').run(now, client.id);
      this.store.db.prepare('INSERT INTO agent_access_sessions VALUES(?,?,?,?,NULL)').run(digest(token), client.id, now, now + 3600000);
      this.store.db.prepare('DELETE FROM agent_access_sessions WHERE expires_at<?').run(now - 86400000);
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.store.audit(client.owner_id, 'agent.session.login', client.id);
    return { schemaVersion: 1, clientId: client.id, username: client.name, token, tokenType: 'Bearer', expiresAt: new Date(now + 3600000).toISOString(),
      scopes: ['agent.self.read', 'agent.self.create', 'agent.self.memories'], nextAction: 'status', status: '/api/v1/agent-access/status' };
  }
  authorize(req) {
    this.enabled();
    const token = /^Bearer (qda_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
    const row = token ? this.store.db.prepare('SELECT c.*,s.id_hash AS session_hash FROM agent_access_sessions s JOIN agent_clients c ON c.id=s.client_id WHERE s.id_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND c.revoked_at IS NULL').get(digest(token), Date.now()) : null;
    if (!row) throw fail(401, 'AGENT_LOGIN_REQUIRED', 'API 登录已失效，请用本机身份文件重新登录');
    const owner = this.store.ownerById(row.owner_id);
    if (!owner) throw fail(401, 'AGENT_LOGIN_REQUIRED', '角色主人账号已不可用');
    return { client: row, owner };
  }
  async status({ client, owner }) {
    let job = null;
    if (client.game_request_id) {
      if (this.store.db.prepare('SELECT 1 FROM account_jobs WHERE id=? AND owner_id=?').get(client.game_request_id, owner.id)) job = await this.accounts.job(owner, client.game_request_id);
      else if (this.preparing.has(client.id)) job = { id: client.game_request_id, state: 'pending', message: '正在建立本次请求，请查询原状态' };
      else {
        // start() persists its job before any bridge dispatch. A process that
        // died before that insert could not have sent a game operation.
        this.store.db.prepare('UPDATE agent_clients SET game_request_id=NULL WHERE id=? AND game_request_id=?').run(client.id, client.game_request_id);
        client.game_request_id = null;
      }
    }
    return { schemaVersion: 1, clientId: client.id, username: client.name, state: job?.state === 'succeeded' ? 'ready' : job ? job.state : 'not_created',
      gameAccountCreated: job?.state === 'succeeded', job, game: await this.accounts.capabilities(), gameAddress: this.config.publicGameAddress, gameVersion: '1.21.1',
      nextAction: job?.state === 'succeeded' ? 'connect_game' : job && ['pending', 'unknown'].includes(job.state) ? 'query_status' : 'activate',
      gamePasswordEnv: 'MC_GAME_PASSWORD', apiCredentialIsGamePassword: false };
  }
  async activate({ client, owner }, body) {
    if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw fail(400, 'REQUEST_ID_REQUIRED', '先保存本次建号的 requestId，超时后查询状态，不要换标识重复提交');
    if (this.preparing.has(client.id)) throw fail(409, 'ACCOUNT_REQUEST_PENDING', '正在建立原请求，请查询 status');
    await this.status({ client, owner });
    if (client.game_request_id) {
      const previous = await this.accounts.job(owner, client.game_request_id);
      if (client.game_request_id === body.requestId || previous.state === 'succeeded') return previous;
      if (previous.state !== 'failed') throw fail(409, 'ACCOUNT_REQUEST_PENDING', '已有建号请求尚未确认，请查询 status，不要重复创建');
    }
    const capability = await this.accounts.capabilities();
    if (!capability.ready) throw fail(503, capability.reason || 'AUTH_BRIDGE_NOT_CONNECTED', '接入身份已注册，游戏建号桥尚未上线；保留身份文件，稍后查询 status，暂不连接游戏');
    if (typeof body.gamePassword !== 'string' || body.gamePassword.length < 6 || body.gamePassword.length > 64 || /\s/.test(body.gamePassword) || /^(123456|password|qwerty|12345678)$/i.test(body.gamePassword)) throw fail(400, 'INVALID_GAME_PASSWORD', '游戏密码需为 6–64 位且不含空格，请避免常见弱密码');
    // Reserve the single request before yielding. A concurrent activation must
    // query this one, never submit a second consumptive operation.
    const current = this.store.db.prepare('SELECT game_request_id FROM agent_clients WHERE id=? AND revoked_at IS NULL').get(client.id);
    if (!current || current.game_request_id !== client.game_request_id) throw fail(409, 'ACCOUNT_REQUEST_PENDING', '状态已变化，请重新查询 status');
    this.store.db.prepare('UPDATE agent_clients SET game_request_id=? WHERE id=?').run(body.requestId, client.id);
    this.preparing.add(client.id);
    try { return await this.accounts.start(owner, 'create', { username: client.name, requestId: body.requestId, gamePassword: body.gamePassword }); }
    catch (error) {
      if (!this.store.db.prepare('SELECT 1 FROM account_jobs WHERE id=? AND owner_id=?').get(body.requestId, owner.id)) this.store.db.prepare('UPDATE agent_clients SET game_request_id=? WHERE id=? AND game_request_id=?').run(client.game_request_id, client.id, body.requestId);
      throw error;
    } finally { this.preparing.delete(client.id); }
  }
  async state(context) {
    const status = await this.status(context);
    if (!status.gameAccountCreated) throw fail(409, 'GAME_ACCOUNT_NOT_READY', '先查询 status，等待游戏建号成功后读取角色资料');
    const agent = (await this.game.roster()).find(row => row.playerUuid === context.client.expected_uuid && row.name === context.client.name);
    if (!agent || agent.isReserved || agent.identityConflict || !this.store.ownedUuids(context.owner.id).includes(agent.playerUuid)) throw fail(409, 'AGENT_IDENTITY_UNCONFIRMED', '原角色身份或归属尚未确认，请查询 status 或联系主人');
    return this.game.playerState(agent);
  }
  logout(context) { this.store.db.prepare('UPDATE agent_access_sessions SET revoked_at=? WHERE id_hash=?').run(Date.now(), context.client.session_hash); return { ok: true }; }
}
