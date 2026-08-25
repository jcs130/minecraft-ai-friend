# 临时探针：走 QwenPaw /api/console/chat，逼守卫 agent 调 numen 的 say 工具，
# 打印完整 SSE（含 tool_use / tool_name / arguments），验证 MCP 工具是否真注入 agent。
import json, os, urllib.request

CONSOLE_URL = os.environ.get("QWENPAW_CONSOLE_URL", "http://127.0.0.1:8088/api/console/chat")
AGENT = os.environ.get("PROBE_AGENT", "mc-guard-naruto")
SESSION = os.environ.get("PROBE_SESSION", "probe-say-20260824")

PROMPT = (
    "【自主工具验证】这是验证指令，请你**实际调用**你手头可用的 MCP 工具 "
    "`say`（不是用文字描述，是真正调用工具），在游戏公屏说一句话：'鸣人验证工具成功'。"
    "调用 say 工具后，用一句话告诉我调用结果。如果你手里根本没有 say 工具，就明确回复"
    "'我没有say工具'。除了 say，不要做任何多余动作。"
)

payload = {
    "channel": "console",
    "user_id": f"guard:{SESSION}",
    "session_id": SESSION,
    "input": [{"role": "user", "content": [{"type": "text", "text": PROMPT}]}],
}
req = urllib.request.Request(
    CONSOLE_URL,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json", "X-Agent-Id": AGENT},
    method="POST",
)
print("POST", CONSOLE_URL, "agent=", AGENT)
print("=" * 60)
with urllib.request.urlopen(req, timeout=240) as r:
    for raw in r:
        line = raw.decode("utf-8", "replace").strip()
        if not line.startswith("data:"):
            print("RAW:", line[:300])
            continue
        body = line[5:].strip()
        # 只挑关键字段打印，别把大段刷屏
        try:
            d = json.loads(body)
        except Exception:
            print("NONJSON:", body[:300])
            continue
        obj = d.get("object")
        typ = d.get("type")
        # tool_use 是我们要找的信号
        if obj == "tool_use" or "tool" in str(obj).lower() or typ == "tool_use":
            print(f"[{obj}/{typ}] tool_use ->", json.dumps(d, ensure_ascii=False)[:400])
            continue
        if typ == "tool_call":
            print(f"[{obj}/{typ}] TOOL_CALL ->", json.dumps(d, ensure_ascii=False)[:400])
            continue
        if obj == "content":
            dd = d.get("data") or {}
            name = dd.get("tool_use_id") or d.get("tool_use_id") or d.get("tool_name")
            if name:
                print(f"[content tool] ->", json.dumps(d, ensure_ascii=False)[:400])
                continue
            t = dd.get("text") or d.get("text") or ""
            if t:
                print(f"[text] {t[:200]}")
            continue
        if obj == "message":
            print(f"[message id={d.get('id')}]")
            continue
        # 其它未知，打印精简
        print(f"[{obj}/{typ}]", json.dumps(d, ensure_ascii=False)[:200])
print("=" * 60)
print("done")
