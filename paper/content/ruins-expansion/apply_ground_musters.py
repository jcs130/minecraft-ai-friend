"""Build cold replacement regions for surveyed overworld platforms."""
import argparse
from collections import defaultdict
import json
from pathlib import Path

import yaml

from apply_access import apply
from plan_ground_musters import COVER, GROUND, material


def read_plan(path, reader):
    config=yaml.safe_load((path.parent/"dungeon-muster.yml").read_text(encoding="utf-8"))
    data=json.loads(path.read_bytes())
    if config["schema-version"]!=1 or data["schema"]!=1 or config["world"]!="world" or data["world"]!="world":
        raise ValueError("muster dimension or schema")
    platforms=config["platforms"]
    if not 1<=len(platforms)<=16 or len(data["changes"])>2500:
        raise ValueError("muster platform budget")
    used={}
    edits,signs=defaultdict(list),defaultdict(list)
    for block in data["changes"]:
        x,y,z=block["at"]
        station=platforms[block["site"]]["station"]
        bounds=station["bounds"]
        before,after=block["before"],block["after"]
        if not all(bounds[i]<=(x,y,z)[i]<=bounds[i+3] for i in range(3)) or (x,y,z) in used:
            raise ValueError(f"out of bounds or overlapping platform edit at {(x,y,z)}")
        if material(before) not in COVER | GROUND or reader.read(x,y,z)!=before:
            raise ValueError(f"platform preimage changed at {(x,y,z)}")
        allowed={"minecraft:polished_andesite","minecraft:stone_bricks","minecraft:air",
                 "minecraft:stone_button","minecraft:oak_sign","minecraft:lantern"}
        if material(after) not in allowed:
            raise ValueError(f"unexpected platform construction material at {(x,y,z)}")
        used[x,y,z]=after
        edits[x//16,z//16].append((x,y,z,before,after))
    boards={tuple(row["station"]["board"]) for row in platforms.values()}
    for board in data["signs"]:
        x,y,z=board["at"]
        if (x,y,z) not in boards or material(used[x,y,z])!="minecraft:oak_sign":
            raise ValueError("missing reviewed platform sign")
        boards.remove((x,y,z))
        signs[x//16,z//16].append((board["at"],board["front"]))
    if boards or any(material(used.get(tuple(row["station"]["button"])))!="minecraft:stone_button" for row in platforms.values()):
        raise ValueError("incomplete platform")
    return edits,signs


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for option in ("world","geometry","out"):
        parser.add_argument("--"+option,type=Path,required=True)
    args=parser.parse_args()
    apply(args.world,args.geometry,args.out,read_plan)
