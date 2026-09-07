"""Check installed controller JARs and optional actual client initialization / QA evidence."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def check(require_runtime=False):
    lock = json.loads((ROOT / "manifests/controller-support.lock.json").read_text("utf-8"))
    installed = []
    for row in lock["files"]:
        path = ROOT / "client/mods" / row["filename"]
        installed.append({"file": row["filename"], "ok": path.is_file() and
                          hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]})
    log_path = ROOT / "client/logs/latest.log"
    log = log_path.read_text("utf-8", errors="replace") if log_path.is_file() else ""
    initialized = "[qiandeng-controls] registered F6 wheel, F7 guide" in log
    own_errors = [line[:500] for line in log.splitlines() if "qiandeng" in line.lower()
                  and any(marker in line for marker in ["ERROR", "FATAL", "Exception", "failed"])][:10]
    qa_path = ROOT / "client/qa-controls-result.json"
    qa = json.loads(qa_path.read_text("utf-8")) if qa_path.is_file() else None
    result = {"schema_version": 1, "installed_jars": installed, "client_initialized": initialized,
              "own_log_errors": own_errors, "latest_qa_result": qa, "physical_controller_verified": False,
              "ok": all(row["ok"] for row in installed) and not own_errors and (initialized or not require_runtime),
              "verification_scope": "File hashes and local client log/QA evidence; does not emulate or claim a physical gamepad."}
    (ROOT / "reports/controller-support-health.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", action="store_true", help="Require initialization in the latest actual client log")
    args = parser.parse_args()
    result = check(args.runtime)
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ok"] else 1)
