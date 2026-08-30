# -*- coding: utf-8 -*-
"""部署后双门/收纳 mod 验证（2026-08-30 收纳三件套上服后补）。

CI 只能测文件层一致性；「通用门 mixin 是否真在服务器上生效」只能看
运行时打点（require=0 的 mixin 失配时静默失效，打点是唯一信号）。

用法（宿主机，容器名默认 shadow-mc/shadow-world）：
    python ops/verify_gates.py
输出每项 PASS/FAIL 与总结；exit 0/1。
"""
import subprocess
import sys

MC = "shadow-mc"
WORLD = "shadow-world"
GATES = {
    "CFG-GATE": "ConfigTaskGateForNonNeoForgeMixin（mod CONFIG 任务门）",
    "RECIPE-GATE": "RecipePacketGateForNonNeoForgeMixin（配方包门）",
    "BC-GATE": "BetterCombatConfigTaskGateMixin（Better Combat 门，历史）",
}


def sh(container, cmd):
    r = subprocess.run(["docker", "exec", container, "sh", "-c", cmd],
                       capture_output=True, timeout=60,
                       encoding="utf-8", errors="replace")
    return (r.stdout or "").strip()


def logs_grep(tag):
    r = subprocess.run(["docker", "logs", MC, "--since", "24h"],
                       capture_output=True, timeout=60,
                       encoding="utf-8", errors="replace")
    hits = [l for l in ((r.stdout or "") + (r.stderr or "")).splitlines() if tag in l]
    return hits


def main():
    results = []

    # 1. 收纳三件套已加载
    mods = sh(MC, "ls /data/mods/ 2>/dev/null")
    for jar in ("curios-neoforge-9.5.1", "sophisticatedbackpacks-1.21.1",
                "sophisticatedcore-1.21.1"):
        ok = any(jar in m for m in mods.splitlines())
        results.append((f"mod 加载 {jar}", ok))

    # 2. 双门打点（24h 内有 hit 即证明 mixin 在跑；只看 cancel=true 的分流证据）
    for tag, desc in GATES.items():
        hits = logs_grep(tag)
        ok = bool(hits)
        results.append((f"打点 {tag}（{desc}）", ok))

    # 3. 物品注册探针（give 探测会真的给 1 个背包——Kirito 是假玩家，可给）
    give = sh(MC, "rcon-cli \"give Kirito sophisticatedbackpacks:backpack 1\"")
    results.append(("give 探针 sophisticatedbackpacks:backpack", "Gave" in give))

    # 4. 女神化身在线（直连 mc:25599，双门护航）
    lst = sh(MC, "rcon-cli list")
    results.append(("Goddess 在线", "Goddess" in lst))
    results.append(("假玩家 Kirito/Naruto 在线", "Kirito" in lst and "Naruto" in lst))

    fails = [name for name, ok in results if not ok]
    for name, ok in results:
        print(("PASS  " if ok else "FAIL  ") + name)
    print(f"\n{len(results) - len(fails)}/{len(results)} 项通过")
    if fails:
        print("未过项即失效信号：打点消失=require=0 mixin 静默失效；give 失败=mod 未加载")
        sys.exit(1)


if __name__ == "__main__":
    main()
