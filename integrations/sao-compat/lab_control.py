"""Own one isolated Forge process, retaining its stdin and complete boot log."""
import argparse
import json
from pathlib import Path
import re
import socket
import subprocess
import sys
import threading
import time


def run(root):
    root = Path(root).resolve(strict=True)
    if json.loads((root / "pack-source.json").read_text("utf-8")).get("scope") != "isolated_testing":
        raise ValueError("Only the explicitly prepared isolated pack may be launched")
    server = root / "server"
    properties = (server / "server.properties").read_text("utf-8")
    if not re.search(r"(?m)^server-ip=127\.0\.0\.1$", properties) or not re.search(r"(?m)^server-port=39676$", properties):
        raise ValueError("Lab launch requires the isolated loopback game endpoint")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 39676))
    runtime = json.loads((root / "runtime-lock.json").read_text("utf-8"))
    java = Path(runtime["java"]["java"])
    if not java.is_relative_to(root):
        raise ValueError("Use the lab's private, verified Java runtime")
    logs = root / "launch-logs"
    logs.mkdir(exist_ok=True)
    log = logs / f"forge-{time.time_ns()}.log"
    command = [str(java), "@user_jvm_args.txt", "@libraries/net/minecraftforge/forge/1.20.1-47.4.10/win_args.txt", "nogui"]
    child = subprocess.Popen(command, cwd=server, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    state_path = root / "lab-process.json"
    state = {"scope": "isolated_testing", "pid": child.pid, "owner_pid": __import__("os").getpid(), "port": 39676, "bind": "127.0.0.1", "log": str(log), "started_at": time.time(), "phase": "starting"}
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    print(json.dumps({"event": "lab_started", **state}), flush=True)
    def consume():
        with log.open("x", encoding="utf-8") as output:
            for line in child.stdout:
                output.write(line)
                output.flush()
                if "Done (" in line:
                    state["phase"] = "ready"
                    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
                    print(json.dumps({"event": "lab_ready", "pid": child.pid}), flush=True)
                if re.search(r"\b(?:ERROR|FATAL)\b|Exception in thread|\[maw-sao\]", line):
                    print(line.rstrip(), flush=True)
        child.wait()
        state.update(phase="exited", exit_code=child.returncode)
        state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
        print(json.dumps({"event": "lab_exited", "pid": child.pid, "exit_code": child.returncode}), flush=True)
    reader = threading.Thread(target=consume, daemon=True)
    reader.start()
    try:
        while child.poll() is None:
            line = sys.stdin.readline()
            if not line:
                if child.poll() is None:
                    child.stdin.write("stop\n")
                    child.stdin.flush()
                break
            command = line.strip()
            if command and child.poll() is None:
                child.stdin.write(command + "\n")
                child.stdin.flush()
                print(json.dumps({"event": "console_sent", "goal_verified": False}), flush=True)
        child.wait(timeout=90)
        reader.join(timeout=5)
    except (BrokenPipeError, OSError, KeyboardInterrupt):
        if child.poll() is None:
            child.stdin.write("stop\n")
            child.stdin.flush()
            child.wait(timeout=90)
    return child.returncode


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    raise SystemExit(run(parser.parse_args().root))
