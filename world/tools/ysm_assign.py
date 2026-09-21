#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YSM（Yes! Steve Model）皮肤模型分配工具 · 千灯纪

机制（2026-09-21 实测 + 官方文档定谳）：
  /ysm auth  <玩家> all                    授权全部模型 → 玩家 Alt+Y 界面自选
  /ysm auth  <玩家> add|remove <模型id>    授权/取消单个模型
  /ysm auth  <玩家> clear                  清空该玩家授权
  /ysm model set <玩家> <模型> <材质> true 服务端直接定模型（末位 true = 无视授权）
  /ysm model reload                        改了 custom/ 里的模型后重载并同步全服

模型 id 规则（踩过两个坑，记此）：
  builtin/default          → "default"
  builtin/misc/1_alex      → "misc/1_alex"     ← 内置包要带包名
  builtin/wine_fox/22_elf  → "wine_fox/22_elf" ← 内置包要带包名
  custom/qiandengji_kirito → "qiandengji_kirito" ← 自制包只用文件夹名
  ① **含斜杠的 id 必须加双引号**，否则 brigadier 报 "Expected whitespace to end one argument"
  ② 授权不落盘（auth/ 目录不写文件）→ 只能走命令，不能手写配置文件

用法：
  python ysm_assign.py list
  python ysm_assign.py grant  <玩家...>        # 授权全库，让玩家自己选（真人用这个）
  python ysm_assign.py random <玩家...>        # 授权 + 随机定一个模型（Agent/假玩家初始形象）
  python ysm_assign.py set    <玩家> <模型id>  # 指定模型
口令来源：--secret <文件> > 环境变量 MC_RCON_SECRET > <repo>/server/world-data/rcon-secret.txt
"""
import argparse
import os
import random
import socket
import struct
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CFG = os.environ.get("YSM_CONFIG_DIR") or os.path.join(REPO_ROOT, "server", "mc", "config", "yes_steve_model")
HOST = os.environ.get("MC_RCON_HOST", "127.0.0.1")
PORT = int(os.environ.get("MC_RCON_PORT", "25577"))


def model_pool():
    ids = []
    b = os.path.join(CFG, "builtin")
    if os.path.isdir(b):
        for pack in sorted(os.listdir(b)):
            d = os.path.join(b, pack)
            if not os.path.isdir(d):
                continue
            if os.path.isfile(os.path.join(d, "ysm.json")):
                ids.append(pack)
            for sub in sorted(os.listdir(d)):
                sd = os.path.join(d, sub)
                if os.path.isdir(sd) and os.path.isfile(os.path.join(sd, "ysm.json")):
                    ids.append(f"{pack}/{sub}")
    c = os.path.join(CFG, "custom")
    if os.path.isdir(c):
        for sub in sorted(os.listdir(c)):
            if os.path.isfile(os.path.join(c, sub, "ysm.json")):
                ids.append(sub)
    return ids


def quote(mid):
    return f'"{mid}"' if "/" in mid else mid


def read_secret(path):
    if path:
        return open(path, encoding="utf-8-sig").read().strip()
    env = os.environ.get("MC_RCON_SECRET", "").strip()
    if env:
        return env
    f = os.path.join(REPO_ROOT, "server", "world-data", "rcon-secret.txt")
    return open(f, encoding="utf-8-sig").read().strip() if os.path.exists(f) else ""


def rcon(cmd, secret):
    """标准 Source RCON（SERVERDATA_AUTH=3 / EXEC_COMMAND=2 / RESPONSE=0 / AUTH_OK=2）"""
    def frame(pid, typ, body):
        # 包长 = 其后全部字节数（id4 + type4 + body + 两个 NUL），不能再 +4
        payload = struct.pack("<ii", pid, typ) + body + b"\x00\x00"
        return struct.pack("<i", len(payload)) + payload

    def read_frame(sock):
        head = b""
        while len(head) < 4:
            chunk = sock.recv(4 - len(head))
            if not chunk:
                return None
            head += chunk
        ln = struct.unpack("<i", head)[0]
        body = b""
        while len(body) < ln:
            chunk = sock.recv(ln - len(body))
            if not chunk:
                break
            body += chunk
        pid, typ = struct.unpack("<ii", body[:8])
        return pid, typ, body[8:].rstrip(b"\x00").decode("utf-8", "replace")

    s = socket.create_connection((HOST, PORT), 8)
    try:
        s.sendall(frame(1, 3, secret.encode()))
        auth = read_frame(s)
        if not auth or auth[0] == -1:
            raise SystemExit("RCON 认证失败（口令不对？）")
        s.sendall(frame(2, 2, cmd.encode()))
        out = read_frame(s)
        return out[2] if out else ""
    finally:
        s.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["list", "grant", "random", "set"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--secret")
    a = ap.parse_args()
    pool = model_pool()

    if a.action == "list":
        print(f"{len(pool)} 个可用模型：")
        for m in pool:
            print("  " + m)
        return
    if not pool:
        sys.exit(f"模型池为空，检查路径：{CFG}")
    sec = read_secret(a.secret)
    if not sec:
        sys.exit("拿不到 RCON 口令：--secret <文件> 或 MC_RCON_SECRET")

    if a.action == "grant":
        for p in a.args:
            print(f"[grant] {p} → {rcon(f'ysm auth {p} all', sec)}")
    elif a.action == "random":
        for p in a.args:
            m = random.choice(pool)
            rcon(f"ysm auth {p} all", sec)
            print(f"[random] {p} → {m} : {rcon(f'ysm model set {p} {quote(m)} default true', sec)}")
    elif a.action == "set":
        if len(a.args) < 2:
            sys.exit("用法: set <玩家> <模型id>")
        print(f"[set] {a.args[0]} → {a.args[1]} : {rcon(f'ysm model set {a.args[0]} {quote(a.args[1])} default true', sec)}")


if __name__ == "__main__":
    main()
