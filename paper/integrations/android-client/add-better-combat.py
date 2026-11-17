"""Reproduce the Android Better Combat packs from the published spell wheel packs."""
import argparse
import io
import json
from pathlib import Path
from zipfile import ZipFile

from build import archive, digest, encoded, load_input


ROOT = Path(__file__).resolve().parent
BASES = {
    "android-native-client-pack": (
        "1.0.0-preview.5", "1.0.0-preview.6", "21.1.252",
        "777b596169f422969558d7e7f83f5a3dbc896690f1a1ebe915e21cdd2e7a8e0c",
    ),
    "android-client-pack": (
        "1.0.0-preview.5-touch", "1.0.0-preview.6-touch", "21.1.248",
        "8d8d8b143fe800eeb79f13073de5c24fc1f2e08ce5b48d1e1d3c78b05e4c8389",
    ),
}
COMBAT = "包含 Better Combat 2.4.0、playerAnimator 2.0.4 和 Cloth Config API 15.0.140。"


def upgrade(base, row, mods):
    original, version, loader, checksum = BASES[row["id"]]
    data = base.read_bytes()
    if digest(data) != checksum:
        raise ValueError(f"Unexpected Android base for {row['id']}")
    with ZipFile(io.BytesIO(data)) as source:
        names = source.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate members in Android base pack")
        contents = {name: source.read(name) for name in names}

    index_path = "modrinth.index.json"
    manifest_path = "overrides/qiandengji-android-manifest.json"
    upstream_path = "overrides/LICENSES/UPSTREAM-SOURCES.json"
    guide_path = "overrides/README-Qiandengji-Android.md"
    index = json.loads(contents[index_path])
    manifest = json.loads(contents[manifest_path])
    upstream = json.loads(contents[upstream_path])
    if (index["versionId"] != original or manifest["version"] != original
            or index["dependencies"] != {"minecraft": "1.21.1", "neoforge": loader}
            or row["version"] not in (original, version)):
        raise ValueError(f"Unexpected Android version for {row['id']}")

    downloads = [
        {"path": "mods/" + mod["filename"], "fileSize": mod["bytes"],
         "hashes": {key: mod[key] for key in ("sha1", "sha512")},
         "env": {"client": "required", "server": "unsupported"}, "downloads": [mod["url"]]}
        for mod in mods
    ]
    existing_paths = {entry["path"] for entry in index["files"]}
    for entry in downloads:
        if entry["path"] in existing_paths or ("overrides/" + entry["path"]) in contents:
            raise ValueError("Duplicate combat mod: " + entry["path"])
    index["files"].extend(downloads)
    index["versionId"] = version
    index["summary"] += " " + COMBAT
    manifest["version"] = version
    manifest["contents"].extend(f"{mod['id']} {mod['version']}" for mod in mods)
    upstream["version"] = version
    upstream["files"].extend(mods)
    contents[index_path] = encoded(index)
    contents[manifest_path] = encoded(manifest)
    contents[upstream_path] = encoded(upstream)
    contents[guide_path] += ("\n\n## 战斗动作\n\n" + COMBAT + " 首次导入时由 FCL 下载。\n").encode()
    packed = archive(contents)
    filename = f"qiandengji-android-1.21.1-neoforge-{version}.mrpack"
    return filename, packed, {
        **row, "version": version, "filename": filename, "bytes": len(packed),
        "sha256": digest(packed), "includes": row["includes"].removesuffix(COMBAT) + COMBAT,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("native-base", "touch-base", "cache", "catalog", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--verify-catalog", action="store_true")
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_bytes())
    if len(catalog) != len(BASES) or {row["id"] for row in catalog} != set(BASES):
        raise ValueError("Expected both Android download rows")
    mods = json.loads((ROOT / "better-combat.lock.json").read_bytes())
    args.cache.mkdir(parents=True, exist_ok=True)
    for mod in mods:
        load_input(mod, args.cache)

    bases = dict(zip(BASES, (args.native_base, args.touch_base)))
    builds = [upgrade(bases[row["id"]], row, mods) for row in catalog]
    rows = [row for _, _, row in builds]
    if args.verify_catalog and rows != catalog:
        raise ValueError("Android download catalog does not match the reproduced packs")
    outputs = [(filename, data) for filename, data, _ in builds]
    outputs.append(("android-client-downloads.json", encoded(rows)))
    args.output.mkdir(parents=True, exist_ok=True)
    for filename, data in outputs:
        target = args.output / filename
        if target.exists() and target.read_bytes() != data:
            raise ValueError("Refusing to overwrite an existing release: " + filename)
        if not target.exists():
            target.write_bytes(data)
    print(json.dumps([{"version": row["version"], "sha256": row["sha256"], "bytes": row["bytes"]}
                      for row in rows]))


if __name__ == "__main__":
    main()
