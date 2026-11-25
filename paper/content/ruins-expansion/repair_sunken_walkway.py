"""Build the reviewed north walkway and stair repair from a saved Aincrad world."""
import argparse
from collections import defaultdict
import json
from pathlib import Path

from apply_access import apply


SITE = "sunken_dynasty"
DIMENSION = "minecraft:aincrad"
AIR = "minecraft:air"
SANDSTONE = "minecraft:smooth_sandstone"
STAIR = "minecraft:smooth_sandstone_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]"
OLD_WALL = "minecraft:stone_brick_wall[east=low,north=none,south=none,up=false,waterlogged=false,west=low]"
NORTH_BRIDGE = [9216, 68, 8144, 9220, 74, 8156]
NEAR_LANDING = [9218, 68, 8142]
FIRST_ROOM = [9217, 78, 8204]


def construction():
    changes = {}
    # Three walking lanes between full-block parapets. The bridge joins
    # ground at elevation 68 and steps up to the existing apron at 72.
    for z in range(8144, 8156):
        y = 68 if z < 8152 else 69 + min(2, z - 8152)
        for x in range(9216, 9221):
            guard = x in (9216, 9220)
            if not guard and z in (8144, 8152, 8153, 8154):
                block = STAIR
            elif x == 9218 and z in (8146, 8150, 8155):
                block = "minecraft:sea_lantern"
            else:
                block = SANDSTONE
            changes[x, y, z] = AIR, block
            if guard:
                changes[x, y + 1, z] = AIR, SANDSTONE
    for x in range(9216, 9219):
        changes[x, 72, 8191] = AIR, STAIR
        changes[x, 78, 8196] = OLD_WALL, AIR
    changes[9218, 73, 8192] = "minecraft:sandstone", STAIR
    return changes


def survey(reader):
    changes = construction()
    def block(x, y, z):
        return changes.get((x, y, z), (None, reader.read(x, y, z)))[1]

    # Verify the inherited walkway too. A dry center is necessary but it
    # must also continue around the registration button and into the room.
    for x in range(9217, 9220):
        if reader.read(x, 67, 8143) != "minecraft:grass_block[snowy=false]":
            raise ValueError("north bank changed")
        if reader.read(x, 71, 8156) not in (SANDSTONE, "minecraft:sandstone"):
            raise ValueError("south bank changed")
    for z in range(8156, 8191):
        if block(9218, 71, z) not in (SANDSTONE, "minecraft:sandstone", "minecraft:cut_sandstone",
                                     "minecraft:sea_lantern", "minecraft:spruce_planks") or any(
                block(9218, y, z) != AIR for y in (72, 73)):
            raise ValueError(f"apron route changed at z={z}")
    for z in range(8191, 8197):
        y = z - 8119
        stair = block(9218, y, z)
        if stair not in (STAIR, STAIR.replace("smooth_", "")) or any(
                block(9218, head, z) != AIR for head in (y+1, y+2)):
            raise ValueError(f"main staircase changed at z={z}")
    for z in range(8197, 8205):
        if block(9218, 77, z) != SANDSTONE or any(block(9218, y, z) != AIR for y in (78, 79)):
            raise ValueError(f"first room route changed at z={z}")
    for position, (before, _) in changes.items():
        if reader.read(*position) != before:
            raise ValueError(f"changed construction preimage at {position}")
    return [{"at": list(position), "before": pre, "after": post}
            for position, (pre, post) in sorted(changes.items())]


def read_plan(path, reader):
    rows = survey(reader)
    audit = {"site": SITE, "world": DIMENSION, "approachProtection": NORTH_BRIDGE,
             "ground": NEAR_LANDING, "firstRoom": FIRST_ROOM, "changes": rows}
    path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    edits = defaultdict(list)
    for row in rows:
        x, y, z = row["at"]
        edits[x//16, z//16].append((x, y, z, row["before"], row["after"]))
    return edits, defaultdict(list)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world", type=Path, required=True, help="Read-only saved Aincrad dimension")
    parser.add_argument("--out", type=Path, required=True, help="New directory for candidate region files")
    parser.add_argument("--audit", type=Path, required=True, help="Write reviewed per-block preimages here")
    args = parser.parse_args()
    if args.audit.exists() or args.out.exists():
        parser.error("audit and output must be new paths")
    apply(args.world, args.audit, args.out, read_plan)
