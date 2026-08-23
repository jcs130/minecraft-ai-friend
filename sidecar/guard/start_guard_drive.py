# -*- coding: utf-8 -*-
"""guard_drive 常驻守护脚本 —— 幂等启动 + 崩溃自愈 + UTF-8 日志。

用法：python start_guard_drive.py   （一次到位，可反复跑）
用法：python start_guard_drive.py --stop   （停掉现有 guard_drive 进程）
"""
import subprocess, os, sys, time

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
DRIVE = os.path.join(HERE, "guard_drive.py")
LOG = os.path.join(HERE, "guard_drive.log")

DETACHED = 0x00000008
NEW_GROUP = 0x00000200
NO_WINDOW = 0x08000000
FLAGS = DETACHED | NEW_GROUP | NO_WINDOW

PY = sys.executable


def find_drive_pid():
    """找正在跑的 guard_drive.py 进程 PID（排除本守护脚本自身）。"""
    r = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
         "Where-Object { $_.CommandLine -match 'guard_drive\\.py' "
         "  -and $_.CommandLine -notmatch 'start_guard_drive' } | "
         "Select-Object -ExpandProperty ProcessId"],
        capture_output=True, text=True)
    pids = [int(x) for x in r.stdout.split() if x.strip().isdigit()]
    return pids


def stop():
    pids = find_drive_pid()
    if not pids:
        print("无 guard_drive 进程在跑")
        return
    for pid in pids:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
        print(f"已停止 guard_drive pid={pid}")
    time.sleep(1)


def start():
    pids = find_drive_pid()
    if pids:
        print(f"guard_drive 已在跑 pid={pids}，跳过（如需重启请先 --stop）")
        return
    # 以 UTF-8 环境启动，日志由 Python 侧 UTF-8 写入，绕开 cmd GBK 代码页乱码
    env = os.environ.copy()
    # 清除 uv 劫持的 PYTHONHOME/PYTHONPATH：否则 Python311 解释器会加载 uv 3.12 标准库，
    # 触发 "SRE module mismatch" 崩溃（2026-08-23 改名重启时踩坑）。
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    with open(LOG, "ab") as f:
        f.write(f"\n===== guard_drive boot {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n".encode("utf-8"))
        subprocess.Popen([PY, DRIVE], cwd=HERE, stdout=f, stderr=subprocess.STDOUT,
                         creationflags=FLAGS, close_fds=True, env=env)
    print(f"guard_drive 已启动（日志 {LOG}）")
    time.sleep(3)
    pids = find_drive_pid()
    print(f"确认 pid={pids}")


if __name__ == "__main__":
    if "--stop" in sys.argv:
        stop()
    else:
        start()
