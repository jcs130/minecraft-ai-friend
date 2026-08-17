# -*- coding: utf-8 -*-
"""
mc_npc.py v2 — 初始之地村民引擎（数据驱动 + 每日委托经济 + LLM 预留接口）
架构（参考 Stanford Generative Agents / AI-Villgers / Wanderfolk 的轻量本地化）：
  - 村民档案外置 data/village/villagers.json（人格/背景/话题/委托模板/回家锚点）
  - 每日委托：模板池按日随机生成 quests-YYYY-MM-DD.json，聊天交付（/clear 收货 + /give 绿宝石）
  - LLM 接口预留：config.llm.enabled=true 时兜底闲聊走本地 OpenAI 兼容端点，模板优先
  - 村民看护：tag 选择器存活检查 + 自愈重招（1.21.5+ 组件语法）+ 活村民拴绳看护
1.21.11 铁律：
  - CustomName 必须用 SNBT 复合体 {text:...,color:...}，旧 JSON 字符串会存成字面文本
  - RCON 对 `execute if ... run say` 的响应恒为空，存活检查必须用 `data get ... Pos`
"""
import socket, struct, os, re, json, time, io, sys, random, urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# 路径/RCON 全部支持环境变量覆盖（部署脚本用）；默认值保持本机布局。
WORK = os.environ.get("NPC_DATA_DIR") or r"C:\Users\lzl19\.copaw\workspaces\default"
DATA = os.path.join(WORK, "deepseek-harness", "scratch-plugin", "data") if not os.environ.get("NPC_DATA_DIR") else WORK
VDIR = os.path.join(DATA, "village")
LOG = os.environ.get("NPC_LOG_PATH") or r"C:\Users\lzl19\Documents\airi-minecraft\server\logs\latest.log"
HOST = os.environ.get("MC_RCON_HOST", "127.0.0.1")
PORT = int(os.environ.get("MC_RCON_PORT", "25575"))
COOLDOWN = 3.0

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
    return "stand" if v["key"] in SKIN_REG else "villager"

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
        rp(self.s)
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

def tellraw(parts, color="white"):
    seg = ",".join('{"text":"%s","color":"%s"}' % (esc(t), c) for t, c in parts)
    R.cmd("tellraw @a [" + seg + "]")

def esc(t):
    out = []
    for ch in t:
        o = ord(ch)
        out.append(ch if 32 <= o < 127 and ch not in '"\\' else "\\u%04x" % o)
    return "".join(out)

def speak(v, text):
    tellraw([("<" + v["display"] + "> ", v["color"]), (text, "white")])

def goddess(text):
    tellraw([("[女神] ", "gold"), (text, "gold")])

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
}

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
        t = random.choice(v["quests"])
        quests.append({
            "id": "%s-%s" % (v["key"], day), "villager": v["key"], "display": v["display"],
            "item": t["item"], "zh": t["zh"], "count": t["count"],
            "emerald": t.get("emerald", 0), "effect": t.get("effect"), "lore_atom": t.get("lore_atom", False),
            "done": False, "done_by": None, "done_at": None,
        })
    doc = {"date": day, "quests": quests}
    json.dump(doc, open(quests_path(day), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("[quest] generated %d quests for %s: %s" % (len(quests), day, [q["display"] for q in quests]), flush=True)
    return doc

QUESTS = {"date": None, "doc": None}

def quests_today():
    day = time.strftime("%Y-%m-%d")
    if QUESTS["date"] == day and QUESTS["doc"]:
        return QUESTS["doc"]
    p = quests_path(day)
    if os.path.exists(p):
        doc = json.load(open(p, encoding="utf-8"))
    else:
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
    ln = v.get("quest_pitch", "帮我凑 {count} 个{zh}，酬 {emerald} 绿宝石。").replace("{count}", str(q["count"])).replace("{zh}", q["zh"]).replace("{emerald}", str(q["emerald"]))
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
    json.dump(QUESTS["doc"], open(quests_path(QUESTS["date"]), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ledger_append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "date": QUESTS["date"], "villager": q["display"],
                   "player": speaker, "item": q["item"], "count": q["count"], "reward": ",".join(reward_desc) or "无"})
    chronicle_append("集市｜%s 替 %s 办成今日委托（%d %s → %s）" % (speaker, q["display"], q["count"], q["zh"], "、".join(reward_desc) or "谢意"))
    feed_append({"kind": "event", "npc": q["display"], "text": "%s 办成了 %s 的委托（%d %s → %s）" % (speaker, q["display"], q["count"], q["zh"], "、".join(reward_desc) or "谢意")})
    try:
        goddess("%s 办成了 %s 的今日委托。（编年史已记）" % (speaker, q["display"]))
    except Exception:
        pass
    print("[quest] DONE %s -> %s: %s" % (speaker, q["display"], q["zh"]), flush=True)
    return lines

# ---------- LLM 接口（预留，默认关闭） ----------
def llm_reply(v, speaker, msg, ctx):
    llm = CFG.get("llm", {})
    if not llm.get("enabled"):
        return None
    sysp = ("你是%s，Minecraft世界「初始之地」集市的村民。人设：%s 背景：%s %s 目前在线：%s。"
            "请以人设口吻用中文回答，不超过两句话，不要出戏，不要提到游戏机制之外的现实。") % (
        v["display"], v.get("persona", ""), " ".join(v.get("backstory", [])[:1]), quest_summary(v), ctx.get("online", "?"))
    body = json.dumps({
        "model": llm.get("model", "qwen3.8-27b"),
        "messages": [{"role": "system", "content": sysp},
                     {"role": "user", "content": "%s 对你说：%s" % (speaker, msg)}],
        "max_tokens": llm.get("max_tokens", 200),
        "temperature": llm.get("temperature", 0.7),
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

# ---------- 路由 ----------
GREET = ["你好", "哈喽", "hello", "hi", "在吗", "见过", "幸会", "您好"]
QUEST_KW = ["任务", "委托", "帮忙", "活儿", "活计", "差事", "酬劳"]
RE_GIVE = re.compile(r"^(?:给|交给|交付|交)\s*(\d+)\s*(\S+)$")
LAST_TALK = {}  # speaker -> (villager_key, ts)

def route(speaker, msg):
    hit_v, rest = None, msg
    for v in PROFILES:
        hits = [c for c in v["calls"] if c in msg]
        if hits:
            hit_v = v
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
            return None, None
    LAST_TALK[speaker] = (hit_v["key"], time.time())
    if any(w in rest for w in GREET) and len(rest) <= 6:
        return hit_v, [hit_v["greet"]]
    m = RE_GIVE.match(rest)
    if m:
        return hit_v, turn_in(speaker, hit_v, int(m.group(1)), m.group(2))
    if any(w in rest for w in QUEST_KW):
        return hit_v, pitch_quest(hit_v)
    ctx = world_ctx()
    for t in hit_v.get("topics", []):
        if any(w in rest for w in t["kw"]):
            return hit_v, resolve_lines(t["lines"], ctx)
    # 兜底：LLM（若启用）或 fallback 台词
    if CFG.get("llm", {}).get("enabled") and not CFG.get("llm", {}).get("template_first"):
        lines = llm_reply(hit_v, speaker, msg, ctx)
        if lines:
            return hit_v, lines
    return hit_v, [hit_v["fallback"]]

# ---------- 村民看护（tag 选择器 + 组件语法） ----------
def sel(v):
    etype = "armor_stand" if mode_of(v) == "stand" else "villager"
    return '@e[type=%s,tag=%s,limit=1]' % (etype, v["tag"])

def dedup_npc(v):
    """防堆积：同 tag 实体 >1 时只保留一个（多进程竞召/服务器重启竞态的历史教训）。
    幂等三连：标记保留者 → 杀未标记 → 摘标记。"""
    etype = "armor_stand" if mode_of(v) == "stand" else "villager"
    R.cmd("tag %s add npcKeep" % sel(v))
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

def _pose_nbt(pose):
    parts = []
    for k, ang in pose.items():
        vals = ",".join("%sf" % a for a in ang)
        parts.append('%s:[%s]' % (k, vals))
    return "Pose:{%s}" % ",".join(parts)

def _leather(item, rgb):
    return ('{id:"minecraft:%s",count:1,components:{"minecraft:dyed_color":'
            '{rgb:%d,show_in_tooltip:false}}}' % (item, rgb))

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
    R.cmd("summon minecraft:armor_stand %s %s %s %s" % (x, y, z, nbt))
    print("[npc] healed(stand):", v["display"], flush=True)

def summon_villager(v):
    biome = v.get("biome", "plains")
    nbt = ('{NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,Silent:1b,Tags:["%s"],'
           'CustomName:{text:"%s",color:"%s"},CustomNameVisible:1b,'
           'VillagerData:{profession:"minecraft:%s",level:4,type:"minecraft:%s"}}') % (
        v["tag"], v["display"], v["color"], v["profession"], biome)
    x, y, z = v["spawn"]
    R.cmd("summon minecraft:villager %s %s %s %s" % (x, y, z, nbt))
    print("[npc] healed:", v["display"], flush=True)

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
    """活村民解除 NoAI，开始自由生活（拴绳看护兜底）。人偶（盔甲架）无此概念，跳过。"""
    for v in PROFILES:
        if not v.get("alive") or mode_of(v) == "stand":
            continue
        try:
            R.cmd("data merge entity %s {NoAI:0b}" % sel(v))
            print("[npc] unleashed:", v["display"], flush=True)
        except Exception:
            R.s = None

def heal_npcs():
    radius = CFG.get("quests", {}).get("leash_radius", 28)
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
        if mode_of(v) == "stand":
            continue  # 人偶不会走动，无需拴绳
        if v.get("alive"):
            sync_villager_variant(v)
            x, y, z = v["spawn"]
            dx, dy, dz = pos[0] - x, pos[1] - y, pos[2] - z
            if dx * dx + dy * dy + dz * dz > radius * radius:
                R.cmd("tp %s %s %s %s" % (sel(v), x, y, z))
                print("[npc] leash:", v["display"], "pulled home from", pos, flush=True)
                feed_append({"kind": "event", "npc": v["display"], "text": "%s 离家太远，被世界看护拉回了广场" % v["display"]})

# ---------- 日志 tail ----------
RE_CHAT = re.compile(r"<([A-Za-z0-9_]{1,16})> (.+)")
RE_SAY = re.compile(r"\]: (?:\[Not Secure\] )?\[([A-Za-z0-9_]{1,16})\] (.+)")
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
                    npc_pos = alive_pos(v)
                    for r in replies:
                        try:
                            speak(v, r)
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
            heal_npcs()
        try:
            if os.path.getsize(LOG) < f.tell():
                f.close()
                f = open(LOG, "r", encoding="utf-8", errors="replace")
                print("[npc] log rotated, reopened", flush=True)
        except OSError:
            pass
        time.sleep(0.5)

if __name__ == "__main__":
    R.connect()
    print("[npc] rcon auth ok", flush=True)
    try:
        qd = quests_today()
        print("[npc] quests today:", len(qd["quests"]), flush=True)
    except Exception as e:
        print("[npc] quest init err:", e, flush=True)
    try:
        unleash_alive()
    except Exception as e:
        print("[npc] unleash err:", e, flush=True)
    try:
        tail_forever()
    except KeyboardInterrupt:
        pass
