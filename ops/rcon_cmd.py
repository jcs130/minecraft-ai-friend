# -*- coding: utf-8 -*-
"""rcon_cmd.py — 单发 RCON 命令（密码读自 mc-server/server.properties，不输出）。
用法: python ops/rcon_cmd.py "list"
"""
import socket, struct, sys, os

MC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mc-server")
RCON_PORT = 25575


def rcon_send(s, ptype, body: bytes):
    payload = body + b"\x00\x00"
    # length = requestID(4) + type(4) + body + 两个结尾空字节 = len(payload) + 8
    s.sendall(struct.pack("<ii", len(payload) + 8, 1) + struct.pack("<i", ptype) + payload)


def rcon_recv(s):
    hdr = b""
    while len(hdr) < 12:
        c = s.recv(12 - len(hdr))
        if not c:
            raise ConnectionError("closed")
        hdr += c
    length, _ = struct.unpack("<ii", hdr)
    body = b""
    while len(body) < length - 4:
        c = s.recv(length - 4 - len(body))
        if not c:
            raise ConnectionError("closed")
        body += c
    return body[:-2]


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    pwd = None
    for line in open(os.path.join(MC_DIR, "server.properties"), encoding="utf-8", errors="replace"):
        line = line.strip()
        if line.startswith("rcon.password="):
            pwd = line.split("=", 1)[1]
            break
    if not pwd:
        raise SystemExit("rcon.password not found")
    with socket.create_connection(("127.0.0.1", RCON_PORT), timeout=15) as s:
        rcon_send(s, 3, pwd.encode())
        rcon_recv(s)
        rcon_send(s, 2, cmd.encode())
        print(rcon_recv(s).decode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
