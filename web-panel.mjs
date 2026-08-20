import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = Number(process.env.PANEL_PORT ?? 9090)
const DATA_DIR = resolve(process.env.MC_DATA_DIR || resolve(process.cwd(), 'data'))
const STATUS_PATH = resolve(DATA_DIR, 'status.json') // 兼容旧格式（单 bot）
const MEMORY_PATH = resolve(DATA_DIR, 'mc-memory.json')
const MAGIC_PATH = resolve(DATA_DIR, 'magic-state.json')
const ATOMS_PATH = resolve(DATA_DIR, 'magic-atoms.json')
const EVENTS_PATH = resolve(DATA_DIR, 'skill-events.json')
const WORLDDB_PATH = resolve(DATA_DIR, 'world.db')
const NPCFEED_PATH = resolve(DATA_DIR, 'npc-feed.jsonl')
const WORLD_HB_PATH = resolve(DATA_DIR, 'world-heartbeat.json') // 世界进程心跳（mc-god 死亡轮询每 20s 落盘）

// ── mc-brain.log 思考账本（结构化 JSONL：ts/step/thought/goal/tool/args/outcome/shots）──
// session 架构下 status.recentSteps 恒为空（2026-08-20 断流案），从账本直接捞。
// mtime 缓存：文件没变就不重读（账本 9.5MB，轮询每 5s 一次不能全量重读）。
let brainCache = { mtime: 0, entries: [] }
function readBrainLog() {
  const p = join(DATA_DIR, 'mc-brain.log')
  try {
    const mt = statSync(p).mtimeMs
    if (mt === brainCache.mtime) return brainCache.entries
    const entries = []
    for (const ln of readFileSync(p, 'utf-8').split('\n')) {
      const s = ln.trim()
      if (!s.startsWith('{')) continue
      try {
        const e = JSON.parse(s)
        // shots 在账本里是 Python list 的字符串 repr，统一抽成数组
        let shots = []
        if (Array.isArray(e.shots)) shots = e.shots
        else if (typeof e.shots === 'string') shots = e.shots.match(/[\w./-]+\.jpe?g/gi) || []
        else if (typeof e.shot === 'string' && e.shot.includes('/')) shots = [e.shot]
        entries.push({ ts: e.ts, step: e.step, thought: e.thought, goal: e.goal, tool: e.tool, args: e.args, outcome: e.outcome, shots })
      } catch { /* 脏行跳过 */ }
    }
    brainCache = { mtime: mt, entries }
    return entries
  } catch {
    return []
  }
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return fallback
  }
}

// 编年史：直接读世界进程的 world.db（read-only，短锁冲突时静默降级为空表）
function readChronicle(limit = 40) {
  try {
    if (!existsSync(WORLDDB_PATH)) return []
    const db = new DatabaseSync(WORLDDB_PATH, { readOnly: true })
    try {
      const rows = db
        .prepare('SELECT at, type, actor, detail_json FROM chronicle ORDER BY seq DESC LIMIT ?')
        .all(limit)
      return rows.map((r) => {
        let detail = {}
        try { detail = JSON.parse(r.detail_json || '{}') } catch { /* keep {} */ }
        return { at: r.at, type: r.type, actor: r.actor, detail }
      })
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

// 村口实况：mc_npc.py 写的 npc-feed.jsonl（穿越者×NPC 对话与行为，倒序取尾部）
function readNpcFeed(limit = 24) {
  try {
    if (!existsSync(NPCFEED_PATH)) return []
    const lines = readFileSync(NPCFEED_PATH, 'utf-8').split('\n').filter(Boolean)
    return lines.slice(-limit).reverse().map((ln) => {
      try { return JSON.parse(ln) } catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
}

function apiState() {
  const memory = readJson(MEMORY_PATH, null)
  const mem = {
    base: memory?.base ?? null,
    publicChest: memory?.publicChest ?? null,
    currentGoal: memory?.currentGoal ?? null,
    resourcePoints: memory?.resourcePoints ?? {},
  }

  // 多 bot：每个穿越者写 status-<username>.json，这里扫描发现全部。
  // 陈旧即离线：updatedAt 超 10 分钟未更新（进程暴毙没写下线记号）→ online 强制为 false，
  // 防止旧世界残影被当作在线画在地图上（2026-08-20 鸣人残影案）。
  const STALE_MS = 10 * 60 * 1000
  let bots = []
  try {
    const files = readdirSync(DATA_DIR).filter((f) => f.startsWith('status-') && f.endsWith('.json'))
    for (const f of files) {
      const st = readJson(join(DATA_DIR, f), null)
      if (!st?.bot) continue
      const t = Date.parse(st.updatedAt || st.bot.updatedAt || '') || 0
      if (t && Date.now() - t > STALE_MS && st.bot.online) st.bot.online = false
      bots.push(st)
    }
  } catch {
    bots = []
  }
  // 兼容旧单 bot 格式：没有 per-bot 文件时读 status.json。
  if (bots.length === 0) {
    const st = readJson(STATUS_PATH, null)
    if (st?.bot) bots.push(st)
  }
  bots.sort((a, b) => (a.bot?.username ?? '').localeCompare(b.bot?.username ?? ''))

  // 思考流兜底：status.recentSteps 为空时，从 mc-brain.log 账本按归属（shots 路径前缀）补尾 30 条。
  // 管道修复（session 模式回写 recentSteps）后 status 自带数据，此兜底自动让位。
  const brain = readBrainLog()
  for (const st of bots) {
    if (st.bot?.recentSteps?.length) continue
    const name = st.bot?.username
    if (!name) continue
    const own = brain.filter((e) => e.shots.some((s) => s.startsWith(name + '/')))
    if (own.length) st.bot.recentSteps = own.slice(-30)
  }

  const latest = bots.reduce((max, b) => {
    const t = b.updatedAt || b.bot?.updatedAt
    return t && (!max || t > max) ? t : max
  }, null)

  // 魔法/技能状态（世界侧 magic-state.json，按 username 对齐）
  const magicPlayers = readJson(MAGIC_PATH, {})?.players ?? {}
  // 法术 id -> 中文名
  const atomsRaw = readJson(ATOMS_PATH, {})?.atoms ?? []
  const atomNames = {}
  for (const a of atomsRaw) atomNames[a.id] = a.name ?? a.id
  // 被动天赋定义（skill-events.json）
  const passiveDefs = readJson(EVENTS_PATH, {})?.passives ?? []

  return {
    updatedAt: latest,
    bots,
    memory: mem,
    magic: magicPlayers,
    atomNames,
    passives: passiveDefs,
    chronicle: readChronicle(40),
    npcFeed: readNpcFeed(24),
    world: readJson(WORLD_HB_PATH, null),
  }
}

const PAGE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>穿越者观察面板</title>
<style>
  :root { --bg:#0d1117; --card:#161b22; --line:#30363d; --text:#e6edf3; --dim:#8b949e; --green:#3fb950; --gold:#d29922; --red:#f85149; --blue:#58a6ff; --purple:#bc8cff; }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif; overflow:hidden; display:flex; flex-direction:column; }
  /* ── 顶栏 ── */
  .topbar { display:flex; align-items:center; gap:14px; padding:8px 16px; border-bottom:1px solid var(--line); background:var(--card); flex:0 0 auto; min-width:0; }
  .brand { display:flex; align-items:center; gap:8px; font-size:16px; font-weight:600; white-space:nowrap; }
  .dot { width:10px; height:10px; border-radius:50%; background:var(--dim); display:inline-block; flex:0 0 auto; }
  .dot.on { background:var(--green); box-shadow:0 0 8px var(--green); }
  .sub { color:var(--dim); font-size:12px; font-weight:400; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .worldchip { font-size:12px; padding:3px 10px; border-radius:12px; border:1px solid var(--line); white-space:nowrap; color:var(--dim); flex:0 0 auto; }
  .worldchip.on { color:var(--green); border-color:var(--green); }
  .worldchip.off { color:#f85149; border-color:#f85149; animation:wpulse 1.2s infinite; }
  @keyframes wpulse { 50% { opacity:.45; } }
  .tabs { display:flex; gap:8px; overflow-x:auto; flex:0 1 auto; min-width:0; scrollbar-width:thin; }
  .tab { display:flex; align-items:center; gap:7px; background:var(--card); border:1px solid var(--line); border-radius:18px; padding:5px 12px; cursor:pointer; font-size:13px; color:var(--dim); transition:all .15s; white-space:nowrap; flex:0 0 auto; }
  .tab:hover { border-color:var(--dim); color:var(--text); }
  .tab.active { border-color:var(--green); color:var(--text); background:#1c2b22; }
  .tab .tdot { width:7px; height:7px; border-radius:50%; background:var(--dim); flex:0 0 auto; }
  .tab .tdot.on { background:var(--green); }
  .tab .tavatar { width:17px; height:17px; border-radius:3px; image-rendering:pixelated; border:1px solid var(--line); flex:0 0 auto; }
  .tab .lv { font-size:10px; color:var(--gold); border:1px solid rgba(210,153,34,.4); border-radius:8px; padding:0 5px; flex:0 0 auto; }
  .spacer { flex:1 1 auto; }
  /* ── 主区 ── */
  .main { flex:1 1 auto; display:flex; gap:12px; padding:12px 16px; min-height:0; }
  .left { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:12px; min-height:0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .card-head { display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
  .card h2 { font-size:13px; margin:0; color:var(--dim); font-weight:600; letter-spacing:1px; white-space:nowrap; }
  .card-head .muted { font-size:11px; }
  /* viewer */
  .viewer-card { flex:1 1 58%; min-height:220px; display:flex; flex-direction:column; }
  .viewer-wrap { position:relative; flex:1 1 auto; min-height:0; background:#000; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .viewer-frame { position:absolute; inset:0; width:100%; height:100%; border:0; }
  .vbtns { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .vbtn { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:3px 10px; cursor:pointer; font-size:12px; color:var(--dim); transition:all .15s; }
  .vbtn:hover { border-color:var(--dim); color:var(--text); }
  .vbtn.active { border-color:var(--blue); color:var(--text); background:#12233a; }
  /* 全屏模式：viewer 占满整个 main */
  body.vmax .side, body.vmax .steps-card { display:none; }
  body.vmax .viewer-card { flex:1 1 auto; }
  /* 思考流 */
  .steps-card { flex:1 1 42%; min-height:150px; display:flex; flex-direction:column; }
  .steps-scroll { flex:1 1 auto; overflow-y:auto; min-height:0; }
  .step { border-left:2px solid var(--line); padding:8px 0 8px 12px; margin-bottom:10px; }
  .step .head { font-size:12px; color:var(--dim); margin-bottom:4px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .step .tool { font-family:monospace; font-size:11px; color:var(--gold); word-break:break-all; min-width:0; }
  .step .thought { font-size:13px; margin:2px 0; overflow-wrap:anywhere; }
  .step .goal { font-size:12px; color:var(--green); margin:2px 0; }
  .step .outcome { font-size:11px; color:var(--dim); font-family:monospace; word-break:break-all; overflow-wrap:anywhere; }
  .step .shot { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
  .step .shot img { flex:1 1 160px; max-width:640px; border:1px solid var(--line); border-radius:6px; cursor:zoom-in; display:block; object-fit:cover; max-height:140px; }
  .step .shot:has(img:only-child) img { width:100%; }
  .empty { color:var(--dim); font-size:13px; text-align:center; padding:20px 0; }
  /* ── 侧栏 ── */
  .side { flex:0 0 350px; overflow-y:auto; display:flex; flex-direction:column; gap:12px; min-height:0; scrollbar-width:thin; }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:5px 12px; font-size:13px; }
  .kv .k { color:var(--dim); white-space:nowrap; }
  .kv .v { word-break:break-all; }
  .hp { color:var(--green); } .food { color:var(--gold); } .bad { color:var(--red); }
  /* 等级徽章 */
  .lv-badge { font-size:12px; color:var(--gold); border:1px solid rgba(210,153,34,.5); background:rgba(210,153,34,.08); border-radius:10px; padding:1px 9px; white-space:nowrap; }
  /* 生命条 */
  .vital { display:flex; align-items:center; gap:8px; margin:6px 0; font-size:12px; }
  .vlabel { width:58px; color:var(--dim); white-space:nowrap; flex:0 0 auto; }
  .vbar { flex:1 1 auto; height:10px; background:#0a0e13; border:1px solid var(--line); border-radius:6px; overflow:hidden; }
  .vfill { height:100%; border-radius:5px; transition:width .4s; }
  .vfill.hp { background:linear-gradient(90deg,#2ea043,#3fb950); }
  .vfill.hp.low { background:linear-gradient(90deg,#b62324,#f85149); }
  .vfill.food { background:linear-gradient(90deg,#9e6a03,#d29922); }
  .vfill.mana { background:linear-gradient(90deg,#6e40c9,#bc8cff); }
  .vnum { width:64px; text-align:right; color:var(--dim); font-family:monospace; flex:0 0 auto; }
  /* chips */
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { background:#21262d; border:1px solid var(--line); border-radius:14px; padding:2px 9px; font-size:12px; color:var(--text); }
  .chip.gold { border-color:rgba(210,153,34,.55); color:var(--gold); background:rgba(210,153,34,.08); }
  .chip.blue { border-color:rgba(88,166,255,.45); color:var(--blue); background:rgba(88,166,255,.07); }
  .inv-scroll { max-height:170px; overflow-y:auto; scrollbar-width:thin; align-content:flex-start; }
  /* GM 操作行 */
  .gm-row { display:flex; gap:6px; margin-top:10px; align-items:center; flex-wrap:wrap; }
  .gm-row input { background:#0d1117; border:1px solid var(--line); border-radius:8px; color:var(--text); padding:5px 9px; font-size:12px; width:120px; }
  .gm-row button { background:#21262d; border:1px solid var(--line); border-radius:8px; padding:5px 10px; color:var(--text); cursor:pointer; font-size:12px; }
  .gm-row button:hover { border-color:var(--green); }
  .muted { color:var(--dim); font-size:12px; }
  /* 皮肤选择器 */
  .skchip { display:inline-flex; align-items:center; gap:5px; background:#21262d; border:1px solid var(--line); border-radius:6px; padding:2px 7px 2px 2px; font-size:11px; color:var(--dim); }
  .skchip img { width:22px; height:22px; image-rendering:pixelated; border-radius:3px; border:1px solid var(--line); display:block; }
  .skrow { display:flex; align-items:center; gap:8px; margin:5px 0; font-size:12px; }
  .skrow .skname { font-family:monospace; flex:0 0 118px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .skrow select { flex:1 1 auto; background:#0d1117; border:1px solid var(--line); border-radius:8px; color:var(--text); padding:4px 6px; font-size:12px; max-width:200px; }
  /* 被动天赋 */
  .passive { border:1px solid var(--line); border-radius:8px; padding:7px 10px; margin-bottom:7px; background:#11151c; }
  .passive.unlocked { border-color:rgba(188,140,255,.4); }
  .passive.active { border-color:var(--red); box-shadow:0 0 10px rgba(248,81,73,.35); animation:pulse 1.6s infinite; }
  @keyframes pulse { 0%,100% { box-shadow:0 0 6px rgba(248,81,73,.25);} 50% { box-shadow:0 0 14px rgba(248,81,73,.55);} }
  .prow { display:flex; align-items:center; gap:8px; font-size:12px; margin-bottom:5px; }
  .pname { font-weight:600; }
  .pstate { margin-left:auto; font-size:11px; color:var(--dim); white-space:nowrap; }
  .passive.unlocked .pstate { color:var(--purple); }
  .passive.active .pstate { color:var(--red); font-weight:700; }
  .pbar { height:6px; background:#0a0e13; border-radius:4px; overflow:hidden; border:1px solid #21262d; }
  .pfill { height:100%; background:linear-gradient(90deg,#1f6feb,#58a6ff); border-radius:4px; transition:width .4s; }
  .passive.unlocked .pfill { background:linear-gradient(90deg,#8957e5,#bc8cff); }
  .pdesc { font-size:11px; color:var(--dim); margin-top:4px; }
  /* 地图 */
  .map-btns { display:flex; gap:6px; margin-bottom:8px; align-items:center; flex-wrap:wrap; }
  .map-wrap { display:flex; justify-content:center; }
  canvas#map { width:100%; max-width:520px; aspect-ratio:1/1; background:#0a0e13; border:1px solid var(--line); border-radius:8px; cursor:grab; }
  .legend { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; font-size:11px; color:var(--dim); }
  .legend span { display:inline-flex; align-items:center; gap:4px; }
  .legend i { width:9px; height:9px; border-radius:2px; display:inline-block; }
  /* 编年史 */
  .chron { max-height:260px; overflow-y:auto; font-size:12px; scrollbar-width:thin; }
  .chron .ce { display:flex; gap:8px; padding:4px 0; border-bottom:1px dashed #21262d; align-items:baseline; }
  .chron .ct { color:var(--dim); font-family:monospace; font-size:11px; flex:0 0 auto; }
  .chron .cx { overflow-wrap:anywhere; min-width:0; }
  /* 响应式：窄屏退化为纵向堆叠 */
  @media (max-width: 1000px) {
    body { overflow:auto; }
    .main { flex-direction:column; }
    .left { flex:0 0 auto; }
    .viewer-card { flex:0 0 auto; }
    .viewer-wrap { height:44vh; flex:0 0 auto; }
    .steps-card { flex:0 0 auto; }
    .steps-scroll { max-height:40vh; }
    .side { flex:0 0 auto; overflow:visible; }
  }
</style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><span class="dot" id="dot"></span>穿越者观察面板 <span class="sub" id="sub"></span></div>
    <span class="worldchip" id="worldchip">世界…</span>
    <div class="tabs" id="tabs"></div>
    <div class="spacer"></div>
  </header>

  <div class="main">
    <div class="left">
      <div class="card viewer-card">
        <div class="card-head">
          <h2 id="viewer-title">视角</h2>
          <div class="vbtns">
            <button class="vbtn" id="vbtn-third">环绕跟随</button>
            <button class="vbtn" id="vbtn-first">TA 的眼睛</button>
            <button class="vbtn" id="vbtn-reset">重置镜头</button>
            <button class="vbtn" id="vbtn-max" title="放大 3D 画面，隐藏其他面板">⛶ 全屏</button>
          </div>
        </div>
        <div class="viewer-wrap">
          <iframe id="viewer-frame" class="viewer-frame" loading="lazy"></iframe>
        </div>
      </div>

      <div class="card steps-card">
        <div class="card-head"><h2 id="steps-title">思考流</h2><span class="muted">最新在上 · 空白说明 bot 离线</span></div>
        <div class="steps-scroll" id="steps"><div class="empty">还没有数据</div></div>
      </div>
    </div>

    <div class="side">
      <div class="card">
        <div class="card-head"><h2>状态</h2><span class="lv-badge" id="lv-badge" style="display:none"></span><span id="sleep-chip" style="display:none" class="chip">💤 睡觉中</span></div>
        <div id="vitals"></div>
        <div class="kv" id="status"></div>
        <div class="gm-row">
          <input id="gm-name" placeholder="你的游戏名">
          <button id="gm-tp">传过去</button>
          <button id="gm-tp-bring">拉过来</button>
          <span class="muted" id="gm-msg"></span>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>技能与被动</h2><span class="muted" id="skill-sub"></span></div>
        <div id="skills"></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>皮肤</h2><span class="muted" id="skin-note">指派后下次入服生效（在线需重连）</span></div>
        <div class="chips" id="skin-presets" style="margin-bottom:8px"><span class="empty" style="padding:6px 0">加载中…</span></div>
        <div id="skin-assign"><span class="empty" style="padding:6px 0">加载中…</span></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>小地图</h2><span class="muted">滚轮缩放 · 拖拽平移 · 双击回跟随</span></div>
        <div class="map-btns">
          <button class="vbtn" id="zoom-in" title="放大">🔍＋</button>
          <button class="vbtn" id="zoom-out" title="缩小">🔍－</button>
          <button class="vbtn" id="zoom-home" title="回到跟随">🎯 回跟随</button>
        </div>
        <div class="map-wrap"><canvas id="map" width="520" height="520"></canvas></div>
        <div class="legend" id="legend"></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>村口实况</h2><span class="muted">穿越者 × NPC 对话与行为</span></div>
        <div class="chron" id="npcfeed"><div class="empty">暂无记录</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>编年史</h2><span class="muted">世界事件流</span></div>
        <div class="chron" id="chronicle"><div class="empty">暂无记录</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>背包</h2><span class="muted" id="inv-sub"></span></div>
        <div class="chips inv-scroll" id="inv"></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>记忆</h2></div>
        <div class="kv" id="memory"></div>
      </div>
    </div>
  </div>

<script>
let state = { bots: [], memory: {}, magic: {}, atomNames: {}, passives: [], chronicle: [], npcFeed: [] };
let currentUser = null; // 当前选中的 bot username
let viewMode = localStorage.getItem('viewMode') || 'third'; // third | first
let mapState = { range: 128, offsetX: 0, offsetZ: 0, follow: true };
let drag = null; // { startX, startY, startOffsetX, startOffsetZ, moved }

const RES_TYPES = [
  ['coal_ore', '煤矿', '#6e7681'],
  ['iron_ore', '铁矿', '#db6d28'],
  ['cobblestone', '圆石', '#8b949e'],
  ['oak_log', '橡木', '#9a6700'],
  ['spruce_log', '云杉', '#2ea043'],
];

const METRIC_NAMES = { hpRatio: '生命', foodRatio: '饱食' };
const EFF_NAMES = {
  'minecraft:strength': '力量', 'minecraft:resistance': '抗性', 'minecraft:speed': '迅捷',
  'minecraft:haste': '急迫', 'minecraft:regeneration': '再生', 'minecraft:night_vision': '夜视',
  'minecraft:fire_resistance': '避火', 'minecraft:water_breathing': '水息',
  'minecraft:invisibility': '隐身', 'minecraft:jump_boost': '跳跃', 'minecraft:saturation': '饱腹',
};

async function fmtTime(ts) {
  if (!ts) return '';
  const t = new Date(ts), now = Date.now();
  const sec = Math.max(0, Math.round((now - t.getTime()) / 1000));
  if (sec < 60) return sec + ' 秒前';
  if (sec < 3600) return Math.round(sec/60) + ' 分钟前';
  return t.toLocaleString('zh-CN');
}

function botOf(username) {
  return state.bots.find((b) => b.bot?.username === username) || null;
}
function magicOf(username) {
  return (state.magic || {})[username] || null;
}
function condText(c) {
  if (!c) return '';
  return (METRIC_NAMES[c.metric] || c.metric) + (c.op || '<') + Math.round((c.threshold || 0) * 100) + '%';
}
function evalCond(c, mg) {
  if (!c || !mg) return false;
  const v = mg[c.metric];
  if (v == null) return false;
  return c.op === '<=' ? v <= c.threshold : v < c.threshold;
}
function effDesc(def) {
  const e = def.effect || {};
  if (e.kind === 'mc_effect') {
    const n = EFF_NAMES[e.mcId] || (e.mcId || '').replace('minecraft:', '');
    return n + '（' + condText(e.when) + '时持续）';
  }
  if (e.kind === 'regen_multiplier') return '回蓝 ×' + e.multiplier + '（' + condText(e.when) + '时）';
  return e.kind || '';
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- 皮肤系统：/skins/<username小写>.png，加载后提取脸 8x8 ----
const skinCache = {}; // username -> { img, face(canvas), faceURL, ok }
function skinFor(username) {
  if (!username) return skinCache[username] || null;
  if (skinCache[username]) return skinCache[username];
  const entry = { img: new Image(), face: null, faceURL: null, ok: false };
  skinCache[username] = entry;
  entry.img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(entry.img, 8, 8, 8, 8, 0, 0, 8, 8); // 皮肤布局：脸在 (8,8)-(16,16)
      entry.face = c;
      entry.faceURL = c.toDataURL();
      entry.ok = true;
      renderTabs(); drawMap();
    } catch (e) { /* 皮肤图损坏则保持圆点 */ }
  };
  entry.img.src = '/skins/' + username.toLowerCase() + '.png';
  return entry;
}

// ---- 皮肤选择器：预设墙 + 白名单玩家指派（写 skins.json -> skin-proxy 热加载） ----
let skinData = { presets: [], assignments: {}, whitelist: [] };
async function loadSkins() {
  try {
    const r = await fetch('/api/skins');
    if (r.ok) skinData = await r.json();
  } catch {}
  renderSkins();
}
function renderSkins() {
  const pre = document.getElementById('skin-presets');
  if (skinData.presets && skinData.presets.length) {
    pre.innerHTML = skinData.presets.map((p) =>
      '<span class="skchip" title="' + esc(p.name) + '"><img loading="lazy" src="/skins/' + esc(p.png) + '" onerror="this.parentNode.style.display=&#39;none&#39;">' + esc(p.displayName) + '</span>').join('');
  } else {
    pre.innerHTML = '<span class="empty" style="padding:6px 0">skins.json 无预设（跑 fetch_presets.py 生成）</span>';
  }
  const el = document.getElementById('skin-assign');
  const names = (skinData.whitelist && skinData.whitelist.length) ? skinData.whitelist : Object.keys(skinData.assignments || {});
  if (!names.length) { el.innerHTML = '<span class="empty" style="padding:6px 0">白名单为空</span>'; return; }
  el.innerHTML = names.map((n) => {
    const cur = (skinData.assignments || {})[n] || '';
    const opts = ['<option value="">默认（不注入）</option>'].concat((skinData.presets || []).map((p) =>
      '<option value="' + esc(p.name) + '"' + (cur === p.name ? ' selected' : '') + '>' + esc(p.displayName) + '</option>')).join('');
    return '<div class="skrow"><span class="skname">' + esc(n) + '</span><select data-u="' + esc(n) + '">' + opts + '</select></div>';
  }).join('');
  el.querySelectorAll('select').forEach((s) => s.addEventListener('change', async () => {
    const un = s.getAttribute('data-u'), v = s.value;
    const note = document.getElementById('skin-note');
    note.textContent = '写入中…';
    try {
      const r = await fetch('/api/skins/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: un, preset: v }),
      });
      const j = await r.json();
      note.textContent = j.ok ? (un + ' → ' + (v || '默认') + ' ✓ 下次入服生效') : ('失败: ' + (j.error || r.status));
    } catch (e) { note.textContent = '失败: ' + e; }
    loadSkins();
  }));
}

function renderTabs() {
  const el = document.getElementById('tabs');
  if (!state.bots.length) {
    el.innerHTML = '<span class="muted">暂无穿越者在线（bot 未运行）</span>';
    return;
  }
  el.innerHTML = state.bots.map((b) => {
    const bot = b.bot || {};
    const on = !!bot.online;
    const name = bot.personaName || bot.username;
    const cls = currentUser === bot.username ? 'tab active' : 'tab';
    const sk = skinFor(bot.username);
    const avatar = (sk && sk.ok) ? '<img class="tavatar" src="' + sk.faceURL + '">' : '';
    const mg = magicOf(bot.username);
    const lv = mg && mg.level ? '<span class="lv">Lv' + mg.level + '</span>' : '';
    return '<div class="' + cls + '" data-u="' + esc(bot.username) + '">'
      + avatar
      + '<span class="tdot ' + (on ? 'on' : '') + '"></span>'
      + '<span>' + esc(name) + '</span>'
      + lv
      + (on ? '' : '<span style="font-size:10px;color:var(--dim)">(离线)</span>')
      + '</div>';
  }).join('');
  el.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      currentUser = t.getAttribute('data-u');
      renderTabs();
      renderCurrent();
      drawMap();
    });
  });
}

// 生命条 HTML（HP / 饱食 / 魔力）
function renderVitals(bot, mg) {
  const el = document.getElementById('vitals');
  if (!bot.online) { el.innerHTML = ''; return; }
  const hp = bot.health ?? 0, food = bot.food ?? 0;
  const rows = [];
  rows.push('<div class="vital"><span class="vlabel">❤ 生命</span>'
    + '<div class="vbar"><div class="vfill hp' + (hp <= 6 ? ' low' : '') + '" style="width:' + Math.min(100, hp / 20 * 100) + '%"></div></div>'
    + '<span class="vnum">' + hp + '/20</span></div>');
  rows.push('<div class="vital"><span class="vlabel">🍗 饱食</span>'
    + '<div class="vbar"><div class="vfill food' + (food <= 6 ? ' low' : '') + '" style="width:' + Math.min(100, food / 20 * 100) + '%"></div></div>'
    + '<span class="vnum">' + food + '/20</span></div>');
  if (mg && mg.maxMana) {
    const mana = Math.max(0, Math.min(mg.mana ?? 0, mg.maxMana));
    rows.push('<div class="vital"><span class="vlabel">✨ 魔力</span>'
      + '<div class="vbar"><div class="vfill mana" style="width:' + (mana / mg.maxMana * 100) + '%"></div></div>'
      + '<span class="vnum">' + Math.round(mana) + '/' + mg.maxMana + '</span></div>');
  }
  el.innerHTML = rows.join('');
}

// 技能与被动（天赋 / 已学法术 / 被动苦修进度）
function renderSkills() {
  const el = document.getElementById('skills');
  const sub = document.getElementById('skill-sub');
  const bot = botOf(currentUser)?.bot || {};
  const mg = magicOf(currentUser);
  const atoms = state.atomNames || {};
  if (!bot.username) { el.innerHTML = '<div class="empty">—</div>'; sub.textContent = ''; return; }
  if (!mg) {
    el.innerHTML = '<div class="empty">尚未在女神册上登记（世界进程未运行或仪式未开）</div>';
    sub.textContent = '';
    return;
  }
  const parts = [];
  // 出生天赋
  const innate = mg.innateSkill ? (atoms[mg.innateSkill] || mg.innateSkill) : null;
  parts.push('<div style="margin-bottom:8px"><span class="muted" style="font-size:11px">出生天赋</span><div class="chips" style="margin-top:4px">'
    + (innate ? '<span class="chip gold">✦ ' + esc(innate) + '</span>' : '<span class="muted">未选定（等待降临仪式）</span>')
    + '</div></div>');
  // 已学法术（🏆 = 成就「历练」解锁，其余为等级「修为」所授）
  const learned = (mg.learned || []).filter((id) => id !== mg.innateSkill);
  const viaAdv = new Set(mg.advancementSkills || []);
  parts.push('<div style="margin-bottom:10px"><span class="muted" style="font-size:11px">已学法术 ' + learned.length + '</span><div class="chips" style="margin-top:4px">'
    + (learned.length ? learned.map((id) => viaAdv.has(id)
      ? '<span class="chip gold" title="成就历练解锁">🏆 ' + esc(atoms[id] || id) + '</span>'
      : '<span class="chip blue">' + esc(atoms[id] || id) + '</span>').join('') : '<span class="muted">暂无</span>')
    + '</div></div>');
  // 被动天赋（苦修进度）
  const defs = state.passives || [];
  if (defs.length) {
    parts.push('<span class="muted" style="font-size:11px">被动天赋（苦难即修行）</span>');
    const unlockedSet = new Set(mg.passives || []);
    const progress = mg.passiveProgress || {};
    for (const def of defs) {
      const t = def.trigger || {};
      const unlocked = unlockedSet.has(def.id);
      const active = unlocked && evalCond((def.effect || {}).when || t, mg);
      const prog = Math.min(100, (progress[def.id] || 0) / (t.accumulateSec || 1) * 100);
      const cls = 'passive' + (active ? ' active' : unlocked ? ' unlocked' : '');
      const stateTxt = active ? '🔥 生效中' : unlocked ? '✦ 已觉醒' : (def.enabled === false ? '停用' : Math.round(prog) + '%');
      parts.push('<div class="' + cls + '">'
        + '<div class="prow"><span class="pname">' + esc(def.name || def.id) + '</span><span class="pstate">' + stateTxt + '</span></div>'
        + '<div class="pbar"><div class="pfill" style="width:' + (unlocked ? 100 : prog) + '%"></div></div>'
        + '<div class="pdesc">' + condText(t) + ' 累积 ' + (t.accumulateSec || '?') + 's → ' + effDesc(def)
        + (unlocked ? '' : '（已苦修 ' + Math.round(progress[def.id] || 0) + 's）') + '</div>'
        + '</div>');
    }
  }
  el.innerHTML = parts.join('');
  sub.textContent = 'Lv' + (mg.level ?? '?') + ' · ' + (mg.passives || []).length + ' 被动';
}

// 编年史事件流
function chronLine(e) {
  const d = e.detail || {};
  const actor = e.actor || '?';
  switch (e.type) {
    case 'levelup': return '<span style="color:var(--gold)">⬆</span> ' + esc(actor) + ' 升级 Lv' + (d.from ?? '?') + ' → Lv' + (d.to ?? '?') + '（魔力上限 ' + (d.maxMana ?? '?') + '）';
    case 'skill': return d.via === 'advancement'
      ? '<span style="color:var(--gold)">🏆</span> ' + esc(actor) + ' 历练觉醒：成就「' + esc(d.advancement?.replace(/^minecraft:/, '') || '') + '」获赐秘法「' + esc(d.name || d.atom || '') + '」' + (d.backfill ? '（存量回填）' : '')
      : '<span style="color:var(--purple)">✦</span> ' + esc(actor) + ' 苦修觉醒被动「' + esc(d.name || d.passive || '') + '」';
    case 'advancement': return d.backfill
      ? '<span style="color:var(--dim)">🏆</span> ' + esc(actor) + ' 历练回溯：补录 ' + (d.count ?? '?') + ' 项既有成就'
      : '<span style="color:var(--gold)">🏆</span> ' + esc(actor) + ' 达成成就「' + esc(d.name || d.id || '') + '」' + (d.desc ? '——' + esc(d.desc) : '');
    case 'passive_effect': return d.state === 'off'
      ? '<span style="color:var(--dim)">○</span> ' + esc(actor) + ' 被动「' + esc(d.name || '') + '」消退'
      : '<span style="color:var(--red)">🔥</span> ' + esc(actor) + ' 被动「' + esc(d.name || '') + '」生效';
    case 'death': return '<span style="color:var(--red)">☠</span> ' + esc(actor) + ' 死亡（累计 ' + (d.total ?? '?') + ' 次）';
    case 'presence': return d.event === 'join'
      ? '<span style="color:var(--green)">🚪</span> ' + esc(actor) + ' 降临此界'
      : '<span style="color:var(--dim)">🚪</span> ' + esc(actor) + ' 离开此界';
    case 'prayer': return '🕯 ' + esc(actor) + ' 祈祷：' + esc(String(d.wish || '').slice(0, 60));
    case 'offering': return '🙏 ' + esc(actor) + ' 供奉' + (d.summary ? '：' + esc(d.summary) : '');
    case 'migration': return '<span style="color:var(--dim)">🔧</span> ' + esc(actor) + ' 数据迁移 ' + esc(String(d.from || '')) + ' → ' + esc(String(d.to || ''));
    default: return '<span style="color:var(--dim)">·</span> ' + esc(e.type) + ' · ' + esc(actor) + (Object.keys(d).length ? ' ' + esc(JSON.stringify(d).slice(0, 70)) : '');
  }
}
function renderChronicle() {
  const el = document.getElementById('chronicle');
  const rows = (state.chronicle || []).filter((e) => e.type !== 'xp');
  if (!rows.length) { el.innerHTML = '<div class="empty">暂无记录</div>'; return; }
  el.innerHTML = rows.map((e) => {
    const t = new Date(e.at);
    const ts = isNaN(t) ? '' : t.toLocaleTimeString('zh-CN', { hour12: false });
    return '<div class="ce"><span class="ct">' + ts + '</span><span class="cx">' + chronLine(e) + '</span></div>';
  }).join('');
}

// 村口实况：npc-feed.jsonl（mc_npc.py 写入）—— 玩家点名 / NPC 回复 / 委托与看护事件
function renderNpcFeed() {
  const el = document.getElementById('npcfeed');
  if (!el) return;
  const rows = state.npcFeed || [];
  if (!rows.length) { el.innerHTML = '<div class="empty">暂无记录（MC 里 @ 村民名字即可对话）</div>'; return; }
  el.innerHTML = rows.map((e) => {
    const t = e.ts ? new Date(e.ts.replace(' ', 'T')) : null;
    const ts = t && !isNaN(t) ? t.toLocaleTimeString('zh-CN', { hour12: false }) : '';
    let line = '';
    if (e.kind === 'player') {
      line = '<span style="color:var(--dim)">🧑 ' + esc(e.who || '?') + ' → ' + esc(e.npc || '?') + '：' + esc(String(e.text || '').slice(0, 80)) + '</span>';
    } else if (e.kind === 'say') {
      const color = e.color || 'var(--green)';
      line = '<span style="color:' + color + '">&lt;' + esc(e.npc || '?') + '&gt;</span> ' + esc(String(e.text || '').slice(0, 100));
    } else if (e.kind === 'goddess') {
      line = '<span style="color:var(--gold)">[女神] ' + esc(String(e.text || '').slice(0, 90)) + '</span>';
    } else {
      line = '<span style="color:var(--gold)">✨ ' + esc(String(e.text || '').slice(0, 90)) + '</span>';
    }
    return '<div class="ce"><span class="ct">' + ts + '</span><span class="cx">' + line + '</span></div>';
  }).join('');
}

// 智能运镜：发现新鲜的 NPC 对话（带坐标）且当前穿越者就在附近 → 给 viewer iframe 发对话运镜 cue
function maybeCameraCue(s, prevFeedT) {
  try {
    if (viewMode !== 'third') return;
    const frame = document.getElementById('viewer-frame');
    if (!frame || !frame.contentWindow) return;
    const bot = botOf(currentUser)?.bot;
    if (!bot || !bot.online || !bot.position || !bot.position.x) return;
    const now = Date.now() / 1000;
    const fresh = (s.npcFeed || []).find((e) =>
      e.kind === 'say' && e.npcPos && (e.t || 0) > prevFeedT && (e.t || 0) > now - 30
      && Math.hypot(e.npcPos[0] - bot.position.x, e.npcPos[2] - bot.position.z) <= 28);
    if (fresh) {
      frame.contentWindow.postMessage({
        type: 'pv-cam', cmd: 'dialogue',
        npc: { x: fresh.npcPos[0], y: fresh.npcPos[1], z: fresh.npcPos[2] },
        ttl: 10000,
      }, '*');
    }
  } catch { /* 运镜是锦上添花，失败静默 */ }
}

// ---- 视角回落：穿越者不在线 / viewer 口探活失败 → Goddess 天眼(3050) ----
const GODDESS_PORT = 3050;
let vprobe = { port: 0, ok: false, at: 0, inflight: false }; // 探活结论缓存（10s，期间不重探）
function probeViewer(port) {
  const now = Date.now();
  if (vprobe.port === port && (vprobe.inflight || now - vprobe.at < 10000)) return;
  const prevOk = vprobe.port === port ? vprobe.ok : false; // 重探期间沿用旧结论，避免周期性闪回落
  vprobe = { port, ok: prevOk, at: now, inflight: true };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  fetch('http://' + location.hostname + ':' + port + '/', { mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
    .then(() => { vprobe = { port, ok: true, at: Date.now(), inflight: false }; })
    .catch(() => { vprobe = { port, ok: false, at: Date.now(), inflight: false }; })
    .finally(() => { clearTimeout(timer); renderCurrent(); });
}

function renderCurrent() {
  const b = botOf(currentUser);
  const bot = b?.bot || {};
  const on = !!bot.online;
  document.getElementById('dot').className = 'dot ' + (on ? 'on' : '');
  const name = bot.personaName || bot.username || '—';
  document.getElementById('steps-title').textContent = name + ' 思考流';

  // 视角 iframe：第三人称=viewerPort，第一人称=viewerPort+100（mc-bot 双端口方案）
  // 回落：无穿越者在线 / 所选穿越者 viewer 口不通 → Goddess 天眼(3050)
  const vp = Number(bot.viewerPort) || 0;
  const hasBotViewer = on && vp > 0;
  const wantPort = hasBotViewer ? (viewMode === 'first' ? vp + 100 : vp) : GODDESS_PORT;
  if (hasBotViewer) probeViewer(wantPort); // 异步探活，结论变化经缓存触发回落重渲
  const probing = hasBotViewer && vprobe.port !== wantPort; // 该口尚无结论：先信在线 bot，不闪回落
  const viewerOk = hasBotViewer ? (probing ? true : vprobe.ok) : false;
  const showPort = viewerOk ? wantPort : GODDESS_PORT;
  const frame = document.getElementById('viewer-frame');
  // 第三人称默认智能运镜(follow=smart)：平时追尾锁定，检测到穿越者×NPC 对话时自动切过肩双人构图
  const want = 'http://' + location.hostname + ':' + showPort + '/'
    + (viewerOk ? '?skin=' + (bot.username || '').toLowerCase() + (viewMode === 'first' ? '&fov=110' : '&follow=smart') : '?follow=smart')
    + '&pv=7'; // pv=镜头补丁版本，cache-bust（v7=+Goddess 回落）
  if (frame.getAttribute('src') !== want) frame.setAttribute('src', want);
  document.getElementById('viewer-title').textContent = viewerOk
    ? name + '（' + (viewMode === 'first' ? '第一人称' : '第三人称·智能运镜') + '）'
    : 'Goddess（天眼）';

  // 等级徽章 / 睡觉 chip
  const mg = magicOf(bot.username || currentUser);
  const badge = document.getElementById('lv-badge');
  if (mg && mg.level != null) {
    badge.style.display = '';
    badge.textContent = 'Lv ' + mg.level + (mg.maxMana ? ' · 魔力上限 ' + mg.maxMana : '');
  } else badge.style.display = 'none';
  document.getElementById('sleep-chip').style.display = bot.sleeping ? '' : 'none';

  renderVitals(bot, mg);
  renderSkills();
  renderChronicle();
  renderNpcFeed();

  // 基础状态 kv（正在输入时不重建，防止焦点丢失）
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (!typing) {
    const pos = bot.position ? '(' + bot.position.x + ', ' + bot.position.y + ', ' + bot.position.z + ')' : '-';
    document.getElementById('status').innerHTML = on ? [
      ['身份', name + '（' + (bot.username || '-') + '）'],
      ['状态', '<span style="color:var(--green)">在线</span>'],
      ['位置', pos],
      ['手持', esc(bot.heldItem || '空手')],
    ].map(([k, v]) => '<span class="k">' + k + '</span><span class="v">' + v + '</span>').join('')
      : '<span class="k">状态</span><span class="v bad">离线（bot 未运行）</span>';
    const gmName = localStorage.getItem('gmName') || '';
    document.getElementById('gm-name').value = gmName;
  }
  const gmInput = document.getElementById('gm-name');
  if (!gmInput.dataset.bound) {
    gmInput.dataset.bound = '1';
    gmInput.addEventListener('change', () => localStorage.setItem('gmName', gmInput.value.trim()));
    document.getElementById('gm-tp').onclick = async () => {
      const n = gmInput.value.trim();
      const msg = document.getElementById('gm-msg');
      if (!n) { msg.textContent = '先填你的游戏名'; return; }
      msg.textContent = '传送中…';
      try {
        const r = await fetch('/api/tp?as=' + encodeURIComponent(n) + '&to=' + encodeURIComponent(bot.username || currentUser));
        msg.textContent = await r.text();
      } catch (e) { msg.textContent = '失败: ' + e.message; }
    };
    document.getElementById('gm-tp-bring').onclick = async () => {
      const n = gmInput.value.trim();
      const msg = document.getElementById('gm-msg');
      if (!n) { msg.textContent = '先填你的游戏名'; return; }
      if (!bot.position) { msg.textContent = 'TA 不在线'; return; }
      msg.textContent = '传送中…';
      try {
        const r = await fetch('/api/tp?as=' + encodeURIComponent(bot.username || currentUser) + '&to=' + encodeURIComponent(n));
        msg.textContent = await r.text();
      } catch (e) { msg.textContent = '失败: ' + e.message; }
    };
  }

  const inv = bot.inventory || [];
  document.getElementById('inv-sub').textContent = inv.length ? inv.length + ' 种' : '';
  document.getElementById('inv').innerHTML = inv.length
    ? inv.map((i) => '<span class="chip">' + esc(i.name) + ' ×' + i.count + '</span>').join('')
    : '<span class="muted">空</span>';

  const steps = b?.recentSteps || [];
  document.getElementById('steps').innerHTML = steps.length
    ? steps.slice().reverse().map((st) => {
        const args = typeof st.args === 'object' && st.args && Object.keys(st.args).length
          ? ' ' + JSON.stringify(st.args)
          : (typeof st.args === 'string' && st.args && st.args !== '{}' ? ' ' + st.args : '');
        const out = (st.outcome || '').length > 120 ? String(st.outcome).slice(0, 120) + '…' : (st.outcome || '');
        const shotList = (st.shots && st.shots.length ? st.shots : (st.shot ? [st.shot] : []));
        const shot = shotList.length
          ? '<div class="shot">' + shotList.map((f) => '<img src="/shot/' + f + '" loading="lazy" data-shot="' + f + '" title="点击看大图">').join('') + '</div>'
          : '';
        const t = st.ts ? String(st.ts).slice(5, 16).replace('T', ' ') : '';
        return '<div class="step">'
          + '<div class="head"><span>#' + st.step + '</span><span class="tool">' + esc(st.tool) + esc(args) + '</span><span class="muted">' + t + '</span></div>'
          + '<div class="thought">💭 ' + esc(st.thought || '-') + '</div>'
          + '<div class="goal">🎯 ' + esc(st.goal || '-') + '</div>'
          + shot
          + '<div class="outcome">→ ' + esc(out) + '</div>'
          + '</div>';
      }).join('')
    : '<div class="empty">还没有数据</div>';
}

function mapCenter() {
  const m = state.memory || {};
  const cur = botOf(currentUser)?.bot || {};
  // 地图中心：跟随模式 = 当前 bot；手动平移后 = bot + 偏移。
  return {
    cx: (cur.position?.x ?? m.base?.x ?? 0) + mapState.offsetX,
    cz: (cur.position?.z ?? m.base?.z ?? 0) + mapState.offsetZ,
    range: mapState.range,
  };
}

function drawMap() {
  const canvas = document.getElementById('map');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const m = state.memory || {};
  const cur = botOf(currentUser)?.bot || {};
  const { cx, cz } = mapCenter();
  const RANGE = mapState.range; // 半径（格）
  const scale = W / (RANGE * 2); // px / 格

  function sx(x) { return (x - cx) * scale + W / 2; }
  function sy(z) { return (z - cz) * scale + H / 2; }

  // 网格（自适应：放大看细节时用细网格）
  ctx.strokeStyle = '#1b222c';
  ctx.lineWidth = 1;
  const step = RANGE <= 16 ? 1 : RANGE <= 64 ? 4 : RANGE <= 256 ? 16 : 64;
  const x0 = Math.floor((cx - RANGE) / step) * step;
  const z0 = Math.floor((cz - RANGE) / step) * step;
  for (let x = x0; x <= cx + RANGE; x += step) {
    ctx.beginPath(); ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), H); ctx.stroke();
  }
  for (let z = z0; z <= cz + RANGE; z += step) {
    ctx.beginPath(); ctx.moveTo(0, sy(z)); ctx.lineTo(W, sy(z)); ctx.stroke();
  }
  // 坐标轴
  ctx.strokeStyle = '#30363d';
  ctx.beginPath(); ctx.moveTo(sx(cx), 0); ctx.lineTo(sx(cx), H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, sy(cz)); ctx.lineTo(W, sy(cz)); ctx.stroke();

  // 资源点
  const rp = m.resourcePoints || {};
  RES_TYPES.forEach(([key, label, color]) => {
    const pts = rp[key] || [];
    ctx.fillStyle = color;
    for (const p of pts) {
      const px = sx(p.x), py = sy(p.z);
      if (px < -2 || py < -2 || px > W + 2 || py > H + 2) continue;
      ctx.fillRect(px - 1, py - 1, 2.5, 2.5);
    }
  });

  // 基地 / 公共箱
  if (m.base) {
    const bx = sx(m.base.x), by = sy(m.base.z);
    ctx.fillStyle = '#d29922';
    ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d29922'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (m.publicChest) {
    const px = sx(m.publicChest.x), py = sy(m.publicChest.z);
    ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 2;
    ctx.strokeRect(px - 4, py - 4, 8, 8);
  }

  // 其他 bot（紫色圆点 / 皮肤头像）
  state.bots.forEach((b) => {
    const bot = b.bot || {};
    if (!bot.online || !bot.position) return;
    if (bot.username === currentUser) return;
    const px = sx(bot.position.x), py = sy(bot.position.z);
    if (px < -10 || py < -10 || px > W + 10 || py > H + 10) return;
    const sk = skinFor(bot.username);
    if (sk && sk.ok && sk.face) {
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fillStyle = '#0d1117'; ctx.fill();
      ctx.clip();
      ctx.drawImage(sk.face, px - 7, py - 7, 14, 14);
      ctx.restore();
      ctx.strokeStyle = '#bc8cff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = '#bc8cff';
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#e6edf3'; ctx.font = '10px sans-serif';
    ctx.fillText(bot.personaName || bot.username, px + 6, py - 6);
  });

  // 当前 bot（绿色 / 皮肤头像 + 朝向箭头）
  if (cur.position) {
    const px = sx(cur.position.x), py = sy(cur.position.z);
    const sk = skinFor(currentUser);
    if (sk && sk.ok && sk.face) {
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fillStyle = '#0d1117'; ctx.fill();
      ctx.clip();
      ctx.drawImage(sk.face, px - 9, py - 9, 18, 18);
      ctx.restore();
      ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = '#3fb950';
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    }
    if (cur.yaw != null) {
      // mineflayer yaw：面向 = (-sin(yaw), cos(yaw))，py 向下 = +z
      const dx = -Math.sin(cur.yaw), dy = Math.cos(cur.yaw);
      const L = 16;
      const hx = px + dx * L, hy = py + dy * L;
      ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = '#3fb950';
      ctx.beginPath(); ctx.arc(hx, hy, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 比例尺 + 图例
  document.getElementById('legend').innerHTML = '<span><i style="background:#3fb950"></i>当前穿越者</span>'
    + '<span><i style="background:#bc8cff"></i>其他穿越者</span>'
    + '<span><i style="background:#d29922"></i>基地</span>'
    + '<span><i style="background:#58a6ff"></i>公共箱</span>'
    + RES_TYPES.map(([k, l, c]) => '<span><i style="background:' + c + '"></i>' + l + '</span>').join('')
    + '<span style="margin-left:auto">范围 ±' + RANGE + ' 格</span>';
}

// 世界进程健康徽章（2026-08-18）：mc-god 心跳 >60s 视为离线——面板是独立进程，
// 世界死了面板照常绿，靠这枚徽章暴露盲区（事故复盘产物）。
function renderWorldChip(w) {
  const el = document.getElementById('worldchip');
  if (!el) return;
  if (!w || !w.ts) { el.className = 'worldchip off'; el.textContent = '⚠ 世界进程无心跳'; return; }
  const age = (Date.now() - w.ts) / 1000;
  if (age > 60) {
    el.className = 'worldchip off';
    el.textContent = '⚠ 世界进程离线 ' + (age > 95 ? Math.round(age / 60) + ' 分钟' : Math.round(age) + ' 秒');
  } else {
    el.className = 'worldchip on';
    const n = (w.watching || []).length;
    el.textContent = '世界在线 · 守望 ' + n + ' 人 · ' + Math.round(age) + 's';
  }
}

async function refresh() {
  try {
    const r = await fetch('/api/state');
    const s = await r.json();
    const prevFeedT = (state.npcFeed && state.npcFeed.length) ? Math.max(...state.npcFeed.map((e) => e.t || 0)) : 0;
    state = s;
    maybeCameraCue(s, prevFeedT);
    // 首次或当前 bot 已消失时，自动选中第一个在线的 bot。
    if (!currentUser || !botOf(currentUser)) {
      const first = s.bots.find((b) => b.bot?.online) || s.bots[0];
      currentUser = first?.bot?.username || null;
    }
    document.getElementById('sub').textContent = (s.updatedAt ? '更新于 ' + await fmtTime(s.updatedAt) : '')
      + ' · ' + s.bots.length + ' 位穿越者 · 每 2 秒刷新';
    renderWorldChip(s.world);
    renderTabs();
    renderCurrent();

    const m = s.memory || {};
    const res = Object.entries(m.resourcePoints || {}).map(([k, v]) => k + '(' + v.length + ')').join(', ');
    document.getElementById('memory').innerHTML = [
      ['基地', m.base ? '(' + m.base.x + ', ' + m.base.y + ', ' + m.base.z + ')' : '-'],
      ['公共箱', m.publicChest ? '(' + m.publicChest.x + ', ' + m.publicChest.y + ', ' + m.publicChest.z + ')' : '-'],
      ['当前目标', esc(m.currentGoal || '-')],
      ['资源点', res || '-'],
    ].map(([k, v]) => '<span class="k">' + k + '</span><span class="v">' + v + '</span>').join('');
    drawMap();
  } catch (e) {
    document.getElementById('sub').textContent = '读取失败: ' + e.message;
  }
}
function initMapInteraction() {
  const canvas = document.getElementById('map');
  if (!canvas || canvas.dataset.bound) return;
  canvas.dataset.bound = '1';

  // 像素 -> 世界坐标
  function worldAt(px, py) {
    const { cx, cz, range } = mapCenter();
    const scale = canvas.width / (range * 2);
    return { x: (px - canvas.width / 2) / scale + cx, z: (py - canvas.height / 2) / scale + cz };
  }
  // 命中检测：点击处最近的在线的 bot（阈值 8 格）
  function pickBot(px, py) {
    const w = worldAt(px, py);
    let best = null, bestD = 8;
    for (const b of state.bots) {
      const bot = b.bot || {};
      if (!bot.online || !bot.position) continue;
      const d = Math.hypot(bot.position.x - w.x, bot.position.z - w.z);
      if (d < bestD) { bestD = d; best = bot.username; }
    }
    return best;
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const steps = [8, 16, 32, 64, 128, 256, 512, 1024];
    const i = steps.indexOf(mapState.range);
    mapState.range = steps[Math.max(0, Math.min(steps.length - 1, i + (e.deltaY > 0 ? 1 : -1)))];
    drawMap();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    drag = { startX: e.clientX, startY: e.clientY, startOffsetX: mapState.offsetX, startOffsetZ: mapState.offsetZ, moved: false };
  });

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    const pxPerCanvas = canvas.width / rect.width;   // 屏幕 px -> canvas px
    const scale = canvas.width / (mapState.range * 2); // canvas px / 格
    const dx = (e.clientX - drag.startX) * pxPerCanvas / scale;
    const dz = (e.clientY - drag.startY) * pxPerCanvas / scale;
    mapState.offsetX = drag.startOffsetX + dx;
    mapState.offsetZ = drag.startOffsetZ + dz;
    mapState.follow = false;
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
    drawMap();
  });

  window.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) return; // 拖拽结束不触发点击
    if (e.target !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const u = pickBot(px, py);
    if (u && u !== currentUser) {
      currentUser = u;
      mapState.offsetX = 0; mapState.offsetZ = 0; mapState.follow = true;
      renderTabs();
      renderCurrent();
      drawMap();
    }
  });

  canvas.addEventListener('dblclick', () => {
    mapState.offsetX = 0; mapState.offsetZ = 0; mapState.follow = true;
    drawMap();
  });
}

function initZoomButtons() {
  const el = document.getElementById('zoom-in');
  if (!el || el.dataset.bound) return;
  el.dataset.bound = '1';
  const steps = [8, 16, 32, 64, 128, 256, 512, 1024];
  el.addEventListener('click', () => {
    const i = steps.indexOf(mapState.range);
    mapState.range = steps[Math.max(0, i - 1)];
    drawMap();
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    const i = steps.indexOf(mapState.range);
    mapState.range = steps[Math.min(steps.length - 1, i + 1)];
    drawMap();
  });
  document.getElementById('zoom-home').addEventListener('click', () => {
    mapState.offsetX = 0; mapState.offsetZ = 0; mapState.follow = true; mapState.range = 128;
    drawMap();
  });
}

function initViewButtons() {
  const bt = document.getElementById('vbtn-third');
  const bf = document.getElementById('vbtn-first');
  const br = document.getElementById('vbtn-reset');
  const bm = document.getElementById('vbtn-max');
  if (!bt || bt.dataset.bound) return;
  bt.dataset.bound = '1';
  function sync() {
    bt.className = 'vbtn' + (viewMode === 'third' ? ' active' : '');
    bf.className = 'vbtn' + (viewMode === 'first' ? ' active' : '');
  }
  bt.addEventListener('click', () => { viewMode = 'third'; localStorage.setItem('viewMode', 'third'); sync(); renderCurrent(); });
  bf.addEventListener('click', () => { viewMode = 'first'; localStorage.setItem('viewMode', 'first'); sync(); renderCurrent(); });
  br.addEventListener('click', () => {
    // 重载 iframe 以重置镜头位置
    const frame = document.getElementById('viewer-frame');
    const cur = frame.getAttribute('src');
    frame.setAttribute('src', 'about:blank');
    setTimeout(() => frame.setAttribute('src', cur), 150);
  });
  bm.addEventListener('click', () => {
    document.body.classList.toggle('vmax');
    bm.textContent = document.body.classList.contains('vmax') ? '⛶ 退出全屏' : '⛶ 全屏';
    bm.classList.toggle('active');
  });
  sync();
}

refresh();
initMapInteraction();
initViewButtons();
initZoomButtons();
// 思考流截图点击看大图（容器级事件委托，不受 innerHTML 重绘影响）
(function initShotClick() {
  const el = document.getElementById('steps');
  if (el) el.addEventListener('click', (e) => {
    const img = e.target && e.target.closest ? e.target.closest('img[data-shot]') : null;
    if (img) window.open('/shot/' + img.getAttribute('data-shot'), '_blank');
  });
})();
setInterval(refresh, 2000);
loadSkins(); setInterval(loadSkins, 60000);
</script>
</body>
</html>`

// ---- GM 传送：内嵌精简 RCON（Source RCON 协议）----
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RCON_HOST = process.env.MC_RCON_HOST || '127.0.0.1'
const RCON_PORT = Number(process.env.MC_RCON_PORT || 25575)

function rconReadSecret() {
  for (const p of [join(__dirname, 'data', 'rcon-secret.txt'), join(__dirname, '..', 'data', 'rcon-secret.txt')]) {
    try { return readFileSync(p, 'utf-8').trim() } catch { /* try next */ }
  }
  throw new Error('rcon-secret.txt not found')
}

function rconPacket(id, type, body) {
  const buf = Buffer.alloc(14 + Buffer.byteLength(body))
  buf.writeInt32LE(10 + Buffer.byteLength(body), 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  buf.write(body, 12)
  buf.writeInt8(0, 12 + Buffer.byteLength(body))
  buf.writeInt8(0, 13 + Buffer.byteLength(body))
  return buf
}

function rconSendRecv(sock, id, type, body) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const timer = setTimeout(() => { cleanup(); reject(new Error('rcon timeout')) }, 5000)
    function cleanup() { clearTimeout(timer); sock.removeListener('data', onData) }
    function onData(d) {
      chunks.push(d)
      const all = Buffer.concat(chunks)
      if (all.length < 4) return
      const len = all.readInt32LE(0)
      if (all.length < 4 + len) return
      cleanup()
      resolve({
        id: all.readInt32LE(4),
        type: all.readInt32LE(8),
        body: all.toString('utf-8', 12, 4 + len - 2),
      })
    }
    sock.on('data', onData)
    sock.write(rconPacket(id, type, body))
  })
}

async function rconExec(cmd) {
  const secret = rconReadSecret()
  const sock = net.connect(RCON_PORT, RCON_HOST)
  sock.setNoDelay(true)
  try {
    await new Promise((ok, bad) => { sock.once('connect', ok); sock.once('error', bad) })
    const auth = await rconSendRecv(sock, 1, 3, secret)
    if (auth.id === -1) throw new Error('rcon auth failed')
    const out = await rconSendRecv(sock, 2, 2, cmd)
    return out.body
  } finally {
    sock.destroy()
  }
}

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/api/village') {
      try {
        const vil = JSON.parse(readFileSync(join(DATA_DIR, 'village', 'villagers.json'), 'utf-8'))
        const list = Array.isArray(vil) ? vil : vil?.villagers ?? []
        const d = new Date()
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        let quests = []
        try { quests = JSON.parse(readFileSync(join(DATA_DIR, 'village', `quests-${day}.json`), 'utf-8'))?.quests ?? [] } catch {}
        const feed = []
        try {
          const lines = readFileSync(NPCFEED_PATH, 'utf-8').trim().split('\n').slice(-30)
          for (const ln of lines) { try { feed.push(JSON.parse(ln)) } catch {} }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ day, npcs: list.map((v) => ({
          key: v.key, display: v.display, spawn: v.spawn,
          quest: (() => { const q = quests.find((x) => x.villager === v.key); return q ? { zh: q.zh, count: q.count, emerald: q.emerald, done: q.done, doneBy: q.done_by } : null })(),
        })), feed }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(e) }))
      }
      return
    }
    if (u.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(apiState()))
    return
  }
  // GM 传送：/api/tp?as=被传送者&to=目的地玩家（tp <as> <to>）
  if (u.pathname === '/api/tp' && req.method === 'GET') {
    const as = (u.searchParams.get('as') || '').replace(/[^A-Za-z0-9_]/g, '')
    const to = (u.searchParams.get('to') || '').replace(/[^A-Za-z0-9_]/g, '')
    if (!as || !to) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('缺参数 as/to')
      return
    }
    rconExec(`tp ${as} ${to}`)
      .then((out) => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(out.includes('No entity') || out.includes('not found') ? `失败：${out}` : `已执行 tp ${as} → ${to}（${out.trim() || 'ok'}）`)
      })
      .catch((e) => {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('RCON 失败: ' + e.message)
      })
    return
  }
  // 皮肤库：GET /api/skins -> 预设元信息 + 当前指派 + 白名单（不外泄 value/signature 大字段）
  if (u.pathname === '/api/skins' && req.method === 'GET') {
    try {
      const sk = JSON.parse(readFileSync(join(DATA_DIR, 'skins.json'), 'utf-8'))
      const presets = Object.entries(sk.presets || {}).map(([name, p]) => ({ name, displayName: p.displayName || name, png: p.png || (name + '.png') }))
      let whitelist = []
      try { whitelist = JSON.parse(readFileSync(join(process.env.MC_SERVER_DIR || join(resolve(process.cwd()), 'mc-server'), 'whitelist.json'), 'utf-8')).map((e) => e.name) } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ presets, assignments: sk.assignments || {}, whitelist }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String(e) }))
    }
    return
  }
  // 皮肤指派：POST /api/skins/assign {username, preset}（preset 空=清除）-> 改写 skins.json，skin-proxy fs.watch 热加载
  if (u.pathname === '/api/skins/assign' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 4096) { req.destroy(); } })
    req.on('end', () => {
      try {
        const { username, preset } = JSON.parse(body || '{}')
        if (!/^[A-Za-z0-9_]{1,16}$/.test(username || '')) throw new Error('用户名非法')
        const p = join(DATA_DIR, 'skins.json')
        const sk = JSON.parse(readFileSync(p, 'utf-8'))
        if (preset) {
          if (!sk.presets || !sk.presets[preset]) throw new Error('未知预设: ' + preset)
          sk.assignments = sk.assignments || {}
          sk.assignments[username] = preset
        } else if (sk.assignments) {
          delete sk.assignments[username]
        }
        writeFileSync(p, JSON.stringify(sk, null, 2) + '\n')
        console.log(`[web-panel] skin assign: ${username} -> ${preset || '(default)'}`)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: String(e.message || e) }))
      }
    })
    return
  }
  // AI 睁眼截图：/shot/<username>/<file>.jpg —— 只放行 screenshots 目录下的 jpg
  const shotMatch = u.pathname.match(/^\/shot\/([A-Za-z0-9_]+)\/([A-Za-z0-9_.-]+\.jpg)$/)
  if (shotMatch) {
    const p = join(DATA_DIR, 'screenshots', shotMatch[1], shotMatch[2])
    if (!existsSync(p)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' })
    res.end(readFileSync(p))
    return
  }
  // 皮肤：/skins/<name>.png —— 只放行 data/skins 下的 png
  const skinMatch = u.pathname.match(/^\/skins\/([A-Za-z0-9_-]+\.png)$/)
  if (skinMatch) {
    const p = join(DATA_DIR, 'skins', skinMatch[1])
    if (!existsSync(p)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' })
    res.end(readFileSync(p))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(PAGE)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[web-panel] 观察面板已启动: http://localhost:${PORT}`)
  console.log(`[web-panel] 局域网访问: http://<本机IP>:${PORT}`)
})
