# -*- coding: utf-8 -*-
"""ops_drive.py —— 运营双 agent 的自主驱动桥（对齐 guard_drive 模式）

灯语女神(mc-herald)：每 HERALD_EVERY_SEC 一轮巡检 —— 摘要（世界状态 + 编年史新事件）
推给 agent；agent 自主用 god_* 工具发现问题、修复、播报。
灶火祭司(mc-priest)：每 PRIEST_EVERY_SEC 一轮 —— 推世界状态给 agent 做世界观播报/进程书写。

架构：与守卫桥同款「桥驱动 + 瓶中 QwenPaw agent」；本进程不需要任何密钥
（神使通道零鉴权文件 IPC，console/chat 走容器网 HTTP）。
"""
import datetime
import json
import os
import pathlib
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

CONSOLE = os.environ.get("QWENPAW_CONSOLE_URL", "http://qwenpaw:8088/api/console/chat")
GC_DIR = os.environ.get("GOD_CHANNEL_DIR", "/god-channel")
DATA_DIR = os.environ.get("DATA_DIR", "/data")
HERALD_EVERY = int(os.environ.get("HERALD_EVERY_SEC", "600"))
PRIEST_EVERY = int(os.environ.get("PRIEST_EVERY_SEC", "3600"))
SIDENG_EVERY = int(os.environ.get("SIDENG_EVERY_SEC", "7200"))


def log(msg: str):
    print(f"[opsdrive] {msg}", flush=True)


def read_status() -> dict:
    try:
        d = json.loads((pathlib.Path(GC_DIR) / "world-status.json").read_text(encoding="utf-8"))
        st = dict(d.get("status", d))
        ts = d.get("ts")
        if isinstance(ts, (int, float)):
            st["_age_s"] = int(time.time() - ts)
        return st
    except Exception as e:
        return {"error": f"status unavailable: {e}"}


def chronicle_new(since_line: int):
    """按行游标增量读编年史，返回 (新行列表(截尾20), 新游标)。"""
    p = pathlib.Path(DATA_DIR) / "chronicle.jsonl"
    if not p.is_file():
        return [], since_line
    try:
        lines = [l for l in p.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
    except Exception:
        return [], since_line
    return lines[since_line:][-20:], len(lines)


def call(agent_id: str, user_id: str, session_id: str, text: str) -> str:
    """AgentRequest 格式（对齐 mc-god.ts callAgent）+ SSE 解析出正式回答。"""
    payload = json.dumps({
        "channel": "console",
        "user_id": user_id,
        "session_id": session_id,
        "input": [{"role": "user", "content": [{"type": "text", "text": text}]}],
    }).encode()
    req = urllib.request.Request(
        CONSOLE, data=payload,
        headers={"Content-Type": "application/json", "X-Agent-Id": agent_id})
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            raw = r.read().decode("utf-8", errors="replace")
        # SSE 解析：最后一条 message:message 的 content
        message_id = None
        pending: dict = {}
        for line in raw.splitlines():
            if not line.startswith("data:"):
                continue
            body = line[5:].strip()
            if not body:
                continue
            try:
                evt = json.loads(body)
            except Exception:
                continue
            if evt.get("object") == "message" and evt.get("type") == "message":
                message_id = evt.get("id")
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
        answer = ""
        if message_id and message_id in pending:
            slot = pending[message_id]
            answer = slot["delta"] or slot["full"]
        return f"HTTP 200 replied({len(answer)}): {answer[:160]}"
    except Exception as e:
        return f"FAIL {type(e).__name__} {e}"


def herald_digest(new_events: list) -> str:
    st = read_status()
    now = datetime.datetime.now().strftime("%H:%M")
    extra = ("\n[编年史新事件]\n" + "\n".join(new_events)) if new_events else ""
    return (
        f"[巡检时刻 {now}] 世界状态：{json.dumps(st, ensure_ascii=False)}\n"
        f"{extra}\n"
        "你是灯语女神——主动发现问题并处理：\n"
        "1) 有人死在同一坐标附近反复死 → 多半是坑洞/陷阱，用 god_exec 的 fill 指令填平（先小范围 3x3，泥土或圆石），再放火把；\n"
        "2) 有人深夜血量低又没吃饭 → say 一句提醒，或 give 面包（轻帮助，别惯坏）；\n"
        "3) 长雨/夜晚卡住 → time/weather 调整；\n"
        "4) 修完把「发现什么-做了什么」追加写进 herald-log.md（append_file）；没异常就一句收工，别硬找事。"
    )


def priest_digest() -> str:
    st = read_status()
    now = datetime.datetime.now().strftime("%H:%M")
    return (
        f"[策划时刻 {now}] 世界状态：{json.dumps(st, ensure_ascii=False)}\n"
        "你是灶火祭司：先用 chronicle_tail 看看最近的世界进程，然后做一件有内容的事——\n"
        "要么用 god_exec say 以村庄灶火的口吻播一句世界观短讯（大白话，一两句，像村口老人顺嘴说的），\n"
        "要么把当日世界观笔记写进 priest-journal 目录（按日期 md）；有新点子记进 priest-ideas.md。一轮一件就好，别贪多。"
    )


def sideng_digest(new_events: list) -> str:
    st = read_status()
    now = datetime.datetime.now().strftime("%H:%M")
    extra = ("\n[编年史新事件]\n" + "\n".join(new_events[-10:])) if new_events else ""
    return (
        f"[巡场时刻 {now}] 世界状态：{json.dumps(st, ensure_ascii=False)}\n"
        f"{extra}\n"
        "你是司灯——本项目（我的异世界·千灯纪）的总负责人，天神（mc-god）的下属。"
        "花一分钟巡场：对照你记忆里的待办与团队近况，做一件总负责人该做的事——"
        "更新你的项目管理台账（todo/风险/决议）、写下给某位成员的协调意见、或给天神留一条简报。"
        "没有要事就一句话收工，别硬找事。产出写进你自己工作区的文件。"
    )


def main():
    log(f"start: herald every {HERALD_EVERY}s, priest every {PRIEST_EVERY}s, console={CONSOLE}")
    last_h = time.time() - HERALD_EVERY   # 启动即首轮巡检
    last_p = time.time() - PRIEST_EVERY + 180  # 灯语先行，灶火 3 分钟后首轮
    last_s = time.time() - SIDENG_EVERY + 300  # 司灯 5 分钟后首轮巡场
    cursor = 0
    while True:
        try:
            now = time.time()
            new, cursor = chronicle_new(cursor)
            if new:
                log(f"chronicle +{len(new)} lines")
            if now - last_h >= HERALD_EVERY:
                d = datetime.datetime.now().strftime("%Y%m%d")
                r = call("mc-herald", "ops:herald", f"herald-ops-{d}", herald_digest(new))
                log(f"herald round: {r}")
                last_h = now
            if now - last_p >= PRIEST_EVERY:
                d = datetime.datetime.now().strftime("%Y%m%d")
                r = call("mc-priest", "ops:priest", f"priest-ops-{d}", priest_digest())
                log(f"priest round: {r}")
                last_p = now
            if now - last_s >= SIDENG_EVERY:
                d = datetime.datetime.now().strftime("%Y%m%d")
                r = call("default", "ops:sideng", f"sideng-ops-{d}", sideng_digest(new))
                log(f"sideng round: {r}")
                last_s = now
            time.sleep(10)
        except KeyboardInterrupt:
            break
        except Exception as e:
            log(f"loop error: {e}")
            time.sleep(30)


if __name__ == "__main__":
    main()
