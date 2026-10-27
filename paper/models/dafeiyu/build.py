"""Build the original, editable QianDengJi fat fish for YSM 2.4.1 (spec 2).

No third-party model, texture, rig, animation, or encrypted YSM is an input.
Requires Python 3.11+ and Pillow. Output must not already exist.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from io import BytesIO
import hashlib
import json
import math
from pathlib import Path
import zipfile

from PIL import Image, ImageDraw

MODEL_ID = "qd_dafeiyu"
VERSION = "1.0.0"
FACES = ("north", "south", "east", "west", "up", "down")
PALETTES = {
    "pearl": ["faf4de", "ffecc2", "66c4c5", "398d9e", "43a8ae", "9ee3d5",
              "f1957a", "c96058", "ffffff", "23374a", "101e30", "ffd181", "e8b5aa", "b1e5db", "76b6b4", "f8f5e9"],
    "sunset": ["fff0c9", "ffe5b0", "eda85b", "c67445", "dd8b50", "ffcb83",
               "e77767", "ae4e56", "ffffff", "49334c", "251e35", "ffe19b", "edb2a2", "ffe2aa", "dcb16e", "fff4df"],
    "moon": ["c4dae9", "e2eef0", "678fbf", "43618e", "537ca9", "a5cfe3",
             "ac91cd", "79659c", "ffffff", "26344e", "101e30", "efd99c", "c8bedc", "a8cfe1", "668bab", "edf5f5"],
}


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def texture(palette):
    image = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for i, color in enumerate(palette):
        x, y = (i % 8) * 16, (i // 8) * 16
        rgb = tuple(bytes.fromhex(color))
        draw.rectangle((x, y, x + 15, y + 15), fill=(*rgb, 255))
        # Broad UV islands and an opaque border prevent mip/edge contamination.
        light = tuple(min(255, round(c * 1.04 + 2)) for c in rgb)
        dark = tuple(max(0, round(c * .96)) for c in rgb)
        draw.line((x + 3, y + 3, x + 11, y + 3), fill=(*light, 255))
        draw.line((x + 4, y + 12, x + 12, y + 12), fill=(*dark, 255))
    out = BytesIO()
    image.save(out, format="PNG", optimize=False)
    return out.getvalue()


def cube(origin, size, color, *, pivot=None, rotation=None):
    x, y = color % 8 * 16 + 2, color // 8 * 16 + 2
    result = {"origin": list(origin), "size": list(size),
              "uv": {face: {"uv": [x, y], "uv_size": [12, 12]} for face in FACES}}
    if pivot is not None:
        result["pivot"] = list(pivot)
    if rotation is not None:
        result["rotation"] = list(rotation)
    return result


def bone(name, parent, pivot, cubes=None):
    result = {"name": name, "pivot": list(pivot)}
    if parent:
        result["parent"] = parent
    if cubes:
        result["cubes"] = cubes
    return result


def geometry(bones, name):
    return {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.qiandengji.dafeiyu." + name,
                        "texture_width": 128, "texture_height": 128,
                        "visible_bounds_width": 4, "visible_bounds_height": 4,
                        "visible_bounds_offset": [0, 1.5, 0]}, "bones": bones}]}


def main_geometry():
    body = []
    # Voxel strips fill an ellipsoid. Every strip is solid and meets its neighbors.
    for y in range(2, 28, 2):
        for x in range(-10, 10, 2):
            v = 1 - ((x + 1) / 10) ** 2 - ((y + 1 - 15) / 13.5) ** 2
            if v <= .03:
                continue
            z = round(9.5 * math.sqrt(v) * 2) / 2
            color = 2 if y >= 22 else 13 if y >= 18 else 0 if y >= 8 else 1
            if abs(x + 1) > 7 and 10 <= y < 22:
                color = 14
            body.append(cube([x, y, -z], [2, 2, 2 * z], color))
    bones = [bone("Root", None, [0, 0, 0]), bone("AllBody", "Root", [0, 15, 0], body),
             bone("Head", "AllBody", [0, 22, -2])]
    face = []
    for side in (-1, 1):
        cx = side * 5.2
        face += [cube([cx - 2.4, 20.3, -10.7], [4.8, 5.3, 3.6], 8),
                 cube([cx - 1.15, 21.2, -11.05], [2.6, 3.5, .5], 9),
                 cube([cx - .7, 21.55, -11.4], [1.6, 2.8, .45], 10),
                 cube([cx - .55, 23.4, -11.92], [.9, .9, .45], 8),
                 cube([cx + .45, 21.9, -11.91], [.45, .45, .42], 8),
                 cube([cx - 2.3, 25.5, -10], [4.6, .9, 1.3], 3,
                      pivot=[cx, 25.8, -9.5], rotation=[0, 0, side * -7]),
                 cube([side * 7.9 - 1, 16.6, -8.55], [2, 1.6, .7], 12)]
    # The open mouth is geometry, rather than an empty texture cutout.
    face += [cube([-2.1, 14.8, -10.25], [4.2, 2.8, 2], 7),
             cube([-1.3, 15.5, -10.8], [2.6, 1.25, .7], 10),
             cube([-1.9, 14.4, -10.9], [3.8, .8, 1], 6),
             cube([-1.9, 17.2, -10.7], [3.8, .7, .9], 6)]
    bones[2]["cubes"] = face
    bones.append(bone("Dorsal", "AllBody", [0, 27, 1], [
        cube([-1, 26.8, -2], [2, 3, 9], 4),
        cube([-.7, 29, .3], [1.4, 2.5, 6], 5),
        cube([-.8, 30.5, 2.5], [1.6, 1, 3], 6)]))
    bones.append(bone("Tail", "AllBody", [0, 15, 8], [
        cube([-2.5, 12.5, 7.5], [5, 5, 5.5], 4),
        cube([-1.5, 10.5, 12], [3, 9, 4], 5),
        cube([-1, 7, 15], [2, 7, 5], 4, pivot=[0, 15, 14], rotation=[-18, 0, 0]),
        cube([-1, 16, 15], [2, 7, 5], 4, pivot=[0, 15, 14], rotation=[18, 0, 0]),
        cube([-1.2, 6.2, 18], [2.4, 3, 3], 6, pivot=[0, 15, 14], rotation=[-18, 0, 0]),
        cube([-1.2, 20.8, 18], [2.4, 3, 3], 6, pivot=[0, 15, 14], rotation=[18, 0, 0])]))
    for side, label in ((-1, "Right"), (1, "Left")):
        pivot = [side * 8, 17, -1]
        x = -14 if side < 0 else 8
        bones += [bone(label + "Arm", "AllBody", pivot, [
            cube([x, 13.8, -3], [6, 4, 5], 4),
            cube([x - (1 if side < 0 else 0), 12.8, -2.5], [7, 1.5, 4], 5),
            cube([x - (1.3 if side < 0 else -4), 13.8, -2.7], [2.8, 2, 4.4], 6)]),
            bone(label + "ForeArm", label + "Arm", [side * 11, 14, -1]),
            bone(label + "HandLocator", label + "ForeArm", [side * 11, 13, -3]),
            bone(label + "Leg", "AllBody", [side * 3.3, 4, 0], [
                cube([side * 3.3 - 2, 0, -3], [4, 2, 6], 4),
                cube([side * 3.3 - 2.2, .1, -4], [4.4, 1.3, 2], 6)])]
    return geometry(bones, "main")


def arm_geometry():
    bones = []
    for side, label in ((-1, "Right"), (1, "Left")):
        # Conventional independent arm roots, so first-person renderers can mount them.
        x = side * 3 - 2
        bones += [bone(label + "Arm", None, [side * 3, 24, 0], [
            cube([x, 17, -2], [4, 7, 4], 0),
            cube([x - 1, 17, -1.5], [6, 2, 3], 5)]),
            bone(label + "ForeArm", label + "Arm", [side * 3, 18, 0], [
                cube([x, 12, -2.1], [4, 6, 4.2], 4),
                cube([x - .3, 11.5, -2.3], [4.6, 1.8, 4.6], 6)]),
            bone(label + "HandLocator", label + "ForeArm", [side * 3, 12, -1])]
    return geometry(bones, "arm")


def loop(length, values):
    return {"loop": True, "animation_length": length, "bones": values}


def wave(axis, amount, length=1, offset=0):
    return {str(round(i * length / 8, 4)): [round(amount * math.sin(i * math.pi / 4 + offset), 4)
            if j == axis else 0 for j in range(3)] for i in range(9)}


def main_animations():
    def gait(speed, amplitude):
        return loop(speed, {"AllBody": {"position": wave(1, .3, speed), "rotation": wave(2, 2, speed)},
            "Tail": {"rotation": wave(1, amplitude, speed)},
            "LeftArm": {"rotation": wave(2, 12, speed)},
            "RightArm": {"rotation": wave(2, -12, speed)},
            "LeftLeg": {"rotation": wave(0, 20, speed)},
            "RightLeg": {"rotation": wave(0, -20, speed)}})
    clips = {"idle": loop(2.4, {"AllBody": {"position": wave(1, .22, 2.4)},
             "Tail": {"rotation": wave(1, 7, 2.4)}, "Dorsal": {"rotation": wave(2, 3, 2.4)},
             "LeftArm": {"rotation": wave(2, 6, 2.4)}, "RightArm": {"rotation": wave(2, -6, 2.4)}}),
             "walk": gait(.85, 18), "run": gait(.48, 28), "sneak": gait(1.4, 10),
             "swim": gait(.65, 32), "swim_stand": gait(1.6, 13),
             "jump": loop(1, {"LeftArm": {"rotation": [0, 0, -28]}, "RightArm": {"rotation": [0, 0, 28]},
                             "Tail": {"rotation": wave(1, 20)}, "LeftLeg": {"rotation": [-20, 0, 0]}, "RightLeg": {"rotation": [-20, 0, 0]}}),
             "sneaking": loop(2, {"AllBody": {"position": [0, -1, 0]}, "Tail": {"rotation": wave(1, 5, 2)}}),
             "attacked": {"animation_length": .35, "bones": {"AllBody": {"rotation": {"0": [0, 0, -8], "0.15": [0, 0, 7], "0.35": [0, 0, 0]}}}},
             "sleep": loop(3, {"Tail": {"rotation": wave(1, 3, 3)}}),
             "sit": loop(2, {"LeftLeg": {"rotation": [-45, 0, 0]}, "RightLeg": {"rotation": [-45, 0, 0]}})}
    for name in ("fly", "climbing", "boat", "ride", "ride_pig"):
        clips[name] = deepcopy(clips["jump"] if name == "fly" else clips["sit"])
    clips["empty"] = loop(1, {})
    clips["death"] = {"animation_length": 1, "bones": {"AllBody": {"rotation": {"0": [0, 0, 0], "1": [0, 0, 80]}}}}
    clips["elytra_fly"] = deepcopy(clips["fly"])
    clips["riptide"] = deepcopy(clips["swim"])
    for hand, label, side in (("hand", "Right", 1), ("offhand", "Left", -1)):
        clips["swing_" + hand] = {"animation_length": .4, "bones": {label + "Arm": {"rotation": {
            "0": [0, 0, 0], "0.12": [-85, 0, side * 22], "0.4": [0, 0, 0]}}}}
    return {"format_version": "1.8.0", "animations": clips}


def arm_animations():
    clips = {}
    for hand, label, side in (("mainhand", "Right", 1), ("offhand", "Left", -1)):
        arm = label + "Arm"
        clips["hold_" + hand] = loop(1, {arm: {"rotation": [-12, 0, side * 5]}})
        clips["swing_" + hand] = {"animation_length": .4, "bones": {arm: {"rotation": {
            "0": [0, 0, 0], "0.12": [-85, 0, side * 22], "0.4": [0, 0, 0]}}}}
        for kind in ("eat", "drink"):
            clips[f"use_{hand}:{kind}"] = loop(.6, {arm: {"rotation": [-64, 0, side * 12]},
                      label + "ForeArm": {"rotation": wave(0, 10, .6)}})
        for kind in ("shield", "block"):
            clips[f"use_{hand}:{kind}"] = loop(1, {arm: {"rotation": [-55, 0, side * 25]}})
        clips[f"use_{hand}:bow"] = loop(1, {"RightArm": {"rotation": [-85, 0, -10]}, "LeftArm": {"rotation": [-85, 0, 12]}})
        clips[f"use_{hand}:spear"] = loop(1, {arm: {"rotation": [-145, 0, side * 10]}})
    # Native YSM names the main-hand condition "swing"; the renderer uses the
    # same condition name and falls back to main.swing_hand for an empty hand.
    clips["swing"] = deepcopy(clips["swing_mainhand"])
    return {"format_version": "1.8.0", "animations": clips}


def build_files():
    spec = {"spec": 2, "metadata": {"name": "大肥鱼 · 千灯纪原创 · " + VERSION,
        "tips": "奶白圆鱼 / 青蓝鱼鳍 / 珊瑚尾巴；三款配色。纯外观，不改变玩家碰撞箱。",
        "authors": [{"name": "jcs130", "role": "角色委托"}, {"name": "Codex", "role": "原创几何 / 贴图 / 动画"}],
        "license": {"type": "CC 0", "desc": "本模型的原创几何、贴图及动画按 CC0 1.0 发布。"}},
        "properties": {"height_scale": 1, "width_scale": 1, "free": True, "default_texture": "pearl", "preview_animation": "idle",
            "extra_animation": {"extra1": "鱼鳍招手", "extra2": "开心摆尾", "extra3": "大鱼鞠躬"}},
        "files": {"player": {"model": {"main": "models/main.json", "arm": "models/arm.json"},
            "animation": {"main": "animations/main.animation.json", "arm": "animations/arm.animation.json", "extra": "animations/extra.animation.json"},
            "texture": [f"textures/{name}.png" for name in PALETTES]}}}
    extra = {"format_version": "1.8.0", "animations": {
        "extra1": {"animation_length": 2, "bones": {"RightArm": {"rotation": wave(2, 45, .5)}, "Tail": {"rotation": wave(1, 12, 2)}}},
        "extra2": {"animation_length": 1.2, "bones": {"AllBody": {"position": wave(1, 1, 1.2)}, "Tail": {"rotation": wave(1, 38, .4)}}},
        "extra3": {"animation_length": 1.5, "bones": {"AllBody": {"rotation": {"0": [0, 0, 0], "0.6": [22, 0, 0], "0.9": [22, 0, 0], "1.5": [0, 0, 0]}}}}}}
    files = {"ysm.json": encoded(spec), "models/main.json": encoded(main_geometry()), "models/arm.json": encoded(arm_geometry()),
             "animations/main.animation.json": encoded(main_animations()), "animations/arm.animation.json": encoded(arm_animations()),
             "animations/extra.animation.json": encoded(extra),
             "CREDITS.txt": ("QianDengJi original fat fish 1.0.0\nGeometry, texture, animations: original, CC0 1.0.\n"
                             "No third-party encrypted .ysm was read, decrypted, copied, or used as a source.\n").encode()}
    files.update({f"textures/{name}.png": texture(colors) for name, colors in PALETTES.items()})
    return files


def validate(files):
    main = json.loads(files["models/main.json"])["minecraft:geometry"][0]
    arm = json.loads(files["models/arm.json"])["minecraft:geometry"][0]
    names = {b["name"] for b in main["bones"]}
    assert len(names) == len(main["bones"])
    for model in (main, arm):
        own = {b["name"] for b in model["bones"]}
        for b in model["bones"]:
            assert not b.get("parent") or b["parent"] in own
            for c in b.get("cubes", []):
                assert all(math.isfinite(v) and v > 0 for v in c["size"])
                for face in c["uv"].values():
                    assert all(0 <= a <= 128 and 0 <= a + s <= 128 for a, s in zip(face["uv"], face["uv_size"]))
    for file, data in files.items():
        if file.startswith("animations/"):
            for clip in json.loads(data)["animations"].values():
                assert set(clip.get("bones", {})) <= names
        if file.endswith(".png"):
            image = Image.open(BytesIO(data))
            assert image.size == (128, 128)
    return {"modelId": MODEL_ID, "version": VERSION, "bones": len(main["bones"]),
            "cubes": sum(len(b.get("cubes", [])) for b in main["bones"]),
            "textures": list(PALETTES), "files": {k: hashlib.sha256(v).hexdigest() for k, v in sorted(files.items())}}


def build(output):
    files = build_files()
    report = validate(files)
    output.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        path = output / MODEL_ID / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    with zipfile.ZipFile(output / f"{MODEL_ID}-{VERSION}.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(MODEL_ID + "/" + name, (2026, 10, 28, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    (output / "manifest.json").write_bytes(encoded(report))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    print(json.dumps(build(parser.parse_args().output), ensure_ascii=False))
