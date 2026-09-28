// QiandengJi 直播中控台 + 主播开放 API —— 独立服务
// 读接口(开放+CORS，供别的机器拉数据)：/api/live/state /api/live/thinking /api/live/danmaku(SSE) /api/live/replies
//   /api/live/race 竞速聚合(配置驱动 world/live/race_config.json; ?history=1 附原始快照)
// 写接口(token 或回环)：/api/command(改桐人mission) /api/ask(调主播) /api/say(TTS)
// 页面：/ 中控台
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, 'public');
const PORT = Number(process.env.LIVE_PORT || 3110);
const HOST = process.env.LIVE_HOST || '0.0.0.0';           // 0.0.0.0 → 局域网可读
const PANEL = process.env.PANEL_URL || 'http://panel:9090';
const TTS = process.env.TTS_URL || 'http://tts:8100';
const QWENPAW = process.env.QWENPAW_URL || 'http://qwenpaw:8088';
const GOD_AGENT = process.env.LIVE_GOD_AGENT || 'mc-god';
const SURVIVOR_STATE = process.env.SURVIVOR_STATE_DIR || '/survivor-state';
const BILI_ROOM = process.env.BILI_ROOM || '';
const WRITE_TOKEN = process.env.LIVE_WRITE_TOKEN || '';     // 空=仅回环可写

const json = (res, code, obj, cors) => { const h = { 'Content-Type': 'application/json; charset=utf-8' }; if (cors) Object.assign(h, cors); res.writeHead(code, h); res.end(JSON.stringify(obj)); };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-live-token,authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const readBody = req => new Promise((res, rej) => { let b = ''; req.on('data', c => { b += c; if (b.length > 65536) rej(new Error('too_big')); }); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { rej(new Error('bad_json')); } }); });
const proxyGet = (url, timeoutMs = 12000) => fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(r => r.arrayBuffer().then(buf => ({ status: r.status, type: r.headers.get('content-type') || 'application/octet-stream', buf })));
const isLoopback = req => { const a = (req.socket?.remoteAddress || '').replace('::ffff:', ''); return a === '127.0.0.1' || a === '::1' || a.startsWith('127.'); };
const writeOk = req => isLoopback(req) || (WRITE_TOKEN && (req.headers['x-live-token'] === WRITE_TOKEN || req.headers.authorization === 'Bearer ' + WRITE_TOKEN));
const jget = url => fetch(url, { signal: AbortSignal.timeout(9000) }).then(r => r.json()).catch(() => null);
const rfile = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// ---- 环形缓冲（供别的机器一次性拉取）----
const recentDanmaku = [], recentReplies = [];
const push = (arr, x) => { arr.push(x); if (arr.length > 200) arr.shift(); };

// ---- 弹幕桥 + SSE 广播 ----
const sseClients = new Set();
const broadcast = obj => { const s = `data: ${JSON.stringify(obj)}\n\n`; for (const c of sseClients) { try { c.write(s); } catch {} } };
let danmakuState = { connected: false, room: BILI_ROOM || null, error: BILI_ROOM ? 'connecting' : 'no_room' };
function onDanmaku(d) { push(recentDanmaku, { ...d, at: Date.now() }); broadcast({ type: 'danmaku', ...d }); }
function startDanmakuBridge() {
  if (!BILI_ROOM) { danmakuState.error = 'no_room'; return; }
  import('./bili-danmaku.mjs').then(m => m.connectRoom(BILI_ROOM, {
    onReady: () => { danmakuState = { connected: true, room: BILI_ROOM, error: null }; broadcast({ type: 'status', ...danmakuState }); },
    onDanmaku, onError: e => { danmakuState.error = String(e).slice(0, 200); broadcast({ type: 'status', ...danmakuState }); },
  })).catch(e => { danmakuState.error = 'bridge_load_failed:' + e; });
}

// ---- 主播应答：调 mc-god ----
async function askGod(text, uid) {
  try {
    const r = await fetch(`${QWENPAW}/console/chat`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': GOD_AGENT },
      body: JSON.stringify({ input: [{ role: 'user', content: [{ type: 'text', text: `【B站直播弹幕】观众(${uid || '匿名'}): ${text}\n请以主播身份简短口语回答。` }] }], stream: false }),
      signal: AbortSignal.timeout(30000) });
    const raw = await r.text(); let reply = raw;
    try { reply = extractText(JSON.parse(raw)); } catch { reply = sseToText(raw); }
    const out = { user: uid || null, question: text, reply: (reply || '').slice(0, 800), at: Date.now() };
    push(recentReplies, out); broadcast({ type: 'reply', ...out }); return { ok: true, ...out };
  } catch (e) { return { ok: false, error: String(e).slice(0, 200) }; }
}
function extractText(j) { if (typeof j === 'string') return j; if (j?.output?.[0]?.content) return j.output.map(o => (o.content || []).map(c => c.text || '').join('')).join(''); return j?.reply || j?.text || (typeof j?.content === 'string' ? j.content : ''); }
function sseToText(s) { const t = []; for (const line of s.split('\n')) if (line.startsWith('data:')) { const p = line.slice(5).trim(); if (p && p !== '[DONE]') { try { t.push(extractText(JSON.parse(p))); } catch {} } } return t.join(''); }

// ---- 给桐人发指令：写 control.json mission ----
function setMission(text) {
  if (!text || text.length > 1200) return { ok: false, error: 'mission 需 1-1200 字' };
  const file = path.join(SURVIVOR_STATE, 'control.json');
  try { const c = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; c.mission = text; c.missionChangedAt = Date.now();
    const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(c)); fs.renameSync(tmp, file); return { ok: true, note: '已写入 control.json，≤15s 生效' }; }
  catch (e) { return { ok: false, error: String(e).slice(0, 200) }; }
}
async function thinkingSnapshot() { try { const p = await proxyGet(`${PANEL}/api/survivor-trace`); return JSON.parse(Buffer.from(p.buf).toString('utf8')); } catch { return { available: false }; } }

// ---- 竞速聚合 API（/api/live/race）——一切由 race_config.json 驱动：
// 换选手/改判据/挪路径只编辑配置文件，代码零改动。数据源全部宿主侧文件（stats/snap/base），
// 不碰 RCON、不 exec docker——规避 WSL2 端口代理抖动，接口永远拉得动。
const RACE_CONFIG = process.env.RACE_CONFIG || path.join(HERE, 'race_config.json');
const raceMove = s => { const m = (s && s['minecraft:custom']) || {};
  return Math.round(((m['minecraft:walk_one_cm'] || 0) + (m['minecraft:sprint_one_cm'] || 0)
    + (m['minecraft:walk_under_water_one_cm'] || 0) + (m['minecraft:swim_one_cm'] || 0)
    + (m['minecraft:fly_one_cm'] || 0)) / 100); };
const raceCat = (s, k) => Object.values((s && s[k]) || {}).reduce((a, b) => a + (b || 0), 0);
const raceDeath = s => ((s && s['minecraft:custom']) || {})['minecraft:deaths'] || 0;
function racResolveUuid(cfg, login) {
  try { const uc = JSON.parse(fs.readFileSync(cfg.usercache, 'utf8'));
    const e = uc.find(u => u.name === login); return e && e.uuid; } catch { return null; }
}
function raceBuild(withHistory) {
  const cfg = rfile(RACE_CONFIG);
  if (!cfg) return { ok: false, error: 'race_config.json not found at ' + RACE_CONFIG };
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  let snaps = [];
  try { snaps = fs.readFileSync(path.join(cfg.raceDir, (cfg.snapPattern || 'snap-{ymd}.jsonl').replace('{ymd}', ymd)), 'utf8')
    .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* 今天还没拍 */ }
  const lastSnap = snaps.length ? snaps[snaps.length - 1] : null;
  const players = (cfg.racers || []).map(r => {
    const uu = racResolveUuid(cfg, r.login);
    const cf = uu ? rfile(path.join(cfg.statsDir, uu + '.json')) : null;
    const cs = cf && cf.stats ? cf.stats : null;
    const base = (rfile(path.join(cfg.raceDir, (cfg.basePattern || 'base_{login}.json').replace('{login}', r.login))) || {}).raw;
    const bs = base && base.stats ? base.stats : null;
    const snapP = lastSnap && lastSnap.players ? lastSnap.players[r.login] : null;
    const hold = (snapP && snapP.hold) || {};
    const place = (snapP && snapP.place_delta) || {};
    const checks = (cfg.checks || []).map(c => {
      const have = Math.max(0, (c.source === 'place' ? place[c.key] : hold[c.key]) || 0);
      return { label: c.label, need: c.need, have, ok: have >= c.need };
    });
    return {
      login: r.login, display: r.display || r.login, uuid: uu, stats_available: !!cs,
      move_m: cs && bs ? raceMove(cs) - raceMove(bs) : null,
      mined: cs && bs ? raceCat(cs, 'minecraft:mined') - raceCat(bs, 'minecraft:mined') : null,
      crafted: cs && bs ? raceCat(cs, 'minecraft:crafted') - raceCat(bs, 'minecraft:crafted') : null,
      kills: cs && bs ? raceCat(cs, 'minecraft:killed') - raceCat(bs, 'minecraft:killed') : null,
      deaths: cs && bs ? raceDeath(cs) - raceDeath(bs) : null,
      online_h: cs && bs ? Math.round((((cs['minecraft:custom'] || {})['minecraft:play_time'] || 0) - ((bs['minecraft:custom'] || {})['minecraft:play_time'] || 0)) / 720) / 10 : null,
      checks_done: checks.filter(c => c.ok).length, checks_total: checks.length, checks,
      pos: snapP && snapP.pos || null, snap_at: lastSnap ? lastSnap.ts : null,
    };
  });
  const out = { ok: true, race: cfg.name, startedAt: cfg.startedAt, verdictAt: cfg.verdictAt,
    goal: cfg.goalText, manual_checks: cfg.manualChecks || [], players, generated_at: new Date().toISOString() };
  if (withHistory) out.history = snaps.slice(-48);
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) { res.writeHead(204, CORS); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, service: 'qiandengji-live', danmaku: danmakuState, writes: WRITE_TOKEN ? 'token' : 'loopback-only' });

    // ===== 开放读 API（CORS，别的机器直接拉）=====
    if (req.method === 'GET' && url.pathname === '/api/live/state') { const t = await thinkingSnapshot();
      return json(res, 200, { ok: true, agent: t.agent || null, routing: t.routing || null, systemOne: t.systemOne || null,
        turns: (t.turns || []).slice(0, 10).map(x => ({ turnId: x.turnId, status: x.status, goal: x.summary?.goal || null, nextFocus: x.summary?.nextFocus || null, actions: (x.actions || []).slice(0, 6).map(a => ({ tool: a.tool, status: a.status, item: a.args?.item_id || a.args?.target || null })) })),
        danmakuStatus: danmakuState, danmaku: recentDanmaku.slice(-50), replies: recentReplies.slice(-30) }, CORS); }
    if (req.method === 'GET' && url.pathname === '/api/live/thinking') { const p = await proxyGet(`${PANEL}/api/survivor-trace`); res.writeHead(p.status, { ...CORS, 'Content-Type': 'application/json' }); return res.end(Buffer.from(p.buf)); }
    if (req.method === 'GET' && url.pathname === '/api/live/replies') return json(res, 200, { ok: true, replies: recentReplies.slice(-50) }, CORS);
    // 桐人「游戏经历」统计（无 RCON，全靠 panel API + survivor 文件）
    if (req.method === 'GET' && url.pathname === '/api/live/stats') {
      const [trace, state] = await Promise.all([jget(PANEL + '/api/survivor-trace'), jget(PANEL + '/api/state')]);
      const ag = (trace && trace.agent) || {};
      let inv = null, held = null, lastPos = null;
      for (const t of ((trace && trace.turns) || [])) {
        for (const a of (t.actions || [])) {
          if (a.after) { if (!inv && a.after.inventory) inv = a.after.inventory; if (!lastPos && a.after.position) lastPos = a.after.position; }
          if (!held && a.args && (a.args.item_id || a.args.item)) held = a.args.item_id || a.args.item;
        }
        if (inv && held) break;
      }
      const guild = rfile(path.join(SURVIVOR_STATE, 'guild.json')) || {};
      const fameRow = (guild.fame || []).find ? null : null;   // guild.fame 可能是对象或数组
      const fameObj = (guild.fame && !Array.isArray(guild.fame)) ? guild.fame : (Array.isArray(guild.fame) ? (guild.fame.find(f => /kirito/i.test(f.name || '')) || {}) : {});
      const quests = (guild.quests || []).map(q => ({ questId: q.questId, type: q.type, title: q.title, status: q.status, mine: (q.claimedBy || []).includes('Kirito') }));
      const mem = rfile(path.join(SURVIVOR_STATE, 'memory.json')) || {};
      const perc = rfile(path.join(SURVIVOR_STATE, 'perception.json')) || {};
      const pb = perc.body || {};
      const wp = (state && state.waypoints) || [];
      // 近况事件（perception.view.events）+ 死亡/复活数（life-log.jsonl）
      const events = ((perc.view && perc.view.events) || []).slice(-6).map(e => ({ at: e.at, speaker: e.speaker, text: String(e.text || '').slice(0, 120) }));
      let deaths = 0;
      try { deaths = fs.readFileSync(path.join(SURVIVOR_STATE, 'life-log.jsonl'), 'utf8').split('\n').filter(l => l.includes('"id"') && l.includes('healthLowest')).length; } catch {}
      const pos = ag.position || lastPos;
      const mapCenter = (pos && pos.x != null) ? { cx: Math.round(pos.x), cz: Math.round(pos.z) } : { cx: -554, cz: 866 };
      json(res, 200, {
        ok: true,
        body: { name: ag.name || '桐人', hp: (pb.hp != null ? pb.hp : ag.hp), maxHp: ag.maxHp || 20, hunger: ag.hunger, pos, dimension: pb.dimension || null, vitals: pb.slowVitals || null, status: ag.status || ((trace && trace.routing) || {}).activeSource || null },
        map: mapCenter, events, deaths,
        nextFocus: ((mem.history || []).slice(-1)[0] || {}).nextFocus || null,
        held,
        inventory: inv ? Object.entries(inv).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count).slice(0, 40) : [],
        goal: mem.goal || ag.goal || null,
        fame: { rank: fameObj.rank, done: fameObj.done, fame: fameObj.fame, joined: fameObj.joined },
        quests, places: wp.map(w => ({ name: w.name, x: w.x, y: w.y, z: w.z, dimension: w.dimension })),
      }, CORS); return;
    }
    // 桐人思考时间线：直接读 survivor memory.json 的 history（目标/收获/下一步），最简最准
    if (req.method === 'GET' && url.pathname === '/api/live/thoughts') {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(SURVIVOR_STATE, 'memory.json'), 'utf8'));
        const thoughts = (Array.isArray(m.history) ? m.history : []).slice(-40).reverse()
          .map(x => ({ at: x.at || null, goal: x.goal || null, lesson: x.lesson || null, nextFocus: x.nextFocus || null, goalState: x.goalState || null }));
        return json(res, 200, { ok: true, now: { goal: m.goal || null, lesson: m.lesson || null, goalState: m.goalState || null, updatedAt: m.updatedAt || null }, thoughts }, CORS);
      } catch (e) { return json(res, 200, { ok: false, error: String(e).slice(0, 120), thoughts: [] }, CORS); }
    }
    // 竞速聚合：/api/live/race （?history=1 附最近48拍原始快照）——配置驱动，见 race_config.json
    if (req.method === 'GET' && url.pathname === '/api/live/race') return json(res, 200, raceBuild(url.searchParams.get('history') === '1'), CORS);
    if (req.method === 'GET' && url.pathname === '/api/live/map.png') {
      const cx = url.searchParams.get('cx') || '-554', cz = url.searchParams.get('cz') || '866', r = url.searchParams.get('r') || '40';
      try { const p = await proxyGet(`${PANEL}/api/eye/map.png?cx=${encodeURIComponent(cx)}&cz=${encodeURIComponent(cz)}&r=${encodeURIComponent(r)}`); res.writeHead(p.status, { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return res.end(Buffer.from(p.buf)); }
      catch { return json(res, 503, { error: 'map_unavailable' }, CORS); }
    }
    if (req.method === 'GET' && (url.pathname === '/api/live/danmaku' || url.pathname === '/api/danmaku')) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); sseClients.add(res);
      res.write(`data: ${JSON.stringify({ type: 'status', ...danmakuState })}\n\n`); req.on('close', () => sseClients.delete(res)); return; }

    // ===== 中控台页自用（回环）+ 写接口（token/回环）=====
    if (req.method === 'GET' && url.pathname === '/api/thinking') { const p = await proxyGet(`${PANEL}/api/survivor-trace`); res.writeHead(p.status, { 'Content-Type': 'application/json' }); return res.end(Buffer.from(p.buf)); }
    if (req.method === 'GET' && url.pathname === '/api/say') { if (!writeOk(req)) return json(res, 401, { error: 'need LIVE_WRITE_TOKEN' }); const sp = url.searchParams; const t = sp.get('text') || ''; if (!t) return json(res, 400, { error: 'need text' });
      // 按 TTS 接入文档透传：voice/speed(0.5-2.0)/emo/emo_alpha/emo_text/format
      const voice = sp.get('voice') || 'goddess';
      const fwd = { text: t.slice(0, 600), voice: ({ kirito: 'kirito_saotalk_28', yui: 'yui_youtube_28' })[voice] || voice, format: sp.get('format') || 'mp3' };
      for (const k of ['speed', 'emo', 'emo_alpha', 'emo_text']) { const v = sp.get(k); if (v) fwd[k] = v; }
      const p = await proxyGet(`${TTS}/tts?${new URLSearchParams(fwd)}`, 90000); res.writeHead(p.status, { 'Content-Type': p.type && p.type.includes('wav') ? 'audio/wav' : 'audio/mpeg' }); return res.end(Buffer.from(p.buf)); }
    if (req.method === 'POST' && url.pathname === '/api/ask') { if (!writeOk(req)) return json(res, 401, { error: 'need LIVE_WRITE_TOKEN' }); const b = await readBody(req); return json(res, 200, await askGod(String(b.text || '').slice(0, 500), b.uid)); }
    if (req.method === 'POST' && url.pathname === '/api/command') { if (!writeOk(req)) return json(res, 401, { error: 'need LIVE_WRITE_TOKEN' }); const b = await readBody(req); return json(res, 200, setMission(String(b.mission || ''))); }

    let f = url.pathname === '/' ? '/index.html' : url.pathname === '/stats' ? '/stats.html' : url.pathname;
    const file = path.join(PUB, path.normalize(f).replace(/^(\.\.[\/\\])+/, ''));
    if (file.startsWith(PUB) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type }); return res.end(fs.readFileSync(file)); }
    return json(res, 404, { error: 'not_found' });
  } catch (e) { return json(res, 500, { error: 'live_request_unavailable', detail: String(e).slice(0, 120) }); }
});
server.listen(PORT, HOST, () => { console.log(`[live] :${PORT} host=${HOST} 弹幕=${BILI_ROOM || '未接'} 写鉴权=${WRITE_TOKEN ? 'token' : '仅回环'}`); startDanmakuBridge(); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)));
