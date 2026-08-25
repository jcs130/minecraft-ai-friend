# -*- coding: utf-8 -*-
"""重启 MC 主服（新家版 2026-08-24：NeoForge 21.1.73 + JDK21，B 仓 mc-server）。

流程：RCON stop 优雅关服 → 等进程退出 → 拉起 start-neoforge.bat → 等 latest.log Done → 重启世界进程。
密码只读自 server.properties，不输出。
"""
import socket, struct, time, os, re, subprocess, sys

WS = r"C:\Users\lzl19\.copaw\workspaces\default"
MC_DIR = os.path.join(WS, "minecraft-ai-friend", "mc-server")
RCON_PORT = 25575
PY = r"C:\Users\lzl19\AppData\Local\Programs\Python\Python311\python.exe"


def _recv_exact(s, n):
    buf = b""
    while len(buf) < n:
        c = s.recv(n - len(buf))
        if not c:
            raise ConnectionError("closed")
        buf += c
    return buf


def rcon_send(s, ptype, body: bytes):
    # length = requestID(4) + type(4) + body + 尾部两字节 0（2026-08-25 修：原实现少算 4 字节，服务器直接掐线）
    s.sendall(struct.pack("<iii", len(body) + 10, 1, ptype) + body + b"\x00\x00")


def rcon_recv(s):
    length = struct.unpack("<i", _recv_exact(s, 4))[0]
    rest = _recv_exact(s, length)
    return rest[8:-2]  # 跳过 requestID(4)+type(4)，去掉尾部两个 0


def rcon(pwd, cmd):
    with socket.create_connection(("127.0.0.1", RCON_PORT), timeout=15) as s:
        rcon_send(s, 3, pwd.encode())
        rcon_recv(s)
        rcon_send(s, 2, cmd.encode())
        return rcon_recv(s).decode("utf-8", errors="replace")


def read_pwd():
    p = os.path.join(MC_DIR, "server.properties")
    for line in open(p, encoding="utf-8", errors="replace"):
        line = line.strip()
        if line.startswith("rcon.password="):
            return line.split("=", 1)[1]
    raise SystemExit("rcon.password not found")


def java_pids():
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { $_.CommandLine -like '*neoforge*' } | Select-Object -ExpandProperty ProcessId"],
        capture_output=True, text=True).stdout.strip()
    return [p for p in out.split() if p.strip()]


def main():
    print("[restart-mc] reading rcon password...")
    pwd = read_pwd()
    before = java_pids()
    print("[restart-mc] java pids before:", before or "NONE")

    if before:
        print("[restart-mc] sending RCON stop (graceful save)...")
        try:
            print("[restart-mc] rcon reply:", rcon(pwd, "stop")[:200])
        except Exception as e:
            print("[restart-mc] rcon stop failed:", e, "falling back to kill")
    else:
        print("[restart-mc] server not running (cold start)")

    # 等旧进程退出（最多 90s）
    for i in range(18):
        left = java_pids()
        if not left:
            print("[restart-mc] old server exited after", i * 5, "s")
            break
        time.sleep(5)
    else:
        print("[restart-mc] WARN: java still running after 90s, force kill")
        for pid in java_pids():
            subprocess.run(["powershell", "-NoProfile", "-Command", f"Stop-Process -Id {pid} -Force"],
                           capture_output=True)
        time.sleep(3)

    # 拉起主服
    DETACHED = 0x00000008 | 0x00000200 | 0x08000000
    subprocess.Popen(["cmd.exe", "/c", "start-neoforge.bat"], cwd=MC_DIR, creationflags=DETACHED, close_fds=True)
    print("[restart-mc] launcher start-neoforge.bat launched (detached)")

    # 等 latest.log 出现 Done
    log = os.path.join(MC_DIR, "logs", "latest.log")
    for i in range(60):  # 最多 10 分钟
        if os.path.exists(log):
            try:
                with open(log, "rb") as f:
                    f.seek(0, os.SEEK_END)
                    f.seek(max(0, f.tell() - 30000))
                    tail = f.read().decode("utf-8", errors="replace")
                if "Done" in tail and "For help" in tail:
                    print("[restart-mc] server Done after ~", i * 10, "s")
                    break
                if "Failed to start" in tail or "fatal" in tail.lower() and "error" in tail.lower():
                    print("[restart-mc] WARN: possible startup error in log tail")
            except Exception:
                pass
        time.sleep(10)
    else:
        print("[restart-mc] WARN: no Done within 10 min; check boot.log")

    print("[restart-mc] java pids after:", java_pids() or "NONE")

    # 重启世界进程（女神 bot 干净连接新主服）
    print("[restart-mc] restarting world process...")
    subprocess.run([PY, "-E", os.path.join(WS, "minecraft-ai-friend", "ops", "restart-world.py")], check=True)
    print("[restart-mc] done")


if __name__ == "__main__":
    main()
