#!/usr/bin/env python3
"""Offline checks for these two assets. Does not connect to or modify a world."""
from __future__ import annotations

import hashlib
import json
from collections import deque
from pathlib import Path

import nbtlib

ROOT = Path(__file__).resolve().parent
DIRECTIONS = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}
PLAIN = {"stone_bricks", "mossy_stone_bricks", "smooth_stone", "spruce_planks",
         "oak_planks", "glass", "poppy", "dandelion", "oxeye_daisy"}
BOOL = {"true", "false"}
PROPERTIES = {
    "spruce_log": {"axis": {"x", "y", "z"}},
    "grass_block": {"snowy": BOOL},
    "spruce_fence": {**{d: BOOL for d in DIRECTIONS}, "waterlogged": BOOL},
    "lantern": {"hanging": BOOL, "waterlogged": BOOL},
    "spruce_stairs": {"facing": set(DIRECTIONS), "half": {"top", "bottom"},
                      "shape": {"straight"}, "waterlogged": BOOL},
    "spruce_door": {"facing": set(DIRECTIONS), "half": {"upper", "lower"},
                    "hinge": {"left", "right"}, "open": BOOL, "powered": BOOL},
    "white_bed": {"facing": set(DIRECTIONS), "part": {"head", "foot"}, "occupied": BOOL},
    **{name + "_slab": {"type": {"bottom", "top", "double"}, "waterlogged": BOOL}
       for name in ("oak", "spruce", "stone_brick")},
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_structure(data: dict, info: dict) -> dict:
    require(set(data) == {"DataVersion", "size", "palette", "blocks", "entities"}, "unexpected structure fields")
    require(data["DataVersion"] == 3955, "wrong DataVersion")
    size = data["size"]
    require(size == info["size"] and len(size) == 3, "size mismatch")
    require(all(type(n) is int and 1 <= n <= 13 for n in size), "size outside asset bounds")
    require(data["entities"] == [], "entities must be empty")
    palette = data["palette"]
    require(palette and len(palette) < 100, "invalid palette size")
    for item in palette:
        require(set(item) <= {"Name", "Properties"}, "unsafe palette fields")
        full = item.get("Name", "")
        require(full.startswith("minecraft:"), "non-vanilla block")
        name = full.removeprefix("minecraft:")
        require(name in PLAIN or name in PROPERTIES, "block outside reviewed material list (including air/containers)")
        props = item.get("Properties", {})
        expected = PROPERTIES.get(name, {})
        require(set(props) == set(expected), "incomplete or extra block properties")
        require(all(value in expected[key] for key, value in props.items()), "invalid property value")
    cells = {}
    require(0 < len(data["blocks"]) <= 13 ** 3, "invalid cell count")
    for cell in data["blocks"]:
        require(set(cell) == {"pos", "state"}, "block NBT or unexpected cell fields")
        pos = cell["pos"]
        require(len(pos) == 3 and all(type(p) is int and 0 <= p < size[i] for i, p in enumerate(pos)), "cell outside size")
        require(tuple(pos) not in cells, "duplicate position")
        require(type(cell["state"]) is int and 0 <= cell["state"] < len(palette), "invalid palette index")
        cells[tuple(pos)] = palette[cell["state"]]
    require(all((x, 0, z) in cells for x in range(size[0]) for z in range(size[2])), "incomplete ground support")
    beds, doors = [], []
    for (x, y, z), item in cells.items():
        name, props = item["Name"], item.get("Properties", {})
        if name.endswith("_bed"):
            dx, dz = DIRECTIONS[props["facing"]]
            sign = 1 if props["part"] == "foot" else -1
            other = cells.get((x + dx * sign, y, z + dz * sign), {})
            op = other.get("Properties", {})
            require(other.get("Name") == name and op.get("facing") == props["facing"] and
                    op.get("part") != props["part"] and op.get("occupied") == "false", "orphan or inconsistent bed")
            require(y == 1 and (x, 0, z) in cells, "bed must have ground support, no bunks")
            require(all((x, yy, z) not in cells for yy in range(2, 5)), "bed headroom below three blocks")
            if props["part"] == "foot":
                beds.append({"foot": [x, y, z], "head": [x + dx, y, z + dz], "facing": props["facing"], "color": "white"})
        elif name.endswith("_door"):
            offset = 1 if props["half"] == "lower" else -1
            other = cells.get((x, y + offset, z), {})
            expected = dict(props, half="upper" if offset == 1 else "lower")
            require(other.get("Name") == name and other.get("Properties") == expected, "orphan or inconsistent door")
            if offset == 1:
                require(y == 1 and (x, 0, z) in cells, "door missing ground support")
                doors.append({"lower": [x, y, z], "upper": [x, y + 1, z], "facing": props["facing"], "hinge": props["hinge"]})
        elif name == "minecraft:lantern":
            support = (x, y + (1 if props["hanging"] == "true" else -1), z)
            require(support in cells, "unsupported lantern")
        elif name in {"minecraft:poppy", "minecraft:dandelion", "minecraft:oxeye_daisy"}:
            require(cells.get((x, y - 1, z), {}).get("Name") == "minecraft:grass_block", "unsupported flower")
    key = lambda value: value.get("foot", value.get("lower"))
    require(sorted(beds, key=key) == sorted(info["beds"], key=key), "bed metadata mismatch")
    require(sorted(doors, key=key) == sorted(info["doors"], key=key), "door metadata mismatch")
    path = info["centralPath"]
    for x in range(path["min"][0], path["max"][0] + 1):
        for y in range(path["min"][1], path["max"][1] + 1):
            for z in range(path["min"][2], path["max"][2] + 1):
                require((x, y, z) not in cells, "blocked three-wide central path")
    reachable = set()
    if beds:
        require(len(beds) >= 5, "house must provide five beds")
        # Reachability models a villager able to open the supplied wooden door;
        # it does not claim pathfinding through arbitrary existing terrain.
        def passable(x, z):
            return (x, 0, z) in cells and all(
                (x, y, z) not in cells or cells[x, y, z]["Name"] == "minecraft:spruce_door"
                for y in (1, 2))
        start = (info["entrance"][0], info["entrance"][2])
        require(passable(*start), "blocked entrance")
        todo = deque([start])
        reachable.add(start)
        while todo:
            x, z = todo.popleft()
            for dx, dz in DIRECTIONS.values():
                nxt = (x + dx, z + dz)
                if nxt not in reachable and passable(*nxt):
                    reachable.add(nxt)
                    todo.append(nxt)
        for bed in beds:
            require(any((part[0] + dx, part[2] + dz) in reachable
                        for part in (bed["head"], bed["foot"]) for dx, dz in DIRECTIONS.values()), "bed inaccessible from entrance")
        area = info["interiorFloor"]
        for x in range(area["min"][0], area["max"][0] + 1):
            for z in range(area["min"][2], area["max"][2] + 1):
                if cells.get((x, 1, z), {}).get("Name") == "minecraft:white_bed":
                    continue
                require(all((x, y, z) not in cells for y in (1, 2, 3)), "interior clear height below three blocks")
    return {"size": size, "blocks": len(cells), "palette": len(palette), "beds": len(beds),
            "doors": len(doors), "reachableGroundCells": len(reachable), "entities": 0,
            "blockEntityNbt": 0, "airCells": 0, "centralPathClear": True}


def validate_files() -> dict:
    metadata = json.loads((ROOT / "metadata.json").read_text(encoding="utf-8"))
    report = {}
    for name, info in metadata["assets"].items():
        snbt = (ROOT / info["files"]["nativeSnbt"]).read_bytes()
        data = json.loads(snbt)
        parsed = nbtlib.parse_nbt(snbt.decode())
        compressed = ROOT / info["files"]["compressedNbt"]
        native = nbtlib.load(compressed, gzipped=True)
        require(native == nbtlib.File(parsed), "SNBT / NBT roundtrip mismatch")
        require(compressed.read_bytes() == (ROOT / info["files"]["datapackNbt"]).read_bytes(), "datapack differs from Numen NBT")
        require(hashlib.sha256(snbt).hexdigest() == info["sha256"]["snbt"], "stale SNBT hash")
        require(hashlib.sha256(compressed.read_bytes()).hexdigest() == info["sha256"]["nbt"], "stale NBT hash")
        result = validate_structure(data, info)
        require(result["blocks"] == info["blockCount"] and result["palette"] == info["paletteCount"], "stale counts")
        from generate import material_counts
        cells = {tuple(cell["pos"]): data["palette"][cell["state"]] for cell in data["blocks"]}
        for key in ("placedBlocks", "equivalentItems"):
            require(material_counts(cells)[key] == info[key], "stale materials")
        report[name] = result
    require(json.loads((ROOT / "datapack/pack.mcmeta").read_text(encoding="utf-8"))["pack"]["pack_format"] == 48, "wrong datapack format")
    return report


if __name__ == "__main__":
    print(json.dumps({"ok": True, "checks": validate_files(),
                      "scope": "offline format, safety, pairing, support and empty-site reachability; no world placement"}, indent=2))
