"""Narrow, auditable Paper management tools for QwenPaw mc_godness.

Run only as a stdio MCP server on the local host. No generic RCON/shell tool is exposed.
"""

from __future__ import annotations

import json
import re
import socket
import struct
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP


ROOT = Path(r"E:\MC\ops")
NODE = Path(r"C:\Users\lzl19\AppData\Local\hermes\node\node.exe")
RCON = Path(r"E:\MC\probe\rcon.mjs")
PROPERTIES = Path(r"E:\MC\server\server.properties")
STATUS = Path(r"E:\MC\mcstatus.mjs")
AUDIT = ROOT / "goddess-admin-audit.jsonl"
PLAYER = re.compile(r"[A-Za-z0-9_.-]{1,32}\Z")
mcp = FastMCP("afu-goddess-server")


def _record(action: str, args: dict, result: str) -> None:
    event = {
        "at": datetime.now(timezone.utc).isoformat(),
        "actor": "qwenpaw:mc_godness",
        "action": action,
        "args": args,
        "result": result[:500],
    }
    with AUDIT.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, ensure_ascii=False) + "\n")


def _run(script: Path, *args: str) -> str:
    completed = subprocess.run(
        [str(NODE), str(script), *args],
        cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
        timeout=20, check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"server command failed ({completed.returncode}): {completed.stderr[:300]}")
    return completed.stdout.strip()


def _rcon(command: str) -> str:
    if "\n" in command or "\r" in command or "\x00" in command:
        raise ValueError("invalid RCON command framing")
    match = re.search(r"(?m)^rcon\.password=(.+)$", PROPERTIES.read_text(encoding="utf-8"))
    if not match:
        raise RuntimeError("local RCON credential is unavailable")
    password = match.group(1).strip()

    def packet(request_id: int, kind: int, body: str) -> bytes:
        data = body.encode("utf-8")
        return struct.pack("<iii", len(data) + 10, request_id, kind) + data + b"\0\0"

    def read_exact(sock: socket.socket, size: int) -> bytes:
        chunks = []
        while size:
            chunk = sock.recv(size)
            if not chunk:
                raise RuntimeError("RCON connection closed before reply")
            chunks.append(chunk)
            size -= len(chunk)
        return b"".join(chunks)

    def read_packet(sock: socket.socket) -> tuple[int, int, str]:
        size = struct.unpack("<i", read_exact(sock, 4))[0]
        if not 10 <= size <= 65536:
            raise RuntimeError("invalid RCON packet length")
        data = read_exact(sock, size)
        request_id, kind = struct.unpack("<ii", data[:8])
        return request_id, kind, data[8:-2].decode("utf-8", errors="replace")

    with socket.create_connection(("127.0.0.1", 25575), timeout=6) as sock:
        sock.settimeout(6)
        sock.sendall(packet(901, 3, password))
        for _ in range(3):
            request_id, kind, _ = read_packet(sock)
            if request_id == -1:
                raise RuntimeError("RCON authentication rejected")
            if request_id == 901 and kind == 2:
                break
        else:
            raise RuntimeError("RCON authentication reply missing")
        sock.sendall(packet(902, 2, command))
        for _ in range(4):
            request_id, kind, body = read_packet(sock)
            if request_id == 902 and kind == 0:
                return body or "(RCON accepted command with empty text reply)"
        raise RuntimeError("RCON command reply missing")


@mcp.tool()
def server_status() -> str:
    """Read Paper version, current player count, and online names; changes nothing."""
    status = _run(STATUS, "127.0.0.1", "25565", "766")
    players = _rcon("minecraft:list")
    return status + "\n" + players


@mcp.tool()
def announce(message: str) -> str:
    """Send a short, family-friendly Goddess notice to all online players."""
    clean = " ".join(message.split()).replace("§", "")
    if not 1 <= len(clean) <= 100 or any(ord(ch) < 32 for ch in clean):
        raise ValueError("message must be 1–100 printable characters")
    payload = json.dumps({"text": "[女神] " + clean, "color": "light_purple"}, ensure_ascii=False)
    reply = _rcon("minecraft:tellraw @a " + payload)
    _record("announce", {"length": len(clean)}, reply)
    return "公告命令已提交；服务器回执：" + reply


@mcp.tool()
def set_time(period: str) -> str:
    """Set overworld time to day or sunset for a family activity."""
    if period not in ("day", "sunset"):
        raise ValueError("period must be day or sunset")
    reply = _rcon("minecraft:time set " + period)
    _record("set_time", {"period": period}, reply)
    return reply


@mcp.tool()
def set_weather(weather: str) -> str:
    """Set clear or rain weather. Thunder is intentionally unavailable."""
    if weather not in ("clear", "rain"):
        raise ValueError("weather must be clear or rain")
    reply = _rcon("minecraft:weather " + weather)
    _record("set_weather", {"weather": weather}, reply)
    return reply


@mcp.tool()
def teach_skill(player: str, skill: str) -> str:
    """Teach an online player only the Goddess feather or night skill; no arbitrary items/commands."""
    if not PLAYER.fullmatch(player):
        raise ValueError("invalid exact online player name")
    if skill not in ("feather", "night"):
        raise ValueError("skill must be feather or night")
    reply = _rcon(f"mycli admin teach {player} {skill}")
    _record("teach_skill", {"player": player, "skill": skill}, reply)
    return reply


if __name__ == "__main__":
    mcp.run(transport="stdio")
