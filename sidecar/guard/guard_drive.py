# -*- coding: utf-8 -*-
"""亲卫驱动循环 guard_drive.py —— 让剑侍/影侍真正驱动假玩家身体「活起来」。

架构（魂驭身）：
  身体 = numen 假玩家（NumenPlayer，37 个动作工具），走服务端 RCON numen_act invoke；
  魂   = QwenPaw 亲卫 agent（剑侍 mc-guard-kirito 司桐人 / 影侍 mc-guard-naruto 司鸣人），
         经 http://127.0.0.1:8088/api/console/chat + X-Agent-Id 调用，session 固定持久；
  桥   = 本进程：每轮 读身体状态+感知 → 喂亲卫决策 → 校验白名单 → 执行动作 → 记录 → 循环。

铁律：
  - 亲卫无裁决权，重大祈愿仍呈天神；本循环只驱动身体的生存动作（移动/采集/进食/战斗/躲避/睡觉）。
  - 动作白名单硬校验：不在名单内的 tool 一律拒绝执行。
  - 动作型工具异步（setTask 受理即回 task_id），循环须先查 task_status，任务在跑则等待、不重复派发。
  - 中文名走 UTF-8 直发 + 双引号包裹；不得用 backslashreplace。
"""
import io, json, os, re, sys, time, socket, struct, threading, urllib.request, subprocess, base64, math

# Windows console GBK 修复;无防御裸 wrap 曾在 pytest capture 语境炸
# (sys.stdout.buffer 不存在/双关闭)——try 包住,生产 console 照常、测试语境跳过。
# GUARD_DRIVE_NO_WRAP=1 哨兵:pytest 等宿主下彻底不碰 std 流(wrap 住宿主临时
# 文件,GC 时关闭它,宿主收尾崩「I/O operation on closed file」)。
if not os.environ.get("GUARD_DRIVE_NO_WRAP"):
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    except Exception:
        pass

# ---------------- 常量 ----------------
# 2026-08-21 容器化：硬编码 127.0.0.1 改为 env 可覆盖（独立 guard-drive 容器需连 mc-server/qwenpaw 容器网）
RCON_HOST = os.environ.get("MC_RCON_HOST", "127.0.0.1")
RCON_PORT = int(os.environ.get("MC_RCON_PORT", "25575"))
RCON_PW = os.environ.get("RCON_PASSWORD")
# 密码回退：env 优先；无 env/空时从世界侧 rcon-secret.txt 读（与 _diag_summon.py 同源），
# 不依赖外部 shell 预先注入 env，可移植、可跨容器。
_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # B 仓根
if not RCON_PW:
    # 密码候选链(2026-08-29 修正:现役真密码在 ops/docker/shadow/data/rcon-secret.txt,
    # utf-8-sig 读;B仓根 mc-data 是旧世遗留错密码——旧链曾致整桥 RCON 静默哑火:
    # 认证失败不抛错只回空串,反射/慢系统全降级,极难察觉。与 mcp_numen._read_rcon_pw 同源。)
    _secret_candidates = [
        os.environ.get("MC_RCON_SECRET"),
        os.path.join(_REPO, "ops", "docker", "shadow", "data", "rcon-secret.txt"),  # 现役真源
        "/root/mc-data/rcon-secret.txt",   # 容器内路径（镜像布局）
        "/app/mc-data/rcon-secret.txt",
        os.path.join(_REPO, "mc-data", "rcon-secret.txt"),  # 旧世兜底(防回滚场景)
    ]
    _secret_candidates = [c for c in _secret_candidates if c]
    for _cand in _secret_candidates:
        if os.path.isfile(_cand):
            _val = open(_cand, "r", encoding="utf-8-sig").read().strip()
            if _val:
                RCON_PW = _val
                break
if not RCON_PW:
    raise SystemExit("缺少 RCON_PASSWORD 环境变量（见 .env / docker-compose；可设 MC_RCON_SECRET 指定 secret 文件）")
CONSOLE_URL = os.environ.get("QWENPAW_CONSOLE_URL", "http://127.0.0.1:8088/api/console/chat")
# 已归位 B 仓 sidecar/guard/：账本写本仓 data/（不再跨仓引 A 仓旧 data 目录）
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(REPO_ROOT, "data")

# ---- 守卫「眼」渲染（2026-08-23）：亲卫 qwen3.8 实测支持视觉，低频喂守卫位置截图 ----
# 渲染脚本 guard-render.mts：mineflayer 临时 RenderBot → RCON tp 到守卫坐标 → viewer → 无头截图
NODE_EXE = os.environ.get("NODE_EXE", r"C:\Program Files\nodejs\node.exe")
TSX_CLI = os.environ.get("TSX_CLI", os.path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs"))
RENDER_SCRIPT = os.path.join(REPO_ROOT, "sidecar", "guard", "guard-render-pure.mts")
RENDER_SCRIPT_FP = os.path.join(REPO_ROOT, "sidecar", "guard", "guard-render-webgl.mts")
RENDER_EVERY_N = 8            # 每 N 轮至少渲一张（20s/轮 → 约 2.5 分钟一帧）
RENDER_MOVE_MIN = 20.0        # 位置变化 ≥ 此距离(格) 提前重渲
RENDER_TIMEOUT = 100          # 单次渲染超时（秒）；失败吞掉不阻塞主流程

# 两穿越者：身体登录名(login, ASCII) + 显示名(name, 中文) -> 亲卫 agent + 持久 session
# 铁律 name/ID 分离（2026-08-23 造物主定调）：numen_act 等程序化操作用 login（Kirito/Naruto），
# 通道文件（chant/pray/goddess-orders 的 speaker/to/key）与亲卫叙事用 name（桐人/鸣人）。
GUARDS = [
    {"name": "桐人", "login": "Kirito", "agent": "mc-guard-kirito", "session": "guard:kirito-default-20260824", "tag": "kirito", "autonomy": True},
    {"name": "鸣人", "login": "Naruto", "agent": "mc-guard-naruto", "session": "guard:naruto-default-20260824", "tag": "naruto", "autonomy": True},
]

# ---- 与女神侧共享的通道文件（2026-08-23 造物主谕：假玩家与客户端 AI 玩家一致）----
# 咏唱/祈愿/谕示文件必须与 mc-god 世界进程同卷（默认锚 B 仓 mc-data 运行态，
# 容器化/迁移经 MC_DATA_DIR 覆盖）。守卫桥的账本仍在 B 仓 data/（DATA），与此无关。
# 2026-08-26 AUDIT-01 修复：默认值曾指向 A 仓旧世界目录（迁移遗留），
# 鸣人 2026-08-22 起所有咏唱/祈愿全部写进旧目录石沉大海（积压 2977 条无人消费）。
# 现役主服世界数据在 B 仓 mc-data/，跟随 REPO_ROOT 走（迁移也不怕）。
WORLD_DATA = os.environ.get("MC_DATA_DIR", os.path.join(REPO_ROOT, "mc-data"))
CHANT_REQ = os.path.join(WORLD_DATA, "chant-requests.jsonl")      # 亲卫 chant → 女神（快路径咏唱）
CHANT_REPLY = os.path.join(WORLD_DATA, "chant-reply.jsonl")       # 女神回执 → 守卫桥注入亲卫
GOD_INBOX = os.path.join(WORLD_DATA, "god-inbox.jsonl")           # 亲卫 pray → 女神收件箱
GODDESS_ORDERS = os.path.join(WORLD_DATA, "goddess-orders.jsonl") # 女神主动谕示 → 守卫桥注入亲卫
PLAYER_CHAT = os.path.join(WORLD_DATA, "player-chat.jsonl")        # 玩家公屏发言 → 守卫桥注入亲卫（回应玩家）
GUARD_NAMES = set()
for _g in GUARDS:
    GUARD_NAMES.add(_g["name"]); GUARD_NAMES.add(_g["login"])      # 守卫自己名字（避免听自己说话而回应自己）
# 回执/谕示多守卫共享读（桐人/鸣人双线程），锁内"读-分流-写回-清空"原子
_MSG_LOCK = threading.Lock()

# 每轮节奏（秒）
DECIDE_INTERVAL = 20      # 空闲时：决策+执行一轮后休息
BUSY_POLL = 6             # 有任务在跑时：只轮询，不决策
LOST_POLL = 30            # 伴链断连时：只降频心跳（身体实体不在，别刷无效动作）

def _reattach_if_lost(g, threshold=5):
    """T006-d（2026-08-29 天神）：伴链断连不再干等——连续断连≥threshold 轮（30s×5≈2.5min）
    主动 RCON 召唤重挂 numen_act summon Goddess <login>。只在「确认实体不在」的分支调用：
    活实体走不到这里，无重复召唤风险；summon 失败只记日志不抛出，下轮再试。"""
    g["_lost_streak"] = g.get("_lost_streak", 0) + 1
    if g["_lost_streak"] < threshold:
        return
    g["_lost_streak"] = 0
    try:
        out = R.cmd('numen_act summon Goddess "%s"' % g["login"])
        log("🔁 %s 断连 %d 轮主动召唤重挂：numen_act summon Goddess %s → %s" % (g["name"], threshold, g["login"], out))
        feed_append(g, "reattach", "断连%d轮主动重挂 summon Goddess %s" % (threshold, g["login"]))
    except Exception as e:
        log("🔁 %s 主动重挂异常：%s" % (g["name"], e))

# ============ 影分身分脑（2026-08-24 造物主定调） ============
# 分身=独立进程/独立 session、上下文独立。它在的时候是一个独立的"分脑"意识：
# 守卫桥为每个在册 Kage 开一个独立 QwenPaw session（复用施术者 agent id），提示词明确"你是影分身"；
# 分身用 kage_* 系列工具驱动自己（绝不碰 goto/mine 等本体工具，否则会移动本体鸣人）。
# 分身血线 <50%(HP<10) 自动解散；分身消失（不在 roster）时把它的见闻融合回本体（上下文+记忆双路）。
KAGE_NAMES = ["Kage1", "Kage2"]
KAGE_CASTER_AGENT = "mc-guard-naruto"   # 分身属于鸣人（复用其 agent，但 session 独立）
KAGE_CASTER_LOGIN = "Naruto"
KAGE_CASTER_SESSION = "guard:naruto-default-20260824"   # 鸣人本体 session（融合记忆注入点）
KAGE_HP_DIE = 10.0       # 血线 50%（20→10）以下 → 解散并融合
KAGE_POLL = 8            # 分身轮询节拍
KAGE_FUSE_FILE = os.path.join(DATA, "kage-fusion-naruto.jsonl")  # 分身记忆 → 本体下轮读取注入
MAX_RUN_SECONDS = 0       # 0 = 无限循环（常驻）；>0 用于试运行

# 任务熔断阈值（QwenPaw 决策 loop 不僵死的核心）：
# 有界任务跑得比这久/预算快耗尽 → 主动 task_stop 让亲卫重议，绝不无限轮询。
MAX_TASK_RUN_ELAPSED = 420   # 有界任务最长跑多少秒（7 分钟）即熔断
# 已弃用：绝不用"绝对预算剩余"判熔断——goto 移动任务预算天然几十秒(30s+距离)，
# 剩 39s 是正常，按它熔断会让身体"受理即蒸发、站位不动(numen 自己会 deadline 超时收尾)"。
# MAX_TASK_BUDGET_STOP = 60
MAX_TASK_DEAD_ELAPSED = 150  # 有界任务"死任务"早拆除线：攻击/采集等预期有限的动作打这么久还不收尾，
                             # 说明卡死（如 attack 打了 300s 还在"战斗 0/1"），提前 task_stop 让亲卫重议；
                             # 正常一只怪/几棵树不会超过此线。亲卫重发会重议，不损剧情。
# 常驻任务（follow 类无界）的僵住，不以"纯时长"判定（跟随主人是合法行为，会误伤正常跟随），
# 而以"主人是否仍有效在场"判定：主人离线/遥不可及才强制换活（见 _owner_valid）。

# 动作白名单（亲卫可驱动身体做的；不含任何世界级/创造级动作）
TOOL_WHITELIST = {
    # 感知（查询型，当场回）
    "get_self_status", "look_around", "scan_nearby_entities", "scan_blocks",
    "inspect_block", "get_world_info", "get_owner_status", "task_status",
    "lookup_recipe", "locate_biome", "locate_structure",
    # 移动
    "goto",
    # 采集 / 生存 / 战斗
    "mine", "collect_items", "fish", "eat", "sleep", "attack", "follow",
    # 制作 / 交互
    "craft", "equip_item", "interact_at", "interact_entity", "close_gui", "inspect_gui",
    "transfer",
    # 技能篇 / 进阶(2026-08-29 37 工具对齐)
    "fish", "build", "blueprint", "blueprint_read", "set_timer", "drop_items",
    "get_owner_status", "scaffold_materials", "inspect_block", "inspect_block_storage",
    "list_skills", "read_skill",
    # 说话（独立命令 numen_act say，非 invoke 工具）
    "say",
    # 与女神侧通信（2026-08-23：文件通道，非世界级动作）
    "chant",  # 咏唱已学技能（等价私语念咒 → chant-requests.jsonl → 女神侧 castSpell）
    "pray",   # 祈愿上达天神（→ god-inbox.jsonl → 女神收件箱）
    # 控制
    "task_stop", "todowrite",
}

# 判定常驻任务（follow）的"主人是否还在有效在场"。
# 保守原则：**只有明确证据主人已离线/遥不可及才返回 False**；无法判断/拿不到状态 → 返回 True（不误伤正常跟随）。
def _owner_valid(owner_status):
    if not owner_status or not isinstance(owner_status, dict):
        return True  # 拿不到主人状态 → 保守放行，不强制换活
    # 允许成功字段直接表达"无人/离线"
    text = json.dumps(owner_status, ensure_ascii=False)
    # 明确的离线 / 找不到主人标记 → 主人无效
    offline_markers = ["offline", "no owner", "没有主人", "无需主人", "离线", "主人不在", "no companion", "not found", "null"]
    for m in offline_markers:
        if m in text.lower():
            return False
    # 有坐标且距离极远（>256 格）→ 视为遥不可及，跟随无意义
    try:
        pos = owner_status.get("pos") or owner_status.get("position") or owner_status.get("location")
        if isinstance(pos, (list, tuple)) and len(pos) >= 3:
            return True  # 有坐标就不轻易判远（body 位置不同步，避免误伤）
    except Exception:
        pass
    return True


# 决策 prompt 模板：喂给亲卫，让它输出一个动作 JSON
def decision_prompt(g, status, world, look, scan, last_act, goal, standing_task=None, standing_stuck=False, emergency=None, goddess_msgs=None, player_msgs=None):
    # 2026-08-23：女神侧回执/谕示注入（chant 回执、祈愿神谕、主动守望谕示）。
    # 假玩家没有 mineflayer whisper，女神的话经此文件通道送达，亲卫"听见"后决定怎么回应/行动。
    goddess_hint = ""
    if goddess_msgs:
        parts = []
        for m in goddess_msgs:
            kind = "神谕" if m.get("kind") == "prayer" else ("咏唱回执" if m.get("kind") == "chant" else "女神谕示")
            txt = str(m.get("reply") or m.get("text") or "").strip()
            if txt:
                parts.append(f"【{kind}】{txt}")
        if parts:
            goddess_hint = "\n".join([
                "女神刚对你说了话（务必回应：若她点出你的处境/可用技能，就照做或回话）：",
                "\n".join(parts),
                "—— 你可以 say 回应女神，也可以按她的指点行动（如她提醒你念'圣愈'，就输出 chant）。",
            ])
    player_hint = ""
    if player_msgs:
        p_parts = [f"{u}: {t}" for u, t in player_msgs]
        player_hint = "\n".join([
            "【⚠ 玩家刚才在公屏说话（你能听见）——若他叫你、向你搭话、或值得你接话，就 say 回应；无关/闲聊当没听见】",
            "\n".join(p_parts[-6:]),
            "—— 需要回应时说：{\"tool\":\"say\",\"args\":{\"message\":\"<一句话>\"}}。",
        ])
    # 常驻任务空转过久的强出口：喂给亲卫"务必换活"的明确指令（自主导向，不诱导主人概念）
    stuck_hint = ""
    if standing_stuck:
        stuck_hint = (
            f"\n【⚠ 常驻任务『{standing_task}』已空转太久】你一直停在原地，身体没有实质推进——"
            f"这不是任务坏掉，而是你被它占着没换活。你是自主智能体，此刻必须脱离它、做一件有推进的事：\n"
            f"- 目标已不存在（目标离线/远离/无可护卫）→ 立刻用新动作（goto/mine/eat/sleep/attack 等）顶替它；\n"
            f"- 若你卡在原地一动不动 → 另找一个切实的目标去推进（找吃的、找庇护所、采集）；\n"
            f"- 别再输出 follow 或发呆。输出一个『有推进的身体动作』。"
        )
    # 濒死急救强出口：身体危险高于一切——盖过战斗/采集，一律先保命。
    emergency_hint = ""
    if emergency:
        em_reason = emergency.get("reason", "身体危急")
        emergency_hint = (
            f"\n【⚠ 濒死急救 —— 最高优先级】你的身体此刻『{em_reason}』，随时可能倒下。"
            f"这是生死关头，其它一切任务（战斗/采集/砍树/跟随）全部作废，此刻只做能续命的动作：\n"
            f"- 若有能吃的（背包里有 bread/熟肉/毒土豆等）→ 立刻 eat 顶饥饿止血；\n"
            f"- 若身处野外且周边有怪 → 立刻 attack 只打贴脸的、或 goto 逃回安全庇护所（村屋/床/洞口）；\n"
            f"- 若已在村里/庇护所旁 → goto 进屋、sleep 躺下回血，务必先活过今晚；\n"
            f"- 只有等你脱离『{em_reason}』（血压回升、饥饿补上）才能恢复其它目标。\n"
            f"绝对不要：继续打打不过的怪、继续砍树采矿、继续跟主人或发呆。输出一个『立即续命』的动作。"
        )
    return "\n".join([
        f"【时间线·现在】{_timeline(status, world)}",
        f"【{g['name']}身体快照】{status}",
        f"【世界】{world}",
        f"【周围地形 look_around】\n{look}",
        f"【附近实体 hostile】{scan}",
        f"【上一动作】{last_act or '（无，这是第一轮）'}",
        f"【当前任务（常驻）】{standing_task or '（无——身体空闲）'}{stuck_hint}",
        f"【当前目标】{goal or '（尚未立下目标——结合处境先定一个眼前该办的正事）'}",
        emergency_hint,
        goddess_hint,
        player_hint,
        "【话音·主动听】想知道玩家/女神/系统刚说了什么？主动调 get_recent_messages 去听（它列出玩家公屏、女神谕示、咏唱回执、系统消息）。若有人叫你/向你搭话/值得回应，就 say 接话；无关/闲聊当没听见。",
        "",
        f"你是亲卫（{g['agent']}），直管穿越者{g['name']}的魂。此刻他的身体由你掌舵——",
        "以他的性格（见你的 PROFILE 人物志）替他决定下一步生存动作。",
        "",
        "结合场景信息、上下文与当前目标，智能判断「此刻最该干的一件事」；",
        "不要把决策做成固定循环，也不要把上一动作机械照搬——场景变了就改道，目标达成了就换目标。",
        "",
        "只输出一个 JSON 对象，不要多余文字、不要调用工具：",
        '{"tool":"<工具名>","args":{...},"reason":"<一句话，你为何这么做>","goal":"<当前目标，未变则照抄原目标>"}',
        "",
        "可用工具（身体能执行，其余一律不要输出）：",
        '- goto：{"x":X,"z":Z} 去某处（y 自动解析地表）；或 {"block":"minecraft:oak_log"} 走到某方块旁',
        '- mine：{"block_ids":["minecraft:oak_log"],"count":8} 采集',
        '- collect_items：{} 捡拾附近掉落物',
        '- eat：{"item_id":"minecraft:bread"} 进食',
        '- attack：{} 打退近身敌怪；或 {"entity_ids":[id]}',
        '- sleep：{} 睡最近的床',
        '- scan_blocks：{"block_ids":["minecraft:oak_log"]} 找方块',
        '- craft：{"item_id":"minecraft:iron_sword","count":1} 合成物品（端到端：自动找配方摆格取结果）。2x2 配方随处可做；3x3 配方需身边 4 格内有工作台（crafting_table）——没有就先 craft 一张并放置。缺料会报精确差额',
        '- lookup_recipe：{"item_id":"minecraft:iron_sword"} 查合成配方材料清单——想造什么先查它，缺什么补什么再 craft',
        '- equip_item：{"item_id":"minecraft:iron_chestplate"} 穿装备（头盔/胸甲/护腿/靴子/武器上手）；或 {"item_id":...,"action":"unequip"} 脱下',
        '- interact_at：{"x":X,"y":Y,"z":Z,"button":"right"} 对方块右键交互（开门/开箱/用工作台/熔炉/床）——button 只认 left/right；手持方块 id 时对地面右键=放置方块（如放工作台：{"x":X,"y":地面Y,"z":Z,"button":"right","item_id":"minecraft:crafting_table"}）',
        '- interact_entity：{"entity_id":id,"button":"right"} 对实体右键（村民交易/喂动物/骑乘）——button 只认 left/right；entity_id 来自 scan_nearby_entities',
        '- inspect_gui：{} 查看当前打开的 GUI（箱子/交易/工作台）槽位内容——开箱/交易后先看再动',
        '- transfer：{"moves":[{"from":槽,"to":槽,"count":1}]} 在 GUI 槽位间移动物品（存箱/取物/交易确认）——槽号来自 inspect_gui',
        '- close_gui：{} 关闭当前 GUI（存取/交易完随手关）',
        '- locate_structure：{"structure":"village"} 找附近结构（village/mansion/stronghold 等），返回坐标再 goto',
        '- locate_biome：{"biome":"plains"} 找附近生物群系，返回坐标再 goto',
        '- remember_place：{"name":"家"} 把当前坐标存为命名地点（家/矿场/集合点……存一次以后随时能回）',
        '- list_places：{} 列出你存过的所有地点（拿到坐标后用 goto 过去）',
        '',
        '技能篇（遇到对应任务先学再干，照篇子走调用不容易错）：',
        '- list_skills：{} 列出可学技能篇（战斗/进阶/建造/容器/下界/屠龙/世界图鉴…）',
        '- read_skill：{"name":"tier_progression"} 读一篇技能篇正文（学流程、工具参数有现成示例）；分册传 {"name":"building_design","file":"references/japanese_minka.md"}',
        '- 打架前学 combat_basics；攒料造装备学 tier_progression；开箱存取学 containers；要盖房学 building_design——学完照着干',
        '',
        '进阶工具（按需用）：',
        '- set_timer：{"seconds":120,"reason":"熔炉那批铁锭该好了"} 定闹钟——熔炼/等待类任务定表后去干别的，别站着傻等（reason 必填）',
        '- inspect_block：{"x":X,"y":Y,"z":Z} 查一个方块是什么/硬度/能不能挖；inspect_block_storage 查方块肚里装了什么（不开箱直接查）',
        '- fish：{"count":1} 钓鱼（需钓竿）；drop_items：{"item_id":"…","count":1} 丢物品给面前的人/腾格子',
        '- get_owner_status：{} 查主人状态（在哪/HP/在不在线）——护卫场景先看主人再动',
        '- build：{"ops_json":"[...]"} 方块流建造（蓝图/建筑用，先 read_skill("building_design") 学）；blueprint：{"action":"list"} 服务器蓝图系',
        '- scaffold_materials：{"action":"list"} 管理你愿意当脚手架垫料的方块白名单',
        '- follow：{"target":"owner"} 跟随指定目标——只在「明确护卫/同行指令」时用它，否则别主动跟；',
        '- say：{"message":"<一句话>"} 以身体本人的身份在公屏说话，与在场玩家/NPC 交谈、回应别人、报平安、求援——你「开口」的唯一方式；语气要像本人（见 PROFILE 人物志与 SOUL「你怎么说话」一节）：大白话短句直说，别拽文、别书面腔、别喊口号',
        '- chant：{"spell":"归乡"} 咏唱你已学会的技能（等同私语念咒——女神侧按技能表判定：已学会的自己施法，未学会的会得到提示）——危急时优先用你掌握的法术自救；',
        '- pray：{"wish":"…"} 祈愿上达天神（危急求助、重大事项、求指引），女神按序聆听并神谕回执——别拿它当闲聊；',
        '- task_stop：{} 叫停当前动作',
        '- 感知：look_around（{radius} 附近地形）/ scan_nearby_entities（必须有 type_filter 参数，如 {"radius":16,"type_filter":"hostile"}）/ get_self_status / get_world_info / task_status',
        '',
        '常用链路（多步活按这个顺序走，一步一动，做完看回执再下一步）：',
        '- 合成链：lookup_recipe 查料 → 缺的先 mine/collect_items 补 → craft（3x3 配方身边没工作台就先 craft 一张 crafting_table，再 interact_at 手持它对地面 right 放下，然后 craft）→ 好武器/盔甲用 equip_item 穿上；',
        '- 存取链：interact_at 开箱 → inspect_gui 看槽位 → transfer 移物（存/取）→ close_gui 关箱；',
        '- 交易链：scan_nearby_entities({"type_filter":"passive"}) 找村民拿 id → interact_entity 右键 → inspect_gui 看交易 → transfer 买入 → close_gui；',
        '- 远行链：locate_structure/locate_biome 拿坐标 → goto 过去 → 到了 look_around 看环境。',
        "",
        "裁决要点：",
        "- 生存第一：饿了进食、天黑找庇护或回家睡觉、遇怪则战或避、怕深水则绕开；",
        "- 目标连贯：goal 是你此刻想办成的事（如「天黑前搭个遮雨窝」），一次只做一个动作，做完等 task_finished 再规划下一步；目标达成或不再要紧，就在本轮的 goal 里换掉；",
        "- 升级有路：石头工具→铁装→剑盾是活下来的正道——攒料（mine）→查方（lookup_recipe）→合成（craft）→穿上（equip_item），一步一动走链路，别空想；",
        "- 不贪心：不索要钻石、不造奇观，先活着、再攒生计；",
        "- 有危险优先处理危险，没事就奔着当前目标推进（砍树/采煤/觅食/回家）。",
        "",
        "常驻任务的处置（若【当前任务】是『follow』这类无终点任务）：",
        "- 你是自主智能体，不是谁的从属。follow 只在「明确护卫/同行指令」下才有意义，除此之外它不该占着你。",
        "- 若没有确切的护卫指令、或目标根本不在/已离线 → 立刻输出新的身体动作（mine/eat/goto/sleep/attack 等），新动作会自动顶替 follow（numen 语义：派别的东西就是让它停下的正常方式）。",
        "- 不要因为『有任务在跑』就什么都不做——常驻任务占着身体不等于锁死你，你永远是决策者，按自己的生存目标走。",
    ])


# ---------------- 增量感知（2026-08-23 方案A：上下文只发变化点，治"每轮全量快照堆叠"） ----------------
# 背景：守卫桥每轮把【身体快照+世界+地形+实体】全量塞进 prompt，QwenPaw 按 session 持久累积后，
# 历史里全是同构快照，信噪比极低、token 浪费。方案A：首轮/濒死/卡死用全量（decision_prompt），
# 普通轮只发"当前关键状态（紧凑行）+ 与上轮相比的变化点"；地形/实体/世界无变化就不重发。
# 亲卫的历史（scroll 窗口内）里有首轮完整说明与上一轮地形，决策信息不丢。

def _as_dict(s):
    """RCON 输出（dict 或含 JSON 的字符串）→ dict；解析失败返回 None。"""
    if isinstance(s, dict):
        return s
    if isinstance(s, str):
        m = re.search(r"\{.*\}", s, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


def _status_compact(status):
    """status → 紧凑关键行：HP/饥饿/饱和/位置/模式。解析失败返回 None。"""
    d = _as_dict(status)
    if not d:
        return None
    parts = []
    hp, mhp = d.get("hp"), d.get("max_hp", 20)
    if isinstance(hp, (int, float)) and isinstance(mhp, (int, float)):
        parts.append(f"HP {hp:.0f}/{mhp:.0f}")
    hunger = d.get("hunger")
    if isinstance(hunger, (int, float)):
        parts.append(f"饥饿 {hunger:.0f}/20")
    sat = d.get("saturation")
    if isinstance(sat, (int, float)):
        parts.append(f"饱和 {sat:.0f}")
    pos = d.get("position") or d.get("pos")
    if isinstance(pos, dict):
        pos = [pos.get("x"), pos.get("y"), pos.get("z")]
    if isinstance(pos, (list, tuple)) and len(pos) >= 3:
        parts.append(f"位置 ({pos[0]:.1f},{pos[1]:.1f},{pos[2]:.1f})")
    gm = d.get("game_mode") or d.get("gamemode")
    if gm:
        parts.append(f"模式 {gm}")
    return " ".join(parts) if parts else None


def _status_diff(old, new):
    """两条紧凑状态行的逐字段 diff（'HP 20→19(-1)'、'移动 北 4 格'）。"""
    out = []
    for label, pat in (("HP", r"HP ([\d.]+)/([\d.]+)"),
                       ("饥饿", r"饥饿 ([\d.]+)/20"),
                       ("饱和", r"饱和 ([\d.]+)")):
        mo, mn = re.search(pat, old), re.search(pat, new)
        if mo and mn and mo.group(0) != mn.group(0):
            try:
                vo, vn = float(mo.group(1)), float(mn.group(1))
                d = vn - vo
                out.append(f"{mo.group(0)}→{mn.group(0)}" + (f"({d:+.0f})" if abs(d) >= 1 else ""))
            except Exception:
                out.append(f"{mo.group(0)}→{mn.group(0)}")
    po = re.search(r"位置 \(([-\d.]+),([-\d.]+),([-\d.]+)\)", old)
    pn = re.search(r"位置 \(([-\d.]+),([-\d.]+),([-\d.]+)\)", new)
    if po and pn:
        try:
            xo, yo, zo = map(float, po.groups())
            xn, yn, zn = map(float, pn.groups())
            dist = ((xn - xo) ** 2 + (yn - yo) ** 2 + (zn - zo) ** 2) ** 0.5
            if dist >= 0.5:
                # MC 坐标：+X 东、-X 西、+Z 南、-Z 北（与 look_around 图例 North = -Z 一致）
                dx, dz = xn - xo, zn - zo
                if abs(dx) >= abs(dz):
                    dirstr = "东" if dx > 0 else "西"
                else:
                    dirstr = "北" if dz < 0 else "南"
                out.append(f"移动 {dirstr} {dist:.0f} 格")
        except Exception:
            pass
    return out


def _world_compact(world):
    """world → (规范化键, 人读串)。丢弃每 tick 变的 game_time 等，只在语义变化时触发重发。"""
    d = _as_dict(world)
    if not d:
        return None, None
    key = {k: v for k, v in d.items() if k not in ("game_time", "time_of_day", "day", "tick", "world_time")}
    norm = json.dumps(key, ensure_ascii=False, sort_keys=True)
    parts = []
    if d.get("is_dark_outside") is True:
        parts.append("夜")
    elif d.get("is_bright_outside") is True:
        parts.append("昼")
    if d.get("raining"):
        parts.append("下雨")
    if d.get("thundering"):
        parts.append("雷暴")
    dim = str(d.get("dimension", ""))
    if "nether" in dim:
        parts.append("下界")
    elif "end" in dim:
        parts.append("末地")
    elif dim:
        parts.append("主世界")
    return norm, (" ".join(parts) if parts else "?")


def _scan_entities(scan):
    """scan → (实体列表[{id,type,dist}], 威胁计数行)；解析失败返回 (None, None)。"""
    d = _as_dict(scan)
    if not d:
        return None, None
    ents = d.get("entities") or []
    rows = []
    if isinstance(ents, list):
        for e in ents:
            if not isinstance(e, dict):
                continue
            eid = e.get("entity_id") or e.get("id")
            typ = e.get("name") or e.get("type") or e.get("entity_type") or "?"
            dist = e.get("distance")
            rows.append({"id": str(eid), "type": str(typ),
                         "dist": f"@{dist:.0f}m" if isinstance(dist, (int, float)) else ""})
    counts = {}
    for r in rows:
        counts[r["type"]] = counts.get(r["type"], 0) + 1
    count_line = "敌 " + "、".join(f"{t}×{c}" for t, c in sorted(counts.items())) if rows else "敌 0"
    return rows, count_line


def _look_norm(look):
    if isinstance(look, str):
        return look.strip()
    return None


# 工具清单压缩行：增量轮每轮只发摘要（完整说明在首轮全量 prompt 里，scroll 窗口内有）
_TOOL_SUMMARY = (
    "可用工具（完整说明见你首轮收到的决策说明）：移动 goto；采集 mine；捡物 collect_items；吃 eat；睡 sleep；"
    "战斗 attack；找方块 scan_blocks；跟随 follow（仅明确护卫/同行时）；说话 say（你开口的唯一方式）；"
    "咏唱 chant（已学技能自施）；祈愿 pray（上达天神）；叫停 task_stop；"
    "合成 craft（3x3 需身边工作台）/查方 lookup_recipe；穿装备 equip_item；"
    "方块右键 interact_at（开门/开箱/熔炉/手持方块放置）；实体右键 interact_entity（村民交易）；"
    "看界面 inspect_gui；移物 transfer；关界面 close_gui；找结构 locate_structure；找群系 locate_biome；"
    "感知 look_around / scan_nearby_entities / get_self_status / get_world_info / task_status；"
    "地点记忆 remember_place / list_places；"
    "技能篇 list_skills / read_skill（打战/进阶/建造/容器任务先学再干）；"
    "进阶 set_timer（熔炼等待定闹钟）/ inspect_block / fish / drop_items / get_owner_status / build / blueprint / scaffold_materials"
)


def _timeline(status, world):
    """时间线锚点：每轮必须插入『当前时间+当前坐标』——上下文是累计的，缺了它 agent 会在长历史里
    分不清『现在是几点、我在哪』。取现实时间 + 游戏第几天/钟点/昼夜天气 + 当前坐标。"""
    d = _as_dict(world) or {}
    now = time.strftime("%m-%d %H:%M:%S")
    bits = [f"现实 {now}"]
    day = d.get("day")
    if isinstance(day, (int, float)) and not isinstance(day, bool):
        bits.append(f"第{int(day)}天")
    tod = d.get("time_of_day")
    if isinstance(tod, (int, float)) and not isinstance(tod, bool):
        try:
            v = float(tod)
            hrs = (v / 1000.0) % 24.0 if v > 1000 else (v * 24.0) % 24.0
            hh, mm = int(hrs), int((hrs - int(hrs)) * 60)
            bits.append(f"游戏 {hh:02d}:{mm:02d}")
        except Exception:
            pass
    if d.get("is_dark_outside") is True:
        bits.append("夜")
    elif d.get("is_bright_outside") is True:
        bits.append("昼")
    if d.get("raining"):
        bits.append("雨")
    if d.get("thundering"):
        bits.append("雷暴")
    pos = _status_pos(status)
    if pos:
        bits.append(f"坐标 ({pos[0]:.1f},{pos[1]:.1f},{pos[2]:.1f})")
    return "｜".join(bits)


def delta_prompt(g, status, world, look, scan, last_act, goal, prev,
                 standing_task=None, standing_stuck=False, emergency=None, goddess_msgs=None, player_msgs=None):
    """增量决策 prompt：当前关键状态（紧凑行）+ 与上轮相比的变化点。prev 是上轮缓存 dict。"""
    lines = []
    lines.append(f"【时间线·现在】{_timeline(status, world)}")
    sc = _status_compact(status)
    if sc:
        lines.append(f"【身体】{sc}")
    # —— 变化块 ——
    delta_bits = []
    old_sc = prev.get("status_compact")
    if old_sc and sc and sc != old_sc:
        delta_bits.extend(_status_diff(old_sc, sc))
    wnorm, wread = _world_compact(world)
    old_wnorm = prev.get("world_norm")
    if wnorm:
        if old_wnorm and wnorm != old_wnorm:
            delta_bits.append(f"世界：{prev.get('world_read') or '?'}→{wread}")
        elif not old_wnorm:
            delta_bits.append(f"世界：{wread}")
    ents, count_line = _scan_entities(scan)
    old_ents = prev.get("scan_ids") or set()
    if ents is not None:
        cur_ids = {(e["id"], e["type"]) for e in ents}
        added = cur_ids - old_ents
        gone = old_ents - cur_ids
        if added:
            delta_bits.append("新增威胁：" + "、".join(f"{t}(id {i})" for i, t in sorted(added)))
        if gone:
            delta_bits.append("威胁消失：" + "、".join(f"{t}(id {i})" for i, t in sorted(gone)))
        if not added and not gone and old_ents:
            delta_bits.append(f"威胁无变化（{count_line}）")
        elif ents:
            delta_bits.append(count_line)
    lines.append("【变化】" + ("；".join(delta_bits) if delta_bits else "无重大变化"))
    # —— 地形（仅变化时重发；位置没动、地形没变则省略，亲卫历史里有上轮地图）——
    ln = _look_norm(look)
    old_ln = prev.get("look_norm")
    if ln:
        if old_ln and ln != old_ln:
            lines.append(f"【周围地形（较上轮已变）】\n{ln[:800]}")
        elif not old_ln:
            lines.append(f"【周围地形】\n{ln[:800]}")
    # —— 上轮动作 / 任务 / 目标 ——
    lines.append(f"【上一动作】{last_act or '（无，这是第一轮）'}")
    lines.append(f"【当前任务（常驻）】{standing_task or '（无——身体空闲）'}")
    lines.append(f"【当前目标】{goal or '（尚未立下——结合处境先定一件正事）'}")
    # —— 强出口提示 ——
    if emergency:
        lines.append(f"【⚠ 濒死急救】{emergency.get('reason')}——只输出续命动作：eat / goto 庇护所 / sleep / attack 贴脸怪。")
    elif standing_stuck:
        lines.append("【⚠ 常驻任务空转太久】目标已无意义——立刻换一个有推进的身体动作（goto/mine/eat/sleep/attack），别再 follow/发呆。")
    # —— 话音：亲卫主动听（a 步·守卫桥纯监护化：不再喂消息内容，改由 agent 主动感知）——
    lines.append("【话音·主动听】你想知道玩家/女神/系统刚才说了什么？主动调 get_recent_messages 去听（它列出玩家公屏、女神谕示、咏唱回执、系统消息）。"
                 "若某人叫你/向你搭话/值得回应，就 say 接话；无关/闲聊当没听见。")
    # —— 输出格式（保留，亲卫每轮输出依赖）——
    lines.append("")
    lines.append("只输出一个 JSON 对象，不要多余文字、不要调用工具：")
    lines.append('{"tool":"<工具名>","args":{...},"reason":"<一句话，你为何这么做>","goal":"<当前目标，未变则照抄原目标>"}')
    lines.append(_TOOL_SUMMARY)
    lines.append("裁决要点：生存第一（饿了吃、天黑躲/睡、遇怪战或避、怕深水绕开）；目标连贯（goal 未变照抄）；不贪心；危险优先。")
    return "\n".join(lines)


# ---------------- 女神通道（2026-08-23：咏唱/祈愿/谕示） ----------------
def drain_msgs(g):
    """读女神侧回执/谕示：返回本守卫相关的消息列表（chant-reply 按 speaker、
    goddess-orders 按 to），其余写回文件。多守卫共享读，锁内原子。"""
    mine = []
    with _MSG_LOCK:
        for path, field in ((CHANT_REPLY, "speaker"), (GODDESS_ORDERS, "to")):
            if not os.path.exists(path):
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    lines = [l for l in f.read().splitlines() if l.strip()]
            except Exception:
                continue
            if not lines:
                continue
            keep = []
            for ln in lines:
                try:
                    rec = json.loads(ln)
                    target = str(rec.get(field, "")).strip()
                except Exception:
                    keep.append(ln)
                    continue
                if target == g["login"]:
                    mine.append(rec)
                else:
                    keep.append(ln)
            try:
                with open(path, "w", encoding="utf-8") as f:
                    f.write("\n".join(keep) + ("\n" if keep else ""))
            except Exception:
                pass
    return mine


def drain_player_chat(g, cursor):
    """读玩家公屏聊天（自 cursor 之后的新行），排除守卫本人（避免听自己说话而回自己），
    返回 [(user, text)...] 与更新后的 cursor。玩家聊天文件与女神通道同卷（WORLD_DATA）。"""
    if not os.path.exists(PLAYER_CHAT):
        return [], cursor
    try:
        with open(PLAYER_CHAT, "r", encoding="utf-8") as f:
            lines = [l for l in f.read().splitlines() if l.strip()]
    except Exception:
        return [], cursor
    if cursor > len(lines):
        cursor = 0  # 文件被清/重写，重置游标
    new = []
    for ln in lines[cursor:]:
        try:
            rec = json.loads(ln)
            user = str(rec.get("user", "")).strip()
            text = str(rec.get("text", "")).strip()
        except Exception:
            continue
        if not user or not text:
            continue
        if user in GUARD_NAMES:   # 守卫自己说话（桐人/鸣人/Kirito/Naruto）——不转回给守卫
            continue
        new.append((user, text))
    return new, len(lines)


def append_chant_req(name, spell):
    """亲卫 chant → chant-requests.jsonl（女神侧 consumeChantRequests 消费）。"""
    try:
        with open(CHANT_REQ, "a", encoding="utf-8") as f:
            f.write(json.dumps({"speaker": name, "text": spell, "ts": int(time.time() * 1000)}, ensure_ascii=False) + "\n")
        return True
    except Exception as e:
        log(f"chant req 写盘失败：{e}")
        return False


def append_prayer(g, wish, status=None):
    """亲卫 pray → god-inbox.jsonl（asPlayer=true：女神按玩家祈愿路径裁决，神谕双写 chant-reply）。"""
    situation = ""
    if status:
        situation = str(status)[:120]
    try:
        with open(GOD_INBOX, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "key": g["login"], "wish": wish, "display": g["name"],
                "asPlayer": True, "situation": situation, "ts": int(time.time() * 1000),
            }, ensure_ascii=False) + "\n")
        return True
    except Exception as e:
        log(f"prayer 写盘失败：{e}")
        return False


# ---------------- RCON ----------------
class Rcon:
    def __init__(self):
        self._lock = threading.Lock()

    def cmd(self, command):
        with self._lock:
            return self._cmd_locked(command)

    @staticmethod
    def _recv_exact(s, n):
        """精确读 n 字节（RCON 包带 length 前缀，读够即回，不靠超时）。"""
        buf = b""
        while len(buf) < n:
            chunk = s.recv(n - len(buf))
            if not chunk:
                break
            buf += chunk
        return buf

    @staticmethod
    def _cmd_locked(command):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(15)
        try:
            s.connect((RCON_HOST, RCON_PORT))
            p = RCON_PW.encode("utf-8")
            s.send(struct.pack("<iii", len(p) + 10, 1, 3) + p + b"\x00\x00")
            # 认证响应：读 12 字节 header 定长度，再读 body
            hdr = Rcon._recv_exact(s, 12)
            if len(hdr) < 12:
                return "(no auth response)"
            alen, _, _ = struct.unpack("<iii", hdr[:12])
            Rcon._recv_exact(s, alen - 8)
            # 发命令
            cp = command.encode("utf-8")  # 真 UTF-8，不 backslashreplace
            s.send(struct.pack("<iii", len(cp) + 10, 2, 2) + cp + b"\x00\x00")
            # 读响应：第一个包可能分片，但 header 的 length 给的是本包 body 长度；
            # Vanilla RCON 命令响应通常单包，这里按单包 length 读，读完即回。
            hdr2 = Rcon._recv_exact(s, 12)
            if len(hdr2) < 12:
                return "(no response)"
            length, _, _ = struct.unpack("<iii", hdr2[:12])
            body = Rcon._recv_exact(s, length - 8)
            return body.decode("utf-8", errors="replace").rstrip("\x00")
        except Exception as e:
            return f"(error: {e})"
        finally:
            s.close()


R = Rcon()

def invoke(name, tool, args=None):
    """numen_act invoke <name> <tool> <json>；name=登录名(ASCII)，双引号包裹。"""
    a = json.dumps(args if args is not None else {}, ensure_ascii=False)
    cmd = f'numen_act invoke "{name}" {tool} {a}'
    out = R.cmd(cmd)
    return out


def query(name, tool, args=None):
    """查询型工具：直接返回解析后的 JSON（尽力）。"""
    out = invoke(name, tool, args)
    m = re.search(r"\{.*\}", out, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return {"raw": out}


# 参数归一化：亲卫决策返回的工具 args 可能缺必填参数，这里按工具补默认，
# 避免 invoke 时报 missing required argument（自主循环健壮性）。
# 2026-08-26 AUDIT-03：say 同文本冷却表（120s 去重，防公屏刷屏）
_SAY_RECENT = {}
_DEFAULT_ARGS = {
    "scan_nearby_entities": {"radius": 16, "type_filter": "hostile"},
    "scan_blocks": {"block_ids": ["minecraft:oak_log"]},
    "look_around": {"radius": 8},
    "mine": {"block_ids": ["minecraft:oak_log"], "count": 8},
    "get_self_status": {},
    "get_world_info": {},
    "task_status": {},
}
def _normalize_args(tool, args):
    """按工具补默认参数；已给的键不覆盖。args 非 dict 时重置为 dict。"""
    if args is None:
        args = {}
    if not isinstance(args, dict):
        try:
            args = dict(args)
        except Exception:
            args = {}
    defaults = _DEFAULT_ARGS.get(tool)
    if defaults:
        for k, v in defaults.items():
            # 空值才算缺：None / 空串 / 空列表 / 空 dict 都补默认（已给的合法值不覆盖）
            cur = args.get(k)
            _missing = (cur is None) or (cur == "") or (cur == []) or (cur == {})
            if _missing:
                args[k] = v
    return args


# 从 get_self_status 返回（可能是 JSON 字符串或 dict）中解析 hp / hunger / position。
# 解析失败返回 None（调用方据此跳过濒死判定，不误伤）。
def _parse_health(status):
    d = None
    if isinstance(status, dict):
        d = status
    elif isinstance(status, str):
        m = re.search(r"\{.*\}", status, re.S)
        if m:
            try:
                d = json.loads(m.group(0))
            except Exception:
                d = None
    if not d:
        return None
    hp = d.get("hp")
    hunger = d.get("hunger")
    pos = d.get("position")
    if not isinstance(hp, (int, float)):
        hp = None
    if not isinstance(hunger, (int, float)):
        hunger = None
    return {"hp": hp, "hunger": hunger, "pos": pos}


# ---------------- console/chat 调亲卫 ----------------
def call_guard(agent, session, prompt, images=None):
    content = [{"type": "text", "text": prompt}]
    if images:
        # 2026-08-23/24：守卫「眼」——亲卫视觉模型支持 image_url，图插在文本前；
        # 2026-08-24 起一次给两张：fp 广角第一人称 + top 正俯视全景（描述在 prompt 中说明）。
        for b64 in images:
            content.insert(0, {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
    payload = {
        "channel": "console",
        "user_id": f"guard:{session}",
        "session_id": session,
        "input": [{"role": "user", "content": content}],
    }
    req = urllib.request.Request(
        CONSOLE_URL, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Agent-Id": agent}, method="POST")
    message_id, pending = None, {}
    with urllib.request.urlopen(req, timeout=240) as r:
        for raw in r:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            try:
                d = json.loads(line[5:])
            except Exception:
                continue
            if d.get("object") == "message":
                if d.get("type") == "message":
                    message_id = d.get("id")
                continue
            if d.get("object") == "content" and isinstance(d.get("msg_id"), str):
                t = (d.get("data") or {}).get("text") or d.get("text") or ""
                if not t:
                    continue
                slot = pending.setdefault(d["msg_id"], {"delta": "", "full": ""})
                if d.get("delta") is False:
                    slot["full"] = t
                else:
                    slot["delta"] += t
    if message_id and message_id in pending:
        s = pending[message_id]
        return (s["delta"] or s["full"])
    return ""


def extract_action(text):
    """从亲卫回复里扒出动作 JSON。"""
    s, e = text.find("{"), text.rfind("}")
    if s == -1 or e <= s:
        return None
    try:
        return json.loads(text[s:e + 1])
    except Exception:
        return None


# ---------------- 守卫「眼」渲染（2026-08-23） ----------------
def _status_pos(status):
    """status → (x, y, z)；解析失败返回 None。"""
    d = _as_dict(status)
    if not d:
        return None
    pos = d.get("position") or d.get("pos")
    if isinstance(pos, dict):
        pos = [pos.get("x"), pos.get("y"), pos.get("z")]
    if isinstance(pos, (list, tuple)) and len(pos) >= 3:
        try:
            return (float(pos[0]), float(pos[1]), float(pos[2]))
        except Exception:
            return None
    return None


def render_guard_eye(g, x, y, z):
    """渲染守卫位置画面，返回 {"fp": b64}（MindCraft 式第一人称，带透视深度，2026-08-24）。

    调 guard-render-webgl.mts：RenderBot 连入 → RCON 切 spectator+tp → node-canvas-webgl headless
    3D 第一人称渲染（显示更精确 + 带深度信息）。俯视雷达图由 agent 经 MCP render_view(mode='top') 按需取。
    RCON 密码经 env 传入（不落盘）；直连主服 25599（25565 皮肤代理会拒陌生 bot）。
    """
    try:
        rot_out = R.cmd(f'data get entity "{g["login"]}" Rotation')
        m = re.search(r"\[([-\d.]+)[fd]?,\s*([-\d.]+)[fd]?\]", rot_out or "")
        yaw, pitch = (m.group(1), m.group(2)) if m else ("", "")
    except Exception:
        yaw = pitch = ""
    out = os.path.join(DATA, f"guard-eye-{g['tag']}.jpg")
    env = dict(os.environ)
    env["RCON_PW"] = RCON_PW
    env.setdefault("MC_PORT", "25599")    # 直连主服
    env.setdefault("RCON_PORT", "25575")
    cmd = [NODE_EXE, TSX_CLI, RENDER_SCRIPT_FP,
           f"{x:.1f}", f"{y:.1f}", f"{z:.1f}", out, yaw, pitch, "12"]
    try:
        subprocess.run(cmd, capture_output=True, timeout=RENDER_TIMEOUT,
                       env=env, cwd=REPO_ROOT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception as e:
        print(f"[guard-eye] {g['name']} 渲染守卫之眼失败：{e}", flush=True)
        return None
    if os.path.isfile(out) and os.path.getsize(out) > 1000:
        try:
            with open(out, "rb") as f:
                return {"fp": base64.b64encode(f.read()).decode("ascii")}
        except Exception as e:
            print(f"[guard-eye] {g['name']} 读截图失败：{e}", flush=True)
    return None


# ---------------- 记录 ----------------
def feed_append(g, kind, text):
    try:
        p = os.path.join(DATA, f"guard-drive-{g['tag']}.jsonl")
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": kind,
                "name": g["name"], "text": text[:400],
            }, ensure_ascii=False) + "\n")
    except Exception:
        pass


# ---------------- 单穿越者驱动循环 ----------------
def drive_loop(g, stop_at):
    log = lambda msg: print(f"[{g['name']}] {msg}", flush=True)
    last_act = None
    goal = None
    round_n = 0
    # —— 增量感知缓存（2026-08-23 方案A）：普通轮只发变化点；首轮/濒死/卡死发全量 ——
    prev = {"status_compact": None, "world_norm": None, "world_read": None,
            "look_norm": None, "scan_ids": set()}
    # —— 任务熔断推进追踪（QwenPaw 决策 loop 不僵死）——
    # 记录当前有界任务启动时间（elapsed_s 由 numen 给，但 start_ts 便于守卫桥侧判断持续时间）
    task_start_ts = None          # 当前"正在跑的任务"首次观察到的墙上时钟
    task_prev_elapsed = 0         # 上一次观察到的 elapsed_s（用于检测任务是否推进）
    last_pos = None               # 上一轮身位（x,y,z），用于"是否推进"熔断
    log(f"亲卫桥启动 agent={g['agent']} session={g['session']}")
    # 玩家聊天游标（每守卫独立、持久化，避免重读历史刷爆上下文）
    pcursor = 0
    pcursor_path = os.path.join(DATA, f"guard-player-{g['tag']}.cursor")
    try:
        with open(pcursor_path, "r", encoding="utf-8") as f:
            pcursor = int((f.read().strip() or "0"))
    except Exception:
        pcursor = 0
    while True:
        if stop_at and time.time() >= stop_at:
            log("试运行时间到，退出")
            return
        round_n += 1
        current_task = None
        # 清空当轮"是否被熔断跳过"标志（有任务刚被叫停/顶替，本轮不派新动作）
        tripped = False
        # 濒死急救标志（本轮身体危急 → 只喂保命动作，盖过一切任务）
        emergency = None
        try:
            # 1. 查任务状态：有"有界"任务在跑就先等，不派新动作；但"不僵死"是关键——
            #    a) 有界任务跑太久 / 预算快耗尽 → 主动 task_stop 熔断，让亲卫重议（救活卡死任务）；
            #    b) 常驻任务（follow 类，无终点、永不 task_finished）不锁死决策，喂给亲卫判断，
            #       但空转过久也视为僵住，强制给亲卫"脱离跟随"强出口。
            #    numen 语义："派别的身体动作就顶替它"，task_stop 是显式叫停。
            STANDING_TASKS = {"follow", "follow_entity"}
            # 常驻任务"卡住"强出口标记：默认 False，只有常驻任务空转超时才置 True
            standing_stuck = False
            ts = query(g["login"], "task_status")
            if isinstance(ts, dict) and ts.get("success") is True:
                msg = ts.get("message", "")
                data = ts.get("data") or {}
                task_name = str(data.get("task", "")).strip()
                budget_left = data.get("budget_left_s")
                elapsed_s = data.get("elapsed_s")
                task_id = str(data.get("task_id", "") or "")
                is_standing = (
                    task_name in STANDING_TASKS
                    or (isinstance(budget_left, (int, float)) and budget_left > 1000000)
                )
                # —— 熔断判定：有界任务卡死/超时 → task_stop ——
                # 关键：绝不用"绝对预算剩余"判熔断——goto 这类移动任务的预算天然只有几十秒
                # (numen 给 30s+距离)，剩 39s 是正常进行中，被 budget_ok 误熔断会让身体
                # "受理即蒸发、站位不动"。numen 的有界任务自己会 deadline 超时收尾，守卫桥
                # 只需处理"elapsed 远超合理值还不收尾"的死任务(如 attack 卡 300s 仍战斗 x/y)。
                if not is_standing and "空闲" not in msg and "没有后台任务" not in msg:
                    # 2026-08-24 用户拍板"守卫桥规则少一点"：去掉「死任务熔断」；
                    # goto 长距导航常超 150s 被误掐，numen 有界任务自带 deadline 收尾，守卫桥不再代拆、不再做打断。
                    feed_append(g, "busy", msg[:200])
                    time.sleep(BUSY_POLL)
                    continue
                elif is_standing:
                    # 常驻任务：不锁死决策，但把"当前在跟随/常驻"状态喂给亲卫判断。
                    # 跟随主人是合法常驻行为，绝不按"纯时长"判定僵住（会误伤正常跟随）。
                    # 只判"主人是否有效在场"：主人离线/遥不可及 → 跟随已无意义 → 强制换活；
                    # 主人就在身边 → 正常跟随，允许，交给亲卫。
                    current_task = data.get("task") or task_name
                    current_task_desc = task_id
                    feed_append(g, "standing", f"task={task_name} id={current_task_desc} budget={budget_left}")
                    log(f"常驻任务在跑：{task_name}（不锁决策，交给亲卫判断是否替换）")
                    # —— 主人在场判定：常驻跟随是否仍有意义 ——
                    owner_status = None
                    try:
                        osq = query(g["login"], "get_owner_status")
                        if isinstance(osq, dict):
                            owner_status = osq
                    except Exception:
                        owner_status = None
                    owner_ok = _owner_valid(owner_status)
                    standing_stuck = (not owner_ok)
                    if standing_stuck:
                        feed_append(g, "tripped", f"常驻任务 {task_id}({task_name}) 主人已离线/遥不可及 → 强制重议换活")
                        log(f"⚠ 常驻任务 {task_id}({task_name}) 主人离线/遥不可及，强制亲卫重议换活")
            # —— 若本轮因熔断叫停了任务，则跳过喂亲卫/执行，等下一轮拿到"空闲"态 ——
            if tripped:
                time.sleep(BUSY_POLL)
                continue
            # 2. 读状态 + 感知
            status = invoke(g["login"], "get_self_status")
            # 伴链断连识别：身体实体不在（no companion / ToolNotFoundError 之类）时，
            # 不要再喂亲卫做新动作——那是无效刷屏，只会让亲卫一次次撞墙。
            # 降频心跳，等实体重挂（宿主要重启伴链服务/重挂实体）。
            if isinstance(status, str) and (
                "no companion" in status
                or "no entity" in status.lower()
                or "没有伴" in status
                or "ToolNotFound" in status
            ):
                feed_append(g, "disconnected", status[:200])
                log(f"伴链断连：{g['name']} 身体实体不在，停发新动作，降频心跳等重挂（{status[:80]}）")
                _reattach_if_lost(g)  # T006-d（2026-08-29 天神）：连续断连主动召唤重挂
                time.sleep(LOST_POLL)
                continue
            if isinstance(status, dict) and not status.get("success", True) and "no companion" in str(status):
                feed_append(g, "disconnected", str(status)[:200])
                log(f"伴链断连：{g['name']} 身体实体不在，停发新动作，等重挂")
                _reattach_if_lost(g)  # T006-d：连续断连主动召唤重挂
                time.sleep(LOST_POLL)
                continue
            g["_lost_streak"] = 0  # T006-d：正常路径重置断连计数
            world = invoke(g["login"], "get_world_info")
            # —— 濒死急救闸（基础生存能力的核心）——
            # 身体贫血/濒死（hp 过低）或饥饿归零且生命已受影响 → 高于一切任务。
            # 步骤：①先打断可能在跑的卡死任务（如 attack 打了 300s 都没打死 → 它占用身体）
            #      ②record emergency 喂给亲卫，让它只输出"续命"动作。
            health = _parse_health(status)
            if health:
                hp = health.get("hp")
                hunger = health.get("hunger")
                reason = None
                if isinstance(hp, (int, float)) and hp <= 6.0:
                    reason = f"生命仅剩 {hp:.1f}/20，濒死"
                elif isinstance(hunger, (int, float)) and hunger <= 0 and isinstance(hp, (int, float)) and hp <= 10.0:
                    reason = f"饥饿归零(0/20)且生命 {hp:.1f}/20，失血危象"
                if reason:
                    emergency = {"reason": reason, "hp": hp, "hunger": hunger}
                    feed_append(g, "emergency", reason)
                    log(f"🚑 濒死急救：{g['name']} {reason}——优先保命，打断卡死任务")
                    # 打断卡死/占用身体的任务（如有界 attack 跑太久没结果），让身体脱离僵持
                    R.cmd(f'numen_act invoke "{g["login"]}" task_stop {{}}')
                    # 本轮不再走"常驻任务在跑"的跟随逻辑，直接进入濒死决策
                    standing_stuck = False
            look = invoke(g["login"], "look_around", {"radius": 8})
            scan = invoke(g["login"], "scan_nearby_entities", {"radius": 16, "type_filter": "hostile"})
            # 3. 喂亲卫决策（standing_stuck 标记常驻任务空转过久的强出口；emergency 标记濒死，优先保命）
            # 2026-08-24 a 步：守卫桥纯监护化——不再喂玩家/女神消息进 prompt，
            # 改由亲卫主动调 get_recent_messages 去听（玩家公屏/女神谕示/咏唱回执/系统消息）。
            # 消息文件不被守卫桥消费（drain_msgs/drain_player_chat 停用），留给 agent 读尾部。
            g_msgs, p_msgs = None, None
            # 2026-08-23 方案A：仅首轮发全量（decision_prompt）；普通/濒死/卡死全走增量——
            # 濒死循环里若每轮发全量，会和旧历史堆叠撑爆上下文（实测桐人迭代超限跳过本轮）。
            # delta_prompt 自带濒死/卡死提示行，决策所需信息（身体/变化/威胁/目标）齐全。
            if prev["status_compact"] is None:
                prompt = decision_prompt(g, status, world, look, scan, last_act, goal,
                                         standing_task=current_task, standing_stuck=standing_stuck,
                                         emergency=emergency)
            else:
                prompt = delta_prompt(g, status, world, look, scan, last_act, goal, prev,
                                      standing_task=current_task, standing_stuck=standing_stuck,
                                      emergency=emergency)
            # 3.4 守卫「眼」：低频渲染守卫位置截图喂给亲卫（qwen3.8 视觉）。
            # 触发：位置水平移动 ≥ RENDER_MOVE_MIN 格，或距上次渲染 ≥ RENDER_EVERY_N 轮。
            # 渲染 ~15s 会卡住本守卫线程一轮（双线程互不影响），失败静默。
            imgs = None
            try:
                now_pos = _status_pos(status)
                if now_pos and prev["status_compact"] is not None:
                    g.setdefault("_render_n", 0)
                    g["_render_n"] += 1
                    last_rend = g.get("_last_render_pos")
                    moved = last_rend is None or (
                        math.hypot(now_pos[0] - last_rend[0], now_pos[2] - last_rend[2]) >= RENDER_MOVE_MIN)
                    if moved or g["_render_n"] >= RENDER_EVERY_N:
                        g["_render_n"] = 0
                        imgs = render_guard_eye(g, *now_pos)
                        # 无论成败都记录位置：失败不每轮重试轰炸，等移动或 N 轮后再试
                        g["_last_render_pos"] = now_pos
                        if imgs:
                            feed_append(g, "eye", f"rendered @ ({now_pos[0]:.1f},{now_pos[1]:.1f},{now_pos[2]:.1f})")
                            log(f"👁 {g['name']} 守卫之眼已渲染（{now_pos[0]:.1f},{now_pos[1]:.1f},{now_pos[2]:.1f}）")
            except Exception as e:
                log(f"👁 {g['name']} 守卫之眼触发异常：{e}")
            ans = call_guard(g["agent"], g["session"], prompt,
                             images=list(imgs.values()) if imgs else None)
            # 本轮感知 → 更新增量缓存（供下一轮对比）
            _sc = _status_compact(status)
            _wn, _wr = _world_compact(world)
            _ents, _ = _scan_entities(scan)
            prev["status_compact"] = _sc
            prev["world_norm"] = _wn
            prev["world_read"] = _wr
            prev["look_norm"] = _look_norm(look)
            if _ents is not None:
                prev["scan_ids"] = {(e["id"], e["type"]) for e in _ents}
            act = extract_action(ans)
            if not act:
                feed_append(g, "noop", ans[:200] or "(empty)")
                log(f"亲卫未给出动作 JSON，跳过本轮（回复前120字：{ans[:120]!r}）")
                time.sleep(DECIDE_INTERVAL)
                continue
            tool = str(act.get("tool", "")).strip()
            args = act.get("args") or {}
            reason = str(act.get("reason", "")).strip()[:80]
            # 3.5 更新目标（亲卫可随场景改换目标；未给则沿用）
            new_goal = str(act.get("goal", "")).strip()
            if new_goal and new_goal != goal:
                goal = new_goal[:120]
                feed_append(g, "goal", goal)
                log(f"目标更新 → {goal}")
            # 4. 白名单硬校验
            if tool not in TOOL_WHITELIST:
                feed_append(g, "blocked", f"tool={tool} reason={reason}")
                log(f"⚠ 亲卫输出越界工具 {tool!r}（{reason}），已拒绝")
                last_act = f"（上一动作被天神规则拦下：{tool} 不在白名单）"
                time.sleep(DECIDE_INTERVAL)
                continue
            # 5. 执行
            if tool == "chant":
                # 咏唱：写 chant-requests.jsonl → 女神侧 castSpell（已学自施/未学提示）→ 回执注入
                spell = str((args.get("spell") if isinstance(args, dict) else None) or
                            (args.get("text") if isinstance(args, dict) else None) or "").strip()
                if not spell:
                    feed_append(g, "blocked", "chant 缺 spell/text 内容")
                    log("⚠ chant 无内容，跳过")
                    last_act = "（chant 需要 spell 内容）"
                    time.sleep(DECIDE_INTERVAL)
                    continue
                ok = append_chant_req(g["login"], spell)
                out = "已上达咏唱通道" if ok else "(写盘失败)"
                feed_append(g, "act", f"tool=chant spell={spell[:60]} → {out}")
                last_act = f"chant {spell[:60]} → {out}"
            elif tool == "pray":
                # 祈愿：写 god-inbox.jsonl（asPlayer=true）→ 女神玩家路径裁决 → 神谕经 chant-reply 回执
                wish = str((args.get("wish") if isinstance(args, dict) else None) or
                           (args.get("text") if isinstance(args, dict) else None) or "").strip()
                if not wish:
                    feed_append(g, "blocked", "pray 缺 wish/text 内容")
                    log("⚠ pray 无内容，跳过")
                    last_act = "（pray 需要 wish 内容）"
                    time.sleep(DECIDE_INTERVAL)
                    continue
                ok = append_prayer(g, wish, status)
                out = "祈愿已上达天听" if ok else "(写盘失败)"
                feed_append(g, "act", f"tool=pray wish={wish[:60]} → {out}")
                log(f"{g['name']} 祈愿：{wish[:80]}")
                last_act = f"pray {wish[:60]} → {out}"
            elif tool == "say":
                # say 走独立命令 numen_act say "名字" <消息>（greedyString 收全剩余），非 invoke 工具
                raw = args.get("message") if isinstance(args, dict) else args
                msg = str(raw if raw is not None else "").strip()
                # 清掉换行与双引号（防破坏命令/注入），保留其余（含中文、空格）
                msg = msg.replace("\n", " ").replace("\r", " ").replace('"', "").strip()
                if not msg:
                    feed_append(g, "blocked", "say 缺 message 内容")
                    log("⚠ say 无内容，跳过")
                    last_act = "（say 需要 message 内容）"
                    time.sleep(DECIDE_INTERVAL)
                    continue
                # 2026-08-26 AUDIT-03 修复：同文本 120s 去重（桥层硬保险，防公屏刷屏——
                # 鸣人曾同一句招徕吆喝 80+ 条、峰值 3 秒 4 条）。过冷却才放行。
                _say_key = (g["login"], msg[:60])
                _now = time.time()
                if _SAY_RECENT.get(_say_key, 0) > _now - 120:
                    feed_append(g, "blocked", f"同文本120s内已说过，去重拦截：{msg[:50]}")
                    log(f"🔇 去重拦截 {g['name']} say：{msg[:40]}")
                    last_act = f"say 去重拦截（120s 内重复：{msg[:40]}）"
                    time.sleep(DECIDE_INTERVAL)
                    continue
                _SAY_RECENT[_say_key] = _now
                out = R.cmd(f'numen_act say "{g["login"]}" {msg}')
            else:
                # —— 参数归一化：亲卫可能少给必填参数，补默认避免 invoke 报错（自主循环健壮性）——
                args = _normalize_args(tool, args)
                out = invoke(g["login"], tool, args)
            log(f"R{round_n} {tool} {json.dumps(args, ensure_ascii=False)[:80]} → {out[:100]}")
            feed_append(g, "act", f"tool={tool} args={json.dumps(args, ensure_ascii=False)[:120]} reason={reason} → {out[:120]}")
            last_act = f"{tool} {json.dumps(args, ensure_ascii=False)[:60]} → {out[:80]}"
        except Exception as e:
            log(f"轮次异常：{e}")
            feed_append(g, "error", str(e)[:200])
        time.sleep(DECIDE_INTERVAL)


# =====================================================================
# 自主智能体模式（2026-08-24）：守卫桥降级为「濒死监控 + 通道消息注入 + 记录」，
# 守卫 agent 自主 ReAct 调 numen MCP 工具（感知+行动），不再输出 JSON 给桥执行。
# 试点：鸣人（autonomy=True）；桐人保持旧 JSON 对照。
# =====================================================================
def autonomy_prompt(g, status, goddess_msgs=None, player_msgs=None, emergency=None):
    # 女神回执/谕示
    goddess_hint = ""
    if goddess_msgs:
        parts = []
        for m in goddess_msgs:
            kind = "神谕" if m.get("kind") == "prayer" else ("咏唱回执" if m.get("kind") == "chant" else "女神谕示")
            txt = str(m.get("reply") or m.get("text") or "").strip()
            if txt:
                parts.append(f"【{kind}】{txt}")
        if parts:
            goddess_hint = "\n".join([
                "女神刚对你说了话（务必回应：若她点出你的处境/可用技能，就照做或开口）：",
                "\n".join(parts),
            ])
    player_hint = ""
    if player_msgs:
        p_parts = [f"{u}: {t}" for u, t in player_msgs]
        player_hint = "\n".join([
            "【⚠ 玩家刚才在公屏说话（你能听见）——若他叫你、向你搭话、或值得你接话，就 say 回应；无关/闲聊当没听见】",
            "\n".join(p_parts[-6:]),
        ])
    emergency_hint = ""
    if emergency:
        em_reason = emergency.get("reason", "身体危急")
        emergency_hint = (
            f"\n【⚠ 濒死急救 —— 最高优先级】你的身体此刻『{em_reason}』，随时可能倒下。"
            f"其它一切任务全部作废，此刻只做能续命的动作：eat 顶饥饿止血 / attack 打贴脸怪 / "
            f"goto 逃回庇护所 / 可念『圣愈』自救（chant）。绝不要继续打打不过的怪、砍树采矿、发呆。")
    sc = _status_compact(status) or str(status)
    return "\n".join([
        f"【{g['name']}身体当前】{sc}",
        goddess_hint,
        player_hint,
        emergency_hint,
        "",
        f"你是自主智能体（{g['agent']}），直管穿越者{g['name']}的魂。此刻清醒独立，不是被驱动的应答器。",
        "用你手里的 numen 工具**自主**行动——不是描述、不是编造，是真的调用工具让身体去做。",
        "",
        "工具（numen MCP）：",
        "- 查询（随意调，摸清处境）：get_self_status / get_world_info / look_around / scan_nearby_entities / task_status / scan_blocks / lookup_recipe / locate_structure / locate_biome / inspect_gui / list_places",
        "- 身体动作（每轮**至少真调一个**，调完一句话收尾）：goto / mine / collect_items / eat / sleep / attack / say / chant / pray",
        "- 制作与升级（攒料→查方→合成→穿上，一步一步来）：craft（合成，3x3 配方需身边有工作台，没有先 craft 一张）/ equip_item（穿装备）",
        "- 界面交互（存取/交易链）：interact_at 开门开箱熔炉 → inspect_gui 看槽位 → transfer 移物存取 → close_gui 关；interact_entity 对村民/动物右键（交易用绿宝石）",
        "- 地点记忆（空间感）：remember_place 把当前坐标存成「家/矿场/集合点」；list_places 查已存地点，拿坐标 goto 回去——到了重要的地方就存一个",
        "- 技能篇（先学后干）：list_skills 看有什么可学；read_skill(name) 读技能篇——打架前学 combat_basics、攒料造装备学 tier_progression、开箱存取学 containers、盖房学 building_design。照篇子里的流程干，工具参数有现成示例，调用不容易错",
        "- 进阶：set_timer 定闹钟（熔炼等待用，reason 必填）；inspect_block 查方块；fish 钓鱼；drop_items 递物/腾格子；get_owner_status 查主人；build/blueprint 建造系（先读 building_design 技能篇）；scaffold_materials 脚手架垫料白名单",
        "",
        "行动原则（每轮一步，做完就停）：",
        "- 第1步：调 1-2 个查询工具看清处境（get_self_status / look_around / scan_nearby_entities）——**最多 2 次，查到需要的信息就别再查**。",
        "- 第2步：凭处境决定此刻最该办的一件实事（真要做，不是说说）。",
        "- 第3步：调一个身体动作工具真去办它（goto/mine/eat/sleep/attack/collect_items/say/chant/pray 选一）。",
        "- 第4步：动作受理后就用一两句话收尾、说清决定与进展（下一步交给守卫桥下一轮再接）。",
        "**关键：numen 的身体动作是异步的**——goto/mine/eat 等返回『已受理，后台执行』就是动作已下发，身体自己会完成；你调完就收尾，别一直刷同一个工具。",
        "**说话别重复**——同一句话 2 分钟内说第二遍会被拦下。招徕/吆喝说过一次就守在原地等人来，别刷屏；要再开口就换个说法。",
        "**宁可真调一个动作落地，也不要只评估不行动**——如果评估后觉得没有紧迫事，就主动选一件能变强/保安全的具体实事去做。",
        "**一次只推进一小步**：先最多调1-2个感知工具看一眼（get_self_status/look_around/scan_nearby_entities），挑一件最该做的事**真调一个动作**（goto/mine/eat/sleep/attack），调完**立刻打一行收尾**——别再连环调第3、4个工具（那是单轮步数上限掐死你的根源）。守卫桥下一轮会再叫你。",
        f"- 你是「{g['name']}」本人（人格见 PROFILE 人物志）。{_guard_core(g)}",
        "- 别只描述、别脑补「我用了」——要么真调工具，要么明确说观察到什么。",
    ])


# ---------------------------------------------------------------------
# GOAL 化（2026-08-24）：守卫桥用 /goal 激活 GoalSession，让守卫 agent 有
# 「目标感 + self-audit + get/update_goal 工具」；后续每轮都发轻推，不重复 /goal。
# ---------------------------------------------------------------------
def _goal_terminated(ans):
    """Goal 循环是否已被 QwenPaw 终止（超限/完成）——守卫桥据此复位、重启 /goal。"""
    s = (ans or "").lower()
    return (
        "max iterations reached" in s
        or "goal completed:" in s
        or "goal mode ended" in s
        or "no active goal" in s
        or "not in goal mode" in s
    )


def _agent_interrupted(ans):
    """agent 是否被『单轮步数上限』截断（max iterations）——这是异常中断，不是 goal 完成。"""
    s = (ans or "").lower()
    return "max iterations" in s or "maximum number of iterations" in s


def continue_prompt(g, status=None):
    """『继续』prompt：单轮步数上限截断后，让 agent 接续上轮意图续跑，而非重新开始绕圈。"""
    return (
        "（你上轮被『单轮步数上限』截断了——任务还没完，只是先停在这里。）\n"
        "【继续】接着你上轮的意图往下推进：先用 get_self_status / task_status 看身体到哪一步了，"
        "然后继续完成上一步；若已经无可推进、或目标已达成，就简单说『完成』结束本轮。"
        "不要重新开始，不要重复已经做过的步骤。"
    )


def _guard_core(g):
    """按守卫身份返回其内核驱动句（本心），供 goal/自认/继续 三处 prompt 用。"""
    if g.get("login") == "Naruto":
        return ("你心里一直烧着一股劲：要变强、要成为火影、要保护他人、要帮助那些需要帮助的人。"
                "你不是被任务推着走——是看见有危险就挺身而出，看见有人落难就上去搭把手，"
                "平时就抓紧提升自己（练技艺/攒资源/学新法术）。驱动你的是『变强·护人·助人』。"
                "你是行动派——想到就去办，不空想；说出口的话就一定做到、绝不半途，这就是你的忍道。")
    return ("你心里一直烧着一股劲：做这片异世界的开拓者、攻略者。你执剑而孤高，探索未知的地图、"
            "挑战更强的敌人，从不轻易把后背交给别人。你要不断变强，才能在这片世界走得更远、打败更强的敌人。"
            "驱动你的是『开拓·攻略·变强·挑战』。你是行动派——剑出鞘从不犹疑，锁定了目标就去闯、去打，绝不空想。")


def _guard_core_short(g):
    """按守卫身份返回短内核词（继续推进用）。"""
    if g.get("login") == "Naruto":
        return "变强·火影·护人·助人"
    return "开拓·攻略·变强·挑战"


# 世界系统优化（2026-08-24）：冒险者公会（灯门镇·接待员岚）任务机会——给守卫"任务驱动"目标，治绕圈/原地待。
# 守卫可 say「看板」/「接 编号」/「声望」与岚交互（配合 mc_npc speak→guard-inbox 的守卫听觉）。
QUEST_HINT = (
    "【世界机会】方外有委托可接——灯门镇城门口立着一块任务板，走近 say『看板』看今日委托，say『接 编号』接单，"
    "达成后换绿宝石与声望（壮大自己、帮到世界）。若你一时没有紧迫事，"
    "就去接单委托赚绿宝石、长本事——这是穿越者发家的正道；当然若眼前有人落难/威胁逼近，先救急救人，委托可稍后再接。"
)


def build_guard_goal(g, goddess_msgs=None):
    """守卫的『女神使命』——goal 描述：把女神近期谕示当指引，否则用基础生存/变强/守护使命。"""
    extra = ""
    if goddess_msgs:
        parts = []
        for m in goddess_msgs:
            txt = str(m.get("reply") or m.get("text") or "").strip()
            if txt:
                parts.append(txt)
        if parts:
            joined = " ；".join(parts[-3:])
            extra = "。女神近来说：‘" + joined + "’——把它当作当下最要紧的指引"
    return (
        "你是一具真实方块世界的穿越者灵魂，手上有一整套 numen 身体工具（get_self_status/look_around/goto/mine/eat/sleep/attack/collect_items/scan_nearby_entities/render_view 等）。"
        "要行动就**直接调用这些工具**（像伸手做实事一样），**绝对不要输出 JSON 格式的 {tool:...} 文本**——那是旧守卫桥要执行的格式，你不是调度器，你就是这具身体。"
        "作为穿越者" + g["name"] + "本人（人格见人物志）。" + _guard_core(g)
        + extra
        + QUEST_HINT
        + "。现在不要只评估——**用手里的 numen 工具真调一个动作落地**：优先做当下最该办的一件实事"
        "（帮眼前的人 / 对付威胁 / 采集求生物资 / 找地方安身 / 练本事），选一个具体可完成的，"
        "做完一件再看下一件（要做就做到，不半途）。若一时没有紧迫事，就主动选一件能让你变得更强或帮到别人的事，真去做，别空等。"
        "**一次只推进一小步**：先最多调1-2个感知工具看一眼（get_self_status/look_around/scan_nearby_entities），挑一件最该做的事**真调一个动作**（goto/mine/eat/sleep/attack），调完**立刻打一行收尾**——别再连环调第3、4个工具（那是单轮步数上限掐死你的根源）。守卫桥下一轮会再叫你。"
    )


def goal_continue_prompt(g, status, goddess_msgs=None, player_msgs=None, emergency=None):
    """Goal 模式下每轮的轻推 prompt（不重复 /goal）——注入女神/玩家消息 + 濒死提醒 + 当前状态。"""
    goddess_hint = ""
    if goddess_msgs:
        parts = []
        for m in goddess_msgs:
            kind = "神谕" if m.get("kind") == "prayer" else ("咏唱回执" if m.get("kind") == "chant" else "女神谕示")
            txt = str(m.get("reply") or m.get("text") or "").strip()
            if txt:
                parts.append(f"【{kind}】{txt}")
        if parts:
            goddess_hint = "女神刚对你说了话（务必回应/照做）：\n" + "\n".join(parts)
    player_hint = ""
    if player_msgs:
        p_parts = [f"{u}: {t}" for u, t in player_msgs]
        player_hint = "【⚠ 玩家在公屏说话——若叫你/搭话/值得接就 say 回应，无关当没听见】\n" + "\n".join(p_parts[-6:])
    emergency_hint = ""
    if emergency:
        em_reason = emergency.get("reason", "身体危急")
        emergency_hint = ("\n【⚠ 濒死急救——最高优先级】身体『" + em_reason + "』随时倒下。"
                          "其它任务全作废，只做能续命的：eat 止血 / attack 打贴脸怪 / goto 逃 / chant 圣愈。")
    sc = _status_compact(status) or str(status)
    kage_fuse = _kage_fuse_hint()   # 影分身归体记忆回灌（鸣人体），2026-08-24
    fuse_hint = ""
    if kage_fuse:
        fuse_hint = "【分身记忆·已融回】" + kage_fuse
    return "\n".join([
        "（别忘了：你手握 numen 身体工具，行动**直接调用工具**（goto/mine/eat/sleep/attack...），别输出 JSON 决策。"
        "继续朝着『" + _guard_core_short(g) + "』推进，说到做到——每轮**至少真调一个身体动作**（goto/mine/eat/sleep/attack/collect_items 选一），"
        "动作受理后一句话收尾、守卫桥下轮接；只有评估后确实无任何可做，才说『无紧迫事』。）",
        "**一次只推进一小步**：先最多调1-2个感知工具看一眼，挑一件最该做的事**真调一个动作**，调完**立刻打一行收尾**——别再连环调第3、4个工具（那是单轮步数上限掐死你的根源）。守卫桥下一轮会再叫你。",
        f"【{g['name']}身体】{sc}",
        fuse_hint,
        "【可选委托】若一时无事可做，可去灯门镇城门口的任务板 say『看板』接委托（say『接 编号』），完成换绿宝石/声望；若正在忙紧要事/救急则不必理会。",
        goddess_hint,
        player_hint,
        emergency_hint,
    ])


def autonomy_loop(g, stop_at):
    log = lambda msg: print(f"[{g['name']}·自主] {msg}", flush=True)
    round_n = 0
    goal_active = False
    interrupt_flag = False
    pcursor = 0
    carry_last_task, carry_last_elapsed, carry_stall = None, None, 0   # 2026-08-24 任务推进/卡死检测
    pcursor_path = os.path.join(DATA, f"guard-player-{g['tag']}.cursor")
    try:
        with open(pcursor_path, "r", encoding="utf-8") as f:
            pcursor = int((f.read().strip() or "0"))
    except Exception:
        pcursor = 0
    log(f"自主亲卫桥启动 agent={g['agent']} session={g['session']}")
    while True:
        if stop_at and time.time() >= stop_at:
            log("试运行时间到，退出")
            return
        round_n += 1
        emergency = None
        try:
            # 1. 濒死监控（旁路兜底：守卫桥独立保命，不依赖 agent）
            status = invoke(g["login"], "get_self_status")
            if isinstance(status, str) and (
                "no companion" in status or "no entity" in status.lower()
                or "没有伴" in status or "ToolNotFound" in status
            ):
                feed_append(g, "disconnected", status[:200])
                log(f"伴链断连：{g['name']} 身体实体不在，降频心跳等重挂（{status[:80]}）")
                _reattach_if_lost(g)  # T006-d：连续断连主动召唤重挂
                time.sleep(LOST_POLL)
                continue
            health = _parse_health(status)
            if health:
                hp = health.get("hp"); hunger = health.get("hunger")
                if isinstance(hp, (int, float)) and hp <= 6.0:
                    emergency = {"reason": f"生命仅剩 {hp:.1f}/20，濒死", "hp": hp, "hunger": hunger}
                    R.cmd(f'numen_act invoke "{g["login"]}" task_stop {{}}')
                    log(f"🚑 濒死急救：{g['name']} {emergency['reason']}——优先保命，打断卡死任务")
                elif isinstance(hunger, (int, float)) and hunger <= 0 and isinstance(hp, (int, float)) and hp <= 10.0:
                    emergency = {"reason": f"饥饿归零(0/20)且生命 {hp:.1f}/20，失血危象", "hp": hp, "hunger": hunger}
                    R.cmd(f'numen_act invoke "{g["login"]}" task_stop {{}}')
                    log(f"🚑 濒死急救：{g['name']} {emergency['reason']}——优先保命")
            # 1.5 「继续」闸（2026-08-24 女神：守卫长任务在跑→不唤醒 agent 绕圈，让身体专心执行，干完才决策）
            #      对应"发送'继续'让动作继续执行"：身体有异步长任务时，守卫桥只轮询等完成，不塞状态唤醒 agent。
            #      濒死紧急跳过（保命优先，立即唤醒 agent 做保命决策）。
            if not emergency:
                ts = query(g["login"], "task_status")
                if isinstance(ts, dict) and ts.get("success") is True:
                    tmsg = ts.get("message", "")
                    tdata = ts.get("data") or {}
                    task_name = str(tdata.get("task", "")).strip()
                    elapsed_s = tdata.get("elapsed_s")
                    bud_left = tdata.get("budget_left_s")
                    is_standing = (task_name in {"follow", "follow_entity"}) or (
                        isinstance(bud_left, (int, float)) and bud_left > 1000000)
                    if not is_standing and task_name and "空闲" not in tmsg and "没有后台任务" not in tmsg:
                        # 2026-08-24 用户拍板"守卫桥规则少一点"：去掉「死任务熔断」(goto 长距导航曾超150s被误掐)；
                        # numen 有界任务自带 deadline 收尾。但继续闸若一味等一个**不推进**的任务，会把身体永远卡在
                        # 一个假性任务上。故只加「推进/卡死」检测：任务 elapsed 连续不动→判定真卡住→task_stop+唤醒换招。
                        # goto 等长任务 elapsed 会持续增长，天然不误伤（符合"说到做到，挖不动就换招"的忍道）。
                        now_elapsed = elapsed_s if isinstance(elapsed_s, (int, float)) else 0
                        if carry_last_task == task_name and now_elapsed == carry_last_elapsed:
                            carry_stall += 1
                        else:
                            carry_stall = 0
                        carry_last_task, carry_last_elapsed = task_name, now_elapsed
                        if carry_stall >= 3:
                            R.cmd(f'numen_act invoke "{g["login"]}" task_stop {{}}')
                            feed_append(g, "stall", f"任务 {task_name} 卡住不推进(elapsed 冻结={now_elapsed}s) → task_stop，换招")
                            log(f"🧊 {g['name']} 任务 {task_name} 卡住不推进 → task_stop，唤醒 agent 换招")
                            carry_stall = 0
                            carry_last_task, carry_last_elapsed = None, None
                            # 不 continue → 落到下面唤醒 agent 决策新招
                        else:
                            feed_append(g, "busy", f"长任务 {task_name} 进行中(el={elapsed_s}s) → 让身体专心执行，延后 agent 唤醒")
                            log(f"⏳ {g['name']}·继续闸 有长任务在跑，暂不唤醒 agent：{task_name}")
                            time.sleep(BUSY_POLL)
                            continue
            # 2. 通道消息
            g_msgs = drain_msgs(g)
            p_msgs, pcursor = drain_player_chat(g, pcursor)
            try:
                with open(pcursor_path, "w", encoding="utf-8") as f:
                    f.write(str(pcursor))
            except Exception:
                pass
            # 3. GOAL prompt：首次 /goal 激活 GoalSession，后续每轮轻推（不重复 /goal）
            if not goal_active:
                goal_text = build_guard_goal(g, g_msgs)
                prompt = goal_text   # default 模式：不打 /goal，max_iters=15 即时生效（免 daemon reload）
                goal_active = True
                interrupt_flag = False
                log("🎯 R%d 进入自主行动：%s" % (round_n, goal_text[:60]))
            elif interrupt_flag:
                prompt = continue_prompt(g, status)
                interrupt_flag = False          # 发一次『继续』，下轮回常规轻推
                log("🔄 R%d 发『继续』让亲卫接续上轮意图（不重头）" % round_n)
            else:
                prompt = goal_continue_prompt(g, status, g_msgs, p_msgs, emergency)
            # 4. call_guard：agent 自主 ReAct 调 MCP 工具
            ans = call_guard(g["agent"], g["session"], prompt)
            # 5. 记录 agent 决定/进展（bridge 不执行任何 JSON——动作由 agent 自己调 MCP 落实）
            feed_append(g, "auto", ans[:400])
            if _agent_interrupted(ans):
                interrupt_flag = True          # 单轮步数上限截断，非正常完成 → 下轮『继续』，不重头
                goal_active = True             # 保持 goal 上下文
                log("🔁 R%d 被单轮步数上限截断 → 下轮『继续』接续（不重头）" % round_n)
            elif _goal_terminated(ans):
                goal_active = False
                interrupt_flag = False
                log("🔚 R%d Goal 正常完成/终止，下轮重启 /goal：%s" % (round_n, ans[:100]))
            log(f"R{round_n} 自主 → {ans[:180]!r}")
        except Exception as e:
            log(f"轮次异常：{e}")
            feed_append(g, "error", str(e)[:200])
        time.sleep(DECIDE_INTERVAL)


# =====================================================================
# 影分身分脑引擎（2026-08-24 造物主定调）
# 分身=独立进程/独立 session、上下文独立。守卫桥为每个在册 Kage 开一个独立 QwenPaw session
# （复用施术者 agent id，但 session 彻底独立——它是"另一个意识"），提示词明确"你是影分身"；
# 分身用 kage_* 系列工具驱动自己。血线 <50% 自动解散；分身消失时把见闻融合回本体。
# ---------------------------------------------------------------------
_kage_state = {}   # name -> {"agent","session","start_ts","last_hp","last_pos","log_path"}


def _kage_log_path(name):
    return os.path.join(DATA, f"kage-drive-{name}.jsonl")


def _roster_kages():
    """numen_act list → 解析当前在册的影分身（Kage1/Kage2）。返回 set。"""
    out = R.cmd("numen_act list")
    names = set()
    for k in KAGE_NAMES:
        if re.search(r"(?m)^" + re.escape(k) + r"\|", str(out)):
            names.add(k)
    return names


def _kage_status(name):
    """分身自身状态（HP/位置）。用 numen_act invoke <Kage> 驱动分身身体拿，非本体。"""
    out = invoke(name, "get_self_status")
    return _parse_health(out)


def _kage_prompt(name, status, start_ts):
    """分裂时/每轮喂给分身 session 的提示词——明确『你是影分身』，只用 kage_* 工具。"""
    sc = ""
    if status:
        hp = status.get("hp")
        pos = status.get("pos")
        sc = f"（HP {hp if hp is not None else '?'}/20 · 位置 {pos if pos is not None else '?'}）"
    return "\n".join([
        f"你是『鸣人』的影分身【{name}】——不是本体，是一个独立意识的分身，此刻另有任务。",
        "你有一副属于你自己的分身身体，用**仅限 kage_* 系列工具**驱动它（kage_status 看自己、kage_goto 移动、kage_attack 打架、kage_scan 扫周围、kage_follow 召回、kage_dismiss 遣散）。",
        "**铁律·千万别碰 goto/mine/eat/attack/collect_items/say/chant 这些工具**——它们是本体『鸣人』的工具，你一碰就会移动/操作**本体**的身体，不是你的分身！你只活在 kage_* 工具里。",
        "你的任务：作为分身前哨侦察战斗——去探路、俯瞰、看敌人、看地形、看资源，把看到的情报带回来；或替本体执行它分身不做的战斗/采集杂务。",
        f"当前分身状态{sc}。你被召唤于 {start_ts}。",
        "请**真正用 kage_* 工具**去做（kage_scan 看周围 / kage_goto 移动 / kage_attack 打怪），观察后做一件最值得的分身实事。你看到的、做到的，都会在解除时**融回本体鸣人的记忆**——所以认真看、认真记。",
        "每轮只推进一小步：最多1-2个 kage_ 感知工具看一眼，然后真调一个 kage_ 动作，做完一句话收尾。",
    ])


def _fuse_kage(name, reason):
    """分身消失/解散：把它的见闻融合回本体（上下文注入 + 持久记录双路）。"""
    st = _kage_state.pop(name, None)
    log = lambda msg: print(f"[分身·{name}] {msg}", flush=True)
    try:
        lib = _kage_log_path(name)
        lines = []
        if os.path.exists(lib):
            with open(lib, "r", encoding="utf-8") as f:
                lines = [json.loads(x) for x in f if x.strip()]
            os.remove(lib)
        # 提取分身"做过的事/看到的情报"作记忆。
        mem = []
        for ln in lines[-40:]:
            t = str(ln.get("text") or "").strip()
            if t:
                mem.append(t[-200:])
        summary = "；".join(mem[-12:]) if mem else "（此身未及留下见闻）"
        rec = {
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
            "name": name, "reason": reason,
            "what": summary,
            "start_ts": st.get("start_ts") if st else "",
            "last_hp": st.get("last_hp") if st else None,
        }
        # ① 上下文注入：写进 kage-fusion 文件，本体下轮 prompt 读走
        os.makedirs(DATA, exist_ok=True)
        with open(KAGE_FUSE_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        # ② 持久记录分身档案（供女神/史官素材）
        with open(os.path.join(DATA, "kage-archive.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        log(f"分身结束({reason}) → 阅历已融回本体：{summary[:60]}")
    except Exception as e:
        log(f"融合失败：{e}")


def _kage_fuse_hint():
    """读走 kage-fusion 文件的未消费分身记忆，供本体 prompt 注入。有则返回文本，无则空。"""
    if not os.path.exists(KAGE_FUSE_FILE):
        return ""
    recs = []
    try:
        with open(KAGE_FUSE_FILE, "r", encoding="utf-8") as f:
            for x in f:
                if x.strip():
                    try:
                        recs.append(json.loads(x))
                    except Exception:
                        pass
        os.remove(KAGE_FUSE_FILE)   # 消费即清，避免反复注入
    except Exception:
        return ""
    if not recs:
        return ""
    parts = [f"（你的影分身{rec.get('name','')}已归体 {rec.get('reason','')}——它看到/做了：{rec.get('what','')[:120]}）" for rec in recs]
    return "\n".join(parts)


def kage_loop(stop_at):
    log = lambda msg: print(f"[分身·分脑] {msg}", flush=True)
    log(f"影分身分脑引擎启动（{kage_loop.__name__}）")
    while True:
        if stop_at and time.time() >= stop_at:
            return
        try:
            rosters = _roster_kages()
            # 1. 新在册的分身 → 开独立 session（分脑）
            for name in rosters:
                if name not in _kage_state:
                    sess = f"kage:naruto-{name}-{time.strftime('%Y%m%d-%H%M%S')}"
                    _kage_state[name] = {
                        "agent": KAGE_CASTER_AGENT, "session": sess,
                        "start_ts": time.strftime("%m-%d %H:%M"),
                        "last_hp": None, "last_pos": None,
                        "log_path": _kage_log_path(name),
                    }
                    st = _kage_status(name)
                    prompt = _kage_prompt(name, st, _kage_state[name]["start_ts"])
                    ans = call_guard(KAGE_CASTER_AGENT, sess, prompt)
                    _kage_drive_log(name, "init", ans[:400])
                    log(f"分身 {name} 分脑 session 已开（{sess}）→ 首轮回 {ans[:60]!r}")
                    continue
            # 2. 在册分身 → 每轮看状态 + 血线 + 喂一轮行动
            for name, stt in list(_kage_state.items()):
                if name not in rosters:
                    continue
                status = _kage_status(name)
                hp = status.get("hp") if status else None
                pos = status.get("pos") if status else None
                if isinstance(hp, (int, float)):
                    stt["last_hp"] = hp
                    if hp <= KAGE_HP_DIE:   # 血线 50% 以下 → 解散 + 融合
                        R.cmd(f'numen_act dismiss "{name}"')
                        _fuse_kage(name, f"血线低于50%(HP {hp:.0f}/20)自动解散")
                        continue
                stt["last_pos"] = pos
                prompt = _kage_prompt(name, status, stt["start_ts"])
                ans = call_guard(stt["agent"], stt["session"], prompt)
                _kage_drive_log(name, "round", ans[:400])
            # 3. 已不在册的分身 → 消失（超时/死亡/被遣散）→ 融合
            for name in list(_kage_state.keys()):
                if name not in rosters:
                    _fuse_kage(name, "分身已消失（超时/死亡/遣散）")
            time.sleep(KAGE_POLL)
        except Exception as e:
            log(f"分脑轮次异常：{e}")
            time.sleep(KAGE_POLL)


def _kage_drive_log(name, kind, text):
    """记录分身着单轮回复（供消失时融合成记忆）。"""
    try:
        with open(_kage_log_path(name), "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": kind,
                "text": text[:400],
            }, ensure_ascii=False) + "\n")
    except Exception:
        pass


# ---------------- 反射层(快系统,2026-08-29 造物主令) ----------------
# 参照 MindCraft 的 self-preservation reflexes:亲卫 30s 一轮太慢,"怪贴脸/断粮/
# 濒死"等不及过脑子。本层独立心跳(5s),程序化反应,零 LLM:
#   R1 贴脸敌(hostile≤5格)→ attack nearby 主动反击(每守卫 12s 节流;瞬发,
#      允许顶替长任务——命比任务大,顶替后亲卫下轮自然重议)
#   R2 饥饿≤8 → 按食物链探测进食(熟牛排→熟猪排→面包→熟鸡肉→苹果→金胡萝卜),
#      eat 回执"没有"就试下一种,命中即吃(90s 节流,防把食物一口气吃完)
#   R3 HP≤8(40%)→ R2 食物链强吃(饱和回血);HP≤4 时再叠 chant 归乡回安全区
#      (120s 节流)。女神铁律(HP≤15% 代施圣愈)仍在世界侧,双层保险。
# 2026-08-29 二批(mindcraft modes.js 全文对齐,造物主令"多看 mindcraft"):
#   R4 溺水(mindcraft:头顶水持续 jump)→ numen 无 jump 原语,取近义:Air NBT
#      <150(总300)→ goto 当前(x,z) 寻路出水(30s 节流,顶替长任务——当天
#      桐人河底第6死即此课)
#   R5 着火(mindcraft:水桶/找水/moveAway)→ Fire NBT>0 → goto 挪位(x+4,z)
#      离开火源方块(45s 节流);水桶原语缺,灭火靠挪位+R3 兜底
#   R6 卡死(mindcraft unstuck:同点 20s)→ task running 且连续 4 拍位移<2格
#      → task_stop 叫停交慢系统重议(60s 冷却)
# 反射动作 feed_append(kind="reflex") 入亲卫上下文,慢系统自然感知"身体刚自保"
# (mindcraft 同构物:execute() 后 AUTO MESSAGE 回流模型)。
# 独立 Rcon 连接(反射与主循环并发,不共 socket 防串包)。

REFLEX_POLL = 5            # 反射心跳(秒)
REFLEX_ATTACK_THROTTLE = 12
REFLEX_EAT_THROTTLE = 90
REFLEX_FLEE_THROTTLE = 120
REFLEX_DROWN_THROTTLE = 30     # R4 溺水
REFLEX_FIRE_THROTTLE = 45      # R5 着火
REFLEX_STUCK_THROTTLE = 60     # R6 解卡
AIR_DANGER = 150               # Air NBT < 此值(总300)即危险
STUCK_MIN_TICKS = 4            # 连续 N 拍(5s×4=20s)没挪窝才算卡
STUCK_MOVE_EPS = 2.0           # 位移小于此(格)视为没动
REFLEX_FOOD_CHAIN = [
    "minecraft:cooked_beef", "minecraft:cooked_porkchop", "minecraft:bread",
    "minecraft:cooked_chicken", "minecraft:cooked_mutton", "minecraft:apple",
    "minecraft:golden_carrot", "minecraft:carrot", "minecraft:potato",
]
_reflex_ts = {}  # (tag, kind) -> 上次触发时刻(节流)
_reflex_stuck = {}  # tag -> [last_pos, stuck_ticks]  R6 状态


def _reflex_gate(tag, kind, throttle):
    """节流闸:距上次触发不足 throttle 秒则拦下。"""
    key = (tag, kind)
    now = time.time()
    if now - _reflex_ts.get(key, 0) < throttle:
        return False
    _reflex_ts[key] = now
    return True


def _nbt_number(out):
    """data get entity 回执里的裸数字(Air 300 / Fire -1),抽不出给 None。"""
    if not isinstance(out, str):
        return None
    m = re.search(r"entity data:\s*(-?\d+)(?:\.\d+)?[LbBsfd]*\s*$", out.strip())
    return int(m.group(1)) if m else None


def _air_dangerous(air):
    """R4 判定:Air NBT 缺报(None)不动作,拿到且低于阈值即危险。"""
    return air is not None and air < AIR_DANGER


def _fire_burning(fire):
    """R5 判定:Fire NBT >0 在烧(-1/-20 表示不在烧)。"""
    return fire is not None and fire > 0


def _stuck_verdict(tag, cur_pos, task_running, min_ticks=STUCK_MIN_TICKS, eps=STUCK_MOVE_EPS):
    """R6 判定(纯函数):任务在跑但连续 min_ticks 拍位移<eps → True。

    无任务即重置(mindcraft 同义:isIdle 时 stuck_time=0)。
    """
    st = _reflex_stuck.setdefault(tag, [None, 0])
    last, ticks = st
    if not task_running:
        _reflex_stuck[tag] = [cur_pos, 0]
        return False
    if last is not None and cur_pos is not None:
        try:
            moved = math.dist((last[0], last[2]), (cur_pos[0], cur_pos[2]))
        except Exception:
            moved = eps + 1   # 位置数据不完整时按"动过"处理,宁可漏报不误杀
        if moved < eps:
            ticks += 1
        else:
            ticks = 0
    _reflex_stuck[tag] = [cur_pos, ticks]
    return ticks >= min_ticks


def _reflex_rcon():
    """反射层独立 Rcon 连接(线程安全:每线程一连接)。"""
    r = Rcon()
    return r


def reflex_loop(g, stop_at):
    """快系统主循环:一拍一发 get_self_status(含在场敌对),按规则瞬发反射。"""
    tag = g["tag"]
    log = lambda msg: print(f"[{g['name']}·反射] {msg}", flush=True)
    R2 = _reflex_rcon()

    def rinvoke(tool, args=None):
        a = json.dumps(args if args is not None else {}, ensure_ascii=False)
        out = R2.cmd(f'numen_act invoke "{g["login"]}" {tool} {a}')
        m = re.search(r"\{.*\}", out, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
        return {"raw": out}

    # R2/R3 共用:按食物链探测进食,返回吃下的食物 id 或 None
    def eat_chain(reason):
        for food in REFLEX_FOOD_CHAIN:
            out = rinvoke("eat", {"item_id": food})
            txt = json.dumps(out, ensure_ascii=False) if not isinstance(out, str) else out
            if ("没有" not in txt) and ("not have" not in txt.lower()) and ("don't" not in txt.lower()):
                feed_append(g, "reflex", f"{reason} → 反射进食 {food}")
                log(f"{reason} → 吃 {food}")
                return food
        return None

    log("反射层上线(5s 心跳:溺水/着火/贴脸反击/断粮进食/濒死强吃+归乡/卡死解卡)")
    while True:
        if stop_at and time.time() >= stop_at:
            return
        try:
            st = rinvoke("get_self_status")
            h = _parse_health(st)
            if not h:
                time.sleep(REFLEX_POLL)
                continue
            hp, hunger, pos = h.get("hp"), h.get("hunger"), h.get("pos")
            # ---- 保命类先问身体 NBT(Air/Fire),一发一发拿(mindcraft self_preservation)----
            air = _nbt_number(R2.cmd(f'data get entity "{g["login"]}" Air'))
            fire = _nbt_number(R2.cmd(f'data get entity "{g["login"]}" Fire'))
            # R4 溺水:Air 告急 → goto 当前(x,z) 寻路出水(顶替长任务,命比任务大)
            if _air_dangerous(air) and _reflex_gate(tag, "drown", REFLEX_DROWN_THROTTLE):
                if pos and len(pos) >= 3:
                    rinvoke("task_stop", {})
                    rinvoke("goto", {"x": round(pos[0]), "z": round(pos[2])})
                    feed_append(g, "reflex", f"水下 Air {air}/300 → 反射寻路出水")
                    log(f"Air {air} → goto({round(pos[0])},{round(pos[2])}) 出水")
            # R5 着火:在烧 → 挪位离开火源(数格外重落点)
            elif _fire_burning(fire) and _reflex_gate(tag, "fire", REFLEX_FIRE_THROTTLE):
                if pos and len(pos) >= 3:
                    rinvoke("task_stop", {})
                    rinvoke("goto", {"x": round(pos[0]) + 4, "z": round(pos[2])})
                    feed_append(g, "reflex", f"着火(Fire {fire}) → 反射挪位离火源")
                    log(f"Fire {fire} → goto 挪 4 格")
            # 敌对在场(get_self_status 的 hostiles 字段;拿不到就补一发 scan)
            txt = json.dumps(st, ensure_ascii=False)
            near_hostile = ("僵尸" in txt or "骷髅" in txt or "苦力怕" in txt
                            or "僵尸猪灵" in txt or "尸壳" in txt or "蜘蛛" in txt
                            or "末影人" in txt or "女巫" in txt or "zombie" in txt.lower()
                            or "skeleton" in txt.lower() or "creeper" in txt.lower())
            # R1 贴脸反击
            if near_hostile and _reflex_gate(tag, "attack", REFLEX_ATTACK_THROTTLE):
                out = rinvoke("attack", {"nearby": True})
                feed_append(g, "reflex", "敌对贴身 → 反射反击(attack nearby)")
                log(f"贴脸敌 → 反击({json.dumps(out, ensure_ascii=False)[:80]})")
            # R3 濒死强吃(优先于 R2:血线比饥饿线急)
            if isinstance(hp, (int, float)) and hp <= 8 and _reflex_gate(tag, "eat", REFLEX_EAT_THROTTLE):
                ate = eat_chain(f"HP {hp}/20 偏低")
                if not ate and isinstance(hp, (int, float)) and hp <= 4 and _reflex_gate(tag, "flee", REFLEX_FLEE_THROTTLE):
                    # 没吃的且真濒死 → 念归乡逃回安全区(lv2 已学;走 chant-requests
                    # 文件通道由女神侧 castSpell 结算,不走 RCON)
                    append_chant_req(g["name"], "归乡")
                    feed_append(g, "reflex", f"HP {hp}/20 无粮 → 反射咏唱归乡")
                    log(f"濒死无粮 → 归乡(chant-requests)")
            # R2 断粮进食
            elif isinstance(hunger, (int, float)) and hunger <= 8 and _reflex_gate(tag, "eat", REFLEX_EAT_THROTTLE):
                eat_chain(f"饥饿 {hunger}/20")
            # R6 卡死:任务在跑但 20s 没挪窝 → 叫停交慢系统重议(mindcraft unstuck)
            try:
                tstat = rinvoke("task_status", {})
                task_running = '"state":"running"' in json.dumps(tstat, ensure_ascii=False) \
                    or "running" in json.dumps(tstat.get("data", {}), ensure_ascii=False) if isinstance(tstat, dict) else False
            except Exception:
                task_running = False
            if _stuck_verdict(tag, pos, task_running) and _reflex_gate(tag, "stuck", REFLEX_STUCK_THROTTLE):
                rinvoke("task_stop", {})
                _reflex_stuck[tag] = [pos, 0]
                feed_append(g, "reflex", "任务在跑但 20s 未挪窝 → 反射叫停,请重新决策")
                log("卡死 → task_stop(交慢系统重议)")
        except Exception as e:
            log(f"反射拍异常(继续): {type(e).__name__}: {e}")
        time.sleep(REFLEX_POLL)


# ---------------- 主入口 ----------------
def main():
    limit = float(os.environ.get("GUARD_MAX_SECONDS", "0") or 0)
    stop_at = time.time() + limit if limit > 0 else 0
    threads = []
    for g in GUARDS:
        tgt = autonomy_loop if g.get("autonomy") else drive_loop
        t = threading.Thread(target=tgt, args=(g, stop_at), daemon=True)
        t.start()
        threads.append(t)
        # 快系统:反射层独立线程(2026-08-29 造物主令,MindCraft self-preservation)
        tr = threading.Thread(target=reflex_loop, args=(g, stop_at), daemon=True)
        tr.start()
        threads.append(tr)
    # 影分身分脑引擎（2026-08-24）：独立线程扫描在册分身，开分脑 session、血线解散、消失融合
    tk = threading.Thread(target=kage_loop, args=(stop_at,), daemon=True)
    tk.start()
    threads.append(tk)
    _descs = [(g["name"] + ("(React)" if g.get("autonomy") else "(旧JSON)")) for g in GUARDS]
    print("[guard_drive] 双亲卫桥已启动：" + "、".join(_descs) + f"（限时 {limit}s；反射层 5s 心跳）", flush=True)
    for t in threads:
        t.join()


if __name__ == "__main__":
    main()
