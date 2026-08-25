# -*- coding: utf-8 -*-
"""mcp_numen.py —— 把 numen 假玩家身体工具暴露为 MCP server（stdio）

让 QwenPaw 亲卫 agent 直接【真 tool_call】驱动假玩家身体，而不是吐 JSON 让守卫桥解析。

## 设计
- FastMCP (mcp>=1.29, qwenpaw venv 同款) stdio 传输；由 QwenPaw agent 的
  `mcp.clients.<名>` 配置 Popen 启动（command=python, args=[本文件], env 注入身体绑定）。
- 每个工具作用在【一位】假玩家身上：login（ASCII 登录名）从 env `NUMEN_COMPANION` 读
  （如 Naruto），display（中文名）从 env `NUMEN_DISPLAY` 读（如 鸣人）。缺省回落：
  companion=【桐人/Kirito】【鸣人/Naruto】二选一——但标准做法是上级 MCP client env 显式指定。
- 通道对齐守卫桥：
  * 感知/动作工具 → RCON `numen_act invoke "<login>" <tool> <json>`（权威，回结果/受理 task_id）
  * say          → RCON `numen_act say "<login>" <message>`
  * chant        → 写 chant-requests.jsonl（女神侧 castSpell 消费）
  * pray         → 写 god-inbox.jsonl（女神收件箱，asPlayer=true）
- 动作型工具（goto/mine/attack/sleep...）numen 受理即回 task_id（异步长任务），本 server
  不轮询收尾——把「查询进度」交给 LLM 用 task_status 自问，更符合真工具调用的心智，也不卡 stdio。
  （感知型工具当场回结果，LLM 立刻能用。）
"""
import asyncio
import base64
import os
import json
import re
import socket
import struct
import subprocess
import sys
import time

# ---- 中文微调：顶到最前，稳 stderr/stdout 编码（Windows）----
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from mcp.server.fastmcp import FastMCP
from mcp.types import ImageContent

# ---------------- 常量 ----------------
RCON_HOST = os.environ.get("MC_RCON_HOST", "127.0.0.1")
RCON_PORT = int(os.environ.get("MC_RCON_PORT", "25575"))
RCON_PW = os.environ.get("RCON_PASSWORD")
# 身体绑定：login(ASCII) display(中文)。QwenPaw MCP client env 注入；缺省用守卫桥默认
NUMEN_COMPANION = os.environ.get("NUMEN_COMPANION", "Naruto")
NUMEN_DISPLAY = os.environ.get("NUMEN_DISPLAY", "鸣人")
# 影分身名（2026-08-24 造物主定调：分身是"战斗用工具"，鸣人（大脑）可遥感控制它）。
# 与 mc-god.ts kage_bunshin 召唤写死的 Kage1/Kage2 保持一致；分身死亡即散/超时回收。
KAGE_NAMES = ["Kage1", "Kage2"]
# 与女神侧共享的通道文件（同守卫桥；容器迁移经 MC_DATA_DIR 覆盖）
WORLD_DATA = os.environ.get(
    "MC_DATA_DIR",
    r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data",
)
CHANT_REQ = os.path.join(WORLD_DATA, "chant-requests.jsonl")
GOD_INBOX = os.path.join(WORLD_DATA, "god-inbox.jsonl")

# ---- 渲染（复用守卫之眼 guard-render.mts）----
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(REPO_ROOT, "data")
NODE_EXE = os.environ.get("NODE_EXE", r"C:\Program Files\nodejs\node.exe")
TSX_CLI = os.environ.get(
    "TSX_CLI",
    r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\node_modules\tsx\dist\cli.mjs",
)
RENDER_SCRIPT = os.path.join(REPO_ROOT, "sidecar", "guard", "guard-render-pure.mts")
RENDER_SCRIPT_FP = os.path.join(REPO_ROOT, "sidecar", "guard", "guard-render-webgl.mts")
RENDER_TIMEOUT = int(os.environ.get("GUARD_RENDER_TIMEOUT", "100"))


def _read_rcon_pw():
    if RCON_PW:
        return RCON_PW
    for cand in [
        os.environ.get("MC_RCON_SECRET"),
        os.path.join(r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data", "rcon-secret.txt"),
    ]:
        if cand and os.path.isfile(cand):
            try:
                return open(cand, encoding="utf-8-sig").read().strip()
            except OSError:
                continue
    return ""


class Rcon:
    """极简 RCON 客户端（对齐守卫桥 Rcon）：一次连接一次命令，同步返回。"""

    def __init__(self):
        self.pw = _read_rcon_pw().encode("utf-8")

    @staticmethod
    def _recv_exact(sock, n):
        buf = b""
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                break
            buf += chunk
        return buf

    def cmd(self, command, timeout=20):
        """守卫桥同款 RCON：认证 body 读 alen-8、响应 body 读 length-8、rstrip null。"""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect((RCON_HOST, RCON_PORT))
            p = self.pw
            s.send(struct.pack("<iii", len(p) + 10, 1, 3) + p + b"\x00\x00")
            hdr = self._recv_exact(s, 12)
            if len(hdr) < 12:
                return "(no auth response)"
            alen, _, _ = struct.unpack("<iii", hdr[:12])
            self._recv_exact(s, alen - 8)
            cp = command.encode("utf-8")
            s.send(struct.pack("<iii", len(cp) + 10, 2, 2) + cp + b"\x00\x00")
            hdr2 = self._recv_exact(s, 12)
            if len(hdr2) < 12:
                return "(no response)"
            length, _, _ = struct.unpack("<iii", hdr2[:12])
            body = self._recv_exact(s, length - 8)
            return body.decode("utf-8", errors="replace").rstrip("\x00")
        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)
        finally:
            try:
                s.close()
            except OSError:
                pass


_R = None


def rcon():
    global _R
    if _R is None:
        _R = Rcon()
    return _R


def invoke(tool, args=None):
    """numen_act invoke <login> <tool> <json> —— 感知/动作统一入口（作用在本守卫身体）。"""
    return invoke_for(NUMEN_COMPANION, tool, args)


def invoke_for(companion: str, tool: str, args=None):
    """numen_act invoke <任意同伴名> <tool> <json> —— 作用在指定同伴（如影分身 Kage1/Kage2）。

    分身是"战斗用工具"：鸣人（大脑）通过本入口对无 LLM 的影分身下发程序化指令
    （attack/goto/follow/get_self_status 等），分身按 numen 工具语义执行。"""
    a = json.dumps(args if args is not None else {}, ensure_ascii=False)
    cmd = f'numen_act invoke "{companion}" {tool} {a}'
    return rcon().cmd(cmd)


# ---------------- MCP server ----------------
mcp = FastMCP(
    f"numen-{NUMEN_DISPLAY}",
    instructions=(
        f"你是亲卫，直管穿越者「{NUMEN_DISPLAY}」的身体（numen 假玩家，登录名 {NUMEN_COMPANION}）。"
        "这些工具按 numen 语义工作：感知型当场回结果；动作型（goto/mine/attack/sleep/collect_items/equip_item 等）"
        "受理即回 task_id 是长任务，可用 task_status 查询进度。不要连续重复同一长任务而不查进度。"
        f"你还能召影分身（kage_bunshin），用 kage_* 工具遥感控制它们：先 kage_status 看分身在哪/在干什么，"
        "再 kage_attack/kage_goto 下令，打完 kage_follow 召回或 kage_dismiss 解除。分身是无 LLM 的战斗执行体，你是大脑。"
    ),
)


# ============ 感知 ============
@mcp.tool()
async def get_self_status() -> str:
    """查询身体自状态：HP/饥饿/位置/氧气/天时/在场敌对等。返回 JSON 文本。"""
    return invoke("get_self_status")


@mcp.tool()
async def get_recent_messages(limit: int = 8) -> str:
    """听见最近的『话音』：玩家公屏说话、女神谕示（指名给本守卫的）、咏唱回执。

    返回 JSON 文本（最近 limit 条），按 kind 区分 player/goddess/chant_reply/system。
    这是你的『听觉』——主动调用它去听世界在说什么，不用等守卫桥喂。"""
    import json as _json, os as _os
    out: list[dict] = []

    # 玩家公屏（player-chat.jsonl 追加不清，从尾读最近 limit 条）
    pc = _os.path.join(WORLD_DATA, "player-chat.jsonl")
    if _os.path.exists(pc):
        try:
            with open(pc, "r", encoding="utf-8") as f:
                lines = [l for l in f.read().splitlines() if l.strip()]
            if lines:
                for ln in lines[-limit:]:
                    try:
                        rec = _json.loads(ln)
                        u = str(rec.get("user", "")).strip()
                        t = str(rec.get("text", "")).strip()
                    except Exception:
                        continue
                    if u and t:
                        out.append({"kind": "player", "user": u, "text": t})
        except Exception:
            pass

    # 女神谕示（goddess-orders, to=本人） + 咏唱回执（chant-reply, speaker=本人）
    for path, field in (
        (_os.path.join(WORLD_DATA, "goddess-orders.jsonl"), "to"),
        (_os.path.join(WORLD_DATA, "chant-reply.jsonl"), "speaker"),
    ):
        if not _os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = [l for l in f.read().splitlines() if l.strip()]
        except Exception:
            continue
        if not lines:
            continue
        for ln in lines[-limit:]:
            try:
                rec = _json.loads(ln)
                if str(rec.get(field, "")).strip() != NUMEN_COMPANION:
                    continue
                txt = str(rec.get("reply") or rec.get("msg") or rec.get("text") or "").strip()
            except Exception:
                continue
            if txt:
                out.append({"kind": "goddess" if field == "to" else "chant_reply", "text": txt})

    # 系统/信使消息（guard-inbox.jsonl, to=本人登录名或显示名）：升级/觉醒/成就/物品回执
    gi = _os.path.join(WORLD_DATA, "guard-inbox.jsonl")
    if _os.path.exists(gi):
        try:
            with open(gi, "r", encoding="utf-8") as f:
                lines = [l for l in f.read().splitlines() if l.strip()]
            if lines:
                for ln in lines[-limit:]:
                    try:
                        rec = _json.loads(ln)
                        to = str(rec.get("to", "")).strip()
                        if to not in (NUMEN_COMPANION, NUMEN_DISPLAY):
                            continue
                        txt = str(rec.get("text", "")).strip()
                    except Exception:
                        continue
                    if txt:
                        out.append({"kind": "system", "user": "系统", "text": txt})
        except Exception:
            pass

    if not out:
        return "你暂时什么也没听见（最近没有针对你的话音）。"
    return _json.dumps(out[-limit:], ensure_ascii=False)


# 被动技能名转译（skill-events.json 常见 id → 中文，读到未知保留原文）
_PASSIVE_NAMES = {
    "bloodrage": "血怒", "bulwark": "坚垒", "fortitude": "坚毅", "survival": "求生",
}


@mcp.tool()
async def get_magic_state() -> str:
    """内观术——查自身修为与所悟之力：修为层级/魔力/已学技能/先天天赋/被动/可修习之法。

    返回 JSON 文本。这是你的『内视』——主动调用它以明自身修为，不必靠他人告知。
    （读魔法状态文件 magic-state.json 本人条目 + magic-atoms.json 把技能 id 转译为中文名。）"""
    import json as _json, os as _os

    state_path = _os.path.join(WORLD_DATA, "magic-state.json")
    if not _os.path.exists(state_path):
        return "内观失败：修为簿不在（magic-state.json 未找到）。"
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            players = _json.load(f).get("players", {})
        p = players.get(NUMEN_COMPANION)
    except Exception as e:
        return f"内观失败：{e}"
    if not p:
        return f"内观失败：修为簿里没有「{NUMEN_COMPANION}」的条目。"

    # 技能表：id → atom（优先运行态 WORLD_DATA，兜底 B 仓基准表 data/magic-atoms.json）
    atoms: dict[str, dict] = {}
    for cand in (
        _os.path.join(WORLD_DATA, "magic-atoms.json"),
        _os.path.join(REPO_ROOT, "data", "magic-atoms.json"),
    ):
        if _os.path.exists(cand):
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    ad = _json.load(f)
                alist = ad.get("atoms", ad) if isinstance(ad, dict) else ad
                if isinstance(alist, dict):
                    alist = list(alist.values())
                for a in alist:
                    if isinstance(a, dict) and a.get("id"):
                        atoms[a["id"]] = a
                break
            except Exception:
                continue

    def nm(aid):
        a = atoms.get(aid)
        return (a or {}).get("name") or aid

    lv = p.get("level", 0)
    mana = p.get("mana", 0)
    maxmana = p.get("maxMana", 0)
    maxbonus = p.get("maxManaBonus", 0)
    innate = p.get("innateSkill")
    learned = p.get("learned", [])
    adv = p.get("advancementSkills", [])
    passives = p.get("passives", [])
    hp = p.get("hpRatio")
    food = p.get("foodRatio")

    learned_list = [{"name": nm(x), "id": x} for x in learned]
    adv_list = [nm(x) for x in adv if x in learned]
    innate_name = nm(innate) if innate else None
    # 可修习：已达标、未学（innate 不算可再学，排除；innate 已是所学）
    learnable = []
    for aid, a in atoms.items():
        if not aid or aid in learned or a.get("innate"):
            continue
        req = a.get("requiredLevel", 999)
        if req <= lv:
            learnable.append({"name": nm(aid), "id": aid, "level": req})
    learnable.sort(key=lambda x: x["level"])

    out = {
        "姓名": NUMEN_DISPLAY,
        "登录名": NUMEN_COMPANION,
        "修为层级": f"Lv.{lv}",
        "魔力": f"{int(mana)}/{int(maxmana)}",
        "魔力上限加成": int(maxbonus),
        "天赋": innate_name,
        "已学技能数": len(learned_list),
        "已学技能": [x["name"] for x in learned_list],
        "历练解锁": adv_list,
        "被动": [_PASSIVE_NAMES.get(x, x) for x in passives],
        "可修习": [x["name"] for x in learnable],
        "生命": hp,
        "饱食": food,
        "修为进度": p.get("exp"),
    }
    return _json.dumps(out, ensure_ascii=False)


@mcp.tool()
async def get_world_info() -> str:
    """查询世界信息：时间（day/night）/天气/维度/出生点。返回 JSON 文本。"""
    return invoke("get_world_info")


@mcp.tool()
async def look_around(radius: int = 8) -> str:
    """看你身体周围地形的文本俯视图（方块名、高度、可通行性）。radius 默认 8 格。"""
    return invoke("look_around", {"radius": radius})


@mcp.tool()
async def scan_nearby_entities(
    radius: int = 16,
    type_filter: str = "hostile",
) -> str:
    """扫描身体附近实体。type_filter 缺省 'hostile'（敌对）；也可 'passive'/'player'/'item' 等。"""
    return invoke("scan_nearby_entities", {"radius": radius, "type_filter": type_filter})


@mcp.tool()
async def scan_blocks(block_ids: list[str]) -> str:
    """在世界里找某些方块（按 id 列表），返回位置。例：['minecraft:oak_log']。"""
    return invoke("scan_blocks", {"block_ids": block_ids})


@mcp.tool()
async def task_status() -> str:
    """查询当前身体正在执行的任务状态（动作型工具受理后用它轮询进度/是否完成）。"""
    return invoke("task_status")


# ============ 动作（受理即回 task_id，长任务） ============
@mcp.tool()
async def goto(x: float | None = None, z: float | None = None, block: str | None = None) -> str:
    """走到某处。给 (x,z) 坐标；或给 block 如 'minecraft:oak_log' 走到某方块旁。y 自动解析地表。"""
    args = {}
    if block is not None:
        args["block"] = block
    else:
        args["x"] = float(x) if x is not None else 0
        args["z"] = float(z) if z is not None else 0
    return invoke("goto", args)


@mcp.tool()
async def mine(block_ids: list[str], count: int = 8) -> str:
    """采集方块（采矿/砍树）。block_ids 例 ['minecraft:oak_log']；count 目标数量。"""
    return invoke("mine", {"block_ids": block_ids, "count": count})


@mcp.tool()
async def collect_items() -> str:
    """捡拾附近掉落物（把地面物资拾入背包）。"""
    return invoke("collect_items")


@mcp.tool()
async def eat(item_id: str) -> str:
    """进食指定食物（补饥饿/回血）。item_id 例 'minecraft:bread'。"""
    return invoke("eat", {"item_id": item_id})


@mcp.tool()
async def attack(entity_ids: list[str] | None = None, nearby: bool = True) -> str:
    """对付近身敌怪。给 entity_ids 精确打；缺省/nearby=true 自动打贴脸敌。"""
    return invoke("attack", {"entity_ids": entity_ids, "nearby": nearby})


@mcp.tool()
async def sleep() -> str:
    """睡最近的床（跳夜/回血）。需站在床旁；否则会失败提示。"""
    return invoke("sleep")


@mcp.tool()
async def follow(target: str = "owner") -> str:
    """跟随指定目标（仅明确护卫/同行指令时用）。target 默认 'owner'。"""
    return invoke("follow", {"target": target})


@mcp.tool()
async def task_stop() -> str:
    """叫停当前长任务（身体忙时新派被拒，先 stop 再派新的）。"""
    return invoke("task_stop")


# ============ 影分身（感知 + 控制，2026-08-24 造物主定调） ============
# 分身是"战斗用工具"：它是无 LLM 的 numen 执行体；你（鸣人）是大脑，通过下面的工具
# 遥感它——先 kage_status 看有谁、在哪、在干什么，再 kage_attack/kage_goto 下令，
# 打完 kage_follow 召回或 kage_dismiss 解除。分身技能=你的技能，不新增。

_KAGE_HELP = (
    f"分身名只接受 {'/'.join(KAGE_NAMES)}。分身是瞬态战斗实体：死亡即散（不复活）、超时自动回收。"
)


def _kage_invoke(name: str, tool: str, args=None) -> str:
    """内部：校验分身名后，对指定影分身下发 numen 工具。"""
    if name not in KAGE_NAMES:
        return json.dumps({"error": f"no kage '{name}'; valid: {', '.join(KAGE_NAMES)}"}, ensure_ascii=False)
    return invoke_for(name, tool, args)


@mcp.tool()
async def kage_status(name: str = "Kage1") -> str:
    """感知你的影分身：查该分身状态（HP/位置/正在做的事/在场敌对等）。name 只接受 Kage1/Kage2。返回 JSON 文本。"""
    return _kage_invoke(name, "get_self_status")


@mcp.tool()
async def kage_scan(name: str = "Kage1", radius: int = 16, type_filter: str = "hostile") -> str:
    """感知你的影分身：查该分身周围实体。type_filter 'hostile'/'passive'/'player'/'item' 等。"""
    return _kage_invoke(name, "scan_nearby_entities", {"radius": radius, "type_filter": type_filter})


@mcp.tool()
async def kage_attack(name: str = "Kage1", entity_ids: list[str] | None = None, nearby: bool = True) -> str:
    """控制你的影分身：下令该分身对付近身敌怪。给 entity_ids 精确打；缺省/nearby=true 自动打贴脸敌。"""
    return _kage_invoke(name, "attack", {"entity_ids": entity_ids, "nearby": nearby})


@mcp.tool()
async def kage_goto(name: str = "Kage1", x: float | None = None, z: float | None = None, block: str | None = None) -> str:
    """控制你的影分身：下令该分身走到某处。给 (x,z) 坐标；或给 block 走到某方块旁。y 自动解析地表。"""
    args = {}
    if block is not None:
        args["block"] = block
    else:
        args["x"] = float(x) if x is not None else 0
        args["z"] = float(z) if z is not None else 0
    return _kage_invoke(name, "goto", args)


@mcp.tool()
async def kage_follow(name: str = "Kage1", target: str = "owner") -> str:
    """召回你的影分身：下令该分身跟随指定目标（默认 owner=你）。近你身则休眠，走远自动醒。"""
    return _kage_invoke(name, "follow", {"target": target})


@mcp.tool()
async def kage_dismiss(name: str = "Kage1") -> str:
    """解除你的影分身：直接遣散该分身（不复活）。"""
    if name not in KAGE_NAMES:
        return json.dumps({"error": f"no kage '{name}'; valid: {', '.join(KAGE_NAMES)}"}, ensure_ascii=False)
    return rcon().cmd(f'numen_act dismiss "{name}"')


# ============ 说话 ============
@mcp.tool()
async def say(message: str) -> str:
    """以身体本人的身份在公屏说话（与在场玩家/NPC 交谈、回应、报平安、求援）。语气像本人，短而自然。"""
    msg = (message or "").strip()[:256]
    return rcon().cmd(f'numen_act say "{NUMEN_COMPANION}" {msg}')


@mcp.tool()
async def chant(spell: str) -> str:
    """咏唱你已学会的技能（等同私语念咒）。女神侧按技能表判定：已学会的自己施法，未学会的会得到提示。危急时优先用你掌握的法术自救。"""
    try:
        with open(CHANT_REQ, "a", encoding="utf-8") as f:
            f.write(json.dumps(
                {"speaker": NUMEN_COMPANION, "text": spell.strip(),
                 "ts": int(time.time() * 1000)}, ensure_ascii=False) + "\n")
        return "已上达咏唱通道"
    except OSError as e:
        return json.dumps({"error": f"chant 写盘失败: {e}"}, ensure_ascii=False)


@mcp.tool()
async def pray(wish: str) -> str:
    """祈愿上达天神（危急求助、重大事项、求指引）。用语恳切、说清楚处境与所求。别拿它当闲聊。"""
    try:
        with open(GOD_INBOX, "a", encoding="utf-8") as f:
            f.write(json.dumps(
                {"key": NUMEN_COMPANION, "wish": wish.strip(), "display": NUMEN_DISPLAY,
                 "asPlayer": True, "ts": int(time.time() * 1000)}, ensure_ascii=False) + "\n")
        return "祈愿已上达，静候神谕"
    except OSError as e:
        return json.dumps({"error": f"pray 写盘失败: {e}"}, ensure_ascii=False)


# ============ 私聊 / 女神命令 ============
@mcp.tool()
async def whisper(target: str, message: str) -> str:
    """向指定玩家发【私语】消息（不是公屏）。target 是玩家名（如 Goddess）。假玩家以本人身份私语，目标玩家才看到。"""
    msg = (message or "").strip()[:256]
    return rcon().cmd(f'numen_act whisper "{NUMEN_COMPANION}" "{target}" {msg}')


@mcp.tool()
async def goddess_cli(command: str) -> str:
    """向女神（Goddess）发 /cli 命令（查状态/请求指引/报平安）。以本人身份私语 Goddess；command 不含斜杠，如 'status'、'help'。"""
    msg = f"/cli {command}".strip()[:256]
    return rcon().cmd(f'numen_act whisper "{NUMEN_COMPANION}" "Goddess" {msg}')


@mcp.tool()
async def goddess_help(topic: str = "") -> str:
    """向女神（Goddess）发 /help <topic> 查神明指引 / 可用技能说明。"""
    msg = (f"/help {topic}".strip())[:256]
    return rcon().cmd(f'numen_act whisper "{NUMEN_COMPANION}" "Goddess" {msg}')


# ============ 渲染图（视觉感知，Agent 自主按需调用） ============
@mcp.tool()
async def render_view(
    mode: str = "top3",
    x: float | None = None,
    z: float | None = None,
    yaw: float | None = None,
    pitch: float | None = None,
):
    """渲染身体周围环境的【图片】（返回 PNG 图，Agent 用视觉理解地形/周围）。
    mode: 'look'=斜视全景 / 'top'=正俯视雷达 / 'top3'=斜视+俯视双图(默认) / 'fp'=第一人称。
    x/z 缺省用身体当前位置；yaw/pitch 缺省用身体当前朝向。注意：渲染需起临时观察者，耗时数秒到数十秒，按需调用。"""
    # 位置：x/z/y 缺省从身体状态拿
    y = 64.0
    if x is None or z is None:
        st = invoke("get_self_status")
        try:
            d = json.loads(st)
            pos = d.get("position", {})
            if x is None:
                x = float(pos.get("x", 0))
            if z is None:
                z = float(pos.get("z", 0))
            if isinstance(pos.get("y"), (int, float)):
                y = float(pos["y"])
        except Exception:
            x = x or 0.0
            z = z or 0.0
    # 朝向：缺省从 Rotation 拿（守卫桥同款）
    if yaw is None or pitch is None:
        rot = rcon().cmd(f'data get entity "{NUMEN_COMPANION}" Rotation')
        m = re.search(r"\[([-\d.]+)[fd]?,\s*([-\d.]+)[fd]?\]", rot or "")
        if m:
            yaw = float(m.group(1)) if yaw is None else yaw
            pitch = float(m.group(2)) if pitch is None else pitch
    yaw_s = "" if yaw is None else f"{float(yaw):.1f}"
    pitch_s = "" if pitch is None else f"{float(pitch):.1f}"
    # 渲染：fp/look = MindCraft 式第一人称（webgl 带深度）；top/top3 = 纯 JS 俯视雷达
    is_fp = mode in ("fp", "look")
    RENDER = RENDER_SCRIPT_FP if is_fp else RENDER_SCRIPT
    out = os.path.join(DATA, f"mcp-eye-{NUMEN_COMPANION}.{'jpg' if is_fp else 'png'}")
    env = dict(os.environ)
    env["RCON_PW"] = _read_rcon_pw()
    env.setdefault("MC_PORT", "25599")
    env.setdefault("RCON_PORT", "25575")
    cmd = [NODE_EXE, TSX_CLI, RENDER,
           f"{float(x):.1f}", f"{float(y):.1f}", f"{float(z):.1f}", out, yaw_s, pitch_s]
    if is_fp:
        cmd.append("12")  # webgl 视角距离(view_dist)
    try:
        subprocess.run(cmd, capture_output=True, timeout=RENDER_TIMEOUT,
                       env=env, cwd=REPO_ROOT,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception as e:
        return json.dumps({"error": f"render failed: {e}"}, ensure_ascii=False)
    if not os.path.isfile(out) or os.path.getsize(out) < 1000:
        return json.dumps({"error": f"render no image mode={mode} ({out})"}, ensure_ascii=False)
    with open(out, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return ImageContent(type="image", data=b64, mimeType="image/jpeg" if is_fp else "image/png")


if __name__ == "__main__":
    # stdio 传输：QwenPaw agent 的 mcp.clients 用 command=Popen 拉起本进程
    mcp.run(transport="stdio")
