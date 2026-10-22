import { MAX_MEMORY_BYTES } from './memories.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
export async function memoryRoute({ req, res, pathname, url, memories, context, jsonBody, respond, rate }) {
  const root = pathname.startsWith('/api/v1/agent-access/memories') ? '/api/v1/agent-access/memories' : '/api/v1/memories';
  if (pathname !== root && !pathname.startsWith(root + '/')) return false;
  const suffix = pathname.slice(root.length);
  if (req.method === 'GET' && (!suffix || suffix === '/mine')) {
    const mine = suffix === '/mine';
    const who = mine ? await context(true) : null;
    respond(res, 200, memories.list({ mine, context: who, offset: Number(url.searchParams.get('offset') || 0), participant: url.searchParams.get('participant') || '' })); return true;
  }
  if (!suffix && req.method === 'POST') {
    const who = await context(true); rate('memory-create:' + who.owner.id, 12);
    const result = memories.create(who, await jsonBody(req)); respond(res, result.duplicate ? 200 : 201, result); return true;
  }
  const match = /^\/([a-f0-9-]{36})(?:\/(images\/(original|redraw)|publish|withdraw))?$/.exec(suffix);
  if (!match) throw fail(404, 'MEMORY_NOT_FOUND', '请使用回忆列表返回的准确地址');
  const [, id, action, kind] = match;
  const write = !['GET', 'HEAD'].includes(req.method), who = await context(write);
  if (!action && req.method === 'GET') { respond(res, 200, memories.detail(id, who)); return true; }
  if (!action && req.method === 'PUT') { respond(res, 200, memories.edit(id, who, await jsonBody(req))); return true; }
  if (kind && req.method === 'PUT') {
    // Authorize and enforce ownership before consuming an image body.
    memories.owned(id, who); rate('memory-upload:' + who.owner.id, 20);
    if (Number(req.headers['content-length']) > MAX_MEMORY_BYTES) throw fail(413, 'MEMORY_IMAGE_SIZE', '回忆图片不能超过4MB');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_MEMORY_BYTES) throw fail(413, 'MEMORY_IMAGE_SIZE', '回忆图片不能超过4MB'); chunks.push(chunk); }
    respond(res, 200, memories.upload(id, kind, who, Buffer.concat(chunks), req.headers['content-type'])); return true;
  }
  if (kind && ['GET', 'HEAD'].includes(req.method)) {
    const image = memories.image(id, kind, who);
    res.writeHead(200, { 'Content-Type': image.mime, 'Content-Length': image.bytes.length, 'Cache-Control': 'private, no-store' });
    res.end(req.method === 'HEAD' ? undefined : image.bytes); return true;
  }
  if (action === 'publish' && req.method === 'POST') { respond(res, 200, memories.publish(id, who, await jsonBody(req))); return true; }
  if (action === 'withdraw' && req.method === 'POST') { respond(res, 200, memories.withdraw(id, who)); return true; }
  throw fail(405, 'METHOD_NOT_ALLOWED', '请按回忆接口说明使用查询、编辑、上传、发布或撤回操作');
}
