# -*- coding: utf-8 -*-
"""拉起守卫桥（分离、隐藏窗口、日志落盘），幂等。"""
import subprocess, os, time, sys
sys.stdout.reconfigure(encoding="utf-8")
REPO = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"
PY = r"C:\Users\lzl19\AppData\Local\Programs\Python\Python311\python.exe"
SCRIPT = os.path.join(REPO, "sidecar", "guard", "guard_drive.py")
CWD = os.path.join(REPO, "sidecar", "guard")
OUT = os.path.join(REPO, "data", "guard-drive-restart.log")

env = os.environ.copy()
env.pop("PYTHONHOME", None)
env.pop("PYTHONPATH", None)
# RCON 密码：运行态正本 mc-data/rcon-secret.txt（世界进程同一份）
sec = os.path.join(REPO, "mc-data", "rcon-secret.txt")
if os.path.exists(sec) and not env.get("RCON_PASSWORD"):
    env["RCON_PASSWORD"] = open(sec, encoding="utf-8").read().strip()
print("RCON password injected:", bool(env.get("RCON_PASSWORD")))

DETACHED = 0x00000008 | 0x00000200 | 0x08000000
with open(OUT, "ab") as f:
    f.write(("\n===== guard bridge boot %s =====\n" % time.strftime("%Y-%m-%d %H:%M:%S")).encode("utf-8"))
    p = subprocess.Popen([PY, SCRIPT], cwd=CWD, env=env, stdout=f, stderr=subprocess.STDOUT,
                         creationflags=DETACHED, close_fds=True)
print("launcher pid:", p.pid)
time.sleep(10)
r = subprocess.run(["powershell", "-NoProfile", "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
    "Where-Object { $_.CommandLine -like '*guard_drive.py*' } | "
    "Select-Object -ExpandProperty ProcessId"], capture_output=True, text=True)
print("alive pids:", r.stdout.strip() or "NONE")
with open(OUT, "rb") as f:
    f.seek(max(0, os.path.getsize(OUT) - 1200))
    print("--- log tail ---")
    print(f.read().decode("utf-8", errors="replace"))
