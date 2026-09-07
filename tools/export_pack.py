"""Export a local, self-contained .mrpack from the explicit client file lock.

Format reference (official, checked 2026-09-07):
https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack

No recursive instance export: only locked files and explicitly named additions
are eligible. Game binaries, launcher state, worlds and generated credentials
are never included. Minecraft/NeoForge are declared as installer dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

from pack_builder import ROOT, digest, safe_relative

FORMAT_SOURCE = "https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack"
DENY_NAME = re.compile(r"(?:fingerprint|accounts?|credentials?|secrets?|tokens?|sessions?|usercache|^\.env$)", re.I)
OPTIONS_PRIVATE_KEYS = {"lastServer", "joinedFirstServer", "realmsNotifications"}
MODEL_ROOTS = {f"config/yes_steve_model/custom/{model}/" for model in ("qiandengji_naruto", "qiandengji_kirito")}
MODEL_TARGET = {"minecraft": "1.21.1", "neoforge": "21.1.248", "ysm": "2.6.5"}


def allowed_path(name: str) -> Path:
    path = safe_relative(name)
    normalized = path.as_posix()
    if not (normalized.startswith(("mods/", "config/", "resourcepacks/", "tlm_custom_pack/")) or normalized in ("options.txt", "icon.png")):
        raise ValueError(f"File outside export allowlist: {name}")
    if any(DENY_NAME.search(part) for part in path.parts) or path.suffix.lower() in (".bak", ".log", ".tmp"):
        raise ValueError(f"Personal/generated file may not be exported: {name}")
    if normalized.startswith("mods/") and (len(path.parts) != 2 or path.suffix != ".jar"):
        raise ValueError(f"Only direct .jar files allowed in mods: {name}")
    if normalized.startswith("tlm_custom_pack/") and (len(path.parts) != 2 or path.suffix != ".zip"):
        raise ValueError(f"Only direct voice-pack ZIPs allowed: {name}")
    if normalized.startswith("config/yes_steve_model/") and not any(normalized.startswith(prefix) for prefix in MODEL_ROOTS):
        raise ValueError(f"Only the two explicitly locked custom YSM models may be exported: {name}")
    return path


def load_model_lock(root: Path, target: dict) -> dict[str, dict]:
    """Require all and only the managed model files; hashes are never relaxed."""
    file = root / "manifests/game-models.lock.json"
    if not file.is_file():
        raise ValueError("Missing explicit game-models.lock.json")
    lock = json.loads(file.read_text(encoding="utf-8"))
    if lock.get("schema_version") != 1 or lock.get("target") != MODEL_TARGET:
        raise ValueError("Unexpected game model lock target/schema")
    if any(target.get(key) != MODEL_TARGET[key] for key in ("minecraft", "neoforge")):
        raise ValueError("Game models do not match the client Minecraft/NeoForge target")
    client = root / "client"
    result = {}
    for row in lock["files"]:
        name = row["path"]
        if not any(name.startswith(prefix) for prefix in MODEL_ROOTS) or name in result:
            raise ValueError("Unexpected or duplicate path in game model lock: " + name)
        path = client / allowed_path(name)
        if not re.fullmatch(r"[0-9a-f]{64}", row.get("sha256", "")):
            raise ValueError("Malformed game model SHA256: " + name)
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(client.resolve()):
            raise ValueError("Missing, linked, or external game model source: " + name)
        if path.stat().st_size != row.get("size") or digest(path) != row["sha256"]:
            raise ValueError("Game model differs from lock: " + name)
        result[name] = row
    for prefix in MODEL_ROOTS:
        folder = client / prefix
        expected = {name for name in result if name.startswith(prefix)}
        if not expected or prefix + "ysm.json" not in expected:
            raise ValueError("Missing model manifest in explicit lock: " + prefix)
        actual = {p.relative_to(client).as_posix() for p in folder.rglob("*") if p.is_file()}
        if actual != expected:
            raise ValueError("Model directory contains missing or unlocked files: " + prefix)
        if any(p.is_symlink() for p in folder.rglob("*")) or folder.is_symlink():
            raise ValueError("Model directory contains a symlink: " + prefix)
    return result


def export_pack(root: Path, output: Path, version: str, extra_files: list[str] | None = None) -> dict:
    lock = json.loads((root / "manifests/client.lock.json").read_text(encoding="utf-8"))
    client = root / "client"
    planned = {row["path"]: row for row in lock["files"]}
    model_files = load_model_lock(root, lock["target"])
    for name in planned:
        if name.startswith("config/yes_steve_model/") and name not in model_files:
            raise ValueError("Unapproved YSM file in client lock: " + name)
    planned.update(model_files)
    voice_lock = root / "manifests/voice-packs.lock.json"
    if voice_lock.is_file():
        for row in json.loads(voice_lock.read_text(encoding="utf-8"))["files"]:
            if not row["path"].startswith("tlm_custom_pack/"):
                raise ValueError("Unexpected path in voice pack lock")
            if digest(client / allowed_path(row["path"])) != row["sha256"]:
                raise ValueError("Voice pack differs from lock: " + row["path"])
            planned[row["path"]] = row
    for name in extra_files or []:
        allowed_path(name)
        if name.startswith("mods/"):
            raise ValueError("Additional mods must be selected and validated by pack_builder first")
        if name.startswith("config/yes_steve_model/") and name not in model_files:
            raise ValueError("Additional YSM files must be in the explicit model lock")
        planned.setdefault(name, {"path": name})
    # Scan filenames only. Additional/removed JARs indicate a stale build lock.
    expected_jars = {name for name in planned if name.startswith("mods/")}
    actual_jars = {path.relative_to(client).as_posix() for path in (client / "mods").glob("*.jar")}
    if expected_jars != actual_jars:
        raise ValueError(f"Client mod set differs from validated lock: added={sorted(actual_jars - expected_jars)}, missing={sorted(expected_jars - actual_jars)}")
    entries: list[dict] = []
    for name, row in sorted(planned.items()):
        path = client / allowed_path(name)
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Missing or symlink export source: {name}")
        if not path.resolve().is_relative_to(client.resolve()):
            raise ValueError(f"Export path resolves outside client directory: {name}")
        if (name.startswith("mods/") or name in model_files) and digest(path) != row["sha256"]:
            raise ValueError(f"JAR or model differs from validated lock: {name}")
        # Non-JAR settings may be edited by the project's configuration tools.
        # They are included by explicit locked path, never discovered recursively.
        data = path.read_bytes()
        modified_since_build = bool(row.get("sha256") and hashlib.sha256(data).hexdigest() != row["sha256"])
        sanitized = False
        if name == "options.txt":
            lines = data.decode("utf-8-sig").splitlines()
            clean = [line for line in lines if line.split(":", 1)[0] not in OPTIONS_PRIVATE_KEYS]
            sanitized = len(lines) != len(clean)
            data = ("\n".join(clean) + "\n").encode("utf-8")
        entries.append({"path": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                        "sha512": hashlib.sha512(data).hexdigest(), "privacy_sanitized": sanitized,
                        "modified_since_build": modified_since_build,
                        "source_path": path, "data": data if name == "options.txt" else None})
    index = {"formatVersion": 1, "game": "minecraft", "versionId": version,
             "name": "异世界千灯纪", "summary": "本地整合版 · Minecraft 1.21.1 / NeoForge · 独立客户端",
             "files": [], "dependencies": {"minecraft": lock["target"]["minecraft"], "neoforge": lock["target"]["neoforge"]}}
    embedded_lock = {"schema_version": 1, "version": version, "target": lock["target"],
                     "game_models": {"target": MODEL_TARGET, "files": list(model_files.values())},
                     "files": [{key: value for key, value in row.items() if key not in ("source_path", "data")} for row in entries]}
    if output.suffix != ".mrpack":
        raise ValueError("Output filename must end in .mrpack")
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(output.name + ".tmp")
    try:
        with zipfile.ZipFile(temp, "w", allowZip64=True) as archive:
            _write(archive, "modrinth.index.json", json.dumps(index, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")
            for row in entries:
                payload = row["data"] if row["data"] is not None else row["source_path"].read_bytes()
                if hashlib.sha256(payload).hexdigest() != row["sha256"]:
                    raise ValueError(f"File changed during export: {row['path']}")
                _write(archive, "overrides/" + row["path"], payload)
            _write(archive, "overrides/qiandeng-pack.lock.json", json.dumps(embedded_lock, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")
        verified = verify_pack(temp)
        temp.replace(output)
    finally:
        if temp.exists():
            temp.unlink()  # This exact temporary output belongs to this exporter.
    report = {"status": "exported_and_verified", "artifact": output.name, "size": output.stat().st_size,
              "sha256": digest(output), "version": version, "format_source": FORMAT_SOURCE,
              "jar_count": len(expected_jars), "override_file_count": len(entries),
              "game_model_count": len(MODEL_ROOTS), "game_model_file_count": len(model_files),
              "dependencies": index["dependencies"], "all_mods_embedded_in_overrides": True,
              "downloads_in_index": 0, "contains_mojang_game_binary": False,
              "launchers_import_tested": False,
              "verification": verified,
              "modified_since_build_files": [row["path"] for row in entries if row["modified_since_build"]],
              "privacy_sanitized_files": [row["path"] for row in entries if row["privacy_sanitized"]]}
    (root / "reports").mkdir(parents=True, exist_ok=True)
    (root / "reports/pack-export.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    output.with_name(output.name + ".sha256").write_text(f"{report['sha256']}  {output.name}\n", encoding="utf-8")
    return report


def _write(archive: zipfile.ZipFile, name: str, payload: bytes) -> None:
    entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    entry.create_system = 3
    entry.external_attr = 0o100644 << 16
    entry.compress_type = zipfile.ZIP_STORED if name.endswith((".jar", ".zip", ".png")) else zipfile.ZIP_DEFLATED
    archive.writestr(entry, payload)


def verify_pack(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate package entries")
        if archive.testzip() is not None:
            raise ValueError("Package ZIP CRC failure")
        index = json.loads(archive.read("modrinth.index.json"))
        if index.get("formatVersion") != 1 or index.get("game") != "minecraft" or index.get("files") != []:
            raise ValueError("Unexpected local mrpack index format")
        if set(index.get("dependencies", {})) != {"minecraft", "neoforge"}:
            raise ValueError("Missing Minecraft/NeoForge installer dependencies")
        lock = json.loads(archive.read("overrides/qiandeng-pack.lock.json"))
        models = lock.get("game_models")
        if models is not None:
            if models.get("target") != MODEL_TARGET:
                raise ValueError("Embedded game model target mismatch")
            model_rows = models["files"]
            model_names = {row["path"] for row in model_rows}
            if len(model_names) != len(model_rows) or not all(any(name.startswith(prefix) for prefix in MODEL_ROOTS) for name in model_names):
                raise ValueError("Unexpected embedded game model files")
            if any(prefix + "ysm.json" not in model_names for prefix in MODEL_ROOTS):
                raise ValueError("Missing one of the two model manifests")
            actual_model_names = {name.removeprefix("overrides/") for name in names if name.startswith("overrides/config/yes_steve_model/")}
            if actual_model_names != model_names:
                raise ValueError("Archive YSM entries differ from the embedded model lock")
            for row in model_rows:
                data = archive.read("overrides/" + allowed_path(row["path"]).as_posix())
                if len(data) != row["size"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
                    raise ValueError("Embedded game model hash mismatch")
        elif any(name.startswith("overrides/config/yes_steve_model/") for name in names):
            raise ValueError("YSM files lack an embedded model lock")
        expected = {"modrinth.index.json", "overrides/qiandeng-pack.lock.json"}
        for row in lock["files"]:
            relative = allowed_path(row["path"]).as_posix()
            name = "overrides/" + relative
            expected.add(name)
            data = archive.read(name)
            if len(data) != row["size"] or hashlib.sha256(data).hexdigest() != row["sha256"] or hashlib.sha512(data).hexdigest() != row["sha512"]:
                raise ValueError(f"Package file hash/size mismatch: {relative}")
        if set(names) != expected:
            raise ValueError("Unexpected or missing package files")
    return {"zip_crc": "passed", "override_hashes": "passed", "allowlist": "passed", "index_format": "passed"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--version", default="0.1.2-local")
    parser.add_argument("--include-relative", action="append", default=[])
    parser.add_argument("--verify", type=Path)
    args = parser.parse_args()
    try:
        if args.verify:
            report = verify_pack(args.verify)
        else:
            output = args.output or args.root / "dist" / f"QiandengJi-1.21.1-{args.version}.mrpack"
            report = export_pack(args.root.resolve(), output, args.version, args.include_relative)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as exc:
        print(f"Export failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
