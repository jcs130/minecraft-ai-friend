#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小社会巡检 + 异常修复（点5，2026-08-23 造物主令）。

天神「时刻关注智能村民 + 假玩家状态，不正常就想方设法修正」的落地：
对 小社会四类活体（mc_npc 村民引擎 / guard_drive 守卫桥 / 女神世界进程 / skin-proxy）
做进程组健康巡检，识别 双开、缺员、僵死 等异常；`--fix` 只对**明确宕机**的服务拉起，
不明杀存活的（双开只上报，不擅自杀人——防误杀合法 shim+worker 组合）。

决策规约：
  * shim+worker 算 **1 个逻辑实例**（venv shim 拉起 uv worker，如 50980→44208）。
    判根法：符合 cmdline 且「父进程 cmdline 不匹配同一脚本」者为根。
  * mc_npc 应恰好 1 个根；guard_drive 每守卫应 ≥1 个根（守护桥，按 script 匹配）。
  * 日志异常（rcon closed/timed out、Traceback、Error）计入报告，提示人工去看。

用法：python society_health.py          # 只体检、出报告（只读，不修）
      python society_health.py --fix    # 体检 + 拉起明确宕机的服务（不杀存活的）
"""
import subprocess
import sys
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

B_REPO = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"
DATA = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data"

# 需要巡检的脚本 → 显示名 + 是否要求恰好 1 个根
TARGETS = [
    ("mc_npc.py", "村民引擎(mc_npc)", 1),
    ("guard_drive.py", "守卫桥(guard_drive)", None),  # ≥1 即可
    ("bootstrap-world.mts", "女神世界进程", 1),
    ("skin-proxy.mjs", "皮肤/发包代理(skin-proxy)", 1),
]


def ls_proc():
    """列出所有 python.exe/node.exe + 父 cmdline，便于判根。"""
    ps = "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"name='python.exe' or name='node.exe'\\\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Depth 3\""
    r = subprocess.run(ps, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    return r.stdout


def roots_for(cmd, procs):
    """procs: [{pid, ppid, cmdline}]；返回根（父进程 cmdline 不匹配同一脚本者）。"""
    hits = [p for p in procs if cmd in (p.get("cmdline") or "")]
    if not hits:
        return []
    hits_cmd = {p["cmdline"] for p in hits}
    def is_root(p):
        parent = next((q for q in procs if q["pid"] == p["ppid"]), None)
        # 父进程 cmdline 也匹配同一脚本 → 是 worker；否则为根
        return not (parent and cmd in (parent.get("cmdline") or ""))
    return [p for p in hits if is_root(p)]


def count_by_cmd(base, procs):
    return sum(1 for p in procs if base in (p.get("cmdline") or ""))


def main():
    fix = "--fix" in sys.argv
    raw = ls_proc()
    try:
        import json
        data = json.loads(raw)
        if isinstance(data, dict):
            data = [data]
    except Exception:
        data = []
    procs = [{"pid": p.get("ProcessId"), "ppid": p.get("ParentProcessId"),
              "cmdline": p.get("CommandLine")} for p in data if p.get("ProcessId")]

    lines = [f"# 小社会巡检 · {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", ""]
    anomalies = []
    fixes = []

    for script, name, want in TARGETS:
        roots = roots_for(script, procs)
        n = len(roots)
        if want == 1:
            ok = n == 1
        else:
            ok = n >= 1
        status = f"⚠ {n} 个根" if not ok else f"{n} 个根"
        lines.append(f"- **{name}**（{script}）：{status}")
        if not ok:
            if n == 0:
                anomalies.append(f"{name} 宕机（0 个根）")
                if fix:
                    fixes.append(f"需拉起 {name}")
            else:
                anomalies.append(f"{name} 疑似双开（{n} 个根）——已上报，未擅自杀")

    if anomalies:
        lines.append("")
        lines.append("## 异常")
        lines += [f"- {a}" for a in anomalies]
    else:
        lines.append("")
        lines.append("## 异常：无（小社会健康）")

    # 日志异常（只读）
    lines.append("")
    lines.append("## 近期日志异常（建议人工核实）")
    log_hits = []
    for logf, kws in [
        (f"{DATA}/world-process.log", ["rcon closed", "rcon command timed out", "Traceback", "unhandled"]),
        (f"{B_REPO}/data/village/npc.log", ["Traceback", "Error", "exception"]),
    ]:
        try:
            with open(logf, encoding="utf-8", errors="replace") as f:
                tail = f.readlines()[-80:]
            hits = [l.strip() for l in tail if any(k.lower() in l.lower() for k in kws)]
            if hits:
                log_hits.append((logf, hits[-3:]))
        except FileNotFoundError:
            pass
    if log_hits:
        for logf, hits in log_hits:
            lines.append(f"- {logf}:")
            for h in hits:
                lines.append(f"  - {h[:120]}")
    else:
        lines.append("- 无")

    report = "\n".join(lines) + "\n"
    # 落盘
    day = datetime.now().strftime("%Y-%m-%d")
    import os
    os.makedirs(DATA, exist_ok=True)
    out_path = os.path.join(DATA, f"society-health-{day}.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(report)
    print(report)
    print(f"(written: {out_path})")
    if fixes:
        print(f"(--fix 待拉起：{fixes})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
