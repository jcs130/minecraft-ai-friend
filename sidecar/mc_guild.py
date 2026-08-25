# -*- coding: utf-8 -*-
"""
mc_guild v2 —— 冒险者公会：等级制委托 + 组队任务 + Boss 讨伐 + 巢穴/藏宝生成。
================================================================
v2 新增（2026-08-19 众力需求）：
  - 委托带等级（青铜/黑铁/白银/黄金/白金/钻石），接单校验冒险者等级
  - 注册制：说「注册」入会（首次接单也自动注册）
  - 组队任务：boss 讨伐必须 2 人——「组队接 N 邀请 <队友>」→ 队友说「入队」
  - Boss 讨伐：组队成功时向荒野召唤强化劫掠兽（Health 200），队内任一人击杀即达成
  - 哥布林(piglin)巢穴：每日在广场 90~160 格外随机生成营地+驻守+宝箱，夺取金锭交付
  - 藏宝委托：宝箱埋在广场 70~130 格外的地下，挖出钻石信物交付
  - 地点生成走 forceload add → 建造 → forceload remove（区块按需加载）
交付协议：guild 自有单（lair/treasure/boss 不引用 quests）对岚说「交付 N」；
         收购单（gather，引用 quests）仍走发单人交易链路（零改动）。
"""
import json, os, re, time, threading, random, math
import mc_npc as N  # 复用 RCON/tellraw/villagers/feed/chronicle 基建

VDIR = N.VDIR
DATA = N.DATA
GCFG = N.CFG.get("guild", {})
PLAZA = (-101, 64, 167)  # 广场中心（世界锚点）
GATE_BOARD = (3140, 68, -1327)  # 城门·任务板（实体告示牌，立在守卫桐人/鸣人之间的城镇中心）：对板附近说「看板」看今日委托。坐标可调。

# 等级表（门槛=功勋）
RANKS = [("青铜", 0), ("黑铁", 10), ("白银", 30), ("黄金", 70), ("白金", 150), ("钻石", 350)]
RANK_TAGS = ["§7", "§8", "§f", "§e", "§b", "§3"]  # 告示牌用不上了，聊天文案用文字即可

HUNT_MOBS = {
    "skeleton": ("killed_skeleton", "minecraft:killed:minecraft.skeleton", "骷髅"),
    "zombie":   ("killed_zombie",   "minecraft:killed:minecraft.zombie",   "僵尸"),
    "spider":   ("killed_spider",   "minecraft:killed:minecraft.spider",   "蜘蛛"),
    "ravager":  ("killed_ravager",  "minecraft:killed:minecraft.ravager",  "劫掠兽"),
}

VISIT_SPOTS = [
    {"key": "outpost",  "zh": "矿场前哨", "pos": [-73, 72, 178],   "r": 8,  "fame": 1,
     "desc": "扛枪的矿场前哨，摸一摸那两口箱子就当巡过岗了"},
    {"key": "far_horizon", "zh": "远方的地平线", "pos": None, "r": 0, "fame": 3,
     "desc": "朝着任意方向走到离广场 300 格开外——世界很大，去看看"},
]

HUNT_POOL = [
    {"from": "hesu",   "title": "田里的白骨", "mob": "skeleton", "count": 2, "reward": 3, "fame": 1,
     "pitch": "骷髅夜里刨我家田垄！替我打退{count}个{zh}，{reward}绿宝石。"},
    {"from": "zhujiu", "title": "夜巡的噩梦", "mob": "zombie", "count": 3, "reward": 3, "fame": 1,
     "pitch": "夜里有僵尸挠我家门板！去讨伐{count}只{zh}，我出{reward}绿宝石。"},
    {"from": "xiaoman","title": "羊圈的威胁", "mob": "spider", "count": 2, "reward": 2, "fame": 1,
     "pitch": "蜘蛛总惦记我的羊！清理{count}只{zh}，{reward}绿宝石聊表谢意。"},
]

# ---------- 工具 ----------
def guild_path(day):
    return os.path.join(VDIR, "guild-%s.json" % day)

def fame_path():
    return os.path.join(VDIR, "guild-fame.json")

def load_fame():
    if os.path.exists(fame_path()):
        try:
            return json.load(open(fame_path(), encoding="utf-8"))
        except Exception:
            return {}
    return {}

def save_fame(fm):
    json.dump(fm, open(fame_path(), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def rank_of(fame):
    name = RANKS[0][0]
    for nm, th in RANKS:
        if fame >= th:
            name = nm
    return name

def rank_idx_of(fame):
    idx = 0
    for i, (nm, th) in enumerate(RANKS):
        if fame >= th:
            idx = i
    return idx

def add_fame(who, fame):
    fm = load_fame()
    rec = fm.setdefault(who, {"fame": 0, "done": 0, "rank": RANKS[0][0], "joined": time.strftime("%m-%d")})
    old_rank = rank_of(rec["fame"])
    rec["fame"] += fame
    rec["done"] += 1
    rec["rank"] = rank_of(rec["fame"])
    save_fame(fm)
    return old_rank, rec["rank"]

# ---------------- 地点生成器（v2） ----------------
def _u(zh):
    return "".join(ch if 32 <= ord(ch) < 127 and ch not in '"\\' else "\\u%04x" % ord(ch) for ch in str(zh))

DIR8 = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]

def pick_spot(min_d, max_d, seed=None):
    """广场周围随机选点 → (x, y, z, 方位词, 距离描述)。"""
    rng = random.Random(seed) if seed else random.Random()
    ang = rng.uniform(0, 2 * math.pi)
    d = rng.uniform(min_d, max_d)
    x = PLAZA[0] + round(d * math.cos(ang))
    z = PLAZA[2] + round(d * math.sin(ang))
    deg = math.degrees(math.atan2(z - PLAZA[2], x - PLAZA[0]))  # 东=0 北=90(mc -z 北)
    mc_deg = (90 - deg) % 360  # 换算 MC 罗盘角：0=北 顺时针
    dirw = DIR8[int(((mc_deg + 22.5) % 360) // 45)]
    return x, 64, z, dirw, "约%d格" % (round(d / 10) * 10)

def _force(cmd):
    try:
        N.R.cmd(cmd)
    except Exception as e:
        print("[guild] forceload/build err:", cmd[:60], e, flush=True)

def _chest(x, y, z, items, name):
    """放箱子并塞战利品。items=[(id,count)]"""
    nbt_items = ",".join('{id:"minecraft:%s",count:%d,Slot:%db}' % (it, c, i)
                         for i, (it, c) in enumerate(items))
    _force('setblock %d %d %d minecraft:chest[facing=north]{CustomName:{text:"%s",color:"gold"},Items:[%s]}' % (
        x, y, z, _u(name), nbt_items))

def build_treasure(x, y, z):
    """埋藏宝箱：3x3 石台 + 箱子 + 泥土掩埋。战利品：钻石信物+绿宝石+命名纸。"""
    _force("forceload add %d %d %d %d" % (x - 16, z - 16, x + 16, z + 16))
    time.sleep(1.2)
    _force("fill %d %d %d %d %d %d minecraft:stone replace air" % (x - 1, 63, z - 1, x + 1, 63, z + 1))
    _chest(x, 64, z, [("diamond", 1), ("emerald", 3), ("paper", 2)], "公会封印的宝箱")
    _force("setblock %d %d %d minecraft:dirt_path" % (x, 65, z))
    _force("setblock %d %d %d minecraft:coarse_dirt" % (x, 66, z))
    _force("forceload remove %d %d %d %d" % (x - 16, z - 16, x + 16, z + 16))
    print("[guild] treasure built @", x, z, flush=True)

def build_lair(x, y, z):
    """哥布林(piglin)营地：5x5 圆石台 + 木柱羊毛棚 + 营火 + loot 箱 + 3 驻守。"""
    _force("forceload add %d %d %d %d" % (x - 16, z - 16, x + 16, z + 16))
    time.sleep(1.2)
    _force("fill %d %d %d %d %d %d minecraft:cobblestone replace air" % (x - 2, 63, z - 2, x + 2, 63, z + 2))
    # 棚：四角木柱 + 顶羊毛
    for dx, dz in ((-2, -2), (2, -2), (-2, 2), (2, 2)):
        _force("setblock %d %d %d minecraft:oak_fence" % (x + dx, 64, z + dz))
        _force("setblock %d %d %d minecraft:oak_fence" % (x + dx, 65, z + dz))
    _force("fill %d %d %d %d %d %d minecraft:orange_wool replace air" % (x - 2, 66, z - 2, x + 2, 66, z + 2))
    _force("setblock %d %d %d minecraft:campfire[lit=true]" % (x, 64, z + 1))
    _chest(x, 64, z - 1, [("gold_ingot", 5), ("emerald", 2), ("golden_axe", 1)], "部落的赃物箱")
    # 驻守 piglin ×3：金剑、不腐化、不掉队
    for i, (dx, dz) in enumerate(((-1, 1), (1, 0), (0, -2))):
        _force('summon minecraft:piglin %d %d %d {IsImmuneToZombification:1b,PersistenceRequired:1b,'
               'CustomName:{text:"%s",color:"red"},CustomNameVisible:1b,'
               'HandItems:[{id:"minecraft:golden_sword",count:1},{}],CanPickUpLoot:0b}' % (
                   x + dx, 64, z + dz, _u("哥布林·哨兵%d" % (i + 1))))
    _force("forceload remove %d %d %d %d" % (x - 16, z - 16, x + 16, z + 16))
    print("[guild] lair built @", x, z, flush=True)

def summon_boss(no):
    """向荒野召唤强化劫掠兽（组队成功时调用）。返回 (方位词, 距离描述)。"""
    x, y, z, dirw, dd = pick_spot(150, 200, seed="boss-%d-%s" % (no, time.strftime("%Y%m%d")))
    _force("forceload add %d %d %d %d" % (x - 16, z - 16, x + 16, z + 16))
    time.sleep(1.2)
    # 1.21.5+ NBT 里 Attributes/大写 Count 均被静默丢弃——血量/速度走 /attribute 命令，
    # 血量用 instant_health 30 档一口奶满到新上限（data modify Health 在 1.21.11 报参数错）
    sel = "@e[type=ravager,tag=guild_boss_%d,limit=1]" % no
    _force('summon minecraft:ravager %d %d %d {Tags:["guild_boss_%d"],'
           'PersistenceRequired:1b,CustomName:{text:"%s",color:"red"},CustomNameVisible:1b}' % (
               x, y, z, no, _u("暴怒的劫掠兽")))
    _force("attribute %s minecraft:max_health base set 200" % sel)
    _force("attribute %s minecraft:movement_speed base set 0.35" % sel)
    _force("effect give %s minecraft:instant_health 1 30 true" % sel)
    _force("forceload remove %d %d %d %d" % (x - 16, z - 16, x + 16, z + 16))
    print("[guild] boss summoned @", x, z, flush=True)
    return dirw, dd

def kill_boss(no):
    try:
        N.R.cmd("kill @e[type=ravager,tag=guild_boss_%d]" % no)
    except Exception:
        N.R.s = None

# ---------------- 探索点 ----------------
def pick_visits(day):
    out = []
    spots = [s for s in VISIT_SPOTS if s["key"] != "far_horizon"]
    chosen = spots[:1]
    fh = next(s for s in VISIT_SPOTS if s["key"] == "far_horizon")
    rng = random.Random(day)
    ang = rng.uniform(0, 6.2832)
    far = dict(fh)
    far["pos"] = [PLAZA[0] + round(320 * math.cos(ang)), 64, PLAZA[2] + round(320 * math.sin(ang))]
    chosen.append(far)
    for s in chosen:
        out.append({"type": "visit", "spot": s["key"], "zh": s["zh"], "pos": s["pos"], "r": s["r"],
                    "fame": s["fame"], "desc": s["desc"], "reward": s["fame"] + 1})
    return out

# ---------------- 看板生成 ----------------
def gen_board(day):
    """v2 板书 = 收购(gather, 引用 quests) + 讨伐(hunt) + 朝圣(visit)
              + 藏宝(treasure, 青铜) + 巢穴(lair, 黑铁) + Boss讨伐(boss, 白银·组队2人)。"""
    hunt_cap = GCFG.get("hunt_cap", 3)
    doc = {"date": day, "board": []}
    board = doc["board"]
    no = 1
    # —— 收购：引用 quests_today（交付链路零改动）
    try:
        qs = N.quests_today()["quests"]
    except Exception:
        qs = []
    for q in qs:
        board.append({"no": no, "type": "gather", "rank": 0, "qid": q["id"], "from": q["villager"], "display": q["display"],
                      "title": "收购·%s" % q["zh"], "item": q["item"], "zh": q["zh"], "count": q["count"],
                      "reward": q["emerald"], "fame": 1,
                      "pitch": q.get("pitch") or "凑{count}个{zh}，酬{reward}绿宝石。".format(
                          count=q["count"], zh=q["zh"], reward=q["emerald"]),
                      "status": "open", "taker": [], "taken_at": None,
                      "done_by": None, "done_at": None})
        no += 1
    # —— 讨伐
    pool = list(HUNT_POOL)
    random.shuffle(pool)
    used_from = set()
    picked = 0
    for t in pool:
        if picked >= hunt_cap or t["from"] in used_from:
            continue
        if t["from"] not in {v["key"] for v in N.PROFILES}:
            continue
        used_from.add(t["from"])
        v = next(v for v in N.PROFILES if v["key"] == t["from"])
        zh = HUNT_MOBS[t["mob"]][2]
        board.append({"no": no, "type": "hunt", "rank": 0, "from": t["from"], "display": v["display"],
                      "title": t["title"], "mob": t["mob"], "zh": zh, "count": t["count"],
                      "reward": t["reward"], "fame": t["fame"],
                      "pitch": t["pitch"].format(count=t["count"], zh=zh, reward=t["reward"]),
                      "status": "open", "taker": [], "taken_at": None, "baseline": {},
                      "done_by": None, "done_at": None})
        no += 1
        picked += 1
    # —— 朝圣
    for s in pick_visits(day):
        board.append({"no": no, "type": "visit", "rank": 0, "from": "jingshui", "display": "神官·静水",
                      "title": "朝圣·%s" % s["zh"], "zh": s["zh"], "pos": s["pos"], "r": s["r"],
                      "reward": s["reward"], "fame": s["fame"], "pitch": s["desc"],
                      "status": "open", "taker": [], "taken_at": None,
                      "done_by": None, "done_at": None})
        no += 1
    # —— v2 藏宝（青铜）：埋宝箱，挖钻石交付
    tx, ty, tz, tdir, tdd = pick_spot(70, 130, seed="treasure-%s" % day)
    board.append({"no": no, "type": "treasure", "rank": 0, "from": "guild_lan", "display": "公会接待员·岚",
                  "title": "藏宝·荒野的封印箱", "item": "diamond", "zh": "钻石", "count": 1,
                  "reward": 4, "fame": 2,
                  "pitch": "一张残破的藏宝图指向广场{dir}{dist}外——宝箱埋在土下，挖出箱中的钻石信物带回来。".format(
                      dir=tdir, dist=tdd),
                  "spot": [tx, ty, tz], "dir": tdir, "dist": tdd,
                  "status": "open", "taker": [], "taken_at": None,
                  "done_by": None, "done_at": None})
    try:
        build_treasure(tx, ty, tz)
    except Exception as e:
        print("[guild] build_treasure err:", e, flush=True)
    no += 1
    # —— v2 巢穴（黑铁）：哥布林营地，夺金锭交付
    lx, ly, lz, ldir, ldd = pick_spot(90, 160, seed="lair-%s" % day)
    board.append({"no": no, "type": "lair", "rank": 1, "from": "guild_lan", "display": "公会接待员·岚",
                  "title": "讨巢·哥布林营地", "item": "gold_ingot", "zh": "金锭", "count": 3,
                  "reward": 5, "fame": 3,
                  "pitch": "哥布林（猪灵哨兵）在广场{dir}{dist}外扎了营，抢走了商队的金锭。捣毁营地，夺回赃物箱里的金锭来交付。".format(
                      dir=ldir, dist=ldd),
                  "spot": [lx, ly, lz], "dir": ldir, "dist": ldd,
                  "status": "open", "taker": [], "taken_at": None,
                  "done_by": None, "done_at": None})
    try:
        build_lair(lx, ly, lz)
    except Exception as e:
        print("[guild] build_lair err:", e, flush=True)
    no += 1
    # —— v2 Boss 讨伐（白银·必须组队2人）
    bx, by, bz, bdir, bdd = pick_spot(150, 200, seed="boss-%s" % day)
    board.append({"no": no, "type": "boss", "rank": 2, "party": 2, "from": "guild_lan", "display": "公会接待员·岚",
                  "title": "讨伐·暴怒的劫掠兽", "mob": "ravager", "zh": "劫掠兽", "count": 1,
                  "reward": 8, "fame": 6,
                  "pitch": "荒野出现了一头暴怒的劫掠兽（白银级·须2人组队讨伐）。组队击杀，重酬{reward}绿宝石，两人同得。".format(
                      reward=8),
                  "boss_pos": [bx, by, bz],
                  "status": "open", "taker": [], "taken_at": None, "baseline": {},
                  "done_by": None, "done_at": None})
    json.dump(doc, open(guild_path(day), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return doc

BOARD = {"date": None, "doc": None}

def board_today():
    day = time.strftime("%Y-%m-%d")
    if BOARD["date"] == day and BOARD["doc"]:
        return BOARD["doc"]
    p = guild_path(day)
    if os.path.exists(p):
        try:
            doc = json.load(open(p, encoding="utf-8"))
        except Exception:
            doc = None
        if doc:
            # v1→v2 兼容：taker 字符串包成列表
            for b in doc.get("board", []):
                if isinstance(b.get("taker"), str):
                    b["taker"] = [b["taker"]] if b["taker"] else []
            BOARD.update(date=day, doc=doc)
            return doc
    doc = gen_board(day)
    BOARD.update(date=day, doc=doc)
    return doc

def save_board(doc):
    json.dump(doc, open(guild_path(doc["date"]), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---------------- 奖励与公告 ----------------
def complete_task(b, how="auto", cmd_who=None):
    """任务达成：全体队员发奖+声望+公告。b 必须已置 done 防双发。"""
    takers = b.get("taker") or []
    if isinstance(takers, str):
        takers = [takers] if takers else []
    if not takers:
        takers = [b.get("done_by") or "?"]
    team_txt = takers[0] if len(takers) == 1 else " 与 ".join(takers)
    promo = []
    for who in takers:
        tgt = cmd_who or who
        # gather 单的绿宝石由发单村民在交易链路支付，公会只记功勋不重复付钱
        if b.get("type") != "gather":
            try:
                N.R.cmd("give %s minecraft:emerald %d" % (tgt, b["reward"]))
            except Exception as e:
                print("[guild] give err:", e, flush=True)
        # GUI 柜台结算传入的 who 是 @p 选择器（非玩家名），跳过声望记账防污染名册
        if who and not who.startswith("@"):
            old_r, new_r = add_fame(who, b.get("fame", 1))
            if new_r != old_r:
                promo.append("%s：%s→%s" % (who, old_r, new_r))
        try:
            N.R.cmd('title %s title {"text":"%s","color":"aqua"}' % (tgt, _u("委托完成！")))
            N.R.cmd('title %s subtitle {"text":"%s","color":"white"}' % (tgt, _u(b["title"])))
            N.R.cmd("playsound minecraft:entity.player.levelup master %s ~ ~ ~ 0.8 1.2" % tgt)
        except Exception:
            pass
    N.tellraw([("[公会] ", "aqua"), ("%s %s委托「%s」（%s）——每人酬 %d 绿宝石，功勋 +%d！" % (
        team_txt, "组队" if len(takers) > 1 else "完成", b["title"], b["display"],
        b["reward"], b.get("fame", 1)), "aqua")])
    if promo:
        N.goddess("冒险者晋升——%s！诸位，鼓掌！" % "，".join(promo))
        try:
            N.R.cmd("playsound minecraft:ui.toast.challenge_complete master @a")
        except Exception:
            pass
    N.chronicle_append("公会委托完成：%s %s「%s」（%s 发单），各得 %d 绿宝石、功勋+%d%s" % (
        team_txt, "组队完成" if len(takers) > 1 else "交付", b["title"], b["display"],
        b["reward"], b.get("fame", 1), "；" + "；".join(promo) if promo else ""))
    N.feed_append({"kind": "guild", "who": team_txt, "title": b["title"], "npc": b["display"],
                   "reward": b["reward"], "fame": b.get("fame", 1), "party": len(takers)})
    N.ledger_append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "type": "guild-done", "who": ",".join(takers),
                     "title": b["title"], "from": b["display"], "reward": b["reward"],
                     "fame": b.get("fame", 1), "how": how})

# ---------------- 对话协议 ----------------
RE_CLAIM   = re.compile(r"^(?:接|承接|领受?|接下)\s*(?:委托|任务|单子)?\s*([0-9０-９]{1,2})\s*号?$")
RE_PARTY   = re.compile(r"^(?:组队|联合?|结伴)\s*(?:接|承接|接下)\s*(?:委托|任务|单子)?\s*([0-9０-９]{1,2})\s*(?:号)?" +
                        r"(?:\s*(?:邀请|约|拉|和|跟|与)?\s*([A-Za-z0-9_]{2,16}))?$")
RE_JOIN    = re.compile(r"^(?:入队|应战|加入|同意入队|来吧)$")
RE_RELEASE = re.compile(r"^放弃\s*(?:委托|任务|单子)?\s*([0-9０-９]{1,2})\s*号?$")
RE_DELIVER = re.compile(r"^(?:交|交付|交割|上交)\s*(?:委托|任务|单子)?\s*([0-9０-９]{1,2})\s*号?$")
RE_REG     = re.compile(r"^(?:注册|入会|登记|报名)(?:成为冒险者|冒险者)?$")

PENDING_PARTY = {}  # invitee -> {"no":, "leader":, "exp":ts}

def _zh_num(s):
    return int(s.translate(str.maketrans("０１２３４５６７８９", "0123456789")))

def _takers(b):
    t = b.get("taker")
    if isinstance(t, str):
        return [t] if t else []
    return t or []

def route_guild(speaker, msg, rest, hit_v):
    """公会命令路由。命中返回台词列表，未命中返回 None 落回普通逻辑。"""
    is_lan = bool(hit_v) and hit_v.get("key") == "guild_lan"
    guildish = any(w in msg for w in ("公会", "冒险者", "功勋"))
    if not (is_lan or guildish or "看板" in msg):
        return None
    if "看板" in msg or "委托列表" in msg or "任务列表" in msg or (is_lan and any(w in rest for w in ("单子", "委托", "任务"))):
        if is_lan or guildish or _near_board(speaker):
            return board_lines()
        return ["（指了指公会柜台）委托看板在公会那儿——不过城门口立了块任务板，走过去说「看板」一样看得到。"]
    m = RE_DELIVER.search(rest)
    if m:
        return deliver(speaker, _zh_num(m.group(1)))
    m = RE_PARTY.search(rest)
    if m:
        return party_claim(speaker, _zh_num(m.group(1)), (m.group(2) or "").strip())
    m = RE_CLAIM.search(rest)
    if m:
        return claim(speaker, _zh_num(m.group(1)))
    if RE_JOIN.match(rest):
        return party_join(speaker)
    m = RE_RELEASE.search(rest)
    if m:
        return release(speaker, _zh_num(m.group(1)))
    if RE_REG.match(rest):
        return register(speaker)
    if "我的" in msg and any(w in msg for w in ("任务", "委托", "单子")):
        return my_lines(speaker)
    if any(w in msg for w in ("声望", "功勋")):
        return fame_lines(speaker)
    if is_lan:
        return None
    return None

def _near_board(who, limit=None):
    """是否在城门·任务板附近（默认 12 格）——城门口说「看板」也能看今日委托，不必非到公会。"""
    lim = limit or GCFG.get("board_proximity", 12)
    try:
        pp = N.player_pos(who)
        if pp is None:
            return False
        d = ((pp[0] - GATE_BOARD[0]) ** 2 + (pp[1] - GATE_BOARD[1]) ** 2 + (pp[2] - GATE_BOARD[2]) ** 2) ** 0.5
        return d <= lim
    except Exception:
        return False

def _near_receptionist(who, limit=None):
    v = next((x for x in N.PROFILES if x["key"] == "guild_lan"), None)
    if v is None:
        return True
    try:
        pp = N.player_pos(who)
        np_ = N.alive_pos(v)
        if pp is None or np_ is None:
            return True
        d = ((pp[0] - np_[0]) ** 2 + (pp[1] - np_[1]) ** 2 + (pp[2] - np_[2]) ** 2) ** 0.5
        return d <= (limit or GCFG.get("claim_proximity", 8))
    except Exception:
        return True

def _rank_gate(who, b):
    """等级门槛：返回 None=通过，否则拒绝台词。"""
    need = b.get("rank", 0)
    if need <= 0:
        return None
    fm = load_fame()
    idx = rank_idx_of(fm.get(who, {}).get("fame", 0))
    if idx >= need:
        return None
    fame = fm.get(who, {}).get("fame", 0)
    return ("（把名册翻得哗啦响）No.%d 是%s级委托（要功勋%d），你眼下是%s、功勋%d——差着档呢，再喊几遍也接不上。"
            "先挑看板上没标档位的单子做（说「接 编号」），攒够功勋升%s再来。说「我的」看你手头在办的单子。"
            % (b["no"], RANKS[need][0], RANKS[need][1], RANKS[idx][0], fame, RANKS[need][0]))

def board_lines():
    doc = board_today()
    out = ["【今日看板 · %s】" % doc["date"]]
    for b in doc["board"]:
        if b["status"] == "done":
            mark = "✔%s" % (b.get("done_by") or "")
        elif b["status"] == "claimed":
            mark = "→%s" % "+".join(_takers(b))
        else:
            mark = "可接" if b.get("rank", 0) <= 0 else "可接·需%s档" % RANKS[b.get("rank", 0)][0]
        rank = "[%s]" % RANKS[b.get("rank", 0)][0] if b.get("rank", 0) > 0 else ""
        party = "·组队%d人" % b["party"] if b.get("party") else ""
        out.append("No.%d %s%s%s（%s · 酬%d绿/功勋%d）[%s]" % (
            b["no"], rank, b["title"], party, b["display"], b["reward"], b.get("fame", 1), mark))
    out.append("——接单：接 编号｜组队：组队接 编号 邀请 队友（被邀者回「入队」）｜交付：对岚说 交付 编号｜放弃：放弃 编号")
    return out

def my_lines(who):
    doc = board_today()
    mine = [b for b in doc["board"] if b["status"] == "claimed" and who in _takers(b)]
    if not mine:
        return ["你眼下没有在办的委托。看板就在墙上——说「看板」瞅瞅去。"]
    out = ["你手头的委托："]
    for b in mine:
        mate = [t for t in _takers(b) if t != who]
        mate_txt = "（与%s组队）" % "、".join(mate) if mate else ""
        if b["type"] == "gather":
            tip = "把 %d 个%s交到 %s 手上（对他说：交易：%s 给%d%s）" % (
                b["count"], b["zh"], b["display"], b["display"].split("·")[-1], b["count"], b["zh"])
        elif b["type"] == "lair":
            tip = "去广场%s%s外的哥布林营地%s，从赃物箱夺 %d 枚%s，回来对我说「交付 %d」" % (
                b["dir"], b["dist"], mate_txt, b["count"], b["zh"], b["no"])
        elif b["type"] == "treasure":
            tip = "宝箱埋在广场%s%s外的土下，挖出钻石信物，回来对我说「交付 %d」" % (
                b["dir"], b["dist"], b["no"])
        elif b["type"] == "boss":
            tip = "组队讨伐暴怒的劫掠兽%s——它盘踞在广场一带的荒野，队内任一人击杀即算达成" % mate_txt
        elif b["type"] == "hunt":
            tip = "去讨伐 %d 只%s（杀够自动结算）%s" % (b["count"], b["zh"], mate_txt)
        else:
            tip = "去一趟「%s」（走到即结算）" % b["zh"]
        out.append("No.%d %s——%s" % (b["no"], b["title"], tip))
    return out

def fame_lines(who):
    fm = load_fame()
    rec = fm.get(who)
    if not rec:
        return ["（翻了翻名册）还没有你的名字。说「注册」入会，或者直接接一单活儿——办成一单你就是青铜冒险者。"]
    cur = rank_of(rec["fame"])
    nxt = next(((nm, th) for nm, th in RANKS if th > rec["fame"]), None)
    return ["%s：功勋 %d，等级「%s」，已完成 %d 单（%s入会）。%s" % (
        who, rec["fame"], cur, rec["done"], rec.get("joined", "?"),
        ("再攒 %d 功勋升%s。" % (nxt[1] - rec["fame"], nxt[0])) if nxt else "已是巅峰。")]

def register(who):
    fm = load_fame()
    if who in fm:
        return fame_lines(who)
    fm.setdefault(who, {"fame": 0, "done": 0, "rank": RANKS[0][0], "joined": time.strftime("%m-%d")})
    save_fame(fm)
    try:
        N.goddess("冒险者公会名册新添一笔：%s 注册入会，青铜起步。愿委托顺遂。" % who)
    except Exception:
        pass
    N.chronicle_append("公会：%s 注册成为冒险者（青铜）" % who)
    return ["（提笔落墨，郑重写下你的名字）好了，%s——从这一刻起你就是青铜冒险者。看板上的委托随你挑，攒够功勋换牌子。" % who]

# ---------- 接单（单人） ----------
def claim(who, no):
    doc = board_today()
    b = next((x for x in doc["board"] if x["no"] == no), None)
    if b is None:
        return ["（凑近看板又看了一眼）没有 No.%d 这一单，别拿假军情诓我。" % no]
    if b["status"] == "done":
        return ["No.%d 已经办完了。挑别的吧。" % no]
    if b["status"] == "claimed":
        return ["No.%d 被 %s 接走了。手快有手慢无。" % (no, "+".join(_takers(b)))]
    if b.get("party"):
        return ["No.%d 是组队委托，得 %d 人画押。说「组队接 %d 邀请 队友名」，等他回「入队」就成军。" % (
            no, b["party"], no)]
    if not _near_receptionist(who):
        return ["（头也不抬）隔着老远喊什么？到柜台跟前来，当面画押才算数。"]
    deny = _rank_gate(who, b)
    if deny:
        return [deny]
    mine = [x for x in doc["board"] if x["status"] == "claimed" and who in _takers(x)]
    if len(mine) >= GCFG.get("active_cap", 2):
        return ["（翻名册）你名下已有 %d 单在办，接不了新的。先办完一单（对我说「交付 编号」），实在办不动就「放弃 编号」腾手，再接新的。" % len(mine)]
    b["status"] = "claimed"
    b["taker"] = [who]
    b["taken_at"] = time.strftime("%H:%M")
    if b["type"] in ("hunt", "boss"):
        b["baseline"] = {who: hunt_score(who, b["mob"])}
    save_board(doc)
    N.ledger_append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "type": "guild-claim", "who": who,
                     "no": no, "title": b["title"]})
    extra = ""
    if b["type"] == "gather":
        extra = "——货备齐了找 %s 交付。" % b["display"]
    elif b["type"] == "lair":
        extra = "——营地在广场%s%s外，夺回%d枚%s对我说「交付 %d」。" % (b["dir"], b["dist"], b["count"], b["zh"], no)
    elif b["type"] == "treasure":
        extra = "——宝箱埋在广场%s%s外的土下，挖出钻石对我说「交付 %d」。" % (b["dir"], b["dist"], no)
    elif b["type"] in ("hunt", "boss"):
        extra = "——杀够 %d 只%s，我自动给你记功。" % (b["count"], b["zh"])
    else:
        extra = "——走到地方就算完成，路上小心。"
    return ["（啪地盖上公会印）No.%d「%s」就托付给你了，%s！酬 %d 绿宝石、功勋 %d。%s" % (
        no, b["title"], who, b["reward"], b.get("fame", 1), extra)]

# ---------- 组队接单（v2） ----------
def party_claim(who, no, invitee):
    doc = board_today()
    b = next((x for x in doc["board"] if x["no"] == no), None)
    if b is None:
        return ["没有 No.%d 这一单。" % no]
    if b["status"] == "done":
        return ["No.%d 已经办完了。" % no]
    if b["status"] == "claimed":
        return ["No.%d 已经被 %s 接走了。" % (no, "+".join(_takers(b)))]
    if not b.get("party"):
        return ["No.%d 不是组队委托，单人「接 %d」就行。" % (no, no)]
    if not _near_receptionist(who):
        return ["（头也不抬）组队画押也得来柜台——带着你的队友一起。"]
    deny = _rank_gate(who, b)
    if deny:
        return [deny]
    if not invitee:
        return ["组队接 No.%d 得有个队友——说「组队接 %d 邀请 队友名」，他回「入队」就算成军。" % (no, no)]
    # 自动注册未入会队友档（等级门槛同步校验队友）
    fm = load_fame()
    if rank_idx_of(fm.get(invitee, {}).get("fame", 0)) < b.get("rank", 0):
        return ["（摇头）%s 的等级还不够%s档。让他先攒攒功勋，或者你们换一单。" % (invitee, RANKS[b["rank"]][0])]
    try:
        online = [p["name"] for p in _online_players()] if _online_players() else []
    except Exception:
        online = []
    if online and invitee not in online:
        return ["（四下张望）%s 现在不在场。组队画押得俩人都在镇上。" % invitee]
    PENDING_PARTY[invitee] = {"no": no, "leader": who, "exp": time.time() + 60}
    try:
        N.tellraw([("[公会] ", "aqua"), ("%s 向 %s 发起组队邀请：委托 No.%d「%s」（%s级·2人）。%s 在 60 秒内说「入队」应战！" % (
            who, invitee, no, b["title"], RANKS[b.get("rank", 0)][0], invitee), "yellow")], to=invitee)
    except Exception:
        pass
    return ["（取出一式两份的军令状）邀书已递给 %s。他若在 60 秒内回「入队」，No.%d「%s」就归你们二人。" % (
        invitee, no, b["title"])]

def party_join(who):
    inv = PENDING_PARTY.pop(who, None)
    if not inv or inv["exp"] < time.time():
        PENDING_PARTY.pop(who, None)
        return ["（翻了翻邀书堆）没有给你的组队邀请——要么过期了，要么得先让队长说「组队接 编号 邀请 你」。"]
    doc = board_today()
    b = next((x for x in doc["board"] if x["no"] == inv["no"]), None)
    if b is None or b["status"] != "open":
        return ["那单已经不等着你们了。"]
    leader = inv["leader"]
    if not _near_receptionist(who):
        return ["（岚朝你摆手）入队画押也得来柜台——走过来。"]
    b["status"] = "claimed"
    b["taker"] = [leader, who]
    b["taken_at"] = time.strftime("%H:%M")
    if b["type"] in ("hunt", "boss"):
        b["baseline"] = {leader: hunt_score(leader, b["mob"]), who: hunt_score(who, b["mob"])}
    save_board(doc)
    N.ledger_append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "type": "guild-party", "who": "%s+%s" % (leader, who),
                     "no": b["no"], "title": b["title"]})
    extra = ""
    if b["type"] == "boss":
        try:
            dirw, dd = summon_boss(b["no"])
            b["boss_dir"], b["boss_dist"] = dirw, dd
            save_board(doc)
            extra = "——猛兽已在广场%s%s外的荒野现身（血量二百，结阵而战！），队内任一人击杀即算达成。" % (dirw, dd)
            N.goddess("荒野惊雷——%s 与 %s 组队讨伐「暴怒的劫掠兽」！它盘踞在广场%s%s外。愿刀锋顺利。" % (
                leader, who, dirw, dd))
        except Exception as e:
            print("[guild] boss summon err:", e, flush=True)
            extra = "——猛兽正在荒野集结，留神城镇四周的动静。"
    N.tellraw([("[公会] ", "aqua"), ("%s 与 %s 组队接下 No.%d「%s」！%s" % (
        leader, who, b["no"], b["title"], extra), "aqua")])
    return ["（在两份军令状上各盖一印）成军！No.%d「%s」归你们二人，赏钱功勋一人一份。%s" % (
        b["no"], b["title"], extra)]

def _online_players():
    try:
        r = N.R.cmd("list")
        m = re.search(r":\s*(.+)$", r)
        return [{"name": n.strip()} for n in m.group(1).split(",")] if m else []
    except Exception:
        return []

def release(who, no):
    doc = board_today()
    b = next((x for x in doc["board"] if x["no"] == no), None)
    if b is None:
        return ["没有 No.%d 这一单。" % no]
    if b["status"] != "claimed" or who not in _takers(b):
        return ["No.%d 不在你名下，放什么弃。" % no]
    mates = [t for t in _takers(b) if t != who]
    b["status"] = "open"
    b["taker"] = []
    b["taken_at"] = None
    b["baseline"] = {}
    save_board(doc)
    if b["type"] == "boss":
        kill_boss(no)
    for m in mates:
        try:
            N.tellraw([("[公会] ", "aqua"), ("%s 放弃了你们合接的 No.%d「%s」——委托已回到看板。" % (
                who, no, b["title"]), "yellow")], to=m)
        except Exception:
            pass
    return ["（拿印章一抹）No.%d 回到看板上了。量力而行，不寒碜。" % no]

# ---------- 交付（guild 自有单：lair/treasure） ----------
def deliver(who, no):
    doc = board_today()
    b = next((x for x in doc["board"] if x["no"] == no), None)
    if b is None:
        return ["没有 No.%d 这一单。" % no]
    if b["type"] == "gather":
        return ["收购单的货交给发单人 %s 本人——对他说「交易：%s 给%d%s」。" % (
            b["display"], b["display"].split("·")[-1], b["count"], b["zh"])]
    if b["status"] == "done":
        return ["No.%d 已经结清了。" % no]
    if b["status"] != "claimed" or who not in _takers(b):
        return ["No.%d 不在你名下。先「接 %d」再交付。" % (no, no)]
    if b["type"] not in ("lair", "treasure"):
        return ["No.%d 不需要交付——%s 达成后我自动记功。" % (
            no, "去指定地点" if b["type"] == "visit" else "杀够数")]
    if not _near_receptionist(who, limit=GCFG.get("claim_proximity", 8)):
        return ["（护住柜台）隔着老远喊什么？到我柜台前来当面点货。"]
    try:
        r = N.R.cmd("clear %s minecraft:%s %d" % (who, b["item"], b["count"]))
    except Exception:
        N.R.s = None
        return ["（交易被一阵怪风打断了……再试一次？）"]
    m = re.search(r"Removed (\d+)", r)
    got = int(m.group(1)) if m else 0
    if got < b["count"]:
        if got > 0:
            N.R.cmd("give %s minecraft:%s %d" % (who, b["item"], got))  # 原路退还
        return ["（掂了掂）数目不够——我要 %d%s。去%s把它们弄到手。" % (
            b["count"], b["zh"], "营地赃物箱里夺" if b["type"] == "lair" else "宝箱里挖")]
    b["status"] = "done"
    b["done_by"] = who
    b["done_at"] = time.strftime("%H:%M")
    save_board(doc)
    complete_task(b, how="deliver")
    return ["（验货、盖章、记账一气呵成）No.%d 结清！%s，公会记得你的功劳。" % (no, who)]

# ---------- quests 收购单钩子（v1 兼容） ----------
def settle_gather(qid, who, cmd_who=None):
    """turn_in / GUI 成交钩子：按 quests 引用 id 销板。返回是否命中。"""
    doc = board_today()
    b = next((x for x in doc["board"] if x["type"] == "gather" and x.get("qid") == qid), None)
    if b is None or b["status"] == "done":
        return False
    b["status"] = "done"
    b["done_by"] = who
    b["done_at"] = time.strftime("%H:%M")
    save_board(doc)
    complete_task(b, how="deliver", cmd_who=cmd_who)
    return True

# ---------------- 自动验收 ----------------
def hunt_score(who, mob):
    obj = HUNT_MOBS[mob][0]
    try:
        N.R.cmd("scoreboard objectives add %s %s" % (obj, HUNT_MOBS[mob][1]))
    except Exception:
        pass
    try:
        r = N.R.cmd("scoreboard players get %s %s" % (who, obj))
        m = re.search(r"(\d+)", r)
        return int(m.group(1)) if m else 0
    except Exception:
        return 0

def guild_tick():
    """30s 一轮：hunt/boss 差值(队内合计) / visit 坐标(任一人到点) / 邀请过期清理 / 日清换板。"""
    day0 = None
    while True:
        try:
            now = time.time()
            for k in [k for k, v in PENDING_PARTY.items() if v["exp"] < now]:
                PENDING_PARTY.pop(k, None)
            day = time.strftime("%Y-%m-%d")
            if day0 is None:
                day0 = day
            if day != day0:
                try:
                    old = board_today()
                    stale = [b for b in old["board"] if b["status"] == "claimed"]
                    for b in old["board"]:
                        if b["type"] == "boss":
                            kill_boss(b["no"])  # 日清兜底：未被讨伐的 boss 收走
                    if stale:
                        names = "、".join("%s(%s)" % (b["title"], "+".join(_takers(b))) for b in stale)
                        N.goddess("公会换板——昨日未竟的委托作废：%s。今日新板已挂，请冒险者们移步。" % names)
                    else:
                        N.goddess("公会今日看板已更新，%d 单委托等人来接。" % len(old["board"]))
                except Exception:
                    pass
                day0 = day
                gen_board(day)
            doc = board_today()
            for b in doc["board"]:
                if b["status"] != "claimed":
                    continue
                takers = _takers(b)
                if b["type"] in ("hunt", "boss"):
                    total = 0
                    for who in takers:
                        cur = hunt_score(who, b["mob"])
                        base = (b.get("baseline") or {}).get(who)
                        if base is None:
                            b.setdefault("baseline", {})[who] = cur
                            continue
                        total += max(0, cur - base)
                    if not b.get("baseline"):
                        save_board(doc)
                    if total >= b["count"]:
                        b["status"] = "done"
                        b["done_by"] = takers[0]
                        b["done_at"] = time.strftime("%H:%M")
                        save_board(doc)
                        complete_task(b)
                        if b["type"] == "boss":
                            N.goddess("捷报——%s 讨伐「暴怒的劫掠兽」成功！荒野暂告安宁。" % " 与 ".join(takers))
                elif b["type"] == "visit":
                    pos = b["pos"]
                    for who in takers:
                        try:
                            pp = N.player_pos(who)
                        except Exception:
                            pp = None
                        if pp is None:
                            continue
                        if b.get("spot") == "far_horizon":
                            dx, dz = pp[0] - PLAZA[0], pp[2] - PLAZA[2]
                            ok = (dx * dx + dz * dz) ** 0.5 >= 300
                        else:
                            dx, dz = pp[0] - pos[0], pp[2] - pos[2]
                            ok = (dx * dx + dz * dz) ** 0.5 <= b["r"]
                        if ok:
                            b["status"] = "done"
                            b["done_by"] = who
                            b["done_at"] = time.strftime("%H:%M")
                            save_board(doc)
                            complete_task(b)
                            break
        except Exception as e:
            print("[guild] tick err:", e, flush=True)
        time.sleep(GCFG.get("tick_interval", 30))

def start():
    doc = board_today()
    threading.Thread(target=guild_tick, daemon=True).start()
