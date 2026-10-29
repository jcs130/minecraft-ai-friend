"""Export a dedicated-server candidate, recording publisher-confirmed client mods."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import urllib.parse
import urllib.request

from prepare_pack import USER_AGENT, digest


def api(route, data=None):
    headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
    request = urllib.request.Request("https://api.modrinth.com/v2/" + route, headers=headers, data=json.dumps(data).encode() if data is not None else None)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def export(root):
    root = Path(root).resolve(strict=True)
    marker = json.loads((root / "pack-source.json").read_text("utf-8"))
    if marker.get("scope") != "isolated_testing":
        raise ValueError("Only marked isolated packs can be exported")
    resolution = json.loads((root / "pack-resolution.json").read_text("utf-8"))
    if not resolution.get("complete"):
        raise ValueError("Resolve the exact full client before exporting a server")
    client, server = root / "client", root / "server"
    metadata_file = root / "modrinth-side-evidence.json"
    jars = sorted((client / "mods").glob("*.jar"))
    hashes = {digest(path, "sha512"): path.name for path in jars}
    if metadata_file.exists():
        evidence = json.loads(metadata_file.read_text("utf-8"))
        if evidence["pack_sha256"] != marker["sha256"]:
            raise ValueError("Side evidence belongs to another pack")
        versions, projects = evidence["versions"], evidence["projects"]
    else:
        versions = api("version_files", {"hashes": list(hashes), "algorithm": "sha512"})
        ids = sorted({row["project_id"] for row in versions.values()})
        projects = {row["id"]: row for row in api("projects?" + urllib.parse.urlencode({"ids": json.dumps(ids)}))}
        evidence = {"source": "https://api.modrinth.com/v2", "pack_sha256": marker["sha256"], "versions": versions, "projects": projects}
        metadata_file.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    plan = []
    for sha512, name in hashes.items():
        version = versions.get(sha512)
        project = projects.get(version["project_id"], {}) if version else {}
        excluded = project.get("server_side") == "unsupported"
        plan.append({"filename": name, "sha256": digest(client / "mods" / name), "sha512": sha512, "include": not excluded, "reason": "publisher_declares_server_unsupported" if excluded else "retained_publisher_supported_or_unclassified", "project_id": project.get("id"), "project_slug": project.get("slug"), "server_side": project.get("server_side", "unknown")})
    mods = server / "mods"
    mods.mkdir(parents=True, exist_ok=True)
    planned = {row["filename"] for row in plan if row["include"]}
    unknown_existing = [path.name for path in mods.glob("*.jar") if path.name not in planned]
    if unknown_existing:
        raise ValueError("Review existing unplanned server mods: " + ", ".join(unknown_existing))
    for row in plan:
        if not row["include"]:
            continue
        source, target = client / "mods" / row["filename"], mods / row["filename"]
        if target.exists() and digest(target) != row["sha256"]:
            raise ValueError("Existing server mod changed: " + target.name)
        if not target.exists():
            shutil.copyfile(source, target)
    for folder in ("config", "defaultconfigs", "kubejs"):
        source = client / folder
        if source.exists():
            # Configuration is copied once. Subsequent boot-generated state is
            # never silently overwritten by another export.
            target = server / folder
            if target.exists():
                raise ValueError("Server configuration already exists; review before re-export")
            shutil.copytree(source, target, ignore=shutil.ignore_patterns("client_scripts") if folder == "kubejs" else None)
    record = {"pack_sha256": marker["sha256"], "candidate_only": True, "included": sum(row["include"] for row in plan), "excluded": sum(not row["include"] for row in plan), "mods": plan}
    (root / "server-export.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"included": record["included"], "excluded": [row["filename"] for row in plan if not row["include"]], "unclassified_retained": [row["filename"] for row in plan if row["server_side"] == "unknown"]}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    export(parser.parse_args().root)
