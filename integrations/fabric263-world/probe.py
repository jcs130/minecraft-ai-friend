"""Local GraalWeave protocol consumer with conservative request reconciliation.

Each execute request needs a caller-supplied ID. A recorded ID is never sent
again, including after an uncertain disconnect. Python completion is reported
separately from the caller's game-goal verification.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import sys
import time
import uuid

from prepare import HERE, write_json


def execute(config, source, request_id, session="lab", timeout=120):
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", request_id):
        raise ValueError("request_id must be 1-100 ASCII letters/digits/_.-")
    if len(source.encode("utf-8")) > 65536:
        raise ValueError("Source exceeds 64 KiB")
    cache = Path(config["cache"])
    receipt_path = cache / "requests" / (request_id + ".json")
    signature = hashlib.sha256(json.dumps({"code": source, "session": session}, sort_keys=True).encode()).hexdigest()
    if receipt_path.exists():
        old = json.loads(receipt_path.read_text(encoding="utf-8"))
        if old["sourceSha256"] != signature:
            raise ValueError("request_id already belongs to a different operation")
        return {**old, "replayed": False, "deduplicated": True}
    connection = json.loads((Path(config["client"]) / "graalweave" / "connection.json").read_text(encoding="utf-8"))
    if connection["host"] != "127.0.0.1" or Path(connection["instance"]).resolve() != Path(config["client"]).resolve():
        raise ValueError("GraalWeave connection is not the selected local instance")
    if connection.get("protocol") != 1:
        raise ValueError("Unknown GraalWeave protocol")
    receipt = {"requestId": request_id, "sourceSha256": signature, "session": session, "status": "unknown",
               "goalVerified": False, "sentAt": None, "observedAt": time.time(), "frames": []}
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents two local consumers submitting the same ID.
    with receipt_path.open("x", encoding="utf-8") as f:
        json.dump(receipt, f)
    request = {"id": request_id, "op": "execute", "session": session, "mode": "code", "code": source,
               "cwd": str(Path(config["client"]) / "graalweave" / "workspace")}
    try:
        with socket.create_connection(("127.0.0.1", connection["port"]), timeout=5) as sock:
            sock.settimeout(timeout)
            receipt["sentAt"] = time.time()
            write_json(receipt_path, receipt)
            sock.sendall(json.dumps(request).encode() + b"\n")
            reader = sock.makefile("rb")
            total = 0
            while True:
                line = reader.readline(1024 * 1024 + 1)
                if not line:
                    raise ConnectionError("Connection ended before terminal result")
                total += len(line)
                if len(line) > 1024 * 1024 or total > 4 * 1024 * 1024:
                    raise ValueError("Output budget exceeded; result remains unknown")
                frame = json.loads(line)
                receipt["frames"].append(frame)
                if frame.get("type") in ("done", "error") and frame.get("id") == request_id:
                    receipt["status"] = frame.get("status", "error")
                    receipt["completedAt"] = time.time()
                    break
    except (OSError, ValueError) as error:
        receipt["reason"] = str(error)
    receipt["observedAt"] = time.time()
    write_json(receipt_path, receipt)
    return receipt


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--code-file", type=Path)
    ap.add_argument("--request-id")
    ap.add_argument("--session", default="lab")
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()
    config = json.loads((HERE / "deployment.local.json").read_text())
    if args.status:
        c = json.loads((Path(config["client"]) / "graalweave" / "connection.json").read_text())
        if c["host"] != "127.0.0.1":
            raise ValueError("Non-local endpoint refused")
        with socket.create_connection((c["host"], c["port"]), timeout=5) as sock:
            sock.sendall(json.dumps({"op": "status", "id": str(uuid.uuid4())}).encode() + b"\n")
            print(sock.makefile("r", encoding="utf-8").readline().strip())
        return
    if not args.code_file or not args.request_id:
        ap.error("execute requires --code-file and --request-id")
    receipt = execute(config, args.code_file.read_text(encoding="utf-8-sig"), args.request_id, args.session, args.timeout)
    print(json.dumps(receipt, ensure_ascii=False))
    raise SystemExit(0 if receipt["status"] == "ok" else 1)


if __name__ == "__main__":
    main()
