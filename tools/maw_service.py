"""Own and supervise the isolated My Agent World processes (stdlib only).

All mutations require a local CLI/mailbox. HTTP is read-only and loopback-only.
This tool never adopts/kills a PID discovered by name, directory, or TCP port.
Install/register/start are deliberately separate operator actions.
"""
from __future__ import annotations

import argparse
import ctypes
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import uuid

REPO = Path(__file__).resolve().parents[1]
ROOT = Path(r"E:\QiandengJiSocietyLab")
DEFAULT_JAVA = Path(r"E:\MC\jdk\jdk-21.0.12.1+1\bin\java.exe")
ROLES = ("java", "gate", "worker")
PORTS = {28976: (28977, 28984, 28985), 28978: (28979, 28986, 28987)}
REQUEST_ID = re.compile(r"[a-zA-Z0-9._-]{1,64}\Z")
CONSOLE_COMMANDS = frozenset(("list", "save-all", "say", "time", "weather", "difficulty",
    "gamerule", "whitelist", "op", "deop", "tp", "teleport", "give", "effect", "item",
    "execute", "data", "setblock", "fill", "maw_agent", "mycli", "locate", "setworldspawn", "spawnpoint"))


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path: Path, limit: int = 65536) -> dict:
    if path.stat().st_size > limit:
        raise ValueError(f"JSON file exceeds {limit} bytes: {path.name}")
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError("Expected JSON object")
    return value


def contained(path: Path, roots: tuple[Path, ...]) -> bool:
    path = path.resolve()
    return any(path == root or root in path.parents for root in roots)


def properties(path: Path) -> dict[str, str]:
    result = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "!")):
            continue
        match = re.fullmatch(r"([^\s=:]+)(?:[ \t\f]*[=:][ \t\f]*|[ \t\f]+)(.*)", line)
        if match:
            result[match[1]] = match[2].strip()
    return result


def check_server(server: Path, expected_port: int | None = None) -> int:
    value = properties(server / "server.properties")
    if value.get("server-ip") != "127.0.0.1":
        raise ValueError("New server must explicitly bind server-ip=127.0.0.1")
    port = value.get("server-port", "")
    if not re.fullmatch(r"[0-9]+", port) or int(port) not in PORTS:
        raise ValueError("Only isolated game ports 28976 or 28978 are managed")
    if expected_port is not None and int(port) != expected_port:
        raise ValueError("server-port changed; supervisor will not retarget another port")
    if value.get("enable-rcon", "false").lower() != "false":
        raise ValueError("This supervisor uses owned stdin; RCON must remain disabled")
    if properties(server / "eula.txt").get("eula", "").lower() != "true":
        raise ValueError("Existing server EULA acceptance is required")
    return int(port)


def load_config(path: Path, *, expected_root: Path = ROOT, expected_repo: Path = REPO) -> dict:
    raw = read_json(path)
    root, repo = expected_root.resolve(), expected_repo.resolve()
    server = Path(raw.get("serverDir", "")).resolve()
    if server not in (root / "server", root / "research" / "registry-server"):
        raise ValueError("serverDir must be the new server or its explicit registry-server copy")
    game_port = check_server(server)
    gate_port, worker_port, health_port = PORTS[game_port]
    if raw.get("schemaVersion") != 1 or raw.get("healthPort") != health_port:
        raise ValueError(f"Expected schemaVersion 1 and isolated healthPort {health_port}")
    rows = raw.get("services")
    if not isinstance(rows, list) or [row.get("id") for row in rows] != list(ROLES):
        raise ValueError("services must be ordered java, gate, worker")
    services = []
    for row, port, dependencies in zip(rows, (game_port, gate_port, worker_port), ([], ["java"], ["gate"])):
        command, env = row.get("command"), row.get("env", {})
        cwd = Path(row.get("cwd", "")).resolve()
        if not cwd.is_dir() or not contained(cwd, (root, repo)):
            raise ValueError("Service cwd must stay in the new runtime/worktree")
        if row["id"] == "java" and cwd != server:
            raise ValueError("Java cwd must equal the selected new server")
        if (not isinstance(command, list) or len(command) < 2
                or any(not isinstance(part, str) or not part or "\0" in part or "\n" in part or "\r" in part for part in command)):
            raise ValueError("command must be literal executable/argument strings, without shell syntax")
        executable = Path(command[0])
        names = ("java", "java.exe") if row["id"] == "java" else ("node", "node.exe")
        if not executable.is_absolute() or executable.name.lower() not in names or not executable.is_file():
            raise ValueError("Expected an existing absolute Java/Node executable")
        if (not isinstance(env, dict) or any(not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", key)
                or not isinstance(value, str) or "\0" in value for key, value in env.items())):
            raise ValueError("env must contain valid string environment entries")
        if row.get("host", "127.0.0.1") != "127.0.0.1" or row.get("port") != port:
            raise ValueError(f"{row['id']} must use isolated loopback port {port}")
        if row.get("dependsOn", dependencies) != dependencies:
            raise ValueError("Dependencies must remain java -> gate -> worker")
        readiness = ("minecraft", "tcp", "http")[ROLES.index(row["id"])]
        if row.get("readiness", readiness) != readiness:
            raise ValueError("Readiness must use real Minecraft/TCP/worker HTTP respectively")
        health_url = f"http://127.0.0.1:{port}/healthz" if readiness == "http" else None
        if row.get("healthUrl", health_url) != health_url:
            raise ValueError("Worker health URL must be its fixed loopback /healthz")
        stop_mode = row.get("stopMode", "stdin")
        stop_text = row.get("stopText", "stop" if row["id"] == "java" else '{"kind":"shutdown"}')
        if stop_mode not in ("stdin", "break") or not isinstance(stop_text, str) or any(c in stop_text for c in "\r\n\0"):
            raise ValueError("stopMode must be stdin/break with one literal stopText line")
        if row["id"] == "java" and (stop_mode != "stdin" or stop_text != "stop"):
            raise ValueError("Java shutdown is always its own stdin stop command")
        startup = row.get("startupTimeoutSeconds", 180 if row["id"] == "java" else 60)
        if not isinstance(startup, (int, float)) or not 10 <= startup <= 600:
            raise ValueError("startupTimeoutSeconds must be 10..600")
        services.append({**row, "command": command, "cwd": str(cwd), "env": env,
            "port": port, "dependsOn": dependencies, "readiness": readiness,
            "healthUrl": health_url, "stopMode": stop_mode, "stopText": stop_text,
            "startupTimeoutSeconds": startup})
    return {"schemaVersion": 1, "serverDir": str(server), "gamePort": game_port,
        "healthPort": health_port, "services": services,
        "runtimeDir": str(server / "ops" / "maw-service")}


def fingerprint(request: dict) -> str:
    payload = {key: value for key, value in request.items() if key not in ("requestId", "createdAtEpoch")}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def guard_console(command: object) -> str:
    if not isinstance(command, str) or not command.strip() or len(command) > 2048 or any(c in command for c in "\r\n\0"):
        raise ValueError("Console requires one bounded command line")
    command = command.strip().lstrip("/")
    if command.split()[0] not in CONSOLE_COMMANDS:
        raise ValueError("Console command not allowed; use dedicated stop/shutdown controls")
    return command


def reserve_port(port: int) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        probe.bind(("0.0.0.0", port))


def varint(value: int) -> bytes:
    result = bytearray()
    while True:
        part, value = value & 127, value >> 7
        result.append(part | (128 if value else 0))
        if not value:
            return bytes(result)


def read_exact(connection: socket.socket, length: int) -> bytes:
    result = bytearray()
    while len(result) < length:
        part = connection.recv(length - len(result))
        if not part:
            raise EOFError("Status connection closed")
        result.extend(part)
    return bytes(result)


def read_varint(connection: socket.socket) -> int:
    value = 0
    for shift in range(0, 35, 7):
        part = read_exact(connection, 1)[0]
        value |= (part & 127) << shift
        if part < 128:
            return value
    raise ValueError("Status VarInt too long")


def packet(connection: socket.socket) -> bytes:
    length = read_varint(connection)
    if not 1 <= length <= 65536:
        raise ValueError("Status packet length invalid")
    return read_exact(connection, length)


def minecraft_probe(port: int) -> dict:
    started = time.monotonic()
    with socket.create_connection(("127.0.0.1", port), timeout=1.5) as connection:
        host = b"127.0.0.1"
        handshake = b"\0" + varint(767) + varint(len(host)) + host + struct.pack(">H", port) + b"\1"
        connection.sendall(varint(len(handshake)) + handshake + b"\1\0")
        response = packet(connection)
        if response[0] != 0:
            raise ValueError("Unexpected status packet")
        # Decode the JSON's VarInt length within the bounded response.
        offset, length = 1, 0
        for shift in range(0, 35, 7):
            part = response[offset]
            offset += 1
            length |= (part & 127) << shift
            if part < 128:
                break
        else:
            raise ValueError("Status string VarInt invalid")
        if offset + length != len(response):
            raise ValueError("Status string length invalid")
        value = json.loads(response[offset:].decode("utf-8"))
        ping = b"\1" + struct.pack(">q", int(time.time() * 1000))
        connection.sendall(varint(len(ping)) + ping)
        if packet(connection) != ping:
            raise ValueError("Minecraft ping did not echo")
        return {"latencyMs": round((time.monotonic() - started) * 1000, 2),
            "version": value.get("version"), "players": {key: value.get("players", {}).get(key) for key in ("online", "max")}}


def probe_service(spec: dict) -> dict:
    if spec["readiness"] == "minecraft":
        return minecraft_probe(spec["port"])
    if spec["readiness"] == "tcp":
        with socket.create_connection(("127.0.0.1", spec["port"]), timeout=1):
            return {"tcpReady": True}
    # Bypass host proxy settings; health must never leave loopback.
    import http.client
    connection = http.client.HTTPConnection("127.0.0.1", spec["port"], timeout=1.5)
    try:
        connection.request("GET", "/healthz", headers={"Host": f"127.0.0.1:{spec['port']}"})
        response = connection.getresponse()
        content = response.read(65537)
        if response.status != 200 or len(content) > 65536:
            raise ValueError("Worker health HTTP response is not ready")
        result = json.loads(content)
        if (not isinstance(result, dict) or result.get("ready") is not True
                or result.get("ok") is False or result.get("healthy") is False):
            raise ValueError("Worker reports unhealthy")
        agent = result.get("agent")
        details = agent.get("details") if isinstance(agent, dict) else None
        return {"httpReady": True, "workerReady": True,
                "agentDetails": {key: details[key] for key in ("state", "connected", "username", "phase", "mode", "lastActionAt")
                    if isinstance(details, dict) and key in details}}
    finally:
        connection.close()


def check_owned_listener(port: int, pid: int) -> None:
    """Windows kernel IPv4 table: prove the listening socket belongs to our child.

    Configuration alone does not prove a Node program actually bound loopback.
    Only inspect this explicit child/port; never derive an ownership PID here.
    """
    if os.name != "nt":
        return
    from ctypes import wintypes as w
    class Row(ctypes.Structure):
        _fields_ = [(name, w.DWORD) for name in ("state", "localAddress", "localPort", "remoteAddress", "remotePort", "pid")]
    api = ctypes.WinDLL("iphlpapi", use_last_error=True).GetExtendedTcpTable
    api.argtypes = [ctypes.c_void_p, ctypes.POINTER(w.DWORD), w.BOOL, w.ULONG, ctypes.c_int, w.ULONG]
    api.restype = w.DWORD
    size = w.DWORD(0)
    result = api(None, ctypes.byref(size), False, 2, 3, 0)  # AF_INET, OWNER_PID_LISTENER
    if result != 122:  # ERROR_INSUFFICIENT_BUFFER
        raise OSError(f"Listener ownership table unavailable: {result}")
    buffer = ctypes.create_string_buffer(size.value)
    result = api(buffer, ctypes.byref(size), False, 2, 3, 0)
    if result:
        raise OSError(f"Listener ownership table unavailable: {result}")
    count = w.DWORD.from_buffer(buffer).value
    matched = False
    for index in range(count):
        row = Row.from_buffer(buffer, ctypes.sizeof(w.DWORD) + index * ctypes.sizeof(Row))
        actual_port = socket.ntohs(row.localPort & 0xffff)
        if actual_port == port and row.pid == pid:
            address = socket.inet_ntoa(struct.pack("=I", row.localAddress))
            if address != "127.0.0.1":
                raise RuntimeError(f"Owned listener exposed on {address}; expected loopback")
            matched = True
    if not matched:
        raise RuntimeError("Expected listener is not owned by the launched child")
    # A second IPv6 socket owned by the same process must not expose the same
    # service on :: while its IPv4 socket happens to bind 127.0.0.1 correctly.
    class Row6(ctypes.Structure):
        _fields_ = [("localAddress", ctypes.c_ubyte * 16), ("localScope", w.DWORD), ("localPort", w.DWORD),
            ("remoteAddress", ctypes.c_ubyte * 16), ("remoteScope", w.DWORD), ("remotePort", w.DWORD),
            ("state", w.DWORD), ("pid", w.DWORD)]
    size = w.DWORD(0)
    result = api(None, ctypes.byref(size), False, 23, 3, 0)  # Windows AF_INET6
    if result not in (0, 122):
        raise OSError(f"IPv6 listener ownership table unavailable: {result}")
    if size.value >= ctypes.sizeof(w.DWORD):
        buffer = ctypes.create_string_buffer(size.value)
        result = api(buffer, ctypes.byref(size), False, 23, 3, 0)
        if result:
            raise OSError(f"IPv6 listener ownership table unavailable: {result}")
        count = w.DWORD.from_buffer(buffer).value
        for index in range(count):
            row = Row6.from_buffer(buffer, ctypes.sizeof(w.DWORD) + index * ctypes.sizeof(Row6))
            if socket.ntohs(row.localPort & 0xffff) == port and row.pid == pid:
                address = socket.inet_ntop(socket.AF_INET6, bytes(row.localAddress))
                if address != "::1":
                    raise RuntimeError(f"Owned IPv6 listener exposed on {address}; expected loopback")


class InstanceLock:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.stream = path.open("a+b")
        self.stream.seek(0)
        self.stream.write(b"0")
        self.stream.flush()
        self.stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            self.stream.close()
            raise RuntimeError("This new server already has a supervisor") from None

    def close(self):
        self.stream.close()


class WindowsJob:
    """Contain only children launched here; abnormal owner death cannot orphan them.

    Normal stop always uses stdin/SIGBREAK and waits. Kill-on-close is an explicit
    final crash containment, not a graceful-save guarantee after owner failure.
    """
    def __init__(self):
        self.handle = None
        if os.name != "nt":
            return
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_ = [("processTime", ctypes.c_int64), ("jobTime", ctypes.c_int64),
                ("flags", w.DWORD), ("minWorking", ctypes.c_size_t), ("maxWorking", ctypes.c_size_t),
                ("activeProcesses", w.DWORD), ("affinity", ctypes.c_size_t),
                ("priority", w.DWORD), ("scheduling", w.DWORD)]
        class Io(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("readOps", "writeOps", "otherOps", "readBytes", "writeBytes", "otherBytes")]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", Io), ("processMemory", ctypes.c_size_t),
                ("jobMemory", ctypes.c_size_t), ("peakProcess", ctypes.c_size_t), ("peakJob", ctypes.c_size_t)]
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = w.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.kernel.CloseHandle.argtypes = [w.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        limits = Extended()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.handle or not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close()
            raise ctypes.WinError(ctypes.get_last_error())

    def assign(self, process):
        if self.handle and not self.kernel.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class Child:
    def __init__(self, spec: dict, directory: Path, job: WindowsJob):
        self.spec, self.process = spec, None
        self.started = self.next_start = self.stop_started = 0.0
        self.ready, self.stopping = False, False
        self.failures, self.error_count, self.warning_count = 0, 0, 0
        self.problem, self.last_exit, self.metrics = None, None, {}
        self.starts = []
        self.job = job
        self.log = logging.getLogger("maw.child." + spec["id"] + "." + uuid.uuid4().hex)
        self.log.setLevel(logging.INFO)
        self.log.propagate = False
        self.handler = RotatingFileHandler(directory / f"{spec['id']}.log", maxBytes=10 * 1024 * 1024,
                                          backupCount=4, encoding="utf-8")
        self.handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        self.log.addHandler(self.handler)

    def start(self):
        now = time.monotonic()
        self.starts = [stamp for stamp in self.starts if now - stamp < 3600]
        if len(self.starts) >= 6:
            self.problem = "restart_budget_exhausted: operator resume required"
            return
        self.starts.append(now)
        try:
            reserve_port(self.spec["port"])
            flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
            self.process = subprocess.Popen(self.spec["command"], cwd=self.spec["cwd"],
                env={**os.environ, **self.spec["env"]}, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                bufsize=1, creationflags=flags)
            try:
                self.job.assign(self.process)
            except Exception:
                # Only our just-created child, never a discovered PID.
                self.process.terminate()
                self.process.wait(timeout=10)
                raise
            self.started, self.ready, self.stopping = now, False, False
            self.stop_started, self.problem, self.metrics = 0, None, {}
            threading.Thread(target=self._output, args=(self.process,), daemon=True).start()
        except Exception as error:
            self.problem = f"launch_refused: {type(error).__name__}: {error}"
            self.failed(now)

    def _output(self, process):
        for line in process.stdout:
            line = line.rstrip()
            self.log.info(line)
            if "ERROR" in line or "Exception" in line:
                self.error_count += 1
            if "WARN" in line or "Can't keep up" in line:
                self.warning_count += 1

    def failed(self, now):
        self.failures += 1
        self.next_start = now + min(300, 5 * 2 ** min(self.failures - 1, 6))
        self.ready = False

    def tick(self):
        now = time.monotonic()
        if self.process is None:
            return
        code = self.process.poll()
        if code is not None:
            self.last_exit = {"code": code, "at": utc(), "requested": self.stopping}
            self.process.stdin.close()
            self.process = None
            if not self.stopping:
                self.problem = f"process_exited: {code}"
                self.failed(now)
            self.ready, self.stopping = False, False
            return
        if self.stopping:
            if now - self.stop_started > 90:
                self.problem = "stop_timeout: still running; no forced termination"
            return
        try:
            self.metrics = probe_service(self.spec)
            check_owned_listener(self.spec["port"], self.process.pid)
            self.ready, self.problem = True, None
            if now - self.started > 600:
                self.failures = 0
        except Exception as error:
            self.ready = False
            self.problem = f"readiness_failed: {type(error).__name__}: {error}"
            if now - self.started > self.spec["startupTimeoutSeconds"]:
                self.stop()

    def send(self, text: str):
        if self.process is None or self.process.poll() is not None or self.stopping:
            raise RuntimeError("Owned process is unavailable or stopping")
        self.process.stdin.write(text + "\n")
        self.process.stdin.flush()

    def stop(self):
        if not self.process or self.process.poll() is not None or self.stopping:
            return
        try:
            if self.spec["stopMode"] == "stdin":
                self.send(self.spec["stopText"])
            else:
                if os.name != "nt":
                    self.process.send_signal(signal.SIGINT)
                else:
                    self.process.send_signal(signal.CTRL_BREAK_EVENT)
            self.stopping, self.ready, self.stop_started = True, False, time.monotonic()
        except Exception as error:
            self.problem = f"stop_delivery_failed: {type(error).__name__}: {error}"

    def state(self):
        return {"id": self.spec["id"], "pid": self.process.pid if self.process else None,
            "port": self.spec["port"], "host": "127.0.0.1", "ready": self.ready,
            "stopping": self.stopping, "uptimeSeconds": round(time.monotonic() - self.started, 1) if self.process else None,
            "startsInLastHour": len(self.starts), "lastExit": self.last_exit,
            "problem": self.problem, "metrics": self.metrics,
            "logErrorLines": self.error_count, "logWarningLines": self.warning_count}


class Supervisor:
    def __init__(self, config: dict):
        self.config = config
        self.directory = Path(config["runtimeDir"])
        for name in ("requests", "replies", "logs"):
            (self.directory / name).mkdir(parents=True, exist_ok=True)
        self.lock = InstanceLock(self.directory / "instance.lock")
        self.job = WindowsJob()
        self.children = {row["id"]: Child(row, self.directory / "logs", self.job) for row in config["services"]}
        self.quit, self.stop_requested, self.snapshot, self.fault = False, False, {}, None
        self.run_id = uuid.uuid4().hex
        self.audit = logging.getLogger("maw.audit." + self.run_id)
        self.audit.setLevel(logging.INFO)
        self.audit.propagate = False
        handler = RotatingFileHandler(self.directory / "logs" / "operations.jsonl", maxBytes=2 * 1024 * 1024, backupCount=4, encoding="utf-8")
        self.audit.addHandler(handler)

    def paused(self):
        return (self.directory / "paused.json").exists()

    def pause(self, reason):
        atomic_json(self.directory / "paused.json", {"schemaVersion": 1, "at": utc(), "reason": str(reason)[:500]})

    def apply(self, request: dict) -> dict:
        action = request.get("action")
        if action in ("pause", "stop", "shutdown"):
            self.pause(request.get("reason", "local maintenance"))
            if action in ("stop", "shutdown"):
                self.stop_requested = True
            if action == "shutdown":
                self.quit = True
            return {"ok": True, "state": "requested", "action": action, "resultKnown": action == "pause"}
        if action == "resume":
            check_server(Path(self.config["serverDir"]), self.config["gamePort"])
            if any(child.stopping for child in self.children.values()):
                raise RuntimeError("Wait for pending graceful stop before resuming")
            (self.directory / "paused.json").unlink(missing_ok=True)
            self.stop_requested, self.fault = False, None
            for child in self.children.values():
                child.starts, child.next_start, child.failures = [], 0, 0
            return {"ok": True, "state": "resumed", "action": action, "resultKnown": True}
        if action == "console":
            command = guard_console(request.get("command"))
            self.children["java"].send(command)
            return {"ok": True, "state": "delivered_to_owned_stdin", "action": action,
                    "deliveryKnown": True, "resultKnown": False}
        raise ValueError("Unknown local action")

    def requests(self):
        for path in sorted((self.directory / "requests").glob("*.json"))[:32]:
            try:
                request = read_json(path, 8192)
                request_id = request.get("requestId", "")
                if not REQUEST_ID.fullmatch(request_id) or path.name != request_id + ".json" or path.is_symlink():
                    raise ValueError("Invalid request identity/file")
                digest = fingerprint(request)
                reply_path = self.directory / "replies" / path.name
                if reply_path.exists():
                    previous = read_json(reply_path)
                    if previous.get("fingerprint") != digest:
                        self.audit.info(json.dumps({"at": utc(), "kind": "request_conflict", "requestId": request_id}))
                    # Original receipt is immutable; conflicts never execute.
                    path.unlink()
                    continue
                try:
                    if not isinstance(request.get("createdAtEpoch"), (int, float)) or not 0 <= time.time() - request["createdAtEpoch"] <= 60:
                        raise ValueError("Request expired or timestamp invalid; never replayed")
                    result = self.apply(request)
                except Exception as error:
                    result = {"ok": False, "reason": f"{type(error).__name__}: {error}", "resultKnown": True}
                reply = {"schemaVersion": 1, "requestId": request_id, "fingerprint": digest, "at": utc(), **result}
                atomic_json(reply_path, reply)
                self.audit.info(json.dumps({"at": utc(), "requestId": request_id, "action": request.get("action"), "ok": result["ok"]}))
                path.unlink()
            except Exception as error:
                self.audit.info(json.dumps({"at": utc(), "kind": "invalid_request", "file": path.name, "reason": str(error)[:300]}))
                path.rename(path.with_suffix(".rejected"))

    def tick(self):
        self.requests()
        try:
            check_server(Path(self.config["serverDir"]), self.config["gamePort"])
        except Exception as error:
            self.fault = str(error)
            self.pause("runtime configuration changed: " + self.fault)
            self.stop_requested = True
        for child in self.children.values():
            child.tick()
            if any(not self.children[name].ready for name in child.spec["dependsOn"]):
                # Propagate a failed Java dependency through gate to worker, so
                # reverse-order shutdown cannot wait forever on a healthy worker.
                child.ready = False
        # Close downstream processes before the server, and never start over a
        # dependency that is unhealthy, stopping, or owned by another process.
        for role in reversed(ROLES):
            child = self.children[role]
            downstream = [self.children[name] for name in ROLES[ROLES.index(role) + 1:]]
            dependency_bad = any(not self.children[name].ready for name in child.spec["dependsOn"])
            if (self.stop_requested or dependency_bad) and not any(item.process for item in downstream):
                child.stop()
        if not self.paused() and not self.stop_requested:
            for role in ROLES:
                child = self.children[role]
                if (child.process is None and time.monotonic() >= child.next_start
                        and all(self.children[name].ready for name in child.spec["dependsOn"])):
                    child.start()
        rows = [self.children[role].state() for role in ROLES]
        healthy = not self.paused() and not self.fault and all(row["ready"] for row in rows)
        self.snapshot = {"schemaVersion": 1, "at": utc(), "heartbeatEpoch": time.time(),
            "runId": self.run_id, "supervisorPid": os.getpid(), "serverDir": self.config["serverDir"],
            "healthy": healthy, "paused": self.paused(), "stopRequested": self.stop_requested,
            "shutdownRequested": self.quit, "problem": self.fault, "services": rows,
            "abnormalOwnerExitPolicy": "Windows job closes only owned children; abrupt owner failure may require unclean save recovery"}
        atomic_json(self.directory / "health.json", self.snapshot)

    def run(self):
        supervisor = self
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                host = self.headers.get("Host", "")
                if host not in (f"127.0.0.1:{supervisor.config['healthPort']}", f"localhost:{supervisor.config['healthPort']}") or self.path != "/healthz":
                    self.send_error(404)
                    return
                content = json.dumps(supervisor.snapshot, ensure_ascii=False).encode()
                self.send_response(200 if supervisor.snapshot.get("healthy") else 503)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            def log_message(self, *args):
                pass
        http = ThreadingHTTPServer(("127.0.0.1", self.config["healthPort"]), Handler)
        http.daemon_threads = True
        threading.Thread(target=http.serve_forever, daemon=True).start()
        def shutdown(signum, frame):
            self.pause(f"supervisor signal {signum}")
            self.quit = self.stop_requested = True
        for signum in (signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, shutdown)
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, shutdown)
        try:
            while True:
                self.tick()
                if self.quit and not any(child.process for child in self.children.values()):
                    break
                time.sleep(2)
        finally:
            http.shutdown()
            http.server_close()
            self.job.close()
            self.lock.close()
            for child in self.children.values():
                child.handler.close()


def submit(config: dict, request: dict, wait: float = 15) -> dict:
    directory = Path(config["runtimeDir"])
    health = read_json(directory / "health.json")
    if time.time() - health.get("heartbeatEpoch", 0) > 15 or health.get("serverDir") != config["serverDir"]:
        raise RuntimeError("Supervisor heartbeat unavailable/stale; command not submitted")
    request_id = request.setdefault("requestId", uuid.uuid4().hex)
    if not REQUEST_ID.fullmatch(request_id):
        raise ValueError("Invalid requestId")
    reply_path = directory / "replies" / (request_id + ".json")
    digest = fingerprint(request)
    if reply_path.exists():
        previous = read_json(reply_path)
        if previous.get("fingerprint") != digest:
            raise ValueError("requestId content conflict")
        return previous
    request["createdAtEpoch"] = time.time()
    atomic_json(directory / "requests" / (request_id + ".json"), request)
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        if reply_path.exists():
            reply = read_json(reply_path)
            if reply.get("fingerprint") != digest:
                raise ValueError("requestId content conflict")
            return reply
        time.sleep(0.2)
    return {"ok": False, "requestId": request_id, "resultKnown": False,
            "reason": "receipt_pending; query the same requestId, do not submit a replacement"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", "run", "status", "pause", "resume", "stop", "shutdown", "console"))
    parser.add_argument("--config", required=True)
    parser.add_argument("--reason", default="local maintenance")
    parser.add_argument("--command")
    parser.add_argument("--request-id")
    parser.add_argument("--wait", type=float, default=15)
    args = parser.parse_args()
    config = load_config(Path(args.config))
    if args.action == "plan":
        # Do not print env values or arbitrary command arguments/secrets.
        print(json.dumps({"ok": True, "serverDir": config["serverDir"], "healthPort": config["healthPort"],
            "runtimeDir": config["runtimeDir"], "services": [{"id": row["id"], "cwd": row["cwd"],
            "port": row["port"], "dependsOn": row["dependsOn"], "readiness": row["readiness"]} for row in config["services"]]}))
    elif args.action == "run":
        Supervisor(config).run()
    elif args.action == "status":
        value = read_json(Path(config["runtimeDir"]) / "health.json")
        value["heartbeatFresh"] = 0 <= time.time() - value.get("heartbeatEpoch", 0) <= 15
        if not value["heartbeatFresh"]:
            value["healthy"] = False
        print(json.dumps(value, ensure_ascii=False))
    else:
        request = {"action": args.action}
        if args.action in ("pause", "stop", "shutdown"):
            request["reason"] = args.reason
        if args.action == "console":
            request["command"] = guard_console(args.command)
        if args.request_id:
            request["requestId"] = args.request_id
        print(json.dumps(submit(config, request, max(1, min(args.wait, 120))), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "reason": f"{type(error).__name__}: {error}"}, ensure_ascii=False))
        sys.exit(1)
