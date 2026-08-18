# -*- coding: utf-8 -*-
"""watchdog_world.py —— 世界进程看门狗（2026-08-18，事故复盘产物；同日升级双模式）。

事故：世界进程 23:39 被杀后无人察觉，女神聋了 17 分钟（面板独立进程照常绿）。
双模式（2026-08-18 下午 Docker 迁移）：
  * 容器模式：docker 容器 mc-world 存在即接管——
      容器没 running → docker start；心跳(volume 内, docker exec 读)过期 → docker restart；
  * 裸机模式：容器不存在 → 原逻辑（25565 在线才管；进程缺失/心跳过期重拉裸机进程）。
    compose down 即自动回滚到裸机模式，看护职责无缝交接。
守则：
  1. MC 服务器(:25565)不在线 → 直接退出（全栈下线是有意状态，不拉起任何东西）；
  2. 服务器在线但世界进程/容器不在 → 拉起（幂等）；
  3. 进程在但心跳过期 >150s → 重拉；
  4. 一切正常 → 静默退出（日志只记动作，不刷屏）。
计划任务 MC-World-Watchdog 每 5 分钟跑一次；手动演练亦可。
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

BASE = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin"
HEARTBEAT = os.path.join(BASE, "data", "world-heartbeat.json")
LOG = os.path.join(BASE, "data", "watchdog-world.log")
STALE_SEC = 150
WORLD_CONTAINER = "mc-server"
DOCKER = shutil.which("docker") or r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def docker(*args, timeout=30):
    # encoding 必须 utf-8：docker 输出含 UTF-8 特殊字符（如 →），默认 GBK 解码会炸
    # reader thread（2026-08-19 task.log 实锤 UnicodeDecodeError，且 capture 失败会
    # 导致 stdout 为空 → 心跳误判 stale → 多余重启）
    return subprocess.run([DOCKER, *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)


def container_status() -> str:
    """容器状态；不存在/docker 不可用返回 ''（走裸机模式）。"""
    try:
        r = docker("inspect", WORLD_CONTAINER, "-f", "{{.State.Status}}")
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def read_container_hb() -> dict:
    """读容器内世界心跳 dict；失败返回 {}。"""
    try:
        r = docker("exec", WORLD_CONTAINER, "cat", "/app/data/world-heartbeat.json", timeout=15)
        return json.loads(r.stdout) if r.returncode == 0 else {}
    except Exception:
        return {}


def container_heartbeat_age() -> float:
    """读 volume 内心跳（docker exec cat）；失败返回 1e9。"""
    d = read_container_hb()
    try:
        return max(0.0, time.time() - d["ts"] / 1000)
    except Exception:
        return 1e9


def docker_engine_process_alive() -> bool:
    """Docker Desktop 引擎进程（com.docker.backend）是否存活。"""
    try:
        r = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq com.docker.backend.exe"],
            capture_output=True, text=True, timeout=15)
        return "com.docker.backend.exe" in (r.stdout or "")
    except Exception:
        return False


def guard_container_mode() -> int:
    """容器模式看护。"""
    st = container_status()
    if st != "running":
        log(f"RESTART container {WORLD_CONTAINER}: status={st or 'not-found/inspect-fail'} → docker start")
        r = docker("start", WORLD_CONTAINER, timeout=60)
        log(f"docker start rc={r.returncode} {(r.stdout or r.stderr).strip()[:150]}")
        return 0
    age = container_heartbeat_age()
    if age > STALE_SEC:
        log(f"stale heartbeat {int(age)}s in container → docker restart")
        r = docker("restart", WORLD_CONTAINER, timeout=90)
        log(f"docker restart rc={r.returncode} {(r.stdout or r.stderr).strip()[:150]}")
    return 0


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
    """返回裸机心跳年龄秒数；无文件/无字段返回 1e9。"""
    try:
        d = json.load(open(HEARTBEAT, encoding="utf-8"))
        return max(0.0, time.time() - d["ts"] / 1000)
    except Exception:
        return 1e9


def restart_world(reason: str) -> None:
    log(f"RESTART world(bare): {reason}")
    r = subprocess.run([sys.executable, os.path.join(BASE, "restart_world.py")],
                       capture_output=True, text=True, timeout=120,
                       cwd=BASE)
    log(f"restart_world rc={r.returncode} out={ (r.stdout or '').strip()[:200] }")


ALIVE = os.path.join(BASE, "data", "watchdog-alive.json")


def touch_alive() -> None:
    """每次 tick 覆写存活信号（2026-08-19 二级探活锚点，源自 08-18 晚 andy 事件复盘：
    看门狗健康时静默不写动作日志，外部无法区分“正常静默”与“看门狗已死”）。
    二级探活规则：本文件 age > 900s（3 个 tick 周期）→ 看门狗死亡 →
    schtasks /Run /TN MC-World-Watchdog 拉起 + 报 agent bus。
    watching 数组顺带落档，bot 掉线检测有数据源可查。"""
    try:
        hb = read_container_hb()
        age = container_heartbeat_age()
        info = {
            "ts": int(time.time() * 1000),
            "serverUp": server_up(),
            "container": container_status(),
            "hbAge": int(age) if age < 1e8 else None,
            "watching": hb.get("watching", []),
        }
        tmp = ALIVE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False)
        os.replace(tmp, ALIVE)
    except Exception:
        pass  # 存活信号写失败不阻断主逻辑（主逻辑自身会写动作日志）


def main() -> int:
    touch_alive()  # 二级探活锚点：无论走哪个分支，tick 开头先盖章
    if not server_up():
        return 0  # 服务器不在 = 有意下线，看门狗不打扰

    # 容器模式：mc-world 容器存在即接管，裸机逻辑退役
    if container_status() or container_heartbeat_probe():
        return guard_container_mode()

    # 2026-08-19 互踢战修复：inspect 与 exec 双失败时，若 Docker 引擎进程仍活着，
    # 判定“引擎僵死/不可达”第三态——容器大概率仍在运行，只告警，绝不回落裸机
    # （宿主侧拉起第二个世界进程 = 双 Goddess 每 3 秒互踢，08-19 01:55-06:20 事故，
    #  累计 4336 次 logged-in-from-another-location）。
    # 仅当引擎进程也不在了（Docker Desktop 被人正常退出/compose down）才走裸机接管。
    if docker_engine_process_alive():
        log("ENGINE-DEAD-GUARD: docker engine process alive but inspect+exec both failed "
            "(engine hang?) — container likely still running, skip bare-metal pull to avoid dual-world war")
        return 0

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


def container_heartbeat_probe() -> bool:
    """容器 inspect 失败但 exec 能读心跳 → 容器仍在（inspect 偶发失败兜底）。"""
    return container_heartbeat_age() < 1e8


if __name__ == "__main__":
    sys.exit(main())
