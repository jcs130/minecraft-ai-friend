import { MAX_APPEARANCE_BYTES } from './appearance-files.mjs';

const fail = (status, reason, message) => Object.assign(Error(message), { status, reason });
const ROOT = '/api/v1/agent-access/appearance';

// The subject comes only from a verified API identity or a single-role PAT.
// Never accept a target UUID/name/owner supplied in the body or URL.
export async function agentAppearanceRoute({ req, res, pathname, context, appearance, jsonBody, respond, rate }) {
  if (pathname !== ROOT && !pathname.startsWith(ROOT + '/')) return false;
  if (req.headers.origin || req.headers.cookie) throw fail(403, 'AGENT_CLIENT_REQUIRED', '请从 Agent 本机调用外观接口，不附带浏览器 Cookie 或 Origin');
  const who = await context(), { agent, owner } = who;
  appearance.assertAgent(agent);
  const suffix = pathname.slice(ROOT.length), subject = { username: agent.name, playerUuid: agent.playerUuid };
  const list = value => ({ ...value, subject, assets: value.assets.map(row => row.image ? { ...row, image: ROOT + '/assets/' + row.id } : row) });
  const key = who.client?.id || who.credential?.id || owner.id;
  if (!suffix && req.method === 'GET') { respond(res, 200, list(appearance.list(agent))); return true; }
  if (['/skin', '/ysm'].includes(suffix) && req.method === 'POST') {
    rate('agent-appearance-upload:' + key, 8);
    const kind = suffix.slice(1), type = kind === 'skin' ? 'image/png' : 'application/zip';
    if (req.headers['content-type'] !== type) throw fail(415, 'APPEARANCE_TYPE', '普通皮肤用 image/png 上传，YSM 原始模型包用 application/zip 上传');
    if (Number(req.headers['content-length']) > MAX_APPEARANCE_BYTES) throw fail(413, 'APPEARANCE_SIZE', '文件不能超过 8MB，请压缩贴图或精简模型后上传');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_APPEARANCE_BYTES) throw fail(413, 'APPEARANCE_SIZE', '文件不能超过 8MB，请压缩贴图或精简模型后上传'); chunks.push(chunk); }
    let label; try { label = decodeURIComponent(req.headers['x-appearance-label'] || ''); } catch { throw fail(400, 'APPEARANCE_LABEL', '外观名称请使用 URI 编码'); }
    respond(res, 201, list(appearance.upload(agent, owner, kind, Buffer.concat(chunks), { label, variant: req.headers['x-skin-variant'], consent: req.headers['x-appearance-consent'] })));
    return true;
  }
  if (suffix === '/apply' && req.method === 'POST') {
    rate('agent-appearance-apply:' + key, 8);
    const body = await jsonBody(req); appearance.apply(agent, owner, body);
    const job = appearance.job(agent, body.requestId);
    respond(res, 202, { subject, ...job, query: ROOT + '/jobs/' + job.id }); return true;
  }
  const job = /^\/jobs\/([a-f0-9-]{36})$/.exec(suffix);
  if (job && req.method === 'GET') { respond(res, 200, { subject, ...appearance.job(agent, job[1]) }); return true; }
  const asset = /^\/assets\/([a-f0-9-]{36})$/.exec(suffix);
  if (asset && req.method === 'GET') { const bytes = appearance.image(agent, asset[1]); res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store' }); res.end(bytes); return true; }
  if (asset && req.method === 'DELETE') { respond(res, 200, list(appearance.remove(agent, owner, asset[1]))); return true; }
  throw fail(405, 'METHOD_NOT_ALLOWED', '用 GET 查询本人外观，POST skin／ysm 上传，POST apply 应用，再用返回的 query 查询结果');
}
