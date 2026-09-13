"""Capture the authorized source, checking its state before any RCON command.

A stopped Minecraft container needs no save-off. Runtime SQLite files use the
snapshot tool's online backup; this is not an atomic snapshot of every service.
"""
from pathlib import Path
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def source_state():
    result = subprocess.run(["docker", "inspect", "--format", "{{json .State}}", "shadow-mc"],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
    if result.returncode:
        raise RuntimeError("Cannot verify source container state; capture refused")
    state = json.loads(result.stdout)
    if state.get("Paused") or state.get("Restarting") or state.get("Dead"):
        raise RuntimeError("Source is paused, restarting or dead; capture refused")
    if state.get("Status") == "running" and state.get("Running") is True:
        return "running"
    if state.get("Status") in {"exited", "created"} and state.get("Running") is False:
        return "stopped"
    raise RuntimeError("Source container state is not stable; capture refused")


def rcon(command):
    result = subprocess.run(["docker", "exec", "shadow-mc", "rcon-cli", command],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
    if result.returncode:
        raise RuntimeError("Source RCON command failed: " + command)
    return result.stdout


def main():
    target = ROOT / "server-import"
    if target.exists():
        raise RuntimeError("Snapshot destination already exists; no files were changed")
    initial_state = source_state()
    save_disabled = False
    try:
        if initial_state == "running":
            # A timed-out client can still have delivered the command.
            save_disabled = True
            reply = rcon("save-off")
            if "disabled" not in reply.lower():
                raise RuntimeError("Source did not confirm disabling autosave")
            reply = rcon("save-all flush")
            if "saved" not in reply.lower():
                raise RuntimeError("Source did not confirm a completed save flush")
            print("Source flushed. Copying an independent save snapshot.", flush=True)
        else:
            print("Source Minecraft is stopped. Copying without RCON or source state changes.", flush=True)
        result = subprocess.run([sys.executable, str(ROOT / "tools/server_snapshot.py"),
                                 "--target", str(target), "--source-quiesced"], cwd=ROOT)
        if result.returncode:
            raise RuntimeError("Snapshot did not complete")
        if initial_state == "stopped" and source_state() != "stopped":
            raise RuntimeError("Source started during capture; do not use this snapshot")
    finally:
        if save_disabled:
            reply = rcon("save-on")
            if "enabled" not in reply.lower():
                raise RuntimeError("Verify source autosave: save-on was not confirmed")
            print("Source autosave restored.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
