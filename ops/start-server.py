# -*- coding: utf-8 -*-
"""
start-server.py — 千灯纪服务栈统一入口（2026-08-28 落地）
造物主 2026-08-24 谕：简单、好维护。组件集中在 COMPONENTS，增删只改这一个 dict。

用法：
  python start-server.py status              # 全组件状态
  python start-server.py up   [--only X]     # 拉起（幂等，已跑跳过；自动带依赖）
  python start-server.py down [--only X]     # 停
  python start-server.py restart [--only X]  # down+up

组件两类：
  compose  = docker compose 服务（mc/gate/world/npc/guard/panel/qwenpaw）
  relay    = 宿主 TCP 转发裸进程（host_tcp_relay.py；25565=真人 NeoForge 口经 mc-direct，25599=bot 口经 gate）

注意：2026-08-28 双通道拓扑（真人被 gate 拒之门外后定谳）：
    gate 只服务原版协议/mineflayer 客户端（它替客户端跟 NeoForge 服协商），
    真人 NeoForge 客户端过 gate 会报「服务器没有使用 NeoForge」→ 必须直连 MC 服。
    - 25565（真人 NeoForge 口）：relay25565 -> 127.0.0.1:25566 -> mc-direct 容器(socat 纯转发) -> mc:25599
      （mc-direct 用 docker 服务名 mc 解析，不怕容器 IP 变；宿主直连容器 IP 不可达=WSL2 隔离，故需 socat 中转）
    - 25599（bot/mineflayer 口）：relay25599 -> gate:25700 神社之门代完成 NeoForge 协商
"""
import subprocess, sys, os, time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

COMPOSE_DIR = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow"
RELAY_PY = os.path.join(COMPOSE_DIR, "..", "host_tcp_relay.py")  # 在 ops/docker/ 下，不在 shadow/
VENV_PY = r"C:\Users\lzl19\.qwenpaw\venv\Scripts\python.exe"
GATE_PORT = "25700"


def _sh(cmd, timeout=180):
    r = subprocess.run(cmd, capture_output=True, timeout=timeout, shell=True)
    return ((r.stdout or b"") + (r.stderr or b"")).decode("utf-8", errors="replace")


def compose_up(service):
    return _sh(f'cd /d "{COMPOSE_DIR}" && docker compose up -d {service}')


def compose_down(service):
    return _sh(f'cd /d "{COMPOSE_DIR}" && docker compose stop {service}')


def container_running(container):
    out = _sh(f'docker inspect -f "{{{{.State.Running}}}}" {container}').strip()
    return out == "true"


def port_listening_pid(port):
    """返回监听该端口的 PID（str）或 None。"""
    out = _sh(f'netstat -ano -p tcp | findstr ":{port} " | findstr LISTENING')
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[3] == "LISTENING":
            return parts[4]
    return None


def relay_start(listen_port, target_port, target_host="127.0.0.1"):
    # Popen + DETACHED_PROCESS（deploy-numen.py 同款已验证姿势）；
    # Start-Process -WindowStyle Hidden 拉起 python 控台程序不可靠（实测静默失败）。
    log = open(os.path.join(COMPOSE_DIR, f"relay-{listen_port}.log"), "ab")
    subprocess.Popen(
        [VENV_PY, RELAY_PY, "--listen-port", listen_port, "--target-host", target_host,
         "--target-port", target_port],
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        stdout=log, stderr=subprocess.STDOUT,
        cwd=COMPOSE_DIR, close_fds=True,
    )
    for _ in range(10):  # 最多等 10s 端口监听
        time.sleep(1)
        if port_listening_pid(listen_port):
            return


def relay_stop(listen_port):
    pid = port_listening_pid(listen_port)
    if pid:
        _sh(f"taskkill /PID {pid} /F")
        time.sleep(1)


def udp_listening_pid(port):
    """返回监听该 UDP 端口的 PID（str）或 None（Geyser 基岩口 19140 是 UDP）。"""
    out = _sh(f'netstat -ano -p udp | findstr ":{port} "')
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0].upper() == "UDP":
            return parts[-1]
    return None


# ---------------------------------------------------------------------------
# COMPONENTS 注册表 —— 增删组件只改这里
# kind: compose(service, container) | relay(listen_port, target_port)
#       | host_proc(vbs 隐藏拉起宿主进程 + probe_proto/probe_port 探测存活；如 Geyser 基岩桥)
# depends: 依赖的组件 label（up 时自动先拉起）
# ---------------------------------------------------------------------------
COMPONENTS = {
    "mc":          {"kind": "compose", "service": "mc",    "container": "shadow-mc",     "desc": "MC 主服（NeoForge 1.21.1）"},
    "gate":        {"kind": "compose", "service": "gate",  "container": "shadow-gate",   "desc": "神社之门（NeoForge 协商边车）", "depends": ["mc"]},
    "world":       {"kind": "compose", "service": "world", "container": "shadow-world",  "desc": "世界进程（Goddess）", "depends": ["mc", "gate"]},
    "npc":         {"kind": "compose", "service": "npc",   "container": "shadow-npc",    "desc": "NPC 引擎", "depends": ["mc"]},
    "guard":       {"kind": "compose", "service": "guard", "container": "shadow-guard",  "desc": "守卫桥", "depends": ["mc"]},
    "panel":       {"kind": "compose", "service": "panel", "container": "shadow-panel",  "desc": "web 面板（9090）"},
    "qwenpaw":     {"kind": "compose", "service": "qwenpaw", "container": "shadow-qwenpaw", "desc": "瓶中 QwenPaw（8088 守卫魂）"},
    "relay25565":  {"kind": "relay", "listen_port": "25565", "target_port": "25566", "target_host": "127.0.0.1",
                    "desc": "TCP 转发 25565 -> mc-direct:25566（socat 容器纯转发 -> mc:25599）＝真人 NeoForge 直连口",
                    "depends": ["mc"]},
    "relay25599":  {"kind": "relay", "listen_port": "25599", "target_port": GATE_PORT, "desc": "TCP 转发 25599 -> gate:25700 ＝ bot/mineflayer 口（神社之门代协商）", "depends": ["gate"]},
    # 2026-08-29 造物主谕「基岩桥要常驻」：Geyser 收编为编排组件（此前只有计划任务 ONLOGON，
    # 进程死了没人拉）。Docker Desktop 发布不了 UDP 端口 → 只能宿主进程（vbs 隐藏跑 ViaProxy cli）。
    # ViaProxy 3.4.12 内置 Geyser-ViaProxy 插件 + settlementsgate 扩展（35 NPC 花名册）。
    "geyser":      {"kind": "host_proc", "probe_proto": "udp", "probe_port": "19140",
                    "vbs": os.path.join(COMPOSE_DIR, "viaproxy", "start-viaproxy-hidden.vbs"),
                    "desc": "Geyser 基岩桥（ViaProxy 宿主进程：UDP 19140 基岩口；TCP 25568 老Java测试口）",
                    "depends": ["mc"]},
}


def _probe_pid(c):
    if c.get("probe_proto") == "udp":
        return udp_listening_pid(c["probe_port"])
    return port_listening_pid(c["probe_port"])


def is_up(label):
    c = COMPONENTS[label]
    if c["kind"] == "compose":
        return container_running(c["container"])
    if c["kind"] == "host_proc":
        return _probe_pid(c) is not None
    return port_listening_pid(c["listen_port"]) is not None


def comp_start(label, seen=None):
    seen = seen or set()
    if label in seen:
        return
    seen.add(label)
    c = COMPONENTS[label]
    for dep in c.get("depends", []):
        if not is_up(dep):
            print(f"  [deps] {dep} 未运行，先拉起…")
            comp_start(dep, seen)
    if is_up(label):
        print(f"  {label}: 已在跑，跳过")
        return
    if c["kind"] == "compose":
        out = compose_up(c["service"])
        tail = out.strip().splitlines()[-3:] if out.strip() else []
        print(f"  {label}: compose up -> " + " | ".join(x.strip() for x in tail))
    elif c["kind"] == "host_proc":
        # wscript 跑 vbs（内部 hidden 跑 bat → java -jar ViaProxy cli）；无窗口、脱离本进程
        subprocess.Popen(["wscript.exe", c["vbs"]], cwd=os.path.dirname(c["vbs"]), close_fds=True)
        for _ in range(20):  # ViaProxy+Geyser 启动 ~15s（含 mod 映射加载）
            time.sleep(1)
            if is_up(label):
                break
        ok = is_up(label)
        print(f"  {label}: host proc start {'OK' if ok else 'FAILED(探测端口未监听)'}")
    else:
        relay_start(c["listen_port"], c["target_port"], c.get("target_host", "127.0.0.1"))
        ok = is_up(label)
        print(f"  {label}: relay start {'OK' if ok else 'FAILED(端口未监听)'}")


def comp_stop(label):
    c = COMPONENTS[label]
    if c["kind"] == "compose":
        out = compose_down(c["service"])
        print(f"  {label}: compose stop")
    elif c["kind"] == "host_proc":
        pid = _probe_pid(c)
        if pid:
            _sh(f"taskkill /PID {pid} /F")
            time.sleep(1)
        print(f"  {label}: host proc stopped")
    else:
        relay_stop(c["listen_port"])
        print(f"  {label}: relay stopped")


def main():
    # 参数解析：支持 `--only X`（两参数）与 `--only=X` 两种写法
    args = sys.argv[1:]
    cmd = "status"
    only = None
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--only":
            i += 1
            only = args[i] if i < len(args) else None
        elif a.startswith("--only="):
            only = a.split("=", 1)[1]
        elif not a.startswith("--"):
            cmd = a
        i += 1
    if not only:
        only = os.environ.get("START_ONLY") or None

    labels = [only] if only else list(COMPONENTS)
    for label in labels:
        if label not in COMPONENTS:
            print(f"未知组件: {label}（可用: {', '.join(COMPONENTS)}）")
            return 1

    if cmd == "status":
        print(f"{'组件':<12}{'状态':<8}说明")
        for label in labels:
            c = COMPONENTS[label]
            up = is_up(label)
            pid = ""
            if c["kind"] in ("relay", "host_proc") and up:
                pid = f"pid={_probe_pid(c) if c['kind'] == 'host_proc' else port_listening_pid(c['listen_port'])}"
            print(f"{label:<12}{'UP' if up else 'DOWN':<8}{c['desc']} {pid}")
    elif cmd == "up":
        for label in labels:
            comp_start(label)
    elif cmd == "down":
        for label in labels:
            comp_stop(label)
    elif cmd == "restart":
        for label in labels:
            comp_stop(label)
        time.sleep(3)
        for label in labels:
            comp_start(label)
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
