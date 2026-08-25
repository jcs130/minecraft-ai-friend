# -*- coding: utf-8 -*-
"""inject_mcp.py —— 给亲卫 agent.json 注入 mcp.clients.numen（stdio，qwenpaw venv python）。"""
import json

BOT = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"
PY = r"C:\Users\lzl19\.qwenpaw\venv\Scripts\python.exe"
SCRIPT = BOT + r"\sidecar\guard\mcp_numen.py"

AGENTS = [
    (r"C:\Users\lzl19\.copaw\workspaces\mc-guard-naruto\agent.json", "Naruto", "鸣人"),
    (r"C:\Users\lzl19\.copaw\workspaces\mc-guard-kirito\agent.json", "Kirito", "桐人"),
]

for path, login, disp in AGENTS:
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["mcp"] = {
        "clients": {
            "numen": {
                "name": "numen",
                "description": "numen 假玩家身体工具（感知/动作/说话/私聊/女神命令/渲染图），亲卫自主调用来驱动身体",
                "enabled": True,
                "transport": "stdio",
                "url": "",
                "command": PY,
                "args": [SCRIPT],
                "env": {"NUMEN_COMPANION": login, "NUMEN_DISPLAY": disp},
                "cwd": BOT,
                "tools": None,
                "oauth": None,
            }
        }
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print(f"[OK] wrote mcp to {path} (login={login}, display={disp})")

# 验证 JSON 可重新解析
for path, *_ in AGENTS:
    with open(path, encoding="utf-8") as f:
        c = json.load(f)
    print(f"[verify] {path}: mcp.clients={list(c['mcp']['clients'].keys())} id={c.get('id')}")
