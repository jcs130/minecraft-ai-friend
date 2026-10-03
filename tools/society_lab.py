"""Prepare and smoke-test the isolated NeoForge society world.

This tool never targets the existing Paper server, opens a public listener, or
installs anything into the host Java environment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.request
import zipfile


REPO = Path(__file__).resolve().parents[1]
LOCK = REPO / "manifests" / "society-lab-1.21.1.lock.json"
DEFAULT_ROOT = Path(r"E:\QiandengJiSocietyLab")
DEFAULT_JAVA = Path(r"E:\MC\jdk\jdk-21.0.12.1+1\bin\java.exe")
PORT = 28976
PROPERTIES = {
    "server-ip": "127.0.0.1",
    "server-port": str(PORT),
    "enable-rcon": "false",
    "enable-query": "false",
    "level-name": "world-lab",
    "motd": "My Agent World",
}
INITIAL_PROPERTIES = {
    **PROPERTIES,
    "online-mode": "false",
    "enforce-secure-profile": "false",
    "white-list": "false",
    "view-distance": "6",
    "simulation-distance": "4",
    "max-players": "4",
    "spawn-protection": "0",
    "difficulty": "easy",
    "gamemode": "survival",
    "allow-flight": "true",
}
REQUIRED_MODS = (
    "minecolonies", "structurize", "multipiston", "blockui",
    "domum_ornamentum", "touhou_little_maid", "farmersdelight",
    "numen_api", "numen", "maw_agent_bridge",
)


def safe_root(value: str) -> Path:
    root = Path(value).expanduser().resolve()
    forbidden = [
        REPO,
        Path(r"E:\MC"),
        Path(r"E:\Cortico"),
        Path(r"E:\minecraft-ai-friend"),
        Path(r"E:\minecraft-ai-friend-prospect-coords"),
    ]
    if root == Path(root.anchor) or any(
        root == path.resolve() or path.resolve() in root.parents for path in forbidden
    ):
        raise ValueError(f"Refusing production or source directory: {root}")
    return root


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_artifact(path: Path, expected: str) -> None:
    if not path.is_file() or sha256(path) != expected or not zipfile.is_zipfile(path):
        raise ValueError(f"Missing, corrupt or unexpected artifact: {path}")


def fetch(url: str, dest: Path, expected: str) -> None:
    if dest.exists():
        check_artifact(dest, expected)
        return
    part = dest.with_name(dest.name + ".part")
    if part.exists():
        raise ValueError(f"Incomplete download requires inspection: {part}")
    request = urllib.request.Request(url, headers={"User-Agent": "QiandengJiSocietyLab/1"})
    try:
        with urllib.request.urlopen(request, timeout=45) as source, part.open("xb") as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)
        check_artifact(part, expected)
        os.replace(part, dest)
    except Exception:
        if part.exists():
            part.unlink()
        raise


def read_properties(path: Path) -> dict[str, str]:
    result = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip()
    return result


def check_runtime(root: Path, lock: dict, with_agent: bool = True) -> None:
    server = root / "server"
    args = server / "libraries" / "net" / "neoforged" / "neoforge" / lock["neoforgeVersion"] / "win_args.txt"
    if not args.is_file():
        raise ValueError(f"NeoForge server not installed: {args}")
    for item in lock["artifacts"]:
        check_artifact(root / "downloads" / item["name"], item["sha256"])
        if item["kind"] == "mod":
            check_artifact(server / "mods" / item["name"], item["sha256"])
    if with_agent:
        for item in lock["builtArtifacts"]:
            check_artifact(server / "mods" / item["name"], item["sha256"])
        expected = {item["name"] for item in lock["artifacts"] if item["kind"] == "mod"}
        expected.update(item["name"] for item in lock["builtArtifacts"])
        actual = {path.name for path in (server / "mods").glob("*.jar")}
        if actual != expected:
            raise ValueError(f"Lab mod set differs: extra={sorted(actual - expected)}, missing={sorted(expected - actual)}")
    props_path = server / "server.properties"
    if not props_path.is_file():
        raise ValueError("Missing lab server.properties")
    props = read_properties(props_path)
    for key, expected in PROPERTIES.items():
        if props.get(key) != expected:
            raise ValueError(f"Lab setting {key} must be {expected!r}; found {props.get(key)!r}")
    if not (server / "eula.txt").is_file() or "eula=true" not in (server / "eula.txt").read_text(encoding="ascii"):
        raise ValueError("Lab EULA has not been accepted")


def prepare(root: Path, java: Path, lock: dict, accept_eula: bool) -> None:
    server = root / "server"
    downloads = root / "downloads"
    mods = server / "mods"
    mods.mkdir(parents=True, exist_ok=True)
    downloads.mkdir(parents=True, exist_ok=True)
    for item in lock["artifacts"]:
        source = downloads / item["name"]
        fetch(item["url"], source, item["sha256"])
        if item["kind"] == "mod":
            target = mods / item["name"]
            if target.exists():
                check_artifact(target, item["sha256"])
            else:
                shutil.copy2(source, target)
                check_artifact(target, item["sha256"])
    args = server / "libraries" / "net" / "neoforged" / "neoforge" / lock["neoforgeVersion"] / "win_args.txt"
    if not args.exists():
        if not java.is_file():
            raise ValueError(f"Java 21 not found: {java}")
        installer = next(item for item in lock["artifacts"] if item["kind"] == "installer")
        with (root / "installer.log").open("w", encoding="utf-8") as log:
            result = subprocess.run([str(java), "-jar", str(downloads / installer["name"]), "--installServer"],
                                    cwd=server, stdout=log, stderr=subprocess.STDOUT, check=False)
        if result.returncode != 0 or not args.exists():
            raise RuntimeError(f"NeoForge install failed; inspect {root / 'installer.log'}")
    props = server / "server.properties"
    if not props.exists():
        props.write_text("\n".join(f"{key}={value}" for key, value in INITIAL_PROPERTIES.items()) + "\n",
                         encoding="ascii")
    eula = server / "eula.txt"
    if not eula.exists():
        if not accept_eula:
            raise ValueError("Accept the Minecraft EULA explicitly with --accept-eula")
        eula.write_text("eula=true\n", encoding="ascii")
    check_runtime(root, lock, with_agent=False)


def install_numen(root: Path, lock: dict) -> None:
    item = next(entry for entry in lock["builtArtifacts"] if entry["name"].startswith("numen-neoforge-"))
    source = REPO / item["source"]
    check_artifact(source, item["sha256"])
    target = root / "server" / "mods" / item["name"]
    if target.exists():
        check_artifact(target, item["sha256"])
        return
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", PORT))
    temporary = target.with_name(target.name + ".part")
    if temporary.exists():
        raise ValueError(f"Incomplete Numen copy requires inspection: {temporary}")
    shutil.copy2(source, temporary)
    check_artifact(temporary, item["sha256"])
    os.replace(temporary, target)


def varint(value: int) -> bytes:
    result = bytearray()
    while True:
        part = value & 0x7f
        value >>= 7
        result.append(part | (0x80 if value else 0))
        if not value:
            return bytes(result)


def read_varint(connection: socket.socket) -> int:
    value = 0
    for shift in range(0, 35, 7):
        part = connection.recv(1)
        if not part:
            raise EOFError("Minecraft status packet ended early")
        value |= (part[0] & 0x7f) << shift
        if not part[0] & 0x80:
            return value
    raise ValueError("Minecraft status VarInt too long")


def recv_exact(connection: socket.socket, count: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < count:
        part = connection.recv(count - len(chunks))
        if not part:
            raise EOFError("Minecraft status packet ended early")
        chunks.extend(part)
    return bytes(chunks)


def status_ping() -> dict:
    host = b"127.0.0.1"
    handshake = b"\x00" + varint(767) + varint(len(host)) + host + struct.pack(">H", PORT) + b"\x01"
    with socket.create_connection(("127.0.0.1", PORT), timeout=3) as connection:
        connection.settimeout(3)
        connection.sendall(varint(len(handshake)) + handshake + b"\x01\x00")
        packet_size = read_varint(connection)
        if not 1 <= packet_size <= 65536:
            raise ValueError("Invalid Minecraft status packet size")
        packet = recv_exact(connection, packet_size)
    if packet[0] != 0:
        raise ValueError("Invalid Minecraft status response")
    # Packet ID is one byte; JSON length is a VarInt.
    offset = 1
    length = 0
    for shift in range(0, 35, 7):
        part = packet[offset]
        offset += 1
        length |= (part & 0x7f) << shift
        if not part & 0x80:
            break
    else:
        raise ValueError("Invalid Minecraft status JSON length")
    status = json.loads(packet[offset:offset + length].decode("utf-8"))
    if status.get("version", {}).get("name") != "1.21.1" or "My Agent World" not in json.dumps(status.get("description"), ensure_ascii=False):
        raise ValueError(f"Unexpected server identity: {status.get('version')}, {status.get('description')}")
    return status


def console_command(process: subprocess.Popen, log_path: Path, command: str) -> dict:
    assert process.stdin is not None
    offset = log_path.stat().st_size
    process.stdin.write(command + "\n")
    process.stdin.flush()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        with log_path.open("rb") as stream:
            stream.seek(offset)
            content = stream.read().decode("utf-8", errors="replace")
        for line in content.splitlines():
            if "MAW_AGENT " in line:
                return json.loads(line.split("MAW_AGENT ", 1)[1])
        if process.poll() is not None:
            break
        time.sleep(0.1)
    raise TimeoutError(f"No bridge response to {command.split()[1]}: {log_path}")


def smoke(root: Path, java: Path, lock: dict) -> dict:
    check_runtime(root, lock)
    if not java.is_file():
        raise ValueError(f"Java 21 not found: {java}")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", PORT))
    server = root / "server"
    args = f"@libraries/net/neoforged/neoforge/{lock['neoforgeVersion']}/win_args.txt"
    log_path = root / f"smoke-{int(time.time())}.log"
    with log_path.open("w", encoding="utf-8") as output:
        process = subprocess.Popen([str(java), "-Xms512M", "-Xmx3G", args, "nogui"],
                                   cwd=server, stdin=subprocess.PIPE, stdout=output,
                                   stderr=subprocess.STDOUT, text=True)
        try:
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    break
                output.flush()
                content = log_path.read_text(encoding="utf-8", errors="replace")
                if "Done (" in content:
                    break
                time.sleep(1)
            else:
                raise TimeoutError(f"Lab startup timed out: {log_path}")
            content = log_path.read_text(encoding="utf-8", errors="replace")
            if "Done (" not in content:
                raise RuntimeError(f"Lab server exited before ready: {log_path}")
            time.sleep(2)
            status = status_ping()
            owners = (
                ("11111111-1111-4111-8111-111111111111", "MawSmokeA"),
                ("22222222-2222-4222-8222-222222222222", "MawSmokeB"),
            )
            bodies = []
            for owner, name in owners:
                receipt = console_command(process, log_path, f"maw_agent summon {owner} {name}")
                if receipt.get("ok") is not True or receipt.get("ownerUuid") != owner:
                    raise ValueError(f"Agent spawn failed: {receipt}")
                bodies.append(receipt["bodyUuid"])
            roster = console_command(process, log_path, "maw_agent list")
            by_id = {body["bodyUuid"]: body for body in roster["bodies"]}
            if any(body not in by_id for body in bodies) or bodies[0] == bodies[1]:
                raise ValueError(f"Agent bodies are not independent: {roster}")
            for body in bodies:
                receipt = console_command(process, log_path, f"maw_agent invoke {body} task_status {{}}")
                if (receipt.get("ok") is not True or receipt.get("bodyUuid") != body
                        or receipt.get("resultKnown") is not True):
                    raise ValueError(f"Agent status was routed incorrectly: {receipt}")
            rejected = console_command(process, log_path,
                                       f"maw_agent invoke {bodies[0]} nonexistent_tool {{}}")
            if rejected.get("ok") is not False or rejected.get("code") != "unknown_tool":
                raise ValueError(f"Unknown tool was not rejected: {rejected}")
            for body in bodies:
                receipt = console_command(process, log_path, f"maw_agent dismiss {body}")
                if receipt.get("ok") is not True or receipt.get("bodyUuid") != body:
                    raise ValueError(f"Agent cleanup failed: {receipt}")
            roster = console_command(process, log_path, "maw_agent list")
            if any(body in {row["bodyUuid"] for row in roster["bodies"]} for body in bodies):
                raise ValueError("Test bodies remained online after dismissal")
        finally:
            if process.poll() is None:
                try:
                    assert process.stdin is not None
                    process.stdin.write("stop\n")
                    process.stdin.flush()
                    process.wait(timeout=30)
                except (BrokenPipeError, subprocess.TimeoutExpired):
                    process.terminate()
                    process.wait(timeout=10)
    content = log_path.read_text(encoding="utf-8", errors="replace")
    missing = [mod for mod in REQUIRED_MODS if f"({mod})" not in content]
    if process.returncode != 0 or missing or "All dimensions are saved" not in content:
        raise RuntimeError(f"Lab smoke failed (exit={process.returncode}, missing={missing}): {log_path}")
    return {"ok": True, "exitCode": process.returncode, "port": PORT,
            "minecraftVersion": status["version"]["name"], "displayName": "My Agent World",
            "mods": list(REQUIRED_MODS), "agentChecks": ["two_owners", "two_bodies", "per_body_status",
                                                   "unknown_tool_rejected", "body_cleanup"],
            "log": str(log_path)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "install-numen", "verify", "smoke"))
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--java", default=str(DEFAULT_JAVA))
    parser.add_argument("--accept-eula", action="store_true")
    args = parser.parse_args()
    root = safe_root(args.root)
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    java = Path(args.java)
    if args.command == "prepare":
        prepare(root, java, lock, args.accept_eula)
        result = {"ok": True, "root": str(root), "prepared": True}
    elif args.command == "install-numen":
        install_numen(root, lock)
        result = {"ok": True, "root": str(root), "numenInstalled": True}
    elif args.command == "verify":
        check_runtime(root, lock)
        result = {"ok": True, "root": str(root), "verified": True}
    else:
        result = smoke(root, java, lock)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, TimeoutError) as exc:
        print(f"society-lab: {exc}", file=sys.stderr)
        sys.exit(1)
