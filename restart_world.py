# -*- coding: utf-8 -*-
# restart_world.py — 拉起世界进程（Goddess 唯一 RCON 持有者），分离于 shell。
# 2026-08-20 D 步迁正仓：cwd=正仓启动 bootstrap-world.mts；运行态（world.db/编年史/法力/
# rcon-secret/world-process.log）经 MC_DATA_DIR 指向部署现场 scratch-plugin\data（正本）；
# 服务器日志与进度经 MC_LOG_PATH / MC_ADVANCEMENTS_DIR 指向 scratch-plugin\mc-server-neoforge。
# 前置：穿越者 bot 须先在线（死亡守望按在线名单动态武装 + 仪式编排铁律）。
import subprocess, os, sys, time

sys.stdout.reconfigure(encoding='utf-8')

DIR = os.path.dirname(os.path.abspath(__file__))  # 正仓（脚本所在目录即运行目录）
WS = os.path.dirname(DIR)                         # 工作区根
SCRATCH = os.path.normpath(os.path.join(WS, 'deepseek-harness', 'scratch-plugin'))
DATA_DIR = os.environ.get('MC_DATA_DIR') or os.path.join(SCRATCH, 'data')
SERVER_DIR = os.environ.get('MC_SERVER_DIR') or os.path.join(SCRATCH, 'mc-server-neoforge')
node = r"C:\Program Files\nodejs\node.exe"
tsx_dir = os.path.normpath(os.path.join(WS, 'deepseek-harness', 'node_modules', '.pnpm',
                                        'tsx@4.22.4', 'node_modules', 'tsx', 'dist'))
preflight = os.path.join(tsx_dir, "preflight.cjs")
loader = os.path.join(tsx_dir, "loader.mjs")
log = os.path.join(DATA_DIR, "world-process.log")
err = os.path.join(DATA_DIR, "world-process.err.log")

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
env["MC_DATA_DIR"] = DATA_DIR   # 运行态正本：scratch-plugin\data
env["MC_LOG_PATH"] = os.path.join(SERVER_DIR, "logs", "latest.log")
env["MC_ADVANCEMENTS_DIR"] = os.path.join(SERVER_DIR, "world", "advancements")
cmd = [node, "--require", preflight, "--import", f"file:///{loader}", "bootstrap-world.mts"]
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000

with open(log, "ab") as f:
    f.write(f"\n===== world restart (repo-side) {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n".encode("utf-8"))
    p = subprocess.Popen(
        cmd, cwd=DIR, stdout=f, stderr=open(err, "ab"),
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW,
        close_fds=True, env=env,
    )
print(f"started pid={p.pid} (cwd={DIR}, MC_DATA_DIR={DATA_DIR})")

# 等 Goddess 入服（world 日志出现 spectator）
for i in range(30):
    time.sleep(2)
    tail = open(log, "rb").read()[-4000:].decode("utf-8", errors="replace")
    if "is now a spectator" in tail:
        print(f"goddess is spectator after ~{(i + 1) * 2}s")
        sys.exit(0)
print("WARN: spectator confirmation not seen in 60s — check MC_DATA_DIR/world-process.log")
sys.exit(1)
