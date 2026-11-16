"""Add the same verified client wheel to both published Android import packs."""
import argparse
from pathlib import Path
import io
import json
import tomllib
import zipfile

from build import archive, digest, encoded


WHEEL = "qiandeng-controls-0.1.2.jar"
WHEEL_SHA256 = "13d33c6fe65974a5b7b52db977c044711cb18737f84abbc34704c1ec9fdc1420"
ORIGINALS = {
    "android-native-client-pack": ("1.0.0-preview.4", "1.0.0-preview.5",
                                   "ccf0f717a2385c9731222fd78553c8a0ea758117ba288f224e2ebf021dc6599c"),
    "android-client-pack": ("1.0.0-preview.1", "1.0.0-preview.5-touch",
                            "0da4f0207be0a9ebdb5935da64493e0c14df5798697474087eab102412b70220"),
}
INTRO = "手持技能罗盘，潜行并按「使用／放置」，点轮盘里的技能图标施放。"
GUIDE = "\n\n## 触屏施法轮盘\n\n" + INTRO + " 手柄同样使用潜行和使用键。键盘可按 F6。\n"


def wheel_input(path):
    data = path.read_bytes()
    if digest(data) != WHEEL_SHA256:
        raise ValueError("Unexpected spell wheel build")
    with zipfile.ZipFile(io.BytesIO(data)) as jar:
        meta = tomllib.loads(jar.read("META-INF/neoforge.mods.toml").decode())
        mod, = meta["mods"]
        dependencies = {row["modId"]: row["type"] for row in meta["dependencies"][mod["modId"]]}
        if ((mod["modId"], mod["version"]) != ("qiandeng_controls", "0.1.2")
                or dependencies.get("controlify") != "optional"
                or "dev/qiandeng/controls/SpellWheelScreen.class" not in jar.namelist()):
            raise ValueError("Android requires the wheel with an optional desktop controller adapter")
    return data


def upgrade(base, wheel, row):
    previous, latest, checksum = ORIGINALS[row["id"]]
    data = base.read_bytes()
    if digest(data) != checksum:
        raise ValueError("Unexpected Android base pack")
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        entries = source.namelist()
        if len(entries) != len(set(entries)):
            raise ValueError("Duplicate entry in Android base pack")
        contents = {name: source.read(name) for name in entries}
    index_path = "modrinth.index.json"
    doc_path = "overrides/README-Qiandengji-Android.md"
    manifest_path = "overrides/qiandengji-android-manifest.json"
    wheel_path = "overrides/mods/" + WHEEL
    index = json.loads(contents[index_path])
    manifest = json.loads(contents[manifest_path])
    if index["versionId"] != previous or manifest["version"] != previous or wheel_path in contents:
        raise ValueError("Unexpected Android base version")
    index["versionId"] = latest
    index["summary"] += " 含千灯纪触屏施法轮盘。"
    manifest["version"] = latest
    manifest["spellWheel"] = {"version": "0.1.2", "sha256": digest(wheel),
                              "open": "sneak-use-skill-compass", "androidDeviceVerified": False}
    manifest["contents"].append("qiandeng_controls 0.1.2")
    contents[index_path] = encoded(index)
    contents[doc_path] += GUIDE.encode("utf-8")
    contents[manifest_path] = encoded(manifest)
    contents[wheel_path] = wheel
    packed = archive(contents)
    filename = f"qiandengji-android-1.21.1-neoforge-{latest}.mrpack"
    return filename, packed, {
        **row, "version": latest, "filename": filename, "bytes": len(packed), "sha256": digest(packed),
        "includes": row["includes"].removesuffix(INTRO) + INTRO,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("native-base", "touch-base", "wheel", "catalog", "output"):
        parser.add_argument("--" + arg, type=Path, required=True)
    parser.add_argument("--verify-catalog", action="store_true")
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_bytes())
    bases = dict(zip(ORIGINALS, (args.native_base, args.touch_base)))
    wheel = wheel_input(args.wheel)
    artifacts = [upgrade(bases[row["id"]], wheel, row) for row in catalog]
    rows = [row for _, _, row in artifacts]
    if {row["id"] for row in rows} != set(ORIGINALS) or len(rows) != len(ORIGINALS):
        raise ValueError("Expected both Android download rows")
    if args.verify_catalog and rows != catalog:
        raise ValueError("Android download catalog does not match the reproduced packs")
    args.output.mkdir(parents=True, exist_ok=True)
    for filename, data in [(name, data) for name, data, _ in artifacts] + [
        ("android-client-downloads.json", encoded(rows))
    ]:
        target = args.output / filename
        if target.exists():
            if target.read_bytes() != data:
                raise ValueError("Immutable output already exists: " + filename)
        else:
            target.write_bytes(data)
    print(json.dumps([{"version": row["version"], "sha256": row["sha256"], "bytes": row["bytes"]}
                      for row in rows]))


if __name__ == "__main__":
    main()
