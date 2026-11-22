"""Survey supported land and plan one protected ground platform per registered ruin."""
from __future__ import annotations

import argparse
from functools import lru_cache
import json
from pathlib import Path
import re

import yaml

from retrofit_access import Anvil


AIR = {"minecraft:air", "minecraft:cave_air", "minecraft:void_air"}
COVER = AIR | {"minecraft:short_grass", "minecraft:fern", "minecraft:dead_bush", "minecraft:snow",
               "minecraft:dandelion", "minecraft:poppy", "minecraft:blue_orchid", "minecraft:oxeye_daisy"}
GROUND = {"minecraft:grass_block", "minecraft:dirt", "minecraft:stone", "minecraft:gravel",
          "minecraft:coarse_dirt", "minecraft:sand", "minecraft:sandstone", "minecraft:andesite",
          "minecraft:podzol", "minecraft:snow_block", "minecraft:moss_block", "minecraft:mycelium"}
PUBLIC_SIGN = ["公共补给", "工作台·熔炉·铁砧", "共享箱可自由取放", "存入即公开分享"]
TRIAL_SIGN = (-585, 91, -315)
TRIAL_WORKSTATIONS = {
    (-585, 91, -314): "minecraft:crafting_table",
    (-585, 91, -313): "minecraft:furnace[facing=west,lit=false]",
    (-585, 91, -312): "minecraft:anvil[facing=north]",
    TRIAL_SIGN: "minecraft:oak_sign[rotation=4,waterlogged=false]",
}


def material(state):
    return (state or "").split("[", 1)[0]


def facility_layout(x, y, z):
    return {
        "sharedChest": ((x-3,y,z-1), "minecraft:chest[facing=east,type=left,waterlogged=false]"),
        "sharedChestOtherHalf": ((x-3,y,z), "minecraft:chest[facing=east,type=right,waterlogged=false]"),
        "craftingTable": ((x+3,y,z-1), "minecraft:crafting_table"),
        "furnace": ((x+3,y,z), "minecraft:furnace[facing=west,lit=false]"),
        "anvil": ((x+3,y,z+1), "minecraft:anvil[facing=north]"),
        "sign": ((x-3,y,z+1), "minecraft:oak_sign[rotation=12,waterlogged=false]"),
    }


def trial_workstations(reader):
    # Supplement the existing public boxes without editing either half or its inventory.
    for z in (-314, -311, -308):
        for x, half in ((-583, "left"), (-582, "right")):
            if reader.read(x,91,z) != f"minecraft:chest[facing=north,type={half},waterlogged=false]":
                raise ValueError("existing trial public double chests must be verified first")
    for x,y,z in TRIAL_WORKSTATIONS:
        if material(reader.read(x,y-1,z)) not in {"minecraft:stone_bricks", "minecraft:polished_andesite"} \
                or any(material(reader.read(x,py,z)) not in AIR for py in (y,y+1,y+2)):
            raise ValueError(f"trial workstation position is occupied or unsupported at {(x,y,z)}")
    return [{"at":list(at),"before":reader.read(*at),"after":state} for at,state in TRIAL_WORKSTATIONS.items()]


def plan(reader, sites, origin, excluded, include_trial=False):
    @lru_cache(maxsize=None)
    def top(x, z):
        sections = reader.sections(x // 16, z // 16)
        if sections is None:
            return None
        for y in range(max(sections) * 16 + 15, 61, -1):
            block = reader.read(x, y, z)
            if material(block) in COVER:
                continue
            return y if material(block) in GROUND else None
        return None

    def intersects(rect, other):
        return rect[0] <= other[2] and rect[2] >= other[0] and rect[1] <= other[3] and rect[3] >= other[1]

    x0, z0 = origin
    centers = [(x0 + dx, z0 + dz) for dx in range(-648, 649, 12) for dz in range(-648, 649, 12)]
    centers.sort(key=lambda p: (p[0]-x0)**2 + (p[1]-z0)**2)
    layout = {"schema-version": 1, "world": "world", "platforms": {}}
    reserved = list(excluded)
    changes, signs = [], []
    for site, definition in sites.items():
        for x, z in centers:
            rect = (x-5,z-6,x+5,z+6)
            if any(intersects(rect, other) for other in reserved):
                continue
            if top(x,z) is None:
                continue
            cells = [(px,pz,top(px,pz)) for px in range(x-3,x+4) for pz in range(z-4,z+5)]
            if any(height is None for _,_,height in cells):
                continue
            floor = max(height for _,_,height in cells)
            if any(not floor-2 <= height <= floor for _,_,height in cells):
                continue
            if not any(top(x+dx,z-5) in (floor-1,floor,floor+1) for dx in (-1,0,1)):
                continue
            y=floor+1
            blocks={}
            for px,pz,height in cells:
                blocks[px,floor,pz]="minecraft:polished_andesite" if abs(px-x)<3 else "minecraft:stone_bricks"
                for py in range(height+1,floor):
                    if material(reader.read(px,py,pz)) not in COVER:
                        raise ValueError("ground support changed during survey")
                    blocks[px,py,pz]="minecraft:stone_bricks"
                for py in (y,y+1,y+2):
                    state=reader.read(px,py,pz)
                    if material(state) not in AIR:
                        blocks[px,py,pz]="minecraft:air"
            blocks[x,y,z+3]="minecraft:stone_bricks"
            blocks[x,y,z+2]="minecraft:stone_button[face=wall,facing=north,powered=false]"
            blocks[x-2,y,z+2]="minecraft:oak_sign[rotation=8,waterlogged=false]"
            for dx in (-3,3):
                blocks[x+dx,y,z-3]="minecraft:lantern[hanging=false,waterlogged=false]"
            facilities=facility_layout(x,y,z)
            blocks.update(facilities.values())
            name=definition.get("name",site)
            short=name.split("·",1)[0][:12]
            signs.append({"at":[x-2,y,z+2],"front":[short,"请全员站到地砖","用石钮进入副本","通关30秒回地面"]})
            signs.append({"at":list(facilities["sign"][0]),"front":PUBLIC_SIGN})
            for at, after in sorted(blocks.items()):
                before=reader.read(*at)
                if before!=after:
                    changes.append({"site":site,"at":list(at),"before":before,"after":after})
            layout["platforms"][site]={"entry":[x,y,z-3],
                "hint":f"{name}的集结平台在主世界地面 {x},{y},{z-3}。两侧有公共补给设施，准备好后使用石钮。",
                "station":{"name":short+"集结台","board":[x-2,y,z+2],"button":[x,y,z+2],
                           "bounds":[x-3,floor-1,z-4,x+3,y+2,z+4],
                           "facilities":{key:list(at) for key,(at,_) in facilities.items() if key!="sign"}}}
            reserved.append(rect)
            break
        else:
            raise ValueError(f"找不到 {site} 的安全平地")
    edits={"schema":2,"world":"world","changes":changes,"signs":signs}
    if include_trial:
        edits["trialWorkstations"]=trial_workstations(reader)
    return layout,edits


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world",type=Path,required=True,help="Read-only overworld folder")
    parser.add_argument("--sites",type=Path,required=True)
    parser.add_argument("--regions",type=Path,required=True,help="Read-only WorldGuard overworld registry")
    parser.add_argument("--origin",nargs=2,type=int,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--include-trial-facilities",action="store_true",
                        help="Add workstations next to the three existing trial public chests")
    args=parser.parse_args()
    sites=yaml.safe_load(args.sites.read_text(encoding="utf-8"))["sites"]
    region_rows=yaml.safe_load(args.regions.read_text(encoding="utf-8"))["regions"]
    excluded=[]
    for name, data in region_rows.items():
        if name=="__global__":
            continue
        if (name=="qd_block_access_editors" or re.fullmatch(r"qd_block_access_outside_\d+",name)) \
                and not data.get("owners") and set(data.get("flags",{})) <= {
                    "build","build-group","passthrough","block-break","block-place","block-place-group","block-break-group"}:
            # The world-wide access policy has no parcel of its own.
            continue
        if data.get("type")=="cuboid":
            low,high=data["min"],data["max"]
            excluded.append((low["x"],low["z"],high["x"],high["z"]))
        elif data.get("type")=="poly2d" and data.get("points"):
            points=data["points"]
            excluded.append((min(p["x"] for p in points),min(p["z"] for p in points),
                             max(p["x"] for p in points),max(p["z"] for p in points)))
        else:
            raise ValueError(f"Cannot check protected region {name}")
    layout,edits=plan(Anvil(args.world / "region"),sites,args.origin,excluded,args.include_trial_facilities)
    args.output.mkdir(parents=True,exist_ok=False)
    (args.output / "dungeon-muster.yml").write_text(yaml.safe_dump(layout,allow_unicode=True,sort_keys=False),encoding="utf-8")
    (args.output / "muster-block-plan.json").write_text(json.dumps(edits,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"{len(sites)} platforms; {len(edits['changes'])} reviewed block preimages")


if __name__=="__main__":
    main()
