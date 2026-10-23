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
import {SavedChallenges,CloudChallenges} from './challenges.mjs';
import { CloudAccounts } from './cloud-accounts.mjs';
import { AgentProfiles, MAX_REFERENCE_BYTES } from './agent-profiles.mjs';
import { EmailAuth, normalizeEmail } from './email-auth.mjs';
import { agentClients } from './agent-clients.mjs';
import { agentSkill, serveAgentSkill, skillAt } from './agent-skill.mjs';
import { AgentAccess } from './agent-access.mjs';
import { agentOnboarding } from './agent-onboarding.mjs';
import { Appearance } from './appearance.mjs';
import { MAX_APPEARANCE_BYTES } from './appearance-files.mjs';
import { Memories } from './memories.mjs';
import { memoryRoute } from './memory-routes.mjs';

const portalVersion = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
const sessionName = 'qd_portal_session';
MIME['.mjs'] = 'text/javascript; charset=utf-8';
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
  const challenges = cloud ? new CloudChallenges(store,game) : new SavedChallenges(config,game,store);
  const live = new Live(config, store);
  const gallery = new Gallery(store, cloud);
  const accountCloud = cloud && config.cloudAccounts.enabled ? new CloudAccounts(config, store) : null;
  const accounts = new GameAccounts(config, store, game, accountCloud);
  const profiles = new AgentProfiles(store);
  const emailAuth = new EmailAuth(config, store, options.emailSender);
  const agentAccess = new AgentAccess(config, store, game, accounts);
  const appearance = new Appearance(config, store, game);
  const memories = new Memories(store);
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
    return { owner: store.ownerPublic(session?.owner_id ? store.ownerById(session.owner_id) : null), csrfToken: session?.csrf || null,
      allowRegistration: config.allowRegistration && (config.emailAuth.registrationMode !== 'email' || emailAuth.capabilities().available), emailAuth: emailAuth.capabilities() };
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
    if (agent.identityConflict) throw fail(409, 'IDENTITY_CONFLICT', '角色身份出现冲突，请联系服主核对原 UUID 后继续');
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
      if (pathname === '/join') {
        if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'METHOD_NOT_ALLOWED', '请打开接入网页');
        const bytes = await fs.readFile(path.join(config.publicDir, 'join.html'));
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': bytes.length });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      if (skillAt(pathname) && ['GET', 'HEAD'].includes(req.method)) {
        rate('skill-download:' + digest(rateAddress(req, config)), 12, 60000);
        await serveAgentSkill(req, res, config, skillAt(pathname)); return;
      }
      if (pathname.startsWith('/api/')) rate('api:' + digest(rateAddress(req, config)), 300, 60000);
      if (req.method === 'POST' && pathname === '/api/v1/internal/appearance/poll') {
        if (req.headers.origin || req.headers.cookie) throw fail(403, 'APPEARANCE_WORKER_REQUIRED', '请从家庭端外观同步器调用');
        appearance.authorize(req); rate('appearance-worker', 24, 60000);
        return respond(res, 200, await appearance.poll(await jsonBody(req, 32768)));
      }
      const signingSkin = /^\/appearance\/skins\/([a-f0-9]{64})\.png$/.exec(pathname);
      if (signingSkin && req.method === 'GET') {
        rate('skin-signing:' + digest(rateAddress(req, config)), 30, 60000);
        const bytes = appearance.signingImage(signingSkin[1]);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length }); return res.end(bytes);
      }
      if (req.method === 'GET' && pathname === '/api/v1/agent-access') return respond(res, 200, await agentAccess.capabilities());
      if (req.method === 'GET' && pathname === '/api/v1/agent-access/invitation') {
        if (req.headers.origin && req.headers.origin !== req.portalOrigin.origin) throw fail(403, 'INVALID_ORIGIN', '请从接入页或 Agent 本机读取邀请');
        rate('invite-inspect:' + digest(rateAddress(req, config)), 60, 60000);
        const token = /^Bearer (qdi_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
        const invite = agentAccess.invitation(token), capability = await agentAccess.capabilities();
        return respond(res, 200, { ...invite, game: capability.game,
          onboarding: agentOnboarding({ origin: req.portalOrigin.origin, invite: { ...invite, token }, skill: agentSkill, gameAddress: config.publicGameAddress, gameReady: capability.game.ready }) });
      }
      if (pathname === '/api/v1/agent-access/memories' || pathname.startsWith('/api/v1/agent-access/memories/')) {
        // This API delegates only the authenticated Agent's own submissions.
        // An inviter's cookie, read-only PAT or a participant name is no grant.
        if (req.headers.origin || req.headers.cookie) throw fail(403, 'AGENT_CLIENT_REQUIRED', '请从 Agent 本地调用，不要附带浏览器 Cookie 或 Origin');
        let actorContext;
        const context = async () => {
          if (actorContext) return actorContext;
          const authorized = agentAccess.authorize(req);
          const status = await agentAccess.status(authorized);
          if (!status.gameAccountCreated) throw fail(409, 'GAME_ACCOUNT_NOT_READY', '先查询接入状态，等待游戏角色创建成功后投稿');
          const actor = (await game.roster()).find(row => row.playerUuid === authorized.client.expected_uuid && row.name === authorized.client.name);
          if (!actor || actor.isReserved || actor.identityConflict || !store.ownedUuids(authorized.owner.id).includes(actor.playerUuid)) throw fail(409, 'AGENT_IDENTITY_UNCONFIRMED', '角色身份或归属尚未确认，请查询接入状态或联系主人');
          actorContext = { owner: authorized.owner, actor: { uuid: actor.playerUuid, name: actor.name } };
          return actorContext;
        };
        // Require the narrow credential even for public reads on this API.
        await context();
        if (await memoryRoute({ req, res, pathname, url, memories, context, jsonBody, respond, rate })) return;
      }
      const agentApi = /^\/api\/v1\/agent-access\/(register|sessions|status|activate|state|session)$/.exec(pathname);
      if (agentApi) {
        // A narrow non-browser API, isolated from cookie/CSRF authority. Its
        // tokens never authorize the normal account, admin or game-claim API.
        if (req.headers.origin || req.headers.cookie) throw fail(403, 'AGENT_CLIENT_REQUIRED', '请从 Agent 本地接入程序调用 API，不要附带浏览器 Cookie 或 Origin');
        const action = agentApi[1], address = digest(rateAddress(req, config));
        if (action === 'register' && req.method === 'POST') {
          rate('agent-register:' + address, 12);
          const token = /^Bearer (qdi_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
          const result = await agentAccess.register(token, await jsonBody(req));
          return respond(res, result.duplicate ? 200 : 201, result);
        }
        if (action === 'sessions' && req.method === 'POST') {
          const body = await jsonBody(req); rate('agent-login:' + address, 30); rate('agent-login-client:' + digest(String(body.clientId)), 12);
          return respond(res, 200, agentAccess.login(body));
        }
        const context = agentAccess.authorize(req);
        if (action === 'status' && req.method === 'GET') return respond(res, 200, await agentAccess.status(context));
        if (action === 'state' && req.method === 'GET') return respond(res, 200, await agentAccess.state(context));
        if (action === 'activate' && req.method === 'POST') { rate('agent-activate:' + context.client.id, 6); return respond(res, 202, await agentAccess.activate(context, await jsonBody(req))); }
        if (action === 'session' && req.method === 'DELETE') return respond(res, 200, agentAccess.logout(context));
        throw fail(405, 'METHOD_NOT_ALLOWED', '请按 Agent 接入文档使用此接口');
      }
      if (req.method === 'POST' && pathname === '/api/v1/internal/accounts/poll') {
        if (!accountCloud) throw fail(404, 'NOT_FOUND', '未开放此接口');
        if (req.headers.origin) throw fail(403, 'ACCOUNT_WORKER_REQUIRED', '请从家庭端账号同步器提交');
        accountCloud.authorize(req); rate('account-bridge', 30, 60000);
        const result = await accountCloud.poll(await jsonBody(req, 512 * 1024));
        for (const id of result.acknowledged) {
          const job = store.db.prepare('SELECT owner_id FROM account_jobs WHERE id=?').get(id);
          if (job) await accounts.job(store.ownerById(job.owner_id), id);
        }
        return respond(res, 200, result);
      }
      if (req.method === 'PUT' && pathname === '/api/v1/internal/snapshot') {
        if (!cloud) throw fail(404, 'NOT_FOUND', '未开放此接口');
        if (req.headers.origin) throw fail(403, 'SYNC_CLIENT_REQUIRED', '请从家庭端同步器上传资料');
        cloud.authorize(req); rate('snapshot-sync', 12, 60000);
        return respond(res, 200, cloud.accept(await jsonBody(req, config.cloudSync.maxBytes)));
      }
      if (req.method === 'PUT' && pathname === '/api/v1/internal/challenges') {
        if (!cloud) throw fail(404,'NOT_FOUND','未开放此接口');
        if (req.headers.origin || req.headers.cookie) throw fail(403,'SYNC_CLIENT_REQUIRED','挑战资料仅由家庭端只读采集器上传');
        cloud.authorize(req); rate('challenge-sync',12,60000);
        return respond(res,200,await challenges.accept(await jsonBody(req,config.cloudSync.maxBytes)));
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
      if (await memoryRoute({ req, res, pathname, url, memories, context: async required => {
        if (required) return { owner: browserAuth(req).owner, actor: null };
        const session = sessionFrom(req);
        return session?.owner_id ? { owner: store.ownerById(session.owner_id), actor: null } : null;
      }, jsonBody, respond, rate })) return;
      const appearanceRoute = /^\/api\/v1\/agents\/([a-f0-9]{24})\/appearance(?:\/(skin|ysm|apply|assets)(?:\/([a-f0-9-]{36}))?)?$/.exec(pathname);
      if (appearanceRoute) {
        const browser = browserAuth(req, false, isWrite);
        const { agent } = await authorizedAgent(req, appearanceRoute[1]);
        if (!store.ownedUuids(browser.owner.id).includes(agent.playerUuid)) throw fail(403, 'APPEARANCE_OWNER_REQUIRED', '请由已绑定的角色主人管理游戏外观');
        appearance.assertAgent(agent);
        const action = appearanceRoute[2], id = appearanceRoute[3];
        if (!action && req.method === 'GET') return respond(res, 200, appearance.list(agent));
        if (['skin', 'ysm'].includes(action) && req.method === 'POST' && !id) {
          rate('appearance-upload:' + browser.owner.id, 8);
          const expectedType = action === 'skin' ? 'image/png' : 'application/zip';
          if (req.headers['content-type'] !== expectedType) throw fail(415, 'APPEARANCE_TYPE', '普通皮肤请上传 PNG，YSM 请上传 ZIP');
          let size = 0; const chunks = [];
          for await (const chunk of req) { if ((size += chunk.length) > MAX_APPEARANCE_BYTES) throw fail(413, 'APPEARANCE_SIZE', '外观文件不能超过 8MB'); chunks.push(chunk); }
          let label; try { label = decodeURIComponent(req.headers['x-appearance-label'] || ''); } catch { throw fail(400, 'APPEARANCE_LABEL', '外观名称格式不正确'); }
          return respond(res, 201, appearance.upload(agent, browser.owner, action, Buffer.concat(chunks), { label, variant: req.headers['x-skin-variant'], consent: req.headers['x-appearance-consent'] }));
        }
        if (action === 'apply' && req.method === 'POST') { rate('appearance-apply:' + browser.owner.id, 8); return respond(res, 202, appearance.apply(agent, browser.owner, await jsonBody(req))); }
        if (action === 'assets' && id && req.method === 'GET') { const bytes = appearance.image(agent, id); res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length }); return res.end(bytes); }
        if (action === 'assets' && id && req.method === 'DELETE') return respond(res, 200, appearance.remove(agent, browser.owner, id));
        throw fail(405, 'METHOD_NOT_ALLOWED', '请使用角色的外观管理入口');
      }
      const profileRoute = /^\/api\/v1\/agents\/([a-f0-9]{24})\/(profile|references)(?:\/([a-f0-9-]{36}))?$/.exec(pathname);
      if (profileRoute) {
        if (isWrite) browserAuth(req);
        const { agent, owner } = await authorizedAgent(req, profileRoute[1], ['profile.read']);
        if (agent.kind !== 'agent' || agent.isReserved) throw fail(403, 'AGENT_PROFILE_REQUIRED', '设定图仅适用于普通 Agent 角色');
        if (profileRoute[2] === 'profile' && !profileRoute[3]) {
          if (req.method === 'GET') return respond(res, 200, profiles.get(agent));
          if (req.method === 'PUT') return respond(res, 200, profiles.save(agent, owner, await jsonBody(req)));
        }
        if (profileRoute[2] === 'references') {
          if (!profileRoute[3] && req.method === 'POST') {
            rate('reference-upload:' + owner.id, 12);
            if (Number(req.headers['content-length']) > MAX_REFERENCE_BYTES) throw fail(413, 'REFERENCE_SIZE', '设定图不能超过 4MB');
            let length = 0; const chunks = [];
            for await (const chunk of req) { length += chunk.length; if (length > MAX_REFERENCE_BYTES) throw fail(413, 'REFERENCE_SIZE', '设定图不能超过 4MB'); chunks.push(chunk); }
            return respond(res, 201, profiles.upload(agent, owner, Buffer.concat(chunks), req.headers['content-type']));
          }
          if (profileRoute[3] && req.method === 'GET') {
            const image = profiles.image(agent, profileRoute[3]);
            res.writeHead(200, { 'Content-Type': image.mime, 'Content-Length': image.bytes.length, 'Cache-Control': 'private, no-store' }); return res.end(image.bytes);
          }
          if (profileRoute[3] && req.method === 'DELETE') return respond(res, 200, profiles.remove(agent, owner, profileRoute[3]));
        }
        throw fail(405, 'METHOD_NOT_ALLOWED', '此角色设定操作不支持这个方法');
      }
      if (pathname.startsWith('/media/') && await servePublicMedia(req, res, pathname, config)) return;
      if (req.method === 'GET' && pathname === '/api/v1/health') return respond(res, 200, { ok: true, schemaVersion: 1, version: portalVersion });
      if (req.method === 'GET' && pathname === '/api/v1/gallery') return respond(res, 200, { photos: gallery.list(), source: 'published-game-photography' });
      const photoImage = /^\/api\/v1\/gallery\/([a-f0-9-]{36})\/image$/.exec(pathname);
      if (photoImage && req.method === 'GET') {
        const image = gallery.image(photoImage[1]);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.bytes.length, ETag: `"${image.sha256}"`, 'Cache-Control': 'public, max-age=86400' }); return res.end(image.bytes);
      }
      if (req.method === 'GET' && pathname === '/api/v1/site') return respond(res, 200, { name: config.siteName, gameAddress: config.publicGameAddress, registration: sessionData(null).allowRegistration, emailAuth: emailAuth.capabilities(), agentSkill, agentClients, publicOrigin: config.publicOrigin || null, media: publicMedia(config) });
      if (req.method === 'GET' && pathname === '/api/v1/game-capabilities') return respond(res, 200, await accounts.capabilities());
      if (req.method === 'GET' && pathname === '/api/v1/server') return respond(res, 200, await game.serverSummary());
      if (req.method === 'GET' && pathname === '/api/v1/roster') {
        const owned = new Set(store.db.prepare('SELECT agent_uuid FROM ownerships').all().map(row => row.agent_uuid));
        return respond(res, 200, { agents: (await game.roster()).map(row => ({ ...game.publicAgent(row),
          claimable: !!row.playerUuid && !row.isReserved && ['agent', 'player'].includes(row.kind) && !row.identityConflict && !owned.has(row.playerUuid) })) });
      }
      if (req.method === 'GET' && pathname === '/api/v1/world/players') return respond(res, 200, await world.players());
      if (req.method === 'GET' && pathname === '/api/v1/challenges') return respond(res,200,await challenges.query({activity:url.searchParams.get('activity')||'trial_tower',difficulty:url.searchParams.get('difficulty')||'all',page:Number(url.searchParams.get('page')||1)}));
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
        // optional-email is an explicit operator choice: a blank email uses the
        // ordinary password account; a supplied email must still be verified.
        const emailMode = config.emailAuth.registrationMode;
        const verifyEmail = emailMode === 'email' || emailMode === 'optional-email' && Object.hasOwn(body, 'email') && body.email !== '';
        if (!setup && verifyEmail) {
          if (emailMode === 'optional-email' && !emailAuth.capabilities().available) throw fail(503, 'EMAIL_NOT_CONFIGURED', '邮箱验证暂不可用；可以清空邮箱，先用用户名和密码注册，之后再绑定邮箱');
          return respond(res, 202, await emailAuth.begin('register', body, sessionFrom(req)));
        }
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
        let email = null;
        if (typeof body.username === 'string' && body.username.includes('@')) { try { email = normalizeEmail(body.username); } catch {} }
        if ((!usernameValid(body.username) && !email) || typeof body.password !== 'string' || body.password.length > 128) throw fail(401, 'LOGIN_FAILED', '网站用户名、邮箱或密码不正确');
        const owner = email ? emailAuth.ownerByEmail(email) : store.ownerByName(body.username);
        const valid = await verifyPassword(body.password, owner?.password_hash);
        if (!owner || !valid) throw fail(401, 'LOGIN_FAILED', '网站用户名或密码不正确');
        const session = newSession(req, res, owner.id); store.audit(owner.id, 'session.login', owner.id);
        return respond(res, 200, sessionData(session));
      }
      if (req.method === 'POST' && pathname === '/api/v1/auth/password-reset') {
        rate('reset:' + digest(rateAddress(req, config)), 6);
        return respond(res, 202, await emailAuth.begin('reset', await jsonBody(req), sessionFrom(req)));
      }
      if (req.method === 'POST' && pathname === '/api/v1/auth/email/verify') {
        rate('verify-email:' + digest(rateAddress(req, config)), 30);
        const body = await jsonBody(req);
        const pending = emailAuth.checked(body.challengeId, body.code, sessionFrom(req));
        if (pending.purpose === 'reset' && !passwordValid(body.newPassword)) throw fail(400, 'INVALID_PASSWORD', '新网站密码需为 6–128 个字符');
        const result = await emailAuth.finish(body.challengeId, body.code, sessionFrom(req), body.newPassword);
        if (result.purpose === 'reset') return respond(res, 200, { ...sessionData(newSession(req, res, null)), passwordReset: true, message: '网站密码已重设，请重新登录；游戏密码保持原样。' });
        return respond(res, 200, { ...sessionData(result.purpose === 'register' ? newSession(req, res, result.owner.id) : sessionFrom(req)), emailVerified: true });
      }
      if (req.method === 'POST' && pathname === '/api/v1/account/email') {
        const { owner, session } = browserAuth(req, false, true); rate('bind-email:' + owner.id, 6);
        const body = await jsonBody(req);
        if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 128 || !await verifyPassword(body.currentPassword, owner.password_hash)) throw fail(401, 'PASSWORD_INCORRECT', '请用当前网站密码确认邮箱绑定');
        return respond(res, 202, await emailAuth.begin('bind', body, session));
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
        return respond(res, 200, { agents: agents.map(row => ({ ...row, isOwn: owned.includes(row.playerUuid) })), access: context.owner.role === 'admin' && !context.credential ? 'admin' : 'owner' });
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
        const { agent } = await authorizedAgent(req, configMatch[1]);
        return respond(res, 200, { schemaVersion: 1, portal: req.portalOrigin.origin, agentId: agent.id, playerUuid: agent.playerUuid,
          username: agent.name, gameAddress: config.publicGameAddress, credentialEnv: 'QD_PORTAL_CLIENT_TOKEN', gamePasswordEnv: 'MC_GAME_PASSWORD', readOnly: true });
      }
      if (req.method === 'GET' && pathname === '/api/v1/account') {
        const { owner, session } = browserAuth(req);
        const sessions = store.db.prepare('SELECT id_hash,created_at,expires_at,device FROM sessions WHERE owner_id=? ORDER BY created_at DESC').all(owner.id)
          .map(row => ({ id: row.id_hash, current: row.id_hash === session.id_hash, device: row.device, createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() }));
        return respond(res, 200, { owner: store.ownerPublic(owner), email: emailAuth.identity(owner.id), sessions, events: store.events(owner) });
      }
      if (req.method === 'GET' && pathname === '/api/v1/agent-invites') return respond(res, 200, agentAccess.list(browserAuth(req).owner));
      if (req.method === 'POST' && pathname === '/api/v1/agent-invites') {
        const { owner } = browserAuth(req, false, true); rate('agent-invite:' + owner.id, 20);
        const invite = agentAccess.issue(owner, await jsonBody(req)), capability = await agentAccess.capabilities();
        return respond(res, 201, { ...invite, onboarding: agentOnboarding({ origin: req.portalOrigin.origin, invite, skill: agentSkill, gameAddress: config.publicGameAddress, gameReady: capability.game.ready }) });
      }
      const agentInvite = /^\/api\/v1\/agent-invites\/([a-f0-9-]{36})$/.exec(pathname);
      if (agentInvite && req.method === 'DELETE') return respond(res, 200, agentAccess.revoke(browserAuth(req, false, true).owner, agentInvite[1]));
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
        emailAuth.invalidate(owner.id);
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
        if (!Array.isArray(scopes) || !scopes.includes('state.read') || scopes.some(value => !['state.read', 'inventory.read', 'profile.read'].includes(value))) throw fail(400, 'INVALID_SCOPES', '客户端权限可选状态、背包和角色设定读取');
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
      if (req.method === 'GET' && pathname === '/api/v1/account-jobs') {
        const { owner } = browserAuth(req);
        const rows = store.db.prepare('SELECT id FROM account_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 20').all(owner.id);
        return respond(res, 200, { jobs: await Promise.all(rows.map(row => accounts.job(owner, row.id))) });
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
      res.setHeader('Cache-Control', /\.(png|jpg|webp|svg|ico)$/.test(filePath) ? 'public, max-age=3600' : 'no-cache');
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
  return { server, store, game, world, challenges, live, accounts, cloud, gallery, emailAuth, agentAccess, appearance, memories, close: async () => { clearInterval(cleanup); emailAuth.close(); await new Promise(resolve => server.close(resolve)); store.close(); } };
}
