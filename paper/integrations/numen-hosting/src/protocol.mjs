import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PROTOCOL = 'qiandengji-hosted-body/v1';
export const MODES = Object.freeze(['paused', 'numen', 'harness', 'manual']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function fail(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status, expose: true });
}
export function identity(value) {
  if (!value || ['roleUuid','numenOwnerUuid','name','serverId','ownerId'].some(k=>typeof value[k]!=='string')
      || !UUID.test(value.roleUuid) || !UUID.test(value.numenOwnerUuid)
      || !/^[A-Za-z0-9_]{1,16}$/.test(value.name)
      || !/^[A-Za-z0-9_.:-]{1,120}$/.test(value.serverId)
      || !/^[A-Za-z0-9_.:-]{1,120}$/.test(value.ownerId)
      || value.roleUuid === value.numenOwnerUuid)
    throw fail('IDENTITY_INVALID', '需要网站已核实的角色 UUID、归属和服务器；不能按显示名新建身体。', 400);
  return Object.freeze(Object.fromEntries(['roleUuid', 'numenOwnerUuid', 'name', 'serverId', 'ownerId'].map(k => [k, value[k]])));
}
export const keyOf = role => `${role.serverId}/${role.roleUuid}`;
export function opaqueId(value, label = '请求编号') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{8,120}$/.test(value))
    throw fail('INVALID_ID', `${label}须为稳定编号，不得包含口令或正文。`, 400);
  return value;
}
export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

// Only a website backend that has checked actual ownership issues this grant.
// A browser assertion, a Minecraft display name, and an ag_ prefix are not proof.
export function signGrant(claims, secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) throw new Error('A dedicated 256-bit grant key is required');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyGrant(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    throw fail('GRANT_INVALID', '请回官网重新选择自己的角色。', 401);
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest();
  const received = Buffer.from(sig, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    throw fail('GRANT_INVALID', '角色授权校验失败，请回官网重新选择。', 401);
  let grant;
  try { grant = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { throw fail('GRANT_INVALID', '角色授权格式无效。', 401); }
  if (grant.aud !== PROTOCOL || !Number.isSafeInteger(grant.iat) || !Number.isSafeInteger(grant.exp)
      || grant.iat > now + 5000 || grant.exp <= now || grant.exp - grant.iat > 60000
      || grant.exp <= grant.iat || !['manage', 'manual','conversation'].includes(grant.scope))
    throw fail('GRANT_EXPIRED', '角色授权已过期，请回官网重新选择。', 401);
  opaqueId(grant.jti, '授权编号');
  return { ...grant, role: identity(grant.role) };
}

export function inputFrame(value) {
  if (!value || !Number.isSafeInteger(value.sequence) || value.sequence < 0
      || !Number.isFinite(value.yaw) || Math.abs(value.yaw) > 36000
      || !Number.isFinite(value.pitch) || Math.abs(value.pitch) > 90
      || !Array.isArray(value.keys) || value.keys.length > 7
      || value.keys.some(k => !['forward','back','left','right','jump','sneak','sprint'].includes(k))
      || new Set(value.keys).size !== value.keys.length
      || typeof value.attack !== 'boolean' || typeof value.use !== 'boolean'
      || !Number.isInteger(value.slot) || value.slot < 0 || value.slot > 8)
    throw fail('INVALID_INPUT', '输入需包含递增序号、朝向、按键和 0–8 快捷栏槽位。', 400);
  return { sequence:value.sequence, yaw:value.yaw, pitch:value.pitch, keys:[...value.keys], attack:value.attack, use:value.use, slot:value.slot };
}
