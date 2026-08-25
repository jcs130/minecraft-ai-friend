# -*- coding: utf-8 -*-
"""mcp_god.py —— 神使通道工具箱 MCP server（stdio）

给灯语女神(mc-herald)/灶火祭司(mc-priest) 等瓶中运营 agent 用：
- god_status / god_exec / god_send / god_history —— 神使通道（零鉴权文件 IPC → MC 服务端执行）
- chronicle_tail —— 世界编年史尾部
- data_read / data_list —— 只读访问共享数据卷（quests/magic-state/guard 台账等）

设计对齐 mcp_numen.py：FastMCP stdio，由 agent 的 mcp.clients Popen 拉起。
神使通道零鉴权（进程内文件 IPC），故本工具箱不需要任何密码——瓶中零密钥原则不破。
"""
import json
import os
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from god_channel import GodChannel  # noqa: E402
from mcp.server.fastmcp import FastMCP  # noqa: E402

mcp = FastMCP("god")
GC_DIR = os.environ.get("GOD_CHANNEL_DIR", "/data/god-channel")
DATA_DIR = os.environ.get("DATA_DIR", "/data")
god = GodChannel(GC_DIR)


@mcp.tool()
def god_status() -> str:
    """读世界信标：时间/白天黑夜/天气/在线玩家(名字+HP)/出生点。每约5秒由服务端覆写，超过60秒的旧信标会报错。"""
    try:
        return json.dumps(god.status(max_age_s=60.0), ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


@mcp.tool()
def god_exec(command: str) -> str:
    """以管理员身份执行一条 MC 控制台命令（fill/tp/give/time/weather/say/title/setblock…），返回服务端回执。填坑=fill，救人=tp，给东西=give，全服喊话=say。"""
    try:
        r = god.send("exec", command=command, wait=True, timeout=20.0)
        return json.dumps(r, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


@mcp.tool()
def god_send(cmd: str, params_json: str = "{}") -> str:
    """发任意神使通道动词（list/summon/invoke/exec…），params_json 为 JSON 对象字符串。"""
    try:
        p = json.loads(params_json or "{}")
        r = god.send(cmd, wait=True, timeout=20.0, **p)
        return json.dumps(r, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


@mcp.tool()
def god_history(last: int = 20) -> str:
    """最近 N 条神使通道审计流水（谁发了什么命令、结果如何）。"""
    try:
        return json.dumps(god.history(last=last), ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


def _chronicle_tail(n: int) -> str:
    p = pathlib.Path(DATA_DIR) / "chronicle.jsonl"
    if p.is_file():
        lines = [l for l in p.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
        if lines:
            return "\n".join(lines[-n:])
    m = pathlib.Path(DATA_DIR) / "world-chronicle.md"
    if m.is_file():
        lines = [l for l in m.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
        if lines:
            return "\n".join(lines[-n * 3:])  # md 版稀疏，多取几行
    return "(no chronicle yet)"


@mcp.tool()
def chronicle_tail(n: int = 15) -> str:
    """世界编年史尾部：最近的祈愿/供奉/神迹/死亡/升级/任务事件。"""
    return _chronicle_tail(n)


@mcp.tool()
def data_list() -> str:
    """列出共享数据卷 DATA_DIR 下的文件名（quests/magic-state/guard 台账/编年史等）。"""
    try:
        names = sorted(f.name for f in pathlib.Path(DATA_DIR).iterdir() if f.is_file())
        return json.dumps(names, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


@mcp.tool()
def data_read(filename: str, tail_chars: int = 2000) -> str:
    """只读打开 DATA_DIR 下指定文件（如 magic-state.json、world-chronicle.md），防路径穿越，默认截尾 2000 字符。"""
    try:
        base = pathlib.Path(DATA_DIR).resolve()
        f = (base / filename).resolve()
        if not str(f).startswith(str(base)):
            return json.dumps({"error": "path escape denied"}, ensure_ascii=False)
        if not f.is_file():
            return json.dumps({"error": "not found"}, ensure_ascii=False)
        t = f.read_text(encoding="utf-8", errors="replace")
        if len(t) > tail_chars:
            # 2026-08-26 天神补：截断必须显式告知，否则大文件（如村民册 20K）会被误当全文
            banner = ("[截断提示] 文件共 %d 字符，此处只给尾部 %d 字符（开头被截去）。"
                      "需要全文/更多请加大 tail_chars（如 tail_chars=50000）。\n---\n" % (len(t), tail_chars))
            return banner + t[-tail_chars:]
        return t
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


# ── NPC 运营权柄（灶火祭司主用）：MCDATA_DIR 只读全域，写仅限 village/ ──
MCDATA_DIR = os.environ.get("MCDATA_DIR", "/mcdata")


def _mc_path(rel: str) -> pathlib.Path:
    base = pathlib.Path(MCDATA_DIR).resolve()
    f = (base / rel).resolve()
    if not str(f).startswith(str(base)):
        raise PermissionError("path escape denied")
    return f


@mcp.tool()
def npc_read(relpath: str, tail_chars: int = 3000) -> str:
    """只读打开 NPC 数据卷（/mcdata）里的文件。常用：village/villagers.json（村民人设册）、village/quests-YYYY-MM-DD.json（当日任务板）、village/quest-ledger.jsonl（委托流水）、episodic-<名>.jsonl（玩家近事）、world-chronicle.md（编年史）。"""
    try:
        f = _mc_path(relpath)
        if not f.is_file():
            return json.dumps({"error": f"not found: {relpath}"}, ensure_ascii=False)
        t = f.read_text(encoding="utf-8", errors="replace")
        if len(t) > tail_chars:
            # 2026-08-26 天神补：截断必须显式告知，否则大文件（如村民册 20K）会被误当全文
            banner = ("[截断提示] 文件共 %d 字符，此处只给尾部 %d 字符（开头被截去）。"
                      "需要全文/更多请加大 tail_chars（如 tail_chars=50000）。\n---\n" % (len(t), tail_chars))
            return banner + t[-tail_chars:]
        return t
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


@mcp.tool()
def npc_write(relpath: str, content: str) -> str:
    """写入 NPC 数据卷（/mcdata）——仅限 village/ 目录（任务板 quests-YYYY-MM-DD.json、村民册 villagers.json、剧情笔记 plot-*.md）。.json 会先校验合法性再原子落盘（npc 进程不会读到半个文件）。改 villagers.json 前先 npc_read 备份一份到 village/backup-*.json。"""
    try:
        f = _mc_path(relpath)
        rel = f.relative_to(pathlib.Path(MCDATA_DIR).resolve()).as_posix()
        if not (rel.startswith("village/") and f.suffix in (".json", ".jsonl", ".md", ".txt")):
            return json.dumps({"error": "write allowlist: village/**.{json,jsonl,md,txt} only"}, ensure_ascii=False)
        f.parent.mkdir(parents=True, exist_ok=True)
        if f.suffix == ".json":
            json.loads(content)  # 合法性校验，坏 JSON 直接抛错不落盘
        tmp = f.with_suffix(f.suffix + ".tmp")
        tmp.write_text(content, encoding="utf-8", newline="\n")
        tmp.replace(f)
        return json.dumps({"ok": True, "file": rel, "bytes": len(content.encode('utf-8'))}, ensure_ascii=False)
    except json.JSONDecodeError as e:
        return json.dumps({"error": f"invalid JSON: {e}"}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


if __name__ == "__main__":
    mcp.run(transport="stdio")
