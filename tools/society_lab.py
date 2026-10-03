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
import ssl
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile


REPO = Path(__file__).resolve().parents[1]
LOCK = REPO / "manifests" / "society-lab-1.21.1.lock.json"
DATAPACK_SOURCE = REPO / "world" / "society-datapacks" / "maw_curios_maid_slots"
DATAPACK_NAME = DATAPACK_SOURCE.name
DEFAULT_ROOT = Path(r"E:\QiandengJiSocietyLab")
DEFAULT_JAVA = Path(r"E:\MC\jdk\jdk-21.0.12.1+1\bin\java.exe")
PORT = 28976
PROPERTIES = {
    "server-ip": "127.0.0.1",
    "server-port": str(PORT),
    "online-mode": "false",
    "enable-rcon": "false",
    "enable-query": "false",
    "level-name": "world-lab",
    "motd": "My Agent World",
}
INITIAL_PROPERTIES = {
    **PROPERTIES,
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
    "ponder", "create", "create_dragons_plus", "create_central_kitchen",
    "ars_nouveau", "ars_creo", "curios", "patchouli", "geckolib",
    "mcwbridges", "mcwroofs", "mcwfurnitures", "mcwwindows",
    "dungeoncrawl", "betterdungeons", "yungsapi", "dungeoneer",
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
        try:
            with urllib.request.urlopen(request, timeout=45) as source, part.open("xb") as target:
                shutil.copyfileobj(source, target, length=1024 * 1024)
        except urllib.error.URLError as error:
            if os.name != "nt" or not isinstance(error.reason, ssl.SSLCertVerificationError):
                raise
            part.unlink(missing_ok=True)
            # Windows curl uses Schannel and the machine's trusted certificate store.
            subprocess.run(["curl.exe", "--fail", "--location", "--retry", "2",
                            "--silent", "--show-error",
                            "--output", str(part), url], check=True, timeout=180)
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
    expected_files = {path.relative_to(DATAPACK_SOURCE): path for path in DATAPACK_SOURCE.rglob("*") if path.is_file()}
    installed = server / "world-lab" / "datapacks" / DATAPACK_NAME
    actual_files = {path.relative_to(installed): path for path in installed.rglob("*") if path.is_file()}
    if not expected_files or set(actual_files) != set(expected_files):
        raise ValueError(f"Lab data pack differs: {installed}")
    for relative, source in expected_files.items():
        if sha256(source) != sha256(actual_files[relative]):
            raise ValueError(f"Lab data pack file differs: {installed / relative}")


def install_datapack(server: Path) -> None:
    target = server / "world-lab" / "datapacks" / DATAPACK_NAME
    for source in DATAPACK_SOURCE.rglob("*"):
        if not source.is_file():
            continue
        dest = target / source.relative_to(DATAPACK_SOURCE)
        if dest.exists():
            if sha256(dest) != sha256(source):
                raise ValueError(f"Existing lab data pack file differs: {dest}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)


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
    install_datapack(server)
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
            catalog = console_command(process, log_path, "maw_agent commands")
            if (catalog.get("ok") is not True or catalog.get("legacyMycliParity") is not False
                    or "maw_agent spell explain <bodyUuid> <spellId>" not in catalog.get("commands", [])):
                raise ValueError(f"Agent CLI was not self-describing: {catalog}")
            for body in bodies:
                receipt = console_command(process, log_path, f"maw_agent invoke {body} task_status {{}}")
                if (receipt.get("ok") is not True or receipt.get("bodyUuid") != body
                        or receipt.get("resultKnown") is not True):
                    raise ValueError(f"Agent status was routed incorrectly: {receipt}")
            spell_list = console_command(process, log_path, f"maw_agent spell list {bodies[0]}")
            if (spell_list.get("ok") is not True or spell_list.get("bodyUuid") != bodies[0]
                    or spell_list.get("casterEquipped") is not False
                    or not isinstance(spell_list.get("spells"), list)
                    or not isinstance(spell_list.get("mana"), dict)):
                raise ValueError(f"Agent's native Ars mana/book state was unavailable: {spell_list}")
            no_book_cast = console_command(process, log_path,
                                           f"maw_agent spell cast {bodies[0]} ars_nouveau:slot_0")
            if no_book_cast.get("ok") is not False or no_book_cast.get("code") != "ars_spellbook_not_held":
                raise ValueError(f"Agent cast without a real book was not rejected: {no_book_cast}")
            no_book_explain = console_command(process, log_path,
                                              f"maw_agent spell explain {bodies[0]} ars_nouveau:slot_0")
            if no_book_explain.get("ok") is not False or no_book_explain.get("code") != "ars_spellbook_not_held":
                raise ValueError(f"Agent explained a spell it did not own: {no_book_explain}")
            assert process.stdin is not None
            process.stdin.write("item replace entity MawSmokeA weapon.mainhand with ars_nouveau:novice_spell_book\n")
            process.stdin.flush()
            equipped = console_command(process, log_path, f"maw_agent spell list {bodies[0]}")
            if (equipped.get("ok") is not True or equipped.get("casterEquipped") is not True
                    or equipped.get("heldItem") != "ars_nouveau:novice_spell_book"):
                raise ValueError(f"Agent could not inspect the held Ars spellbook: {equipped}")
            wrong_spell = console_command(process, log_path,
                                          f"maw_agent spell cast {bodies[0]} unrestricted_magic")
            if wrong_spell.get("ok") is not False or wrong_spell.get("code") != "invalid_spell_id":
                raise ValueError(f"Unlisted spell was not rejected: {wrong_spell}")
            configured_book = (
                'item replace entity MawSmokeA weapon.mainhand with '
                'ars_nouveau:novice_spell_book[ars_nouveau:spell_caster='
                '{current_slot:0,max_slots:10,spells:{"0":{name:"Smoke Heal",'
                'color:{id:"ars_nouveau:constant",r:255,g:25,b:180},sound:{},'
                'recipe:["ars_nouveau:glyph_self","ars_nouveau:glyph_heal"]}}}]'
            )
            process.stdin.write(configured_book + "\n")
            process.stdin.flush()
            learned = console_command(process, log_path, f"maw_agent spell list {bodies[0]}")
            if (learned.get("ok") is not True or not any(
                    spell.get("id") == "ars_nouveau:slot_0"
                    and spell.get("glyphs") == ["ars_nouveau:glyph_self", "ars_nouveau:glyph_heal"]
                    for spell in learned.get("spells", []))):
                raise ValueError(f"Agent could not inspect configured Ars book: {learned}")
            explained = console_command(process, log_path,
                                        f"maw_agent spell explain {bodies[0]} ars_nouveau:slot_0")
            if (explained.get("ok") is not True or explained.get("name") != "Smoke Heal"
                    or explained.get("manaCost") != 60):
                raise ValueError(f"Agent could not explain configured Ars spell: {explained}")
            mana_deadline = time.monotonic() + 90
            while learned["mana"]["current"] < explained["manaCost"] and time.monotonic() < mana_deadline:
                time.sleep(2)
                learned = console_command(process, log_path, f"maw_agent spell list {bodies[0]}")
            if learned["mana"]["current"] < explained["manaCost"]:
                raise ValueError(f"Ars mana did not recover enough for test cast: {learned}")
            process.stdin.write("damage MawSmokeA 8\n")
            process.stdin.flush()
            injured_roster = console_command(process, log_path, "maw_agent list")
            injured = next(row for row in injured_roster["bodies"] if row["bodyUuid"] == bodies[0])
            if not injured["health"] < injured["maxHealth"] - 5:
                raise ValueError(f"Smoke body could not be injured for healing test: {injured}")
            actual_cast = console_command(process, log_path,
                                          f"maw_agent spell cast {bodies[0]} ars_nouveau:slot_0")
            time.sleep(1)
            healed_roster = console_command(process, log_path, "maw_agent list")
            healed = next(row for row in healed_roster["bodies"] if row["bodyUuid"] == bodies[0])
            if (actual_cast.get("ok") is not True
                    or actual_cast.get("manaAfter", 1000) >= actual_cast.get("manaBefore", 0)
                    or healed["health"] <= injured["health"]):
                raise ValueError(f"Configured Ars heal had no observed effect: {actual_cast}, {injured}, {healed}")
            no_mana_cast = console_command(process, log_path,
                                           f"maw_agent spell cast {bodies[0]} ars_nouveau:slot_0")
            if (no_mana_cast.get("ok") is not False
                    or no_mana_cast.get("code") != "ars_cast_not_confirmed"
                    or no_mana_cast.get("manaSpent") != 0):
                raise ValueError(f"Ars cast without enough mana was misreported: {no_mana_cast}")
            for item in ("farmersdelight:cooking_pot", "create:shaft",
                         "ars_nouveau:novice_spell_book", "mcwroofs:oak_roof",
                         "mcwbridges:oak_bridge_pier"):
                args_json = json.dumps({"item_id": item}, separators=(",", ":"))
                receipt = console_command(process, log_path,
                                          f"maw_agent invoke {bodies[0]} lookup_recipe {args_json}")
                reply = receipt.get("reply") or {}
                if (receipt.get("ok") is not True or receipt.get("resultKnown") is not True
                        or reply.get("success") is not True
                        or "recipe(s) for" not in reply.get("message", "")):
                    raise ValueError(f"Agent could not read the {item} recipe: {receipt}")
            locations = {}
            for body, structure in zip(bodies, ("dungeoncrawl:dungeon",
                                                "betterdungeons:skeleton_dungeon")):
                args_json = json.dumps({"structure": structure}, separators=(",", ":"))
                issued = console_command(process, log_path,
                                         f"maw_agent invoke {body} locate_structure {args_json}")
                if issued.get("ok") is not True or issued.get("bodyUuid") != body or not issued.get("callId"):
                    raise ValueError(f"Agent dungeon search was not accepted: {issued}")
                locations[body] = (structure, issued["callId"])
            pending = set(locations)
            deadline = time.monotonic() + 60
            while pending and time.monotonic() < deadline:
                for body in list(pending):
                    structure, call_id = locations[body]
                    receipt = console_command(process, log_path, f"maw_agent receipt {body} {call_id}")
                    if receipt.get("ok") is not True or receipt.get("bodyUuid") != body:
                        raise ValueError(f"Agent dungeon receipt was misrouted: {receipt}")
                    if not receipt.get("finalKnown"):
                        continue
                    outcome = receipt.get("outcome") or {}
                    data = outcome.get("data") or {}
                    if (outcome.get("success") is not True or data.get("structure") != structure
                            or data.get("found") is not True
                            or not all(isinstance(data.get(axis), int) for axis in ("x", "y", "z"))):
                        raise ValueError(f"Agent dungeon search returned no absolute location: {receipt}")
                    pending.remove(body)
                if pending:
                    time.sleep(0.5)
            if pending:
                raise TimeoutError(f"Agent dungeon searches did not finish for {sorted(pending)}: {log_path}")
            wrong_body = console_command(process, log_path,
                                         f"maw_agent receipt {bodies[1]} {locations[bodies[0]][1]}")
            if wrong_body.get("ok") is not False or wrong_body.get("code") != "unknown_or_expired_receipt":
                raise ValueError(f"Dungeon receipt leaked to another body: {wrong_body}")
            trial_args = json.dumps({"structure": "dungeoneer:cobblestone_dungeon"}, separators=(",", ":"))
            issued = console_command(process, log_path,
                                     f"maw_agent invoke {bodies[0]} locate_structure {trial_args}")
            if issued.get("ok") is not True or not issued.get("callId"):
                raise ValueError(f"Agent trial dungeon search was not accepted: {issued}")
            trial_location = None
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                trial_location = console_command(process, log_path,
                                                 f"maw_agent receipt {bodies[0]} {issued['callId']}")
                if trial_location.get("finalKnown"):
                    break
                time.sleep(0.5)
            trial_outcome = (trial_location or {}).get("outcome") or {}
            trial_data = trial_outcome.get("data") or {}
            if (trial_outcome.get("success") is not True
                    or trial_data.get("structure") != "dungeoneer:cobblestone_dungeon"
                    or trial_data.get("found") is not True
                    or not all(isinstance(trial_data.get(axis), int) for axis in ("x", "y", "z"))):
                raise ValueError(f"Boss dungeon location was unavailable to the Agent: {trial_location}")
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
    # Authlib may fail to refresh Mojang's public key on this loopback-only,
    # explicitly offline lab. Preserve that fact in the result without hiding
    # server/mod errors, which still fail the smoke test.
    key_fetch_errors = [line for line in content.splitlines()
                        if "[Yggdrasil Key Fetcher/ERROR]" in line
                        and "Failed to request yggdrasil public key" in line]
    errors = [line for line in content.splitlines()
              if ("/ERROR]" in line or "/FATAL]" in line) and line not in key_fetch_errors]
    if process.returncode != 0 or missing or errors or "All dimensions are saved" not in content:
        raise RuntimeError(f"Lab smoke failed (exit={process.returncode}, missing={missing}, "
                           f"errors={errors[:3]}): {log_path}")
    return {"ok": True, "exitCode": process.returncode, "port": PORT,
            "minecraftVersion": status["version"]["name"], "displayName": "My Agent World",
            "mods": list(REQUIRED_MODS), "agentChecks": ["two_owners", "two_bodies", "cli_commands", "per_body_status",
                                                   "native_ars_spell_catalog", "unearned_cast_rejected",
                                                   "configured_ars_heal_effect", "no_mana_cast_rejected",
                                                   "content_recipe_lookup", "dungeon_absolute_locations",
                                                   "boss_trial_absolute_location",
                                                   "receipt_body_isolation", "unknown_tool_rejected", "body_cleanup"],
            "offlineKeyFetchWarnings": len(key_fetch_errors),
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
