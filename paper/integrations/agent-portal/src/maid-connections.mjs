import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { digest } from './store.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const requestLifetime = 10 * 60_000;
const grantLifetime = 24 * 60 * 60_000;
const codePattern = /^[0-9A-F]{6}$/;
const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });

export function validateMaidConnections(settings, publicOrigin) {
  if (typeof settings.enabled !== 'boolean' || !Array.isArray(settings.bindings) || settings.bindings.length > 24) {
    throw new Error('Invalid maid connection settings');
  }
  for (const row of settings.bindings) {
    if (!row || typeof row.ownerId !== 'string' || !uuid.test(row.ownerId)
        || typeof row.maidId !== 'string' || !uuid.test(row.maidId) || typeof row.name !== 'string'
        || !row.name.trim() || row.name.length > 64 || /[\u0000-\u001f\u007f]/.test(row.name)) {
      throw new Error('Invalid registered maid binding');
    }
  }
  if (new Set(settings.bindings.map(row => row.maidId)).size !== settings.bindings.length) {
    throw new Error('Duplicate registered maid binding');
  }
  if (settings.enabled) {
    if (!publicOrigin || typeof settings.bodyEndpoint !== 'string') throw new Error('Maid connections require HTTPS');
    const endpoint = new URL(settings.bodyEndpoint);
    if (endpoint.protocol !== 'https:' || endpoint.href !== settings.bodyEndpoint || endpoint.username
        || endpoint.password || endpoint.pathname !== '/api/v1/maid-body' || /[?#]/.test(endpoint.href)) {
      throw new Error('Maid connections require an exact HTTPS maid-body endpoint');
    }
  }
}

export class MaidConnections {
  constructor(config, store, now = Date.now) {
    this.config = config.maidConnections;
    this.origin = config.publicOrigin;
    this.store = store;
    this.now = now;
    this.bindings = new Map(this.config.bindings.map(row => [row.maidId, row]));
    store.db.exec(`CREATE TABLE IF NOT EXISTS maid_connections(
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, confirmation TEXT NOT NULL,
      owner_id TEXT REFERENCES owners(id) ON DELETE CASCADE,
      session_hash TEXT REFERENCES sessions(id_hash) ON DELETE CASCADE,
      owner_uuid TEXT, maid_uuid TEXT, ownership_created_at INTEGER, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS maid_connections_owner ON maid_connections(owner_id, expires_at);`);
  }

  start(body) {
    if (typeof body.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.tokenHash)) {
      throw fail(400, 'INVALID_DEVICE_REQUEST', '请在 N.E.K.O. 中重新发起连接');
    }
    const { db } = this.store;
    const now = this.now();
    const row = this.store.transaction(() => {
      db.prepare('DELETE FROM maid_connections WHERE expires_at<=?').run(now);
      const previous = db.prepare('SELECT * FROM maid_connections WHERE token_hash=?').get(body.tokenHash);
      if (previous?.owner_id) throw fail(409, 'REQUEST_ALREADY_APPROVED', '请重新发起连接');
      if (previous) return previous;
      if (db.prepare('SELECT count(*) AS total FROM maid_connections WHERE owner_id IS NULL').get().total >= 2000) {
        throw fail(429, 'TOO_MANY_PENDING_CONNECTIONS', '待确认的连接较多，请稍后再试');
      }
      const request = { id: randomUUID(), confirmation: randomBytes(3).toString('hex').toUpperCase(),
        expires_at: now + requestLifetime };
      db.prepare('INSERT INTO maid_connections(id,token_hash,confirmation,expires_at) VALUES(?,?,?,?)')
        .run(request.id, body.tokenHash, request.confirmation, request.expires_at);
      return request;
    });
    return {
      verificationUrl: this.origin + '/maid-connect.html#request=' + row.id,
      confirmationCode: row.confirmation,
      expiresAt: row.expires_at,
      pollSeconds: 3,
    };
  }

  available(ownerId) {
    const owned = new Set(this.store.ownedUuids(ownerId));
    return [...this.bindings.values()].filter(row => owned.has(row.ownerId));
  }

  pending(id) {
    const row = this.store.db.prepare('SELECT * FROM maid_connections WHERE id=? AND owner_id IS NULL AND expires_at>?')
      .get(id, this.now());
    if (!row) throw fail(404, 'CONNECTION_NOT_FOUND', '此连接已确认或过期，请在 N.E.K.O. 重新连接');
    return row;
  }

  preview(id, owner) {
    const request = this.pending(id);
    return { expiresAt: request.expires_at, maids: this.available(owner.id).map(row => ({ id: row.maidId, name: row.name })) };
  }

  approve(id, { owner, session }, body) {
    const { db } = this.store;
    return this.store.transaction(() => {
      const now = this.now();
      const row = this.pending(id);
      const current = db.prepare('SELECT expires_at FROM sessions WHERE id_hash=? AND owner_id=? AND expires_at>?')
        .get(session.id_hash, owner.id, now);
      if (!current) throw fail(401, 'LOGIN_REQUIRED', '请重新登录千灯纪官网');
      if (typeof body.confirmationCode !== 'string' || !codePattern.test(body.confirmationCode)
          || !timingSafeEqual(Buffer.from(body.confirmationCode), Buffer.from(row.confirmation))) {
        throw fail(403, 'CONFIRMATION_MISMATCH', '请输入桌面插件显示的连接码');
      }
      const maid = this.available(owner.id).find(choice => choice.maidId === body.maidId);
      if (!maid) throw fail(404, 'MAID_NOT_OWNED', '请选择自己已登记的女仆');
      const ownership = db.prepare('SELECT created_at FROM ownerships WHERE owner_id=? AND agent_uuid=?')
        .get(owner.id, maid.ownerId);
      const expiresAt = Math.min(current.expires_at, now + grantLifetime);
      db.prepare(`UPDATE maid_connections SET owner_id=?, session_hash=?, owner_uuid=?, maid_uuid=?,
        ownership_created_at=?, expires_at=?, confirmation='' WHERE id=?`)
        .run(owner.id, session.id_hash, maid.ownerId, maid.maidId, ownership.created_at, expiresAt, id);
      this.store.audit(owner.id, 'maid.connection.approved', id);
      return { name: maid.name, expiresAt };
    });
  }

  check(authorization) {
    const token = /^Bearer (mdw_[A-Za-z0-9_-]{43})$/.exec(authorization || '')?.[1];
    const expired = () => fail(401, 'MAID_CONNECTION_DENIED', '女仆连接凭据无效或已失效');
    if (!token) throw expired();
    const now = this.now();
    const { db } = this.store;
    const row = db.prepare('SELECT * FROM maid_connections WHERE token_hash=? AND expires_at>?').get(digest(token), now);
    if (!row) throw expired();
    if (!row.owner_id) return { status: 202, data: { state: 'pending' } };
    const sameMaid = this.bindings.get(row.maid_uuid)?.ownerId === row.owner_uuid;
    const active = db.prepare(`SELECT 1 FROM sessions s JOIN ownerships o ON o.owner_id=s.owner_id
      WHERE s.id_hash=? AND s.owner_id=? AND s.expires_at>? AND o.agent_uuid=? AND o.created_at=?`)
      .get(row.session_hash, row.owner_id, now, row.owner_uuid, row.ownership_created_at);
    if (!sameMaid || !active) throw expired();
    return { status: 200, data: {
      state: 'approved', ownerId: row.owner_uuid, maidId: row.maid_uuid, bodyEndpoint: this.config.bodyEndpoint,
      expiresAt: row.expires_at,
    } };
  }

  list(owner) {
    const connections = this.store.db.prepare(`SELECT id, maid_uuid, expires_at FROM maid_connections
      WHERE owner_id=? AND expires_at>? ORDER BY expires_at DESC`).all(owner.id, this.now());
    return { connections: connections.map(row => ({
      id: row.id, name: this.bindings.get(row.maid_uuid)?.name || '女仆', expiresAt: row.expires_at,
    })) };
  }

  revoke(id, owner) {
    this.store.transaction(() => {
      const deleted = this.store.db.prepare('DELETE FROM maid_connections WHERE id=? AND owner_id=?').run(id, owner.id);
      if (!deleted.changes) throw fail(404, 'CONNECTION_NOT_FOUND', '未找到你的这次连接');
      this.store.audit(owner.id, 'maid.connection.revoked', id);
    });
    return { revoked: true };
  }
}

const route = '/api/v1/maid-connect';

export async function maidConnectionRoute({ req, res, pathname, connections, browserAuth, csrf, jsonBody, respond, rate, address }) {
  if (pathname !== route && !pathname.startsWith(route + '/')) return false;
  if (!connections.config.enabled) throw fail(404, 'NOT_FOUND', '女仆官网连接暂未开放');
  if (!req.portalOrigin.secure || req.portalOrigin.origin !== connections.origin) {
    throw fail(403, 'MAID_CONNECT_HTTPS_REQUIRED', '请使用千灯纪官网的 HTTPS 连接页');
  }
  const tail = pathname.slice(route.length);
  if (req.method === 'GET' && tail === '/trial') {
    // Released desktop clients use the same confirmation URL for both issuers.
    respond(res, 200, { active: false, mode: 'owner' });
    return true;
  }
  if (req.method === 'POST' && (tail === '/request' || tail === '/check')) {
    if (req.headers.origin || req.headers.cookie) throw fail(403, 'DESKTOP_REQUIRED', '请在 N.E.K.O. 中发起连接');
    if (tail === '/request') {
      rate('maid-connect-start:' + address(), 12, 60_000);
      respond(res, 201, connections.start(await jsonBody(req, 1024)));
    } else {
      const checked = connections.check(req.headers.authorization);
      respond(res, checked.status, checked.data);
    }
    return true;
  }
  const context = browserAuth(req);
  const match = /^\/requests\/([a-f0-9-]{36})$/.exec(tail);
  const revoke = /^\/([a-f0-9-]{36})$/.exec(tail);
  if (req.method === 'GET' && !tail) {
    respond(res, 200, connections.list(context.owner));
  } else if (req.method === 'GET' && match && uuid.test(match[1])) {
    respond(res, 200, connections.preview(match[1], context.owner));
  } else if ((req.method === 'POST' && match && uuid.test(match[1]))
           || (req.method === 'DELETE' && revoke && uuid.test(revoke[1]))) {
    if (req.headers.origin !== connections.origin) throw fail(403, 'INVALID_ORIGIN', '请从千灯纪官网确认授权');
    csrf(req);
    if (match) {
      rate('maid-connect-approve:' + address(), 20, 60_000);
      rate('maid-connect-request:' + match[1], 8, requestLifetime);
      respond(res, 200, connections.approve(match[1], context, await jsonBody(req, 1024)));
    } else {
      rate('maid-connect-revoke:' + context.owner.id, 20, 60_000);
      respond(res, 200, connections.revoke(revoke[1], context.owner));
    }
  } else {
    throw fail(404, 'NOT_FOUND', '未找到女仆连接操作');
  }
  return true;
}
