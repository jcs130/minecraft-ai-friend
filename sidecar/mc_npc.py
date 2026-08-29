# -*- coding: utf-8 -*-
"""
mc_npc.py v2 — 初始之地村民引擎（数据驱动 + 每日委托经济 + LLM 预留接口）
架构（参考 Stanford Generative Agents / AI-Villgers / Wanderfolk 的轻量本地化）：
  - 村民档案外置 data/village/villagers.json（人格/背景/话题/委托模板/回家锚点）
  - 每日委托：模板池按日随机生成 quests-YYYY-MM-DD.json，聊天交付（/clear 收货 + /give 绿宝石）
- 三通道交易架构（2026-08-18 服务器/客户端解耦）：
  ① 原版交易 GUI＝通用接口：summon 即带 Offers.Recipes（当日委托 maxUses=1），任何真人/
     外来客户端右键村民即可交易，零协议知识；轮询 uses 侦测成交→核销委托+补发奖励
  ② whisper 委托交付（/msg Goddess 交易：…）＝Agent 快捷通道（bot 开 GUI 不便）
  ③ @玩家 数量物品 ＝女神公证交割（Agent↔Agent 或玩家↔玩家，村民作公证点，双方 ≤5 格当面）
  - LLM 接口预留：config.llm.enabled=true 时兜底闲聊走本地 OpenAI 兼容端点，模板优先
  - 村民看护：tag 选择器存活检查 + 自愈重招（1.21.5+ 组件语法）+ 活村民拴绳看护
1.21.11 铁律：
  - CustomName 必须用 SNBT 复合体 {text:...,color:...}，旧 JSON 字符串会存成字面文本
  - RCON 对 `execute if ... run say` 的响应恒为空，存活检查必须用 `data get ... Pos`
"""
import socket, struct, os, re, json, time, io, sys, random, urllib.request, threading

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
_STD_KEEP = (sys.stdout, sys.stderr)  # 防 GC：失引用的旧 wrapper 会被回收并 close 掉共享底层 fd
# ---------- 靠近搭话（2026-08-22 造物主谕：NPC 要像 RPG 一样跟玩家说话） ----------
# 玩家走进 NPC 身边（≤3.5 格）→ NPC 蹦出今日想法/话题/问候（点对点 tellraw，不刷全村屏）。
# 每 NPC × 每玩家冷却 240s；内容池：topics 模板 > greet > fallback（零 LLM，与灶火祭司闲聊正交）。
PROX_RADIUS = 3.5
PROX_COOLDOWN = 300  # 2026-08-29 算力再分配：240→300，近距模板闲聊也降频
EXCLUDE_PROX = {"Goddess", "Kirito", "Naruto", "Edward", "桐人", "鸣人", "爱德华", "Steve", "Alex", "史蒂夫", "艾利克斯", "RenderBot", "ProbeBot"}
# VIP 重点看护名单（与 mc-god.ts 的 MC_VIP_LISTEN 对齐）：VIP 真人旅人的公屏发言
# 由女神独占处理，NPC 不接话（2026-08-23 造物主谕「让女神化身重点服务」，勿让牧羊女抢答）。
VIP_LIST = {n.strip().lower() for n in os.environ.get("MC_VIP_LISTEN", "").split(",") if n.strip()}

def _prox_lines(v):
    pool = []
    for t in (v.get("topics") or []):
        pool.extend(t.get("lines", []))
    if pool:
        return random.choice(pool)
    return v.get("greet") or "（朝你点点头）今天也辛苦啦。"

def proximity_chat_loop():
    last = {}  # (vkey, player) -> ts
    while True:
        try:
            out = R.cmd("list")
            m = re.search(r"online \(.*?\):\s*(.*)$", out or "", re.S)
            names = [n.strip() for n in m.group(1).split(",") if n.strip()] if m else []
            names = [n for n in names if n not in EXCLUDE_PROX]
            if names:
                for p in names:
                    pp = player_pos(p)
                    if not pp:
                        continue
                    for v in PROFILES:
                        key = (v["key"], p)
                        now = time.time()
                        if now - last.get(key, 0) < PROX_COOLDOWN:
                            continue
                        vp = alive_pos(v)
                        if not vp:
                            continue
                        dx, dy, dz = pp[0] - vp[0], pp[1] - vp[1], pp[2] - vp[2]
                        if dx * dx + dy * dy + dz * dz <= PROX_RADIUS * PROX_RADIUS:
                            last[key] = now
                            line = _prox_lines(v)
                            try:
                                speak(v, line, to=p)
                                feed_append({"kind": "say", "npc": v["display"], "npcKey": v["key"],
                                             "npcPos": list(vp), "color": v.get("color", "white"),
                                             "to": p, "text": line[:300], "via": "proximity"})
                            except Exception as e:
                                print("[prox] speak err:", e, flush=True)
                                R.s = None
        except Exception as e:
            print("[prox] err:", e, flush=True)
            R.s = None
        time.sleep(8)

if __name__ == "__main__":
    sys.modules["mc_npc"] = sys.modules["__main__"]  # mc_guild 会 `import mc_npc`——注册别名复用本实例，防止整个文件被二次执行（二次执行的 line20 重包 stdout 会 GC-close 掉 fd1，guild 首个 print 必炸）

# 路径/RCON 全部支持环境变量覆盖（部署脚本用）；默认值保持本机布局。
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # B 仓根
DATA = os.environ.get("NPC_DATA_DIR") or os.path.join(_REPO, "mc-data")  # 2026-08-26 清 A 仓残留：自持 mc-data
VDIR = os.path.join(DATA, "village")

# ---------- 右键对话（2026-08-22 造物主谕：按使用键跟 NPC 说话） ----------
# settlementsfix mod 监听玩家右键村民，把事件写进 village/interact-events.jsonl；
# 本线程 tail 该文件，读到事件就让 NPC 对 TA 说话（今日想法/话题，与靠近搭话同款内容池）。
# 每 NPC × 每玩家冷却 30s（右键是主动操作，比靠近搭话短）。文件不存在时静默等待（mod 未装/未重启）。
INTERACT_FILE = os.path.join(VDIR, "interact-events.jsonl")
INTERACT_COOLDOWN = 30
_interact_pos = 0

def interact_tail_loop():
    global _interact_pos
    last = {}  # (vkey, player) -> ts
    while True:
        try:
            if not os.path.exists(INTERACT_FILE):
                time.sleep(3)
                continue
            with open(INTERACT_FILE, encoding="utf-8") as f:
                f.seek(_interact_pos)
                for ln in f:
                    ln = ln.strip()
                    if not ln:
                        continue
                    try:
                        ev = json.loads(ln)
                    except Exception:
                        continue
                    player = ev.get("player", "")
                    npc_disp = ev.get("npc", "")
                    v = next((x for x in PROFILES if x["display"] == npc_disp), None)
                    if not v or not player:
                        continue
                    now = time.time()
                    key = (v["key"], player)
                    if now - last.get(key, 0) < INTERACT_COOLDOWN:
                        continue
                    last[key] = now
                    line = _prox_lines(v)
                    try:
                        villager_hmm(v, "ambient")
                        speak(v, line, to=player)
                        feed_append({"kind": "say", "npc": v["display"], "npcKey": v["key"],
                                     "color": v.get("color", "white"),
                                     "to": player, "text": line[:300], "via": "interact"})
                    except Exception as e:
                        print("[interact] speak err:", e, flush=True)
                        R.s = None
                _interact_pos = f.tell()
        except Exception as e:
            print("[interact] err:", e, flush=True)
        time.sleep(3)
LOG = os.environ.get("NPC_LOG_PATH") or os.path.join(DATA, "..", "mc-server-neoforge", "logs", "latest.log")
HOST = os.environ.get("MC_RCON_HOST", "127.0.0.1")
PORT = int(os.environ.get("MC_RCON_PORT", "25575"))
COOLDOWN = 3.0
# 祈福通道（2026-08-20 造物主谕「一步到位」）
PRAY_PERIOD = 240        # 祈愿扫描间隔（秒）
PRAY_COOLDOWN = 1500     # 每村民祈愿冷却（秒），防刷屏（2026-08-29 算力再分配：900→1500）
PRAY_CHANCE = 0.25       # 夜里单次扫描触发祈愿的概率（2026-08-29 算力再分配：0.4→0.25）
GOD_REPLY_PERIOD = 8     # 神谕回传消费间隔（秒）
# 2026-08-29 造物主谕「算力再分配」：村民 LLM 对话冷却表（(speaker, villager_key) -> ts），
# 冷却窗口内同旅人搭同村民走模板，省下 27B 吞吐让给灯语女神/灶火祭司/鸣人/桐人。
_llm_chat_last = {}

os.makedirs(VDIR, exist_ok=True)
PROFILES = json.load(open(os.path.join(VDIR, "villagers.json"), encoding="utf-8"))["villagers"]
CFG = json.load(open(os.path.join(VDIR, "config.json"), encoding="utf-8"))
BY_TAG = {v["tag"]: v for v in PROFILES}

# 皮肤注册表（npc_skins_gen.py 产出）：有档案的 key 用「盔甲架+自定义头颅」人偶化
try:
    SKIN_REG = json.load(open(os.path.join(VDIR, "skin-registry.json"), encoding="utf-8"))
except OSError:
    SKIN_REG = {}

def mode_of(v):
    # 2026-08-29 造物主令「怎么还有村民是盔甲架」：盔甲架人偶制度退役，全员活化实体。
    # 载体选择交给 etype_of：carrier=base_villager 用 mod 实体（激活行为系统），否则原版 villager。
    # 皮肤档案（SKIN_REG）仅保留作历史资产，不再驱动人偶。
    return "villager"


def etype_of(v):
    """载体实体类型：人偶→armor_stand；实体→villager 或 base_villager（carrier 标记）。
    万家烟火融合（2026-08-20）：carrier=base_villager 的实体型村民用 mod 实体，激活行为系统。"""
    if mode_of(v) == "stand":
        return "armor_stand"
    return "settlements:base_villager" if v.get("carrier") == "base_villager" else "villager"

# ---------- RCON ----------
def pkt(pid, ptype, body):
    d = struct.pack("<ii", pid, ptype) + body.encode("utf-8") + b"\x00\x00"
    return struct.pack("<i", len(d)) + d

def rp(s):
    raw = b""
    while len(raw) < 4:
        c = s.recv(4 - len(raw))
        if not c:
            raise ConnectionError("rcon closed")
        raw += c
    (ln,) = struct.unpack("<i", raw)
    d = b""
    while len(d) < ln:
        c = s.recv(ln - len(d))
        if not c:
            raise ConnectionError("rcon closed")
        d += c
    return d[8:-2].decode("utf-8", "replace")

class Rcon:
    def __init__(self):
        self.s = None
    def connect(self):
        pw = open(os.path.join(DATA, "rcon-secret.txt"), encoding="utf-8-sig").read().strip()
        self.s = socket.create_connection((HOST, PORT), timeout=8)
        self.s.sendall(pkt(1, 3, pw))
        # 2026-08-26 修复：认证回执必须校验。此前认证失败被静默吞掉——RCON 变成
        # "零异常全空响应"的假活（召唤永远到不了服务器，村民从未真正存在）。
        resp = self._recv_pkt()
        rid = struct.unpack("<i", resp[0:4])[0]
        if rid == -1:
            try:
                self.s.close()
            except Exception:
                pass
            self.s = None
            raise ConnectionError("rcon auth failed: mcdata/rcon-secret.txt 与服务器密码不一致")
    def _recv_pkt(self):
        raw = b""
        while len(raw) < 4:
            c = self.s.recv(4 - len(raw))
            if not c:
                raise ConnectionError("rcon closed")
            raw += c
        (ln,) = struct.unpack("<i", raw)
        d = b""
        while len(d) < ln:
            c = self.s.recv(ln - len(d))
            if not c:
                raise ConnectionError("rcon closed")
            d += c
        return d
    def cmd(self, c):
        for attempt in (1, 2):
            try:
                if self.s is None:
                    self.connect()
                self.s.sendall(pkt(2 + attempt, 2, c))
                return rp(self.s)
            except (ConnectionError, OSError, socket.timeout):
                try:
                    self.s.close()
                except Exception:
                    pass
                self.s = None
                if attempt == 2:
                    raise
                time.sleep(1)

R = Rcon()

# RCON 连接非线程安全：inbox 线程与主 tail 线程并发须串行化（WHISPER-TRADE 2026-08-18）
_RLOCK = threading.Lock()
_raw_cmd = R.cmd
def _locked_cmd(c):
    with _RLOCK:
        return _raw_cmd(c)
R.cmd = _locked_cmd

def tellraw(parts, color="white", to=None):
    seg = ",".join('{"text":"%s","color":"%s"}' % (esc(t), c) for t, c in parts)
    # WHISPER-TRADE：to 给定=点对点耳语回执（不刷公屏）；玩家名 [A-Za-z0-9_] 天然安全
    R.cmd("tellraw %s [%s]" % (to if to else "@a", seg))

def esc(t):
    out = []
    for ch in t:
        o = ord(ch)
        out.append(ch if 32 <= o < 127 and ch not in '"\\' else "\\u%04x" % o)
    return "".join(out)

def speak(v, text, to=None):
    tellraw([("<" + v["display"] + "> ", v["color"]), (text, "white")], to=to)
    # 世界系统优化：若这话是对守卫（桐人/鸣人）说的，同步写进守卫信箱 → 守卫能"听见"NPC回应
    guard_inbox_write(to, v["display"], text)

# ---------- 村民"嗯嗯"声（2026-08-23 造物主谕：互动时发、空闲也主动发，增强代入感） ----------
VILLAGER_SOUNDS = {
    "ambient": "minecraft:entity.villager.ambient",   # 嗯嗯（空闲/应声）
    "trade": "minecraft:entity.villager.trade",       # 交易成交
    "yes": "minecraft:entity.villager.yes",           # 同意
    "no": "minecraft:entity.villager.no",             # 拒绝
}
HMM_LAST = {}  # villager_key -> ts（ambient 声节流：每村民 8s 至多一次，防连环对话轰炸）

def villager_hmm(v, sound="ambient", pitch=1.0, vol=0.6, throttle=True):
    """在村民位置给附近 20 格内玩家播 villager 音效（playsound，source=neutral，
    与原版村民音效同类别）。ambient 声带节流；trade/yes/no 不节流（关键反馈）。"""
    if not v.get("alive", True):
        return
    if sound == "ambient" and throttle:
        now = time.time()
        if now - HMM_LAST.get(v["key"], 0) < 8:
            return
        HMM_LAST[v["key"]] = now
    snd = VILLAGER_SOUNDS.get(sound, VILLAGER_SOUNDS["ambient"])
    try:
        R.cmd('execute at %s run playsound %s neutral @a[distance=..20] ~ ~ ~ %.2f %.2f'
              % (sel(v), snd, vol, pitch))
    except Exception:
        R.s = None

def goddess(text):
    tellraw([("[女神] ", "gold"), (text, "gold")])

# ---------- 守卫听觉（2026-08-24 世界系统优化）：NPC/系统对守卫说话时，写进守卫的 guard-inbox，
# 让守卫 get_recent_messages 能"听见"（桐人/鸣人是假玩家侍卫，接任务/感知世界靠这口）----------
GUARD_LOGINS = {"Kirito", "Naruto", "桐人", "鸣人"}   # 守卫登录名+显示名（name/ID 分离铁律：两套都认）
GUARD_INBOX = os.path.join(os.environ.get("MC_DATA_DIR", DATA), "guard-inbox.jsonl")

def guard_inbox_write(who, speaker_display, text):
    """把 NPC/系统对某守卫(to=who)说的话写进守卫的信箱，守卫 get_recent_messages 据此听见。"""
    if not who or who not in GUARD_LOGINS:
        return
    try:
        os.makedirs(os.path.dirname(GUARD_INBOX), exist_ok=True)
        with open(GUARD_INBOX, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                "kind": "system",
                "to": who,
                "text": f"{speaker_display}: {text}",
            }, ensure_ascii=False) + "\n")
    except Exception as e:
        print("[guard-inbox] err:", e, flush=True)

# ---------- 面板实况 feed（npc-feed.jsonl：对话+行为，供观察面板展示与智能运镜触发）----------
FEED_PATH = os.path.join(DATA, "npc-feed.jsonl")

def feed_append(rec):
    rec["ts"] = time.strftime("%Y-%m-%d %H:%M:%S")
    rec["t"] = round(time.time(), 3)
    try:
        if os.path.exists(FEED_PATH) and os.path.getsize(FEED_PATH) > 1_000_000:
            with open(FEED_PATH, encoding="utf-8") as f:
                lines = f.readlines()[-400:]
            with open(FEED_PATH, "w", encoding="utf-8") as f:
                f.writelines(lines)
        with open(FEED_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:
        print("[feed] err:", e, flush=True)

# ---------- 世界上下文 ----------
def chronicle_tail(n=60):
    try:
        lines = open(os.path.join(DATA, "world-chronicle.md"), encoding="utf-8").read().splitlines()
    except OSError:
        return []
    keep = []
    NOISE = ("passive_effect", "migration", "advancement|ProbeDig", "行迹｜ProbeDig")
    for ln in reversed(lines):
        if not ln.startswith("- ["):
            continue
        if any(x in ln for x in NOISE):
            continue
        keep.append(ln.strip()[3:])
        if len(keep) >= n:
            break
    return list(reversed(keep))

def fmt_events(evs, count=3):
    PRI = ("开辟", "降临", "觉醒", "天平", "天赋", "仪式", "渡人", "入场")
    big = [e for e in evs if any(p in e for p in PRI)]
    deaths = [e for e in evs if "陨落" in e]
    out = list(big[-count:])
    if deaths:
        out.append(deaths[-1])
    return out[-(count + 1):]

def world_ctx():
    ctx = {"deaths": "45", "mana": "?", "maxmana": "?", "learned_count": "0", "learned_list": "（尚无）", "online": "?"}
    try:
        r = R.cmd("scoreboard players get Kirito mcdeaths")
        m = re.search(r"Kirito has (\d+)", r)
        if m:
            ctx["deaths"] = m.group(1)
    except Exception:
        pass
    try:
        ms = json.load(open(os.path.join(DATA, "magic-state.json"), encoding="utf-8"))
        k = ms.get("players", {}).get("Kirito", {})
        if k.get("mana") is not None:
            ctx["mana"], ctx["maxmana"] = str(k["mana"]), str(k.get("maxMana", "?"))
        learned = k.get("learned", [])
        if learned:
            ctx["learned_count"] = str(len(learned))
            ctx["learned_list"] = "、".join(learned)
    except Exception:
        pass
    try:
        r = R.cmd("list")
        m = re.search(r"players online: (.*)", r)
        if m:
            ctx["online"] = m.group(1)
    except Exception:
        pass
    return ctx

def resolve_lines(lines, ctx):
    out = []
    for ln in lines:
        if ln == "{events}":
            out += ["· " + e for e in fmt_events(chronicle_tail())] or ["· （书页还空着）"]
            continue
        if ln == "{last_death}":
            evs = [e for e in chronicle_tail() if "陨落" in e]
            out.append("最近一次：" + evs[-1] if evs else "记住：夜晚的怪物不讲情面。")
            continue
        for k, val in ctx.items():
            ln = ln.replace("{" + k + "}", val)
        out.append(ln)
    return out

# ---------- 每日委托 ----------
ITEM_ALIASES = {
    "coal": ["煤", "煤炭"], "iron_ingot": ["铁锭", "铁"], "wheat": ["小麦"], "potato": ["土豆", "马铃薯"],
    "paper": ["纸", "纸张"], "book": ["书", "书本"], "bread": ["面包"], "rotten_flesh": ["腐肉"],
    "diamond": ["钻石"], "emerald": ["绿宝石"], "apple": ["苹果"], "beef": ["牛肉"],
    "cobblestone": ["圆石"], "string": ["线"], "egg": ["鸡蛋"],
    # v2.1 @公证交割扩充表（Agent↔Agent 常用物）
    "oak_log": ["木头", "原木", "橡木"], "stick": ["木棍", "棍"], "torch": ["火把"],
    "cooked_beef": ["牛排", "熟牛肉"], "porkchop": ["猪排", "生猪肉"], "cooked_porkchop": ["熟猪排"],
    "chicken": ["生鸡肉", "鸡肉"], "cooked_chicken": ["熟鸡肉"], "carrot": ["胡萝卜"],
    "cod": ["鳕鱼"], "salmon": ["鲑鱼", "三文鱼"], "leather": ["皮革", "皮"], "feather": ["羽毛"],
    "gunpowder": ["火药"], "arrow": ["箭"], "bone": ["骨头"], "sugar": ["糖"], "sugarcane": ["甘蔗"],
    "white_wool": ["羊毛"], "glass": ["玻璃"], "sand": ["沙子"], "gravel": ["沙砾"], "dirt": ["泥土"],
    "obsidian": ["黑曜石"], "gold_ingot": ["金锭", "金子"], "redstone": ["红石", "红石粉"],
    "cooked_cod": ["熟鳕鱼"], "baked_potato": ["烤土豆"], "golden_apple": ["金苹果"],
}

def zh2id(name):
    """中文名/别名 → 物品 id；英文 id 原样放行（交由 clear/give 校验）"""
    for iid, als in ITEM_ALIASES.items():
        if name == iid or name in als:
            return iid
    if re.match(r"^[a-z0-9_]+$", name) and len(name) <= 32:
        return name
    return None

def quests_path(day):
    return os.path.join(VDIR, "quests-%s.json" % day)

def load_atoms():
    try:
        return json.load(open(os.path.join(DATA, "magic-atoms.json"), encoding="utf-8"))["atoms"]
    except Exception:
        return []

def gen_quests(day):
    qcfg = CFG.get("quests", {})
    chance = qcfg.get("per_villager_chance", 0.55)
    cap = qcfg.get("daily_cap", 4)
    pool = [v for v in PROFILES if v.get("quests")]
    random.shuffle(pool)
    quests = []
    for v in pool:
        if len(quests) >= cap:
            break
        if random.random() > chance:
            continue
        q = None
        try:
            q = llm_quest(v, day)
            if q:
                print("[quest] llm quest ok: %s -> %dx%s for %d emerald" % (
                    v["display"], q["count"], q["zh"], q["emerald"]), flush=True)
        except Exception as e:
            print("[quest] llm quest err:", e, flush=True)
        if not q:
            t = random.choice(v["quests"])
            q = {
                "id": "%s-%s" % (v["key"], day), "villager": v["key"], "display": v["display"],
                "item": t["item"], "zh": t["zh"], "count": t["count"],
                "emerald": t.get("emerald", 0), "effect": t.get("effect"), "lore_atom": t.get("lore_atom", False),
                "done": False, "done_by": None, "done_at": None,
            }
        quests.append(q)
    doc = {"date": day, "quests": quests}
    json.dump(doc, open(quests_path(day), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("[quest] generated %d quests for %s: %s" % (len(quests), day, [q["display"] for q in quests]), flush=True)
    return doc

QUESTS = {"date": None, "doc": None}

def quests_today():
    """每日委托=磁盘文件为准：同日每次调用都重读（多进程共享：daemon/watch/手动核销
    并存，内存缓存会把别处刚写的 done 标志用旧快照整份踩回去——08-18 墨白翻案教训）。"""
    day = time.strftime("%Y-%m-%d")
    p = quests_path(day)
    if os.path.exists(p):
        try:
            doc = json.load(open(p, encoding="utf-8"))
        except Exception:
            doc = QUESTS["doc"] if QUESTS["date"] == day else None
            if not doc:
                doc = gen_quests(day)
        QUESTS["date"], QUESTS["doc"] = day, doc
        return doc
    doc = gen_quests(day)
    QUESTS["date"], QUESTS["doc"] = day, doc
    return doc

def quest_of(vkey):
    for q in quests_today()["quests"]:
        if q["villager"] == vkey and not q["done"]:
            return q
    return None

def pitch_quest(v):
    q = quest_of(v["key"])
    if not q:
        return [v.get("quest_busy", "今日没有活计了。")]
    ln = q.get("pitch") or v.get("quest_pitch", "帮我凑 {count} 个{zh}，酬 {emerald} 绿宝石。").replace(
        "{count}", str(q["count"])).replace("{zh}", q["zh"]).replace("{emerald}", str(q["emerald"]))
    return [ln]

def quest_summary(v):
    q = quest_of(v["key"])
    if not q:
        return "今日无委托"
    return "今日委托：收 %d 个%s，酬 %d 绿宝石" % (q["count"], q["zh"], q["emerald"])

def ledger_append(entry):
    with open(os.path.join(VDIR, "quest-ledger.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

def chronicle_append(text):
    with open(os.path.join(DATA, "world-chronicle.md"), "a", encoding="utf-8") as f:
        f.write("- [%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M"), text))

def turn_in(speaker, v, count, item_zh):
    # 距离门：当面交易——玩家与 NPC 实距 > trade_proximity 格（默认 5）一律拒收，
    # 防远程喊话白嫖（玩家不上前就能 /clear+/give 属经济漏洞）。村民档案可配 "far" 台词。
    try:
        limit = float(CFG.get("trade_proximity", 5))
    except (TypeError, ValueError):
        limit = 5.0
    ppos = player_pos(speaker)
    npos = alive_pos(v)
    if ppos is None or npos is None:
        print("[npc] trade refused (pos unknown): %s -> %s" % (speaker, v["key"]), flush=True)
        return [v.get("far", "（手搭凉棚四下张望）没见着人影……走到我铺子跟前，当面才好交割！")]
    dist = ((ppos[0]-npos[0])**2 + (ppos[1]-npos[1])**2 + (ppos[2]-npos[2])**2) ** 0.5
    if dist > limit:
        print("[npc] trade refused (far): %s %.1f blocks from %s" % (speaker, dist, v["key"]), flush=True)
        return [v.get("far", "（手搭凉棚张望）隔着老远喊什么呢？走到我跟前来，当面点货！")]
    q = quest_of(v["key"])
    if not q:
        return [v.get("quest_busy", "今日的活已经有人办完了。")]
    aliases = ITEM_ALIASES.get(q["item"], [q["zh"]])
    if item_zh not in aliases and item_zh != q["item"]:
        return ["这个我今日不收——我要的是 %d 个%s。" % (q["count"], q["zh"])]
    if count < q["count"]:
        return [v.get("short", "数目不够，我要 {count} 个{zh}。").replace("{count}", str(q["count"])).replace("{zh}", q["zh"])]
    # /clear 收货：响应 "Removed N items" 即实收数量
    try:
        r = R.cmd("clear %s minecraft:%s %d" % (speaker, q["item"], q["count"]))
    except Exception:
        R.s = None
        return ["（交易被一阵怪风打断了……再试一次？）"]
    m = re.search(r"Removed (\d+)", r)
    got = int(m.group(1)) if m else 0
    if got < q["count"]:
        if got > 0:
            R.cmd("give %s minecraft:%s %d" % (speaker, q["item"], got))  # 原路退还
        return [v.get("short", "数目不够，我要 {count} 个{zh}。").replace("{count}", str(q["count"])).replace("{zh}", q["zh"])]
    # 结算
    reward_desc = []
    if q["emerald"] > 0:
        R.cmd("give %s minecraft:emerald %d" % (speaker, q["emerald"]))
        reward_desc.append("%d 绿宝石" % q["emerald"])
    if q.get("effect"):
        R.cmd("effect give %s minecraft:%s 60 0" % (speaker, q["effect"]))
        reward_desc.append("祝福·%s" % q["effect"])
    lines = list(v.get("thanks", ["多谢！"]))
    if q.get("lore_atom"):
        atoms = load_atoms()
        pick = random.choice(atoms) if atoms else None
        if pick and pick.get("words"):
            word = pick["words"][0]
            lines.append("（压低声音）说好的秘密——「%s」。在聊天栏念出这个词，女神听得懂。" % word)
            reward_desc.append("咒语情报")
    q["done"], q["done_by"], q["done_at"] = True, speaker, time.strftime("%H:%M")
    villager_hmm(v, "trade", throttle=False)  # 成交"嗯嗯"声（关键反馈，不节流）
    json.dump(QUESTS["doc"], open(quests_path(QUESTS["date"]), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ledger_append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "date": QUESTS["date"], "villager": q["display"],
                   "player": speaker, "item": q["item"], "count": q["count"], "reward": ",".join(reward_desc) or "无"})
    chronicle_append("集市｜%s 替 %s 办成今日委托（%d %s → %s）" % (speaker, q["display"], q["count"], q["zh"], "、".join(reward_desc) or "谢意"))
    feed_append({"kind": "event", "npc": q["display"], "text": "%s 办成了 %s 的委托（%d %s → %s）" % (speaker, q["display"], q["count"], q["zh"], "、".join(reward_desc) or "谢意")})
    try:
        # 2026-08-23 造物主谕：确认一律 msg 点对点，不刷公屏——委托完成只告诉委托人。
        tellraw([("[女神] ", "gold"), ("%s 办成了 %s 的今日委托。（编年史已记）" % (speaker, q["display"]), "white")], to=speaker)
    except Exception:
        pass
    print("[quest] DONE %s -> %s: %s" % (speaker, q["display"], q["zh"]), flush=True)
    # 公会钩子：该委托若在看板上，连带销板+声望+公告（未接单的裸交付也给功勋——板书即公会）
    try:
        import mc_guild as _G
        if _G.settle_gather(q["id"], speaker):
            lines.append("（柜台那头盖了个青色印章）公会看板上的这单也一并给你记功了。")
    except Exception as e:
        print("[guild] settle err:", e, flush=True)
    try:
        sync_offers([v])  # 柜台同步撤下已完成的委托（GUI/whisper 双通道一致）
    except Exception:
        R.s = None
    return lines

# ---------- 原版交易柜台（Offers.Recipes 通用接口，2026-08-18） ----------
def _offer_recipe(item_id, count, emeralds, max_uses=1):
    """委托柜台条目：buy=收购物品 sell=绿宝石；价格全钉死（specialPrice/demand/priceMultiplier=0）
    防原版供需涨价；maxUses=1 一份卖完即灰；rewardExp:0b 不吐交易经验。"""
    return ('{buy:{id:"minecraft:%s",count:%d},sell:{id:"minecraft:emerald",count:%d},'
            'uses:0,maxUses:%d,discountCounter:0,specialPrice:0,demand:0,'
            'priceMultiplier:0.0f,rewardExp:0b}' % (item_id, count, emeralds, max_uses))

# ---------- 技能书（2026-08-22 造物主谕：书商卖"怎么咏唱"的技能书） ----------
# 书 = 实物化的 mc_spell_detail：标准咏唱词 + 等级门槛 + 用法。玩家买了读书 → 照词咏唱 →
# 成功即 seal 掌握（与自主学习闭环一致）。内容照 A 仓 mc-spellbook.ts SPELLS_SEED 抄录。
# 注意：单页合并排版（MC 1.21 SNBT 不认 \n/\u 转义，真实换行又截断 RCON；页面用｜分隔）。
# 每本技能书条目占 NBT 较大，书商总柜台（3卖+2本+1收）需 < ~1300 字节，故每商限量 2 本。
SKILLBOOKS = {
    "home": {
        "title": "归乡之卷", "author": "墨白", "emerald": 2, "chant": "咏唱：归乡/回家/回基地/归途/回巢",
        "pages": [
            "归乡之卷（空间系·Lv2）｜咏唱：归乡/回家/回基地/归途/回巢。私语念出即施，成功即掌握；远行前备一卷，迷途不慌。",
        ],
    },
    "light": {
        "title": "照明之卷", "author": "墨白", "emerald": 2, "chant": "咏唱：照明/点火/火把/光亮/照亮/驱暗",
        "pages": [
            "照明之卷（光系·Lv1）｜咏唱：照明/点火/火把/光亮/照亮/驱暗。黑暗中私语念出，掌心燃光；矿洞夜路皆可应急。",
        ],
    },
    "feed": {
        "title": "饱食之卷", "author": "墨白", "emerald": 3, "chant": "咏唱：饱食/充饥/饱腹/不饿/充能",
        "pages": [
            "饱食之卷（生命系·Lv2）｜咏唱：饱食/充饥/饱腹/不饿/充能。腹空时私语念出，饥意自消；神赐一餐，不如自己种一田。",
        ],
    },
    "heal": {
        "title": "圣愈之卷", "author": "云笈", "emerald": 4, "chant": "咏唱：圣愈/治愈/治疗/疗伤/回血/痊愈",
        "pages": [
            "圣愈之卷（生命系·Lv5）｜咏唱：圣愈/治愈/治疗/疗伤/回血/痊愈。负伤时私语念出，伤口愈合；生死关头的保命卷。",
        ],
    },
    "tp": {
        "title": "传送之卷", "author": "云笈", "emerald": 4, "chant": "咏唱：传送/瞬移/闪现/空间跳跃/跃迁",
        "pages": [
            "传送之卷（空间系·Lv2）｜咏唱：传送/瞬移/闪现/撕裂虚空/空间跳跃/跃迁。报方向距离（如「传送十格东」）念出即至。",
        ],
    },
    "give": {
        "title": "造物之卷", "author": "云笈", "emerald": 4, "chant": "咏唱：造物/赐予/给予/给我/变出",
        "pages": [
            "造物之卷（创造系·Lv2）｜咏唱：造物/赐予/给予/赐下/给我/变出。报所需之物（如「给我个火把」）私语念出，神恩按白名单施予。",
        ],
    },
    # 2026-08-23 造物技能自由化：空白造物卷（书与笔）——玩家自写想要的内容 → 合书 → 右键。
    # 白名单内物资直给（火把/面包/煤/原木/石头/圆石/铁锭/金锭/小麦/苹果/木棍/木板，数量有上限）；
    # 白名单外（钻石剑/附魔书/末影珍珠…）→ 呈神裁量，或拒或索供奉。写在书页里的话就是祈愿文。
    "craft": {
        "title": "空白造物卷", "author": "云笈", "emerald": 2, "writable": True,
        "pages": [
            "空白造物卷｜买下这本空白书（书与笔），写下你想要的物资（如「铁锭 2」「火把」），合成本书后右键——白名单内的物资直接到手；白名单外的会上达天神，由女神裁断。",
        ],
    },
}

def _snbt_esc(t):
    """SNBT 字符串转义：MC 1.21 只认 \\" \\\\ \\' \\n（不认 \\uXXXX）；中文原样 UTF-8。
    换行必须转 \\n 序列（真实换行会截断 RCON 命令）。"""
    return t.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

def _skillbook_nbt(sb, key):
    """1.21 组件格式：pages 是 JSON 编码 RawText 字符串数组（纯 tag 写法会被静默丢弃）。
    2026-08-23 技能书右键：custom_data.skillbook=<key> 供 settlementsfix mod 识别
    （固定技能书右键一键施法）；writable=True 的「空白造物卷」卖书与笔 + custom_data.craftreq=true，
    玩家自写内容合书后产物由 mod 打 craftreq 标记 → 右键呈造物。"""
    pages = ",".join('"%s"' % _snbt_esc(json.dumps({"text": p}, ensure_ascii=False)) for p in sb["pages"])
    if sb.get("writable"):
        return ('{id:"minecraft:writable_book",count:1,components:'
                '{"minecraft:custom_data":{"craftreq":true}}}')
    # 2026-08-23 造物主谕「书在手上右键=施法而非打开」：技能书右键被 settlementsfix mod 拦截施法、
    # 2026-08-29 godfix.5 新交互：右键=施放、潜行+右键=翻开细读说明（lore 同步更新）。
    lore_items = [
        {"text": sb.get("chant", ""), "color": "gray", "italic": False},
        {"text": "右键=施放 · 潜行+右键=阅读", "color": "dark_gray", "italic": True},
    ]
    lore = ",".join('"%s"' % _snbt_esc(json.dumps(x, ensure_ascii=False)) for x in lore_items)
    return ('{id:"minecraft:written_book",count:1,components:'
            '{"minecraft:written_book_content":{title:"%s",author:"%s",pages:[%s]},'
            '"minecraft:custom_data":{"skillbook":"%s"},"minecraft:lore":[%s]}'
            % (_snbt_esc(sb["title"]), _snbt_esc(sb["author"]), pages, key, lore))

def _recipes_nbt(v):
    """村民柜台：当日未完成委托 + 档案 shop 民生柜台。
    market_agg=True 的「掌柜」聚合全村全部未完成委托（含盔甲架人偶 NPC 的——人偶无 GUI，
    掌柜总柜台补全覆盖：右键一个村民 = 看到所有今日委托）。"""
    recipes = []
    if v.get("market_agg"):
        for x in quests_today()["quests"]:
            if not x.get("done"):
                recipes.append(_offer_recipe(x["item"], x["count"], max(1, x.get("emerald", 1))))
    else:
        q = quest_of(v["key"])
        if q and not q.get("done"):
            recipes.append(_offer_recipe(q["item"], q["count"], max(1, q.get("emerald", 1))))
    for s in v.get("shop", []):
        if s.get("skillbook"):
            sb = SKILLBOOKS.get(s["skillbook"])
            if not sb:
                continue
            sell = _skillbook_nbt(sb, s["skillbook"])
            recipes.append('{buy:{id:"minecraft:emerald",count:%d},sell:%s,uses:0,maxUses:%d,'
                           'discountCounter:0,specialPrice:0,demand:0,priceMultiplier:0.0f,rewardExp:0b}' % (
                               int(s.get("emerald", sb.get("emerald", 3))), sell, int(s.get("max", 1))))
            continue
        recipes.append('{buy:{id:"minecraft:emerald",count:%d},sell:{id:"minecraft:%s",count:%d},'
                       'uses:0,maxUses:%d,discountCounter:0,specialPrice:0,demand:0,'
                       'priceMultiplier:0.0f,rewardExp:0b}' % (
                           int(s.get("emerald", 1)), s["item"], int(s.get("count", 1)), int(s.get("max", 12))))
    # 收购柜台（2026-08-22 造物主谕「村民也该收购」）：buy 表 = 职业需求，玩家卖物资换绿宝石
    for b in v.get("buy", []):
        recipes.append(_offer_recipe(b["item"], int(b.get("count", 1)), int(b.get("emerald", 1)), int(b.get("max", 12))))
    if not recipes:
        return None
    return "Offers:{Recipes:[%s]}" % ",".join(recipes)

def sync_offers(vlist=None):
    """柜台同步（幂等）：把当日委托/撤架状态刷进活村民 Offers；Xp:0 防交易升级换表。
    写架前先 _scan_settle 侦测 pending 成交，防止 uses 被重写抹掉（60s 看护 vs 15s 轮询竞速）。"""
    for v in (vlist or PROFILES):
        if mode_of(v) == "stand":
            continue
        _scan_settle(v)
        nbt = _recipes_nbt(v) or "Offers:{Recipes:[]}"
        try:
            R.cmd("data merge entity %s {%s,Xp:0}" % (sel(v), nbt))
        except Exception:
            R.s = None
    print("[offer] synced", flush=True)

def _parse_trades(nbt_text):
    """Offers NBT 文本 → [(item_id, count, uses)]。
    vanilla data get 是带空格的 pretty 格式（'buy: {'），自己 merge 写的是紧凑格式（'{buy:'），
    故切分一律用正则容忍两种；buy 块内各字段独立搜索（vanilla 会重排键序）；
    uses 用负向后顾排除 maxUses 子串假阳性。"""
    out = []
    for chunk in re.split(r'buy\s*:\s*\{', nbt_text or "")[1:]:
        buy_part = re.split(r',\s*sell\s*:\s*\{', chunk)[0]
        mi = re.search(r'id\s*:\s*"minecraft:([a-z0-9_]+)"', buy_part)
        mc_ = re.search(r'count\s*:\s*(\d+)', buy_part)
        mu = re.search(r'(?<![A-Za-z])uses\s*:\s*(\d+)', chunk)
        if mi and mc_ and mu:
            out.append((mi.group(1), int(mc_.group(1)), int(mu.group(1))))
    return out

def _scan_settle(v):
    """读柜台上架商品的 uses，≥1 的按 item+count 回配当日未完成委托核销。
    watch 轮询与 sync_offers 写架前共用，双路径收敛防 uses 被重写抹掉。"""
    try:
        r = R.cmd("data get entity %s Offers" % sel(v))
    except Exception:
        R.s = None
        return
    for item, cnt, uses in _parse_trades(r or ""):
        if uses < 1:
            continue
        try:
            quests = quests_today()["quests"]
        except Exception:
            continue
        q = next((x for x in quests if x["item"] == item and x["count"] == cnt and not x.get("done")), None)
        if q:
            owner = next((p for p in PROFILES if p["key"] == q["villager"]), v)
            try:
                _settle_gui_trade(owner, q)
            except Exception as e:
                print("[offer] settle err:", e, flush=True)

def _settle_gui_trade(v, q):
    """GUI 成交核销（轮询侦测 uses 0→1）：委托下架 + 补发奖励 + 台账。交易者取柜台 6 格内最近玩家。"""
    near = "@p[distance=..6,limit=1]"
    q["done"], q["done_by"], q["done_at"] = True, "(gui)", time.strftime("%H:%M")
    try:
        json.dump(QUESTS["doc"], open(quests_path(QUESTS["date"]), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    except Exception:
        pass
    reward_desc = ["%d 绿宝石(gui柜台)" % q.get("emerald", 0)]
    if q.get("effect"):
        try:
            R.cmd("effect give %s minecraft:%s 60 0" % (near, q["effect"]))
            reward_desc.append("祝福·%s" % q["effect"])
        except Exception:
            R.s = None
    if q.get("lore_atom"):
        atoms = load_atoms()
        pick = random.choice(atoms) if atoms else None
        if pick and pick.get("words"):
            word = pick["words"][0]
            reward_desc.append("咒语情报")
            try:
                speak(v, "（柜台交割后凑近耳边）说好的秘密——「%s」。在聊天栏念出这个词，女神听得懂。" % word, to=near)
            except Exception:
                R.s = None
    ledger_append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "date": QUESTS["date"], "villager": q["display"],
                   "player": "(gui)", "item": q["item"], "count": q["count"],
                   "reward": ",".join(reward_desc), "via": "gui"})
    chronicle_append("集市｜有人在柜台买走了 %s 的委托（%d %s → %s）" % (q["display"], q["count"], q["zh"], "、".join(reward_desc)))
    feed_append({"kind": "event", "npc": q["display"], "text": "%s 的委托在柜台被买走（%d %s）" % (q["display"], q["count"], q["zh"])})
    print("[offer] GUI DONE %s: %s" % (q["display"], q["zh"]), flush=True)
    # 公会钩子：GUI 柜台成交也销板（完成者=柜台 6 格内最近玩家）
    try:
        import mc_guild as _G
        _G.settle_gather(q["id"], "@p[distance=..6,limit=1]", cmd_who="@p[distance=..6,limit=1]")
    except Exception as e:
        print("[guild] gui settle err:", e, flush=True)
    sync_offers()  # 全量：掌柜聚合柜与各家柜同步下架

def watch_offers():
    """柜台成交侦测（15s 轮询）：扫每个柜台实体的全部 recipe，uses≥1 的核销。"""
    while True:
        time.sleep(15)
        for v in PROFILES:
            if mode_of(v) == "stand" or not v.get("alive"):
                continue
            _scan_settle(v)

# ---------- @公证交割（Agent↔Agent / 玩家↔玩家，村民作公证点） ----------
RE_HANDOFF = re.compile(r"@([A-Za-z0-9_]{1,16})\s+(?:给\s*)?(\d+)\s*([A-Za-z\u4e00-\u9fff_]+)")

def handoff(speaker, v, target, count, item_name):
    """女神公证交割：/clear 收 speaker → /give 交 target，双方须 ≤trade_proximity 格当面。
    对价协商在 Agent 社交层自理，这里只做物品交割公证。失败原路退还。"""
    iid = zh2id(item_name)
    if iid is None:
        return [v.get("handoff_unk", "这物件我不识得——说个常见的名儿（煤/铁锭/面包…），或用英文物品名。")]
    if target == speaker:
        return ["自己给自己递东西，这公证我可做不了。"]
    try:
        limit = float(CFG.get("trade_proximity", 5))
    except (TypeError, ValueError):
        limit = 5.0
    tpos = player_pos(target)
    spos = player_pos(speaker)
    if tpos is None:
        return [v.get("handoff_away", "%s 不在场——公证交割得人到齐。" % target)]
    if spos is not None:
        dist = ((spos[0]-tpos[0])**2 + (spos[1]-tpos[1])**2 + (spos[2]-tpos[2])**2) ** 0.5
        if dist > limit:
            print("[npc] handoff refused (far): %s -> %s %.1f blocks" % (speaker, target, dist), flush=True)
            return [v.get("far", "公证交割得当面——把 %s 叫到跟前来（5 格内）再找我。" % target)]
    try:
        r = R.cmd("clear %s minecraft:%s %d" % (speaker, iid, count))
    except Exception:
        R.s = None
        return ["（一阵怪风卷过柜台……再试一次？）"]
    m = re.search(r"Removed (\d+)", r)
    got = int(m.group(1)) if m else 0
    if got <= 0:
        return [v.get("handoff_none", "你背包里没有 %d 个%s，空手递什么？" % (count, item_name))]
    if got < count:
        R.cmd("give %s minecraft:%s %d" % (speaker, iid, got))  # 原路退还
        return [v.get("handoff_none", "你背包里只有 %d 个%s，不够 %d 个——我退回去了。" % (got, item_name, count))]
    R.cmd("give %s minecraft:%s %d" % (target, iid, got))
    try:
        speak(v, "%s 托我公证，当面转交给你 %d 个%s——请点收。" % (speaker, got, item_name), to=target)
    except Exception:
        R.s = None
    ledger_append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "date": QUESTS["date"], "villager": v["display"],
                   "player": speaker, "item": iid, "count": got, "reward": "->%s" % target, "via": "handoff"})
    chronicle_append("集市｜%s 经 %s 公证转交 %s %d %s" % (speaker, v["display"], target, got, item_name))
    feed_append({"kind": "event", "npc": v["display"],
                 "text": "%s 经 %s 公证转交 %s %d %s" % (speaker, v["display"], target, got, item_name)})
    print("[handoff] %s -> %s: %dx%s (via %s)" % (speaker, target, got, iid, v["display"]), flush=True)
    return [v.get("handoff_ok", "（当面点清）%d 个%s，已交到 %s 手上——两清！" % (got, item_name, target))]

# ---------- LLM 接口（预留，默认关闭） ----------
# 2026-08-23 造物主谕「NPC 私聊要贴人设 + 世界设定」：给村民注入一条世界常识，
# 让 TA 被问「女神/法术/归乡」时能帖人设地指点，而不是瞎编或掉兜底模板。
WORLD_BRIEF = ("这片世界叫千灯纪，由一位女神庇护。人可以向女神祈愿求恩典，"
               "也可以把法术咏唱出来——念对固定的词，世界就会回应，住民把这叫「魔法」。"
               "「归乡」是女神赐的空间之艺，能把离家的人送回村子；想学它，"
               "要么带诚心祈愿求女神，要么去书商墨白那儿淘一本《归乡之卷》。"
               "你只是个街坊，不是女神也不是祭司——祈愿/法术/玩法这些是女神的事。"
               "你懂的就照这些话聊聊；凡拿不准、超纲的，别假装懂、别只说不知道就完事，"
               "要明明白白把路指给他：问他女神，「疑问私聊 /msg Goddess 问：<问题>」"
               "「求帮助私聊 /msg Goddess 祈愿：<愿望>」，「想学法术私聊女神念词即可」。")

# 世界设定问询触发词：玩家（尤其新来的 AI/真人）问起女神/法术/归乡/祈愿等常识，
# 即便没点名村民、只是近旁搭话，也让村民走 LLM 贴人设+世界设定作答，别掉模板。
# 其余话题仍走模板兜底（保住 2026-08-22「未点名不碰 LLM」防阻塞的静默）。
WORLD_QUERY_KW = ("归乡", "归途", "回村", "回基地", "回家", "女神", "天神", "神谕",
                  "祈愿", "咏唱", "法术", "魔法", "咒语", "技能书", "天赋", "祝福",
                  "求教", "请教", "怎么学", "如何学", "学一门", "怎么回", "神灵")

# ---------- 2026-08-29 造物主谕「算力再分配·二」：村民闲聊零 LLM ----------
# 村民的话不再用 LLM 实时生成（闲聊全模板）；LLM 只留给工会委托（llm_quest）。
# 世界设定问询改走固定指路语（WORLD_GUIDE，按关键词分派，内容源自 WORLD_BRIEF），
# 答案本就高度确定（归乡=书商/祈愿=女神），模板比 LLM 更稳更快更省。
# 回退开关：llm.chat_mode="chat" 可恢复旧闲聊 LLM 行为（默认 "quests"）。
WORLD_GUIDE = [
    (("归乡", "归途", "回村", "回家", "怎么回", "回基地"),
     "想回村？找书商墨白淘一本《归乡之卷》，或者诚心向女神求「归乡」这门艺——念对词，人就到家了。"),
    (("祈愿", "女神", "天神", "神谕", "神灵", "求"),
     "有事求女神就私聊她：「/msg Goddess 祈愿：<你的愿望>」。她听得见，诚心点，带上供奉更好。"),
    (("法术", "咏唱", "咒语", "魔法", "技能书", "怎么学", "如何学", "学一门", "天赋"),
     "想学法术？私聊女神念词就能咏唱；想深造就去书商墨白那儿淘技能书。我只会种地，这些是女神的事。"),
    (("问", "为什么", "什么"),
     "这个我还真说不准——你私聊女神问：「/msg Goddess 问：<问题>」，她懂世界的一切。"),
]

def world_guide_reply(msg):
    """世界设定问询的固定指路语（零 LLM）。命中返回台词行；未命中返回 None。"""
    for kws, line in WORLD_GUIDE:
        if any(w in msg for w in kws):
            return [line]
    return None

def llm_reply(v, speaker, msg, ctx):
    llm = CFG.get("llm", {})
    if not llm.get("enabled"):
        return None
    sysp = ("你是%s，Minecraft世界「千灯纪」集市的村民。人设：%s 背景：%s %s 目前在线：%s。%s"
            "请以人设口吻用中文回答，不超过两句话；说话用大白话、口语，像街坊邻居聊天一样，简短直接，"
            "别拽文、别用文言、别用书面腔；不要出戏，不要提到游戏机制之外的现实。"
            "你只能说话、不能走动办事：不许说『我这就去』『我带给你』『我马上来』这类承诺——"
            "要办事就答『记下了，我托给任务板或守卫』；有人求救求物时只指路（哪有吃的、找谁帮忙），别揽活。") % (
        v["display"], v.get("persona", ""), " ".join(v.get("backstory", [])[:1]), quest_summary(v), ctx.get("online", "?"), WORLD_BRIEF)
    body = json.dumps({
        "model": llm.get("model", "qwen3.8-27b"),
        "messages": [{"role": "system", "content": sysp},
                     {"role": "user", "content": "%s 对你说：%s" % (speaker, msg)}],
        "max_tokens": llm.get("max_tokens", 200),
        "temperature": llm.get("temperature", 0.7),
        "reasoning_effort": llm.get("reasoning_effort", "none"),
    }).encode("utf-8")
    req = urllib.request.Request(llm.get("endpoint", "http://127.0.0.1:8890/v1/chat/completions"),
                                 data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=llm.get("timeout", 6)) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        text = text.strip().split("</think>")[-1].strip()
        lines = [x for x in text.splitlines() if x.strip()][:2]
        return lines or None
    except Exception as e:
        print("[llm] fallback:", e, flush=True)
        return None

# ---------- 灶火祭司通道（2026-08-20 造物主谕：一村民一 session，互不串台） ----------
# ---------- 村民轨迹与技能（2026-08-20 造物主谕：轨迹沉淀成 skill，渐进式披露） ----------
TRAJ_DIR = os.path.join(VDIR, "traj")
SKILL_DIR = os.path.join(VDIR, "skills")
os.makedirs(TRAJ_DIR, exist_ok=True)
os.makedirs(SKILL_DIR, exist_ok=True)
_SEEDED = set()  # 本引擎生命内已播人设的记忆线（进程重启后重播一次，作轻量锚定）

def _traj_path(key):
    return os.path.join(TRAJ_DIR, key + ".jsonl")

def _traj_append(key, speaker, q, a):
    try:
        with open(_traj_path(key), "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": int(time.time()), "speaker": speaker,
                                "q": (q or "")[:60], "a": (a or "")[:80]}, ensure_ascii=False) + "\n")
    except Exception:
        pass

def _bigrams(s):
    s = "".join((s or "").split())
    return {s[i:i + 2] for i in range(len(s) - 1)}

def _traj_recall(key, msg, k=3):
    """渐进式披露·按需提取：bigram 重叠≥2 才算相关，取 top-k 轨迹为「回忆」。"""
    try:
        rows = [json.loads(l) for l in open(_traj_path(key), encoding="utf-8") if l.strip()]
    except OSError:
        return []
    qg = _bigrams(msg)
    scored = []
    for r in rows[-200:]:
        ov = len(qg & (_bigrams(r.get("q")) | _bigrams(r.get("a"))))
        if ov >= 2:
            scored.append((ov, r))
    scored.sort(key=lambda x: -x[0])
    out, seen = [], set()
    for _, r in scored:
        sig = (r.get("q") or "")[:20]
        if sig in seen:
            continue
        seen.add(sig)
        out.append(r)
        if len(out) >= k:
            break
    return out

def _skill_card(key):
    """村民技能卡（data/village/skills/<key>.md）：存在即随人设播种，上限 600 字。"""
    try:
        return open(os.path.join(SKILL_DIR, key + ".md"), encoding="utf-8").read().strip()[:600]
    except OSError:
        return ""

# ---------- 桥：处境喂魂（2026-08-20 造物主谕「一步到位」） ----------
# 读 Settlements mod 行为状态（neoforge:attachments），合成一句中文处境，
# 注入灶火祭司 LLM，使村民之「知」源于真实处境——先有「知」才有「求」。
# 数据源实测（浪伯）：settlements:day_plan（dayType/activityBlocks/slots）、
#   settlements:hunger（饱食度 0=饿~1=饱）、settlements:villager_genetics（六维基因）。
GENE_CN = {
    "STRENGTH": "气力", "CONSTITUTION": "体魄", "AGILITY": "身手",
    "INTELLIGENCE": "聪慧", "WILL": "心志", "CHARISMA": "魅力",
}
CTX_CN = {"IDLE": "闲着", "MEET": "与人聚着", "WORK": "忙活", "SLEEP": "歇着"}

def _get_att(v, path):
    """读 neoforge:attachments 下的精确路径，返回原始值文本；失败/无值返回空串。
    精确路径优于读整个 attachments——整个 attachments 序列化顺序不稳定（HashMap）
    且超 4096 字符会被 /data get 截断，导致字段时有时无。"""
    try:
        r = R.cmd("data get entity %s %s" % (sel(v), path))
    except Exception:
        R.s = None
        return ""
    if not r or "has the following entity data" not in r:
        return ""
    return r.split("has the following entity data: ", 1)[-1].strip()

def read_situation(v):
    """读 mod 行为状态 → 一句中文处境；非 base_villager 载体返回空串。
    四项精确查询（各短、不截断）：饱食度 / 休息日 / 当前活动 / 六维基因。"""
    if v.get("carrier") != "base_villager":
        return ""
    parts = []
    # 饱食度（settlements:hunger，0=饿 ~ 1=饱）
    h = _get_att(v, "neoforge:attachments.settlements:hunger")
    m = re.search(r"(-?[\d.]+)f", h)
    if m:
        hv = float(m.group(1))
        parts.append("腹中充足" if hv >= 0.75 else
                     "腹中尚可" if hv >= 0.70 else
                     "肚里有点空" if hv >= 0.50 else
                     "饥肠辘辘" if hv >= 0.30 else "饿得发虚")
    # 今日休息日还是当值日
    dt = _get_att(v, "neoforge:attachments.settlements:day_plan.plan.dayType")
    if dt:
        parts.append("休息日" if "REST_DAY" in dt else "当值日")
    # 当前活动块（schedule.activityBlocks 末个 context）
    ab = _get_att(v, "neoforge:attachments.settlements:day_plan.plan.schedule.activityBlocks")
    acts = re.findall(r'context\s*:\s*"([A-Z_]+)"', ab)
    if acts:
        parts.append("此刻" + CTX_CN.get(acts[-1], acts[-1]))
    # 六维基因：挑最高与最低，点出性格
    g = _get_att(v, "neoforge:attachments.settlements:villager_genetics.genes")
    genes = re.findall(r'type\s*:\s*"([A-Z_]+)"\s*,\s*value\s*:\s*(-?[\d.]+)d', g)
    if len(genes) >= 2:
        gv = [(GENE_CN.get(t, t), float(val)) for t, val in genes]
        hi = max(gv, key=lambda x: x[1])
        lo = min(gv, key=lambda x: x[1])
        if hi[0] != lo[0]:
            parts.append("%s出众、%s欠缺" % (hi[0], lo[0]))
    return "、".join(parts) if parts else ""

def _hearth_reply(sid, user_id, text, dbg):
    """走 mc-hearth agent 通道（本地 27B），返回完整 answer 文本；失败返回 None。
    闲聊（agent_chat）与祈愿（villager_pray）共用；session_id 由调用方区分。"""
    llm = CFG.get("llm", {})
    if not (llm.get("enabled") and llm.get("agent")):
        return None
    body = json.dumps({
        "channel": "console",
        "user_id": user_id,
        "session_id": sid,
        "input": [{"role": "user", "content": [{"type": "text", "text": text}]}],
    }).encode("utf-8")
    req = urllib.request.Request(
        llm.get("agent_endpoint", "http://127.0.0.1:8088/api/console/chat"),
        data=body,
        headers={"Content-Type": "application/json", "X-Agent-Id": llm.get("agent_id", "mc-hearth")})
    try:
        with urllib.request.urlopen(req, timeout=llm.get("agent_timeout", 45)) as resp:
            raw = resp.read().decode("utf-8", "replace")
        # 运维取证：最后一次祭司应答原文落盘（排障用，环形覆盖）
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "hearth-last.sse"), "w", encoding="utf-8") as df:
                df.write("dbg=%s\n" % dbg)
                df.write(raw[-8000:])
        except Exception:
            pass
        # SSE 解析（与 mc-god.ts callAgent 同法）：取最后一条正式回答
        msg_id, answer = None, ""
        pending = {}
        for line in raw.split("\n"):
            if not line.startswith("data:"):
                continue
            try:
                evt = json.loads(line[5:].strip())
            except Exception:
                continue
            if evt.get("object") == "message":
                if evt.get("type") == "message":
                    msg_id = evt.get("id")
                continue
            if evt.get("object") == "content" and isinstance(evt.get("msg_id"), str):
                t = (evt.get("data") or {}).get("text") or evt.get("text") or ""
                if not t:
                    continue
                slot = pending.setdefault(evt["msg_id"], {"delta": "", "full": ""})
                if evt.get("delta") is False:
                    slot["full"] = t
                else:
                    slot["delta"] += t
        if msg_id and msg_id in pending:
            answer = pending[msg_id]["delta"] or pending[msg_id]["full"]
        return answer.strip().split("</think>")[-1].strip() or None
    except Exception as e:
        print("[hearth] fallback:", e, flush=True)
        return None

def agent_chat(v, speaker, msg, ctx):
    """经 QwenPaw Agent mc-hearth（本地 27B）以村民之魂作答。
    隔离铁律：session_id = npc:<villager_key> —— 每位村民一条独立记忆线，
    岳山永不记得墨白聊过什么；不同旅人对同村村民说话共用该村民的 session
    （那是村民自己的记忆）。
    2026-08-20 三改（造物主谕）：
      ① 人设不再每问重申——每条记忆线只在本引擎生命期内首次开口时播种一次；
      ② 轨迹沉淀：每次对话落 data/village/traj/<key>.jsonl（append-only）；
      ③ 渐进式披露：新消息按 bigram 重叠从轨迹按需提取 top-3 注入为「回忆」，
         data/village/skills/<key>.md 存在时随人设播种（沉淀成 skill，按需加载）。
    任何失败返回 None → 走旧直连 llm_reply → 模板台词，引擎永不停摆。"""
    llm = CFG.get("llm", {})
    if not (llm.get("enabled") and llm.get("agent")):
        return None
    sid = "npc:%s" % v["key"]
    if sid in _SEEDED:
        recall = _traj_recall(v["key"], msg)
        sit = read_situation(v)
        pre = ("（你此刻的处境：%s。）\n" % sit) if sit else ""
        if recall:
            pre += "（你想起先前的事：%s）\n" % "；".join(
                "%s问过「%s」你答「%s」" % (r.get("speaker", "有人"), (r.get("q") or "")[:20], (r.get("a") or "")[:16])
                for r in recall)
        text = "%s%s 对你说：%s" % (pre, speaker, msg)
    else:
        _SEEDED.add(sid)
        skill = _skill_card(v["key"])
        sit = read_situation(v)
        sysp = ("你就是%s本人——千灯纪集市的村民。人设：%s 背景：%s %s 目前在线：%s。%s"
                "以你的口吻用中文回话，不超过两句话；说话用大白话、口语，像街坊邻居聊天一样，简短直接，"
                "别拽文、别用文言、别用书面腔；不出戏、不提游戏机制之外的事；"
                "你不是女神也不是祭司；除了你自己这条记忆线里的事，别的村民与旅人聊过什么你一概不知。%s"
                "%s") % (
            v["display"], v.get("persona", ""), " ".join(v.get("backstory", [])[:1]), quest_summary(v),
            ctx.get("online", "?"),
            ("\n你此刻的处境：%s。" % sit) if sit else "",
            ("\n你的心得手记（熟稔之事）：\n" + skill) if skill else "",
            ("\n\n这个世界你耳熟能详：\n" + WORLD_BRIEF))
        text = "%s\n\n%s 对你说：%s" % (sysp, speaker, msg)
    answer = _hearth_reply(sid, "npc-" + v["key"], text, "chat:%s<-%s" % (v["key"], speaker))
    lines = [x for x in (answer or "").splitlines() if x.strip()][:2]
    if lines:
        _traj_append(v["key"], speaker, msg, lines[0])
    return lines or None

# ---------- 祈福通道（2026-08-20 造物主谕「一步到位」：桥 + 同炉裁 + 神恩有价） ----------
# 村民（base_villager 载体）向女神祈愿：处境驱动触发 → 灶火祭司生成祈愿
# → 投 god-inbox.jsonl → 女神（mc-god.ts）裁断 → 神谕回 god-reply.jsonl → 本引擎消费 speak。
GOD_INBOX = os.path.join(DATA, "god-inbox.jsonl")
GOD_REPLY = os.path.join(DATA, "god-reply.jsonl")

def _god_append(path, rec):
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def villager_pray(v):
    """生成村民祈愿（灶火祭司 LLM，带处境），投递 god-inbox.jsonl；失败返回 False。"""
    sit = read_situation(v)
    sysp = ("你就是%s本人——千灯纪集市的村民。你此刻的处境：%s。"
            "你要向这方世界的女神祈愿。用大白话说一句话，像平常人开口求人帮忙那样，别拽文、别文绉绉，"
            "说出你此刻最想求女神的事，"
            "必须与你的真实处境相关（饿了求食、怕了求护、有难求助、有愿祈成），不贪心、不越界，"
            "愿以你手头之物（如麦、鱼、炭）为供。只输出这一句祈愿，不要任何别的字。") % (
        v["display"], sit or "一切如常")
    answer = _hearth_reply("prayer:%s" % v["key"], "npc-" + v["key"], sysp, "pray:%s" % v["key"])
    lines = [x for x in (answer or "").splitlines() if x.strip()]
    if not lines:
        return False
    wish = lines[0].strip().strip("「」“”\"'，。 ")
    if not wish or len(wish) < 3:
        return False
    rec = {"key": v["key"], "display": v["display"], "wish": wish,
           "situation": sit or "", "ts": int(time.time())}
    _god_append(GOD_INBOX, rec)
    print("[pray] %s -> %s" % (v["display"], wish), flush=True)
    return True

def _night_time():
    """查 MC 世界时间（daytime ticks），True=夜里（13000~23000）。失败返回 False。"""
    try:
        r = R.cmd("time query daytime")
        m = re.search(r"(\d+)", r or "")
        if m:
            t = int(m.group(1)) % 24000
            return 13000 <= t <= 23000
    except Exception:
        R.s = None
    return False

def prayer_loop():
    """处境驱动的村民祈愿。低频扫描 base_villager 村民，夜里按概率祈愿；每村民有冷却。"""
    cooldown = {}
    while True:
        try:
            time.sleep(PRAY_PERIOD)
            if not CFG.get("prayer", {}).get("enabled", True):
                continue
            if not _night_time():
                continue
            now = time.time()
            for key, v in list(BY_TAG.items()):
                if v.get("carrier") != "base_villager":
                    continue
                if now - cooldown.get(key, 0) < PRAY_COOLDOWN:
                    continue
                if random.random() > PRAY_CHANCE:
                    continue
                cooldown[key] = now
                villager_pray(v)
        except Exception as e:
            print("[prayer] err:", e, flush=True)

def god_reply_loop():
    """消费 god-reply.jsonl（女神神谕），以村民口吻 speak 回应。"""
    while True:
        try:
            if os.path.exists(GOD_REPLY):
                with open(GOD_REPLY, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                if lines:
                    # 只处理新行（本引擎重启后从头读，但用已读游标避免重复；简化：整读后清空）
                    os.remove(GOD_REPLY)
                    for ln in lines:
                        try:
                            rec = json.loads(ln.strip())
                        except Exception:
                            continue
                        key = rec.get("key")
                        v = BY_TAG.get(key) or next((x for x in PROFILES if x["key"] == key), None)
                        if not v:
                            continue
                        reply = (rec.get("reply") or "").strip()
                        if reply:
                            print("[god-reply] %s 收神谕：%s" % (v["display"], reply), flush=True)
                            # 2026-08-22 公屏清净：村民自动祈愿的神谕无祈愿者（rec 无 who）——只入编年史，
                            # 不再 speak 刷全村。若未来恢复祈愿且带祈愿者（who/to），仍点对点送达。
                            who = rec.get("who") or rec.get("to") or rec.get("speaker")
                            if who:
                                speak(v, "%s（仰头望天，喃喃道）%s" % (v["display"], reply), to=who)
                            else:
                                chronicle_append("神谕｜%s 得女神示：%s" % (v["display"], reply))
        except Exception as e:
            print("[god-reply] err:", e, flush=True)
        time.sleep(GOD_REPLY_PERIOD)

# ---------- LLM 生成每日委托（2026-08-18 上线：委托也交给 LLM 写，白名单+clamp 兜底）----------
QUEST_WHITELIST = ["coal", "iron_ingot", "wheat", "potato", "bread", "beef", "cod", "salmon",
                   "oak_log", "stick", "torch", "cooked_beef", "cooked_cod", "baked_potato",
                   "apple", "egg", "leather", "feather", "bone", "string", "sugar", "carrot",
                   "paper", "book", "cobblestone", "sand", "glass", "arrow"]

def llm_quest(v, day):
    """让 LLM 以村民人设拟今日委托。输出严格 JSON，全部字段过校验，任何异常→None 走模板池。
    经济安全：物品只准从白名单选（zh2id 再验一道）；count clamp 3..24；emerald clamp 1..3。"""
    llm = CFG.get("llm", {})
    if not (llm.get("enabled") and llm.get("quests")):
        return None
    zh_map = ", ".join("%s=%s" % (i, ITEM_ALIASES[i][0]) for i in QUEST_WHITELIST)
    sysp = ("你是%s，Minecraft世界「千灯纪」集市的村民。人设：%s。"
            "请以你的身份给今天的集市委托拟一张单子。物品只能从这些里选（id=中文名）：%s。"
            "要求：数量 3 到 24 之间、报酬 1 到 3 颗绿宝石、要与你的营生和人设相关。"
            '只输出一行 JSON，格式：{"item": "物品id", "zh": "中文名", "count": 数量, "emerald": 报酬, '
            '"pitch": "一句话委托口吻，30字内，用大白话、像平常人吆喝一样，含数量和报酬"}。不要输出其他任何内容。') % (
        v["display"], v.get("persona", ""), zh_map)
    body = json.dumps({
        "model": llm.get("model", "qwen3.8-27b"),
        "messages": [{"role": "system", "content": sysp}, {"role": "user", "content": "拟今日委托"}],
        "max_tokens": 300, "temperature": llm.get("temperature", 0.7),
        "reasoning_effort": "none",
    }).encode("utf-8")
    req = urllib.request.Request(llm.get("endpoint", "http://127.0.0.1:8890/v1/chat/completions"),
                                 data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=llm.get("timeout", 12)) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        text = text.strip().split("</think>")[-1].strip()
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            return None
        j = json.loads(m.group(0))
        item = zh2id(str(j.get("item", "")))
        if item not in QUEST_WHITELIST:
            return None
        zh = str(j.get("zh") or ITEM_ALIASES[item][0])
        count = max(3, min(24, int(j.get("count", 0))))
        emerald = max(1, min(3, int(j.get("emerald", 0))))
        pitch = str(j.get("pitch") or "").strip().replace("\n", " ")[:80]
        return {"item": item, "zh": zh, "count": count, "emerald": emerald, "pitch": pitch,
                "id": "%s-%s" % (v["key"], day), "villager": v["key"], "display": v["display"],
                "effect": None, "lore_atom": False, "done": False, "done_by": None, "done_at": None,
                "source": "llm"}
    except Exception as e:
        print("[llm-quest] fallback:", e, flush=True)
        return None

# ---------- 路由 ----------
GREET = ["你好", "哈喽", "hello", "hi", "在吗", "见过", "幸会", "您好"]
QUEST_KW = ["任务", "委托", "帮忙", "活儿", "活计", "差事", "酬劳"]
RE_GIVE = re.compile(r"^(?:给|交给|交付|交)\s*(\d+)\s*(\S+)$")
LAST_TALK = {}  # speaker -> (villager_key, ts)

# 2026-08-22 造物主谕「npc得能回应」：村民开耳——附近旅人说话（未点名）也由最近村民接话，
# 不再当背景板。HEAR_RADIUS 与 mc-social 的 sayRadius 一致（48 格）；ACTIVE_TALK 节流
# 防同一人反复无点名说话时村民连环搭话（点名不受此限）。
HEAR_RADIUS = float(CFG.get("hear", {}).get("radius", 48))
ACTIVE_TALK = {}  # speaker -> ts（最近一次村民主动接话的时间）

def nearest_villager(speaker):
    """说话者 HEAR_RADIUS 格内最近的在世村民；无则 None（先说话者坐标，再各村民坐标）。"""
    ppos = player_pos(speaker)
    if ppos is None:
        return None
    best, bestd = None, None
    for v in PROFILES:
        if not v.get("alive", True):
            continue
        npos = alive_pos(v)
        if npos is None:
            continue
        d = ((ppos[0] - npos[0]) ** 2 + (ppos[1] - npos[1]) ** 2 + (ppos[2] - npos[2]) ** 2) ** 0.5
        if d <= HEAR_RADIUS and (bestd is None or d < bestd):
            best, bestd = v, d
    return best

def route(speaker, msg, via="public"):
    hit_v, rest = None, msg
    by_calls = False
    for v in PROFILES:
        hits = [c for c in v["calls"] if c in msg]
        if hits:
            hit_v = v
            by_calls = True
            for c in hits:
                rest = rest.replace(c, " ")
            rest = rest.strip()
            break
    if hit_v is None:
        lt = LAST_TALK.get(speaker)
        if lt and time.time() - lt[1] < 120:
            hit_v = BY_TAG.get(lt[0]) or next((v for v in PROFILES if v["key"] == lt[0]), None)
            rest = msg.strip()
        else:
            # 未点名：附近最近村民主动接话（60s 节流，防同一人反复喊话时连环搭话）
            now = time.time()
            if now - ACTIVE_TALK.get(speaker, 0) >= 60:
                hit_v = nearest_villager(speaker)
                if hit_v is not None:
                    ACTIVE_TALK[speaker] = now
                    rest = msg.strip()
            if hit_v is None:
                return None, None
    LAST_TALK[speaker] = (hit_v["key"], time.time())
    # —— 冒险者公会（mc_guild）：看板/接单/放弃/我的/声望，优先于村民闲聊 ——
    try:
        import mc_guild as _G
        glines = _G.route_guild(speaker, msg, rest, hit_v)
        if glines is not None:
            return hit_v, glines
    except Exception as e:
        print("[guild] route err:", e, flush=True)
    if any(w in rest for w in GREET) and len(rest) <= 6:
        return hit_v, [hit_v["greet"]]
    m = RE_HANDOFF.match(rest)
    if m:
        # @公证交割：Agent↔Agent / 玩家↔玩家。公屏/传声只教学，结算走私语通道。
        if via in ("public", "voice"):
            return hit_v, [
                "（摆摆手）替人递东西更得避人耳目——凑到耳边低语：/msg Goddess 交易：%s @%s 给%s%s" % (hit_v["calls"][0], m.group(1), m.group(2), m.group(3)),
            ]
        return hit_v, handoff(speaker, hit_v, m.group(1), int(m.group(2)), m.group(3))
    m = RE_GIVE.match(rest)
    if m:
        # WHISPER-TRADE 2026-08-18 刷屏治理：交付类高频指令不占公屏——
        # 公屏/传声喊「岳山 给16煤」只回教学（真人可学），结算只走私语通道（inbox）。
        if via in ("public", "voice"):
            return hit_v, [
                "（左右看了看，压低声音）人多的地方不谈买卖——凑到我耳边低语：/msg Goddess 交易：%s 给%s%s" % (hit_v["calls"][0], m.group(1), m.group(2)),
            ]
        return hit_v, turn_in(speaker, hit_v, int(m.group(1)), m.group(2))
    if any(w in rest for w in QUEST_KW):
        return hit_v, pitch_quest(hit_v)
    ctx = world_ctx()
    for t in hit_v.get("topics", []):
        if any(w in rest for w in t["kw"]):
            return hit_v, resolve_lines(t["lines"], ctx)
    # 2026-08-29 造物主谕「算力再分配」：村民 LLM 对话加冷却——同一旅人反复搭同一村民，
    # 冷却窗口内只烧一次卡，其余走模板（省下的吞吐让给灯语女神/灶火祭司/鸣人/桐人）。
    # 2026-08-29 造物主谕「算力再分配·二」：闲聊零 LLM（默认 chat_mode="quests"）——
    # 村民的话不再实时生成，全模板；LLM 只留给工会委托（llm_quest）。
    # 世界设定问询改走固定指路语（WORLD_GUIDE），答案本就确定，模板更稳更快。
    _chat_llm_on = CFG.get("llm", {}).get("chat_mode", "quests") == "chat"
    global _llm_chat_last
    _ck = (speaker, hit_v["key"])
    if any(w in rest for w in WORLD_QUERY_KW):
        guide = world_guide_reply(rest)
        if guide:
            return hit_v, guide
        if _chat_llm_on:
            _cd = CFG.get("llm", {}).get("chat_cooldown", 75)
            if time.time() - _llm_chat_last.get(_ck, 0) >= _cd:
                lines = agent_chat(hit_v, speaker, msg, ctx)
                if lines:
                    _llm_chat_last[_ck] = time.time()
                    return hit_v, lines
                if CFG.get("llm", {}).get("enabled") and not CFG.get("llm", {}).get("template_first"):
                    lines = llm_reply(hit_v, speaker, msg, ctx)
                    if lines:
                        _llm_chat_last[_ck] = time.time()
                        return hit_v, lines
    # 指名道姓（by_calls/whisper）与闲聊兜底：chat_mode="chat" 才走 LLM，否则全模板。
    # 2026-08-22 造物主谕：未点名（nearest 兜底接话）不碰 LLM——本地 27B 首轮可达
    # 4-5 分钟，同步阻塞 tail 主循环会让全村失聪；未点名只用模板应声（greet/fallback）。
    if _chat_llm_on and (by_calls or via == "whisper"):
        _cd = CFG.get("llm", {}).get("chat_cooldown", 75)
        if time.time() - _llm_chat_last.get(_ck, 0) >= _cd:
            lines = agent_chat(hit_v, speaker, msg, ctx)   # 世界常识已被 agent_chat 注入
            if lines:
                _llm_chat_last[_ck] = time.time()
                return hit_v, lines
            # 兜底直连 LLM（带世界常识；template_first 时省略）
            if CFG.get("llm", {}).get("enabled") and not CFG.get("llm", {}).get("template_first"):
                lines = llm_reply(hit_v, speaker, msg, ctx)
                if lines:
                    _llm_chat_last[_ck] = time.time()
                    return hit_v, lines
    return hit_v, [hit_v.get("greet") or hit_v["fallback"]]

# ---------- 村民看护（tag 选择器 + 组件语法） ----------
def sel(v):
    etype = etype_of(v)
    return '@e[type=%s,tag=%s,limit=1]' % (etype, v["tag"])

def dedup_npc(v):
    """防堆积：同 tag 实体 >1 时只保留一个（多进程竞召/服务器重启竞态的历史教训）。
    幂等三连：标记保留者 → 杀未标记 → 摘标记。
    2026-08-29 修误杀竞态：tag add 瞬断失败（RCON 断连/实体查询空窗）时绝不下刀——
    否则新召唤实体未带 npcKeep 会被 kill 全灭（书商·云笈反复召唤反复被杀的根因）。"""
    etype = etype_of(v)
    r_tag = R.cmd("tag %s add npcKeep" % sel(v))
    if not r_tag or "no entit" in str(r_tag).lower():
        return
    r = R.cmd("kill @e[type=%s,tag=%s,tag=!npcKeep]" % (etype, v["tag"]))
    R.cmd("tag %s remove npcKeep" % sel(v))
    if r and "No entity" not in r:
        print("[npc] dedup:", v["display"], "->", r.strip(), flush=True)

def alive_pos(v):
    try:
        r = R.cmd("data get entity %s Pos" % sel(v))
        m = re.search(r"\[(-?[\d.]+)d, ?(-?[\d.]+)d, ?(-?[\d.]+)d\]", r)
        if m:
            return float(m.group(1)), float(m.group(2)), float(m.group(3))
    except Exception:
        R.s = None
    return None

def player_pos(name):
    """玩家实况坐标（在线玩家）。ASCII 名直传；中文名 RCON 直传 Invalid（MC 实体参数
    不认 Unicode 名），改用选择器 @a[name="…"]——2026-08-22 桐人/鸣人接话排查所修。"""
    target = name
    if not re.match(r"^[A-Za-z0-9_]{1,16}$", name):
        target = '@a[name="%s",limit=1]' % name.replace('"', "")
    try:
        r = R.cmd("data get entity %s Pos" % target)
        m = re.search(r"\[(-?[\d.]+)d, ?(-?[\d.]+)d, ?(-?[\d.]+)d\]", r)
        if m:
            return float(m.group(1)), float(m.group(2)), float(m.group(3))
    except Exception:
        R.s = None
    return None

def nearest_player(pos, maxd=32):
    """在线玩家中离 (x,y,z) 最近的一个（≤maxd 格）；无则 None。
    2026-08-23 造物主谕「NPC 不公屏说话」：村民闲话/守卫喊话只私聊给在场的人。"""
    try:
        r = R.cmd("list")
    except Exception:
        R.s = None
        return None
    m = re.search(r"(?:online|在线)[：:\s]*(.*)$", r or "")
    if not m:
        return None
    names = [n.strip() for n in m.group(1).split(",") if n.strip()]
    best, bestd = None, None
    for n in names:
        ppos = player_pos(n)
        if not ppos:
            continue
        d = ((ppos[0]-pos[0])**2 + (ppos[1]-pos[1])**2 + (ppos[2]-pos[2])**2) ** 0.5
        if d <= maxd and (bestd is None or d < bestd):
            best, bestd = n, d
    return best

def _pose_nbt(pose):
    parts = []
    for k, ang in pose.items():
        vals = ",".join("%sf" % a for a in ang)
        parts.append('%s:[%s]' % (k, vals))
    return "Pose:{%s}" % ",".join(parts)

def _leather(item, rgb):
    return ('{id:"minecraft:%s",count:1,components:{"minecraft:dyed_color":'
            '{rgb:%d,show_in_tooltip:false}}}' % (item, rgb))

def ground_y(x, z, y0, max_drop=8):
    """从 y0 往下找第一个脚下有方块的落地高度（悬空修正）。
    逐格查 (x, y-1, z) 是否空气：非空气则站 y。查不到返回 y0（不动）。
    探测用 scoreboard（无副作用）——2026-08-22 修复：旧 say 探测会把 GY_AIR 广播进聊天框。"""
    try:
        for dy in range(0, max_drop + 1):
            yy = int(y0) - dy
            _locked_cmd("scoreboard players set #gy npc_guard 999")
            _locked_cmd("execute if block %d %d %d minecraft:air store result score #gy npc_guard run scoreboard players add #gy npc_guard 0" % (x, yy - 1, z))
            out = _locked_cmd("scoreboard players get #gy npc_guard")
            if " 999 " in " " + (out or "") + " ":
                return yy
    except Exception:
        R.s = None
    return int(y0)

def summon_stand(v):
    """盔甲架人偶 NPC：自定义头颅（客户端经 http 拉皮肤）+ 染色皮革甲三件 + 姿势 + 持物
    1.21.5+ 实体装备 NBT 用 equipment 复合键（ArmorItems/HandItems 已废弃会被静默丢弃）"""
    reg = SKIN_REG[v["key"]]
    robe = reg["robe"]
    uid = ",".join(str(i) for i in reg["uuid_ints"])
    head = ('{id:"minecraft:player_head",count:1,components:{"minecraft:profile":'
            '{name:"%s",id:[I;%s],properties:[{name:"textures",value:"%s"}]}}}'
            % (reg["name_en"], uid, reg["b64"]))
    equip = ('equipment:{feet:%s,legs:%s,chest:%s,head:%s,mainhand:{id:"%s",count:1}}' % (
        _leather("leather_boots", robe["boots"]),
        _leather("leather_leggings", robe["legs"]),
        _leather("leather_chestplate", robe["chest"]),
        head, reg.get("mainhand", "minecraft:air")))
    nbt = ('{Tags:["%s"],CustomName:{text:"%s",color:"%s"},CustomNameVisible:1b,'
           'Invulnerable:1b,PersistenceRequired:1b,Silent:1b,'
           'NoBasePlate:1b,ShowArms:1b,Marker:0b,Small:0b,%s,%s}') % (
        v["tag"], v["display"], v["color"], _pose_nbt(reg.get("pose", {})), equip)
    x, y, z = v["spawn"]
    y = ground_y(x, z, y)
    R.cmd("summon minecraft:armor_stand %s %s %s %s" % (x, y, z, nbt))
    print("[npc] healed(stand):", v["display"], flush=True)

def summon_villager(v):
    biome = v.get("biome", "plains")
    offers = _recipes_nbt(v) or "Offers:{Recipes:[]}"
    # 2026-08-22 造物主谕「正常 NPC 不要站桩」：一律 NoAI:0b 自由生活（会溜达/归巢），
    # 交易/职业动作不受影响；拴绳看护（heal_npcs leash_radius）把离家者拉回广场。
    noai = "0b"
    nbt = ('{NoAI:%s,Invulnerable:1b,PersistenceRequired:1b,Silent:1b,Tags:["%s"],'
           'CustomName:{text:"%s",color:"%s"},CustomNameVisible:1b,Xp:0,'
           'VillagerData:{profession:"minecraft:%s",level:4,type:"minecraft:%s"},%s}') % (
        noai, v["tag"], v["display"], v["color"], v["profession"], biome, offers)
    x, y, z = v["spawn"]
    y = ground_y(x, z, y)
    base = v.get("carrier") == "base_villager"
    if base:
        # 换身清场：同 tag 旧原版 villager 必除，防新旧载体并存（2026-08-20 万家烟火融合）
        r = R.cmd("kill @e[type=minecraft:villager,tag=%s]" % v["tag"])
        if r and "No entity" not in r:
            print("[npc] purge legacy:", v["display"], "->", r.strip(), flush=True)
        # 原为盔甲架人偶（有皮肤档案）者，一并清除旧人偶，防人偶与实体并存
        if v["key"] in SKIN_REG:
            r2 = R.cmd("kill @e[type=minecraft:armor_stand,tag=%s]" % v["tag"])
            if r2 and "No entity" not in r2:
                print("[npc] purge stand:", v["display"], "->", r2.strip(), flush=True)
        etype = "settlements:base_villager"
    else:
        etype = "minecraft:villager"
    R.cmd("summon %s %s %s %s %s" % (etype, x, y, z, nbt))
    if base:
        # mod 在 spawn 时生成随机名覆盖 CustomName——回填我方名字（1.21.5+ 组件语法）
        R.cmd('data merge entity @e[type=settlements:base_villager,tag=%s,limit=1] '
              '{CustomName:\'{"text":"%s","color":"%s"}\'}' % (v["tag"], v["display"], v["color"]))
    print("[npc] healed(%s):" % ("base" if base else "vanilla"), v["display"], flush=True)

def summon_npc(v):
    if mode_of(v) == "stand":
        summon_stand(v)
    else:
        summon_villager(v)

def sync_villager_variant(v):
    """活村民的生物群系变体对齐（幂等）：与档案 biome 不一致时 data merge"""
    biome = v.get("biome")
    if not biome:
        return
    try:
        r = R.cmd("data get entity %s VillagerData.type" % sel(v))
        if ('minecraft:%s' % biome) not in r:
            R.cmd('data merge entity %s {VillagerData:{type:"minecraft:%s"}}' % (sel(v), biome))
            print("[npc] variant:", v["display"], "->", biome, flush=True)
    except Exception:
        R.s = None

def unleash_alive():
    """活村民解除 NoAI，开始自由生活（拴绳看护兜底）。人偶（盔甲架）无此概念，跳过。
    2026-08-22 造物主谕「正常 NPC 不要站桩」：不再区分 alive/ambient，全员解锁。"""
    for v in PROFILES:
        if mode_of(v) == "stand":
            continue
        try:
            R.cmd("data merge entity %s {NoAI:0b}" % sel(v))
            print("[npc] unleashed:", v["display"], flush=True)
        except Exception:
            R.s = None

def heal_npcs():
    # 2026-08-23 造物主拍板「A+B」：水平拉回阈值用全局 leash_radius(40) 放宽+软化，每 NPC 可配 radius 覆盖。
    radius = CFG.get("quests", {}).get("leash_radius", 40)
    for v in PROFILES:
        try:
            dedup_npc(v)
        except Exception:
            R.s = None
        pos = alive_pos(v)
        if pos is None:
            try:
                summon_npc(v)
            except Exception as e:
                print("[npc] heal err:", v["display"], e, flush=True)
                R.s = None
            continue
        # 接地自愈（2026-08-22）：以 spawn 为锚——高于锚 2+（爬屋顶/卡树冠）或低于锚 2.5+（掉坑）都拉回 spawn 地面
        try:
            sx, sy0, sz = int(v["spawn"][0]), int(v["spawn"][1]), int(v["spawn"][2])
            gy = ground_y(sx, sz, sy0)
            if pos[1] - gy > 2 or pos[1] - gy < -2.5:
                R.cmd("tp %s %d %d %d" % (sel(v), sx, gy, sz))
                print("[npc] ground:", v["display"], "y %.1f -> %d" % (pos[1], gy), flush=True)
        except Exception:
            R.s = None
        if mode_of(v) == "stand":
            continue  # 人偶不会走动，无需拴绳
        # 2026-08-23 造物主拍板「A+B」：全村放宽+软化——默认按全局 leash_radius(40)，
        # 每 NPC 档案可配 radius 覆盖（未配用全局）。村民在阈值内自由钓鱼/种菜，
        # 只在真离家太远(超阈值)或异常(爬顶/掉坑)时才拉回，尽量不打断生活。
        sync_villager_variant(v)
        x, y, z = v["spawn"]
        vrad = v.get("radius", radius)
        dx, dy, dz = pos[0] - x, pos[1] - y, pos[2] - z
        if dx * dx + dy * dy + dz * dz > vrad * vrad:
            R.cmd("tp %s %s %s %s" % (sel(v), x, y, z))
            print("[npc] leash:", v["display"], "pulled home from", pos, flush=True)
            feed_append({"kind": "event", "npc": v["display"], "text": "%s 离家太远，被世界看护拉回了铺子" % v["display"]})

# ---------- 日志 tail ----------
RE_CHAT = re.compile(r"<([A-Za-z0-9_\u4e00-\u9fff]{1,16})> (.+)")
RE_SAY = re.compile(r"\]: (?:\[Not Secure\] )?\[([A-Za-z0-9_\u4e00-\u9fff]{1,16})\] (.+)")
_last_heal = 0.0

def _decode_unicode_escapes(msg):
    if "\\u" in msg:
        try:
            return msg.encode("latin-1", "ignore").decode("unicode_escape")
        except Exception:
            return msg
    return msg

def parse_line(ln):
    m = RE_CHAT.search(ln)
    if m:
        return m.group(1), _decode_unicode_escapes(m.group(2))
    m = RE_SAY.search(ln)
    if m:
        return m.group(1), _decode_unicode_escapes(m.group(2))
    return None, None

def tail_forever():
    last_cd = {}
    f = open(LOG, "r", encoding="utf-8", errors="replace")
    f.seek(0, 2)
    print("[npc] engine v2 up, tailing", LOG, flush=True)
    while True:
        line = f.readline()
        if line:
            who, msg = parse_line(line)
            if who and msg:
                # VIP 让位（2026-08-23 造物主谕「让女神化身重点服务」）：VIP 真人旅人的
                # 公屏发言（尤其语音转文字）由女神独占处理，NPC 不接话——避免「牧羊女抢答、
                # 回些奇奇怪怪的话」盖过女神的看护。
                if who.lower() in VIP_LIST:
                    continue
                # 守护天使（sys_ 前缀，客户端陪玩）不接话（2026-08-23）：它走私语代主人上达，
                # 公屏偶发也不该被村民抢答。
                if who.lower().startswith("sys_"):
                    continue
                try:
                    v, replies = route(who, msg)
                except Exception as e:
                    print("[npc] route err:", e, flush=True)
                    v, replies = None, None
                if v:
                    now = time.time()
                    if now - last_cd.get(v["key"], 0) < COOLDOWN:
                        continue
                    last_cd[v["key"]] = now
                    print("[npc] %s -> %s: %r" % (who, v["display"], msg[:60]), flush=True)
                    feed_append({"kind": "player", "who": who, "npc": v["display"], "npcKey": v["key"], "text": msg[:200]})
                    villager_hmm(v, "ambient")
                    npc_pos = alive_pos(v)
                    for r in replies:
                        try:
                            # 2026-08-23 造物主谕：NPC 回应一律 msg 私聊（tellraw to=who），不刷公屏。
                            speak(v, r, to=who)
                            feed_append({"kind": "say", "npc": v["display"], "npcKey": v["key"],
                                         "npcPos": list(npc_pos) if npc_pos else None,
                                         "color": v.get("color", "white"), "to": who, "text": r[:300]})
                        except Exception as e:
                            print("[npc] speak err:", e, flush=True)
                            R.s = None
                        time.sleep(0.3)
            continue
        # EOF：委托日期翻转 + 村民看护（60s 节流，防 RCON 刷屏/竞态）+ 日志轮转
        global _last_heal
        now = time.time()
        if now - _last_heal >= 60:
            _last_heal = now
            try:
                quests_today()
            except Exception as e:
                print("[quest] regen err:", e, flush=True)
            try:
                sync_offers()  # 每日委托翻转/被 whisper 通道完成后柜台对齐
            except Exception as e:
                print("[offer] sync err:", e, flush=True)
            heal_npcs()
        try:
            # 轮转检测双信号（2026-08-20 修：日志轮转后旧句柄 stale 致聊天全失聪）
            #  ① size 回退：清空重写类轮转（新文件 size < 旧句柄已读位置）
            #  ② inode 漂移：重命名+新建类轮转（路径 stat 与句柄 fstat 的 file index 不一致）
            rotated = os.path.getsize(LOG) < f.tell()
            if not rotated:
                sp, sh = os.stat(LOG), os.fstat(f.fileno())
                rotated = (sp.st_ino != sh.st_ino)
            if rotated:
                f.close()
                f = open(LOG, "r", encoding="utf-8", errors="replace")
                f.seek(0, 2)
                print("[npc] log rotated, reopened", flush=True)
        except OSError:
            pass
        time.sleep(0.5)

# ---------- WHISPER-TRADE：耳语收件箱（世界进程 mc-god「交易：」分流写入）----------
# 链路：bot/真人 /msg Goddess 交易：岳山 给16煤 → 女神 whisper 分流 → 本文件 append
# → 本线程消费 → route(via="whisper") 正常结算（距离门照旧）→ tellraw 点对点回执。
INBOX = os.path.join(DATA, "npc-inbox.jsonl")

def inbox_loop():
    while not os.path.exists(INBOX):
        time.sleep(1.0)
    f = open(INBOX, "r", encoding="utf-8", errors="replace")
    f.seek(0, 2)  # 只消费启动之后的新消息
    print("[npc] inbox up, tailing", INBOX, flush=True)
    while True:
        line = f.readline()
        if line:
            try:
                rec = json.loads(line)
                who = rec.get("speaker", "")
                msg = rec.get("text", "")
                via = rec.get("via", "whisper")
            except Exception:
                continue
            if not who or not msg:
                continue
            try:
                v, replies = route(who, msg, via=via)
            except Exception as e:
                print("[npc] inbox route err:", e, flush=True)
                v, replies = None, None
            if v:
                # 点对点不刷屏，不吃公屏 COOLDOWN（bot 靠回执知道已结算，防重复交付重试）
                print("[npc] inbox %s -> %s: %r" % (who, v["display"], msg[:60]), flush=True)
                feed_append({"kind": "player", "who": who, "npc": v["display"], "npcKey": v["key"],
                             "text": msg[:200], "via": "whisper"})
                villager_hmm(v, "ambient")
                npc_pos = alive_pos(v)
                for r in replies:
                    try:
                        speak(v, r, to=who)
                        feed_append({"kind": "say", "npc": v["display"], "npcKey": v["key"],
                                     "npcPos": list(npc_pos) if npc_pos else None,
                                     "color": v.get("color", "white"), "to": who,
                                     "text": r[:300], "via": "whisper"})
                    except Exception as e:
                        print("[npc] inbox speak err:", e, flush=True)
                        R.s = None
                    time.sleep(0.3)
            continue
        # EOF：轮转检测（与 tail_forever 同款）
        try:
            if os.path.exists(INBOX) and os.path.getsize(INBOX) < f.tell():
                f.close()
                f = open(INBOX, "r", encoding="utf-8", errors="replace")
                f.seek(0, 2)
        except OSError:
            pass
        time.sleep(0.4)

# ---------- 技能书施法（2026-08-23 造物主谕：真人靠技能书一键施法） ----------
# settlementsfix mod 监听玩家右键 written_book（custom_data.skillbook=固定技能书 /
# custom_data.craftreq=空白造物卷合书）→ 写 spell-requests.jsonl → 本循环消费执行效果
# → tellraw 点对点回执（[女神] 口吻，不走公屏）。分级冷却（2026-08-23 定稿）：
# 照明 15s / 造物 30s / 圣愈 60s / 归乡 120s。造物卷白名单直给；超纲呈神裁量。
SPELL_REQ = os.path.join(DATA, "spell-requests.jsonl")
SPELL_COOLDOWNS = {"light": 15, "give": 30, "heal": 60, "home": 120}
# 造物卷白名单（2026-08-23 造物主拍板）：(玩家书写的中文名, MC id, 数量上限)
CRAFT_WHITELIST = [
    ("火把", "minecraft:torch", 16), ("面包", "minecraft:bread", 8), ("煤", "minecraft:coal", 8),
    ("原木", "minecraft:oak_log", 8), ("石头", "minecraft:stone", 8), ("圆石", "minecraft:cobblestone", 8),
    ("铁锭", "minecraft:iron_ingot", 4), ("金锭", "minecraft:gold_ingot", 2), ("小麦", "minecraft:wheat", 8),
    ("苹果", "minecraft:apple", 4), ("木棍", "minecraft:stick", 16), ("木板", "minecraft:oak_planks", 8),
]

def _spell_tell(to, text):
    tellraw([("[女神] ", "gold"), (text, "white")], to=to)

def _home_pos(name):
    """玩家重生点（床）；没睡过床 → 镇中心（出生点安全区中心）。"""
    try:
        out = R.cmd("data get entity %s SpawnX" % name)
        m = re.search(r"(\d+)", out or "")
        if m:
            x = int(m.group(1))
            y = int(re.search(r"(\d+)", R.cmd("data get entity %s SpawnY" % name) or "").group(1))
            z = int(re.search(r"(\d+)", R.cmd("data get entity %s SpawnZ" % name) or "").group(1))
            return x, y, z
    except Exception:
        pass
    return VILLAGE_CX, VILLAGE_CY, VILLAGE_CZ

_MAGIC_CACHE = {"t": 0.0, "learned": {}, "name2id": {}}

def _has_learned(username, skill_name):
    """玩家是否已学该法术（读 /mcdata/magic-state.json 只读快照 + atoms 名→id 映射）。
    文件读不出来/名字对不上 → 返回 False（宁可多发一条『参悟』，mc-god 会幂等处理）。"""
    import time as _t, json as _j
    now = _t.time()
    if now - _MAGIC_CACHE["t"] > 20:  # 20s 缓存
        try:
            st = _j.load(open("/mcdata/magic-state.json", encoding="utf-8"))
            _MAGIC_CACHE["learned"] = {u: [str(x) for x in (p.get("learned") or [])]
                                       for u, p in (st.get("players") or {}).items()}
            at = _j.load(open("/mcdata/magic-atoms.json", encoding="utf-8"))
            _MAGIC_CACHE["name2id"] = {a.get("name", ""): a.get("id", "") for a in at.get("atoms", [])}
            _MAGIC_CACHE["t"] = now
        except Exception as e:
            print("[spell] magic cache err:", e, flush=True)
    ids = _MAGIC_CACHE["learned"].get(username) or []
    if not ids:
        return False
    atom_id = _MAGIC_CACHE["name2id"].get(skill_name, "")
    if atom_id:
        return atom_id in ids
    return skill_name in ids  # 兜底：直接按名字对 id


def _exec_fixed_skill(speaker, skill):
    """执行固定技能书效果（与快路径法术口径一致）。返回回执文本。"""
    try:
        if skill == "home":
            x, y, z = _home_pos(speaker)
            R.cmd("tp %s %d %d %d" % (speaker, x, y, z))
            return "空间之力涌动，你被送回基地。"
        if skill == "heal":
            R.cmd("effect give %s minecraft:instant_health 1 1" % speaker)
            R.cmd("effect give %s minecraft:saturation 1 20" % speaker)
            return "圣光抚过伤口，伤痛与饥饿一同消散。"
        if skill == "light":
            R.cmd("give %s minecraft:torch 4" % speaker)
            return "几根火把落入你的手中，照亮前路。"
        if skill == "give":
            R.cmd("give %s minecraft:bread 2" % speaker)
            return "两片面包自虚空中凝聚，落入你的手中。"
        return None  # 非固定四技 → 走 /mycli cast 通道（2026-08-29：✦法术书右键=任意已学法术）
    except Exception as e:
        print("[spell] exec err:", e, flush=True)
        R.s = None
        return "施法途中天地阻隔，稍后再试。"

def _match_craft(text):
    """造物卷：文本含白名单物品名 → (id, count)；超纲 → None。"""
    for cn, mid, maxc in CRAFT_WHITELIST:
        if cn in text:
            return mid, maxc
    return None

def spell_loop():
    """消费 spell-requests.jsonl（mod 技能书右键请求），分级冷却，tellraw 点对点回执。"""
    cooldown = {}  # (speaker, skill) -> ts
    while not os.path.exists(SPELL_REQ):
        time.sleep(1.0)
    f = open(SPELL_REQ, "r", encoding="utf-8", errors="replace")
    f.seek(0, 2)
    print("[spell] spell loop up, tailing", SPELL_REQ, flush=True)
    while True:
        line = f.readline()
        if line:
            try:
                rec = json.loads(line)
                speaker = str(rec.get("speaker", "")).strip()
            except Exception:
                continue
            if not speaker:
                continue
            skill = str(rec.get("skill", "") or "").strip()
            text = str(rec.get("text", "") or "").strip()
            now = time.time()
            # 冷却判定
            cd_key = (speaker, skill or "craft")
            last = cooldown.get(cd_key, 0)
            cd = SPELL_COOLDOWNS.get(skill, 30 if not skill else 0)
            if now - last < cd:
                wait = int(cd - (now - last))
                _spell_tell(speaker, "卷轴的灵光尚在回蓄（约 %d 秒后再试）。" % wait)
                print("[spell] %s %s 冷却中 %ds" % (speaker, skill or text[:20], wait), flush=True)
                continue
            if skill:
                # 固定技能书
                reply = _exec_fixed_skill(speaker, skill)
                if reply is None:
                    # ✦法术书（任意已学法术）：以玩家身份走 /mycli cast——法力/等级/冷却
                    # 全由法术引擎裁定，回执由引擎 tellraw 给玩家本人（2026-08-29）。
                    # 2026-08-29 造物主设计「野外书用一次自动收录」：未学的技能，
                    # 先 /mycli 参悟（learn 校验书在手=历练凭证）再 cast——
                    # 拿着野外的书右键一次 = 参悟入册 + 施放，一步到位。
                    if not _has_learned(speaker, skill):
                        try:
                            R.cmd("execute as %s at @s run mycli 参悟 %s" % (speaker, skill))
                            time.sleep(0.8)  # 等 mc-god 入册（书在手必成）
                        except Exception as e:
                            print("[spell] learn err:", e, flush=True)
                    R.cmd("execute as %s at @s run mycli cast %s" % (speaker, skill))
                    cooldown[cd_key] = now  # 外层仅记时（引擎另有法力门槛）
                    feed_append({"kind": "spell", "who": speaker, "skill": skill, "text": "✦法术书→mycli cast"})
                    print("[spell] %s ✦法术书 cast %s" % (speaker, skill), flush=True)
                    continue
                cooldown[cd_key] = now
                _spell_tell(speaker, reply)
                feed_append({"kind": "spell", "who": speaker, "skill": skill, "text": reply[:200]})
                print("[spell] %s 技能书 %s → %s" % (speaker, skill, reply), flush=True)
            else:
                # 空白造物卷（玩家自写书页全文）
                m = _match_craft(text)
                if m:
                    mid, maxc = m
                    R.cmd("give %s %s %d" % (speaker, mid, maxc))
                    cooldown[cd_key] = now
                    reply = "一件物资自虚空中凝聚，落入你的手中。"
                    _spell_tell(speaker, reply)
                    feed_append({"kind": "spell", "who": speaker, "skill": "craft", "item": mid, "text": reply[:200]})
                    print("[spell] %s 造物 %s x%d" % (speaker, mid, maxc), flush=True)
                else:
                    # 超纲 → 呈神裁量（god-inbox asPlayer=true：走玩家祈愿路径，神谕 whisper 回）
                    _god_append(GOD_INBOX, {
                        "key": speaker, "wish": "造物卷求「%s」" % text[:120],
                        "display": speaker, "asPlayer": True,
                        "situation": "空白造物卷超纲请求（白名单外物资）", "ts": int(now * 1000),
                    })
                    _spell_tell(speaker, "此物不在卷轴白名单内，你的请求已上达天听，女神按序裁断。")
                    print("[spell] %s 造物超纲 → 呈神: %s" % (speaker, text[:60]), flush=True)
            continue
        # EOF：轮转检测
        try:
            if os.path.exists(SPELL_REQ) and os.path.getsize(SPELL_REQ) < f.tell():
                f.close()
                f = open(SPELL_REQ, "r", encoding="utf-8", errors="replace")
                f.seek(0, 2)
        except OSError:
            pass
        time.sleep(0.4)

# ================= 背景村民日记（2026-08-18：环境生命感——他们在过自己的日子） =================
AMBIENT = [v for v in PROFILES if v.get("ambient")]
_diary_day = None

def diary_path(day):
    return os.path.join(VDIR, "diary-%s.jsonl" % day)

def _diary_line(v, pos):
    if pos is None:
        return random.choice(["不知去向，八成躲哪儿歇着了", "没见着人影", "出门去了吧"])
    x, _, z = v["spawn"]
    d2 = (pos[0] - x) ** 2 + (pos[2] - z) ** 2
    hh = int(time.strftime("%H"))
    if hh >= 21 or hh < 6:
        return random.choice(["早早歇下了", "梦里还在忙活", "睡得正香"])
    if d2 <= 64:
        return random.choice(["在老地方张望", "打点自己的营生", "蹲在门口歇脚", "正跟路过的虫子较劲"])
    if d2 <= 625:
        return random.choice(["在村里溜达", "串门去了", "凑热闹看稀奇", "赶集似的瞎转悠"])
    return random.choice(["走得老远，怕是迷路了", "出远门了，说是散心", "沿着大路走远了"])

def ambient_diary_loop():
    """每 30 分钟采样背景村民动向 → data/village/diary-YYYY-MM-DD.jsonl；
    跨日首检 → 女神公告昨日村庄一景（零 LLM 模板合成）。"""
    global _diary_day
    interval = CFG.get("ambient", {}).get("diary_interval", 1800)
    while True:
        try:
            today = time.strftime("%Y-%m-%d")
            if _diary_day is not None and today != _diary_day:
                try:
                    ypath = diary_path(_diary_day)
                    if os.path.exists(ypath):
                        recs = [json.loads(x) for x in open(ypath, encoding="utf-8") if x.strip()]
                        acts = {}
                        for r in recs:
                            acts.setdefault(r.get("npc", "?"), []).append(r.get("act", ""))
                        if acts:
                            parts = []
                            for name, a in list(acts.items())[:4]:
                                short = name.split("·")[-1]
                                parts.append("%s%s" % (short, random.choice(a) if a else "过着平常一天"))
                            goddess("晨光落在千灯纪——昨日村里：%s。日子就这么淌着，挺好。" % "，".join(parts))
                except Exception as e:
                    print("[diary] day-flip err:", e, flush=True)
            _diary_day = today
            with open(diary_path(today), "a", encoding="utf-8") as f:
                for v in AMBIENT:
                    pos = alive_pos(v)
                    act = _diary_line(v, pos)
                    f.write(json.dumps({"ts": time.strftime("%H:%M"), "npc": v["display"],
                                        "act": act, "pos": list(pos) if pos else None},
                                       ensure_ascii=False) + "\n")
            print("[diary] sampled %d ambient villagers" % len(AMBIENT), flush=True)
        except Exception as e:
            print("[diary] err:", e, flush=True)
            R.s = None
        time.sleep(interval)

# ---------- 村民自主技能（2026-08-20 造物主谕：村民可以自主做事） ----------
# villagers.json 每人可选 routines: [{"phase":"dawn|day|dusk|night","act":"hawk|work|light|rest","line":"…"}]
# 进入新时辰阶段时触发一次：hawk=吆喝(speak) work=干活粒子 light=点灯粒子 rest=歇息台词。
# 零 LLM、纯 RCON + 台词，与灶火祭司通道（闲聊）正交。
def _phase_of(ticks):
    """MC daytime(0..24000) → dawn/day/dusk/night。"""
    if ticks >= 23000 or ticks < 2000:
        return "dawn"
    if ticks < 11000:
        return "day"
    if ticks < 13000:
        return "dusk"
    return "night"

def _do_routine(v, r):
    pos = alive_pos(v)
    if not pos:
        return
    act, line = r.get("act", ""), r.get("line", "")
    try:
        if act in ("work", "light"):
            p = "minecraft:end_rod" if act == "light" else random.choice(
                ["minecraft:flame", "minecraft:happy_villager", "minecraft:note"])
            R.cmd("particle %s %.1f %.1f %.1f 0.3 0.4 0.3 0 6" % (p, pos[0], pos[1] + 1.2, pos[2]))
        if line:
            # 2026-08-23 造物主谕：闲话只私聊给在场的最近玩家，没人就不说（不刷公屏）。
            to = nearest_player(pos)
            if to:
                speak(v, line, to=to)
    except Exception as e:
        print("[routine] err %s: %s" % (v.get("key"), e), flush=True)
    feed_append({"kind": "routine", "npc": v["display"], "text": "%s·%s" % (r.get("phase"), act or "say")})

def routine_loop():
    """每 90s 查 MC 时间 → 阶段切换时触发对应村民 routine（每人每阶段至多一次）。"""
    fired = {}  # (villager_key, phase) -> True
    while True:
        try:
            out = R.cmd("time query daytime")
            m = re.search(r"(\d+)", out or "")
            if m:
                phase = _phase_of(int(m.group(1)))
                for v in PROFILES:
                    if not v.get("alive"):
                        continue
                    for r in (v.get("routines") or []):
                        if r.get("phase") == phase and (v["key"], phase) not in fired:
                            fired[(v["key"], phase)] = True
                            _do_routine(v, r)
                # 清理旧阶段标记，防止跨日内存增长
                for k in [k for k in fired if k[1] != phase]:
                    del fired[k]
        except Exception as e:
            print("[routine] loop err:", e, flush=True)
            R.s = None
        time.sleep(CFG.get("routine_interval", 90))

# ---------- 村民空闲"嗯嗯"声（2026-08-23 造物主谕：村民主动发声音，更有代入感） ----------
def villager_ambient_loop():
    """随机间隔选一个在世村民发 ambient"嗯嗯"声；有玩家在 20 格内才发（没人就不对空气嗯嗯）。
    playsound 自带距离门，远处玩家听不到。"""
    lo, hi = CFG.get("ambient", {}).get("hmm_interval", [20, 45])
    while True:
        time.sleep(random.uniform(lo, hi))
        try:
            alive = [v for v in PROFILES if v.get("alive", True)]
            if not alive:
                continue
            v = random.choice(alive)
            pos = alive_pos(v)
            if pos and nearest_player(pos, maxd=20):
                villager_hmm(v, "ambient", pitch=random.uniform(0.9, 1.15))
        except Exception as e:
            print("[hmm] err:", e, flush=True)
            R.s = None

# ---------- 村庄守护 / 出生点安全区（2026-08-22 造物主谕：NPC 秒怪；初始城堡附近无怪） ----------
# 铁匠/甲匠/守夜人/渔夫/阿宝是有战力设定的村民：发现怪物进村即秒杀，公屏喊话。
# 白天低频清理（洞穴蜘蛛等），夜间每 8s 一轮。RCON 距离以 positioned 定原点。
VILLAGE_CX, VILLAGE_CZ, VILLAGE_CY = 3094, -1338, 68   # 出生点（初始城堡）中心（level.dat SpawnX/Z）
VILLAGE_RADIUS = 64                                    # 安全区半径（覆盖城堡建筑群）
# 1.21 选择器不支持多 type=（报 Option 'type' isn't applicable here），改排除法：
# 村庄半径内"非无害实体"一律当敌清除（= 敌对 + 未知 mod 生物）。
SAFE_TYPES = ["minecraft:player", "minecraft:villager", "settlements:base_villager", "minecraft:item",
              "minecraft:armor_stand", "minecraft:item_frame", "minecraft:glow_item_frame", "minecraft:painting",
              "minecraft:cow", "minecraft:sheep", "minecraft:pig", "minecraft:chicken",
              "minecraft:horse", "minecraft:donkey", "minecraft:mule", "minecraft:cat", "minecraft:wolf",
              "minecraft:fox", "minecraft:rabbit", "minecraft:iron_golem", "minecraft:snow_golem",
              "minecraft:salmon", "minecraft:cod", "minecraft:pufferfish", "minecraft:tropical_fish",
              "minecraft:bat", "minecraft:parrot", "minecraft:llama", "minecraft:trader_llama",
              "minecraft:wandering_trader", "minecraft:minecart", "minecraft:chest_minecart",
              "minecraft:hopper_minecart", "minecraft:boat", "minecraft:arrow", "minecraft:trident",
              "minecraft:snowball", "minecraft:experience_orb", "minecraft:marker", "minecraft:interaction",
              "minecraft:leash_knot", "minecraft:area_effect_cloud", "minecraft:fishing_bobber",
              "minecraft:egg", "minecraft:ender_pearl", "minecraft:lightning_bolt"]
HOSTILE_SEL = ",".join("type=!" + t for t in SAFE_TYPES)
GUARD_KEYS = ["zhujiu", "yueshan", "shilei", "langbo", "abao"]
GUARD_LINES = {
    "yueshan": ["哪来的杂碎，敢闯我的村子！", "铁锤在这，怪物退散！", "敢碰我的炉子，先问过这把锤！"],
    "shilei": ["……找死。", "甲胄护村，怪物滚。", "铠甲不护外敌。"],
    "zhujiu": ["夜里的规矩，我说了算。", "敢扰村民安眠？", "守夜人的刀，不挑时辰。"],
    "langbo": ["湖里的鱼我护着，村里的地也是！", "滚回你的暗处去！", "老头我年轻时，一鱼叉一个！"],
    "abao": ["阿宝力气大，揍你！", "不许欺负村里人！", "嘿！吃阿宝一拳！"],
}

def _pick_guard():
    # 2026-08-22 修复：随机选在世守卫（旧版固定取第一个=守夜人，夜里清怪时他一人刷屏）
    alive = [x for x in PROFILES if x.get("key") in GUARD_KEYS]
    if not alive:
        return None
    return random.choice(alive)

def village_watch_loop():
    """村庄守护：扫描村庄半径内敌对生物 → 守卫喊话 + 秒杀。零 LLM。"""
    try:
        _locked_cmd("scoreboard objectives add npc_guard dummy")  # 幂等
    except Exception:
        pass
    had = False
    last_shout = 0.0  # 守卫喊话全局冷却（2026-08-22：防夜里清怪每轮喊一次刷屏）
    while True:
        try:
            time.sleep(8)
            sel = "@e[distance=..%d,%s]" % (VILLAGE_RADIUS, HOSTILE_SEL)
            _locked_cmd("execute positioned %d %d %d store result score #g_mobs npc_guard if entity %s"
                        % (VILLAGE_CX, VILLAGE_CY, VILLAGE_CZ, sel))
            out = _locked_cmd("scoreboard players get #g_mobs npc_guard")
            m = re.search(r"(\d+)", out or "")
            n = int(m.group(1)) if m else 0
            now = time.time()
            if n > 0:
                if not had and now - last_shout > 60:
                    v = _pick_guard()
                    if v:
                        line = random.choice(GUARD_LINES.get(v["key"], GUARD_LINES["zhujiu"]))
                        # 2026-08-23 造物主谕：守卫喊话只私聊给村内在场玩家，没人就不喊。
                        to = nearest_player((VILLAGE_CX, VILLAGE_CY, VILLAGE_CZ), maxd=VILLAGE_RADIUS)
                        try:
                            if to:
                                speak(v, line, to=to)
                            feed_append({"kind": "say", "npc": v["display"], "to": to, "text": line})
                        except Exception:
                            pass
                    last_shout = now
                _locked_cmd("execute positioned %d %d %d as %s run kill @s"
                            % (VILLAGE_CX, VILLAGE_CY, VILLAGE_CZ, sel))
                had = True
            else:
                had = False
        except Exception as e:
            print("[guard] err:", e, flush=True)
            R.s = None
            time.sleep(5)

# ---------- 靠近搭话（2026-08-22 造物主谕：NPC 要像 RPG 一样跟玩家说话） ----------
# 玩家走进 NPC 身边（≤3.5 格）→ NPC 蹦出今日想法/话题/问候（点对点 tellraw，不刷全村屏）。
# 每 NPC × 每玩家冷却 240s；内容池：topics 模板 > greet > fallback（零 LLM，与灶火祭司闲聊正交）。
PROX_RADIUS = 3.5
PROX_COOLDOWN = 300  # 2026-08-29 算力再分配：240→300，近距模板闲聊也降频
EXCLUDE_PROX = {"Goddess", "Kirito", "Naruto", "Edward", "桐人", "鸣人", "爱德华", "Steve", "Alex", "史蒂夫", "艾利克斯", "RenderBot", "ProbeBot"}
# VIP 重点看护名单（与 mc-god.ts 的 MC_VIP_LISTEN 对齐）：VIP 真人旅人的公屏发言
# 由女神独占处理，NPC 不接话（2026-08-23 造物主谕「让女神化身重点服务」，勿让牧羊女抢答）。
VIP_LIST = {n.strip().lower() for n in os.environ.get("MC_VIP_LISTEN", "").split(",") if n.strip()}

def _prox_lines(v):
    pool = []
    for t in (v.get("topics") or []):
        pool.extend(t.get("lines", []))
    if pool:
        return random.choice(pool)
    return v.get("greet") or "（朝你点点头）今天也辛苦啦。"

def proximity_chat_loop():
    last = {}  # (vkey, player) -> ts
    while True:
        try:
            out = R.cmd("list")
            m = re.search(r"online \(.*?\):\s*(.*)$", out or "", re.S)
            names = [n.strip() for n in m.group(1).split(",") if n.strip()] if m else []
            names = [n for n in names if n not in EXCLUDE_PROX]
            if names:
                for p in names:
                    pp = player_pos(p)
                    if not pp:
                        continue
                    for v in PROFILES:
                        key = (v["key"], p)
                        now = time.time()
                        if now - last.get(key, 0) < PROX_COOLDOWN:
                            continue
                        vp = alive_pos(v)
                        if not vp:
                            continue
                        dx, dy, dz = pp[0] - vp[0], pp[1] - vp[1], pp[2] - vp[2]
                        if dx * dx + dy * dy + dz * dz <= PROX_RADIUS * PROX_RADIUS:
                            last[key] = now
                            line = _prox_lines(v)
                            try:
                                speak(v, line, to=p)
                                feed_append({"kind": "say", "npc": v["display"], "npcKey": v["key"],
                                             "npcPos": list(vp), "color": v.get("color", "white"),
                                             "to": p, "text": line[:300], "via": "proximity"})
                            except Exception as e:
                                print("[prox] speak err:", e, flush=True)
                                R.s = None
        except Exception as e:
            print("[prox] err:", e, flush=True)
            R.s = None
        time.sleep(8)

if __name__ == "__main__":
    R.connect()
    threading.Thread(target=inbox_loop, daemon=True).start()
    threading.Thread(target=routine_loop, daemon=True).start()
    threading.Thread(target=watch_offers, daemon=True).start()
    threading.Thread(target=prayer_loop, daemon=True).start()
    threading.Thread(target=god_reply_loop, daemon=True).start()
    threading.Thread(target=village_watch_loop, daemon=True).start()
    threading.Thread(target=proximity_chat_loop, daemon=True).start()
    threading.Thread(target=interact_tail_loop, daemon=True).start()
    threading.Thread(target=spell_loop, daemon=True).start()
    threading.Thread(target=villager_ambient_loop, daemon=True).start()
    if AMBIENT:
        threading.Thread(target=ambient_diary_loop, daemon=True).start()
        print("[npc] ambient diary armed: %d villagers" % len(AMBIENT), flush=True)
    print("[npc] rcon auth ok", flush=True)
    try:
        qd = quests_today()
        print("[npc] quests today:", len(qd["quests"]), flush=True)
    except Exception as e:
        print("[npc] quest init err:", e, flush=True)
    try:
        sync_offers()
    except Exception as e:
        print("[offer] boot sync err:", e, flush=True)
    try:
        unleash_alive()
    except Exception as e:
        print("[npc] unleash err:", e, flush=True)
    try:
        import mc_guild
        mc_guild.start()
    except Exception as e:
        print("[guild] boot err:", e, flush=True)
    try:
        tail_forever()
    except KeyboardInterrupt:
        pass
