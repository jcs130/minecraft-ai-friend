const ROOT = '/api/v1/self/music', PUBLIC = '/api/v1/music';
const fail = (status, reason, message) => Object.assign(Error(message), { status, reason });

export async function musicRoute({ req, res, pathname, url, music, context, subjects, respond, jsonBody, rate, browserWrite }) {
  if (![ROOT, PUBLIC].some(root => pathname === root || pathname.startsWith(root + '/'))) return false;
  if (req.method === 'GET' && pathname === PUBLIC + '/capabilities') { respond(res, 200, music.capabilities()); return true; }
  music.assertEnabled();
  if (req.method === 'GET' && pathname === PUBLIC + '/subjects') { respond(res, 200, { subjects: await subjects() }); return true; }
  const self = pathname === ROOT || pathname.startsWith(ROOT + '/'), suffix = pathname.slice((self ? ROOT : PUBLIC).length);
  const authenticated = async () => {
    const who = await context();
    return music.context(who.owner, who.agent);
  };
  const access = self ? await authenticated() : null;
  if (self && !['GET', 'HEAD'].includes(req.method)) {
    if (req.headers.authorization) {
      if (req.headers.origin || req.headers.cookie) throw fail(403, 'AGENT_CLIENT_REQUIRED', 'Agent 作品调用请勿附带浏览器 Cookie 或 Origin。');
    } else browserWrite();
    rate('music-write:' + access.uuid, 60, 60000);
  }
  // Browser audio URLs retain only a public role ID, never cookies or tokens.
  const decorate = value => {
    const adjust = work => {
      if (self && !req.headers.authorization && work.audio) work.audio.url += '?agentId=' + encodeURIComponent(access.agent.id);
      return work;
    };
    if (value.works) value.works.forEach(adjust); else adjust(value);
    return value;
  };
  if (!suffix && req.method === 'GET') { respond(res, 200, decorate(music.page(access, Number(url.searchParams.get('page') || 1)))); return true; }
  if (self && !suffix && req.method === 'POST') { respond(res, 201, decorate(music.create(access, await jsonBody(req, 100000)))); return true; }
  const match = /^\/([a-f0-9-]{36})(?:\/(audio|complete|publication))?$/.exec(suffix);
  if (match) {
    const [, id, action] = match;
    if (!action && req.method === 'GET') { respond(res, 200, decorate(music.view(music.row(id, access), { privateView: self }))); return true; }
    if (action === 'audio' && ['GET', 'HEAD'].includes(req.method)) {
      const location = await music.playback(id, access, self ? authenticated : null);
      res.writeHead(307, { Location: location, 'Content-Length': '0', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); return true;
    }
    if (self && !action && req.method === 'PATCH') { respond(res, 200, decorate(music.update(access, id, await jsonBody(req, 100000)))); return true; }
    if (self && action === 'audio' && req.method === 'POST') { respond(res, 200, decorate(await music.prepare(access, id, await jsonBody(req)))); return true; }
    if (self && action === 'complete' && req.method === 'POST') { respond(res, 200, decorate(await music.complete(access, id, await jsonBody(req), authenticated))); return true; }
    if (self && action === 'publication' && req.method === 'PUT') { respond(res, 200, decorate(music.publication(access, id, await jsonBody(req)))); return true; }
  }
  throw fail(405, 'MUSIC_METHOD', '查询 GET /api/v1/music；本人用 /api/v1/self/music 创建草稿，再 POST /ID/audio、POST /ID/complete、PUT /ID/publication。');
}
