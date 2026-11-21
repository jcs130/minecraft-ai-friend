import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const route = '/api/v1/character-device';
const pairId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{24}$/.test(value);
const deviceToken = /^qdh_[a-zA-Z0-9_-]{43}$/;
const deviceAuthorization = /^Bearer (qdh_[a-zA-Z0-9_-]{43})$/;
const pollToken = /^Bearer (qdp_[a-zA-Z0-9_-]{43})$/;
const digest = value => createHash('sha256').update(value).digest();
const failure = (status, reason, message) => Object.assign(new Error(message), { status, reason, expose: true });
const expired = () => failure(404, 'DEVICE_PAIR_NOT_FOUND', '找不到这次设备申请，请从设备重新开始。');
const unavailable = () => failure(503, 'DEVICE_HOST_UNAVAILABLE', '设备接力暂未启用。');
const jsonShape = (body, keys) => !!body && typeof body === 'object' && !Array.isArray(body) &&
  Object.keys(body).sort().join(',') === keys;

/** Pairing is independent of login, onboarding, resident conversations and the private gateway key. */
export function characterDeviceRoutes({ provider, publicOrigin, clock = Date.now }) {
  const pairs = new Map(), grants = new Map();
  function secure(req) {
    if (!provider) throw unavailable();
    if (!req.portalOrigin.secure || req.portalOrigin.origin !== publicOrigin) {
      throw failure(403, 'DEVICE_HTTPS_REQUIRED', '请从千灯纪正式 HTTPS 网站使用设备接力。');
    }
  }
  async function backend(call) {
    try { return await call(); }
    catch (error) {
      if (error.code === 'BODY_HANDOFF_NOT_FOUND' || error.code === 'DEVICE_BODY_UNAVAILABLE') {
        throw failure(404, 'DEVICE_BODY_UNAVAILABLE', '未找到此角色的 Mineflayer 身体。');
      }
      if (error.code === 'DEVICE_ALREADY_ENROLLED') {
        throw failure(409, error.code, '这个角色已有设备授权。确认旧设备退出后，可先撤销授权。');
      }
      throw unavailable();
    }
  }
  function active(id) {
    const row = pairs.get(id);
    if (!row || clock() >= row.expiresAt) throw expired();
    return row;
  }
  return {
    async browserAvailable(req, role) {
      if (!provider || !req.portalOrigin.secure || req.portalOrigin.origin !== publicOrigin || !role.owns()) return false;
      try {
        return (await provider.available(role.characterId,{ownerId:role.ownerGameId}))?.eligible === true && role.owns();
      } catch { return false; }
    },
    async machine({req,res,pathname,jsonBody,respond,rate,peer}) {
      if (pathname !== route && pathname !== route + '/pair') return false;
      secure(req);
      if (req.method !== 'POST' || req.headers.origin || req.headers.cookie ||
          !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
        throw failure(403, 'DEVICE_CLIENT_REQUIRED', '请从已授权的桌面设备使用此接口。');
      }
      res.setHeader('Cache-Control', 'no-store');
      if (pathname === route) {
        const auth = req.headers.authorization;
        const match = deviceAuthorization.exec(auth ?? '');
        const key = match && digest(match[1]).toString('hex');
        const grant = key && grants.get(key);
        if (!grant || clock() >= grant.expiresAt || !grant.owns()) {
          if (grant) grants.delete(key);
          respond(res,401,{error:'DEVICE_UNAUTHORIZED'});
          return true;
        }
        rate('character-device-relay:' + peer, 1800, 60000);
        const body = await jsonBody(req,4096);
        if (body?.characterId !== grant.characterId) {
          respond(res,403,{error:'DEVICE_SCOPE_MISMATCH'});
          return true;
        }
        const response = await provider.relay(auth,body);
        respond(res,response.status,response.value);
        return true;
      }

      rate('character-device-pair:' + peer, 90, 60000);
      const body = await jsonBody(req,1024);
      if (body?.op === 'start' && jsonShape(body, 'op') && !req.headers.authorization) {
        rate('character-device-new-pair:' + peer, 8, 60000);
        for (const [id,row] of pairs) if (clock() >= row.expiresAt && row.state !== 'issuing') pairs.delete(id);
        for (const [key,grant] of grants) if (clock() >= grant.expiresAt) grants.delete(key);
        if (pairs.size >= 128) throw failure(503, 'DEVICE_PAIR_CAPACITY', '设备申请过多，请稍后再试。');
        const id = randomBytes(18).toString('base64url');
        const secret = 'qdp_' + randomBytes(32).toString('base64url');
        const expiresAt = clock() + 300000;
        pairs.set(id,{ state:'pending', secret:digest(secret), expiresAt });
        respond(res,201,{ pairId:id, pollSecret:secret,expiresAt });
        return true;
      }
      if (body?.op !== 'redeem' || !jsonShape(body,'op,pairId') || !pairId(body.pairId)) throw expired();
      const proof = pollToken.exec(req.headers.authorization ?? '');
      const row = active(body.pairId);
      if (!proof || !timingSafeEqual(row.secret, digest(proof[1]))) throw expired();
      if (row.state === 'pending') {
        respond(res,200,{ state:'pending' });
        return true;
      }
      if (row.state !== 'approved' || !row.owns()) throw expired();
      row.state = 'issuing';
      try {
        const grant = await backend(() => provider.enroll(row.characterId,row.authority));
        if (!deviceToken.test(grant?.token ?? '') || !Number.isSafeInteger(grant.expiresAt)) throw unavailable();
        if (clock() >= row.expiresAt || !row.owns()) {
          await backend(() => provider.revoke(row.characterId,row.authority));
          throw expired();
        }
        grants.set(digest(grant.token).toString('hex'),{characterId:row.characterId,expiresAt:grant.expiresAt,owns:row.owns});
        respond(res,200,{ state:'approved', characterId:row.characterId, token:grant.token,
          endpoint:publicOrigin + route, expiresAt:grant.expiresAt });
      } finally {
        // A lost grant response requires an explicit new pairing after revocation.
        pairs.delete(body.pairId);
      }
      return true;
    },
    async authorize(req, role, body) {
      secure(req);
      if (body?.kind !== 'mineflayer' || !role.owns()) {
        throw failure(404, 'DEVICE_BODY_UNAVAILABLE', '未找到此角色的 Mineflayer 身体。');
      }
      const characterId = role.characterId, authority = { ownerId:role.ownerGameId };
      if (body.action === 'approve' && jsonShape(body,'action,kind,pairId') && pairId(body.pairId)) {
        const pair = active(body.pairId);
        if (pair.state !== 'pending') throw expired();
        const status = await backend(() => provider.available(characterId,authority));
        if (status?.eligible !== true || !role.owns() || active(body.pairId) !== pair || pair.state !== 'pending') throw expired();
        Object.assign(pair,{ state:'approved',characterId,authority,owns:role.owns });
        return { approved:true, characterId, expiresAt:pair.expiresAt };
      }
      if (body.action === 'revoke' && jsonShape(body,'action,kind')) {
        if ([...pairs.values()].some(row => row.characterId === characterId && row.state === 'issuing')) {
          throw failure(409, 'DEVICE_PAIR_BUSY', '设备正在领取授权，稍后再撤销。');
        }
        for (const [id,row] of pairs) if (row.characterId === characterId) pairs.delete(id);
        for (const [key,grant] of grants) if (grant.characterId === characterId) grants.delete(key);
        const result = await backend(() => provider.revoke(characterId,authority));
        if (result?.revoked !== true) throw unavailable();
        return { revoked:true, characterId };
      }
      throw failure(400,'DEVICE_PAIR_INVALID','请选择设备授权操作。');
    },
  };
}
