"""Plan ten reversible entrance and foundation retrofits from saved Anvil chunks.

Existing region files are read only. Room, reward and placement data are retained.
All commands and changed perimeter cells are recorded for isolated validation.
"""
from __future__ import annotations

import argparse
import gzip
from functools import lru_cache
import io
import json
from pathlib import Path
import struct
import zlib

import nbtlib
import yaml

AIR = "minecraft:air"
STYLES = {
    "corsair_cove": ("黑帆码头", "dark_oak_planks", "spruce_planks", "mossy_cobblestone"),
    "deep_mineworks": ("深岩升降井", "polished_deepslate", "spruce_planks", "cobbled_deepslate"),
    "ember_foundry": ("熔炉外岗", "polished_blackstone_bricks", "red_nether_bricks", "blackstone"),
    "frost_keep": ("霜落桥头", "stone_bricks", "packed_ice", "andesite"),
    "jungle_covenant": ("翠藤营门", "mossy_stone_bricks", "mud_bricks", "mossy_cobblestone"),
    "sky_watch": ("云阶升降台", "smooth_stone", "calcite", "andesite"),
    "sunken_dynasty": ("沉沙墓前驿", "smooth_sandstone", "cut_sandstone", "sandstone"),
    "tide_sanctum": ("潮汐堤岸", "prismarine_bricks", "dark_prismarine", "prismarine"),
    "void_citadel": ("回响城门岗", "end_stone_bricks", "purpur_block", "end_stone"),
    "winter_manor": ("永夜庄园外庭", "dark_oak_planks", "polished_deepslate", "tuff"),
}
ORIGINAL_TOPS = {
    "sand", "prismarine_bricks", "sandstone", "snow_block", "blackstone",
    "moss_block", "stone_bricks", "end_stone_bricks", "andesite", "coarse_dirt",
}


class Anvil:
    def __init__(self, region: Path):
        self.region = region

    @lru_cache(maxsize=22)
    def file(self, rx, rz):
        path = self.region / f"r.{rx}.{rz}.mca"
        return path.read_bytes() if path.is_file() else None

    @lru_cache(maxsize=96)
    def chunk(self, cx, cz):
        data = self.file(cx // 32, cz // 32)
        if data is None:
            return None
        slot = (cx % 32) + 32 * (cz % 32)
        loc, = struct.unpack_from(">I", data, slot * 4)
        offset = (loc >> 8) * 4096
        if not offset:
            return None
        size, = struct.unpack_from(">I", data, offset)
        kind = data[offset + 4]
        if kind not in (1, 2, 3) or not 1 < size <= (loc & 255) * 4096 - 4:
            raise ValueError("unsupported Anvil chunk record")
        value = data[offset + 5:offset + 4 + size]
        if kind == 1:
            value = gzip.decompress(value)
        if kind == 2:
            value = zlib.decompress(value)
        nbt = nbtlib.File.parse(io.BytesIO(value))
        if (int(nbt["xPos"]), int(nbt["zPos"])) != (cx, cz):
            raise ValueError("Anvil region chunk coordinates disagree")
        return nbt

    @lru_cache(maxsize=96)
    def sections(self, cx, cz):
        chunk = self.chunk(cx, cz)
        if chunk is None:
            return None
        sections = {}
        for s in chunk["sections"]:
            states = s.get("block_states")
            if not states:
                continue
            entries = []
            for b in states["palette"]:
                props = b.get("Properties", {})
                suffix = "[" + ",".join(f"{k}={v}" for k, v in sorted(props.items())) + "]" if props else ""
                entries.append(str(b["Name"]) + suffix)
            sections[int(s["Y"])] = entries, states.get("data", ())
        return sections

    def read(self, x, y, z):
        sections = self.sections(x // 16, z // 16)
        if sections is None:
            return None
        if y // 16 not in sections:
            return AIR
        palette, values = sections[y // 16]
        if len(palette) == 1:
            return palette[0]
        bits = max(4, (len(palette) - 1).bit_length())
        i = ((y % 16) * 16 + z % 16) * 16 + x % 16
        per_word = 64 // bits
        return palette[(int(values[i // per_word]) >> ((i % per_word) * bits)) & ((1 << bits) - 1)]


def plaza(reader, bounds, first):
    x0, y0, z0, x1, _, z1 = bounds
    y = y0 + 8
    # Stay on the already imported apron. Prefer the north approach unless
    # it is occupied by preserved masonry, landscaping or later changes.
    for stretch in (18, 29, 41):
        origins = [(x, z0 + offset) for offset in range(7, stretch)
                   for x in range(max(x0 + 8, first[0] - 28), min(x1 - 8, first[0] + 29), 2)]
        origins.sort(key=lambda pos: (pos[1], abs(pos[0] - first[0])))
        for x, z in origins:
            if z + 14 >= z1:
                continue
            ground = [(x+dx, y-1, z+dz) for dx in range(-4,5) for dz in range(15)]
            if not all((reader.read(*p) or "").removeprefix("minecraft:") in ORIGINAL_TOPS for p in ground):
                continue
            if any(reader.read(a, yy, c) != AIR for a, _, c in ground for yy in range(y, y+4)):
                continue
            return x, y, z
    raise ValueError("no dry unobstructed apron within reviewed candidate bounds")


def build_station(reader, site_id, cfg, bounds):
    title, path_material, trim, _ = STYLES[site_id]
    x, y, z = plaza(reader, bounds, cfg["rooms"][0]["center"])
    entries = {}

    def add(a, b, c, material):
        before = reader.read(a, b, c)
        after = "minecraft:" + material
        if before is None:
            raise ValueError("station cell is not generated")
        if before != after:
            entries[a, b, c] = {"at":[a,b,c],"before":before,"after":after}

    for dz in range(15):
        width = 4 if dz < 5 or dz >= 10 else 2
        for dx in range(-width,width+1):
            material = trim if abs(dx)==width else path_material
            if abs(dx)==width and dz in (1,4,7,10,12):
                material = "sea_lantern"
            add(x+dx,y-1,z+dz,material)
    for dx in (-3,3):
        for dy in range(3):
            add(x+dx,y+dy,z+13,trim)
        add(x+dx,y+3,z+13,"sea_lantern")
    for dx in range(-2,3):
        add(x+dx,y+3,z+13,path_material)
    add(x,y,z+13,trim)
    add(x,y+1,z+13,trim)
    add(x,y+1,z+12,"stone_button[face=wall,facing=north,powered=false]")
    add(x-2,y,z+12,"oak_sign[rotation=8,waterlogged=false]")
    lower, upper = [x-4,y-1,z],[x+4,y+3,z+14]
    station = {"name":title,"board":[x-2,y,z+12],"button":[x,y+1,z+12],"bounds":lower+upper}
    sign = ["【"+cfg["name"]+"】", title, "沿灯到石钮", "使用键 · 进入首室"]
    hint = f"落在「{title}」；沿发光铺装向南，走到入口牌旁按石钮，抵达首室后再选难度。"
    return {"entry":[x,y,z+2],"hint":hint,"station":station},list(entries.values()),sign


def supports(reader, bounds, material):
    x0, top, z0, x1, _, z1 = bounds
    # Nine tapered rock or masonry buttresses keep both the middle and outer
    # sections attached. Upper faces meet original floor; each footing rests
    # on an observed solid block. This adds below the old apron only.
    supports = []
    for x_fraction,z_fraction in ((.5,.5),(.21,.28),(.5,.19),(.79,.28),
                                   (.18,.54),(.82,.54),(.24,.75),(.5,.82),(.76,.75)):
        x = round(x0+(x1-x0)*x_fraction)
        z = round(z0+(z1-z0)*z_fraction)
        footing = None
        for y in range(top-1, -64, -1):
            b = reader.read(x,y,z)
            if b is None:
                raise ValueError("unknown foundation column")
            if b not in (AIR,"minecraft:cave_air","minecraft:void_air"):
                if b in ("minecraft:water","minecraft:lava"):
                    raise ValueError("liquid below proposed footing")
                footing = y
                break
        if footing is None or top-footing > 128:
            raise ValueError("no grounded footing")
        if top-footing < 2:
            continue
        if reader.read(x,top,z) == AIR:
            raise ValueError("footing cannot meet the existing platform")
        bands = []
        for radius, end in ((5,footing+max(1,(top-footing)//3)),(4,footing+max(2,(top-footing)*2//3)),(3,top-1)):
            start = (bands[-1][4]+1) if bands else footing+1
            if start > end:
                continue
            bands.append([x-radius,start,z-radius,x+radius,end,z+radius])
        supports.append({"anchor":[x,footing,z],"anchorBlock":reader.read(x,footing,z),
                         "top":[x,top,z],"upperBlock":reader.read(x,top,z),"bands":bands,
                         "material":"minecraft:"+material})
    if len(supports) < 5:
        raise ValueError("missing verified buttresses")
    return supports


def run(dungeons, world, out):
    doc = yaml.safe_load(dungeons.read_text(encoding="utf-8-sig"))
    reader = Anvil(world / "region")
    result = {"schema":1,"world":"minecraft:aincrad","sites":[]}
    for site_id, style in STYLES.items():
        cfg = doc["sites"][site_id]
        if cfg["world"] != "aincrad" or cfg.get("approach") is not None or len(cfg["rooms"]) != 3:
            raise ValueError(site_id + ": unexpected existing definition")
        bounds = cfg["protection-boxes"][0]
        new, blocks, sign = build_station(reader,site_id,cfg,bounds)
        bearing = supports(reader,bounds,style[3])
        cfg["approach"] = new
        cfg["protection-boxes"].extend(
            [[b["bands"][0][0], b["anchor"][1], b["bands"][0][2], b["bands"][0][3],
              b["top"][1]-1, b["bands"][0][5]] for b in bearing]
        )
        result["sites"].append({"id":site_id,"title":style[0],"landing":new["entry"],
                                "station":new["station"],"firstRoom":cfg["rooms"][0]["center"],
                                "upperLanding":cfg["entry"],"sign":sign,"stationBlocks":blocks,"supports":bearing})
    out.mkdir(exist_ok=False,parents=True)
    (out/"geometry.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    (out/"dungeons.yml").write_text(yaml.safe_dump(doc,allow_unicode=True,sort_keys=False),encoding="utf-8")
    print(json.dumps({"sites":len(result["sites"]),"stations":[{"site":s["id"],"name":s["title"],"at":s["landing"],
                      "newBlocks":len(s["stationBlocks"]),"pierCount":len(s["supports"])} for s in result["sites"]]},ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("dungeons", "world", "out"):
        parser.add_argument("--"+arg,type=Path,required=True)
    args=parser.parse_args()
    run(args.dungeons,args.world,args.out)
