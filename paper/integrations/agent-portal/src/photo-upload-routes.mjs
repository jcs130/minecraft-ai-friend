import { MAX_UPLOAD_BYTES } from './photo-uploads.mjs';
const ROOT = '/api/v1/agent-access/photos';
const fail = (status, reason, message) => Object.assign(Error(message), { status, reason });

export async function agentPhotoRoute({ req, res, pathname, url, context, uploads, respond, rate, origin, jsonBody }) {
  if (pathname !== ROOT && !pathname.startsWith(ROOT + '/')) return false;
  if (req.headers.origin || req.headers.cookie) throw fail(403, 'AGENT_CLIENT_REQUIRED', '请从 Agent 本机调用相册接口，不附带浏览器 Cookie 或 Origin');
  const who = await context(), { owner, agent } = who, access = uploads.context(owner, agent), suffix = pathname.slice(ROOT.length);
  const key = agent.playerUuid;
  if (!suffix && req.method === 'GET') {
    const result=uploads.gallery.managed(access, { page: Number(url.searchParams.get('page') || 1) });
    respond(res, 200, { ...result, photos:result.photos.map(photo=>({...photo,imageUrl:photo.imageReady?ROOT+'/'+photo.id+'/image':null})), subject: { username: agent.name }, upload: { contentType: 'image/png', maximumBytes: MAX_UPLOAD_BYTES, maximumPixels: 2048, titleHeader: 'X-Photo-Title (URI encoded)', storyHeader: 'X-Photo-Story (URI encoded, optional)', requestIdHeader: 'X-Request-Id (UUID)' } }); return true;
  }
  if (!suffix && req.method === 'POST') {
    rate('photo-upload:' + key, 12);
    if (req.headers['content-type'] !== 'image/png') throw fail(415, 'PHOTO_PNG_REQUIRED', 'Agent 图片请导出为 image/png，最大 4MB、2048 像素');
    if (Number(req.headers['content-length']) > MAX_UPLOAD_BYTES) throw fail(413, 'PHOTO_TOO_LARGE', '图片最多 4MB，请缩小后重试');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_UPLOAD_BYTES) throw fail(413, 'PHOTO_TOO_LARGE', '图片最多 4MB，请缩小后重试'); chunks.push(chunk); }
    const header = name => { try { return decodeURIComponent(req.headers[name] || ''); } catch { throw fail(400, 'PHOTO_HEADER', '标题和描述请求头需要 URI 编码'); } };
    respond(res, 201, uploads.upload(owner, agent, Buffer.concat(chunks), { requestId: req.headers['x-request-id'], title: header('x-photo-title'), story: header('x-photo-story') })); return true;
  }
  const item = /^\/([a-f0-9-]{36})(?:\/(import|image|publication))?$/.exec(suffix);
  if (item) {
    const id = item[1];
    if (item[2] === 'import' && req.method === 'POST') { rate('photo-import:' + key, 12); respond(res, 201, uploads.issue(id, access, origin)); return true; }
    if (item[2] === 'publication' && req.method === 'PUT') { rate('photo-publication:' + key, 20); respond(res, 200, uploads.gallery.publication(id, (await jsonBody(req)).published, access)); return true; }
    if (!item[2] && req.method === 'DELETE') { respond(res, 200, uploads.remove(id, access)); return true; }
    if (item[2] === 'image' && req.method === 'GET') { const { bytes } = uploads.gallery.image(id, access); res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store' }); res.end(bytes); return true; }
  }
  throw fail(405, 'METHOD_NOT_ALLOWED', 'GET 查询本人相册；POST 上传 PNG；POST /图片ID/import 制作地图；PUT /图片ID/publication 设置 published；DELETE /图片ID 删除上传作品');
}
