# -*- coding: utf-8 -*-
"""fix-villager-names.py — 按 data/village/villagers.json 重设全部故事村民名牌并回读验证。  背景（2026-08-27）：villagernames-1.21.1-8.5.jar 会给「无名牌」的村民自动起英文名； 当年 summon 时 13/16 村民名牌没设上，被 mod 抢先命名（Deneen/Granville/...）。 修复 = CustomName 设为 JSON 字符串（1.21.1 实测格式，SNBT 复合体会被拒）， mod 不覆盖已有名牌，故一次修复即持久。新增/重召村民后若发现英文名，重跑本脚本。  用法：python scripts\\fix-villager-names.py   （退出码 0=全部 OK） """
import json, socket, struct, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # scripts/ 的上一级 = 仓根
MC_DIR = os.path.join(REPO, "ops", "docker", "shadow", "mc")
VJ = os.path.join(REPO, "ops", "docker", "shadow", "data", "village", "villagers.json")
RCON_PORT = 25575


def read_exact(s, n):
    buf = b""
    while len(buf) < n:
        c = s.recv(n - len(buf))
        if not c:
            raise ConnectionError("closed")
        buf += c
    return buf


def rcon_send(s, ptype, body: bytes):
    payload = body + b"\x00\x00"
    s.sendall(struct.pack("<ii", len(payload) + 8, 1) + struct.pack("<i", ptype) + payload)


def rcon_recv(s):
    length, rid, ptype = struct.unpack("<iii", read_exact(s, 12))
    return read_exact(s, max(0, length - 8))[:-2]


def main():
    pwd = None
    for line in open(os.path.join(MC_DIR, "server.properties"), encoding="utf-8", errors="replace"):
        if line.strip().startswith("rcon.password="):
            pwd = line.strip().split("=", 1)[1]
            break
    vlist = json.load(open(VJ, encoding="utf-8"))["villagers"]
    ok = fail = 0
    with socket.create_connection(("127.0.0.1", RCON_PORT), timeout=15) as s:
        rcon_send(s, 3, pwd.encode())
        rcon_recv(s)
        for v in vlist:
            tag, disp, color = v["tag"], v["display"], v.get("color", "white")
            # 1.21.1 实测：CustomName 存的是 JSON 字符串（对照正确样本 '{"text":..,"color":..}'）
            js = '{"text":"%s","color":"%s"}' % (disp, color)
            cmds = (
                'data modify entity @e[tag=%s,limit=1] CustomName set value \'%s\'' % (tag, js),
                'data modify entity @e[tag=%s,limit=1] CustomNameVisible set value 1b' % tag,
            )
            for cmd in cmds:
                rcon_send(s, 2, cmd.encode())
                resp = rcon_recv(s).decode("utf-8", errors="replace")
                if resp and "modified" not in resp and "Modified" not in resp:
                    print("  [modify resp] " + resp[:120])
            # 回读验证
            rcon_send(s, 2, ("data get entity @e[tag=%s,limit=1] CustomName" % tag).encode())
            out = rcon_recv(s).decode("utf-8", errors="replace")
            good = disp in out
            print(("OK  " if good else "FAIL") + " " + tag + " => " + out[:110])
            ok += good
            fail += (not good)
    print("== %d ok / %d fail ==" % (ok, fail))
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()

