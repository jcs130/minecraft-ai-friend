# -*- coding: utf-8 -*-
"""重启前 precheck：主服java / world/npc/guard 进程 + 9001 oracle + RCON端口。"""
import subprocess

def ps(script):
    return subprocess.run(["powershell", "-NoProfile", "-Command", script],
                          capture_output=True, text=True).stdout.strip()

def pids(pat):
    # 用单引号包 CommandLine 匹配，避开复杂转义
    script = ("Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | "
              "Where-Object { $_.CommandLine -match '%s' } | "
              "Select-Object -ExpandProperty ProcessId" % pat)
    return [p for p in ps(script).split() if p.strip()]

def pids_n(pat):
    script = ("Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | "
              "Where-Object { $_.CommandLine -match '%s' } | "
              "Select-Object -ExpandProperty ProcessId" % pat)
    return [p for p in ps(script).split() if p.strip()]

print("=== PRECHECK ===")
print("java neoforge pids:", pids("neoforge") or "NONE")
print("node bootstrap-world pids:", pids_n("bootstrap-world") or "NONE")

# RCON 25575
import socket
s = socket.socket(); s.settimeout(1)
try:
    s.connect(("127.0.0.1", 25575))
    print("RCON 25575: OPEN")
    s.close()
except Exception as e:
    print("RCON 25575:", e)

# 9001 oracle
s2 = socket.socket(); s2.settimeout(1)
try:
    s2.connect(("127.0.0.1", 9001))
    print("Oracle 9001: OPEN")
    s2.close()
except Exception as e:
    print("Oracle 9001:", e)
