# -*- coding: utf-8 -*-
"""重启后验证：主机/java/world 状态 + 9001 oracle + 主服日志中 settlements 相关。"""
import subprocess, os, time

def ps(script):
    return subprocess.run(["powershell", "-NoProfile", "-Command", script],
                          capture_output=True, text=True).stdout.strip()

def pids(pat, pname="java.exe"):
    script = ("Get-CimInstance Win32_Process -Filter \"Name='%s'\" | "
              "Where-Object { $_.CommandLine -match '%s' } | "
              "Select-Object -ExpandProperty ProcessId" % (pname, pat))
    return [p for p in ps(script).split() if p.strip()]

print("=== POST CHECK ===")
print("java neoforge:", pids("neoforge") or "NONE")
print("node world:", pids("bootstrap-world", "node.exe") or "NONE")

# 9001 oracle
import socket
s = socket.socket(); s.settimeout(1)
try:
    s.connect(("127.0.0.1", 9001)); print("Oracle 9001: OPEN"); s.close()
except Exception as e:
    print("Oracle 9001:", e)

# 主服日志 tail，找 settlements 相关
LOG = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\mc-server-neoforge\logs\latest.log"
if os.path.exists(LOG):
    with open(LOG, "rb") as f:
        f.seek(0, os.SEEK_END); size = f.tell(); f.seek(max(0, size-120000))
        tail = f.read().decode("utf-8", errors="replace")
    print("\n=== settlements/inference in log tail (last 120KB) ===")
    import re
    for line in tail.splitlines():
        if re.search(r"(?i)settlements|inference|oracle|monologue|REHEARSED|persona", line):
            print("  ", line[:200])
