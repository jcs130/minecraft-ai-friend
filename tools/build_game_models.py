"""Build native YSM 2.6.5 fan models from the bundled CC0 rig and local skins.

No network, image transformation, authentication files, or world writes. Existing
skin PNG bytes are copied unchanged. Deploy only owns two dedicated custom dirs.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
MODEL_NAMES = ("qiandengji_naruto", "qiandengji_kirito")
OWNER = "qiandengji.build_game_models.v1"
MARKER = ".qiandengji-generated.json"
FACES = ("north", "south", "east", "west", "up", "down")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def png_dimensions(data: bytes) -> tuple[int, int]:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("Not a PNG with an IHDR header")
    return struct.unpack(">II", data[16:24])


def flat_uv(pixel: tuple[int, int]):
    # Sample the middle of one existing opaque skin pixel. No new texture atlas.
    return {face: {"uv": [pixel[0] + .125, pixel[1] + .125],
                   "uv_size": [.75, .75]} for face in FACES}


def cube(origin, size, pixel, *, rotate=None, pivot=None, uv=None):
    item = {"origin": origin, "size": size, "uv": uv or flat_uv(pixel)}
    if rotate is not None:
        item.update(rotation=rotate, pivot=pivot)
    return item


def bone(name, parent, pivot, cubes, rotation=None):
    item = {"name": name, "parent": parent, "pivot": pivot, "cubes": cubes}
    if rotation:
        item["rotation"] = rotation
    return item


def naruto_bones():
    yellow, dark, orange, steel = (9, 8), (8, 11), (23, 26), (10, 10)
    hair = []
    # A low broken crown, not a single tall spike; each lock follows the head.
    for x, z, tilt, height in [(-3.4, -2.6, 28, 2.6), (-1.8, -2.8, 14, 3.2),
                              (.1, -2.5, -12, 3), (2.3, -2.4, -28, 2.7),
                              (-3, .3, 23, 2.8), (-.5, .8, 5, 3.3),
                              (2.2, .6, -22, 2.9), (-2.2, 2.5, 17, 2.3),
                              (.3, 2.6, -16, 2.6)]:
        hair.append(cube([x, 31.65, z], [1.5, height, 1.65], yellow,
                         rotate=[0, 0, tilt], pivot=[x + .75, 31.7, z + .8]))
    band_uv = flat_uv(dark)
    # Exact existing 8 x 2 forehead texture, including its metal insignia.
    band_uv["north"] = {"uv": [8, 10], "uv_size": [8, 2]}
    return [
        bone("QD_NarutoHair", "Head", [0, 32, 0], hair),
        bone("QD_NarutoHeadband", "Head", [0, 29, 0], [
            cube([-4.55, 28, -4.62], [9.1, 2, .25], dark, uv=band_uv),
            cube([-4.62, 28, -4.3], [.25, 2, 8.85], dark),
            cube([4.37, 28, -4.3], [.25, 2, 8.85], dark),
            cube([-4.4, 28, 4.37], [8.8, 2, .25], dark),
        ]),
        bone("QD_NarutoBandKnot", "Head", [0, 28.4, 4.6], [
            cube([-.7, 27.8, 4.5], [1.4, 1.4, .85], dark),
            cube([-1.25, 23.5, 4.8], [1, 5, .3], dark,
                 rotate=[-12, 0, -16], pivot=[-.5, 28.2, 4.9]),
            cube([.25, 24.2, 4.85], [1, 4.5, .3], dark,
                 rotate=[-18, 0, 20], pivot=[.5, 28.2, 4.9]),
        ]),
        bone("QD_NarutoJacket", "UpperBody", [0, 23, 0], [
            cube([-4.05, 23.55, -2.3], [2.9, .85, 4.6], dark),
            cube([1.15, 23.55, -2.3], [2.9, .85, 4.6], dark),
        ]),
        bone("QD_NarutoHipPouch", "DownBody", [3.6, 12, 2.6], [
            cube([2.15, 10.5, 2.3], [2.7, 3.4, 1.45], dark),
            cube([2.1, 12.55, 2.25], [2.8, 1.05, 1.6], orange),
            cube([3.18, 12.25, 3.91], [.55, .75, .12], steel),
        ]),
        bone("QD_NarutoKunaiPouch", "RightLeg", [-3.9, 10, 0], [
            cube([-4.45, 7.9, -.75], [.75, 2.8, 1.5], dark),
            cube([-4.54, 9.4, -.82], [.82, .65, 1.64], steel),
        ]),
    ]


def kirito_bones():
    black, cloth, trim, steel = (9, 1), (25, 22), (23, 26), (23, 22)
    result = [
        bone("QD_KiritoHair", "Head", [0, 31, 0], [
            cube([-4.3, 31.6, -3.9], [2, 1.7, 3], black,
                 rotate=[0, 0, 18], pivot=[-3.2, 31.7, -2.5]),
            cube([-1.4, 31.65, -3.8], [2.1, 1.7, 3], black,
                 rotate=[0, 0, -12], pivot=[-.4, 31.7, -2.5]),
            cube([1.6, 31.55, -3.8], [2.2, 1.45, 3], black,
                 rotate=[0, 0, -22], pivot=[2.7, 31.7, -2.5]),
        ]),
        bone("QD_KiritoCollar", "UpperBody", [0, 23.5, 0], [
            cube([-4.3, 23.15, -.85], [1.5, 2, 3.15], black),
            cube([2.8, 23.15, -.85], [1.5, 2, 3.15], black),
            cube([-3.3, 23.2, 1.8], [6.6, 1.6, .7], black),
            cube([-4.35, 23.15, -.91], [.3, 2, 3.27], trim),
            cube([4.05, 23.15, -.91], [.3, 2, 3.27], trim),
        ]),
        bone("QD_KiritoHarness", "UpperBody", [0, 18, -2.4], [
            cube([-.37, 14.25, -2.48], [.75, 10.4, .2], cloth,
                 rotate=[0, 0, -30], pivot=[0, 19.5, -2.4]),
            cube([-.63, 19.25, -2.76], [1.26, 1.2, .22], steel),
        ]),
    ]
    # Separate coat panels follow their respective animated thighs.
    for side, x in [("Right", -4.4), ("Left", .35)]:
        edge = x if side == "Right" else x + 3.7
        result.append(bone(f"QD_Kirito{side}Coat", f"{side}Leg", [x + 2, 12, 0], [
            cube([x, 3.3, 2.36], [4.05, 9.1, .45], black),
            cube([edge, 3.3, -2.44], [.45, 9.1, 5.2], black),
            cube([x, 3.3, 2.83], [4.05, .28, .15], trim),
            cube([edge, 3.3, -2.62], [.45, 9.1, .18], trim),
            cube([x + .12, 3.3, -2.48], [3.7, 8.7, .3], black),
            cube([x + .12, 3.3, -2.81], [3.7, .28, .2], trim),
        ]))
    # A sheathed sword is cosmetic and does not replace the held-item locator.
    result.append(bone("QD_KiritoBackSword", "UpperBody", [0, 19, 3.5], [
        cube([-.72, 8.2, 3.05], [1.44, 17, .95], black),
        cube([-.82, 8.15, 3], [1.64, 1.05, 1.05], trim),
        cube([-.9, 24.1, 2.93], [1.8, 1.1, 1.2], steel),
        cube([-2.15, 25.05, 2.93], [4.3, .5, 1.2], trim),
        cube([-.42, 25.5, 3.06], [.84, 4, .95], cloth),
        cube([-.63, 29.25, 2.95], [1.26, .8, 1.17], steel),
    ], rotation=[0, 0, -26]))
    return result


def make_geometry(template, name, accessory_factory, *, arm=False):
    geometry = copy.deepcopy(template)
    obj = geometry["minecraft:geometry"][0]
    obj["description"]["identifier"] = f"geometry.{name}{'_arm' if arm else ''}"
    obj["description"].update(visible_bounds_width=3, visible_bounds_height=3,
                              visible_bounds_offset=[0, 1.5, 0])
    # The supplied 64 x 64 skins lack the template's optional finger/eye atlas.
    # Retain animated bones and all equipment locators, only omit those cubes.
    excluded = {"Face", "RightHand", "LeftHand", "RightFoot", "LeftFoot"}
    for item in obj["bones"]:
        if item.get("parent") in excluded:
            excluded.add(item["name"])
        if item["name"] in excluded:
            item.pop("cubes", None)
    if not arm:
        obj["bones"].extend(accessory_factory())
    return geometry


def validate_geometry(doc):
    if doc.get("format_version") != "1.12.0":
        raise ValueError("Unsupported Bedrock geometry version")
    obj, = doc["minecraft:geometry"]
    desc = obj["description"]
    if (desc["texture_width"], desc["texture_height"]) != (64, 64):
        raise ValueError("Skin atlas size mismatch")
    bones = obj["bones"]
    names = {b["name"] for b in bones}
    if len(names) != len(bones):
        raise ValueError("Duplicate bone name")
    parents = {b["name"]: b.get("parent") for b in bones}
    for name in names:
        seen = set()
        cur = name
        while cur is not None:
            if cur in seen or cur not in parents:
                raise ValueError(f"Invalid/cyclic bone parent: {name}")
            seen.add(cur)
            cur = parents[cur]
    count = 0
    for b in bones:
        for key in ("pivot", "rotation"):
            if key in b and (len(b[key]) != 3 or not all(math.isfinite(v) for v in b[key])):
                raise ValueError(f"Invalid bone {key}")
        for c in b.get("cubes", []):
            count += 1
            if len(c["size"]) != 3 or any(not math.isfinite(x) or x <= 0 for x in c["size"]):
                raise ValueError("Cube size must be finite and positive")
            for key in ("origin", "pivot", "rotation"):
                if key in c and (len(c[key]) != 3 or not all(math.isfinite(v) for v in c[key])):
                    raise ValueError(f"Invalid cube {key}")
            for face in c["uv"].values():
                for start, size in zip(face["uv"], face["uv_size"]):
                    if not all(math.isfinite(v) for v in [start, size]) or not (0 <= min(start, start + size) <= max(start, start + size) <= 64):
                        raise ValueError("Texture UV outside the 64 x 64 atlas")
    return {"bones": len(bones), "cubes": count, "boneNames": sorted(names)}


def build_model(template: Path, skins: Path, name: str):
    naruto = name == MODEL_NAMES[0]
    title = "鸣人 · 木叶忍者" if naruto else "桐人 · 黑衣剑士"
    english = "Naruto · Leaf Ninja" if naruto else "Kirito · Black Swordsman"
    source_png = skins / ("naruto_748.png" if naruto else "kirito_726.png")
    texture = source_png.read_bytes()
    if png_dimensions(texture) != (64, 64):
        raise ValueError("Expected the existing 64 x 64 character skin")
    source_manifest = read_json(template / "ysm.json")
    if source_manifest["metadata"]["license"]["type"] != "CC 0":
        raise ValueError("Refusing a template whose declared license is not CC 0")
    factory = naruto_bones if naruto else kirito_bones
    main = make_geometry(read_json(template / "models/main.json"), name, factory)
    arm = make_geometry(read_json(template / "models/arm.json"), name, factory, arm=True)
    checked = {"main": validate_geometry(main), "arm": validate_geometry(arm)}
    all_names = set(checked["main"]["boneNames"])
    manifest = copy.deepcopy(source_manifest)
    manifest["metadata"].update(name=title, tips="千灯纪本地方块版；原角色皮肤，立体服装与配饰。",
                               license={"type": "All Rights Reserved"})
    manifest["metadata"]["authors"].append({"name": "千灯纪", "role": "本地方块造型与整合",
                                               "comment": "原骨架/动画 CC0；角色及皮肤权利归原权利人。"})
    manifest["files"]["player"]["texture"] = ["textures/skin.png"]
    result = {"ysm.json": encoded(manifest), "models/main.json": encoded(main),
              "models/arm.json": encoded(arm), "textures/skin.png": texture}
    omitted_refs = {}
    for channel in ("main", "tac"):
        p = f"animations/{channel}.animation.json"
        animation = read_json(template / p)
        missing = set()
        for anim in animation["animations"].values():
            for key in list(anim.get("bones", {})):
                if key not in all_names:
                    missing.add(key)
                    del anim["bones"][key]
        omitted_refs[channel] = sorted(missing)
        result[p] = encoded(animation)
    for p in sorted((template / "avatar").glob("*.png")):
        result[p.relative_to(template).as_posix()] = p.read_bytes()
    for language, display in [("zh_cn", title), ("en_us", english)]:
        lang = read_json(template / f"lang/{language}.json")
        lang["metadata.name"] = display
        lang["metadata.tips"] = ("千灯纪本地方块版，保留原皮肤与动作骨架。" if language == "zh_cn"
                                  else "Qiandengji local block model with original skin and animated rig.")
        result[f"lang/{language}.json"] = encoded(lang)
    result["CREDITS.txt"] = ("Qiandengji native YSM block-model adaptation, 2026.\n"
        "Rig and animations: bundled YSM 2.6.5 misc/2_steve, declared CC 0.\n"
        "Original model: GODZILLA256; animation: Duan Mu, Sweetzonzi.\n"
        "Skin: existing local character skin, copied byte-for-byte without its signature data.\n"
        "Naruto / Sword Art Online character rights and skin rights remain with their owners.\n"
        "Local fan adaptation; no claim of franchise authorization or blanket redistribution rights.\n"
        "No downloaded commercial model, GLB conversion, author authentication, or key included.\n"
    ).encode("utf-8")
    hashes = {p: sha(data) for p, data in sorted(result.items())}
    result[MARKER] = encoded({"owner": OWNER, "model": name, "sha256": hashes})
    source_files = [template / "ysm.json", template / "models/main.json", template / "models/arm.json",
                    template / "animations/main.animation.json", template / "animations/tac.animation.json",
                    source_png]
    return result, {"folder": name, "displayName": title, "format": "YSM spec 2 / Bedrock 1.12.0",
                    "textureSha256": sha(texture), "textureUnchanged": True,
                    "main": {k: v for k, v in checked["main"].items() if k != "boneNames"},
                    "arm": {k: v for k, v in checked["arm"].items() if k != "boneNames"},
                    "prunedAbsentTemplateAnimationBones": omitted_refs,
                    "sources": [{"path": str(p.relative_to(ROOT)), "sha256": sha(p.read_bytes())} for p in source_files],
                    "files": hashes}


def write_owned(folder: Path, files: dict[str, bytes]):
    if folder.is_symlink():
        raise ValueError(f"Refusing a linked model directory: {folder}")
    if folder.exists() and any(folder.iterdir()):
        marker = folder / MARKER
        if not marker.is_file():
            raise ValueError(f"Refusing an existing unowned directory: {folder}")
        before = read_json(marker)
        if before.get("owner") != OWNER or before.get("model") != folder.name:
            raise ValueError(f"Ownership mismatch: {folder}")
        expected = before["sha256"]
        actual = {p.relative_to(folder).as_posix(): sha(p.read_bytes())
                  for p in folder.rglob("*") if p.is_file() and p.name != MARKER}
        if actual != expected:
            raise ValueError(f"Existing model was edited; refusing overwrite: {folder}")
        if set(expected) - set(files):
            raise ValueError("Build removes managed files; manual review is required")
    for name, content in files.items():
        path = folder / name
        if not path.resolve().is_relative_to(folder.resolve()) or path.is_symlink():
            raise ValueError("Unsafe model output path")
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_bytes() != content:
            path.write_bytes(content)


def verify_tree(folder: Path, files: dict[str, bytes]):
    actual = {p.relative_to(folder).as_posix(): sha(p.read_bytes())
              for p in folder.rglob("*") if p.is_file()}
    expected = {p: sha(data) for p, data in files.items()}
    if actual != expected:
        raise ValueError(f"Deployed model hash mismatch: {folder}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deploy", action="store_true", help="Copy to the two D-project custom directories")
    args = parser.parse_args()
    template = ROOT / "server/mc/config/yes_steve_model/builtin/misc/2_steve"
    skins = ROOT / "server/character-skins"
    output = ROOT / "assets/game-models"
    summaries = []
    export_files = []
    for name in MODEL_NAMES:
        files, summary = build_model(template, skins, name)
        export_files.extend({"path": f"config/yes_steve_model/custom/{name}/{relative}",
                             "size": len(content), "sha256": sha(content)}
                            for relative, content in sorted(files.items()))
        write_owned(output / name, files)
        verify_tree(output / name, files)
        summary["deployments"] = []
        if args.deploy:
            for base in ["client/config/yes_steve_model/custom", "server/mc/config/yes_steve_model/custom"]:
                target = ROOT / base / name
                write_owned(target, files)
                verify_tree(target, files)
                summary["deployments"].append(str(target.relative_to(ROOT)))
        summaries.append(summary)
    report = {"schemaVersion": 1, "generator": OWNER, "minecraft": "1.21.1", "ysm": "2.6.5",
              "ok": True, "models": summaries,
              "verification": {"geometry": True, "boneParents": True, "textureUV": True,
                               "animationBoneReferences": True, "originalPNGBytes": True,
                               "deploymentHashes": bool(args.deploy)},
              "runtime": "Not assessed by this static build; actual binding and rendering evidence is in reports/game-models-smoke.json"}
    (output / "build-lock.json").write_bytes(encoded(report))
    export_lock = {"schema_version": 1,
                   "target": {"minecraft": "1.21.1", "neoforge": "21.1.248", "ysm": "2.6.5"},
                   "files": sorted(export_files, key=lambda row: row["path"])}
    (ROOT / "manifests/game-models.lock.json").write_bytes(encoded(export_lock))
    report_path = ROOT / "reports/game-models-build.json"
    report_path.write_bytes(encoded(report))
    print(json.dumps({"ok": True, "models": [{k: m[k] for k in ("folder", "main", "arm", "deployments")} for m in summaries],
                      "report": str(report_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
