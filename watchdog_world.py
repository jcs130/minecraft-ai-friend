# -*- coding: utf-8 -*-
"""watchdog_world.py —— 世界进程看门狗（2026-08-18，事故复盘产物）。

事故：世界进程 23:39 被杀后无人察觉，女神聋了 17 分钟（面板独立进程照常绿）。
守则：
  1. MC 服务器(:25565)不在线 → 直接退出（全栈下线是有意状态，不拉起任何东西）；
  2. 服务器在线但无 bootstrap-world 进程 → restart_world.py 拉起（幂等）；
  3. 进程在但心跳(data/world-heartbeat.json)过期 >150s（化身断线重连失败等）→
     杀掉重拉；
  4. 一切正常 → 静默退出（日志只记动作，不刷屏）。
计划任务 MC-World-Watchdog 每 5 分钟跑一次；手动演练亦可。
"""
import json
import os
import socket
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

BASE = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin"
HEARTBEAT = os.path.join(BASE, "data", "world-heartbeat.json")
LOG = os.path.join(BASE, "data", "watchdog-world.log")
STALE_SEC = 150


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def server_up() -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3)
    try:
        return s.connect_ex(("127.0.0.1", 25565)) == 0
    finally:
        s.close()


def world_process_pids():
    import psutil
    pids = []
    for p in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if (p.info['name'] or '').lower() != 'node.exe':
                continue
            if 'bootstrap-world' in ' '.join(p.info['cmdline'] or []):
                pids.append(p.info['pid'])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return pids


def heartbeat_age() -> float:
    """返回心跳年龄秒数；无文件/无字段返回 1e9。"""
    try:
        d = json.load(open(HEARTBEAT, encoding="utf-8"))
        return max(0.0, time.time() - d["ts"] / 1000)
    except Exception:
        return 1e9


def restart_world(reason: str) -> None:
    log(f"RESTART world: {reason}")
    r = subprocess.run([sys.executable, os.path.join(BASE, "restart_world.py")],
                       capture_output=True, text=True, timeout=120,
                       cwd=BASE)
    log(f"restart_world rc={r.returncode} out={ (r.stdout or '').strip()[:200] }")


def main() -> int:
    if not server_up():
        return 0  # 服务器不在 = 有意下线，看门狗不打扰
    pids = world_process_pids()
    age = heartbeat_age()
    if not pids:
        restart_world("no bootstrap-world process while MC server is up")
        return 0
    if age > STALE_SEC:
        log(f"stale heartbeat {int(age)}s (pids={pids}) — killing and re-pulling")
        subprocess.run([sys.executable, os.path.join(BASE, "kill_world.py")],
                       capture_output=True, text=True, timeout=60, cwd=BASE)
        time.sleep(3)
        restart_world(f"heartbeat stale {int(age)}s")
        return 0
    return 0  # 健康，静默


if __name__ == "__main__":
    sys.exit(main())
