# -*- coding: utf-8 -*-
"""rcon-shadow.py — shadow 栈单发 RCON（读 mc/server.properties 密码，不输出密码）。

用法：python scripts\\rcon-shadow.py "list"
"""
import socket, struct, sys, os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # scripts/ 的上一级 = 仓根
MC_DIR = os.path.join(REPO, "ops", "docker", "shadow", "mc")
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
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    pwd = None
    for line in open(os.path.join(MC_DIR, "server.properties"), encoding="utf-8", errors="replace"):
        if line.strip().startswith("rcon.password="):
            pwd = line.strip().split("=", 1)[1]
            break
    if not pwd:
        raise SystemExit("rcon.password not found")
    with socket.create_connection(("127.0.0.1", RCON_PORT), timeout=15) as s:
        rcon_send(s, 3, pwd.encode())
        rcon_recv(s)
        rcon_send(s, 2, cmd.encode())
        out = rcon_recv(s).decode("utf-8", errors="replace")
        print(out if out.strip() else "(empty)")


if __name__ == "__main__":
    main()
