# -*- coding: utf-8 -*-
# 修复重启：web-panel 带 MC_DATA_DIR（start-panel.bat 同款环境）
import subprocess, os, time

WS = r"C:\Users\lzl19\.copaw\workspaces\default"
REPO = os.path.join(WS, "minecraft-ai-friend")
SCRATCH = os.path.join(WS, "deepseek-harness", "scratch-plugin")
DATA = os.path.join(SCRATCH, "data")
NODE = r"C:\Program Files\nodejs\node.exe"

def ps(cmd_script):
    return subprocess.run(["powershell", "-NoProfile", "-Command", cmd_script],
                          capture_output=True, text=True).stdout.strip()

cmd = ("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*web-panel.mjs*' } "
       "| Select-Object -ExpandProperty ProcessId")
pids = [p for p in ps(cmd).split() if p.strip()]
for pid in pids:
    subprocess.run(["powershell", "-NoProfile", "-Command", f"Stop-Process -Id {pid} -Force"], capture_output=True)
    print(f"stopped pid {pid}")

env = os.environ.copy()
env.pop("PYTHONHOME", None)
env.pop("PYTHONPATH", None)
env["MC_DATA_DIR"] = DATA
env["MC_SERVER_DIR"] = os.path.join(SCRATCH, "mc-server-neoforge")
DETACHED = 0x00000008 | 0x00000200 | 0x08000000
panel_log = os.path.join(DATA, "panel-process.log")
p = subprocess.Popen([NODE, "web-panel.mjs"], cwd=REPO,
                     stdout=open(panel_log, "ab"), stderr=open(panel_log + ".err.log", "ab"),
                     creationflags=DETACHED, close_fds=True, env=env)
print(f"started web-panel.mjs pid={p.pid} (MC_DATA_DIR={DATA})")

time.sleep(5)
import urllib.request
try:
    r = urllib.request.urlopen("http://127.0.0.1:9090/api/tts/voices", timeout=5)
    print("voices:", r.status)
    r2 = urllib.request.urlopen("http://127.0.0.1:9090/api/pos?name=Goddess", timeout=5)
    print("pos Goddess:", r2.read().decode()[:120])
except Exception as e:
    print("verify err:", e)
