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
if __name__ == "__main__":
    sys.modules["mc_npc"] = sys.modules["__main__"]  # mc_guild 会 `import mc_npc`——注册别名复用本实例，防止整个文件被二次执行（二次执行的 line20 重包 stdout 会 GC-close 掉 fd1，guild 首个 print 必炸）

# 路径/RCON 全部支持环境变量覆盖（部署脚本用）；默认值保持本机布局。
WORK = os.environ.get("NPC_DATA_DIR") or r"C:\Users\lzl19\.copaw\workspaces\default"
DATA = os.path.join(WORK, "deepseek-harness", "scratch-plugin", "data") if not os.environ.get("NPC_DATA_DIR") else WORK
VDIR = os.path.join(DATA, "village")
LOG = os.environ.get("NPC_LOG_PATH") or os.path.join(DATA, "..", "mc-server-neoforge", "logs", "latest.log")
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
        recipes.append('{buy:{id:"minecraft:emerald",count:%d},sell:{id:"minecraft:%s",count:%d},'
                       'uses:0,maxUses:%d,discountCounter:0,specialPrice:0,demand:0,'
                       'priceMultiplier:0.0f,rewardExp:0b}' % (
                           int(s.get("emerald", 1)), s["item"], int(s.get("count", 1)), int(s.get("max", 12))))
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
        pre = ""
        if recall:
            pre = "（你想起先前的事：%s）\n" % "；".join(
                "%s问过「%s」你答「%s」" % (r.get("speaker", "有人"), (r.get("q") or "")[:20], (r.get("a") or "")[:16])
                for r in recall)
        text = "%s%s 对你说：%s" % (pre, speaker, msg)
    else:
        _SEEDED.add(sid)
        skill = _skill_card(v["key"])
        sysp = ("你就是%s本人——千灯界集市的村民。人设：%s 背景：%s %s 目前在线：%s。"
                "以你的口吻用中文回话，不超过两句话；不出戏、不提游戏机制之外的事；"
                "你不是女神也不是祭司；除了你自己这条记忆线里的事，别的村民与旅人聊过什么你一概不知。%s") % (
            v["display"], v.get("persona", ""), " ".join(v.get("backstory", [])[:1]), quest_summary(v),
            ctx.get("online", "?"), ("\n你的心得手记（熟稔之事）：\n" + skill) if skill else "")
        text = "%s\n\n%s 对你说：%s" % (sysp, speaker, msg)
    body = json.dumps({
        "channel": "console",
        "user_id": "npc-" + v["key"],
        "session_id": sid,
        "input": [{"role": "user", "content": [
            {"type": "text", "text": text}]}],
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
                df.write("session=%s user=%s\n" % (v["key"], speaker))
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
        answer = answer.strip().split("</think>")[-1].strip()
        lines = [x for x in answer.splitlines() if x.strip()][:2]
        if lines:
            _traj_append(v["key"], speaker, msg, lines[0])
        return lines or None
    except Exception as e:
        print("[npc-agent] fallback:", e, flush=True)
        return None

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
    sysp = ("你是%s，Minecraft世界「初始之地」集市的村民。人设：%s。"
            "请以你的身份给今天的集市委托拟一张单子。物品只能从这些里选（id=中文名）：%s。"
            "要求：数量 3 到 24 之间、报酬 1 到 3 颗绿宝石、要与你的营生和人设相关。"
            '只输出一行 JSON，格式：{"item": "物品id", "zh": "中文名", "count": 数量, "emerald": 报酬, '
            '"pitch": "一句话委托口吻，30字内，含数量和报酬"}。不要输出其他任何内容。') % (
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

def route(speaker, msg, via="public"):
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
        # @公证交割：Agent↔Agent / 玩家↔玩家。公屏只教学，结算走私语通道。
        if via == "public":
            return hit_v, [
                "（摆摆手）替人递东西更得避人耳目——凑到耳边低语：/msg Goddess 交易：%s @%s 给%s%s" % (hit_v["calls"][0], m.group(1), m.group(2), m.group(3)),
            ]
        return hit_v, handoff(speaker, hit_v, m.group(1), int(m.group(2)), m.group(3))
    m = RE_GIVE.match(rest)
    if m:
        # WHISPER-TRADE 2026-08-18 刷屏治理：交付类高频指令不占公屏——
        # 公屏喊「岳山 给16煤」只回教学（真人可学），结算只走私语通道（inbox）。
        if via == "public":
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
    # 兜底：灶火祭司（一村民一 session，串台隔离）→ 旧直连 LLM → 固定台词
    lines = agent_chat(hit_v, speaker, msg, ctx)
    if lines:
        return hit_v, lines
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

def player_pos(name):
    """玩家实况坐标（在线玩家；名字仅支持 ASCII，中文玩家名 RCON 直传不可用——与 turn_in 既有行为一致）"""
    try:
        r = R.cmd("data get entity %s Pos" % name)
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
    offers = _recipes_nbt(v) or "Offers:{Recipes:[]}"
    # 背景村民（2026-08-18）：天生 NoAI:0b 自由生活——会溜达/归巢；委托型商人维持 1b（unleash_alive 释放）
    noai = "0b" if v.get("ambient") else "1b"
    nbt = ('{NoAI:%s,Invulnerable:1b,PersistenceRequired:1b,Silent:1b,Tags:["%s"],'
           'CustomName:{text:"%s",color:"%s"},CustomNameVisible:1b,Xp:0,'
           'VillagerData:{profession:"minecraft:%s",level:4,type:"minecraft:%s"},%s}') % (
        noai, v["tag"], v["display"], v["color"], v["profession"], biome, offers)
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
            try:
                sync_offers()  # 每日委托翻转/被 whisper 通道完成后柜台对齐
            except Exception as e:
                print("[offer] sync err:", e, flush=True)
            heal_npcs()
        try:
            if os.path.getsize(LOG) < f.tell():
                f.close()
                f = open(LOG, "r", encoding="utf-8", errors="replace")
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
            except Exception:
                continue
            if not who or not msg:
                continue
            try:
                v, replies = route(who, msg, via="whisper")
            except Exception as e:
                print("[npc] inbox route err:", e, flush=True)
                v, replies = None, None
            if v:
                # 点对点不刷屏，不吃公屏 COOLDOWN（bot 靠回执知道已结算，防重复交付重试）
                print("[npc] inbox %s -> %s: %r" % (who, v["display"], msg[:60]), flush=True)
                feed_append({"kind": "player", "who": who, "npc": v["display"], "npcKey": v["key"],
                             "text": msg[:200], "via": "whisper"})
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
                            goddess("晨光落在初始之地——昨日村里：%s。日子就这么淌着，挺好。" % "，".join(parts))
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
            speak(v, line)
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

if __name__ == "__main__":
    R.connect()
    threading.Thread(target=inbox_loop, daemon=True).start()
    threading.Thread(target=routine_loop, daemon=True).start()
    threading.Thread(target=watch_offers, daemon=True).start()
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
