import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
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
const VILLAGE_DIR = resolve(DATA_DIR, 'village') // 村庄引擎数据目录（config.json / villagers.json）
const VILLAGE_CFG_PATH = resolve(VILLAGE_DIR, 'config.json')
const VILLAGERS_PATH = resolve(VILLAGE_DIR, 'villagers.json')

// ── 语音播报（TTS）—— 云端 edge-tts 优先，本机 IndexTTS 网关兜底。─────────────
// 2026-08-22 用户定调「TTS 走云端」：本地 IndexTTS 被 vllm 抢 GPU 慢（5~25s/句），
// 改走微软 Edge 朗读服务（edge-tts，Python311 子进程，实测 ~2s/句，中文音色 30+）。
// 磁盘缓存保留：同文本+同音色+同语气只合成一次（命中 ~0.03s）。
const INDEX_TTS_URL = process.env.INDEX_TTS_URL || 'http://127.0.0.1:8085'
const TTS_INFER_TIMEOUT = 45000 // IndexTTS 兜底时的超时
const TTS_EDGE_PY = process.env.TTS_EDGE_PY || 'C:\\Users\\lzl19\\AppData\\Local\\Programs\\Python\\Python311\\python.exe'
const TTS_EDGE_SCRIPT = resolve(process.cwd(), 'ops', 'tts_edge_synth.py')
// 语气 -> edge-tts rate/pitch（14 种，与 IndexTTS mood 同名；edge-tts 用语速/音高近似表达）
const TTS_MOOD_RP = {
  '平静': ['+0%', '+0Hz'], '快乐': ['+14%', '+10Hz'], '生气': ['+18%', '+12Hz'],
  '悲伤': ['-14%', '-10Hz'], '害怕': ['-6%', '-12Hz'], '厌恶': ['+6%', '-6Hz'],
  '忧郁': ['-16%', '-12Hz'], '惊讶': ['+22%', '+16Hz'], '温柔': ['-8%', '+2Hz'],
  '豪爽': ['+12%', '+8Hz'], '严肃': ['-6%', '-8Hz'], '俏皮': ['+20%', '+14Hz'],
  '温暖': ['-4%', '+4Hz'], '冷淡': ['-12%', '-10Hz'],
}
// edge-tts 中文音色表（id -> 展示名）。覆盖 zh-CN / zh-HK / zh-TW。
const TTS_EDGE_VOICES = [
  ['zh-CN-XiaoxiaoNeural', '晓晓（女·温柔）'], ['zh-CN-XiaoyiNeural', '晓伊（女·亲切）'],
  ['zh-CN-YunjianNeural', '云健（男·青年）'], ['zh-CN-YunxiNeural', '云希（男·阳光）'],
  ['zh-CN-YunxiaNeural', '云夏（男·少年）'], ['zh-CN-YunyangNeural', '云扬（男·浑厚）'],
  ['zh-CN-liaoning-XiaobeiNeural', '晓北（女·东北）'], ['zh-CN-shaanxi-XiaoniNeural', '晓妮（女·陕西方言）'],
  ['zh-CN-XiaoxiaoNeural', '晓晓（女·温柔）'], ['zh-CN-XiaomoNeural', '晓墨（女·知性）'],
  ['zh-CN-XiaohanNeural', '晓涵（女·甜美）'], ['zh-CN-XiaoruiNeural', '晓睿（女·成熟）'],
  ['zh-CN-XiaoshuangNeural', '晓双（女·童声）'], ['zh-CN-XiaoyanNeural', '晓颜（女·训练师）'],
  ['zh-CN-XiaoyouNeural', '晓悠（女·童声）'], ['zh-CN-XiaozhenNeural', '晓甄（女·温和）'],
  ['zh-CN-YunfengNeural', '云峰（男·成熟）'], ['zh-CN-YunhaoNeural', '云浩（男·磁性）'],
  ['zh-CN-YunjieNeural', '云杰（男·激情）'], ['zh-CN-YunmingNeural', '云明（男·温润）'],
  ['zh-CN-YunzeNeural', '云泽（男·优雅）'], ['zh-HK-HiuGaaiNeural', '曉佳（粤·女）'],
  ['zh-HK-HiuMaanNeural', '曉曼（粤·女）'], ['zh-HK-WanLungNeural', '雲龍（粤·男）'],
  ['zh-TW-HsiaoChenNeural', '曉臻（台·女）'], ['zh-TW-HsiaoYuNeural', '曉雨（台·女）'],
  ['zh-TW-YunJheNeural', '雲哲（台·男）'],
]
// 旧 IndexTTS 音色名 -> edge-tts 音色 id（localStorage 已有旧选择的兼容映射）
const TTS_LEGACY_MAP = {
  'xiaoyi': 'zh-CN-XiaoyiNeural', 'xiaoxue': 'zh-CN-XiaoxiaoNeural', 'xiaoxiao': 'zh-CN-XiaoxiaoNeural',
  'yunxi': 'zh-CN-YunxiNeural', 'yunyang': 'zh-CN-YunyangNeural', 'yunxia': 'zh-CN-YunxiaNeural',
  'yunjian': 'zh-CN-YunjianNeural', 'baolin': 'zh-CN-YunjianNeural', 'yunqiu': 'zh-CN-YunjianNeural',
  'qingxin': 'zh-CN-XiaoxiaoNeural', 'xiaotian': 'zh-CN-YunxiaNeural', 'taozi': 'zh-CN-XiaohanNeural',
  'huihui': 'zh-CN-XiaoxiaoNeural', 'kangkang': 'zh-CN-YunyangNeural', 'yaoyao': 'zh-CN-XiaoxiaoNeural',
  'npc': 'zh-CN-YunxiNeural', 'default': 'zh-CN-XiaoxiaoNeural',
}
function ttsVoiceToEdge(voice) {
  if (!voice) return 'zh-CN-XiaoxiaoNeural'
  if (TTS_EDGE_VOICES.some(([id]) => id === voice)) return voice
  if (TTS_LEGACY_MAP[voice]) return TTS_LEGACY_MAP[voice]
  return voice // 未知音色直接透传（edge-tts 可能认识）
}
const TTS_CACHE_DIR = resolve(DATA_DIR, 'tts-cache')
try { mkdirSync(TTS_CACHE_DIR, { recursive: true }) } catch {}
function ttsCacheKey(text, voice, mood) {
  return createHash('sha1').update(String(text) + '\u0000' + String(voice) + '\u0000' + String(mood || '')).digest('hex').slice(0, 24)
}
// 云端合成（edge-tts Python 子进程 -> MP3 字节）。PYTHONHOME/PYTHONPATH 必须 delete（设空串会让 Python 启动失败）。
function ttsEdgeSynth(text, voice, rate, pitch, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.PYTHONHOME;
    delete env.PYTHONPATH;
    const cp = spawn(TTS_EDGE_PY, [TTS_EDGE_SCRIPT, '--text', String(text).slice(0, 300), '--voice', voice, '--rate=' + rate, '--pitch=' + pitch], { env, windowsHide: true })
    const chunks = []
    let errOut = ''
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; cp.kill(); reject(new Error('edge-tts timeout')) } }, timeoutMs)
    cp.stdout.on('data', (c) => chunks.push(c))
    cp.stderr.on('data', (c) => { errOut += c })
    cp.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e) } })
    cp.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks))
      else reject(new Error('edge-tts exit ' + code + (errOut ? ' :: ' + errOut.slice(0, 2000) : '')))
    })
  })
}

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

// 女神天眼实体快照（bootstrap-world 每 1.5s 写 web-entities.json）：只取 mob/村民/玩家上线给前端
function readEntities() {
  try {
    const d = readJson(join(DATA_DIR, 'web-entities.json'), null)
    return (d?.entities || []).filter((e) => e.isMob || e.isNpc || e.isPlayer)
  } catch { return [] }
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

  // 在线玩家与 bots 对齐：世界心跳（RCON list）里的名字强制在线，
  // 缺 status 档案的（如真人/无 bot 文件的假玩家）补占位 tab，保证「谁在线」一眼可见。
  const hb = readJson(WORLD_HB_PATH, null)
  const watching = hb?.watching || []
  const watchingSet = new Set(watching)
  // 服务器里匹配用的是 personaName（守卫真实名是中文"桐人/鸣人"），
  // 而 status 档案 username 是英文（Kirito/Naruto）。用 personaName 参与对齐，
  // 否则 watching 里的中文名找不到对应实体，会重复补同名占位 tab（2026-08-23 桐人/鸣人分裂案）。
  const botNames = (st) => [st?.bot?.username, st?.bot?.personaName].filter(Boolean)
  for (const st of bots) {
    if (botNames(st).some((n) => watchingSet.has(n))) st.bot.online = true
  }
  for (const name of watching) {
    if (!bots.some((b) => botNames(b).includes(name))) {
      bots.push({ bot: { username: name, personaName: name, online: true } })
    }
  }
  bots.sort((a, b) => (a.bot?.username ?? a.bot?.personaName ?? '').localeCompare(b.bot?.username ?? b.bot?.personaName ?? ''))

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
    world: hb,
    entities: readEntities(),
  }
}

const PAGE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>我的异世界:千灯纪 · 萌悦AI 出品</title>
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
  .vbtn[data-on="1"] { border-color:var(--gold); color:var(--gold); background:#2a2014; }
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
  /* 聊天记录（原思考流面板改承载对话流）：行样式复用原聊天条 */
  .steps-scroll .ce { display:flex; gap:8px; padding:4px 0; border-bottom:1px dashed #21262d; align-items:baseline; }
  .steps-scroll .ct { color:var(--dim); font-family:monospace; font-size:11px; flex:0 0 auto; }
  .steps-scroll .cx { overflow-wrap:anywhere; min-width:0; }
  /* ── 侧栏 ── */
  .side { flex:0 0 350px; overflow-y:auto; display:flex; flex-direction:column; gap:12px; min-height:0; scrollbar-width:thin; }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:5px 12px; font-size:13px; }
  .kv .k { color:var(--dim); white-space:nowrap; }
  .kv .v { word-break:break-all; }
  .kvrow { display:flex; align-items:center; gap:8px; margin:6px 0; font-size:13px; }
  .kvrow .k { color:var(--dim); white-space:nowrap; min-width:62px; }
  .vsel { background:var(--card); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:2px 6px; font-size:12px; flex:1 1 auto; }
  .npcvoice-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; margin:4px 0 8px; }
  .npcvoice .k { font-size:12px; min-width:0; overflow:hidden; text-overflow:ellipsis; }
  .npcvoice .vbtn { flex:0 0 auto; padding:2px 8px; font-size:11px; }
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
    }   /* 闭合 @media (max-width:1000px) —— 勿删，否则下方抽屉/聊天条规则会被吞 */
  /* ── 设置抽屉（#3）：配置类卡片收进右侧滑出抽屉，主栏只留核心 ── */
  .drawer-toggle { position:relative; display:inline-flex; align-items:center; gap:6px; background:var(--card); border:1px solid var(--line); border-radius:18px; padding:5px 12px; cursor:pointer; font-size:13px; color:var(--dim); flex:0 0 auto; }
  .drawer-toggle:hover { border-color:var(--dim); color:var(--text); }
  #settings-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:490; opacity:0; pointer-events:none; transition:opacity .2s; }
  body.drawer-open #settings-backdrop { opacity:1; pointer-events:auto; }
  #settings-drawer { position:fixed; top:0; right:0; height:100%; width:560px; max-width:96vw; background:var(--bg); border-left:1px solid var(--line); box-shadow:-10px 0 28px rgba(0,0,0,.5); transform:translateX(100%); transition:transform .25s; overflow-y:auto; overflow-x:hidden; padding:14px 16px; z-index:491; display:flex; flex-direction:column; gap:12px; scrollbar-width:thin; }
  body.drawer-open #settings-drawer { transform:translateX(0); }
  #settings-drawer .card { flex:0 0 auto; min-width:0; max-width:100%; }
  /* ── 底部聊天条（#2）：填满下方空白，承载穿越者×NPC对话与编年史 ── */
  .chatbar { flex:0 0 auto; height:196px; border-top:1px solid var(--line); background:var(--card); display:flex; flex-direction:column; min-height:0; }
  .chatbar-head { display:flex; align-items:center; gap:8px; padding:6px 14px; border-bottom:1px solid var(--line); flex:0 0 auto; }
  .chatbar-head h2 { font-size:12px; margin:0; color:var(--dim); font-weight:600; letter-spacing:1px; }
  .chatbar-head .muted { font-size:11px; }
  .chatbar-scroll { flex:1 1 auto; overflow-y:auto; padding:6px 14px; font-size:12px; scrollbar-width:thin; }
  .chatbar-scroll .ce { display:flex; gap:8px; padding:3px 0; border-bottom:1px dashed #21262d; align-items:baseline; }
  .chatbar-scroll .ct { color:var(--dim); font-family:monospace; font-size:11px; flex:0 0 auto; }
  .chatbar-scroll .cx { overflow-wrap:anywhere; min-width:0; }
  .sysbar { flex:0 0 auto; padding:4px 14px; font-size:11px; color:var(--dim); border-bottom:1px solid var(--line); display:none; align-items:center; gap:6px; }
  .sysbar .sys-ico { color:var(--gold); white-space:nowrap; }
  .chatbar-scroll .empty { color:var(--dim); text-align:center; padding:20px 0; }
  /* 行囊网格（/api/inspect RCON 实查，众生通用） */
  .invgrid { display:grid; grid-template-columns:repeat(9,1fr); gap:3px; margin-top:4px }
  .invgrid .islot { background:#161b22; border:1px solid #30363d; border-radius:4px; min-height:40px; padding:2px 1px; display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:10px; line-height:1.25; overflow:hidden; text-align:center }
  .invgrid .islot .inm { color:#c9d1d9; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 2px }
  .invgrid .islot .icnt { color:var(--gold); font-weight:600 }
  .invgrid .islot.empty { opacity:.32 }
  .invgrid .islot.sel { border-color:#f0b72e; box-shadow:0 0 0 1px #f0b72e66 inset }
  .inv-label { font-size:11px; color:var(--dim); margin:8px 0 2px }
</style>
</head>
<body>
  <div id="dbg" style="display:none"></div>
  <button id="dbg-btn" style="position:fixed;top:0;left:0;z-index:9999">DBGTEST</button>
  <header class="topbar">
    <div class="brand"><span class="dot" id="dot"></span>我的异世界:千灯纪 <span class="sub" id="sub"></span></div>
    <span class="worldchip" id="worldchip">世界…</span>
    <div class="tabs" id="tabs"></div>
    <div class="spacer"></div>
    <button class="drawer-toggle" id="settings-toggle" title="打开设置抽屉（技能/皮肤/语音/背包/记忆/世界控制/村庄NPC）">⚙ 设置</button>
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
            <button class="vbtn" id="vbtn-tts" title="把游戏中 NPC 与女神的话用语音播报（戳一下开启/关闭）">🔊 语音</button>
          </div>
        </div>
        <div class="viewer-wrap">
          <iframe id="viewer-frame" class="viewer-frame" loading="lazy"></iframe>
        </div>
      </div>

      <div class="card steps-card">
        <div class="card-head"><h2 id="steps-title">聊天记录</h2><span class="muted">穿越者 × NPC 对话 · 神谕 · 编年史</span></div>
        <div id="sysbar" class="sysbar"></div>
        <div class="steps-scroll" id="steps"><div class="empty">暂无对话记录</div></div>
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
        <div class="card-head"><h2>语音</h2><span class="muted" id="tts-note">本机 IndexTTS 2.5 音色</span></div>
        <div id="tts-form"><span class="empty" style="padding:6px 0">加载中…</span></div>
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

      <div class="card">
        <div class="card-head"><h2>世界控制</h2><span class="muted">难度 · 时间 · 天气 · 游戏规则（即时生效）</span></div>
        <div id="worldctrl"><span class="empty" style="padding:6px 0">加载中…</span></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>村庄 / NPC</h2><span class="muted" id="npc-note">对话半径 · 拉回 · 祈愿 · 各村民</span></div>
        <div id="npcctl"><span class="empty" style="padding:6px 0">加载中…</span></div>
      </div>
    </div>
  </div>

<!-- 聊天记录已并入主区「聊天记录」卡（原思考流位），不再保留 196px 底部小条 -->

<div id="settings-backdrop"></div>
<aside id="settings-drawer">
  <div class="drawer-note" style="display:flex;align-items:center;gap:8px;color:var(--dim);font-size:12px;">
    <button class="vbtn" id="drawer-close">✕ 收起</button>
    <span>技能 / 皮肤 / 语音 / 背包 / 记忆 / 世界控制 / 村庄NPC</span>
  </div>
</aside>

<script>
document.getElementById('dbg-btn').addEventListener('click', () => { document.getElementById('dbg').textContent = 'DBGBTN CLICKED ' + Date.now(); });
let state = { bots: [], memory: {}, magic: {}, atomNames: {}, passives: [], chronicle: [], npcFeed: [], villageNpcs: [] };
let currentUser = null; // 当前选中的 bot username
let viewMode = localStorage.getItem('viewMode') || 'third'; // third | first
// 天眼跟随：选中玩家 -> 后端把女神 tp 到其上方（每 2s 跟随），天眼视角即跟过去
async function eyeFollowTo(name) {
  if (!name) return;
  try { await fetch('/api/eye?name=' + encodeURIComponent(name) + '&follow=1'); } catch {}
}
function eyeFollowStop() {
  try { fetch('/api/eye?follow=0').catch(() => {}); } catch {}
}
let posCache = {}; // 无 status 档案的在线玩家坐标缓存：username -> {x,y,z,at}
async function fetchPosFor(name) {
  if (!name) return;
  const hit = posCache[name];
  if (hit && Date.now() - hit.at < 8000) return;
  try {
    const r = await fetch('/api/pos?name=' + encodeURIComponent(name));
    if (!r.ok) return;
    const p = await r.json();
    if (p && typeof p.x === 'number') { posCache[name] = { x: p.x, y: p.y, z: p.z, at: Date.now() }; renderCurrent(); }
  } catch {}
}
// ---- 众生档案（inspect）：RCON 实查生命/饥饿/氧气/等级/背包 —— 守卫/真人/化身通用，随选中人切换 ----
let inspectCache = {}; // username -> { d, at }
let inspectBusy = false
async function fetchInspectFor(name) {
  if (!name || inspectBusy) return;
  const hit = inspectCache[name];
  if (hit && Date.now() - hit.at < 5000) return; // 5s TTL：选中谁查谁，切人即换
  inspectBusy = true;
  try {
    const r = await fetch('/api/inspect?name=' + encodeURIComponent(name));
    if (r.ok) {
      const d = await r.json();
      if (d && !d.error) { inspectCache[name] = { d, at: Date.now() }; renderCurrent(); }
    }
  } catch {}
  inspectBusy = false;
}
// 常见物品中文名（缺省回退短 id）
const ITEM_CN = {
  iron_sword:'铁剑', iron_pickaxe:'铁镐', iron_axe:'铁斧', iron_shovel:'铁锹', iron_hoe:'铁锄',
  golden_sword:'金剑', golden_pickaxe:'金镐', golden_axe:'金斧', golden_shovel:'金锹',
  diamond_sword:'钻石剑', diamond_pickaxe:'钻石镐', diamond_axe:'钻石斧', diamond_shovel:'钻石锹', diamond_hoe:'钻石锄',
  stone_sword:'石剑', stone_pickaxe:'石镐', stone_axe:'石斧', stone_shovel:'石锹',
  wooden_sword:'木剑', wooden_pickaxe:'木镐', wooden_axe:'木斧', wooden_shovel:'木锹', wooden_hoe:'木锄',
  netherite_sword:'合金剑', netherite_pickaxe:'合金镐',
  bow:'弓', crossbow:'弩', arrow:'箭', shield:'盾', fishing_rod:'钓竿', flint_and_steel:'打火石', shears:'剪刀',
  torch:'火把', soul_torch:'灵魂火把', lantern:'灯笼', glowstone:'荧石',
  bread:'面包', apple:'苹果', golden_apple:'金苹果', cooked_beef:'牛排', beef:'生牛肉', cooked_porkchop:'熟猪排', porkchop:'生猪排',
  cooked_chicken:'烤鸡', chicken:'生鸡肉', cooked_mutton:'熟羊肉', mutton:'生羊肉', cooked_cod:'熟鳕鱼', cooked_salmon:'熟鲑鱼', cod:'生鳕鱼',
  wheat:'小麦', wheat_seeds:'小麦种子', carrot:'胡萝卜', potato:'土豆', baked_potato:'烤土豆', beetroot:'甜菜根', beetroot_seeds:'甜菜种子',
  melon_slice:'西瓜片', sweet_berries:'甜浆果', egg:'鸡蛋', sugar:'糖', cake:'蛋糕',
  oak_log:'橡木原木', oak_planks:'橡木板', oak_leaves:'橡树叶', oak_sapling:'橡树苗', spruce_log:'云杉原木', birch_log:'白桦原木',
  cobblestone:'圆石', stone:'石头', dirt:'泥土', grass_block:'草方块', sand:'沙子', gravel:'沙砾', deepslate:'深板岩',
  coal:'煤炭', charcoal:'木炭', iron_ingot:'铁锭', gold_ingot:'金锭', copper_ingot:'铜锭', diamond:'钻石', emerald:'绿宝石',
  lapis_lazuli:'青金石', redstone:'红石', quartz:'下界石英', amethyst_shard:'紫水晶', raw_iron:'粗铁', raw_gold:'粗金', raw_copper:'粗铜',
  netherite_ingot:'合金锭', netherite_scrap:'合金碎片', ancient_debris:'远古残骸',
  stick:'木棍', string:'线', feather:'羽毛', leather:'皮革', flint:'燧石', gunpowder:'火药', ender_pearl:'末影珍珠',
  blaze_rod:'烈焰棒', bone:'骨头', bone_meal:'骨粉', rotten_flesh:'腐肉', spider_eye:'蜘蛛眼', slime_ball:'粘液球', phantom_membrane:'幻翼膜',
  crafting_table:'工作台', furnace:'熔炉', chest:'箱子', barrel:'木桶', bed:'床', ladder:'梯子', boat:'船', rail:'铁轨',
  bucket:'铁桶', water_bucket:'水桶', milk_bucket:'奶桶', lava_bucket:'岩浆桶',
  iron_helmet:'铁头盔', iron_chestplate:'铁胸甲', iron_leggings:'铁护腿', iron_boots:'铁靴',
  diamond_helmet:'钻石头盔', diamond_chestplate:'钻石胸甲', diamond_leggings:'钻石护腿', diamond_boots:'钻石靴',
  leather_helmet:'皮帽', leather_chestplate:'皮衣', turtle_helmet:'龟壳', elytra:'鞘翅', totem_of_undying:'不死图腾', experience_bottle:'经验瓶',
  book:'书', paper:'纸', compass:'指南针', clock:'钟', spyglass:'望远镜', saddle:'鞍', name_tag:'命名牌', lead:'拴绳', map:'地图',
};
function itemCN(id) {
  const short = String(id || '').replace(/^minecraft:/, '')
  return ITEM_CN[short] || short
}
// 行囊网格：快捷栏(0-8, 主手金框) / 背包(9-35) / 盔甲(103头 102胸 101腿 100靴)+副手(40)
function renderInspect(uname, dispName) {
  const el = document.getElementById('inv')
  const sub = document.getElementById('inv-sub')
  const hit = inspectCache[uname]
  if (!hit) return false
  const d = hit.d
  const bySlot = {}
  for (const it of (d.items || [])) if (it.slot != null) bySlot[it.slot] = it
  function slotHtml(s, selSlot) {
    const it = bySlot[s]
    const sel = selSlot === s ? ' sel' : ''
    if (!it) return '<div class="islot empty' + sel + '"></div>'
    return '<div class="islot' + sel + '" title="' + esc(it.id) + '"><span class="inm">' + esc(itemCN(it.id)) + '</span>'
      + (it.count > 1 ? '<span class="icnt">×' + it.count + '</span>' : '') + '</div>'
  }
  const selSlot = (d.sel != null) ? d.sel : -1
  let h = '<div class="inv-label">' + esc(dispName) + ' · 快捷栏（金框=主手）</div>'
    + '<div class="invgrid">' + Array.from({ length: 9 }, (_, i) => slotHtml(i, selSlot)).join('') + '</div>'
  h += '<div class="inv-label">背包</div><div class="invgrid">' + Array.from({ length: 27 }, (_, i) => slotHtml(9 + i, -1)).join('') + '</div>'
  h += '<div class="inv-label">盔甲（头胸腿靴）/ 副手</div><div class="invgrid" style="grid-template-columns:repeat(5,1fr)">'
    + [103, 102, 101, 100, 40].map((s) => slotHtml(s, -1)).join('') + '</div>'
  el.innerHTML = h
  const n = (d.items || []).length
  sub.textContent = n + ' 格有物 · ' + new Date(hit.at).toLocaleTimeString('zh-CN', { hour12: false }) + ' 实查'
  return true
}
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
  return state.bots.find((b) => b.bot?.username === username || b.bot?.personaName === username) || null;
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

// ---- 语音播报（TTS）：本机 IndexTTS 2.5 真实音色，女神/NPC 说话；服务挂了才兜底浏览器 speechSynthesis ----
// 数据源：chronicle(女神 verdict/godcast/welcome) + npc-feed(NPC say / goddess / player 台词)。
// 都带单调递增标记（chronicle.at 毫秒 / npc-feed.t 计数），用标记去重，只播新台词。
let ttsEnable = localStorage.getItem('ttsEnable') !== '0';   // 默认开
let ttsPrefetch = null; // 流水线预合成：{url, key}，当前句播放时预取下一句
const ttsVoices = {   // 音色（可经面板「语音」卡改，存 localStorage）
  goddess: localStorage.getItem('ttsVoiceGoddess') || 'zh-CN-XiaoyiNeural', // 女神：晓伊（女声）
  npc: localStorage.getItem('ttsVoiceNpc') || 'zh-CN-YunxiNeural',          // NPC 默认：云希（清亮男声）
  player: localStorage.getItem('ttsVoicePlayer') || 'zh-CN-XiaoxiaoNeural', // 玩家：晓晓（女声，与女神区分）
};
// 旧 IndexTTS 音色名 -> edge-tts 中文展示名（兼容 localStorage 里已存的旧音色名；vlabel 兜底用）
const TTS_LEGACY_DISPLAY = {
  'yunyang': '云扬（男·浑厚）', 'baolin': '云健（男·青年）', 'yunjian': '云健（男·青年）',
  'xiaotian': '云夏（男·少年）', 'yunxi': '云希（男·阳光）', 'qingxin': '晓晓（女·温柔）',
  'taozi': '晓涵（女·甜美）', 'xiaoxue': '晓晓（女·温柔）', 'xiaoyi': '晓伊（女·亲切）',
  'xiaoxiao': '晓晓（女·温柔）', 'yunxia': '云夏（男·少年）',
};
const ttsBySpeaker = { // 按说话人覆写音色（NPC 名 -> voice id）；特色 NPC 一人一音色，其余走 NPC 默认
  '铁匠·岳山': 'zh-CN-YunyangNeural',   // 男，浑厚豪爽
  '甲匠·石磊': 'zh-CN-YunjianNeural',   // 男，沉稳
  '书商·墨白': 'zh-CN-YunjianNeural',   // 男，清朗书生
  '吟游诗人·风临': 'zh-CN-YunxiaNeural',// 少年诗人，灵动
  '守夜人·烛九': 'zh-CN-YunxiNeural',   // 男，沉稳守夜
  '神官·静水': 'zh-CN-XiaoxiaoNeural',  // 女，空灵
  '牧羊女·小满': 'zh-CN-XiaohanNeural', // 女，甜美
  '公会接待员·岚': 'zh-CN-XiaoxiaoNeural', // 女，亲和
  '阿宝': 'zh-CN-YunxiaNeural',         // 少年
  '灯窝·阿禾': 'zh-CN-YunxiaNeural',    // 少年
};
const NPC_SPEAKERS = [ // 面板「语音」卡可逐个指音色的全部已知 NPC（对应 data/village/villagers.json 的 display）
  '铁匠·岳山', '甲匠·石磊', '书商·墨白', '书商·云笈', '货郎·福伯', '吟游诗人·风临',
  '守夜人·烛九', '神官·静水', '集市掌柜·通宝', '老农·禾叔', '牧羊女·小满', '渔夫·浪伯',
  '墨先生', '阿宝', '货郎·铜板', '公会接待员·岚', '灯窝·阿爹', '灯窝·穗娘', '灯窝·阿禾',
];
const TTS_MOODS = [ // 语气预设（网关 MOOD_VECTORS 已支持）：id + 中文名
  ['calm', '平静'], ['happy', '快乐'], ['angry', '生气'], ['sad', '悲伤'],
  ['afraid', '害怕'], ['disgusted', '厌恶'], ['melancholic', '忧郁'], ['surprised', '惊讶'],
  ['gentle', '温柔'], ['hearty', '豪爽'], ['serious', '严肃'], ['playful', '俏皮'],
  ['warm', '温暖'], ['cold', '冷淡'],
];
const NPC_VOICE_MOOD = { // NPC -> 专属音色 + 语气 + 试听台词（匹配人物身份）
  '铁匠·岳山': { voice: 'zh-CN-YunyangNeural', mood: 'hearty', sample: '打铁趁热！这一锤下去，保你兵刃趁手。' },
  '甲匠·石磊': { voice: 'zh-CN-YunjianNeural', mood: 'serious', sample: '甲要合身，命才保得住。别急，慢慢来。' },
  '书商·墨白': { voice: 'zh-CN-YunjianNeural', mood: 'calm', sample: '书中自有黄金屋，客官可要看看新到的卷子？' },
  '书商·云笈': { voice: 'zh-CN-YunjianNeural', mood: 'melancholic', sample: '这一册孤本，世上再难寻第二份了。' },
  '货郎·福伯': { voice: 'zh-CN-YunxiNeural', mood: 'warm', sample: '走街串巷几十年，好东西都在我担子里头。' },
  '吟游诗人·风临': { voice: 'zh-CN-YunxiaNeural', mood: 'playful', sample: '风起灯明，且听我唱一段江湖故事！' },
  '守夜人·烛九': { voice: 'zh-CN-YunxiNeural', mood: 'cold', sample: '夜深了，火把交给我，你只管安睡。' },
  '神官·静水': { voice: 'zh-CN-XiaoxiaoNeural', mood: 'gentle', sample: '愿神明的光，照你前行的路。' },
  '集市掌柜·通宝': { voice: 'zh-CN-YunxiNeural', mood: 'happy', sample: '童叟无欺，价钱公道，您再看看？' },
  '老农·禾叔': { voice: 'zh-CN-YunyangNeural', mood: 'warm', sample: '地里的庄稼，比啥都实在。吃饭了没？' },
  '牧羊女·小满': { voice: 'zh-CN-XiaohanNeural', mood: 'gentle', sample: '小羊羔又跑远啦，快来帮我一把！' },
  '渔夫·浪伯': { voice: 'zh-CN-YunyangNeural', mood: 'happy', sample: '今儿个鱼多，分你两条，拿去炖汤！' },
  '墨先生': { voice: 'zh-CN-YunjianNeural', mood: 'calm', sample: '文章千古事，得失寸心知。' },
  '阿宝': { voice: 'zh-CN-YunxiaNeural', mood: 'happy', sample: '俺阿宝力气大，扛东西的事包在我身上！' },
  '货郎·铜板': { voice: 'zh-CN-YunxiaNeural', mood: 'playful', sample: '叮当叮当，铜板响，好货送到你手上！' },
  '公会接待员·岚': { voice: 'zh-CN-XiaoxiaoNeural', mood: 'serious', sample: '欢迎来到冒险者公会，请先登记你的委托。' },
  '灯窝·阿爹': { voice: 'zh-CN-YunxiNeural', mood: 'calm', sample: '灯窝的灯，点一盏，亮一宿。' },
  '灯窝·穗娘': { voice: 'zh-CN-XiaohanNeural', mood: 'warm', sample: '灯芯要勤剪，火才旺呢。' },
  '灯窝·阿禾': { voice: 'zh-CN-YunxiaNeural', mood: 'happy', sample: '今晚我来守灯，保证不让它灭！' },
};
const ttsNpcOverride = {}; // NPC 名 -> voice id（面板可改，存 localStorage ttsVoiceNpc_<名>，优先于 ttsBySpeaker）
const ttsNpcMood = {}; // NPC 名 -> mood id（存 localStorage ttsMoodNpc_<名>）
for (const name of NPC_SPEAKERS) {
  const v = localStorage.getItem('ttsVoiceNpc_' + name);
  if (v) ttsNpcOverride[name] = v;
  const m = localStorage.getItem('ttsMoodNpc_' + name);
  if (m) ttsNpcMood[name] = m;
}
let ttsVoiceList = ['zh-CN-XiaoxiaoNeural','zh-CN-YunxiNeural','zh-CN-YunyangNeural','zh-CN-YunjianNeural','zh-CN-XiaoyiNeural','zh-CN-YunxiaNeural'];
let ttsVoiceLabels = {};
let ttsSeen = { chronT: 0, feedT: 0 };   // 去重游标（记最大值，避免重播历史行）
let ttsBooted = false;                    // 首次载入只记游标不播，防开局重放全部旧台词
const ttsQ = [];                          // {text, kind, speaker}
let ttsBusy = false;
let ttsAudioEl = null;                    // 复用 <audio> 播 WAV
let ttsSynthVoice = null;                 // 浏览器兜底音色

function ttsPickVoice() {
  if (!('speechSynthesis' in window)) { ttsSynthVoice = null; return; }
  const vs = window.speechSynthesis.getVoices() || [];
  ttsSynthVoice = vs.find((v) => /zh/i.test(v.lang)) || vs[0] || null;
}
ttsPickVoice();
if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = ttsPickVoice;

// 浏览器自动播放策略：任意首击解锁 speechSynthesis / audio 元素。
if ('speechSynthesis' in window) {
  document.addEventListener('pointerdown', () => { try { window.speechSynthesis.resume(); } catch {} }, { once: true });
}
document.addEventListener('pointerdown', () => { try { if (ttsAudioEl) ttsAudioEl.play().catch(() => {}); } catch {} }, { once: true });

const PLAYER_DISPLAY = { MengMeng: '萌萌', KangQiang: '扛枪' }; // 登录名 → 中文名（TTS 朗读用）
const VIP_PRIORITY = ['MengMeng', '萌萌']; // 重点看护玩家：语音打断优先

// 播报范围：'' = 全部；玩家名（如 MengMeng）= 只听该玩家视角（他说的 / 对他说 / 女神回应他的）
let ttsFilter = localStorage.getItem('ttsFilterPlayer') || '';
function ttsFiltered(kind, who, to, actor) {
  if (!ttsFilter) {
    // 全部模式：祈福裁决（verdict）不播——那是"别人的私事"，全播会刷屏；welcome 只播真人玩家的
    if (kind === 'verdict') return false;
    if (kind === 'welcome') return !!actor && !String(actor).startsWith('villager:');
    // 2026-08-23 治理：NPC 私聊（to 非空）不播——公屏治理后 NPC 大多私聊，全播等于把私聊变公屏语音刷屏
    if (kind === 'say' && to) return false;
    return true;
  }
  if (kind === 'player') return who === ttsFilter;    // 他说的话
  if (kind === 'say') return to === ttsFilter;        // NPC 对他说
  if (kind === 'verdict') return actor === ttsFilter; // 女神回应他的裁决
  if (kind === 'welcome') return actor === ttsFilter; // 他的欢迎语
  return false; // godcast / goddess 公开广播：过滤模式下不播
}

// 播报文本清理：去 MC 格式码 / 语音输入前缀 / 开头动作描写括号 / 残留音频 emoji
function cleanTtsText(t) {
  let s = String(t || '').replace(/\u00a7./g, '').trim();
  s = s.replace(/^[\u{1F3A4}\u{1F399}\u{1F3A7}]+\s*(Speech Input|语音输入|voice input)\s*[\u{1F3A4}\u{1F399}\u{1F3A7}]*\s*[:：]?\s*/iu, '');
  s = s.replace(/^[（(][^（()）]*[）)]\s*/, '');
  s = s.replace(/[\u{1F3A4}\u{1F399}\u{1F3A7}]/gu, '');
  return s.trim();
}

function ttsVoiceFor(speaker, kind) {
  if (kind === 'goddess') return ttsVoices.goddess;
  if (kind === 'player') return ttsVoices.player;
  if (speaker && (ttsNpcOverride[speaker] || ttsBySpeaker[speaker])) return ttsNpcOverride[speaker] || ttsBySpeaker[speaker];
  return ttsVoices.npc;
}

function ttsSpeak(text, kind, speaker) {
  if (!ttsEnable) return;
  const clean = cleanTtsText(text);
  if (!clean) return;
  // 角色前缀：让听者一听就知道谁在说
  let label = '';
  if (kind === 'goddess') label = '女神：';
  else if (kind === 'player') label = (PLAYER_DISPLAY[speaker] || speaker || '玩家') + '：';
  else if (speaker) label = speaker + '：';
  const priority = kind === 'goddess' || (kind === 'player' && VIP_PRIORITY.includes(speaker));
  if (priority) {
    ttsQ.length = 0; ttsStop();       // 女神话 / 重点看护玩家：优先且打断
  } else if (ttsQ.length >= 3) {
    ttsQ.shift();                     // 其余台词限长 3，防刷屏
  }
  ttsQ.push({ clean: label + clean, kind, speaker });
  ttsPump();
}
function ttsStop() {
  ttsBusy = false;
  if (ttsPrefetch) { try { URL.revokeObjectURL(ttsPrefetch.url); } catch {} ttsPrefetch = null; }
  try { if (ttsAudioEl) { ttsAudioEl.onended = null; ttsAudioEl.onerror = null; ttsAudioEl.pause(); ttsAudioEl.src = ''; } } catch {}
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch {}
}
async function ttsPump() {
  if (ttsBusy || !ttsQ.length) return;
  ttsBusy = true;
  const job = ttsQ.shift();
  const voice = ttsVoiceFor(job.speaker, job.kind);
  let ok = false;
  // 流水线：用预合成的下一条（无等待），否则现取
  if (ttsPrefetch && ttsPrefetch.key === job.clean + '\u0000' + voice) {
    const pf = ttsPrefetch; ttsPrefetch = null;
    ok = await ttsPlayUrl(pf.url);
  } else {
    try { ok = await ttsPlayIndex(job.clean, voice); } catch { ok = false; }
  }
  if (!ok) ttsPlayFallback(job.clean, job.kind); // TTS 服务超时/挂 -> 浏览器兜底
  ttsBusy = false;
  ttsPrefetchNext();
  ttsPump();
}
function ttsPrefetchNext() {
  if (ttsPrefetch || !ttsQ.length) return;
  const next = ttsQ[0];
  const voice = ttsVoiceFor(next.speaker, next.kind);
  const key = next.clean + '\u0000' + voice;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 55000);
  fetch('/api/tts', {
    method: 'POST', signal: ctl.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: next.clean, voice }),
  }).then((r) => {
    if (!r.ok) throw new Error('tts ' + r.status);
    return r.blob();
  }).then((blob) => {
    if (ttsPrefetch) URL.revokeObjectURL(ttsPrefetch.url);
    ttsPrefetch = { url: URL.createObjectURL(blob), key };
  }).catch(() => {}).finally(() => { clearTimeout(timer); });
}
function ttsPlayUrl(url) {
  return new Promise((resolve) => {
    const a = ttsAudioEl || (ttsAudioEl = document.createElement('audio'));
    ttsAudioEl = a;
    a.src = url;
    a.onended = () => { URL.revokeObjectURL(url); resolve(true); };
    a.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
    const p = a.play();
    if (p) p.catch(() => { URL.revokeObjectURL(url); resolve(false); });
  });
}
function ttsPlayIndex(text, voice, mood) {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 50000);
    fetch('/api/tts', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, mood: mood || undefined }),
    }).then((r) => {
      if (!r.ok) throw new Error('tts ' + r.status);
      return r.blob();
    }).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = ttsAudioEl || (ttsAudioEl = document.createElement('audio'));
      ttsAudioEl = a;
      a.src = url;
      a.onended = () => { URL.revokeObjectURL(url); resolve(true); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      const p = a.play();
      if (p) p.catch(() => { URL.revokeObjectURL(url); resolve(false); });
    }).catch(() => { clearTimeout(timer); resolve(false); })
      .finally(() => { clearTimeout(timer); });
  });
}
function ttsPlayFallback(text, kind) {
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    if (ttsSynthVoice) u.voice = ttsSynthVoice;
    u.lang = (ttsSynthVoice && ttsSynthVoice.lang) || 'zh-CN';
    u.pitch = kind === 'goddess' ? 0.82 : 1.1;  // 女神低沉庄重 / NPC 清亮
    u.rate = kind === 'goddess' ? 0.95 : 1.0;
    window.speechSynthesis.speak(u);
  } catch {}
}

// 每次刷新 state 后调用：比对游标，把新出现的台词交给 TTS（旧→新顺序，保证先后自然）。
function playTtsFromState() {
  if (!ttsEnable) return;
  const chron = (state.chronicle || []).slice().reverse(); // 旧→新
  const feed = (state.npcFeed || []).slice().reverse();     // 旧→新
  if (!ttsBooted) {
    // 首次载入：把游标拉到当前最新，不播旧历史，只播此后的新台词
    ttsBooted = true;
    ttsSeen.chronT = chron.length ? Math.max(...chron.map((e) => e.at || 0)) : 0;
    ttsSeen.feedT = feed.length ? Math.max(...feed.map((e) => e.t || 0)) : 0;
    return;
  }
  const strip = (t) => String(t || '').replace(/\u00a7./g, '').trim();
  for (const e of chron) {
    const at = e.at || 0;
    if (at <= ttsSeen.chronT) continue;
    ttsSeen.chronT = Math.max(ttsSeen.chronT, at);
    const d = e.detail || {};
    if (e.type === 'verdict' && ttsFiltered('verdict', null, null, e.actor)) ttsSpeak(d.reply, 'goddess', '女神');
    else if (e.type === 'godcast' && !ttsFilter) ttsSpeak(d.reply || d.text, 'goddess', '女神');
    else if (e.type === 'welcome' && ttsFiltered('welcome', null, null, e.actor)) ttsSpeak(d.text, 'goddess', '女神');
  }
  for (const e of feed) {
    const t = e.t || 0;
    if (t <= ttsSeen.feedT) continue;
    ttsSeen.feedT = Math.max(ttsSeen.feedT, t);
    const txt = strip(e.text);
    if (!txt) continue;
    if (e.kind === 'goddess' && !ttsFilter) ttsSpeak(txt, 'goddess', '女神');
    else if (e.kind === 'say' && ttsFiltered('say', null, e.to, null)) ttsSpeak(txt, 'npc', e.npc);
    else if (e.kind === 'player' && ttsFiltered('player', e.who, null, null)) ttsSpeak(txt, 'player', e.who || e.npc); // 玩家的话：独立音色 + 角色前缀
    // event（看护/拉回）不播，避免刷屏
  }
}

function ttsRenderToggle() {
  const b = document.getElementById('vbtn-tts');
  if (!b) return;
  b.dataset.on = ttsEnable ? '1' : '0';
  b.textContent = ttsEnable ? '🔊 语音 · 开' : '🔇 语音 · 关';
  b.title = ttsEnable ? '语音播报开启（再点关闭）' : '语音播报关闭（再点开启）';
}

// 语音卡：女神/NPC 音色选择 + 试听（读网关照 /api/tts/voices 填充）
function renderTtsForm() {
  const el = document.getElementById('tts-form');
  if (!el) return;
  const vlabel = (v) => ttsVoiceLabels[v] || TTS_LEGACY_DISPLAY[v] || v;
  const goptions = ttsVoiceList.map((v) => '<option value="' + esc(v) + '"' + (v === ttsVoices.goddess ? ' selected' : '') + '>' + esc(vlabel(v)) + '</option>').join('');
  const noptions = ttsVoiceList.map((v) => '<option value="' + esc(v) + '"' + (v === ttsVoices.npc ? ' selected' : '') + '>' + esc(vlabel(v)) + '</option>').join('');
  const poptions = ttsVoiceList.map((v) => '<option value="' + esc(v) + '"' + (v === ttsVoices.player ? ' selected' : '') + '>' + esc(vlabel(v)) + '</option>').join('');
  const npcRows = NPC_SPEAKERS.map((name) => {
    const def = NPC_VOICE_MOOD[name] || {};
    const curV = ttsNpcOverride[name] || ttsBySpeaker[name] || def.voice || '';
    const curM = ttsNpcMood[name] || def.mood || '';
    const vopts = '<option value="">（默认' + (ttsBySpeaker[name] || def.voice ? '：' + esc(vlabel(ttsBySpeaker[name] || def.voice)) : '）') + '</option>'
      + ttsVoiceList.map((v) => '<option value="' + esc(v) + '"' + (v === curV ? ' selected' : '') + '>' + esc(vlabel(v)) + '</option>').join('');
    const mopts = '<option value="">（默认' + (def.mood ? '：' + (TTS_MOODS.find((m) => m[0] === def.mood) || [])[1] || def.mood : '）') + '</option>'
      + TTS_MOODS.map(([mk, ml]) => '<option value="' + mk + '"' + (mk === curM ? ' selected' : '') + '>' + ml + '</option>').join('');
    return '<div class="kvrow npcvoice"><span class="k" title="' + esc(name) + '">' + esc(name) + '</span>'
      + '<select class="vsel" data-npc="' + esc(name) + '">' + vopts + '</select>'
      + '<select class="msel" data-npcm="' + esc(name) + '">' + mopts + '</select>'
      + '<button class="vbtn" data-npct="' + esc(name) + '">试听</button></div>';
  }).join('');
  el.innerHTML =
    '<div class="kvrow"><span class="k">女神</span><select class="vsel" id="tts-v-goddess">' + goptions + '</select><button class="vbtn" id="tts-t-goddess">试听</button></div>' +
    '<div class="kvrow"><span class="k">NPC 默认</span><select class="vsel" id="tts-v-npc">' + noptions + '</select><button class="vbtn" id="tts-t-npc">试听</button></div>' +
    '<div class="kvrow"><span class="k">玩家</span><select class="vsel" id="tts-v-player">' + poptions + '</select><button class="vbtn" id="tts-t-player">试听</button></div>' +
    '<div class="kvrow"><span class="k">播报范围</span><select class="vsel" id="tts-v-filter"></select><span class="muted" style="font-size:11px">全部 / 只看某玩家</span></div>' +
    '<div class="muted" style="padding:8px 0 2px;border-top:1px solid #30363d;margin-top:6px">NPC 音色（一人一音色，选「（默认）」用 NPC 默认）</div>' +
    '<div class="npcvoice-grid">' + npcRows + '</div>';
  const g = document.getElementById('tts-v-goddess'), n = document.getElementById('tts-v-npc'), p = document.getElementById('tts-v-player');
  if (g) g.onchange = (ev) => { ttsVoices.goddess = ev.target.value; localStorage.setItem('ttsVoiceGoddess', ev.target.value); };
  if (n) n.onchange = (ev) => { ttsVoices.npc = ev.target.value; localStorage.setItem('ttsVoiceNpc', ev.target.value); };
  if (p) p.onchange = (ev) => { ttsVoices.player = ev.target.value; localStorage.setItem('ttsVoicePlayer', ev.target.value); };
  const tg = document.getElementById('tts-t-goddess'), tn = document.getElementById('tts-t-npc'), tp = document.getElementById('tts-t-player');
  if (tg) tg.onclick = () => ttsPreview(ttsVoices.goddess, 'goddess');
  if (tn) tn.onclick = () => ttsPreview(ttsVoices.npc, 'npc');
  if (tp) tp.onclick = () => ttsPreview(ttsVoices.player, 'player');
  el.querySelectorAll('select[data-npc]').forEach((sel) => {
    sel.onchange = () => {
      const name = sel.dataset.npc;
      if (sel.value) { ttsNpcOverride[name] = sel.value; localStorage.setItem('ttsVoiceNpc_' + name, sel.value); }
      else { delete ttsNpcOverride[name]; localStorage.removeItem('ttsVoiceNpc_' + name); }
    };
  });
  el.querySelectorAll('select[data-npcm]').forEach((sel) => {
    sel.onchange = () => {
      const name = sel.dataset.npcm;
      if (sel.value) { ttsNpcMood[name] = sel.value; localStorage.setItem('ttsMoodNpc_' + name, sel.value); }
      else { delete ttsNpcMood[name]; localStorage.removeItem('ttsMoodNpc_' + name); }
    };
  });
  el.querySelectorAll('button[data-npct]').forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.npct;
      const def = NPC_VOICE_MOOD[name] || {};
      const voice = ttsNpcOverride[name] || ttsBySpeaker[name] || def.voice || ttsVoices.npc;
      const mood = ttsNpcMood[name] || def.mood || '';
      const sample = def.sample || '神说，这世界有光。';
      ttsStop(); ttsQ.length = 0; ttsBusy = false;
      ttsPlayIndex(sample, voice, mood).then((ok) => { if (!ok) ttsPlayFallback(sample, 'npc'); });
    };
  });
  updateTtsFilterOptions();
}
function ttsPreview(voice, kind) {
  ttsStop(); ttsQ.length = 0; ttsBusy = false;
  const preview = '神说，这世界有光。';
  ttsPlayIndex(preview, voice).then((ok) => { if (!ok) ttsPlayFallback(preview, kind || 'npc'); });
}
// 播报范围下拉：全部 + 在线玩家（world.watching）+ 已知真人（PLAYER_DISPLAY），保留当前选择
function updateTtsFilterOptions() {
  const el = document.getElementById('tts-v-filter');
  if (!el) return;
  const names = new Set(['']);
  (state.world && state.world.watching || []).forEach((n) => names.add(n));
  Object.keys(PLAYER_DISPLAY).forEach((n) => names.add(n));
  el.innerHTML = '<option value="">全部</option>' + [...names].filter(Boolean).map((n) =>
    '<option value="' + esc(n) + '"' + (n === ttsFilter ? ' selected' : '') + '>' + esc(PLAYER_DISPLAY[n] || n) + '</option>').join('');
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.onchange = (ev) => {
      ttsFilter = ev.target.value;
      localStorage.setItem('ttsFilterPlayer', ttsFilter);
    };
  }
}
async function loadVoiceList() {
  try {
    const r = await fetch('/api/tts/voices');
    if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.voices) && j.voices.length) { ttsVoiceList = j.voices; ttsVoiceLabels = j.labels || {}; } }
  } catch {}
  renderTtsForm();
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

// ---- 世界控制卡（#4）：难度 / 时间 / 天气 / 游戏规则 ----
let worldctl = { ok: false, difficulty: null, ticks: null, gamerules: {} };
async function loadWorldCtl() {
  try {
    const r = await fetch('/api/world');
    if (!r.ok) return;
    const j = await r.json();
    worldctl = Object.assign({ ok: false, difficulty: null, ticks: null, gamerules: {} }, j);
    renderWorldCtl();
  } catch { /* 世界进程未起/RCON 抖动 */ }
}
const DIFF_ZH = [['peaceful', '和平'], ['easy', '简单'], ['normal', '普通'], ['hard', '困难']];
const TIME_ZH = [['day', '白天'], ['noon', '正午'], ['night', '夜晚'], ['midnight', '午夜']];
const WEATHER_ZH = [['clear', '晴'], ['rain', '雨'], ['thunder', '雷暴']];
const GR_ZH = Object.fromEntries([
  ['doDaylightCycle', '日夜循环'], ['doWeatherCycle', '天气变化'], ['keepInventory', '死亡保留背包'],
  ['mobGriefing', '生物破坏'], ['naturalRegeneration', '自然回血'], ['doMobSpawning', '怪物生成'],
  ['doMobLoot', '怪物掉落'], ['doFireTick', '火焰蔓延'],
]);
function phaseOf(ticks) {
  const t = ((Number(ticks) % 24000) + 24000) % 24000;
  if (t < 1000) return '清晨';
  if (t < 13000) return '白天';
  if (t < 18000) return '黄昏·夜晚';
  return '深夜';
}
function renderWorldCtl() {
  const el = document.getElementById('worldctrl');
  if (!el) return;
  // 抽屉内正在编辑（焦点在某 input/select）时跳过重建，防止毁掉输入中的值/光标
  const ae = document.activeElement;
  if (ae && el.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
  const off = '<span class="k">读取</span><span class="v">—（世界进程未起 / RCON 抖动，按钮仍可操作）</span>';
  const diffActive = (k) => (worldctl.difficulty === ['peaceful', 'easy', 'normal', 'hard'].indexOf(k)) ? ' active' : '';
  const gr = worldctl.gamerules || {};
  const html =
    '<div class="kvrow"><span class="k">难度</span><span class="chips" style="margin:0">'
    + ['peaceful', 'easy', 'normal', 'hard'].map((k) => '<button class="vbtn' + diffActive(k) + '" data-wdiff="' + k + '">' + DIFF_ZH.reduce((a, d) => a + (d[0] === k ? d[1] : ''), '') + '</button>').join('')
    + '</span></div>'
    + '<div class="kvrow"><span class="k">时间</span><span class="chips" style="margin:0">'
    + TIME_ZH.map(([k, zh]) => '<button class="vbtn" data-wtime="' + k + '">' + zh + '</button>').join('')
    + '</span><span class="muted" style="margin-left:6px">当前 ' + (worldctl.ticks != null ? phaseOf(worldctl.ticks) + '（' + worldctl.ticks + ' tick）' : '—') + '</span></div>'
    + '<div class="kvrow"><span class="k">天气</span><span class="chips" style="margin:0">'
    + WEATHER_ZH.map(([k, zh]) => '<button class="vbtn" data-wweather="' + k + '">' + zh + '</button>').join('')
    + '</span></div>'
    + '<div class="muted" style="padding:6px 0 2px;border-top:1px solid #30363d;margin-top:6px">天气设置可选持续时长（秒，留空=按当前循环）</div>'
    + '<div class="kvrow"><span class="k">持续</span><input class="vsel" id="wx-dur" type="number" min="0" max="1000000" value="0" placeholder="0=循环"></div>'
    + '<div class="muted" style="padding:6px 0 2px;border-top:1px solid #30363d;margin-top:6px">游戏规则（点击切换）</div>'
    + '<div class="kv">' + Object.keys(GR_ZH).map((k) => {
        const v = gr[k];
        const on = v === true, offR = v === false;
        const label = (v == null ? '?' : (on ? '开' : '关'));
        return '<span class="k">' + GR_ZH[k] + '</span><span class="v"><button class="vbtn' + (on ? ' active' : '') + '" data-wg="' + k + '">' + label + '</button></span>';
      }).join('') + '</div>'
    + (worldctl.ok ? '' : '<div class="muted" style="margin-top:8px">' + off + '</div>');
  el.innerHTML = html;
  el.querySelectorAll('[data-wdiff]').forEach((b) => b.addEventListener('click', () => postWorld('difficulty', { value: b.getAttribute('data-wdiff') })));
  el.querySelectorAll('[data-wtime]').forEach((b) => b.addEventListener('click', () => postWorld('time', { value: b.getAttribute('data-wtime') })));
  el.querySelectorAll('[data-wweather]').forEach((b) => b.addEventListener('click', () => {
    const dur = Number(document.getElementById('wx-dur').value) || 0;
    postWorld('weather', { value: b.getAttribute('data-wweather'), duration: dur });
  }));
  el.querySelectorAll('[data-wg]').forEach((b) => b.addEventListener('click', () => {
    const name = b.getAttribute('data-wg');
    const cur = gr[name];
    postWorld('gamerule', { name, value: !(cur === true) });
  }));
}
async function postWorld(action, payload) {
  const el = document.getElementById('worldctrl');
  if (el) el.innerHTML = '<span class="empty" style="padding:6px 0">应用 ' + action + ' …</span>';
  try {
    const r = await fetch('/api/world', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action }, payload)) });
    if (!r.ok) { const t = await r.text(); if (el) el.innerHTML = '<div class="empty">' + esc(t.slice(0, 120)) + '</div>'; return; }
  } catch (e) { if (el) el.innerHTML = '<div class="empty">' + esc(String(e)) + '</div>'; return; }
  loadWorldCtl();
}

// ---- 村庄 / NPC 设置卡（#5）：全局配置 + 各村民半径 ----
let npcData = { global: {}, npcs: [], reloadHint: '' };
async function loadNpcCtl() {
  try {
    const r = await fetch('/api/npc/settings');
    if (!r.ok) return;
    npcData = await r.json();
    renderNpcCtl();
  } catch { /* 配置读取抖动 */ }
}
function renderNpcCtl() {
  const el = document.getElementById('npcctl');
  if (!el) return;
  const ae = document.activeElement;
  if (ae && el.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
  const g = npcData.global || {};
  const q = g.quests || {}, h = g.hear || {}, p = g.prayer || {}, l = g.llm || {};
  const val = (v) => (v == null || v === '' ? '' : v);
  const rows = (npcData.npcs || []).map((n) =>
    '<div class="kvrow"><span class="k" title="' + esc(n.key) + '">' + esc(n.display || n.key)
    + ' <span class="muted">' + (n.alive ? '🟢' : '⚫') + (n.ambient ? ' ·背景' : '') + '</span></span>'
    + '<span class="v"><input class="vsel npc-radius" data-npc="' + esc(n.key) + '" type="number" min="0" max="128" value="' + esc(n.radius == null ? '' : n.radius) + '" placeholder="全局" style="width:70px"></span></div>'
  ).join('');
  const html =
    '<div class="kvrow"><span class="k">祈愿通道</span><span class="v"><button class="vbtn' + (p.enabled ? ' active' : '') + '" data-nc="prayer.enabled">' + (p.enabled ? '开' : '关') + '</button></span></div>'
    + '<div class="kvrow"><span class="k">对话半径</span><span class="v"><input class="vsel" id="nc-hear" type="number" min="8" max="128" value="' + val(h.radius) + '" placeholder="48"></span></div>'
    + '<div class="kvrow"><span class="k">拉回半径</span><span class="v"><input class="vsel" id="nc-leash" type="number" min="8" max="128" value="' + val(q.leash_radius) + '" placeholder="40"></span></div>'
    + '<div class="kvrow"><span class="k">LLM 闲聊</span><span class="v"><button class="vbtn' + (l.enabled ? ' active' : '') + '" data-nc="llm.enabled">' + (l.enabled ? '开' : '关') + '</button></span></div>'
    + '<div class="muted" style="padding:6px 0 2px;border-top:1px solid #30363d;margin-top:6px">各村民拉回半径（空=用全局）</div>'
    + '<div class="kv">' + (rows || '<span class="empty">无村民档案</span>') + '</div>'
    + '<div class="kvrow" style="margin-top:10px;gap:8px"><button class="vbtn" id="npc-save">💾 保存</button>'
    + '<span class="muted" id="npc-save-msg">' + esc(npcData.reloadHint || '') + '</span></div>';
  el.innerHTML = html;
  el.querySelectorAll('[data-nc]').forEach((b) => b.addEventListener('click', () => saveNpcCtl()));
  document.getElementById('npc-save')?.addEventListener('click', saveNpcCtl);
}
async function saveNpcCtl() {
  const msg = document.getElementById('npc-save-msg');
  const g = npcData.global || {};
  const patch = { global: {}, npcs: [] };
  patch.global.prayer = { enabled: !!document.querySelector('[data-nc="prayer.enabled"]')?.classList.contains('active') };
  patch.global.llm = { enabled: !!document.querySelector('[data-nc="llm.enabled"]')?.classList.contains('active') };
  patch.global.hear = { radius: Number(document.getElementById('nc-hear').value) || null };
  patch.global.quests = { leash_radius: Number(document.getElementById('nc-leash').value) || null };
  document.querySelectorAll('.npc-radius').forEach((i) => {
    const v = i.value.trim();
    patch.npcs.push({ key: i.getAttribute('data-npc'), radius: v === '' ? null : Number(v) });
  });
  if (msg) msg.textContent = '保存中…';
  try {
    const r = await fetch('/api/npc/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await r.json();
    if (msg) msg.textContent = r.ok ? ('已保存 ✓ ' + (j.reloadHint || npcData.reloadHint || '重载后生效')) : ('失败: ' + (j.error || r.status));
  } catch (e) { if (msg) msg.textContent = '失败: ' + e; }
}

function renderTabs() {
  const el = document.getElementById('tabs');
  if (!state.bots.length) {
    el.innerHTML = '<span class="muted">暂无穿越者在线（bot 未运行）</span>';
    return;
  }
  // 去重：统一用 personaName（服务器真实名/中文显示名）作 tab 键，
  // 避免 username(英文 Kirito/Naruto) 与心跳中文名('桐人') 分裂成两个 tab。
  // 同键出现多条（占位 + 档案）时保留信息更全（有 position/viewer 端口/username）的。
  const merged = [];
  const seenK = new Set();
  for (const b of state.bots) {
    const k = b.bot?.personaName || b.bot?.username || '';
    const idx = seenK.has(k) ? merged.findIndex((x) => ((x.bot?.personaName || x.bot?.username || '') === k)) : -1;
    if (idx === -1) { seenK.add(k); merged.push(b); }
    else {
      const w = (x) => ((x.bot?.position ? 2 : 0) + (x.bot?.viewerPort ? 1 : 0) + (x.bot?.username ? 1 : 0));
      if (w(b) > w(merged[idx])) merged[idx] = b;
    }
  }
  el.innerHTML = merged.map((b) => {
    const bot = b.bot || {};
    const on = !!bot.online;
    const name = bot.personaName || bot.username;
    const key = bot.personaName || bot.username || name;
    const cls = currentUser === key ? 'tab active' : 'tab';
    const sk = skinFor(bot.username || bot.personaName);
    const avatar = (sk && sk.ok) ? '<img class="tavatar" src="' + sk.faceURL + '">' : '';
    const mg = magicOf(bot.username || bot.personaName);
    const lv = mg && mg.level ? '<span class="lv">Lv' + mg.level + '</span>' : '';
    return '<div class="' + cls + '" data-u="' + esc(key) + '">'
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
      eyeFollowTo(currentUser);
    });
  });
}

// 生命条 HTML（HP / 饱食 / 魔力）
function renderVitals(bot, mg) {
  const el = document.getElementById('vitals');
  if (!bot.online) { el.innerHTML = ''; return; }
  // #4 修复：health/food 可能为浮点小数、或对无 status 档案的真人缺失（显示为假 0）——取整 + 未知占位
  const hasHp = Number.isFinite(bot.health), hp = Math.round(Number(bot.health) || 0);
  const hasFood = Number.isFinite(bot.food), food = Math.round(Number(bot.food) || 0);
  const rows = [];
  rows.push('<div class="vital"><span class="vlabel">❤ 生命</span>'
    + '<div class="vbar"><div class="vfill hp' + (hasHp && hp <= 6 ? ' low' : '') + '" style="width:' + (hasHp ? Math.min(100, hp / 20 * 100) : 0) + '%"></div></div>'
    + '<span class="vnum">' + (hasHp ? hp + '/20' : '—/—') + '</span></div>');
  rows.push('<div class="vital"><span class="vlabel">🍗 饱食</span>'
    + '<div class="vbar"><div class="vfill food' + (hasFood && food <= 6 ? ' low' : '') + '" style="width:' + (hasFood ? Math.min(100, food / 20 * 100) : 0) + '%"></div></div>'
    + '<span class="vnum">' + (hasFood ? food + '/20' : '—/—') + '</span></div>');
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

// NPC 对话行（聊天条/村口共用）
function npcLine(e) {
  if (!e) return '';
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
  return line;
}

// 世界之声（#2）：对话流 + 系统提示。对话（say/goddess/player/chat）才进聊天记录；
// 系统事件（拉回铺子/离世界/死亡/加入）瘦身成一条置顶系统提示（#信息透出），不刷屏。
function renderChatBar() {
  const el = document.getElementById('steps');
  if (!el) return;
  const dt = (v) => {
    const d = new Date(String(v || '').replace(' ', 'T'));
    return (d && !isNaN(d.getTime())) ? d.toLocaleTimeString('zh-CN', { hour12: false }) : '';
  };
  // —— 系统提示：死亡/加入/离世界/世界看护拉回 聚合为一条 ——
  const sysRows = [];
  for (const e of (state.chronicle || [])) {
    if (['chat', 'xp'].includes(e.type)) continue;
    if (['event', 'join', 'leave', 'death'].includes(e.type)) { try { sysRows.push({ t: e.at || '', h: chronLine(e) }); } catch {} }
  }
  for (const e of (state.npcFeed || [])) {
    if (e.kind === 'event') sysRows.push({ t: (e.t || e.ts || ''), h: npcLine(e) });
  }
  sysRows.sort((a, b) => String(b.t).localeCompare(String(a.t)));
  const sysEl = document.getElementById('sysbar');
  if (sysEl) {
    if (sysRows.length) {
      sysEl.innerHTML = '<span class="sys-ico">🛡 系统</span>' + (sysRows[0].h || '');
      sysEl.style.display = 'flex';
    } else { sysEl.style.display = 'none'; }
  }
  // —— 对话流：只留真正的对话 ——
  const rows = [];
  for (const e of (state.chronicle || [])) {
    if (['chat', 'say', 'goddess'].includes(e.type)) { try { rows.push({ t: e.at || '', h: chronLine(e) }); } catch {} }
  }
  for (const e of (state.npcFeed || [])) {
    if (['say', 'goddess', 'player'].includes(e.kind)) rows.push({ t: (e.t || e.ts || ''), h: npcLine(e) });
  }
  rows.sort((a, b) => String(b.t).localeCompare(String(a.t)));
  const tail = rows.slice(0, 200);
  el.innerHTML = tail.length ? tail.map((r) => '<div class="ce"><span class="ct">' + dt(r.t) + '</span><span class="cx">' + r.h + '</span></div>').join('') : '<div class="empty">暂无对话记录</div>';
}

// 设置抽屉（#3）：配置类卡片收进右侧抽屉；村口实况/编年史卡片移除（聊天条接管）
function tuckSettings() {
  const drawer = document.getElementById('settings-drawer');
  if (!drawer) return;
  ['skills', 'skin-presets', 'tts-form', 'inv', 'memory', 'worldctrl', 'npcctl'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.closest) { const card = el.closest('.card'); if (card) drawer.appendChild(card); }
  });
  ['npcfeed', 'chronicle'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.closest) { const card = el.closest('.card'); if (card) card.remove(); }
  });
}
function initSettingsDrawer() {
  tuckSettings();
  const toggle = document.getElementById('settings-toggle');
  const close = document.getElementById('drawer-close');
  const backdrop = document.getElementById('settings-backdrop');
  if (toggle && !toggle.dataset.bound) {
    toggle.dataset.bound = '1';
    const shut = () => { document.body.classList.remove('drawer-open'); renderCurrent(); };
    toggle.addEventListener('click', () => document.body.classList.add('drawer-open'));
    if (close) close.addEventListener('click', shut);
    if (backdrop) backdrop.addEventListener('click', shut);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut(); });
  }
}

// 村口 NPC（#1）：读 /api/village 拿 villagers spawn 坐标，画到小地图
async function loadVillage() {
  try {
    const r = await fetch('/api/village');
    if (!r.ok) return;
    const d = await r.json();
    state.villageNpcs = (d.npcs || []).map((n) => ({ key: n.key, display: n.display, spawn: n.spawn }));
    drawMap();
  } catch { /* 静默 */ }
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
  const dbgEl = document.getElementById('dbg');
  if (dbgEl) dbgEl.textContent = 'cu=' + currentUser + ' | b0.bot=' + JSON.stringify(state.bots[0] && state.bots[0].bot) + ' | b0.username=' + JSON.stringify(state.bots[0] && state.bots[0].username);
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
  const wantPort = hasBotViewer ? (viewMode === 'first' ? vp + 100 : vp) : (viewMode === 'first' ? GODDESS_PORT + 100 : GODDESS_PORT);
  if (hasBotViewer) probeViewer(wantPort); // 异步探活，结论变化经缓存触发回落重渲
  const probing = hasBotViewer && vprobe.port !== wantPort; // 该口尚无结论：先信在线 bot，不闪回落
  const viewerOk = hasBotViewer ? (probing ? true : vprobe.ok) : false;
  // 回落女神视角时也按视界切换端口（3050 第三人称 / 3150=GODDESS_PORT+100 第一人称），
  // 否则守卫等无 bot viewer 的实体 first/third 切换永远无效（2026-08-23）。
  const showPort = viewerOk ? wantPort : (viewMode === 'first' ? GODDESS_PORT + 100 : GODDESS_PORT);
  const frame = document.getElementById('viewer-frame');
  const want = 'http://' + location.hostname + ':' + showPort + '/'
    + (viewerOk ? '?skin=' + (bot.username || '').toLowerCase() + (viewMode === 'first' ? '&fov=110' : '&follow=smart') : (viewMode === 'first' ? '?fov=110' : '?follow=smart'))
    + '&pv=8'; // pv=镜头补丁版本，cache-bust（v7=+Goddess 回落）
  if (frame.getAttribute('src') !== want) frame.setAttribute('src', want);
  document.getElementById('viewer-title').textContent = viewerOk
    ? name + '（' + (viewMode === 'first' ? '第一人称' : '第三人称·智能运镜') + '）'
    : 'Goddess（天眼·' + (viewMode === 'first' ? '第一人称' : '第三人称') + '）';

  // 等级徽章 / 睡觉 chip
  const mg = magicOf(bot.username || currentUser);
  const badge = document.getElementById('lv-badge');
  if (mg && mg.level != null) {
    badge.style.display = '';
    badge.textContent = 'Lv ' + mg.level + (mg.maxMana ? ' · 魔力上限 ' + mg.maxMana : '');
  } else badge.style.display = 'none';
  document.getElementById('sleep-chip').style.display = bot.sleeping ? '' : 'none';

  // 生命/饱食：穿越者 status 档案缺失时（守卫/真人/化身），用 RCON 实查补上
  const insp = (bot.username && inspectCache[bot.username]) ? inspectCache[bot.username].d : null
  if (insp && on) {
    if (!Number.isFinite(bot.health) && insp.health != null) bot.health = insp.health
    if (!Number.isFinite(bot.food) && insp.food != null) bot.food = insp.food
  }
  renderVitals(bot, mg);
  renderSkills();
  renderChatBar();

  // 基础状态 kv（正在输入时不重建，防止焦点丢失）
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (!typing) {
    const pc = posCache[bot.username || currentUser];
    const pos = bot.position ? '(' + bot.position.x + ', ' + bot.position.y + ', ' + bot.position.z + ')'
      : (pc ? '(' + pc.x + ', ' + pc.y + ', ' + pc.z + ')' : '-');
    if (on && !bot.position && !pc) fetchPosFor(bot.username); // 无档案在线玩家：RCON 查坐标
    const rows = on ? [
      ['身份', name + '（' + (bot.username || '-') + '）'],
      ['状态', '<span style="color:var(--green)">在线</span>'],
      ['位置', pos],
      ['手持', esc(bot.heldItem || '空手')],
    ] : [];
    if (on && insp) { // RCON 实查的氧气/等级（众生通用）
      if (insp.health != null) rows.push(['生命', Math.round(insp.health) + '/20'])
      if (insp.food != null) rows.push(['饱食', Math.round(insp.food) + '/20'])
      rows.push(['氧气', Math.round(insp.air ?? 0) + '/300'])
      rows.push(['等级', 'Lv ' + (insp.xp ?? 0)])
    }
    document.getElementById('status').innerHTML = rows.length
      ? rows.map(([k, v]) => '<span class="k">' + k + '</span><span class="v">' + v + '</span>').join('')
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

  // 背包：优先 RCON 实查网格（众生通用：守卫/真人/化身），回落穿越者 status 档案 chips
  const invUser = bot.username || currentUser
  if (on && invUser) fetchInspectFor(invUser) // 异步刷，5s TTL，落 cache 后触发重渲
  const gotGrid = (on && invUser && inspectCache[invUser]) ? renderInspect(invUser, name) : false
  if (!gotGrid) {
    const inv = bot.inventory || [];
    if (on && invUser && !inspectCache[invUser]) {
      document.getElementById('inv-sub').textContent = name + ' · 实查中…'
      document.getElementById('inv').innerHTML = '<span class="muted">实查中…</span>'
    } else {
      document.getElementById('inv-sub').textContent = inv.length ? inv.length + ' 种（档案）' : '';
      document.getElementById('inv').innerHTML = inv.length
        ? inv.map((i) => '<span class="chip">' + esc(i.name) + ' ×' + i.count + '</span>').join('')
        : '<span class="muted">空</span>'
    }
  }

  // #steps（聊天记录）由 renderChatBar() 全权渲染；此处不再用 recentSteps（服务端取不到思考流）。
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

  // NPC（村民，来自 villagers.json spawn 坐标）—— #1 村民不显示
  (state.villageNpcs || []).forEach((n) => {
    if (!n.spawn || n.spawn.length < 3) return;
    const px = sx(n.spawn[0]), py = sy(n.spawn[2]);
    if (px < -10 || py < -10 || px > W + 10 || py > H + 10) return;
    ctx.fillStyle = '#f0883e';
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#e6edf3'; ctx.font = '9px sans-serif';
    ctx.fillText((n.display || 'NPC'), px + 5, py - 3);
  });

  // 怪物（女神天眼视野内的 mob）—— #1 怪物显示
  (state.entities || []).forEach((e) => {
    if (!e.isMob) return;
    const px = sx(e.x), py = sy(e.z);
    if (px < -10 || py < -10 || px > W + 10 || py > H + 10) return;
    ctx.fillStyle = '#f85149';
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1; ctx.stroke();
  });

  // 其他 bot（紫色圆点 / 皮肤头像）
  state.bots.forEach((b) => {
    const bot = b.bot || {};
    if (!bot.online || !bot.position) return;
    if (bot.username === currentUser || bot.personaName === currentUser) return;
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
    + '<span><i style="background:#f0883e"></i>NPC</span>'
    + '<span><i style="background:#f85149"></i>怪物</span>'
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
    const names = (w.watching || []).map((x) => PLAYER_DISPLAY[x] || x);
    const n = names.length;
    const who = n ? names.join('、') : '（空）';
    el.textContent = '世界在线 · ' + n + ' 人：' + who + ' · ' + Math.round(age) + 's';
    el.title = '每 2 秒由世界进程心跳刷新；含真人玩家与假玩家';
  }
}

async function refresh() {
  try {
    const r = await fetch('/api/state');
    const s = await r.json();
    const prevFeedT = (state.npcFeed && state.npcFeed.length) ? Math.max(...state.npcFeed.map((e) => e.t || 0)) : 0;
    state = s;
    playTtsFromState(); // 语音播报：新出现的 NPC/女神台词 → TTS
    maybeCameraCue(s, prevFeedT);
    // 首次或当前 bot 已消失时，自动选中第一个在线的 bot。
    if (!currentUser || !botOf(currentUser)) {
      const first = s.bots.find((b) => b.bot?.online) || s.bots[0];
      currentUser = first?.bot?.personaName || first?.bot?.username || null;
    }
    document.getElementById('sub').textContent = (s.updatedAt ? '更新于 ' + await fmtTime(s.updatedAt) : '')
      + ' · ' + s.bots.length + ' 位穿越者 · 每 2 秒刷新';
    renderWorldChip(s.world);
    updateTtsFilterOptions(); // 播报范围下拉：按在线玩家动态补全（保留当前选择）
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
      eyeFollowTo(u);
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
    // 重载 iframe 以重置镜头位置；天眼跟随停止并归位
    eyeFollowStop();
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

  // 语音播报（TTS）开关：开/关 + 开关后重定游标（只播重启后的新台词，不重放旧历史）
  const ttsBtn = document.getElementById('vbtn-tts');
  if (ttsBtn && !ttsBtn.dataset.bound) {
    ttsBtn.dataset.bound = '1';
    ttsRenderToggle();
    ttsBtn.addEventListener('click', () => {
      ttsEnable = !ttsEnable;
      localStorage.setItem('ttsEnable', ttsEnable ? '1' : '0');
      ttsSeen.chronT = 0; ttsSeen.feedT = 0; ttsBooted = false;
      if (!ttsEnable) { try { window.speechSynthesis.cancel(); } catch {} ttsQ.length = 0; ttsBusy = false; }
      ttsRenderToggle();
    });
  }
}

refresh();
initMapInteraction();
initViewButtons();
initZoomButtons();
initSettingsDrawer();
loadVillage();
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
loadVoiceList();
loadWorldCtl(); setInterval(loadWorldCtl, 30000);
loadNpcCtl(); setInterval(loadNpcCtl, 45000);
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
  const viaEnv = process.env.MC_DATA_DIR ? join(process.env.MC_DATA_DIR, 'rcon-secret.txt') : null
  for (const p of [viaEnv, join(__dirname, 'data', 'rcon-secret.txt'), join(__dirname, '..', 'data', 'rcon-secret.txt')]) {
    if (!p) continue
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

// 复用持久 RCON 连接：天眼跟随每 600ms 调 rconExec，原实现每次 net.connect 新连+认证+销毁，
// 导致 RCON 连接风暴（也是"女神站位爬升"根因之一，女神被悬到目标上方时反复 tp 还狂开连接）。
// 改为保持一条已认证连接并复用；命令串行化避免同一 socket 并发写交错；断连自动重建自愈。
let _rcSock = null
let _rcAuth = false
let _rcLock = Promise.resolve()

function _rcClose() {
  if (_rcSock) { try { _rcSock.destroy() } catch { /* 无碍 */ } }
  _rcSock = null
  _rcAuth = false
}

function _rcSerialize(fn) {
  const run = _rcLock.then(fn, fn)
  _rcLock = run.catch(() => {})
  return run
}

async function _rcEnsure() {
  const secret = rconReadSecret()
  if (_rcSock && _rcAuth) return _rcSock
  _rcClose()
  const sock = net.connect(RCON_PORT, RCON_HOST)
  sock.setNoDelay(true)
  sock.on('close', () => { if (_rcSock === sock) _rcAuth = false })
  sock.on('error', () => { if (_rcSock === sock) _rcAuth = false })
  await new Promise((ok, bad) => { sock.once('connect', ok); sock.once('error', bad) })
  const auth = await rconSendRecv(sock, 1, 3, secret)
  if (auth.id === -1) { sock.destroy(); throw new Error('rcon auth failed') }
  _rcSock = sock
  _rcAuth = true
  return sock
}

function rconExec(cmd) {
  return _rcSerialize(async () => {
    try {
      const sock = await _rcEnsure()
      const out = await rconSendRecv(sock, 2, 2, cmd)
      return out.body
    } catch (e) {
      _rcClose() // 命令失败/断连：丢弃连接，等下次调用重建
      throw e
    }
  })
}

// 大响应版（如 Inventory NBT 可超 RCON 单包 4096B，服务端分包）：静默窗口聚合所有分包再拼。
// 与 rconExec 同一把串行锁；小响应也安全（多等 quietMs）。分包边界若切断 UTF-8 字符，极端
// 情况一两个物品名首字符乱码（各自 toString 的代价），可接受。
function rconSendRecvAll(sock, id, type, body, quietMs = 220) {
  return new Promise((resolve, reject) => {
    let pending = []
    const parts = []
    let quiet = null
    const hard = setTimeout(() => { cleanup(); reject(new Error('rcon timeout')) }, 6000)
    function cleanup() { clearTimeout(hard); clearTimeout(quiet); sock.removeListener('data', onData) }
    function onData(d) {
      pending.push(d)
      for (;;) {
        const all = Buffer.concat(pending)
        if (all.length < 4) break
        const len = all.readInt32LE(0)
        if (all.length < 4 + len) break
        parts.push(all.toString('utf-8', 12, 4 + len - 2))
        pending = all.length > 4 + len ? [all.subarray(4 + len)] : []
      }
      clearTimeout(quiet)
      quiet = setTimeout(() => { cleanup(); resolve(parts.join('')) }, quietMs)
    }
    sock.on('data', onData)
    sock.write(rconPacket(id, type, body))
  })
}
function rconExecBig(cmd) {
  return _rcSerialize(async () => {
    try {
      const sock = await _rcEnsure()
      return await rconSendRecvAll(sock, 2, 2, cmd)
    } catch (e) {
      _rcClose()
      throw e
    }
  })
}

// ---- /api/inspect 的 NBT(SNBT) 解析：标量 + Inventory 数组（深度游走，字符串/嵌套安全） ----
function parseSnbtScalar(out) {
  const m = String(out || '').match(/entity data:\s*([-\d.]+)/)
  return m ? Number(m[1]) : null
}
function parseSnbtItems(out) {
  const s = String(out || '')
  const i = s.indexOf('[')
  if (i < 0) return []
  const body = s.slice(i)
  const items = []
  let depth = 0, inStr = false, esc = false, elStart = -1
  for (let k = 0; k < body.length; k++) {
    const c = body[k]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; continue }
    if (c === '[' || c === '{') { if (c === '{' && depth === 1 && elStart < 0) elStart = k; depth++; continue }
    if (c === ']' || c === '}') {
      if (c === '}' && depth === 2 && elStart >= 0) {
        const el = body.slice(elStart, k + 1)
        // 注意：本服（NeoForge 1.21.1）SNBT 是带空格的宽松格式：`id: "x"`, `count: 1`(小写无b后缀),
        // `Slot: 0b`（冒号后也有空格）——正则必须 \s* 宽容 + 大小写通吃，否则 items 全空（2026-08-26 实测坑）。
        const id = el.match(/id:\s*"([^"]+)"/)
        const cnt = el.match(/[Cc]ount:\s*(\d+)/)
        const slot = el.match(/Slot:\s*(\d+)b?/)
        if (id) items.push({ slot: slot ? Number(slot[1]) : null, id: id[1], count: cnt ? Number(cnt[1]) : 1 })
        elStart = -1
      }
      depth--
      continue
    }
  }
  return items
}

// ---- 天眼跟随：点玩家 -> 女神（Goddess）tp 到其上方俯视，每 2s 跟随一次 ----
let eyeFollow = null // { name, home }
const EYE_HEIGHT = 9 // 悬停玩家上方格数（俯视；2026-08-23 从 12 调近，避免"缩放太远"看不清守卫）
function eyeTpOnce(name) {
  // 中文名 RCON 直传 Invalid，用选择器包装（与 mc_npc.py player_pos 同款）
  const target = /^[A-Za-z0-9_]{1,16}$/.test(name) ? name : `@a[name="${name.replace(/"/g, '')}",limit=1]`
  return rconExec(`execute at ${target} run tp Goddess ~ ~${EYE_HEIGHT} ~`)
}
setInterval(() => {
  if (eyeFollow && eyeFollow.name) {
    // 观察者身份（spectator）：穿墙、不干扰目标，配合高频 tp 实现丝滑天眼跟随（#5）
    rconExec('gamemode spectator Goddess').catch(() => {})
    eyeTpOnce(eyeFollow.name).catch(() => {})
  }
}, 600)

// ---- 世界控制（2026-08-23）：难度 / 时间 / 天气 / 游戏规则 —— 走 RCON 即时生效 ----
const WORLD_GAMERULES = [
  { key: 'doDaylightCycle', zh: '日夜循环' },
  { key: 'doWeatherCycle', zh: '天气变化' },
  { key: 'keepInventory', zh: '死亡保留背包' },
  { key: 'mobGriefing', zh: '生物破坏方块' },
  { key: 'naturalRegeneration', zh: '自然回血' },
  { key: 'doMobSpawning', zh: '怪物自然生成' },
  { key: 'doMobLoot', zh: '怪物掉落' },
  { key: 'doFireTick', zh: '火焰蔓延' },
]
const WORLD_GAMERULE_KEYS = WORLD_GAMERULES.map((g) => g.key)

function parseRconBool(s) {
  const v = String(s || '').toLowerCase()
  if (/true|\b1\b/.test(v) && !/false|\b0\b/.test(v)) return true
  if (/false|\b0\b/.test(v) && !/true|\b1\b/.test(v)) return false
  return null
}

// 天气无查询指令且 execute if weather run 会向全体广播，故只读难度/时间/规则，天气仅设不读
async function worldStatus() {
  const out = { ok: false, difficulty: null, ticks: null, gamerules: {} }
  try {
    const [diffRaw, timeRaw, ...ruleRaw] = await Promise.all([
      rconExec('difficulty').catch(() => ''),
      rconExec('time query daytime').catch(() => ''),
      ...WORLD_GAMERULE_KEYS.map((k) => rconExec('gamerule ' + k).catch(() => 'ERR')),
    ])
    const diff = String(diffRaw || '')
    const m = diff.match(/\b(0|1|2|3)\b/) || diff.match(/peaceful|easy|normal|hard/i)
    if (m) {
      const t = String(m[0]).toLowerCase()
      out.difficulty = /^[0-3]$/.test(t) ? Number(t) : ({ peaceful: 0, easy: 1, normal: 2, hard: 3 }[t])
    }
    const tm = String(timeRaw || '').match(/[\d-]{2,}/)
    if (tm) out.ticks = Number(tm[0])
    WORLD_GAMERULE_KEYS.forEach((k, i) => { out.gamerules[k] = parseRconBool(ruleRaw[i]) })
    out.ok = !!(diffRaw && timeRaw)
  } catch { /* 单次读失败不全盘报错 */ }
  return out
}

function applyWorld(action, body) {
  const value = String(body.value == null ? '' : body.value).toLowerCase()
  switch (action) {
    case 'difficulty': {
      const v = /^(peaceful|easy|normal|hard)$/.test(value) ? value : (/^[0-3]$/.test(value) ? value : null)
      if (!v) throw new Error('难度须为 peaceful/easy/normal/hard')
      return rconExec('difficulty ' + v)
    }
    case 'time': {
      const v = /^(day|noon|night|midnight|sunrise|sunset)$/.test(value) || /^\d{1,6}$/.test(value) ? value : null
      if (!v) throw new Error('时间须为 day/noon/night/midnight 或刻数')
      return rconExec('time set ' + v)
    }
    case 'weather': {
      const v = /^(clear|rain|thunder)$/.test(value) ? value : null
      if (!v) throw new Error('天气须为 clear/rain/thunder')
      const dur = Math.max(0, Math.min(1000000, Number(body.duration) || 0))
      return rconExec(dur > 0 ? ('weather ' + v + ' ' + dur) : ('weather ' + v))
    }
    case 'gamerule': {
      const name = String(body.name || '')
      if (!WORLD_GAMERULE_KEYS.includes(name)) throw new Error('未知规则: ' + name)
      const val = body.value === true || body.value === 'true' ? 'true' : body.value === false || body.value === 'false' ? 'false' : null
      if (val === null) throw new Error('规则值须为布尔')
      return rconExec('gamerule ' + name + ' ' + val)
    }
    default: throw new Error('未知动作: ' + action)
  }
}

// ---- 村庄 / NPC 设置（2026-08-23）：读 config.json + villagers.json，写回文件（重载 mc_npc 生效）----
function readVillageCfg() { return readJson(VILLAGE_CFG_PATH, {}) }
function readVillagers() {
  const v = readJson(VILLAGERS_PATH, {})
  return Array.isArray(v) ? v : (v?.villagers ?? [])
}

function npcSettings() {
  const cfg = readVillageCfg()
  const npcs = readVillagers().map((v) => ({
    key: v.key, display: v.display, profession: v.profession,
    spawn: v.spawn, alive: !!v.alive, ambient: !!v.ambient,
    radius: v.radius == null ? null : v.radius,
  }))
  return {
    global: {
      llm: cfg.llm || {},
      quests: cfg.quests || {},
      guild: cfg.guild || {},
      prayer: cfg.prayer || {},
      hear: cfg.hear || {},
    },
    npcs,
    reloadHint: '改配置不会自动热载，保存后需重启 mc_npc / 世界进程生效',
  }
}

// body: { global: {prayer:{enabled}, hear:{radius}, quests:{leash_radius}, llm:{enabled}}, npcs:[{key,radius}] }
function saveNpcSettings(body) {
  const cfg = readVillageCfg()
  const g = body.global || {}
  for (const [section, patch] of Object.entries(g)) {
    if (!patch || typeof patch !== 'object') continue
    cfg[section] = Object.assign({}, cfg[section] || {}, patch)
  }
  writeFileSync(VILLAGE_CFG_PATH, JSON.stringify(cfg, null, 2))
  let npcs = readVillagers()
  let shell = readJson(VILLAGERS_PATH, {})
  const isShell = !Array.isArray(shell) && Array.isArray(shell.villagers)
  if (Array.isArray(body.npcs) && body.npcs.length) {
    const byKey = Object.fromEntries(body.npcs.map((n) => [n.key, n]))
    npcs = npcs.map((v) => {
      const patch = byKey[v.key]
      if (!patch) return v
      const next = Object.assign({}, v)
      if (patch.radius === null || patch.radius === undefined || patch.radius === '') delete next.radius
      else next.radius = Number(patch.radius) || v.radius
      return next
    })
  }
  const outFile = isShell ? Object.assign({ _comment: shell._comment, villagers: npcs }) : (npcs.length ? npcs : { villagers: npcs })
  writeFileSync(VILLAGERS_PATH, JSON.stringify(outFile, null, 2))
  return { ok: true, saved: cfg, npcs: npcs.map((v) => ({ key: v.key, radius: v.radius == null ? null : v.radius })) }
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
    // 查询在线玩家/实体坐标（RCON data get entity <name> Pos）
    if (u.pathname === '/api/pos' && req.method === 'GET') {
      const name = (u.searchParams.get('name') || '').trim()
      if (!name) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('no name'); return }
      rconExec('data get entity ' + name + ' Pos').then((out) => {
        const m = String(out || '').match(/\[([-\d.]+)[dD]?,\s*([-\d.]+)[dD]?,\s*([-\d.]+)[dD]?\]/)
        if (!m) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('no pos: ' + String(out).slice(0, 80)); return }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ name, x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }))
      }).catch((e) => {
        res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('rcon err: ' + (e.message || e))
      })
      return
    }
    // 众生档案：生命/饥饿/氧气/等级/主手格/背包 —— RCON data get entity 实查
    // （守卫 numen 体 / 真人玩家 / 女神化身通用；穿越者另有 status 档案，前端合并）
    if (u.pathname === '/api/inspect' && req.method === 'GET') {
      const name = (u.searchParams.get('name') || '').trim()
      if (!name) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('no name'); return }
      const target = /^[A-Za-z0-9_]{1,16}$/.test(name) ? name : `@a[name="${name.replace(/"/g, '')}",limit=1]`
      const scal = (k) => rconExec(`data get entity ${target} ${k}`).catch(() => null)
      Promise.all([
        scal('Health'), scal('foodLevel'), scal('Air'), scal('XpLevel'), scal('SelectedItemSlot'), // 玩家键是 XpLevel（大写X）
        rconExecBig(`data get entity ${target} Inventory`).catch(() => null),
      ]).then(([hp, food, air, xp, sel, inv]) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          name,
          health: parseSnbtScalar(hp), food: parseSnbtScalar(food), air: parseSnbtScalar(air),
          xp: parseSnbtScalar(xp), sel: parseSnbtScalar(sel), items: parseSnbtItems(inv),
        }))
      }).catch((e) => {
        res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('rcon err: ' + (e.message || e))
      })
      return
    }
  // 天眼跟随：/api/eye?name=<玩家>&follow=1 启动（每 2s tp 女神到玩家上方俯视），follow=0 停止并归位
  // 无论 bot viewer 在线与否，viewer 都显示女神（Goddess）视角——点玩家后把女神 tp 过去，天眼即跟随。
  if (u.pathname === '/api/eye' && req.method === 'GET') {
    const name = (u.searchParams.get('name') || '').trim()
    const follow = u.searchParams.get('follow')
    if (follow === '0' || !name) {
      if (eyeFollow && eyeFollow.home) {
        rconExec(`tp Goddess ${eyeFollow.home}`).catch(() => {})
      }
      eyeFollow = null
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, follow: false }))
      return
    }
    const doStart = () => {
      eyeFollow = { name }
      eyeTpOnce(name).catch(() => {})
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, follow: true, name }))
    }
    if (!eyeFollow) {
      // 记录女神当前位置（归位用）；查不到就 home=null（只跟随不归位）
      rconExec('data get entity Goddess Pos').then((out) => {
        const m = String(out || '').match(/\[([-\d.]+)[dD]?,\s*([-\d.]+)[dD]?,\s*([-\d.]+)[dD]?\]/)
        eyeFollow = { name, home: m ? `${m[1]} ${m[2]} ${m[3]}` : null }
        eyeTpOnce(name).catch(() => {})
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, follow: true, name }))
      }).catch(() => doStart())
    } else {
      eyeFollow.name = name
      eyeTpOnce(name).catch(() => {})
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, follow: true, name }))
    }
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
  // 语音（TTS）：云端 edge-tts 优先（实测 ~2s/句，30+ 中文音色），IndexTTS 网关兜底。
  // 磁盘缓存：同文本+同音色+同语气只合成一次（命中 ~0.03s）。
  if (u.pathname === '/api/tts' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 8192) { req.destroy(); } })
    req.on('end', async () => {
      let text = '', voice = '', mood = ''
      try { ({ text, voice, mood } = JSON.parse(body || '{}')) } catch {}
      if (!text) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('no text'); return }
      voice = ttsVoiceToEdge(voice || 'zh-CN-XiaoxiaoNeural')
      mood = (mood || '').toString().toLowerCase()
      // 中文语气名兼容（前端可能传中文「快乐」或英文「happy」）
      const moodCn = ({ happy: '快乐', angry: '生气', sad: '悲伤', fear: '害怕', disgust: '厌恶', melancholy: '忧郁', surprise: '惊讶', tender: '温柔', bold: '豪爽', serious: '严肃', playful: '俏皮', warm: '温暖', cold: '冷淡', calm: '平静' })[mood] || mood
      const rp = TTS_MOOD_RP[moodCn] || ['+0%', '+0Hz']
      const cachePath = join(TTS_CACHE_DIR, ttsCacheKey(text, voice, mood) + '.mp3')
      try {
        if (existsSync(cachePath)) {
          res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' })
          res.end(readFileSync(cachePath))
          return
        }
      } catch {}
      // 主链路：云端 edge-tts
      try {
        const buf = await ttsEdgeSynth(text, voice, rp[0], rp[1])
        try { writeFileSync(cachePath, buf) } catch {}
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' })
        res.end(buf)
        return
      } catch (e) {
        console.log('[tts] edge-tts fail:', e && e.message || e, '| voice:', voice, '| mood:', mood)
        // 兜底：本地 IndexTTS 网关（旧 WAV 链路）
        try {
          const ctl = new AbortController()
          const timer = setTimeout(() => ctl.abort(), TTS_INFER_TIMEOUT + 8000)
          const r = await fetch(`${INDEX_TTS_URL}/tts_raw`, {
            method: 'POST', signal: ctl.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: String(text).slice(0, 160), voice, mood: mood || undefined }),
          })
          clearTimeout(timer)
          if (!r.ok) throw new Error('upstream ' + r.status)
          const buf = Buffer.from(await r.arrayBuffer())
          try { writeFileSync(cachePath, buf) } catch {}
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' })
          res.end(buf)
          return
        } catch (e2) {
          res.writeHead(502, { 'Content-Type': 'text/plain' })
          res.end('tts error: ' + (e2.message || e2) + ' (edge: ' + (e.message || e) + ')')
        }
      }
    })
    return
  }
  if (u.pathname === '/api/tts/voices' && req.method === 'GET') {
    // edge-tts 中文音色表（静态，秒回；不依赖网关）
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ voices: TTS_EDGE_VOICES.map(([id, name]) => id), labels: Object.fromEntries(TTS_EDGE_VOICES) }))
    return
  }
  // 世界控制状态：GET /api/world
  if (u.pathname === '/api/world' && req.method === 'GET') {
    worldStatus().then((s) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(s)) })
      .catch((e) => { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('world err: ' + (e.message || e)) })
    return
  }
  // 世界控制动作：POST /api/world {action, value, duration, name}
  if (u.pathname === '/api/world' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let b = {}
      try { b = JSON.parse(body || '{}') } catch {}
      applyWorld(b.action || '', b).then((out) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, action: b.action, out: String(out).slice(0, 200) }))
      }).catch((e) => {
        res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('world err: ' + (e.message || e))
      })
    })
    return
  }
  // NPC 设置读取：GET /api/npc/settings
  if (u.pathname === '/api/npc/settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(npcSettings()))
    return
  }
  // NPC 设置保存：POST /api/npc/settings {global:{...}, npcs:[...]}
  if (u.pathname === '/api/npc/settings' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let b = {}
      try { b = JSON.parse(body || '{}') } catch {}
      try {
        const r = saveNpcSettings(b)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(r))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('npc err: ' + (e.message || e))
      }
    })
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(PAGE)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[web-panel] 观察面板已启动: http://localhost:${PORT}`)
  console.log(`[web-panel] 局域网访问: http://<本机IP>:${PORT}`)
})
