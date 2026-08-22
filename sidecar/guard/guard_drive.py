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

# 决策 prompt 模板：喂给亲卫，让它输出一个动作 JSON
def decision_prompt(g, status, world, look, scan, last_act, goal, standing_task=None):
    return "\n".join([
        f"【{g['name']}身体快照】{status}",
        f"【世界】{world}",
        f"【周围地形 look_around】\n{look}",
        f"【附近实体 hostile】{scan}",
        f"【上一动作】{last_act or '（无，这是第一轮）'}",
        f"【当前任务（常驻）】{standing_task or '（无——身体空闲）'}",
        f"【当前目标】{goal or '（尚未立下目标——结合处境先定一个眼前该办的正事）'}",
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
        '- follow：{"target":"owner"} 跟随主人',
        '- say：{"message":"<一句话>"} 以身体本人的身份在公屏说话，与在场玩家/NPC 交谈、回应别人、报平安、求援——你「开口」的唯一方式；语气要像本人（见 PROFILE 人物志），短而自然，别喊口号',
        '- task_stop：{} 叫停当前动作',
        '- 感知：look_around / scan_nearby_entities / get_self_status / get_world_info / task_status',
        "",
        "裁决要点：",
        "- 生存第一：饿了进食、天黑找庇护或回家睡觉、遇怪则战或避、怕深水则绕开；",
        "- 目标连贯：goal 是你此刻想办成的事（如「天黑前搭个遮雨窝」），一次只做一个动作，做完等 task_finished 再规划下一步；目标达成或不再要紧，就在本轮的 goal 里换掉；",
        "- 不贪心：不索要钻石、不造奇观，先活着、再攒生计；",
        "- 有危险优先处理危险，没事就奔着当前目标推进（砍树/采煤/觅食/回家）。",
        "",
        "常驻任务的处置（若【当前任务】是『跟随』这类无终点任务）：",
        "- 这不是坏事——跟主人走是正常诉求；它不会自己结束，需要你决定留还是换。",
        "- 若跟随仍有意义（主人就在近旁、或你要跟他走）→ 保持现状，可输出感知类工具确认，或直接给一个无害动作；",
        "- 若跟随已无意义（主人离线、目标消失、你需要去办别的事）→ 输出新的身体动作（mine/eat/goto/sleep 等），新动作会自动顶替跟随（numen 语义：派别的东西就是让它停下的正常方式）。",
        "- 不要因为『有任务在跑』就什么都不做——常驻任务占着身体不等于锁死你，你永远是决策者。",
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
    log(f"亲卫桥启动 agent={g['agent']} session={g['session']}")
    while True:
        if stop_at and time.time() >= stop_at:
            log("试运行时间到，退出")
            return
        round_n += 1
        current_task = None
        try:
            # 1. 查任务状态：有"有界"任务在跑就先等，不派新动作；
            #    但"常驻"任务（follow 类，无终点、永不 task_finished）不能把决策锁死——
            #    numen 语义是"派别的身体动作就顶替它"，所以要把这个状态喂给亲卫，
            #    让它自己决定继续跟随还是换成别的活。判断标准：time budget 是天文数字
            #    （>= NO_DEADLINE 折算）或 task 名在常驻集合里。
            STANDING_TASKS = {"follow", "follow_entity"}
            ts = query(g["name"], "task_status")
            if isinstance(ts, dict) and ts.get("success") is True:
                msg = ts.get("message", "")
                data = ts.get("data") or {}
                task_name = str(data.get("task", "")).strip()
                budget_left = data.get("budget_left_s")
                is_standing = (
                    task_name in STANDING_TASKS
                    or (isinstance(budget_left, (int, float)) and budget_left > 1000000)
                )
                if "空闲" not in msg and "没有后台任务" not in msg and not is_standing:
                    feed_append(g, "busy", msg[:200])
                    time.sleep(BUSY_POLL)
                    continue
                if is_standing:
                    # 常驻任务：不锁死决策，但把"当前在跟随/常驻"状态喂给亲卫判断
                    current_task = data.get("task") or task_name
                    current_task_desc = str(data.get("task_id", "") or "")
                    feed_append(g, "standing", f"task={task_name} id={current_task_desc} budget={budget_left}")
                    log(f"常驻任务在跑：{task_name}（不锁决策，交给亲卫判断是否替换）")
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
            look = invoke(g["name"], "look_around", {"radius": 8})
            scan = invoke(g["name"], "scan_nearby_entities", {"radius": 16, "type_filter": "hostile"})
            # 3. 喂亲卫决策
            prompt = decision_prompt(g, status, world, look, scan, last_act, goal, standing_task=current_task)
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
