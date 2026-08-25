# -*- coding: utf-8 -*-
"""临时只读探针：直连 RCON 查鸣人身体现状（位置/HP/任务）。用完即删。"""
import socket, struct

RCON_HOST = "127.0.0.1"
RCON_PORT = 25575
pw_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "mc-data", "rcon-secret.txt")
RCON_PW = open(pw_file).read().strip()

def _recv_exact(s, n):
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf

def cmd(command):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(15)
    try:
        s.connect((RCON_HOST, RCON_PORT))
        p = RCON_PW.encode("utf-8")
        s.send(struct.pack("<iii", len(p) + 10, 1, 3) + p + b"\x00\x00")
        hdr = _recv_exact(s, 12)
        if len(hdr) < 12:
            return "(no auth)"
        alen, _, _ = struct.unpack("<iii", hdr[:12])
        _recv_exact(s, alen - 8)
        cp = command.encode("utf-8")
        s.send(struct.pack("<iii", len(cp) + 10, 2, 2) + cp + b"\x00\x00")
        hdr2 = _recv_exact(s, 12)
        if len(hdr2) < 12:
            return "(no response)"
        length, _, _ = struct.unpack("<iii", hdr2[:12])
        body = _recv_exact(s, length - 8)
        return body.decode("utf-8", errors="replace").rstrip("\x00")
    except Exception as e:
        return f"(error: {e})"
    finally:
        s.close()

print("### get_self_status")
print(cmd('numen_act invoke "Naruto" get_self_status {}'))
print("### task_status")
print(cmd('numen_act invoke "Naruto" task_status {}'))
