# -*- coding: utf-8 -*-
"""
mc_oracle.py — 灶火祭司 = 村庄故事主理人（settlements 推理层适配器）
========================================================
settlements (万家烟火) 把村民的「人设/规划/独白」推理请求 POST 到本服务，
本服务 import mc_npc（灶火祭司）复用它的 LLM 通道，按村民人物设定回填：
  - POST /v1/persona   : 人设卡（已有直填，缺的灶火祭司编）
  - POST /v1/plan      : 一日日程（按 routines，缺的灶火祭司排）
  - POST /v1/monologue : 符合人设的台词（灶火祭司生成）
协议：settlements -> 本服务 是 Gson 信封 {protocolVersion, requestId, capability,
  deadlineMillis, payload}，payload 统一是 {villagers:[{villagerId,...}]}；
  本服务 -> settlements 是 NDJSON 流，每行一个 villager 的 result JSON。
  头：Content-Type: application/json + X-Settlements-Inference-Protocol: 1
原则（2026-08-24 造物主定调）：已有角色的人设直接用（不重造），缺的部分由
  灶火祭司（故事主理人）编写补齐。
不侵犯 settlements 源码；不改 mc_npc 主逻辑（只 import 复用通道）。
"""
import io, os, sys, json, re, time, threading, socket, struct
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---- 定位 sidecar（mc_npc.py 与本文件同目录）----
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
# mc_npc 自己会包 stdout/stderr（utf-8）；先 import 它，避免重复包装导致底层 fd 被关
import mc_npc as hearth   # 灶火祭司本体（复用其通道/档案/配置）

VDIR = hearth.VDIR
PROFILES = hearth.PROFILES          # 19 位村民档案
BY_TAG = hearth.BY_TAG              # tag -> 档案
CFG = hearth.CFG
R = hearth.R                        # RCON

PORT = int(os.environ.get("MC_ORACLE_PORT", "9001"))

# Occasion enum（settlements src: dialogue/Occasion.java），monologue 响应的 bucket key
OCCASIONS = ["IDLE","WORK","MEET","REST","PANIC","PRE_RAID","RAID","HIDE",
             "MORNING","EVENING","REST_DAY","ZOMBIE_SIGHTED"]

# ---------------- 无状态生成 ----------------
# 适配器是「任务性生成」，不是延续聊天；每次都用程序化注入完整上下文。
# 因此每次 hearth 调用用一个全新的 session（随机 token），避免 mc-hearth 串历史记忆污染生成。
import uuid as _uuid

def _fresh_session(prefix, key, req_id=None):
    """一次一 session：确保每次生成独立无状态，可借 requestId 追踪。"""
    extra = req_id or ""
    token = "%s_%s_%s" % (extra, _uuid.uuid4().hex[:8], int(time.time()*1000))
    return "oracle:%s:%s:%s" % (prefix, key, token)

def _clip(t, n=120):
    """上下文长度控制：把喂给灶火祭司的可变文本截断到 n 字，防止上下文膨胀。"""
    if not t:
        return ""
    t = str(t).strip()
    return t if len(t) <= n else t[:n] + "…"

# ---------------- 直连 vLLM（2026-08-24） ----------------
# `_hearth_reply` 走 QwenPaw agent 通道（8088）：带推理流程、冷连接、首 token 慢，
# 一次 27~60s，且不稳(偶发 None → 0 条)。对「任务性批量生成台词」太重。
# monologue/persona/plan 是确定性人设生成，不是延续会话 —— 改直连 CFG.llm.endpoint
# (127.0.0.1:8890 /v1/chat/completions, reasoning_effort=none)，快、可控、流式直出。
# 复用 hearth 的 CFG 配置（endpoint/model/reasoning_effort），不改 mc_npc 主逻辑。
import urllib.request

def llm_direct(prompt, system=None, max_tokens=300, temperature=0.7, timeout=40.0):
    """直连本地 vLLM 生成，返回去 think 标签后的纯文本（失败返回 None）。"""
    llm = CFG.get("llm", {})
    if not llm.get("enabled"):
        return None
    msgs = []
    sysp = system
    if sysp:
        msgs.append({"role": "system", "content": sysp})
    user_msg = prompt
    # 兼容 prompt 带 system 前缀的情况（调用方已拼好）
    if not sysp and isinstance(prompt, str) and prompt.startswith("<system>"):
        idx = prompt.find("</system>")
        msgs.append({"role": "system", "content": prompt[8:idx].strip()})
        user_msg = prompt[idx + 9:].strip()
    msgs.append({"role": "user", "content": user_msg})
    body = json.dumps({
        "model": llm.get("model", "qwen3.8-27b"),
        "messages": msgs,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "reasoning_effort": llm.get("reasoning_effort", "none"),
    }).encode("utf-8")
    req = urllib.request.Request(
        llm.get("endpoint", "http://127.0.0.1:8890/v1/chat/completions"),
        data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return ((data.get("choices") or [{}])[0].get("message", {}).get("content") or "").strip().split("</think>")[-1].strip() or None
    except Exception as e:
        print("[oracle] vllm fallback:", e, flush=True)
        return None

def _gen(prompt, system=None, max_tokens=300, dbg=None):
    """统一生成入口：优先直连 vLLM，失败再走 hearth._hearth_reply(agent 通道) 兜底。"""
    ans = llm_direct(prompt, system=system, max_tokens=max_tokens)
    if ans is None:
        ans = hearth._hearth_reply(_fresh_session("oracle", "gen", dbg), "oracle", prompt, dbg=dbg or "gen")
    return ans

# ---------------- 村民匹配 ----------------
# settlements 的 villagerId(UUID) / persona.name 怎么对到 villagers.json 的 key。
# 策略：先按 name/display/calls 匹配；UUID 用惰性映射表（启动时扫描世界村民实体 Pos 对 spawn）。_uuid_map 缓存。
_uuid_map = {}       # uuid -> villager dict
_uuid_loaded = False

def _entity_pos(sel):
    try:
        return R.cmd('data get entity %s Pos' % sel)
    except Exception:
        return ""

def _build_uuid_map():
    """扫描世界所有 settlements:base_villager 实体，用 Pos 对 spawn 坐标匹配 villagers.json。"""
    global _uuid_loaded, _uuid_map
    if _uuid_loaded:
        return
    try:
        out = R.cmd('execute as @e[type=settlements:base_villager] run data get entity @s UUID')
        # execute 批量没有直接 UUID+名字，改用逐个：先列全部，再按 uuid 查
        # 简化：直接每个 spawn 附近的 select 查 uuid
        for v in PROFILES:
            if v.get("carrier") != "base_villager":
                continue
            sp = v.get("spawn")
            if not sp:
                continue
            sel = '@e[type=settlements:base_villager,limit=1,x=%s,y=%s,z=%s,distance=..2]' % (
                sp[0], sp[1], sp[2])
            u = R.cmd('data get entity %s UUID' % sel)
            m = re.search(r'(?i)UUID:\s*\[([^\]]+)\]', u) or re.search(r'(?i)UUID:\s*([0-9a-f-]+)', u)
            if m:
                key = m.group(1).replace(",", "").replace(" ", "")
                _uuid_map[key.lower()] = v
                print("[oracle] uuid map: %s -> %s" % (key, v.get("key")), flush=True)
    except Exception as e:
        print("[oracle] build_uuid_map err:", e, flush=True)
    _uuid_loaded = True

def match_villager(villager_id=None, name=None, prof=None):
    """把 settlements 的 villagerId/name 映射到 villagers.json 档案 dict。"""
    if villager_id:
        _build_uuid_map()
        vid = villager_id.replace("-", "").lower()
        v = _uuid_map.get(vid)
        if v:
            return v
    if name:
        for v in PROFILES:
            # 匹配 display 前缀（如 "铁匠·岳山" -> "岳山"）或 calls 子串
            disp = v.get("display", "")
            if name.lower() in disp.lower():
                return v
            for c in v.get("calls", []):
                if name.lower() in c.lower():
                    return v
    if prof:
        for v in PROFILES:
            if v.get("profession") == prof:
                return v
    # 兜底：返回第一个 base_villager（宁可给一个稳定档案）
    for v in PROFILES:
        if v.get("carrier") == "base_villager":
            return v
    return PROFILES[0] if PROFILES else None

# ---------------- persona（人设卡） ----------------
# 从已有 persona/backstory 提炼 settlements 需要的三字段；缺的交给灶火祭司补。
def _smart_adj(persona):
    """从 persona 提炼 3-4 个形容词。规则：取 persona 里的关键描述词。"""
    # 简单启发：把 persona 里的形容词短语捞出来（无标点分词兜底）
    # 兜底：给一组稳定的性格词
    fallback = {"铁匠":["敢作敢当","手艺硬"]}
    return []

def _persona_from_villager(v):
    """直接从 villagers.json 回填 settlements 的 persona 三字段。"""
    persona = v.get("persona", "")
    backstory = " ".join(v.get("backstory", []))[:120]
    sketch = persona
    # speechStyle：从 persona 的性格描述里提炼一句说话风格
    speech = persona.split("，")[0] if persona else ""
    # adjectives：从 persona 里挑 2-3 个描述词（简单启发式）
    adjs = []
    kw = ["豪爽","沉默","儒雅","神秘","慈祥","优雅","惜字如金","温柔","直来直去"]
    for k in kw:
        if k in persona and len(adjs) < 3:
            adjs.append(k)
    if not adjs:
        # 从 persona 第一个逗号前取核心性格
        head = persona.split("，")[0].strip() if persona else ""
        adjs = [head] if head else ["朴实"]
    return {
        "adjectives": adjs,
        "characterSketch": sketch,
        "speechStyle": speech,
    }

def hearth_persona(v, req_id=None):
    """缺人设/需润色时，让灶火祭司生成（走 mc-hearth agent 通道）。"""
    key = v.get("key", "villager")
    disp = v.get("display", key)
    prof = v.get("profession", "")
    persona = _clip(v.get("persona", ""), 200)
    backstory = _clip(" ".join(v.get("backstory", [])), 160)
    sit = _clip(hearth.read_situation(v), 120)
    prompt = ("你是%s的村民档案官。请为这位村民写一份「人设卡片」，输出严格 JSON，字段："
              "adjectives(3-4个性格关键词数组), characterSketch(一句话人物素描), speechStyle(一句话说话风格)。"
              "\n村民：%s / 职业：%s\n已有性格：%s\n背景：%s\n此刻处境：%s\n"
              "只输出 JSON，不要多余文字。") % (disp, disp, prof, persona, backstory, sit)
    answer = hearth._hearth_reply(_fresh_session("persona", key, req_id), "oracle", prompt, dbg="persona")
    if not answer:
        return None
    m = re.search(r'\{.*\}', answer, re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
        return {
            "adjectives": d.get("adjectives") or _persona_from_villager(v)["adjectives"],
            "characterSketch": d.get("characterSketch") or v.get("persona", ""),
            "speechStyle": d.get("speechStyle") or _persona_from_villager(v)["speechStyle"],
        }
    except Exception as e:
        print("[oracle] hearth_persona parse err:", e, flush=True)
        return None

def resolve_persona(v, req_id=None):
    """已有 persona 直填；缺的/空的由灶火祭司补齐。"""
    base = _persona_from_villager(v)
    # 若村民没有任何 persona，或明显不像一句话，走灶火祭司
    if not v.get("persona"):
        hp = hearth_persona(v, req_id)
        return hp or base
    return base

# ---------------- plan（一日日程） ----------------
def _routines_to_selections(v, day_type, options_by_wid):
    """从 villagers.json 的 routines 排 day_plan 的 selections（每 window 一个 {id(at)}）。
    options_by_wid: {windowId: [EventOptionDTO...]}, 我们只能从 id 里挑已有的。"""
    # routines: [{phase:"dawn|day|dusk|night", act:"work|hawk|light|rest|idle", line:"..."}]
    # 把 phase 对到 settlements 的时间块（简化：dawn->MORNING, day->WORK, dusk->EVENING, night->REST）
    phase_to_time = {"dawn":"MORNING","day":"AFTERNOON","dusk":"EVENING","night":"NIGHT"}
    # 需要知道 settlements 各 windowId 里有哪些行为选项 id。这里从请求的 options 里挑
    # 一个最贴近 act 的 idle/work 类 id。
    sel = {}
    act_seed = {"work":"work","hawk":"marketeer","light":"torch","rest":"rest","idle":"idle"}
    for r in v.get("routines", []):
        phase = r.get("phase", "")
        act = r.get("act", "idle")
        wid_key = phase_to_time.get(phase)
        # 在 options 里找 window 的 id 列表
        for wid, opts in options_by_wid.items():
            # 匹配 act 关键字到某个 behavior id
            chosen = None
            for o in opts:
                oid = o.get("id", "")
                if any(k in oid for k in [act, act_seed.get(act, ""), "idle", "rest"]):
                    chosen = oid
                    break
            if chosen:
                sel[wid] = [{"id": chosen}]
                break  # 每个 routine 只给一个 window
    return sel

def hearth_plan(v, options_by_wid, day_type, snapshot, req_id=None):
    """缺 routines 时，让灶火祭司按性格+职业排一天日程。"""
    key = v.get("key", "villager")
    disp = v.get("display", key)
    persona = _clip(v.get("persona", ""), 120)
    sit = _clip(hearth.read_situation(v), 120)
    # 列出每个 window 可选的 id，供灶火祭司挑选
    opt_desc = "; ".join("%s=[%s]" % (wid, ",".join(o.get("id","") for o in opts))
                         for wid, opts in options_by_wid.items())
    prompt = ("你是%s的日程官。为这位村民安排今天的一个行为日程。"
              "可选的窗口与行为(只能从中挑 window 对应的行为 id)：%s。"
              "今天是%s。\n村民：%s / 性格：%s / 此刻：%s\n"
              "输出严格 JSON：{\"selections\":{\"<windowId>\":[{\"id\":\"<选中的行为id>\"}]}}，"
              "每个 window 给 0-1 个行为。只输出 JSON。") % (
            disp, opt_desc, day_type, disp, persona, sit)
    answer = hearth._hearth_reply(_fresh_session("plan", key, req_id), "oracle", prompt, dbg="plan")
    if not answer:
        return {}
    m = re.search(r'\{.*\}', answer, re.S)
    if not m:
        return {}
    try:
        d = json.loads(m.group(0))
        return d.get("selections", {}) or {}
    except Exception as e:
        print("[oracle] hearth_plan parse err:", e, flush=True)
        return {}

def resolve_plan(v, options_by_wid, day_type, snapshot, req_id=None):
    """有 routines 的按作息排；没有的走灶火祭司排。"""
    if v.get("routines"):
        s = _routines_to_selections(v, day_type, options_by_wid)
        if s:
            return s
    return hearth_plan(v, options_by_wid, day_type, snapshot, req_id)

# ---------------- monologue（独白） ----------------
def hearth_monologue(v, occasion, snapshot, line_count, req_id=None):
    """让灶火祭司生成符合人设的台词。
    2026-08-24 裁剪：去掉 read_situation(实时读状态, 4次RCON+agent冷连接, 拖慢50s/次)。
    台词是「人设出戏」，不是「实时处境播报」——靠 persona+backstory+occasion 就够。
    若确需处境感，调用方可在发生事件时把关键词并入 occasion 或 snapshot。"""
    key = v.get("key", "villager")
    disp = v.get("display", key)
    persona = _clip(v.get("persona", ""), 160)
    backstory = _clip(" ".join(v.get("backstory", [])), 120)
    # snapshot 里可能有 site 坐标，简要给灶火祭司（含事件关键词时一并带入）
    site_desc = ""
    if snapshot and snapshot.get("sites"):
        site_desc = " 周围有：" + "、".join(list(snapshot["sites"].keys())[:5])
    if line_count is None:
        line_count = 1
    prompt = ("你就是%s本人，千灯纪集市的村民。人设：%s 背景 %s%s。"
              "现在是「%s」时刻，请说一段符合你人设的中文台词，共 %d 句，"
              "用大白话、口语，像街坊聊天，简短直接，别拽文、别出戏。"
              "直接输出台词，不要引号、不要标记。") % (
            disp, persona, backstory, site_desc,
            occasion, int(line_count))
    answer = _gen(prompt, max_tokens=90, dbg="monologue")
    if not answer:
        return None
    # 拆成多句（按换行/句号）
    lines = [x.strip().strip('"\'') for x in re.split(r'[\n。！？!?]+', answer) if x.strip()]
    return lines[:max(1, int(line_count))] or [answer.strip()]

def resolve_monologue(v, occasion, snapshot, line_count, req_id=None):
    return hearth_monologue(v, occasion, snapshot, line_count, req_id)

# ---------------- HTTP handler ----------------
class OracleHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[oracle] %s" % (fmt % args), flush=True)

    def _send_ndjson(self, results, status=200):
        """results = list of villager result dict，逐行 JSON 输出。"""
        self.send_response(status)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("X-Settlements-Inference-Protocol", "1")
        self.end_headers()
        for r in results:
            self.wfile.write((json.dumps(r, ensure_ascii=False) + "\n").encode("utf-8"))

    def _read_body(self):
        ln = int(self.headers.get("Content-Length", "0") or 0)
        if ln <= 0:
            return {}
        raw = self.rfile.read(ln).decode("utf-8", "replace")
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def _wrap_villagers(self, payload):
        """payload 可能是 {villagers:[...]}。返回 villagers list 或 []。"""
        if isinstance(payload, dict):
            return payload.get("villagers") or []
        if isinstance(payload, list):
            return payload
        return []

    def do_POST(self):
        # 读信封
        env = self._read_body()
        payload = env.get("payload") or {}
        cap = env.get("capability", "")
        msg_id = env.get("requestId", "")
        villagers = self._wrap_villagers(payload)
        if not villagers:
            self._send_ndjson([])
            return

        results = []
        for vr in villagers:
            vid = vr.get("villagerId")
            persona_bundle = vr.get("persona") or {}
            vname = persona_bundle.get("name")
            prof = persona_bundle.get("profession")
            v = match_villager(vid, vname, prof)
            if not v:
                # 无法匹配，给一个兜底空结果（不可用但保序）
                results.append({"villagerId": vid})
                continue

            if "/v1/persona" in self.path.lower() or cap == "PERSONA":
                p = resolve_persona(v, msg_id)
                results.append({"villagerId": vid,
                                "adjectives": p.get("adjectives", []),
                                "characterSketch": p.get("characterSketch", ""),
                                "speechStyle": p.get("speechStyle", "")})
            elif "/v1/plan" in self.path.lower() or cap == "PLAN":
                snapshot = vr.get("snapshot") or {}
                day_type = vr.get("dayType", "WORK_DAY")
                options_by_wid = {}
                for w in vr.get("windows", []):
                    wid = w.get("windowId") or w.get("id")
                    if wid:
                        rows = w.get("options") or []
                        options_by_wid[wid] = rows
                sel = resolve_plan(v, options_by_wid, day_type, snapshot, msg_id)
                results.append({"villagerId": vid, "selections": sel})
            elif "/v1/monologue" in self.path.lower() or cap == "MONOLOGUE":
                snapshot = vr.get("snapshot") or {}
                line_count = vr.get("lineCount") or 1
                # buckets: [{occasion, lineCount}]
                buckets_out = {}
                for b in vr.get("buckets", []):
                    occ = b.get("occasion", "IDLE")
                    lc = b.get("lineCount", 1)
                    lines = resolve_monologue(v, occ, snapshot, lc, msg_id)
                    if lines:
                        buckets_out[occ] = lines
                results.append({"villagerId": vid, "buckets": buckets_out})
            else:
                results.append({"villagerId": vid})
        self._send_ndjson(results)

def main():
    # 预热：确保 RCON 可用 + 构建 uuid 映射
    try:
        hearth.R.connect()
        print("[oracle] rcon auth ok", flush=True)
    except Exception as e:
        print("[oracle] rcon err (persona uuid 映射可能失败):", e, flush=True)
    try:
        _build_uuid_map()
    except Exception as e:
        print("[oracle] pre-build uuid map err:", e, flush=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), OracleHandler)
    print("[oracle] settlements oracle listening on 127.0.0.1:%d" % PORT, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
