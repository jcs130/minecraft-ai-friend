"""Build an isolated Minecraft client from local, explicitly selected mod sources.

Python 3.11+, standard library only. Never reads server configuration or downloads
Minecraft, mods, credentials, or launcher files. Run --inventory to inspect inputs.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, field
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import sys
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "content-mods.json"
MAX_NESTED_BYTES = 128 * 1024 * 1024


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def manifest_fields(raw: bytes) -> dict[str, str]:
    text = raw.decode("utf-8", errors="replace").replace("\r\n", "\n")
    text = text.replace("\n ", "")
    return dict(line.split(": ", 1) for line in text.splitlines() if ": " in line)


@dataclass
class Mod:
    id: str
    version: str
    name: str
    loader: str
    loader_range: str
    dependencies: list[dict] = field(default_factory=list)
    nested: str | None = None


@dataclass
class Jar:
    path: Path
    source: str
    sha256: str
    mods: list[Mod]
    warnings: list[str] = field(default_factory=list)

    @property
    def ids(self) -> set[str]:
        return {mod.id for mod in self.mods}

    @property
    def primary_ids(self) -> set[str]:
        return {mod.id for mod in self.mods if mod.nested is None}


def _inspect_archive(archive: zipfile.ZipFile, label: str, nested: str | None = None,
                     depth: int = 0) -> tuple[list[Mod], list[str]]:
    if depth > 4:
        raise ValueError(f"Excessive nested JAR depth: {label}")
    bad = archive.testzip()
    if bad:
        raise ValueError(f"Corrupt ZIP member in {label}: {bad}")
    names = set(archive.namelist())
    if len(names) != len(archive.namelist()):
        raise ValueError(f"Duplicate ZIP entry names in {label}")
    mf = manifest_fields(archive.read("META-INF/MANIFEST.MF")) if "META-INF/MANIFEST.MF" in names else {}
    result: list[Mod] = []
    warnings: list[str] = []
    metadata = next((name for name in ("META-INF/neoforge.mods.toml", "META-INF/mods.toml") if name in names), None)
    if metadata:
        data = tomllib.loads(archive.read(metadata).decode("utf-8-sig"))
        loader = str(data.get("modLoader", "unknown"))
        for row in data.get("mods", []):
            version = str(row.get("version", "unknown"))
            if version == "${file.jarVersion}":
                version = mf.get("Implementation-Version", "unknown")
            if "${" in version or version == "unknown":
                warnings.append(f"{label}: unresolved version for {row['modId']}: {version}")
            result.append(Mod(str(row["modId"]), version, str(row.get("displayName", row["modId"])),
                              loader, str(data.get("loaderVersion", "*")),
                              list(data.get("dependencies", {}).get(row["modId"], [])), nested))
    elif "fabric.mod.json" in names:
        data = json.loads(archive.read("fabric.mod.json"))
        result.append(Mod(data["id"], str(data.get("version", "unknown")), data.get("name", data["id"]),
                          "fabric", "*", [], nested))
    elif "quilt.mod.json" in names:
        data = json.loads(archive.read("quilt.mod.json"))["quilt_loader"]
        result.append(Mod(data["id"], str(data.get("version", "unknown")), data["id"], "quilt", "*", [], nested))
    if "META-INF/jarjar/metadata.json" in names:
        bundled = json.loads(archive.read("META-INF/jarjar/metadata.json"))
        for row in bundled.get("jars", []):
            name = row["path"]
            if name not in names:
                raise ValueError(f"Missing bundled JAR in {label}: {name}")
            if archive.getinfo(name).file_size > MAX_NESTED_BYTES:
                raise ValueError(f"Bundled JAR too large: {label}!{name}")
            with zipfile.ZipFile(io.BytesIO(archive.read(name))) as child:
                child_mods, child_warnings = _inspect_archive(child, f"{label}!{name}", name, depth + 1)
                result.extend(child_mods)
                warnings.extend(child_warnings)
    if not result and depth == 0 and mf.get("FMLModType") != "LIBRARY":
        warnings.append(f"{label}: no recognized mod metadata (may be a resource/data pack)")
    return result, warnings


def inspect_jar(path: Path, source: str) -> Jar:
    with zipfile.ZipFile(path) as archive:
        mods, warnings = _inspect_archive(archive, path.name)
    return Jar(path, source, digest(path), mods, warnings)


def discover(directory: Path, source: str) -> list[Jar]:
    if not directory.is_dir():
        raise ValueError(f"Source directory missing: {directory}")
    return [inspect_jar(path, source) for path in sorted(directory.glob("*.jar"), key=lambda p: p.name.casefold())]


def _version_tokens(version: str) -> list[int | str]:
    # Numeric components and Maven's customary qualifier ordering. Unknown forms
    # are reported as unverifiable instead of silently declaring compatibility.
    return [int(part) if part.isdigit() else part.lower()
            for part in re.findall(r"\d+|[A-Za-z]+", version)]


def compare_versions(left: str, right: str) -> int:
    if not left or not right or "${" in left + right or "unknown" in (left, right):
        raise ValueError("Unresolved version")
    qualifiers = {"alpha": -5, "a": -5, "beta": -4, "b": -4, "milestone": -3,
                  "m": -3, "rc": -2, "cr": -2, "snapshot": -1, "": 0,
                  "final": 0, "ga": 0, "release": 0, "sp": 1}
    # Preserve hyphen-separated release components: 1.21.1-2.6.22 is
    # newer than 1.21-2.3.0 (flattening digits would incorrectly reverse it).
    left_groups, right_groups = left.split("-"), right.split("-")
    for group in range(max(len(left_groups), len(right_groups))):
        a = _version_tokens(left_groups[group]) if group < len(left_groups) else []
        b = _version_tokens(right_groups[group]) if group < len(right_groups) else []
        for index in range(max(len(a), len(b))):
            x = a[index] if index < len(a) else (0 if isinstance(b[index], int) else "")
            y = b[index] if index < len(b) else (0 if isinstance(a[index], int) else "")
            if x == y:
                continue
            if isinstance(x, int) and isinstance(y, int):
                return (x > y) - (x < y)
            if isinstance(x, int) != isinstance(y, int):
                return 1 if isinstance(x, int) else -1
            qx, qy = qualifiers.get(x, 2), qualifiers.get(y, 2)
            if qx != qy:
                return (qx > qy) - (qx < qy)
            if qx == 2:
                return (x > y) - (x < y)
    return 0


def in_range(version: str, requirement: str) -> bool:
    spec = str(requirement).replace(" ", "")
    if spec in ("", "*", "(,)", "[,)" ):
        return True
    if not spec.startswith(("[", "(")):
        # Maven VersionRange treats a bare version as recommended, with an
        # unrestricted restriction list. Exact requirements use [version].
        return True
    segments = re.findall(r"[\[(][^\[\]()]*[\])]", spec)
    if not segments or ",".join(segments) != spec:
        raise ValueError(f"Unsupported version range: {requirement}")
    for segment in segments:
        inner = segment[1:-1]
        if "," not in inner:
            if segment[0] != "[" or segment[-1] != "]":
                raise ValueError(f"Invalid exact range: {requirement}")
            if compare_versions(version, inner) == 0:
                return True
            continue
        lower, upper = inner.split(",", 1)
        low = compare_versions(version, lower) if lower else 1
        high = compare_versions(version, upper) if upper else -1
        if (low > 0 or low == 0 and segment[0] == "[") and (high < 0 or high == 0 and segment[-1] == "]"):
            return True
    return False


def choose_candidate(candidates: list[Jar], mod_id: str) -> Jar:
    # Prefer canonical names over build aliases such as bc232-rebuilt.jar.
    hashes = {candidate.sha256 for candidate in candidates}
    if len(hashes) != 1:
        raise ValueError(f"Multiple different source JARs provide {mod_id}: " + ", ".join(c.path.name for c in candidates))
    return min(candidates, key=lambda c: (not c.path.name.lower().startswith(mod_id.replace("_", "-")), c.path.name.lower()))


def select_mods(base: list[Jar], server: list[Jar], config: dict) -> tuple[list[Jar], list[dict]]:
    selected = list(base)
    excluded = set(config["exclude_server_mod_ids"])
    source_by_id: dict[str, list[Jar]] = {}
    for jar in server:
        for mod_id in jar.ids:
            source_by_id.setdefault(mod_id, []).append(jar)
    decisions: list[dict] = []
    provided: dict[str, Jar] = {mod_id: jar for jar in selected for mod_id in jar.ids}
    for wanted in config["include_mod_ids"]:
        if wanted in excluded:
            raise ValueError(f"Requested mod is server-only/excluded: {wanted}")
        if wanted in provided:
            continue
        if wanted not in source_by_id:
            raise ValueError(f"Requested mod not found in local sources: {wanted}")
        jar = choose_candidate(source_by_id[wanted], wanted)
        _add_selected(jar, selected, provided, excluded)
    # Include only required dependencies relevant on the client. Nested JAR
    # metadata participates, so language providers/dependency libraries count.
    index = 0
    while index < len(selected):
        jar = selected[index]
        for mod in jar.mods:
            for dep in mod.dependencies:
                kind = str(dep.get("type", "required" if dep.get("mandatory", True) else "optional")).lower()
                dep_id = str(dep["modId"])
                if kind != "required" or str(dep.get("side", "BOTH")).upper() == "SERVER":
                    continue
                if dep_id in ("minecraft", "neoforge", "java") or dep_id in provided:
                    continue
                if dep_id in excluded:
                    raise ValueError(f"Client mod {mod.id} requires excluded server mod {dep_id}")
                candidates = source_by_id.get(dep_id, [])
                if not candidates:
                    raise ValueError(f"Missing required dependency: {mod.id} -> {dep_id}")
                dependency = choose_candidate(candidates, dep_id)
                _add_selected(dependency, selected, provided, excluded)
                decisions.append({"kind": "dependency_added", "required_by": mod.id, "id": dep_id, "file": dependency.path.name})
        index += 1
    for jar in server:
        existing = next((item for item in selected if item.sha256 == jar.sha256), None)
        if existing and existing.path != jar.path:
            decisions.append({"kind": "duplicate_omitted", "file": jar.path.name, "retained": existing.path.name, "sha256": jar.sha256})
    return selected, decisions


def _add_selected(jar: Jar, selected: list[Jar], provided: dict[str, Jar], excluded: set[str]) -> None:
    if any(item.sha256 == jar.sha256 for item in selected):
        return
    if jar.ids & excluded:
        raise ValueError(f"Selected JAR includes excluded mod IDs: {jar.path.name}: {sorted(jar.ids & excluded)}")
    collisions = jar.primary_ids & provided.keys()
    if collisions:
        raise ValueError(f"Different JARs provide duplicate mod IDs: {jar.path.name}: {sorted(collisions)}")
    selected.append(jar)
    for mod_id in jar.ids:
        provided.setdefault(mod_id, jar)


def validate_jars(selected: list[Jar], config: dict) -> dict:
    errors: list[str] = []
    warnings: list[str] = [message for jar in selected for message in jar.warnings]
    checks: list[dict] = []
    providers: dict[str, list[Mod]] = {}
    primaries: dict[str, list[str]] = {}
    for jar in selected:
        for mod in jar.mods:
            providers.setdefault(mod.id, []).append(mod)
            if mod.nested is None:
                primaries.setdefault(mod.id, []).append(jar.path.name)
    for mod_id, names in primaries.items():
        if len(names) > 1:
            errors.append(f"Duplicate top-level mod ID {mod_id}: {names}")
    target = config["target"]
    platform = {"minecraft": target["minecraft"], "neoforge": target["neoforge"], "java": str(target["java"])}
    suspicious = config.get("known_metadata_warnings", {})
    for jar in selected:
        for mod in jar.mods:
            if mod.loader in ("fabric", "quilt"):
                errors.append(f"Wrong loader: {mod.id} is {mod.loader}-only ({jar.path.name})")
                continue
            if mod.loader not in ("javafml", "lowcodefml", "kotlinforforge"):
                warnings.append(f"Unverified language loader {mod.loader}: {mod.id}")
            if mod.loader in ("javafml", "lowcodefml"):
                if any(character in mod.loader_range for character in "><="):
                    warnings.append(f"Non-Maven loader range is advisory, not enforced: {mod.id}: {mod.loader_range}")
                try:
                    if not in_range(target["fml"], mod.loader_range):
                        errors.append(f"FML range mismatch: {mod.id} requires {mod.loader_range}, found {target['fml']}")
                except ValueError as exc:
                    warnings.append(f"FML range unverified: {mod.id}: {exc}")
            for dep in mod.dependencies:
                if str(dep.get("side", "BOTH")).upper() == "SERVER":
                    continue
                dep_id = str(dep["modId"])
                kind = str(dep.get("type", "required" if dep.get("mandatory", True) else "optional")).lower()
                spec = str(dep.get("versionRange", "*"))
                versions = [platform[dep_id]] if dep_id in platform else [p.version for p in providers.get(dep_id, [])]
                record = {"mod": mod.id, "dependency": dep_id, "type": kind, "range": spec, "versions": versions}
                if not versions:
                    record["status"] = "missing" if kind == "required" else "not_installed"
                    if kind == "required":
                        errors.append(f"Missing required dependency: {mod.id} -> {dep_id} {spec}")
                else:
                    try:
                        matches = any(in_range(version, spec) for version in versions)
                        record["status"] = "satisfied" if matches else "outside_range"
                        if kind in ("incompatible", "discouraged"):
                            if matches:
                                message = f"{kind}: {mod.id} with {dep_id} {versions}: {dep.get('reason', spec)}"
                                (errors if kind == "incompatible" else warnings).append(message)
                        elif not matches and kind in ("required", "optional"):
                            message = f"Dependency range mismatch: {mod.id} -> {dep_id} {spec}, found {versions}"
                            key = f"{mod.id}:{dep_id}:{spec}"
                            aliases = config.get("loader_compatibility_aliases", {}).get(dep_id, [])
                            compatible_aliases = [alias for alias in aliases if in_range(alias, spec)]
                            if compatible_aliases:
                                record["status"] = "loader_builtin_compatibility_alias"
                                record["compatible_aliases"] = compatible_aliases
                                warnings.append(message + f"; FML {target['fml']} native compatibility aliases accept {compatible_aliases}. No dependency override added; launch verification required.")
                            elif key in suspicious:
                                record["status"] = "known_metadata_warning"
                                warnings.append(message + "; " + suspicious[key])
                            else:
                                errors.append(message)
                    except ValueError as exc:
                        record["status"] = "unverified_range"
                        warnings.append(f"Dependency range unverified: {mod.id} -> {dep_id}: {exc}")
                    if not spec.startswith(("[", "(")) and spec not in ("", "*"):
                        record["maven_recommended_version"] = True
                        if any(character in spec for character in "><="):
                            warnings.append(f"Non-Maven dependency range is advisory, not enforced: {mod.id} -> {dep_id}: {spec}")
                checks.append(record)
    for pair in config.get("additional_conflicts", []):
        if all(mod_id in providers for mod_id in pair):
            errors.append("Configured conflict: " + " + ".join(pair))
    return {"errors": sorted(set(errors)), "warnings": sorted(set(warnings)), "dependency_checks": checks,
            "jar_count": len(selected), "provided_mod_id_count": len(providers), "zip_integrity": "all_selected_archives_and_declared_nested_jars_passed"}


def safe_relative(raw: str) -> Path:
    path = Path(raw)
    if path.is_absolute() or ".." in path.parts or ":" in raw or raw.startswith(("/", "\\")):
        raise ValueError(f"Unsafe relative output path: {raw}")
    return path


def build(config: dict, root: Path) -> dict:
    base_root = Path(config["sources"]["base_pack"])
    server_mods = Path(config["sources"]["server_mods"])
    client = root / "client"
    if client.resolve() == base_root.resolve() or client.resolve() in server_mods.resolve().parents:
        raise ValueError("Output must not be a source/production directory")
    base = discover(base_root / "mods", "rapid_optimization")
    if len(base) != config["expected_base_jar_count"]:
        raise ValueError(f"Expected {config['expected_base_jar_count']} base JARs, found {len(base)}")
    server = discover(server_mods, "existing_content")
    selection_config = dict(config)
    selection_config['include_mod_ids'] = list(config['include_mod_ids'])
    extensions = []
    extension_locks = [(name, True) for name in config.get('client_extension_locks', [])]
    extension_locks += [(name, False) for name in config.get('shared_extension_locks', [])]
    for lock_name, client_only in extension_locks:
        extension = json.loads((root / safe_relative(lock_name)).read_text(encoding='utf-8'))
        if (extension.get('client_only') is not client_only or extension.get('minecraft') != config['target']['minecraft']
                or (not client_only and (extension.get('server_required') is not True or extension.get('neoforge') != config['target']['neoforge']))):
            raise ValueError('Extension scope/target mismatch: ' + lock_name)
        for row in extension['files']:
            path = root / safe_relative(row['cache_path'])
            if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink() or digest(path) != row['sha256']:
                raise ValueError('Client extension source differs from lock: ' + row['cache_path'])
            jar = inspect_jar(path, 'client_extension' if client_only else 'shared_extension')
            if row.get('client_only') is not client_only or row['mod_id'] not in jar.primary_ids:
                raise ValueError('Extension metadata mismatch: ' + path.name)
            extensions.append(jar)
            selection_config['include_mod_ids'].append(row['mod_id'])
    # Explicit extension JARs are top-level selections. A bundled older library
    # must not suppress a separately locked newer dependency (e.g. YACL).
    for jar in extensions:
        if jar.ids & set(config['exclude_server_mod_ids']):
            raise ValueError('Client extension includes an excluded server mod: ' + jar.path.name)
    selected, decisions = select_mods(base + extensions, server, selection_config)
    report = validate_jars(selected, config)
    report["base_jar_count"] = len(base)
    report["added_jar_count"] = len(selected) - len(base)
    report["decisions"] = decisions
    report["target"] = config["target"]
    report["launch_tested"] = False
    report["network_downloads"] = False
    report["selected_mods"] = [{"file": jar.path.name, "source": jar.source, "ids": sorted(jar.ids), "sha256": jar.sha256} for jar in selected]
    report["excluded_server_jars"] = [{"file": jar.path.name, "ids": sorted(jar.ids)} for jar in server
                                      if not any(jar.sha256 == item.sha256 for item in selected)]
    planned: dict[str, Path] = {}
    for jar in selected:
        relative = "mods/" + jar.path.name
        if relative in planned and digest(planned[relative]) != jar.sha256:
            raise ValueError(f"Destination name collision: {relative}")
        planned[relative] = jar.path
    excluded_names = set(config["exclude_base_files"])
    for dirname in ("config", "resourcepacks"):
        folder = base_root / dirname
        if not folder.is_dir():
            continue
        for path in sorted(folder.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(base_root).as_posix()
            if relative in excluded_names or path.suffix.lower() in (".bak", ".log"):
                continue
            if path.is_symlink():
                raise ValueError(f"Refusing source symlink: {relative}")
            planned[relative] = path
    for name in ("options.txt", "icon.png"):
        path = base_root / name
        if path.is_file() and name not in excluded_names:
            planned[name] = path
    lock_path = root / "manifests" / "client.lock.json"
    old = json.loads(lock_path.read_text(encoding="utf-8")) if lock_path.exists() else {}
    previous = {entry["path"]: entry for entry in old.get("files", [])}
    # Resolve all conflicts before copying. Existing human-edited configuration is
    # preserved and recorded; an unexpected JAR is never silently overwritten.
    preserved: list[str] = []
    for name, source in planned.items():
        output = client / safe_relative(name)
        if output.is_symlink() or any(parent.is_symlink() for parent in output.parents if parent != root.parent):
            raise ValueError(f"Refusing symlink destination: {output}")
        if output.exists() and digest(output) != digest(source):
            entry = previous.get(name)
            if name.startswith("mods/"):
                if not entry or digest(output) != entry["sha256"]:
                    report["errors"].append(f"Existing unowned/modified JAR would be overwritten: {name}")
            else:
                # Configuration can be managed by a separate project contributor.
                # Preserve every differing existing non-JAR file, including old
                # generated defaults; refreshing defaults requires explicit removal.
                preserved.append(name)
    report["preserved_existing_files"] = preserved
    report["warnings"].extend(f"Existing edited/configured file preserved: {name}" for name in preserved)
    actual_jar_names = {path.relative_to(client).as_posix() for path in (client / "mods").glob("*.jar")} if (client / "mods").exists() else set()
    for name in sorted(actual_jar_names - set(planned)):
        report["errors"].append(f"Unmanaged or obsolete JAR present; not deleted automatically: {name}")
    if report["errors"]:
        write_report(root, report)
        return report
    entries = []
    for name, source in sorted(planned.items()):
        output = client / safe_relative(name)
        output.parent.mkdir(parents=True, exist_ok=True)
        if name not in preserved and (not output.exists() or digest(output) != digest(source)):
            shutil.copy2(source, output)
        if name not in preserved and digest(output) != digest(source):
            raise ValueError(f"Copied file hash mismatch: {name}")
        entries.append({"path": name, "size": output.stat().st_size, "sha256": digest(output),
                        "source_sha256": digest(source), "source": "rapid_optimization" if source.is_relative_to(base_root) else ("client_extension" if any(source == jar.path for jar in extensions) else "existing_content"),
                        "preserved_existing": name in preserved})
    lock = {"schema_version": 1, "target": config["target"], "files": entries,
            "mods": report["selected_mods"], "excludes_game_binary": True}
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report["file_count"] = len(entries)
    report["lock_sha256"] = digest(lock_path)
    report["status"] = "built_with_warnings" if report["warnings"] else "built"
    write_report(root, report)
    return report


def write_report(root: Path, report: dict) -> None:
    folder = root / "reports"
    folder.mkdir(parents=True, exist_ok=True)
    if report["errors"]:
        report["status"] = "blocked"
    (folder / "client-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# Client build validation", "", f"Status: **{report['status']}**", "",
             f"Minecraft {report['target']['minecraft']} / NeoForge {report['target']['neoforge']} / Java {report['target']['java']}",
             f"Base JARs: {report['base_jar_count']}; added: {report['added_jar_count']}; total: {report['jar_count']}.",
             "", "Static inspection only; game launch and multiplayer compatibility remain untested.",
             "No downloads, launcher/account data, server configuration, saves, logs, or Mojang game binary are included.", "",
             "## Errors", ""]
    lines += ["- " + item for item in report["errors"]] or ["None."]
    lines += ["", "## Warnings", ""]
    lines += ["- " + item for item in report["warnings"]] or ["None."]
    lines += ["", "## Added content", "", "| File | Mod IDs |", "|---|---|"]
    lines += [f"| {item['file']} | {', '.join(item['ids'])} |" for item in report["selected_mods"] if item["source"] == "existing_content"]
    (folder / "client-validation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--inventory", action="store_true", help="Read local source metadata without building")
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text(encoding="utf-8-sig"))
        if args.inventory:
            for source, folder in (("base", Path(config["sources"]["base_pack"]) / "mods"),
                                   ("server", Path(config["sources"]["server_mods"]))):
                for jar in discover(folder, source):
                    print(json.dumps({"source": source, "file": jar.path.name, "sha256": jar.sha256,
                                      "mods": [{"id": mod.id, "version": mod.version, "loader": mod.loader,
                                                "dependencies": mod.dependencies, "nested": mod.nested} for mod in jar.mods],
                                      "warnings": jar.warnings}, ensure_ascii=False))
            return 0
        report = build(config, args.root.resolve())
        print(json.dumps({key: report[key] for key in ("status", "base_jar_count", "added_jar_count", "jar_count", "errors", "warnings")}, ensure_ascii=False, indent=2))
        return 1 if report["errors"] else 0
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, tomllib.TOMLDecodeError) as exc:
        print(f"Build failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
