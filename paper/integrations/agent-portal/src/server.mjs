import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Store, digest, newSecret, hashPassword, verifyPassword } from './store.mjs';
import { GameData, UUID } from './game-data.mjs';
import { WorldCatalog, playerNameValid } from './world-catalog.mjs';
import { Live } from './live.mjs';
import { requestOrigin, rateAddress } from './request-origin.mjs';
import { GameAccounts } from './game-accounts.mjs';
import { CloudSource, CloudGame, CloudWorld } from './cloud-source.mjs';
import { Gallery, MAX_PHOTO_BYTES } from './gallery.mjs';
import { publicMedia, servePublicMedia } from './public-media.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
const sessionName = 'qd_portal_session';
const sameSecret = (a, b) => typeof a === 'string' && typeof b === 'string' && /^[A-Za-z0-9_-]{43}$/.test(a) && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const usernameValid = name => typeof name === 'string' && /^[\p{L}\p{N}_-]{3,24}$/u.test(name);
const passwordValid = value => typeof value === 'string' && value.length >= 6 && value.length <= 128;

async function jsonBody(req, maximum = 16 * 1024) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'JSON_REQUIRED', '请使用 JSON 请求');
  if (Number(req.headers['content-length']) > maximum) throw fail(413, 'BODY_TOO_LARGE', '请求内容过大');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maximum) throw fail(413, 'BODY_TOO_LARGE', '请求内容过大');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw fail(400, 'INVALID_JSON', '请求格式不正确'); }
}

export function createPortal(config, options = {}) {
  const store = options.store || new Store(config.dataDir);
  const cloud = config.sourceMode === 'cloud' ? new CloudSource(config, store) : null;
  const game = options.game || (cloud ? new CloudGame(config, store, cloud) : new GameData(config, store.salt));
  const world = options.world || (cloud ? new CloudWorld(config, game, store, cloud) : new WorldCatalog(config, game, store));
  const live = new Live(config, store);
  const gallery = new Gallery(store, cloud);
  const accounts = new GameAccounts(config, store, game);
  const limits = new Map();
  function rate(key, max = 20, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    for (const [candidate, entry] of limits) if (entry.until <= now) limits.delete(candidate);
    const entry = limits.get(key) || { count: 0, until: now + windowMs };
    entry.count++; limits.set(key, entry);
    if (entry.count > max || limits.size > 5000) throw fail(429, 'RATE_LIMIT', '操作较频繁，请稍后再试');
  }
  const respond = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  function cookie(req, res, token, authenticated = false) {
    res.setHeader('Set-Cookie', `${sessionName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${authenticated ? 604800 : 3600}${req.portalOrigin?.secure ? '; Secure' : ''}`);
  }
  function sessionFrom(req) {
    const values = (req.headers.cookie || '').split(';').map(part => part.trim().split('='));
    const token = values.find(([name]) => name === sessionName)?.[1];
    return store.getSession(token);
  }
  function device(req) { return /Android|iPhone|iPad|Mobile/i.test(req.headers['user-agent'] || '') ? '移动设备浏览器' : '电脑浏览器'; }
  function newSession(req, res, ownerId) {
    const existing = sessionFrom(req); if (existing) store.deleteSession(existing.id_hash);
    const created = store.createSession(ownerId, device(req)); cookie(req, res, created.token, !!ownerId);
    return created.session;
  }
  function sessionData(session) {
    return { owner: store.ownerPublic(session?.owner_id ? store.ownerById(session.owner_id) : null), csrfToken: session?.csrf || null, allowRegistration: config.allowRegistration };
  }
  function auth(req, scopes = []) {
    const bearer = req.headers.authorization;
    if (bearer) {
      const match = /^Bearer (pat_[A-Za-z0-9_-]{43})$/.exec(bearer);
      if (!match) throw fail(401, 'INVALID_CREDENTIAL', '客户端凭据无效或已撤销');
      const credential = store.db.prepare('SELECT * FROM credentials WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(digest(match[1]), Date.now());
      if (!credential) throw fail(401, 'INVALID_CREDENTIAL', '客户端凭据无效或已撤销');
      if (scopes.some(scope => !JSON.parse(credential.scopes).includes(scope))) throw fail(403, 'SCOPE_REQUIRED', '客户端没有此项权限');
      return { owner: store.ownerById(credential.owner_id), credential, session: null };
    }
    const session = sessionFrom(req);
    const owner = session?.owner_id ? store.ownerById(session.owner_id) : null;
    if (!owner) throw fail(401, 'LOGIN_REQUIRED', '登录后查看你的角色资料');
    return { session, owner, credential: null };
  }
  function browserAuth(req, admin = false, recent = false) {
    if (req.headers.authorization) throw fail(403, 'BROWSER_SESSION_REQUIRED', '请使用网站账号完成此操作');
    const context = auth(req);
    if (admin && context.owner.role !== 'admin') throw fail(403, 'ADMIN_REQUIRED', '此操作需要网站管理员权限');
    if (recent && Date.now() - context.session.verified_at > 10 * 60 * 1000) throw fail(403, 'REAUTH_REQUIRED', '请重新验证网站密码后继续');
    return context;
  }
  async function authorizedAgent(req, id, scopes = ['state.read']) {
    const context = auth(req, scopes);
    const agent = (await game.roster()).find(row => row.id === id);
    if (!agent || !agent.playerUuid) throw fail(404, 'AGENT_NOT_FOUND', '未找到可访问的角色');
    const allowed = context.credential ? context.credential.agent_uuid === agent.playerUuid
      : context.owner.role === 'admin' || store.ownedUuids(context.owner.id).includes(agent.playerUuid);
    if (!allowed) throw fail(404, 'AGENT_NOT_FOUND', '未找到可访问的角色');
    return { ...context, agent };
  }
  function csrf(req) {
    const current = sessionFrom(req);
    if (!current || !sameSecret(req.headers['x-csrf-token'], current.csrf)) throw fail(403, 'CSRF_REQUIRED', '会话已更新，请刷新页面后继续');
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const port = server.address()?.port || config.port;
      req.portalOrigin = requestOrigin(req, config, port);
      if (req.portalOrigin.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      const url = new URL(req.url, req.portalOrigin.origin);
      const pathname = url.pathname;
      if (pathname.startsWith('/api/')) rate('api:' + digest(rateAddress(req, config)), 300, 60000);
      if (req.method === 'PUT' && pathname === '/api/v1/internal/snapshot') {
        if (!cloud) throw fail(404, 'NOT_FOUND', '未开放此接口');
        if (req.headers.origin) throw fail(403, 'SYNC_CLIENT_REQUIRED', '请从家庭端同步器上传资料');
        cloud.authorize(req); rate('snapshot-sync', 12, 60000);
        return respond(res, 200, cloud.accept(await jsonBody(req, config.cloudSync.maxBytes)));
      }
      const photoUpload = /^\/api\/v1\/internal\/photos\/([a-f0-9-]{36})$/.exec(pathname);
      if (photoUpload && req.method === 'PUT') {
        if (!cloud) throw fail(404, 'NOT_FOUND', '未开放此接口');
        if (req.headers.origin) throw fail(403, 'SYNC_CLIENT_REQUIRED', '请从家庭端同步器上传照片');
        cloud.authorize(req); rate('photo-sync', 60, 60000);
        if (req.headers['content-type'] !== 'image/png') throw fail(415, 'PHOTO_FORMAT', '请上传 PNG 照片');
        let length = 0; const chunks = [];
        for await (const chunk of req) { length += chunk.length; if (length > MAX_PHOTO_BYTES) throw fail(413, 'PHOTO_SIZE', '照片文件过大'); chunks.push(chunk); }
        return respond(res, 200, gallery.accept(photoUpload[1], Buffer.concat(chunks)));
      }
      const ingest = /^\/api\/v1\/live\/([a-f0-9-]{36})\/(open|frame)$/.exec(pathname);
      if (ingest && (req.method === 'POST' && ingest[2] === 'open' || req.method === 'PUT' && ingest[2] === 'frame')) {
        // Only this narrow binary ingress accepts publisher credentials instead
        // of browser CSRF. It has no RCON, URL-fetch or gameplay capability.
        if (req.headers.origin) throw fail(403, 'PUBLISHER_CLIENT_REQUIRED', '请从受信任的画面发布器发送画面');
        live.publisher(req, ingest[1]);
        return respond(res, 200, ingest[2] === 'open' ? live.open(ingest[1]) : await live.publish(req, ingest[1]));
      }
      const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (isWrite) {
        const origin = req.headers.origin;
        if (origin !== req.portalOrigin.origin) throw fail(403, 'INVALID_ORIGIN', '请求来源不受支持');
        csrf(req);
        rate('write:' + digest(rateAddress(req, config)), 80, 60000);
      }
      if (req.method === 'OPTIONS') { res.writeHead(405); return res.end(); }
      if (pathname.startsWith('/media/') && await servePublicMedia(req, res, pathname, config)) return;
      if (req.method === 'GET' && pathname === '/api/v1/health') return respond(res, 200, { ok: true, schemaVersion: 1, version: '0.4.2' });
      if (req.method === 'GET' && pathname === '/api/v1/gallery') return respond(res, 200, { photos: gallery.list(), source: 'published-game-photography' });
      const photoImage = /^\/api\/v1\/gallery\/([a-f0-9-]{36})\/image$/.exec(pathname);
      if (photoImage && req.method === 'GET') {
        const image = gallery.image(photoImage[1]);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.bytes.length, ETag: `"${image.sha256}"`, 'Cache-Control': 'public, max-age=86400' }); return res.end(image.bytes);
      }
      if (req.method === 'GET' && pathname === '/api/v1/site') return respond(res, 200, { name: config.siteName, gameAddress: config.publicGameAddress, registration: config.allowRegistration, publicOrigin: config.publicOrigin || null, media: publicMedia(config) });
      if (req.method === 'GET' && pathname === '/api/v1/game-capabilities') return respond(res, 200, await accounts.capabilities());
      if (req.method === 'GET' && pathname === '/api/v1/server') return respond(res, 200, await game.serverSummary());
      if (req.method === 'GET' && pathname === '/api/v1/roster') return respond(res, 200, { agents: (await game.roster()).map(row => game.publicAgent(row)) });
      if (req.method === 'GET' && pathname === '/api/v1/world/players') return respond(res, 200, await world.players());
      if (req.method === 'GET' && pathname === '/api/v1/world/events') return respond(res, 200, await world.events({ kind: url.searchParams.get('kind') || 'all', page: Number(url.searchParams.get('page') || 1), limit: Number(url.searchParams.get('limit') || 20) }));
      if (req.method === 'GET' && pathname === '/api/v1/live') {
        const session = sessionFrom(req), owner = session?.owner_id ? store.ownerById(session.owner_id) : null;
        const channels = live.list(owner);
        return respond(res, 200, { channels, defaultChannelId: channels.find(row => row.isOwn)?.id || channels.find(row => row.available)?.id || channels[0]?.id || null, mode: 'canvas-only', frameIntervalMs: 1000 });
      }
      if (ingest && req.method === 'GET' && ingest[2] === 'frame') {
        const channel = live.channel(ingest[1]);
        if (!channel) throw fail(404, 'CHANNEL_NOT_FOUND', '直播频道不存在');
        if (channel.visibility !== 'public') {
          const { owner } = browserAuth(req);
          if (owner.role !== 'admin' && !store.ownedUuids(owner.id).includes(channel.player_uuid)) throw fail(404, 'CHANNEL_NOT_FOUND', '直播频道不存在或尚未授权给你');
        }
        const frame = live.read(ingest[1]);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': frame.bytes.length, 'X-Frame-Sequence': String(frame.seq), 'X-Frame-At': new Date(frame.at).toISOString() });
        return res.end(frame.bytes);
      }
      if (req.method === 'GET' && pathname === '/api/v1/session') {
        if (!sessionFrom(req)) rate('new-session:' + digest(rateAddress(req, config)), 30);
        const session = sessionFrom(req) || newSession(req, res, null);
        return respond(res, 200, { ...sessionData(session), canSetup: store.countOwners() === 0 && req.portalOrigin.canSetup });
      }
      if (req.method === 'POST' && ['/api/v1/accounts', '/api/v1/setup'].includes(pathname)) {
        rate('signup:' + digest(rateAddress(req, config)), 8);
        const setup = pathname === '/api/v1/setup';
        if (setup && (!req.portalOrigin.canSetup || store.countOwners() !== 0)) throw fail(403, 'SETUP_UNAVAILABLE', '管理员初始化已完成或需要在服务器本机进行');
        if (!setup && store.countOwners() === 0) throw fail(409, 'ADMIN_SETUP_REQUIRED', '请先在服务器本机初始化网站管理员');
        if (!setup && !config.allowRegistration) throw fail(403, 'REGISTRATION_CLOSED', '网站注册暂未开放');
        const body = await jsonBody(req);
        if (!usernameValid(body.username)) throw fail(400, 'INVALID_USERNAME', '用户名需为 3–24 个文字、数字、下划线或短横线');
        if (!passwordValid(body.password)) throw fail(400, 'INVALID_PASSWORD', '网站密码需为 6–128 个字符');
        if (store.ownerByName(body.username)) throw fail(409, 'USERNAME_TAKEN', '此网站用户名已被使用');
        let owner;
        try { owner = store.createOwner(body.username, await hashPassword(body.password), setup ? 'admin' : 'owner', setup); }
        catch (error) { if (error.message === 'SETUP_COMPLETE' || (error.errcode & 255) === 19) throw fail(409, 'ACCOUNT_CONFLICT', '账号已存在或初始化已经完成'); throw error; }
        const session = newSession(req, res, owner.id);
        store.audit(owner.id, setup ? 'account.setup' : 'account.register', owner.id);
        return respond(res, 201, sessionData(session));
      }
      if (req.method === 'POST' && pathname === '/api/v1/sessions') {
        const body = await jsonBody(req);
        rate('login:' + digest(rateAddress(req, config) + ':' + String(body.username).toLowerCase()), 12);
        rate('login-global:' + digest(rateAddress(req, config)), 40);
        if (!usernameValid(body.username) || typeof body.password !== 'string' || body.password.length > 128) throw fail(401, 'LOGIN_FAILED', '网站用户名或密码不正确');
        const owner = store.ownerByName(body.username);
        const valid = await verifyPassword(body.password, owner?.password_hash);
        if (!owner || !valid) throw fail(401, 'LOGIN_FAILED', '网站用户名或密码不正确');
        const session = newSession(req, res, owner.id); store.audit(owner.id, 'session.login', owner.id);
        return respond(res, 200, sessionData(session));
      }
      if (req.method === 'DELETE' && pathname === '/api/v1/session') {
        const current = sessionFrom(req);
        if (current?.owner_id) store.audit(current.owner_id, 'session.logout', current.owner_id);
        return respond(res, 200, sessionData(newSession(req, res, null)));
      }
      if (req.method === 'GET' && pathname === '/api/v1/agents') {
        const context = auth(req, ['state.read']);
        const roster = await game.roster();
        const owned = store.ownedUuids(context.owner.id);
        const agents = roster.filter(row => context.credential ? row.playerUuid === context.credential.agent_uuid : context.owner.role === 'admin' || owned.includes(row.playerUuid));
        return respond(res, 200, { agents, access: context.owner.role === 'admin' && !context.credential ? 'admin' : 'owner' });
      }
      const stateMatch = /^\/api\/v1\/agents\/([a-f0-9]{24})\/state$/.exec(pathname);
      if (req.method === 'GET' && stateMatch) {
        const context = await authorizedAgent(req, stateMatch[1]);
        const state = await game.playerState(context.agent);
        if (context.credential && !JSON.parse(context.credential.scopes).includes('inventory.read')) delete state.inventory;
        return respond(res, 200, state);
      }
      const configMatch = /^\/api\/v1\/agents\/([a-f0-9]{24})\/connection-config$/.exec(pathname);
      if (req.method === 'GET' && configMatch) {
        browserAuth(req);
        const { agent } = await authorizedAgent(req, configMatch[1]);
        return respond(res, 200, { schemaVersion: 1, portal: req.portalOrigin.origin, agentId: agent.id, playerUuid: agent.playerUuid,
          username: agent.name, credentialEnv: 'QD_PORTAL_CLIENT_TOKEN', gamePasswordEnv: 'MC_GAME_PASSWORD', readOnly: true });
      }
      if (req.method === 'GET' && pathname === '/api/v1/account') {
        const { owner, session } = browserAuth(req);
        const sessions = store.db.prepare('SELECT id_hash,created_at,expires_at,device FROM sessions WHERE owner_id=? ORDER BY created_at DESC').all(owner.id)
          .map(row => ({ id: row.id_hash, current: row.id_hash === session.id_hash, device: row.device, createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() }));
        return respond(res, 200, { owner: store.ownerPublic(owner), sessions, events: store.events(owner) });
      }
      if (req.method === 'POST' && pathname === '/api/v1/account/reauth') {
        const { owner, session } = browserAuth(req);
        rate('reauth:' + owner.id, 8);
        const body = await jsonBody(req);
        if (typeof body.password !== 'string' || body.password.length > 128 || !await verifyPassword(body.password, owner.password_hash)) throw fail(401, 'PASSWORD_INCORRECT', '当前网站密码不正确');
        store.db.prepare('UPDATE sessions SET verified_at=? WHERE id_hash=?').run(Date.now(), session.id_hash);
        return respond(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/v1/account/password') {
        const { owner, session } = browserAuth(req); rate('password:' + owner.id, 6);
        const body = await jsonBody(req);
        if (!passwordValid(body.newPassword)) throw fail(400, 'INVALID_PASSWORD', '新网站密码需为 6–128 个字符');
        if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 128 || !await verifyPassword(body.currentPassword, owner.password_hash)) throw fail(401, 'PASSWORD_INCORRECT', '当前网站密码不正确');
        store.db.prepare('UPDATE owners SET password_hash=? WHERE id=?').run(await hashPassword(body.newPassword), owner.id);
        store.revokeOtherSessions(owner.id, session.id_hash);
        store.db.prepare('UPDATE credentials SET revoked_at=? WHERE owner_id=? AND revoked_at IS NULL').run(Date.now(), owner.id);
        store.audit(owner.id, 'account.password', owner.id);
        return respond(res, 200, sessionData(newSession(req, res, owner.id)));
      }
      const revokeSession = /^\/api\/v1\/sessions\/([a-f0-9]{64})$/.exec(pathname);
      if (req.method === 'DELETE' && revokeSession) {
        const { owner, session } = browserAuth(req);
        if (session.id_hash === revokeSession[1]) throw fail(400, 'USE_LOGOUT', '请通过退出登录结束当前会话');
        store.db.prepare('DELETE FROM sessions WHERE id_hash=? AND owner_id=?').run(revokeSession[1], owner.id);
        store.audit(owner.id, 'session.revoke', null); return respond(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/v1/client-credentials') {
        const { owner } = browserAuth(req);
        const credentials = store.db.prepare('SELECT id,agent_uuid,label,scopes,created_at,expires_at,revoked_at FROM credentials WHERE owner_id=? ORDER BY created_at DESC').all(owner.id);
        return respond(res, 200, { credentials: credentials.map(row => ({ id: row.id, playerUuid: row.agent_uuid, label: row.label, scopes: JSON.parse(row.scopes), createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), revoked: row.revoked_at !== null })) });
      }
      if (req.method === 'POST' && pathname === '/api/v1/client-credentials') {
        const { owner } = browserAuth(req, false, true); const body = await jsonBody(req);
        const { agent } = await authorizedAgent(req, body.agentId);
        if (typeof body.label !== 'string' || body.label.trim().length < 1 || body.label.length > 60) throw fail(400, 'INVALID_LABEL', '请输入 1–60 字的客户端名称');
        const scopes = body.scopes || ['state.read'];
        if (!Array.isArray(scopes) || !scopes.includes('state.read') || scopes.some(value => !['state.read', 'inventory.read'].includes(value))) throw fail(400, 'INVALID_SCOPES', '首期客户端仅开放状态和背包读取权限');
        const days = Number(body.expiresInDays || 30);
        if (!Number.isInteger(days) || days < 1 || days > 90) throw fail(400, 'INVALID_EXPIRY', '有效期需为 1–90 天');
        const token = 'pat_' + newSecret(); const id = randomUUID(); const now = Date.now();
        store.db.prepare('INSERT INTO credentials VALUES(?,?,?,?,?,?,?,?,NULL)').run(id, owner.id, agent.playerUuid, body.label.trim(), digest(token), JSON.stringify([...new Set(scopes)]), now, now + days * 86400000);
        store.audit(owner.id, 'credential.create', agent.id);
        return respond(res, 201, { id, token, expiresAt: new Date(now + days * 86400000).toISOString(), warning: '仅供本人配置可信本地客户端，原始凭据不进入对话或 LLM 上下文' });
      }
      const revokeCredential = /^\/api\/v1\/client-credentials\/([a-f0-9-]{36})$/.exec(pathname);
      if (req.method === 'DELETE' && revokeCredential) {
        const { owner } = browserAuth(req);
        store.db.prepare('UPDATE credentials SET revoked_at=? WHERE id=? AND owner_id=?').run(Date.now(), revokeCredential[1], owner.id);
        store.audit(owner.id, 'credential.revoke', revokeCredential[1]); return respond(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/v1/admin/owners') {
        browserAuth(req, true);
        return respond(res, 200, { owners: store.db.prepare('SELECT id,username,role,created_at FROM owners ORDER BY created_at').all().map(row => store.ownerPublic(row)) });
      }
      if (req.method === 'POST' && pathname === '/api/v1/admin/notices') {
        const { owner } = browserAuth(req, true, true); const body = await jsonBody(req);
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 100 || typeof body.body !== 'string' || !body.body.trim() || body.body.length > 2000) throw fail(400, 'INVALID_NOTICE', '公告需要 1–100 字标题和 1–2000 字正文');
        world.insert({ kind: 'notice', title: body.title.trim(), body: body.body.trim(), occurredAt: Date.now(), precision: 'second', source: 'portal.notice' }, randomUUID());
        store.audit(owner.id, 'notice.publish'); return respond(res, 201, { ok: true });
      }
      if (req.method === 'POST' && ['/api/v1/admin/live-channels', '/api/v1/live-channels'].includes(pathname)) {
        const { owner } = browserAuth(req, pathname.startsWith('/api/v1/admin/'), true); const body = await jsonBody(req);
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 80 || !playerNameValid(body.playerName) || !['public', 'owner'].includes(body.visibility)) throw fail(400, 'INVALID_CHANNEL', '请输入直播标题、实际角色名和观看范围');
        const player = (await game.roster()).find(row => row.name.toLowerCase() === body.playerName.toLowerCase());
        if (!player?.available) throw fail(400, 'PLAYER_NOT_FOUND', '此角色的原身份尚未核实，请先确认角色目录');
        if (owner.role !== 'admin' && !store.ownedUuids(owner.id).includes(player.playerUuid)) throw fail(404, 'AGENT_NOT_FOUND', '只能为自己已绑定的角色接入直播');
        const result = live.create({ title: body.title.trim(), playerName: player.name, playerUuid: player.playerUuid, visibility: body.visibility });
        store.audit(owner.id, 'live.create', result.id); return respond(res, 201, result);
      }
      const liveAdmin = /^\/api\/v1\/(?:admin\/)?live-channels\/([a-f0-9-]{36})(\/publisher)?$/.exec(pathname);
      if (liveAdmin && req.method === 'POST' && liveAdmin[2]) {
        const { owner } = browserAuth(req, pathname.startsWith('/api/v1/admin/'), true);
        const channel = live.channel(liveAdmin[1]);
        if (owner.role !== 'admin' && (!channel || !store.ownedUuids(owner.id).includes(channel.player_uuid))) throw fail(404, 'CHANNEL_NOT_FOUND', '频道不存在或不属于你的角色');
        const result = live.rotate(liveAdmin[1]);
        store.audit(owner.id, 'live.rotate', liveAdmin[1]); return respond(res, 200, result);
      }
      if (liveAdmin && req.method === 'DELETE' && !liveAdmin[2]) {
        const { owner } = browserAuth(req, pathname.startsWith('/api/v1/admin/'), true);
        const channel = live.channel(liveAdmin[1]);
        if (owner.role !== 'admin' && (!channel || !store.ownedUuids(owner.id).includes(channel.player_uuid))) throw fail(404, 'CHANNEL_NOT_FOUND', '频道不存在或不属于你的角色');
        store.db.prepare('DELETE FROM live_channels WHERE id=?').run(liveAdmin[1]); live.frames.delete(liveAdmin[1]);
        store.audit(owner.id, 'live.delete', liveAdmin[1]); return respond(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/v1/admin/bindings') {
        const { owner } = browserAuth(req, true, true); const body = await jsonBody(req);
        const targetOwner = store.ownerById(body.ownerId);
        const agent = (await game.roster()).find(row => row.id === body.agentId);
        if (!targetOwner || !agent?.playerUuid || !UUID.test(agent.playerUuid)) throw fail(400, 'INVALID_BINDING', '请选择有效网站账号和原角色');
        if (agent.isReserved || agent.identityConflict) throw fail(403, 'RESERVED_ACCOUNT', '管理身份与观战账号不支持普通角色绑定');
        if (body.confirmedOwnership !== true || typeof body.proof !== 'string' || body.proof.trim().length < 10 || body.proof.length > 300) throw fail(400, 'PROOF_REQUIRED', '请先独立核验原主人，并填写至少 10 字的核验依据');
        try { store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(targetOwner.id, agent.playerUuid, body.proof.trim(), Date.now()); }
        catch (error) { if ((error.errcode & 255) === 19) throw fail(409, 'ALREADY_OWNED', '该角色已绑定网站账号，请核对原归属'); throw error; }
        store.audit(owner.id, 'ownership.bind', agent.id); return respond(res, 201, { ok: true });
      }
      if (req.method === 'POST' && ['/api/v1/agents', '/api/v1/agent-claims'].includes(pathname)) {
        const { owner } = browserAuth(req, false, true); rate('game-account:' + owner.id, 6);
        const body = await jsonBody(req);
        return respond(res, 202, await accounts.start(owner, pathname.endsWith('agent-claims') ? 'claim' : 'create', body));
      }
      if (req.method === 'POST' && pathname === '/api/v1/game-password') {
        const { owner } = browserAuth(req, false, true); rate('game-password:' + owner.id, 4);
        return respond(res, 202, await accounts.start(owner, 'password', await jsonBody(req)));
      }
      const accountJob = /^\/api\/v1\/jobs\/([a-f0-9-]{36})$/.exec(pathname);
      if (req.method === 'GET' && accountJob) {
        const { owner } = browserAuth(req);
        return respond(res, 200, await accounts.job(owner, accountJob[1]));
      }
      if (pathname.startsWith('/api/')) throw fail(404, 'NOT_FOUND', '未找到此接口');
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方法');
      let decoded;
      try { decoded = decodeURIComponent(pathname); } catch { throw fail(400, 'INVALID_PATH', '路径无效'); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '..' || part.startsWith('.'))) throw fail(404, 'NOT_FOUND', '未找到此页面');
      const filePath = path.resolve(config.publicDir, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!filePath.startsWith(path.resolve(config.publicDir) + path.sep)) throw fail(404, 'NOT_FOUND', '未找到此页面');
      let file;
      try {
        const real = await fs.realpath(filePath);
        if (!real.startsWith(path.resolve(config.publicDir) + path.sep)) throw new Error();
        file = await fs.readFile(real);
      } catch { throw fail(404, 'NOT_FOUND', '未找到此页面'); }
      res.setHeader('Cache-Control', /\.(png|jpg|svg|ico)$/.test(filePath) ? 'public, max-age=3600' : 'no-cache');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Content-Length': file.length });
      return res.end(req.method === 'HEAD' ? undefined : file);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error.status || 500;
      if (status === 500) console.error('Portal request failed:', error.code || error.name);
      return respond(res, status, { error: { reason: error.reason || 'INTERNAL_ERROR', message: status === 500 ? '服务暂时无法完成请求，请稍后重试' : error.message,
        ...(Number.isSafeInteger(error.currentSequence) ? { currentSequence: error.currentSequence } : {}) } });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.maxConnections = 128; server.maxRequestsPerSocket = 300;
  const cleanup = setInterval(() => store.cleanup(), 60000); cleanup.unref();
  return { server, store, game, world, live, accounts, cloud, gallery, close: async () => { clearInterval(cleanup); await new Promise(resolve => server.close(resolve)); store.close(); } };
}
