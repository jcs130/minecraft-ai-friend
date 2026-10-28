"""Verify an abandoned long SSE request stops inside the native model."""

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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://192.168.3.133:18120")
    parser.add_argument("--log", type=Path, default=Path(__file__).resolve().parents[2] /
                        "server" / "drama3-service" / "voice-service.log")
    args = parser.parse_args()
    url = urlsplit(args.base)
    payload = {"model": "drama-3", "voice": "cormy", "input": PROMPTS["long"],
               "seed": 20261022, "max_seconds": 30, "top_k": 4097,
               "response_format": "pcm", "stream_format": "sse"}
    connection = http.client.HTTPConnection(url.hostname, url.port, timeout=60)
    started = time.monotonic()
    connection.request("POST", "/v1/audio/speech", json.dumps(payload, ensure_ascii=False).encode(),
                       {"Content-Type": "application/json"})
    response = connection.getresponse()
    request_id = response.getheader("X-Request-Id")
    first_audio = None
    while True:
        line = response.readline()
        if not line:
            break
        if b'"speech.audio.delta"' in line:
            first_audio = round(time.monotonic() - started, 3)
            break
    if connection.sock:
        try:
            connection.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
    connection.close()
    outcome = None
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        for line in args.log.read_text(encoding="utf-8", errors="replace").splitlines()[-100:]:
            if f"request={request_id}" in line and ("stop=cancelled" in line or "failed after" in line):
                outcome = line
                break
        if outcome:
            break
        time.sleep(0.1)
    result = {"request_id": request_id, "first_audio_seconds": first_audio,
              "cancel_observed_seconds": round(time.monotonic() - started, 3),
              "log": outcome, "ok": bool(request_id and first_audio is not None and
                                         outcome and "stop=cancelled" in outcome)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
