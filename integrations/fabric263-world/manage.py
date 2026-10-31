"""Manage only the isolated Fabric 26.3 instance prepared by prepare.py.

The authenticated management endpoint and offline game backend are loopback
only. Console submission is acceptance, not proof that a game goal completed.
"""
from __future__ import annotations

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import uuid

from prepare import HERE, digest, expand_arguments, write_json


def settings():
    config = json.loads((HERE / "deployment.local.json").read_text(encoding="utf-8"))
    if digest(HERE / "pack.lock.json") != config["packLockSha256"]:
        raise ValueError("Pack lock changed after preparation")
    return config


def properties(path):
    return dict(line.split("=", 1) for line in path.read_text(encoding="utf-8").splitlines() if "=" in line and not line.startswith("#"))


def validate_server(config):
    server = Path(config["server"])
    if not (server / "fabric263-lab.json").is_file():
        raise ValueError("Missing isolated-server marker")
    props = properties(server / "server.properties")
    if props.get("server-ip") != "127.0.0.1" or props.get("server-port") != str(config["port"]):
        raise ValueError("Game endpoint differs from isolated deployment")
    if props.get("enable-rcon") != "false":
        raise ValueError("RCON must remain disabled")
    if properties(server / "eula.txt").get("eula") != "true":
        raise ValueError("Minecraft EULA is not accepted")
    lock = json.loads((HERE / "pack.lock.json").read_text(encoding="utf-8"))
    expected = {e["filename"]: e for e in lock["mods"] + lock["external"] if "server" in e["sides"]}
    for component in config.get("localComponents", []):
        if "server" in component["sides"]:
            expected[component["filename"]] = {"hashes": {"sha256": component["sha256"]}}
    actual = {p.name: p for p in (server / "mods").glob("*.jar")}
    if set(actual) != set(expected):
        raise ValueError("Server mod set differs from lock")
    for name, entry in expected.items():
        for algorithm, value in entry["hashes"].items():
            if digest(actual[name], algorithm) != value:
                raise ValueError("Server mod hash mismatch: " + name)


def port_free(port):
    with socket.socket() as s:
        s.bind(("127.0.0.1", port))


def control(config, path, data=None):
    auth = json.loads((Path(config["cache"]) / "control.local.json").read_text(encoding="utf-8"))
    req = urllib.request.Request(f"http://127.0.0.1:{config['controlPort']}/{path}",
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Authorization": "Bearer " + auth["token"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.load(response)


def supervise(config):
    validate_server(config)
    port_free(config["port"])
    port_free(config["controlPort"])
    state = {"game": "26.3", "status": "starting", "ready": False, "pid": None, "startedAt": time.time()}
    auth = {"token": secrets.token_urlsafe(36), "supervisorPid": os.getpid()}
    cache = Path(config["cache"])
    write_json(cache / "control.local.json", auth)
    command = [config["java"], "-Xms1G", "-Xmx4G", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-jar", "fabric-server-launch.jar", "--nogui"]
    child = subprocess.Popen(command, cwd=config["server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    state["pid"] = child.pid
    write_json(cache / "server-process.local.json", state)
    write_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, code, body):
            raw = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def authorized(self):
            return secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + auth["token"])

        def do_GET(self):
            if not self.authorized():
                return self.reply(401, {"status": "denied"})
            if self.path != "/status":
                return self.reply(404, {"status": "not_found"})
            self.reply(200, {**state, "running": child.poll() is None, "loopbackOnly": True})

        def do_POST(self):
            if not self.authorized():
                return self.reply(401, {"status": "denied"})
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0 or size > 4096:
                return self.reply(413, {"status": "rejected", "reason": "body_limit"})
            if self.path == "/stop":
                cmd = "stop"
                state["status"] = "stopping"
            elif self.path == "/console":
                try:
                    data = json.loads(self.rfile.read(size))
                    cmd = data["command"]
                    if not isinstance(cmd, str) or not cmd.strip() or any(c in cmd for c in ("\r", "\n", "\0")) or len(cmd) > 2048:
                        raise ValueError("single nonempty command required")
                except (ValueError, KeyError, TypeError):
                    return self.reply(400, {"status": "invalid", "reason": "single_command_required"})
            else:
                return self.reply(404, {"status": "not_found"})
            if child.poll() is not None:
                return self.reply(409, {"status": "offline"})
            with write_lock:
                child.stdin.write(cmd + "\n")
                child.stdin.flush()
            self.reply(202, {"status": "accepted", "goalVerified": False})

    http = ThreadingHTTPServer(("127.0.0.1", config["controlPort"]), Handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        with (cache / "server-console.log").open("a", encoding="utf-8") as log:
            for line in child.stdout:
                log.write(line)
                log.flush()
                if "Done (" in line:
                    state.update(status="ready", ready=True)
                    write_json(cache / "server-process.local.json", state)
    finally:
        code = child.wait()
        state.update(status="stopped" if code == 0 and state["ready"] else "failed", ready=False, exitCode=code, stoppedAt=time.time())
        write_json(cache / "server-process.local.json", state)
        http.shutdown()
        http.server_close()
    return code


def launch_client(config, username):
    if not re.fullmatch(r"[A-Za-z0-9_]{3,16}", username):
        raise ValueError("Username must be 3-16 ASCII characters")
    cache = Path(config["cache"])
    old = cache / "client-process.local.json"
    if old.exists():
        data = json.loads(old.read_text())
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.windll.kernel32
            kernel.OpenProcess.restype = wintypes.HANDLE
            kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
            kernel.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
            kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
            handle = kernel.OpenProcess(0x1000, False, data["pid"])
            if handle:
                code = wintypes.DWORD()
                active = kernel.GetExitCodeProcess(handle, ctypes.byref(code)) and code.value == 259
                kernel.CloseHandle(handle)
                if active:
                    raise ValueError("The recorded client is still running; do not start a second controller")
    meta = config["clientMetadata"]
    base = json.loads(Path(meta["base"]).read_text())
    profile = json.loads(Path(meta["profile"]).read_text())
    raw = bytearray(hashlib.md5(("OfflinePlayer:" + username).encode()).digest())
    raw[6] = (raw[6] & 15) | 48
    raw[8] = (raw[8] & 63) | 128
    player_uuid = uuid.UUID(bytes=bytes(raw)).hex
    replacements = {
        "auth_player_name": username, "auth_uuid": player_uuid, "auth_access_token": "0", "clientid": "", "auth_xuid": "",
        "version_name": "MyAgentWorld-Fabric26.3-Lab", "game_directory": config["client"], "assets_root": meta["assets"],
        "assets_index_name": meta["assetIndex"], "user_type": "legacy", "version_type": "release",
        "natives_directory": meta["natives"], "launcher_name": "MyAgentWorld-Lab", "launcher_version": "0.1.0",
        "classpath": os.pathsep.join(meta["classpath"]), "classpath_separator": os.pathsep,
        "library_directory": str(cache / "libraries"), "primary_jar_name": "minecraft-26.3-client.jar",
        "resolution_width": "960", "resolution_height": "540", "quickPlayPath": str(cache / "quickplay.json"),
        "quickPlayMultiplayer": f"127.0.0.1:{config['port']}",
    }
    features = {"has_quick_plays_support": True, "is_quick_play_multiplayer": True, "has_custom_resolution": True}
    args = ["-Xms512M", "-Xmx4G", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8"]
    args += expand_arguments(base["arguments"].get("jvm", []), replacements, features)
    args += expand_arguments(profile.get("arguments", {}).get("jvm", []), replacements, features)
    args += [profile["mainClass"]]
    args += expand_arguments(base["arguments"]["game"], replacements, features)
    args += expand_arguments(profile.get("arguments", {}).get("game", []), replacements, features)
    if "--quickPlayMultiplayer" not in args:
        args += ["--quickPlayMultiplayer", replacements["quickPlayMultiplayer"]]
    argfile = cache / "client-args.txt"
    argfile.write_text("\n".join('"' + a.replace("\\", "\\\\").replace('"', '\\"') + '"' for a in args), encoding="utf-8")
    with (cache / "client-console.log").open("ab") as log:
        child = subprocess.Popen([config["java"], "@" + str(argfile)], cwd=config["client"], stdout=log, stderr=subprocess.STDOUT,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    result = {"pid": child.pid, "username": username, "uuid": player_uuid, "server": replacements["quickPlayMultiplayer"], "startedAt": time.time()}
    write_json(old, result)
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=["start", "supervise", "status", "stop", "console", "client"])
    ap.add_argument("--command")
    ap.add_argument("--username", default="GraalScout")
    args = ap.parse_args()
    config = settings()
    if args.action == "supervise":
        return supervise(config)
    if args.action == "start":
        try:
            print(json.dumps(control(config, "status")))
            return
        except (OSError, KeyError, ValueError):
            pass
        validate_server(config)
        port_free(config["port"])
        port_free(config["controlPort"])
        with (Path(config["cache"]) / "supervisor.log").open("ab") as log:
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "supervise"], cwd=HERE,
                                     stdout=log, stderr=subprocess.STDOUT,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        print(json.dumps({"status": "starting", "supervisorPid": child.pid}))
    elif args.action == "status":
        try:
            print(json.dumps(control(config, "status")))
        except OSError:
            path = Path(config["cache"]) / "server-process.local.json"
            print(json.dumps({"reachable": False, "lastRecorded": json.loads(path.read_text()) if path.exists() else None}))
    elif args.action == "client":
        print(json.dumps(launch_client(config, args.username)))
    else:
        if args.action == "console" and not args.command:
            ap.error("console requires --command")
        print(json.dumps(control(config, "stop" if args.action == "stop" else "console", {} if args.action == "stop" else {"command": args.command})))


if __name__ == "__main__":
    sys.exit(main())
