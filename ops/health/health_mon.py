# -*- coding: utf-8 -*-
"""mc-health 巡检守护(2026-08-29 立,造物主问责「工程稳定性」后的体系化补课)

背景:守卫桥暴死三天、背包卡被顶出视口、craft 工具坏、成就通道挂空目录——
全部是造物主用的时候撞见,没有一个被主动发现。根因=没有健康基线+看门狗+冒烟。
本文件把三样补齐:一张清单(manifest)、一个巡检器(本文件)、一套调度(schtasks+cron)。

用法:
  python health_mon.py            # 巡检一轮,打印红绿灯,写 status.json/alerts.jsonl
  python health_mon.py --auto     # 同上,并对红灯执行自动恢复(带 30min 冷却)
  python health_mon.py --smoke    # 冒烟:panel 页面关键标记断言(改 web-panel 后必跑)
  python health_mon.py --report   # 日报:最近 24h 警报汇总(我的 cron 消化用)

设计纪律:纯标准库(venv 解释器直接跑);探针失败不抛异常,记红继续;自动恢复
动作永远幂等;每组件恢复带冷却,防重启风暴。
"""
import io
import json
import os
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.dirname(os.path.dirname(HERE))          # B 仓根 minecraft-ai-friend
DATA = os.path.join(HERE, "data")
os.makedirs(DATA, exist_ok=True)
STATUS = os.path.join(DATA, "status.json")
ALERTS = os.path.join(DATA, "alerts.jsonl")
RCON_SECRET = os.path.join(B, "ops", "docker", "shadow", "data", "rcon-secret.txt")
GUARD_LOG = os.path.join(B, "sidecar", "guard", "guard_drive.log")
START_GUARD = os.path.join(B, "sidecar", "guard", "start_guard_drive.py")
WEB_ENTITIES = os.path.join(B, "ops", "docker", "shadow", "data", "web-entities.json")
COPAW_CONFIG = os.path.join(os.path.expanduser("~"), ".copaw", "config.json")
VENV_PY = r"C:\Users\lzl19\.qwenpaw\venv\Scripts\python.exe"

# ---------------- manifest:什么算健康 ----------------
HTTP_PROBES = {          # name: url
    "panel-9090": "http://127.0.0.1:9090/",
    "modern-3070": "http://127.0.0.1:3070/index.js",
    "viewer-3050": "http://127.0.0.1:3050/",
    "gateway-8011": "http://127.0.0.1:8011/download",
}
CONTAINERS = ["shadow-mc", "shadow-world", "shadow-panel", "shadow-gateway", "shadow-qwenpaw"]
YELLOW_ONLY = {"viewer-3050"}  # 回退通道(现代画面 3070 为主):挂=黄不记红
GUARD_AGENTS = ["mc-guard-kirito", "mc-guard-naruto"]   # QwenPaw 亲卫必须 enabled
EXPECTED_ONLINE = ["Kirito", "Naruto"]                   # RCON list 里必须见到的身体

# ---------------- Source RCON(简版,标准库) ----------------
class Rcon:
    def __init__(self, host="127.0.0.1", port=25575):
        secret = io.open(RCON_SECRET, encoding="utf-8").read().strip()
        self.s = socket.create_connection((host, port), timeout=6)
        self.rid = 100
        self._auth(secret)

    def _pkt(self, ptype, body):
        data = struct.pack("<ii", self.rid, ptype) + body.encode("utf-8") + b"\x00\x00"
        self.s.sendall(struct.pack("<i", len(data)) + data)

    def _read(self):
        ln = struct.unpack("<i", self.s.recv(4))[0]
        buf = b""
        while len(buf) < ln:
            buf += self.s.recv(ln - len(buf))
        rid, ptype = struct.unpack("<ii", buf[:8])
        return rid, ptype, buf[8:-2].decode("utf-8", "replace")

    def _auth(self, secret):
        self._pkt(3, secret)
        rid, _, _ = self._read()
        if rid == -1:
            raise RuntimeError("rcon auth failed")

    def cmd(self, body):
        self.rid += 1
        want = self.rid
        self._pkt(2, body)
        for _ in range(4):  # 跳过无关包,读到 rid 匹配的响应(双读卡死曾致探针假红)
            rid, _, out = self._read()
            if rid == want:
                return out
        return out

    def close(self):
        try: self.s.close()
        except Exception: pass


# ---------------- 探针 ----------------
def probe_http(name, url):
    try:
        with urllib.request.urlopen(url, timeout=6) as r:
            return ("green" if r.status == 200 else "red", f"http {r.status}") if r.status != 200 else ("green", "200")
    except Exception as e:
        return "red", str(e)[:80]


def probe_containers():
    out = {}
    try:
        r = subprocess.run(["docker", "ps", "--format", "{{.Names}}\t{{.Status}}"],
                           capture_output=True, text=True, timeout=20)
        rows = dict((l.split("\t")[0], l.split("\t")[1]) for l in r.stdout.splitlines() if "\t" in l)
    except Exception as e:
        return {c: ("red", f"docker err {str(e)[:60]}") for c in CONTAINERS}
    for c in CONTAINERS:
        st = rows.get(c, "")
        out[c] = ("green", st[:40]) if st.startswith("Up") else ("red", st or "absent")
    return out


def probe_guard_bridge(auto=False, cooldown={}):
    """守卫桥进程 + 日志新鲜度(慢系统 30s 一轮;反射层 5s 心跳异常才打,静默=正常)。"""
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command",
                            "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object {$_.CommandLine -match 'guard_drive'} | Measure-Object | Select-Object -ExpandProperty Count"],
                           capture_output=True, text=True, timeout=25)
        n = int(r.stdout.strip() or 0)
    except Exception:
        n = -1
    if n >= 1:
        return "green", f"proc x{n}"
    if auto and _cool("restart_guard_bridge", cooldown, 1800):
        subprocess.Popen([VENV_PY, START_GUARD], cwd=os.path.dirname(START_GUARD),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return "red", "bridge dead -> restarted (start_guard_drive)"
    return "red", "guard_drive process absent"


def probe_guard_log_fresh():
    try:
        age = time.time() - os.path.getmtime(GUARD_LOG)
        return ("green", f"log {int(age)}s old") if age < 900 else ("yellow", f"log stale {int(age/60)}min")
    except Exception as e:
        return "red", str(e)[:60]


def probe_web_entities_fresh():
    try:
        age = time.time() - os.path.getmtime(WEB_ENTITIES)
        return ("green", f"{int(age)}s old") if age < 120 else ("red", f"stale {int(age)}s(天眼断流)")
    except Exception as e:
        return "red", str(e)[:60]


def probe_rcon_and_guards():
    """RCON 可用 + 守卫身体在线 + 两人 HP/饥饿(低=黄,濒死=红)。"""
    try:
        r = Rcon()
    except Exception as e:
        return {"rcon": ("red", str(e)[:60])}
    out = {}
    try:
        lst = r.cmd("list")
        out["rcon"] = ("green", "ok")
        missing = [g for g in EXPECTED_ONLINE if g not in lst]
        out["guards-online"] = ("green", "both") if not missing else ("red", f"missing {missing}")
        for who in EXPECTED_ONLINE:
            st = r.cmd(f'numen_act invoke "{who}" get_self_status {{}}')
            m = re.search(r'"hp"\s*:\s*([\d.]+)', st)
            f = re.search(r'"hunger"\s*:\s*([\d.]+)', st)
            hp = float(m.group(1)) if m else None
            fd = float(f.group(1)) if f else None
            if hp is None:
                out[f"{who}-status"] = ("red", "get_self_status no hp field")
            elif hp <= 6:
                out[f"{who}-status"] = ("red", f"hp {hp} 濒死(反射层应已动)")
            elif hp <= 10 or (fd is not None and fd <= 4):
                out[f"{who}-status"] = ("yellow", f"hp {hp} food {fd}")
            else:
                out[f"{who}-status"] = ("green", f"hp {hp} food {fd}")
        # numen invoke 通道已被上方 get_self_status x2 实测覆盖,不再单列探针
    except Exception as e:
        out["rcon"] = ("red", str(e)[:60])
    finally:
        try: r.close()
        except Exception: pass
    return out


def probe_guard_agents_enabled():
    try:
        d = json.load(io.open(COPAW_CONFIG, encoding="utf-8"))
        out = {}
        for a in GUARD_AGENTS:
            en = d.get("agents", {}).get("profiles", {}).get(a, {}).get("enabled")
            out[a] = ("green", "enabled") if en else ("red", "disabled(403 root cause)")
        return out
    except Exception as e:
        return {"copaw-config": ("yellow", str(e)[:60])}


def _cool(tag, cooldown, sec):
    now = time.time()
    if now - cooldown.get(tag, 0) < sec:
        return False
    cooldown[tag] = now
    return True


def probe_panel_smoke():
    """改 web-panel 后必须保持的页面关键标记(背包卡在众生页签且序在修为榜前)。"""
    try:
        with urllib.request.urlopen("http://127.0.0.1:9090/", timeout=8) as r:
            h = r.read().decode("utf-8", "replace")
        checks = {
            "inv-card": 'id="inv"' in h,
            "reorder-loop": "声明序重排" in h,
            "beings-order": "'状态', '背包'" in h,
            "overflow": "overflow-y:auto" in h,
        }
        bad = [k for k, v in checks.items() if not v]
        return ("green", "panel smoke ok") if not bad else ("red", f"smoke fail {bad}")
    except Exception as e:
        return "red", str(e)[:60]


# ---------------- 主流程 ----------------
def run(auto=False):
    results = {}
    for n, u in HTTP_PROBES.items():
        st, msg = probe_http(n, u)
        if st == "red" and n in YELLOW_ONLY:  # 回退通道:挂=黄,不触发红灯
            st = "yellow"
        results[n] = (st, msg)
    results.update(probe_containers())
    results["guard-bridge"] = probe_guard_bridge(auto=auto)
    results["guard-log-fresh"] = probe_guard_log_fresh()
    results["web-entities-fresh"] = probe_web_entities_fresh()
    results.update(probe_rcon_and_guards())
    results.update(probe_guard_agents_enabled())
    results["panel-smoke"] = probe_panel_smoke()

    now = time.time()
    snap = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "ts": now,
            "red": [k for k, v in results.items() if v[0] == "red"],
            "yellow": [k for k, v in results.items() if v[0] == "yellow"],
            "detail": {k: {"s": v[0], "m": v[1]} for k, v in results.items()}}
    io.open(STATUS, "w", encoding="utf-8").write(json.dumps(snap, ensure_ascii=False, indent=1))
    for k, v in results.items():
        if v[0] == "red":  # 红灯落警报流水(cron/日报消费)
            with io.open(ALERTS, "a", encoding="utf-8") as f:
                f.write(json.dumps({"at": snap["at"], "ts": now, "comp": k, "msg": v[1]}, ensure_ascii=False) + "\n")
    # 控制台摘要(schtask 静默跑,人看 --report)
    print(f"[health {snap['at']}] red={len(snap['red'])} yellow={len(snap['yellow'])}")
    for k in snap["red"]:
        print(f"  RED  {k}: {results[k][1]}")
    for k in snap["yellow"][:6]:
        print(f"  YEL  {k}: {results[k][1]}")
    return 0 if not snap["red"] else 1


def report():
    """最近 24h 警报日报(cron 消化)。"""
    if not os.path.exists(ALERTS):
        print("(no alerts file — all quiet since deployment)")
        return 0
    day = time.time() - 86400
    rows, seen = [], {}
    for line in io.open(ALERTS, encoding="utf-8"):
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("ts", 0) >= day:
            key = d["comp"]
            seen.setdefault(key, {"n": 0, "last": "", "msg": ""})
            seen[key]["n"] += 1
            seen[key]["last"] = d["at"]
            seen[key]["msg"] = d["msg"]
    if not seen:
        print("(24h: zero red alerts)")
        return 0
    print(f"== 24h alerts by component ==")
    for k, v in sorted(seen.items(), key=lambda x: -x[1]["n"]):
        print(f"  {k}: {v['n']}x last {v['last']} | {v['msg']}")
    return 1


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "--report":
        sys.exit(report())
    sys.exit(run(auto=(arg == "--auto")))
