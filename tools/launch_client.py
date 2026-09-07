"""Launch the local integration client using the user's existing Minecraft cache.

No account data is read. The validation player uses an offline identity and can
only join servers that permit offline accounts. The original instance is read-only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MC = Path(os.environ.get("APPDATA", "")) / ".minecraft"


def allowed(rules, features):
    if not rules:
        return True
    result = False
    for rule in rules:
        system = rule.get("os", {})
        if system.get("name", "windows") != "windows":
            continue
        if system.get("arch", "amd64") not in ("amd64", "x86_64"):
            continue
        if "version" in system and not re.search(system["version"], os.sys.getwindowsversion().__str__()):
            continue
        if any(features.get(k, False) != v for k, v in rule.get("features", {}).items()):
            continue
        result = rule.get("action") == "allow"
    return result


def resolve_arguments(items, replacements, features):
    out = []
    for item in items:
        if isinstance(item, dict):
            if not allowed(item.get("rules"), features):
                continue
            values = item["value"]
            values = values if isinstance(values, list) else [values]
        else:
            values = [item]
        for value in values:
            for key, replacement in replacements.items():
                value = value.replace("${" + key + "}", str(replacement))
            if "${" in value:
                raise ValueError("Unresolved launch placeholder: " + value)
            out.append(value)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--minecraft", type=Path, default=DEFAULT_MC)
    ap.add_argument("--java", type=Path, default=Path(r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\java.exe"))
    ap.add_argument("--username", default="QiandengTest")
    ap.add_argument("--server", default="")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--interactive", action="store_true", help="Ask for the original player name")
    ap.add_argument("--memory", default="6G")
    ap.add_argument("--qa-controls", action="store_true", help="Enable restricted game screenshot hooks for QiandengTest only")
    args = ap.parse_args()
    if args.interactive:
        args.username = input("Original Minecraft player name (same spelling/case): ").strip()
    if not re.fullmatch(r"[A-Za-z0-9_]{3,16}", args.username):
        ap.error("Username must be 3-16 ASCII letters, digits or underscores")
    if args.qa_controls and args.username != "QiandengTest":
        ap.error("QA controls require the reserved QiandengTest identity")
    source = args.minecraft / "versions" / "Rapid Optimization"
    version = json.loads((source / "Rapid Optimization.json").read_text(encoding="utf-8-sig"))
    client = ROOT / "client"
    native_dir = ROOT / "runtime" / "natives"
    native_dir.mkdir(parents=True, exist_ok=True)
    features = {"is_quick_play_multiplayer": bool(args.server), "has_quick_plays_support": True}
    libraries = []
    native_archives = []
    missing = []
    for entry in version["libraries"]:
        if not allowed(entry.get("rules"), features):
            continue
        artifact = entry.get("downloads", {}).get("artifact")
        if artifact:
            target = args.minecraft / "libraries" / artifact["path"]
            libraries.append(target)
            if not target.is_file():
                missing.append(str(target))
            if "natives-windows" in entry.get("name", ""):
                native_archives.append(target)
        native_name = entry.get("natives", {}).get("windows")
        if native_name:
            native_name = native_name.replace("${arch}", "64")
            native = entry.get("downloads", {}).get("classifiers", {}).get(native_name)
            if native:
                target = args.minecraft / "libraries" / native["path"]
                native_archives.append(target)
                if not target.is_file():
                    missing.append(str(target))
    game_jar = source / "Rapid Optimization.jar"
    libraries.append(game_jar)
    for required in (game_jar, args.java, args.minecraft / "assets" / "indexes" / (version["assets"] + ".json")):
        if not required.is_file():
            missing.append(str(required))
    if missing:
        print(json.dumps({"missing_cache_files": sorted(set(missing))}, ensure_ascii=False, indent=2))
        return 2
    digest = bytearray(hashlib.md5(("OfflinePlayer:" + args.username).encode()).digest())
    digest[6] = (digest[6] & 0x0F) | 0x30
    digest[8] = (digest[8] & 0x3F) | 0x80
    replacements = {
        "auth_player_name": args.username, "version_name": "QiandengJi",
        "game_directory": client, "assets_root": args.minecraft / "assets",
        "assets_index_name": version["assets"], "auth_uuid": uuid.UUID(bytes=bytes(digest)).hex,
        "auth_access_token": "0", "clientid": "", "auth_xuid": "", "user_type": "legacy",
        "version_type": "QiandengJi integration", "natives_directory": native_dir,
        "launcher_name": "QiandengJi-local", "launcher_version": "0.1.0",
        "classpath": os.pathsep.join(map(str, dict.fromkeys(libraries))),
        "classpath_separator": os.pathsep, "library_directory": args.minecraft / "libraries",
        "primary_jar_name": game_jar.name,
        "resolution_width": "1280", "resolution_height": "720",
        "quickPlayPath": ROOT / "runtime" / "quickplay.json", "quickPlayMultiplayer": args.server,
    }
    arguments = version["arguments"]
    command = [f"-Xms1G", f"-Xmx{args.memory}", "-Dfile.encoding=UTF-8"]
    if args.qa_controls:
        command.append("-Dqiandeng.controls.qa=true")
    command += resolve_arguments(arguments.get("jvm", []), replacements, features)
    command += [version["mainClass"]]
    command += resolve_arguments(arguments.get("game", []), replacements, features)
    if args.server and "--quickPlayMultiplayer" not in command:
        command += ["--quickPlayMultiplayer", args.server]
    result = {"java": str(args.java), "client": str(client), "libraries": len(libraries),
              "username": args.username, "server": args.server, "cache_complete": True}
    if args.check:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    for archive in native_archives:
        with zipfile.ZipFile(archive) as z:
            for entry in z.infolist():
                if entry.filename.lower().endswith(".dll"):
                    (native_dir / Path(entry.filename).name).write_bytes(z.read(entry))
    runtime = ROOT / "runtime"
    argfile = runtime / "client-args.txt"
    # Java argument files use backslash escapes even on Windows.
    argfile.write_text("\n".join('"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"' for s in command), encoding="utf-8")
    with (runtime / "client-console.log").open("wb") as output:
        child = subprocess.Popen([str(args.java), "@" + str(argfile)], cwd=client,
                                 stdout=output, stderr=subprocess.STDOUT,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
    result["pid"] = child.pid
    (runtime / "client-process.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
