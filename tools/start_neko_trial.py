"""Own one bounded Neko process; load the user's existing private API key in memory.

No QwenPaw HTTP calls, agent creation, provider modification or model fallback.
Encrypted snapshots use the installed secret-store decryptor only.
"""
from pathlib import Path
import argparse
import json
import os
import subprocess
import time


def stop_owned_process(process):
    """Report actual termination, rather than merely a watchdog stop request."""
    try:
        process.wait(timeout=15)
        return False
    except subprocess.TimeoutExpired:
        process.terminate()
        process.wait(timeout=10)
        return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--credential-file", type=Path, help="Optional existing encrypted credential snapshot; alternatively set MAW_NEKO_CODINGPLAN_API_KEY")
    options = parser.parse_args()
    config = json.loads(options.config.read_text(encoding="utf-8"))
    if not Path(config["stateDirectory"]).is_absolute():
        raise RuntimeError("stateDirectory must be absolute and stable for this account")
    root = Path(config["stateDirectory"]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if (root / "runner.lock").exists():
        raise RuntimeError("Existing runner lock requires review")
    env = os.environ.copy()
    key = env.get("MAW_NEKO_CODINGPLAN_API_KEY")
    if not key and options.credential_file:
        credential = json.loads(options.credential_file.read_text(encoding="utf-8"))
        if credential.get("base_url", "").rstrip("/") != "https://coding.dashscope.aliyuncs.com/v1":
            raise RuntimeError("Expected the user's Coding Plan credential snapshot")
        from qwenpaw.security.secret_store import decrypt
        key = decrypt(credential["api_key"])
    if not key:
        raise RuntimeError("Set MAW_NEKO_CODINGPLAN_API_KEY or provide an existing encrypted credential snapshot")
    model_config = root / "model-config.json"
    if not model_config.exists():
        with model_config.open("x", encoding="utf-8") as stream:
            json.dump({"journalPath": str(root / "model-calls.jsonl"), "maxCalls": config.get("maxModelCalls", 24),
                       "minIntervalMs": 4000}, stream, indent=2)
    env["MAW_NEKO_CODINGPLAN_API_KEY"] = key
    env["NODE_PATH"] = config["nodePath"]
    # Only our stdout/stderr artifacts; never serialize the environment or key.
    with (root / "stdout.log").open("ab", buffering=0) as out, (root / "stderr.log").open("ab", buffering=0) as err:
        process = subprocess.Popen([config["node"], "--max-old-space-size=3072", config["runnerFile"], str(options.config.resolve())],
                                   cwd=root, env=env, stdout=out, stderr=err,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        del key
        del env["MAW_NEKO_CODINGPLAN_API_KEY"]
        (root / "process.json").write_text(json.dumps({"supervisorPid": os.getpid(), "pid": process.pid,
            "startedAt": time.time(), "durationSeconds": config["durationSeconds"], "qwenpawConnected": False}, indent=2), encoding="utf-8")
        print(json.dumps({"pid": process.pid, "stateDirectory": str(root), "qwenpawConnected": False}), flush=True)
        began = time.monotonic()
        stale = expired = forced = False
        while process.poll() is None:
            status = root / "status.json"
            stale = time.monotonic() - began > 120 and (not status.exists() or time.time() - status.stat().st_mtime > 45)
            expired = time.monotonic() - began > config["durationSeconds"] + 115
            if stale or expired:
                (root / "stop.requested").write_text("supervisor: stale heartbeat" if stale else "supervisor: deadline", encoding="utf-8")
                # Owned Popen only; journals/locks remain for reconciliation.
                forced = stop_owned_process(process)
                break
            time.sleep(1)
        (root / "process-exit.json").write_text(json.dumps({"pid": process.pid, "exitCode": process.returncode,
            "at": time.time(), "forced": forced,
            "watchdogReason": "stale_heartbeat" if stale else "deadline" if expired else None}, indent=2), encoding="utf-8")
        print(json.dumps({"pid": process.pid, "exitCode": process.returncode}), flush=True)


if __name__ == "__main__":
    main()
