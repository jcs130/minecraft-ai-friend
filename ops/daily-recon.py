#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""创世天神每日外勤侦察（点3，2026-08-23 造物主令）。

每天 08:00 由 Windows 计划任务触发：向 QwenPaw console 通道（X-Agent-Id: mc-god）
投递「每日外勤」prompt，唤醒创世天神做外勤——搜 Git 热门 agent 项目 + 我的世界模组/玩法，
并把生成的报告落盘为 data/goddess-recon-<date>.md（B 仓）与 docs/world-recon/<date>.md（天神工作间），
供天神本尊主导世界建设时读回。

依赖：仅标准库（urllib/json）。跑在干净解释器上（避免 uv 劫持 PYTHONHOME）。
"""
import sys
import json
import glob
from datetime import datetime
from os.path import join

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── 可调配置 ────────────────────────────────────────────────────────────────
CONSOLE_URL = "http://127.0.0.1:8088/api/console/chat"
AGENT_ID = "mc-god"
SESSION_ID = "mc:goddess:recon"
USER_ID = "goddess"
TIMEOUT_S = 180

# 侦测工作间根（B 仓与天神工作间），用绝对盘符。
B_REPO = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"
GOD_WORKSPACE = r"C:\Users\lzl19\.copaw\workspaces\mc-god"

RECON_PROMPT = (
    "每日外勤侦察（创世天神职责，点3）：请用 web_search/web_fetch 做两路搜索，"
    "然后用大白话出一份简短的《世界外勤侦察日报》：\n"
    "1) Git/网络热门 agent 项目（今日 trending + 关键词 agent、mineflayer、QwenPaw 生态）；\n"
    "2) 我的世界相关模组/玩法（NeoForge 1.21.1/21.1.248 兼容面；光源/视觉/旅途探索/聚落发展）；\n"
    "每条给：项目名/仓库/一句话亮点 / 对本世界（千灯纪·女神守护·灯火小社会）的启发 / 是否建议引入；"
    "最后给 1-2 条「最值得落地」的结论。控制在 400 字内，观点明确。"
)


def post_console() -> str:
    """POST 到 QwenPaw console 通道，返回 agent 最终回复文本（SSE 解析）。"""
    import urllib.request

    payload = {
        "channel": "console",
        "user_id": USER_ID,
        "session_id": SESSION_ID,
        "input": [{"role": "user", "content": [{"type": "text", "text": RECON_PROMPT}]}],
    }
    req = urllib.request.Request(
        CONSOLE_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Agent-Id": AGENT_ID},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    # SSE 解析：记录最终 message id，收集其 content 文本；delta 优先，full 兜底。
    msg_id = None
    pending = {}
    for line in raw.split("\n"):
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
        return pending[msg_id]["delta"] or pending[msg_id]["full"]
    # 兜底：把所有 content 拼接
    return "\n".join((p["delta"] or p["full"]) for p in pending.values() if p["delta"] or p["full"])


def main() -> int:
    try:
        report = post_console().strip()
    except Exception as e:
        report = f"(外勤触发失败：{e})"
    if not report:
        report = "(外勤通道未返回内容)"

    day = datetime.now().strftime("%Y-%m-%d")
    header = f"# 世界外勤侦察日报 · {day}\n\n{report}\n"

    # 落 B 仓 data（世界侧留存）
    import os
    os.makedirs(join(B_REPO, "data"), exist_ok=True)
    with open(join(B_REPO, "data", f"goddess-recon-{day}.md"), "w", encoding="utf-8") as f:
        f.write(header)
    # 落天神工作间 docs/world-recon（本尊读回用）
    os.makedirs(join(GOD_WORKSPACE, "docs", "world-recon"), exist_ok=True)
    with open(join(GOD_WORKSPACE, "docs", "world-recon", f"{day}.md"), "w", encoding="utf-8") as f:
        f.write(header)

    print(f"ok: {len(report)} chars -> data/goddess-recon-{day}.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
