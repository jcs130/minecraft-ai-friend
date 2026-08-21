# -*- coding: utf-8 -*-
"""把 7 个官方角色从「假玩家」降级为「可选 NPC」。

造物主定调：LLM 高频调用扛不住 9 个假玩家，核心假玩家只留 Steve + Alex 2 个；
其余 7 官方角色（Noor/Sunny/Ari/Zuri/Makena/Kai/Efe）降级为「可选 NPC/皮肤」——
人设保留在 optional-npcs/ 目录供用户手动启用，不进 agents.json / transmigrators.json，
不触发假玩家 LLM 循环。

幂等：重复运行结果一致。
"""
import json
import shutil
from pathlib import Path

DST = Path(__file__).resolve().parent.parent / "packaging" / "mc-world" / "assets" / "data"
TRANS = DST / "transmigrators.json"
AGENTS = DST / "agents.json"
OPT_DIR = DST / "optional-npcs"

CORE = {"steve", "alex"}          # 核心假玩家（LLM 驱动）
OPTIONAL = {"noor", "sunny", "ari", "zuri", "makena", "kai", "efe"}  # 可选 NPC


def main():
    OPT_DIR.mkdir(exist_ok=True)

    # 1. transmigrators.json 只留 core
    t = json.loads(TRANS.read_text(encoding="utf-8"))
    before = len(t["transmigrators"])
    t["transmigrators"] = [x for x in t["transmigrators"] if x["id"] in CORE]
    TRANS.write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[transmigrators] {before} -> {len(t['transmigrators'])}（核心假玩家: {[x['id'] for x in t['transmigrators']]}）")

    # 2. agents.json 只留 core
    a = json.loads(AGENTS.read_text(encoding="utf-8"))
    for k in list(a.keys()):
        if k not in CORE:
            a.pop(k, None)
    AGENTS.write_text(json.dumps(a, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[agents] 当前假玩家: {list(a.keys())}")

    # 3. 7 角色的 md 移到 optional-npcs/
    moved = []
    for cid in OPTIONAL:
        for suffix in ("backstory", "persona"):
            src = DST / "transmigrators" / f"{cid}.{suffix}.md"
            dst = OPT_DIR / f"{cid}.{suffix}.md"
            if src.exists():
                shutil.move(str(src), str(dst))
                moved.append(f"{cid}.{suffix}")
    print(f"[md] 移到 optional-npcs/: {moved}")

    # 4. transmigrators/ 里不应再有可选角色的 md
    leftover = [p.name for p in (DST / "transmigrators").glob("*.md")
                if p.stem.split(".")[0] in OPTIONAL]
    print(f"[校验] transmigrators/ 残留可选角色 md: {leftover or '无'}")


if __name__ == "__main__":
    main()
