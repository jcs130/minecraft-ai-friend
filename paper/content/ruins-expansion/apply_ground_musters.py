"""Build cold replacement regions for surveyed overworld platforms."""
import argparse
from collections import defaultdict
import json
from pathlib import Path

import yaml

from apply_access import apply
from plan_ground_musters import (AIR, COVER, GROUND, PUBLIC_SIGN, TRIAL_SIGN, facility_layout,
                                 material, trial_workstations)


def read_plan(path, reader):
    config=yaml.safe_load((path.parent/"dungeon-muster.yml").read_text(encoding="utf-8"))
    data=json.loads(path.read_bytes())
    schema=data["schema"]
    if config["schema-version"]!=1 or schema not in (1,2) or config["world"]!="world" or data["world"]!="world":
        raise ValueError("muster dimension or schema")
    platforms=config["platforms"]
    if not 1<=len(platforms)<=16 or len(data["changes"])>2500:
        raise ValueError("muster platform budget")
    expected, public_signs={},set()
    for site, row in platforms.items():
        if schema==2:
            x,y,z=row["entry"]
            facilities=facility_layout(x,y,z+3)
            expected[site]=dict(facilities.values())
            public_signs.add(facilities["sign"][0])
            if row["station"].get("facilities") != {key:list(at) for key,(at,_) in facilities.items() if key!="sign"}:
                raise ValueError(f"facility coordinates disagree for {site}")
        elif "facilities" in row["station"]:
            raise ValueError("supplies require block plan schema 2")
    allowed={"minecraft:polished_andesite","minecraft:stone_bricks","minecraft:air",
             "minecraft:stone_button","minecraft:oak_sign","minecraft:lantern"}
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
        facility=expected.get(block["site"],{}).pop((x,y,z),None)
        if (facility is not None and facility!=after) or (facility is None and material(after) not in allowed):
            raise ValueError(f"unexpected platform construction material at {(x,y,z)}")
        used[x,y,z]=after
        edits[x//16,z//16].append((x,y,z,before,after))
    if any(expected.values()):
        raise ValueError("incomplete public facilities")
    if "trialWorkstations" in data:
        if schema!=2 or data["trialWorkstations"]!=trial_workstations(reader):
            raise ValueError("trial workstation plan differs from reviewed positions")
        for block in data["trialWorkstations"]:
            x,y,z=block["at"]
            if (x,y,z) in used:
                raise ValueError("trial workstation overlaps a platform edit")
            used[x,y,z]=block["after"]
            edits[x//16,z//16].append((x,y,z,block["before"],block["after"]))
        signs[TRIAL_SIGN[0]//16,TRIAL_SIGN[2]//16].append((TRIAL_SIGN,PUBLIC_SIGN))
    for row in platforms.values():
        for x,y,z in row["station"].get("facilities",{}).values():
            if material(used.get((x,y+1,z),reader.read(x,y+1,z))) not in AIR:
                raise ValueError(f"facility is obstructed at {(x,y,z)}")
    boards={tuple(row["station"]["board"]) for row in platforms.values()} | public_signs
    for board in data["signs"]:
        x,y,z=board["at"]
        if (x,y,z) not in boards or material(used.get((x,y,z)))!="minecraft:oak_sign" \
                or ((x,y,z) in public_signs and board["front"]!=PUBLIC_SIGN):
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
