"""Check that a disconnected Drama 3 request leaves the serial queue unused."""

from __future__ import annotations

import argparse
import http.client
import json
from pathlib import Path
import socket
import sys
import time
from urllib.parse import urlsplit

from longform_probe import PROMPTS


def close_socket(connection: http.client.HTTPConnection) -> None:
    if connection.sock:
        try:
            connection.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
    connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://192.168.3.133:18120")
    parser.add_argument("--log", type=Path, default=Path(__file__).resolve().parents[2] /
                        "server" / "drama3-service" / "voice-service.log")
    args = parser.parse_args()
    url = urlsplit(args.base)
    first = http.client.HTTPConnection(url.hostname, url.port, timeout=20)
    queued = http.client.HTTPConnection(url.hostname, url.port, timeout=20)
    queued_seed = int(time.time())

    def payload(seed: int) -> bytes:
        return json.dumps({"model": "drama-3", "voice": "cormy", "input": PROMPTS["long"],
                           "seed": seed, "max_seconds": 30, "top_k": 4097,
                           "response_format": "pcm", "stream_format": "sse"},
                          ensure_ascii=False).encode()

    started = time.monotonic()
    first_id = None
    try:
        first.request("POST", "/v1/audio/speech", payload(20261023),
                      {"Content-Type": "application/json"})
        response = first.getresponse()
        first_id = response.getheader("X-Request-Id")
        while True:
            line = response.readline()
            if not line:
                raise AssertionError("first request ended before audio")
            if b'"speech.audio.delta"' in line:
                break
        queued.request("POST", "/v1/audio/speech", payload(queued_seed),
                       {"Content-Type": "application/json"})
        close_socket(queued)
        time.sleep(0.3)
    finally:
        close_socket(first)
        close_socket(queued)

    first_log = None
    queued_log = None
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        for line in args.log.read_text(encoding="utf-8", errors="replace").splitlines()[-150:]:
            if f"request={first_id}" in line and "stop=cancelled" in line:
                first_log = line
            if f"seed={queued_seed}" in line and "chars=204" in line and "stop=cancelled" in line:
                queued_log = line
        if first_log and queued_log:
            break
        time.sleep(0.1)
    result = {"first_request_id": first_id, "queued_seed": queued_seed,
              "first_log": first_log, "queued_log": queued_log,
              "elapsed_seconds": round(time.monotonic() - started, 3),
              "ok": bool(first_log and queued_log and "samples=0" in queued_log)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
