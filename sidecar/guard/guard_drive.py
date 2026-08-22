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
import io, json, os, re, sys, time, socket, struct, threading, urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ---------------- 常量 ----------------
# 2026-08-21 容器化：硬编码 127.0.0.1 改为 env 可覆盖（独立 guard-drive 容器需连 mc-server/qwenpaw 容器网）
RCON_HOST = os.environ.get("MC_RCON_HOST", "127.0.0.1")
RCON_PORT = int(os.environ.get("MC_RCON_PORT", "25575"))
RCON_PW = os.environ.get("RCON_PASSWORD")
# 密码回退：env 优先；无 env/空时从世界侧 rcon-secret.txt 读（与 _diag_summon.py 同源），
# 不依赖外部 shell 预先注入 env，可移植、可跨容器。
if not RCON_PW:
    # 候选：1) MC_RCON_SECRET 显式指定；2) deepseek-harness 世界侧秘密文件（绝对路径兼容本机/容器）
    _secret_candidates = [
        os.environ.get("MC_RCON_SECRET"),
        r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data\rcon-secret.txt",
        "/root/deepseek-harness/scratch-plugin/data/rcon-secret.txt",  # 容器内路径
    ]
    _secret_candidates = [c for c in _secret_candidates if c]
    for _cand in _secret_candidates:
        if os.path.isfile(_cand):
            _val = open(_cand, "r", encoding="utf-8").read().strip()
            if _val:
                RCON_PW = _val
                break
if not RCON_PW:
    raise SystemExit("缺少 RCON_PASSWORD 环境变量（见 .env / docker-compose；可设 MC_RCON_SECRET 指定 secret 文件）")
CONSOLE_URL = os.environ.get("QWENPAW_CONSOLE_URL", "http://127.0.0.1:8088/api/console/chat")
# 已归位 B 仓 sidecar/guard/：账本写本仓 data/（不再跨仓引 A 仓 scratch-plugin/data）
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(REPO_ROOT, "data")

# 两穿越者：身体名 -> 亲卫 agent + 持久 session
GUARDS = [
    {"name": "桐人", "agent": "mc-guard-kirito", "session": "guard:kirito", "tag": "kirito"},
    {"name": "鸣人", "agent": "mc-guard-naruto", "session": "guard:naruto", "tag": "naruto"},
]

# 每轮节奏（秒）
DECIDE_INTERVAL = 20      # 空闲时：决策+执行一轮后休息
BUSY_POLL = 6             # 有任务在跑时：只轮询，不决策
LOST_POLL = 30            # 伴链断连时：只降频心跳（身体实体不在，别刷无效动作）
MAX_RUN_SECONDS = 0       # 0 = 无限循环（常驻）；>0 用于试运行

# 任务熔断阈值（QwenPaw 决策 loop 不僵死的核心）：
# 有界任务跑得比这久/预算快耗尽 → 主动 task_stop 让亲卫重议，绝不无限轮询。
MAX_TASK_RUN_ELAPSED = 420   # 有界任务最长跑多少秒（7 分钟）即熔断
MAX_TASK_BUDGET_STOP = 60    # 有界任务预算剩多少秒即熔断（视为快超时，别等它自然结束）
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
    # 说话（独立命令 numen_act say，非 invoke 工具）
    "say",
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
def decision_prompt(g, status, world, look, scan, last_act, goal, standing_task=None, standing_stuck=False, emergency=None):
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
        f"【{g['name']}身体快照】{status}",
        f"【世界】{world}",
        f"【周围地形 look_around】\n{look}",
        f"【附近实体 hostile】{scan}",
        f"【上一动作】{last_act or '（无，这是第一轮）'}",
        f"【当前任务（常驻）】{standing_task or '（无——身体空闲）'}{stuck_hint}",
        f"【当前目标】{goal or '（尚未立下目标——结合处境先定一个眼前该办的正事）'}",
        emergency_hint,
        "",
        f"你是亲卫（{g['agent']}），直管穿越者{g['name']}的魂。此刻他的身体由你掌舵——",
        "以他的性格（见你的 PROFILE 人物志）替他决定下一步生存动作。",
        "",
        "结合场景信息、上下文与当前目标，智能判断「此刻最该干的一件事」；",
        "不要把决策做成固定循环，也不要把上一动作机械照搬——场景变了就改道，目标达成了就换目标。",
        "",
        "只输出一个 JSON 对象，不要多余文字、不要调用工具、不要索要神恩（祈愿另由你上达天神）：",
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
        '- follow：{"target":"owner"} 跟随指定目标——只在「明确护卫/同行指令」时用它，否则别主动跟；',
        '- say：{"message":"<一句话>"} 以身体本人的身份在公屏说话，与在场玩家/NPC 交谈、回应别人、报平安、求援——你「开口」的唯一方式；语气要像本人（见 PROFILE 人物志），短而自然，别喊口号',
        '- task_stop：{} 叫停当前动作',
        '- 感知：look_around（{radius} 附近地形）/ scan_nearby_entities（必须有 type_filter 参数，如 {"radius":16,"type_filter":"hostile"}）/ get_self_status / get_world_info / task_status',
        "",
        "裁决要点：",
        "- 生存第一：饿了进食、天黑找庇护或回家睡觉、遇怪则战或避、怕深水则绕开；",
        "- 目标连贯：goal 是你此刻想办成的事（如「天黑前搭个遮雨窝」），一次只做一个动作，做完等 task_finished 再规划下一步；目标达成或不再要紧，就在本轮的 goal 里换掉；",
        "- 不贪心：不索要钻石、不造奇观，先活着、再攒生计；",
        "- 有危险优先处理危险，没事就奔着当前目标推进（砍树/采煤/觅食/回家）。",
        "",
        "常驻任务的处置（若【当前任务】是『follow』这类无终点任务）：",
        "- 你是自主智能体，不是谁的从属。follow 只在「明确护卫/同行指令」下才有意义，除此之外它不该占着你。",
        "- 若没有确切的护卫指令、或目标根本不在/已离线 → 立刻输出新的身体动作（mine/eat/goto/sleep/attack 等），新动作会自动顶替 follow（numen 语义：派别的东西就是让它停下的正常方式）。",
        "- 不要因为『有任务在跑』就什么都不做——常驻任务占着身体不等于锁死你，你永远是决策者，按自己的生存目标走。",
    ])


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
    """numen_act invoke <name> <tool> <json>；中文名双引号包裹。"""
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
def call_guard(agent, session, prompt):
    payload = {
        "channel": "console",
        "user_id": f"guard:{session}",
        "session_id": session,
        "input": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
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
    # —— 任务熔断推进追踪（QwenPaw 决策 loop 不僵死）——
    # 记录当前有界任务启动时间（elapsed_s 由 numen 给，但 start_ts 便于守卫桥侧判断持续时间）
    task_start_ts = None          # 当前"正在跑的任务"首次观察到的墙上时钟
    task_prev_elapsed = 0         # 上一次观察到的 elapsed_s（用于检测任务是否推进）
    last_pos = None               # 上一轮身位（x,y,z），用于"是否推进"熔断
    log(f"亲卫桥启动 agent={g['agent']} session={g['session']}")
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
            ts = query(g["name"], "task_status")
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
                # —— 熔断判定：有界任务卡死/超时/预算将尽 → task_stop ——
                if not is_standing and "空闲" not in msg and "没有后台任务" not in msg:
                    elapsed_ok = (isinstance(elapsed_s, (int, float)) and elapsed_s > MAX_TASK_RUN_ELAPSED)
                    # "死任务"早拆除：预期有限的动作（打一只怪/砍几棵树）打了 150s+ 还没收尾 → 卡死
                    # （通常卡在目标已死但 task_finished 没来 / 目标清不掉，numen 一直报"战斗 x/y"）
                    dead_ok = (isinstance(elapsed_s, (int, float)) and elapsed_s > MAX_TASK_DEAD_ELAPSED)
                    budget_ok = (isinstance(budget_left, (int, float)) and 0 < budget_left <= MAX_TASK_BUDGET_STOP)
                    if elapsed_ok or dead_ok or budget_ok:
                        feed_append(g, "tripped", f"有界任务 {task_id}({task_name}) 卡死：elapsed={elapsed_s}s budget={budget_left}s → task_stop 熔断")
                        log(f"⚠ 有界任务 {task_id}({task_name}) 超时/预算尽（elapsed={elapsed_s}s budget={budget_left}s），task_stop 熔断，让亲卫重议")
                        R.cmd(f'numen_act invoke "{g["name"]}" task_stop {{}}')
                        # 叫停后本轮不派新动作（等下一轮拿到空闲态再决策）
                        tripped = True
                        current_task = None
                    else:
                        # 正常有界任务在跑：记录启动时间，轮询等待
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
                        osq = query(g["name"], "get_owner_status")
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
            status = invoke(g["name"], "get_self_status")
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
                time.sleep(LOST_POLL)
                continue
            if isinstance(status, dict) and not status.get("success", True) and "no companion" in str(status):
                feed_append(g, "disconnected", str(status)[:200])
                log(f"伴链断连：{g['name']} 身体实体不在，停发新动作，等重挂")
                time.sleep(LOST_POLL)
                continue
            world = invoke(g["name"], "get_world_info")
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
                    R.cmd(f'numen_act invoke "{g["name"]}" task_stop {{}}')
                    # 本轮不再走"常驻任务在跑"的跟随逻辑，直接进入濒死决策
                    standing_stuck = False
            look = invoke(g["name"], "look_around", {"radius": 8})
            scan = invoke(g["name"], "scan_nearby_entities", {"radius": 16, "type_filter": "hostile"})
            # 3. 喂亲卫决策（standing_stuck 标记常驻任务空转过久的强出口；emergency 标记濒死，优先保命）
            prompt = decision_prompt(g, status, world, look, scan, last_act, goal,
                                     standing_task=current_task, standing_stuck=standing_stuck,
                                     emergency=emergency)
            ans = call_guard(g["agent"], g["session"], prompt)
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
            if tool == "say":
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
                out = R.cmd(f'numen_act say "{g["name"]}" {msg}')
            else:
                # —— 参数归一化：亲卫可能少给必填参数，补默认避免 invoke 报错（自主循环健壮性）——
                args = _normalize_args(tool, args)
                out = invoke(g["name"], tool, args)
            log(f"R{round_n} {tool} {json.dumps(args, ensure_ascii=False)[:80]} → {out[:100]}")
            feed_append(g, "act", f"tool={tool} args={json.dumps(args, ensure_ascii=False)[:120]} reason={reason} → {out[:120]}")
            last_act = f"{tool} {json.dumps(args, ensure_ascii=False)[:60]} → {out[:80]}"
        except Exception as e:
            log(f"轮次异常：{e}")
            feed_append(g, "error", str(e)[:200])
        time.sleep(DECIDE_INTERVAL)


# ---------------- 主入口 ----------------
def main():
    limit = float(os.environ.get("GUARD_MAX_SECONDS", "0") or 0)
    stop_at = time.time() + limit if limit > 0 else 0
    threads = []
    for g in GUARDS:
        t = threading.Thread(target=drive_loop, args=(g, stop_at), daemon=True)
        t.start()
        threads.append(t)
    print(f"[guard_drive] 双亲卫桥已启动：剑侍→桐人、影侍→鸣人（限时 {limit}s）", flush=True)
    for t in threads:
        t.join()


if __name__ == "__main__":
    main()
