"""Explicitly authorized, isolated Qiandengji RCON socket regression.

Does not log credentials, replay commands or assume a long response is complete.
The only mutation is one unique key in qiandengji:qa_rcon, removed in finally.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import socket
import struct
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
ADDRESS = ("127.0.0.1", 25577)
NAMESPACE = "qiandengji:qa_rcon"


def packet(request_id: int, kind: int, text: str) -> bytes:
    body = struct.pack("<ii", request_id, kind) + text.encode("utf-8") + b"\0\0"
    return struct.pack("<i", len(body)) + body


def exact(sock: socket.socket, count: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < count:
        part = sock.recv(count - len(chunks))
        if not part:
            raise EOFError("Connection closed before the response frame completed")
        chunks.extend(part)
    return bytes(chunks)


def response(sock: socket.socket) -> tuple[int, int, str]:
    length = struct.unpack("<i", exact(sock, 4))[0]
    if not 10 <= length <= 65_536:
        raise ValueError("Response length outside bounded smoke limit")
    body = exact(sock, length)
    if body[-2:] != b"\0\0":
        raise ValueError("Response terminators missing")
    request_id, kind = struct.unpack("<ii", body[:8])
    return request_id, kind, body[8:-2].decode("utf-8")


def connect() -> socket.socket:
    sock = socket.create_connection(ADDRESS, timeout=15)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    return sock


def fragments(sock: socket.socket, data: bytes) -> None:
    offset = 0
    for size in [1, 1, 2, 3, 7] + [137] * (len(data) // 137 + 1):
        if offset >= len(data):
            break
        sock.sendall(data[offset:offset + size])
        offset += size
        time.sleep(0.003)


def authenticate(sock: socket.socket, secret: str, request_id: int = 1) -> None:
    sock.sendall(packet(request_id, 3, secret))
    if response(sock) != (request_id, 2, ""):
        raise AssertionError("Authentication response did not match")


def command(sock: socket.socket, request_id: int, text: str) -> str:
    sock.sendall(packet(request_id, 2, text))
    rid, kind, value = response(sock)
    if (rid, kind) != (request_id, 0):
        raise AssertionError("Command response ID/type mismatch")
    return value


def run() -> dict:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", required=True, choices=["qiandengji"])
    parser.parse_args()
    data = ROOT / "server/world-data"
    if (data / ".qiandengji-smoke").read_text(encoding="utf-8").strip() != "qiandengji":
        raise RuntimeError("Independent project marker is missing")
    record = json.loads((ROOT / "world/botgate-src/build-record.json").read_text(encoding="utf-8"))
    actual = hashlib.sha256((ROOT / "server/mc/mods/botgate.jar").read_bytes()).hexdigest()
    if actual != record["sha256"]:
        raise RuntimeError("The latest built botgate has not been staged in the isolated server")
    secret = (data / "rcon-secret.txt").read_text(encoding="utf-8-sig").strip()
    report = {"project": "qiandengji", "startedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "ok": False, "jarSha256": actual, "checks": [], "cleanup": {}}
    key = "frames_" + uuid.uuid4().hex
    wrote = False

    def check(label: str, **details) -> None:
        report["checks"].append({"name": label, "ok": True, **details})

    try:
        with connect() as sock:
            fragments(sock, packet(11, 3, secret))
            assert response(sock) == (11, 2, "")
            check("fragmented_header_and_auth_body")
            wrong = "qiandengji-deliberately-invalid" + ("!" if secret == "qiandengji-deliberately-invalid" else "")
            sock.sendall(packet(12, 3, wrong))
            assert response(sock) == (-1, 2, "")
            sock.sendall(packet(13, 2, "list"))
            assert response(sock) == (-1, 2, "")
            check("failed_reauthentication_revokes_command_access")

        with connect() as sock:
            sock.sendall(packet(21, 3, secret) + packet(22, 2, "list") + packet(23, 2, "list"))
            assert response(sock) == (21, 2, "")
            assert response(sock)[:2] == (22, 0)
            assert response(sock)[:2] == (23, 0)
            check("three_frames_one_tcp_write_ordered_auth_and_commands")

            text = "千灯纪测试" * 400  # 6 KB UTF-8, deliberately greater than one TCP segment.
            marker = "complete_" + uuid.uuid4().hex
            value = json.dumps({"text": text, "tail_marker": marker}, ensure_ascii=False, separators=(",", ":"))
            text_command = f"data modify storage {NAMESPACE} {key} set value {value}"
            wrote = True  # Ambiguous responses still require cleanup of our unique key.
            fragments(sock, packet(24, 2, text_command))
            rid, kind, feedback = response(sock)
            assert (rid, kind) == (24, 0) and "Modified" in feedback, "Long command did not execute"
            # Marker is at the END of the same SNBT command, proving the parser
            # accepted the complete large payload without requesting a long reply.
            assert marker in command(sock, 25, f"data get storage {NAMESPACE} {key}.tail_marker")
            check("large_unicode_storage_command_executed", commandUtf8Bytes=len(text_command.encode("utf-8")))

        for label, bytes_to_send, eof in [
            ("negative_length", struct.pack("<i", -1), False),
            ("short_length", struct.pack("<i", 9), False),
            ("oversized_length", struct.pack("<i", 65537), False),
            ("overflow_length", struct.pack("<i", 2147483647), False),
            ("truncated_header", b"\x0a\x00", True),
            ("truncated_body", struct.pack("<i", 10) + b"\x01\x00", True),
            ("invalid_terminator", packet(51, 3, "invalid")[:-1] + b"x", False),
        ]:
            with connect() as sock:
                sock.sendall(bytes_to_send)
                if eof:
                    sock.shutdown(socket.SHUT_WR)
                assert sock.recv(1) == b"", "Malformed frame was not rejected"
            check(label + "_connection_closed")
        with connect() as sock:
            start = time.monotonic()
            sock.sendall(b"\x0a")
            assert sock.recv(1) == b""
            elapsed = time.monotonic() - start
            assert 8 <= elapsed <= 14, "Incomplete frame deadline outside expected bounds"
            check("incomplete_frame_deadline", seconds=round(elapsed, 2))
        report["ok"] = True
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}".replace(secret, "[redacted]")[:400]
    finally:
        if wrote:
            try:
                with connect() as sock:
                    authenticate(sock, secret, 90)
                    feedback = command(sock, 91, f"data remove storage {NAMESPACE} {key}")
                    report["cleanup"]["uniqueStorageKeyRemoved"] = "Modified" in feedback
                    if not report["cleanup"]["uniqueStorageKeyRemoved"]:
                        report["ok"] = False
            except Exception as error:
                report["cleanup"]["error"] = str(error).replace(secret, "[redacted]")[:400]
                report["ok"] = False
        report["finishedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    return report


if __name__ == "__main__":
    result = run()
    output = ROOT / "reports/rcon-live-smoke.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["ok"] else 1)
