# -*- coding: utf-8 -*-
# restart_world.py — 拉起世界进程（Goddess 唯一 RCON 持有者），分离于 shell，日志续写 data/world-process.log
# 前置：穿越者 bot 须先在线（死亡守望按在线快照武装 + 仪式编排铁律）。
import subprocess, os, sys, time

sys.stdout.reconfigure(encoding='utf-8')

cwd = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin"
node = r"C:\Program Files\nodejs\node.exe"
tsx_dir = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\node_modules\.pnpm\tsx@4.22.4\node_modules\tsx\dist"
preflight = os.path.join(tsx_dir, "preflight.cjs")
loader = os.path.join(tsx_dir, "loader.mjs")
log = os.path.join(cwd, "data", "world-process.log")
err = os.path.join(cwd, "data", "world-process.err.log")

# 0. 幂等：已有 bootstrap-world 进程就不重复起
out = subprocess.run(["powershell", "-NoProfile", "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | "
    "Where-Object { $_.CommandLine -like '*bootstrap-world*' } | "
    "Select-Object -ExpandProperty ProcessId"],
    capture_output=True, text=True).stdout.strip()
if out:
    print(f"world process already running (pid {out}), skip")
    sys.exit(0)

env = os.environ.copy()
env["MC_GOD_NAME"] = "Goddess"
env["MC_VIEWER"] = "1"          # 女神天眼：世界进程自带 viewer(3050)，9090 面板无穿越者时兜底
env["MC_VIEWER_PORT"] = "3050"
cmd = [node, "--require", preflight, "--import", f"file:///{loader}", "bootstrap-world.mts"]
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000

with open(log, "ab") as f:
    f.write(f"\n===== world restart (script) {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n".encode("utf-8"))
    p = subprocess.Popen(
        cmd, cwd=cwd, stdout=f, stderr=open(err, "ab"),
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW,
        close_fds=True, env=env,
    )
print(f"started pid={p.pid}")

# 等 Goddess 入服（服务器日志出现 joined / world 日志出现 spectator）
for i in range(30):
    time.sleep(2)
    tail = open(log, "rb").read()[-4000:].decode("utf-8", errors="replace")
    if "is now a spectator" in tail:
        print(f"goddess is spectator after ~{(i + 1) * 2}s")
        sys.exit(0)
print("WARN: spectator confirmation not seen in 60s — check data/world-process.log")
sys.exit(1)
