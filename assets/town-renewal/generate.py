#!/usr/bin/env python3
"""Generate two original 1.21.1 town assets, not a world-editing tool.

Requires nbtlib for the compressed native NBT. Only writes this directory's
named generated assets; never reads a world or dispatches Minecraft commands.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
from collections import Counter
from pathlib import Path

import nbtlib

ROOT = Path(__file__).resolve().parent
DATA_VERSION = 3955
PACK = ROOT / "datapack"


def state(name: str, **properties: str) -> dict:
    result = {"Name": "minecraft:" + name}
    if properties:
        result["Properties"] = dict(sorted(properties.items()))
    return result


def put(blocks: dict, x: int, y: int, z: int, name: str, **properties: str) -> None:
    # Later architectural details intentionally replace the initial floor/wall.
    blocks[x, y, z] = state(name, **properties)


def slab(blocks: dict, x: int, y: int, z: int, wood: str, kind="bottom") -> None:
    put(blocks, x, y, z, wood + "_slab", type=kind, waterlogged="false")


def fence(blocks: dict, x: int, y: int, z: int) -> None:
    put(blocks, x, y, z, "spruce_fence", east="false", west="false",
        north="false", south="false", waterlogged="false")


def lantern(blocks: dict, x: int, y: int, z: int, hanging=False) -> None:
    put(blocks, x, y, z, "lantern", hanging=str(hanging).lower(), waterlogged="false")


def foundation(blocks: dict) -> None:
    for x in range(13):
        for z in range(13):
            block = "stone_bricks"
            if x not in range(5, 8) and (x * 3 + z * 5) % 11 == 0:
                block = "mossy_stone_bricks"
            if x in (5, 7):
                block = "smooth_stone"
            put(blocks, x, 0, z, block)


def market() -> tuple[dict, dict]:
    blocks = {}
    foundation(blocks)
    for left in (True, False):
        xs = range(0, 5) if left else range(8, 13)
        posts = (1, 4) if left else (8, 11)
        counter = 4 if left else 8
        display = 2 if left else 10
        for x in xs:
            for z in range(2, 9):
                slab(blocks, x, 4, z, "oak" if z % 2 else "spruce")
        for x in posts:
            for z in (3, 7):
                for y in range(1, 4):
                    fence(blocks, x, y, z)
        for z in range(4, 7):
            put(blocks, counter, 1, z, "spruce_planks")
            slab(blocks, display, 1, z, "oak", "top")
        lantern(blocks, display, 3, 3, hanging=True)
        lantern(blocks, display, 3, 7, hanging=True)
    for x in (2, 3, 9, 10):
        put(blocks, x, 1, 10, "spruce_stairs", facing="north", half="bottom",
            shape="straight", waterlogged="false")
    for x in (1, 11):
        for y in range(1, 4):
            fence(blocks, x, y, 11)
        lantern(blocks, x, 4, 11)
    for x in (1, 2, 3, 9, 10, 11):
        put(blocks, x, 0, 0, "grass_block", snowy="false")
        put(blocks, x, 1, 0, "poppy" if x % 2 else "dandelion")
        slab(blocks, x, 1, 1, "stone_brick")
    return blocks, {
        "title": "暖木石双摊集市庭院", "size": [13, 5, 13], "beds": [],
        "doors": [], "centralPath": {"min": [5, 1, 0], "max": [7, 3, 12]},
        "notes": ["两座木质遮阳摊、六盏灯、四格座椅、两组花池。",
                  "X5..7 南北贯通三格通路，Y1..3 全净空；摊位仅静态装饰，不含库存。"],
    }


def house() -> tuple[dict, dict]:
    blocks = {}
    foundation(blocks)
    for x in range(2, 11):
        for z in range(1, 10):
            put(blocks, x, 0, z, "oak_planks")
    for x in range(2, 11):
        for z in range(1, 10):
            if x not in (2, 10) and z not in (1, 9):
                continue
            for y in range(1, 4):
                put(blocks, x, y, z, "oak_planks")
            put(blocks, x, 4, z, "spruce_log", axis="x" if z in (1, 9) else "z")
    for x in (2, 10):
        for z in (1, 9):
            for y in range(1, 5):
                put(blocks, x, y, z, "spruce_log", axis="y")
    for y in (2, 3):
        for x in (3, 4, 8, 9):
            put(blocks, x, y, 9, "glass")
        for x in range(4, 9):
            put(blocks, x, y, 1, "glass")
        for x in (2, 10):
            for z in (3, 4, 6, 7):
                put(blocks, x, y, z, "glass")
    doors = [{"lower": [6, 1, 9], "upper": [6, 2, 9], "facing": "south", "hinge": "left"}]
    for half, y in (("lower", 1), ("upper", 2)):
        put(blocks, 6, y, 9, "spruce_door", facing="south", half=half,
            hinge="left", open="false", powered="false")
    # Half-block slopes create a low, one-storey pitched roof. The end gables
    # close the lower half of top slabs; no air cells are needed or emitted.
    for x in range(1, 12):
        half_level = 10 + (5 - abs(x - 6))
        roof_y, top = divmod(half_level, 2)
        for z in range(0, 11):
            kind = "top" if top else "bottom"
            if z in (1, 9) and 2 <= x <= 10:
                for y in range(5, roof_y):
                    put(blocks, x, y, z, "oak_planks")
                if kind == "top":
                    kind = "double"
            slab(blocks, x, roof_y, z, "spruce", kind)
    for z in (1, 9):
        put(blocks, 6, 5, z, "glass")
    # A high crossbeam supports the indoor lamp without reducing the three
    # blocks of headroom above the floor (local Y1, Y2, Y3).
    for x in range(3, 10):
        put(blocks, x, 5, 5, "spruce_log", axis="x")
    lantern(blocks, 6, 4, 5, hanging=True)
    beds = []
    for x, z in ((3, 4), (4, 4), (8, 4), (9, 4), (3, 7)):
        bed = {"foot": [x, 1, z], "head": [x, 1, z - 1], "facing": "north", "color": "white"}
        beds.append(bed)
        for part, pos in (("foot", bed["foot"]), ("head", bed["head"])):
            put(blocks, *pos, "white_bed", facing="north", occupied="false", part=part)
    for x in (4, 8):
        for y in (1, 2):
            fence(blocks, x, y, 11)
        lantern(blocks, x, 3, 11)
    for x in (2, 3, 9, 10):
        put(blocks, x, 0, 12, "grass_block", snowy="false")
        put(blocks, x, 1, 12, "oxeye_daisy" if x % 2 else "poppy")
        slab(blocks, x, 1, 11, "stone_brick")
    return blocks, {
        "title": "五床暖木石庭院住宅", "size": [13, 8, 13], "beds": beds,
        "doors": doors, "entrance": [6, 1, 12],
        "interiorFloor": {"min": [3, 0, 2], "max": [9, 0, 8]},
        "centralPath": {"min": [5, 1, 2], "max": [7, 3, 8]},
        "notes": ["五张平层床；室内通道 Y1..3 全净空，床上方 Y2..4 净空。",
                  "门向南（+Z）；门内外接地通行，木门可由原版村民打开。",
                  "一层主体、玻璃窗、半砖斜坡尖屋顶，最高占用 Y7。"],
    }


def native_structure(blocks: dict, size: list[int]) -> dict:
    palette = []
    indexes = {}
    cells = []
    for pos, value in sorted(blocks.items(), key=lambda item: (item[0][1], item[0][0], item[0][2])):
        key = json.dumps(value, sort_keys=True)
        if key not in indexes:
            indexes[key] = len(palette)
            palette.append(value)
        cells.append({"pos": list(pos), "state": indexes[key]})
    return {"DataVersion": DATA_VERSION, "size": size, "palette": palette, "blocks": cells, "entities": []}


def material_counts(blocks: dict) -> dict:
    placed = Counter(value["Name"] for value in blocks.values())
    items = Counter()
    for value in blocks.values():
        name = value["Name"]
        properties = value.get("Properties", {})
        if name.endswith("_bed") and properties["part"] == "head":
            continue
        if name.endswith("_door") and properties["half"] == "upper":
            continue
        items[name] += 2 if properties.get("type") == "double" else 1
    return {"placedBlocks": dict(sorted(placed.items())), "equivalentItems": dict(sorted(items.items())),
            "equivalentItemsNote": "床头/脚合为1床，门上下合为1门，双半砖折为2半砖；草方块不等于生存模式可直接购买/获得。不是Numen库存承诺。"}


def write_assets() -> dict:
    structures = PACK / "data" / "qiandeng_town" / "structure"
    structures.mkdir(parents=True, exist_ok=True)
    (PACK / "pack.mcmeta").write_text(json.dumps({"pack": {"pack_format": 48,
        "description": "千灯纪原创暖木石城镇模板（1.21.1，离线预演）"}}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    metadata = {"schema": 1, "minecraftVersion": "1.21.1", "dataVersion": DATA_VERSION,
        "namespace": "qiandeng_town", "origin": "local [0,0,0] is northwest ground-layer block; +X east, +Z south; standing feet Y1",
        "airPolicy": "No air entries; unspecified cells are not cleared. Preflight must establish free space.",
        "placement": {"defaultPolicy": "Preserve existing world content by preflight rejection of occupied/conflicting target cells; this asset has no enforcement mechanism",
                      "numenBlueprint": "Existing BlueprintTool hardcodes REPLACE_EMPTY: permits replacing solids and explicit air clearing, subject to native permissions/materials. This asset has no air, but listed cells can still overwrite. DONT_REPLACE is the conservative enum; BlueprintTool does not expose it",
                      "vanillaPlaceTemplate": "Administrator placement overwrites listed cells; omitted cells remain. No built-in rollback or protection bypass authorization."},
        "assets": {}}
    for name, build in (("market-courtyard", market), ("courtyard-house", house)):
        blocks, info = build()
        native = native_structure(blocks, info["size"])
        snbt = json.dumps(native, ensure_ascii=False, indent=2) + "\n"
        tag = nbtlib.parse_nbt(snbt)
        raw = io.BytesIO()
        nbtlib.File(tag).write(raw)
        # Stable gzip bytes: no filename/time headers or OS-dependent compressor
        # metadata, so regenerated assets can be reviewed by exact hash.
        output = io.BytesIO()
        with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0) as handle:
            handle.write(raw.getvalue())
        nbt = output.getvalue()
        (ROOT / (name + ".snbt")).write_text(snbt, encoding="utf-8", newline="\n")
        (ROOT / (name + ".nbt")).write_bytes(nbt)
        (structures / (name + ".nbt")).write_bytes(nbt)
        info.update(material_counts(blocks))
        info.update({"blockCount": len(blocks), "paletteCount": len(native["palette"]),
                     "templateId": "qiandeng_town:" + name,
                     "files": {"nativeSnbt": name + ".snbt", "compressedNbt": name + ".nbt",
                               "datapackNbt": "datapack/data/qiandeng_town/structure/" + name + ".nbt"},
                     "sha256": {"snbt": hashlib.sha256(snbt.encode()).hexdigest(), "nbt": hashlib.sha256(nbt).hexdigest()}})
        metadata["assets"][name] = info
    (ROOT / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata


if __name__ == "__main__":
    report = write_assets()
    print(json.dumps({name: {key: info[key] for key in ("size", "blockCount", "paletteCount", "sha256")}
                      for name, info in report["assets"].items()}, ensure_ascii=False, indent=2))
