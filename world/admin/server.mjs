import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freshness, projectHealth, projectOperations } from './read-model.mjs';
import { createManagementApi } from './management-api.mjs';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/management.js', ['management.js','text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:19092; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

async function readSnapshot(directory, filename) {
  try {
    const target = path.join(directory, filename);
    if ((await fs.stat(target)).size > 2 * 1024 * 1024) return null;
    return JSON.parse((await fs.readFile(target, 'utf8')).replace(/^\uFEFF/, ''));
  } catch { return null; }
}

function publicLink(value, fallback) {
  try {
    const url = new URL(value || fallback);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return fallback;
    return url.href;
  } catch { return fallback; }
}

export function createPanelServer({ stateDir, publicOrigin = 'http://127.0.0.1:9090',
  qwenpawUrl = 'http://127.0.0.1:18089', resourcesUrl = 'http://127.0.0.1:19090/packs/', management = {} } = {}) {
  if (!stateDir) throw new Error('Panel state directory is required');
  const expected = new URL(publicOrigin);
  const allowedHosts = new Set([expected.host]);
  if (expected.hostname === '127.0.0.1') allowedHosts.add(`localhost:${expected.port || '80'}`);
  const links = { qwenpaw: publicLink(qwenpawUrl, 'http://127.0.0.1:18089'), resources: publicLink(resourcesUrl, 'http://127.0.0.1:19090/packs/') };
  const localOrigins=[expected.origin];
  if(expected.hostname==='127.0.0.1')localOrigins.push(`${expected.protocol}//localhost:${expected.port||'80'}`);
  const managementApi=createManagementApi({...management,localOrigins});
  const send = (res, status, body, contentType = 'application/json; charset=utf-8') => {
    res.writeHead(status, { ...headers, 'Content-Type': contentType });
    res.end(contentType.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  return http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'Unrecognized panel host' });
      if (req.headers.origin && req.headers.origin !== expected.origin && req.headers.origin !== `http://localhost:${expected.port || '80'}`)
        return send(res, 403, { error: 'Cross-origin access is not allowed' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'Cross-site access is not allowed' });
      const url = new URL(req.url, expected);
      if(await managementApi(req,res,url,send))return;
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'Read-only resource' }); }
      // Exact allow-list: no static directory serving or old command endpoints.
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, service: 'qiandengji-panel', schema: 1,
        mode: management.token?.length>=32 && management.authMode==='local' ? 'local-management'
          : management.passwordHash && management.token ? 'authenticated-management' : 'read-only' });
      if (url.pathname === '/api/state') {
        const [world, health, operations] = await Promise.all([
          readSnapshot(stateDir, 'world.json'), readSnapshot(stateDir, 'health.json'), readSnapshot(stateDir, 'operations.json')]);
        const valid = world?.schema === 1 && typeof world.generatedAt === 'string' && world.skills && world.world && world.guild && world.npc;
        const snapshot = valid ? world : { schema: 1, available: false, generatedAt: null, world: { available: false, observedPlayers: [] },
          agent: { id: 'unknown', label: '等待运行信息', capabilities: {} }, npc: { available: false, threads: [] },
          skills: { available: false, featured: [], archived: [], archivedCount: 0, passiveCount: 0 }, players: [], waypoints: [],
          guild: { available: false, board: [], fame: [] }, warnings: ['尚无有效世界快照；管理页仍可独立使用'] };
        const status = freshness(snapshot.generatedAt);
        const worldStatus = freshness(snapshot.world.updatedAt, Date.now(), 180);
        const npcStatus = freshness(snapshot.npc.updatedAt, Date.now(), 100);
        const guildStatus = freshness(snapshot.guild.updatedAt, Date.now(), 100);
        const warnings = [...(Array.isArray(snapshot.warnings) ? snapshot.warnings : [])];
        if (valid && status.stale) warnings.push('世界快照已过期，以下内容为上次记录');
        if (valid && worldStatus.stale) warnings.push('世界心跳已过期或不可用');
        if (valid && npcStatus.stale) warnings.push('NPC 心跳已过期或不可用');
        const guildStale = snapshot.guild.stale === true || guildStatus.stale || !!snapshot.guild.pollingError;
        if (valid && guildStale) warnings.push('工会轮询或任务板已过期、不可用；以下为上次记录');
        return send(res, 200, { ...snapshot, ...status, world: { ...snapshot.world, ...worldStatus },
          npc: { ...snapshot.npc, ...npcStatus }, guild: { ...snapshot.guild, stale: guildStale, pollingOk: !guildStatus.stale && !snapshot.guild.pollingError },
          health: projectHealth(health), operations: projectOperations(operations), links, warnings });
      }
      if (assets.has(url.pathname)) {
        const [filename, contentType] = assets.get(url.pathname);
        return send(res, 200, await fs.readFile(path.join(publicDir, filename)), contentType);
      }
      return send(res, 404, { error: 'Not found' });
    } catch { return send(res, 500, { error: 'Panel request unavailable' }); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PANEL_PORT || 9090);
  const server = createPanelServer({ stateDir: process.env.PANEL_STATE_DIR || '/panel-data',
    publicOrigin: process.env.PANEL_PUBLIC_ORIGIN || `http://127.0.0.1:${port}`,
    qwenpawUrl: process.env.PANEL_QWENPAW_URL, resourcesUrl: process.env.PANEL_RESOURCES_URL,
    management: {
      authMode: process.env.PANEL_MANAGEMENT_AUTH_MODE || 'password',
      localTrustedPeers: (process.env.PANEL_LOCAL_TRUSTED_PEERS || '').split(',').map(value=>value.trim()).filter(Boolean),
      token: await fs.readFile('/run/secrets/control-token','utf8').then(x=>x.trim()).catch(()=>null),
      passwordHash: await fs.readFile('/run/secrets/admin-password','utf8').then(JSON.parse).catch(()=>null),
    } });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.listen(port, process.env.PANEL_HOST || '127.0.0.1', () => console.log(`[panel] independent management listening on :${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
