import { isIP } from 'node:net';
const loopback = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);
const fail = () => Object.assign(new Error('网站地址或代理来源不匹配'), { status: 400, reason: 'INVALID_HOST' });

// Host/Origin are compared to configured origins. Forwarding headers alone do
// not turn an untrusted connection into HTTPS or grant local administrator setup.
export function requestOrigin(req, config, activePort) {
  const host = req.headers.host;
  const local = new Set([`http://127.0.0.1:${activePort}`, `http://localhost:${activePort}`, `http://[::1]:${activePort}`,
    ...(!['0.0.0.0', '::'].includes(config.host) ? [`http://${config.host}:${activePort}`] : []), ...(config.localOrigins || [])]);
  const direct = req.socket.encrypted ? `https://${host}` : `http://${host}`;
  const proxied = !!(req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'] || req.headers.forwarded);
  if (config.publicOrigin && new URL(config.publicOrigin).host === host) {
    const secure = !!req.socket.encrypted || (config.trustedProxies || []).includes(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https';
    if (!secure) throw fail();
    return { origin: config.publicOrigin, secure: true, canSetup: false };
  }
  if (!local.has(direct)) throw fail();
  return { origin: direct, secure: direct.startsWith('https:'), canSetup: loopback(req.socket.remoteAddress) && !proxied };
}

export function rateAddress(req, config) {
  const peer = req.socket.remoteAddress || '';
  // Caddy appends the actual peer to X-Forwarded-For. The rightmost address
  // cannot be chosen by a public visitor supplying their own XFF prefix.
  if (config.publicOrigin && req.portalOrigin?.origin === config.publicOrigin && (config.trustedProxies || []).includes(peer)) {
    const forwarded = req.headers['x-forwarded-for'];
    const last = typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : '';
    if (isIP(last)) return last;
  }
  return peer;
}
