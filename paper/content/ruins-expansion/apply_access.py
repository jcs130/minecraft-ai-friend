"""Create replacement region images from the current saved world and an audited plan.

Apply only after the source server has stopped. Input files remain read only.
Changed block cells must match their complete preimages.
"""
import argparse
from collections import defaultdict
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import zlib

import nbtlib
from nbtlib import Byte, Compound, Int, List, LongArray, String

from retrofit_access import AIR, Anvil, STYLES


def state_tag(state):
    if not re.fullmatch(r"minecraft:[a-z0-9_]+(?:\[[a-z0-9_=,]+\])?", state):
        raise ValueError("invalid block state: " + state)
    name, _, encoded = state.partition("[")
    tag = Compound({"Name": String(name)})
    if encoded:
        tag["Properties"] = Compound({k: String(v) for k, v in
                                       (p.split("=") for p in encoded[:-1].split(","))})
    return tag


def edit_volume(rows, limits, support):
    at0, at1 = limits[:3], limits[3:]
    if any(b<a for a,b in zip(at0,at1)) or not -64<=at0[1]<=at1[1]<320:
        raise ValueError("invalid footing bounds")
    if any(b-a>128 for a,b in zip(at0,at1)):
        raise ValueError("footing band exceeds local scope")
    for x in range(at0[0],at1[0]+1):
        for y in range(at0[1],at1[1]+1):
            for z in range(at0[2],at1[2]+1):
                rows.append(([x,y,z],AIR,support))


def read_plan(path, reader):
    plan = json.loads(path.read_bytes())
    if plan["schema"] != 1 or plan["world"] != "minecraft:aincrad":
        raise ValueError("unexpected dimension")
    if tuple(row["id"] for row in plan["sites"]) != tuple(STYLES):
        raise ValueError("expected the ten known sites")
    edits, signs = defaultdict(list), defaultdict(list)
    used = set()
    for site in plan["sites"]:
        rows = [(e["at"],e["before"],e["after"]) for e in site["stationBlocks"]]
        if len(rows)>180 or len(site["supports"])!=9:
            raise ValueError("geometry budget or support count")
        for support in site["supports"]:
            for key, block in (("anchor","anchorBlock"), ("top","upperBlock")):
                if reader.read(*support[key]) != support[block]:
                    raise ValueError(f"bearing changed for {site['id']} at {support[key]}")
            for box in support["bands"]:
                edit_volume(rows,box,support["material"])
        if len(rows)>110000:
            raise ValueError("site exceeds cell budget")
        ex, _, ez = site["upperLanding"]
        for pos, before, after in rows:
            x,y,z = pos
            if abs(ex-x)>256 or abs(ez-z)>256 or not -64<=y<320 or tuple(pos) in used:
                raise ValueError("invalid or overlapping edit position")
            used.add(tuple(pos))
            edits[x//16,z//16].append((x,y,z,before,after))
        sign = site["station"]["board"]
        if not any(p==sign and after.startswith("minecraft:oak_sign[") for p,_,after in rows):
            raise ValueError("missing reviewed sign block")
        signs[sign[0]//16,sign[2]//16].append((sign,site["sign"]))
    return edits, signs


def unpack(states):
    palette=states["palette"]
    if len(palette)==1: return [0]*4096
    bits=max(4,(len(palette)-1).bit_length())
    per=64//bits
    data=states["data"]
    return [(int(data[i//per])>>((i%per)*bits))&((1<<bits)-1) for i in range(4096)]


def replace_section(section, rows):
    states=section.get("block_states")
    if states is None: states=Compound({"palette":List[Compound]([state_tag(AIR)])})
    data=unpack(states)
    palette=list(states["palette"])
    index={str(tag):i for i,tag in enumerate(palette)}
    added={}
    for x,y,z,name in rows:
        if name not in added:
            tag=state_tag(name)
            key=str(tag)
            if key not in index:
                index[key]=len(palette)
                palette.append(tag)
            added[name]=index[key]
        data[((y%16)*16+z%16)*16+x%16]=added[name]
    packed=Compound({"palette": List[Compound](palette)})
    if len(palette)>1:
        bits=max(4,(len(palette)-1).bit_length())
        per=64//bits
        raw=[0]*((4096+per-1)//per)
        for i, value in enumerate(data):
            raw[i//per] |= value<<((i%per)*bits)
        packed["data"]=LongArray([value if value<(1<<63) else value-(1<<64) for value in raw])
    section["block_states"]=packed


def sign_nbt(pos, lines):
    if len(lines)!=4 or any(not isinstance(line,str) or len(line)>40 for line in lines):
        raise ValueError("sign line length")
    def face(contents):
        return Compound({"messages":List[String]([
            String(json.dumps({"text":line},ensure_ascii=False)) for line in contents]),
            "color":String("black"),"has_glowing_text":Byte(0)})
    return Compound({"id":String("minecraft:sign"),"x":Int(pos[0]),"y":Int(pos[1]),"z":Int(pos[2]),
                     "front_text":face(lines),"back_text":face(["","","",""]),"is_waxed":Byte(1)})


def replacement_chunk(reader, id, rows, signs):
    original=reader.chunk(*id)
    if original is None or int(original["DataVersion"])!=3955 or str(original["Status"])!="minecraft:full":
        raise ValueError(f"full 1.21.1 saved chunk required: {id}")
    sections={int(s["Y"]):s for s in original["sections"]}
    by_height=defaultdict(list)
    for x,y,z,before,after in rows:
        live=reader.read(x,y,z)
        if live!=before:
            raise ValueError(f"changed source block {(x,y,z)}: expected {before}, got {live}")
        by_height[y//16].append((x,y,z,after))
    # Source chunks are full, including biome sections. Never invent a section
    # biome or restore a neighboring chunk from an older snapshot.
    if not set(by_height)<=sections.keys():
        raise ValueError(f"missing biome section in edited chunk {id}")
    for height,cells in by_height.items():
        replace_section(sections[height],cells)
    block_entities=original.get("block_entities", [])
    if signs and not block_entities:
        block_entities=List[Compound]([])
        original["block_entities"]=block_entities
    occupied={(int(b["x"]),int(b["y"]),int(b["z"])) for b in block_entities}
    for pos,lines in signs:
        if tuple(pos) in occupied:
            raise ValueError("original block entity at station sign")
        block_entities.append(sign_nbt(pos,lines))
    for section in original["sections"]:
        section.pop("BlockLight",None)
        section.pop("SkyLight",None)
    original.pop("Heightmaps",None)
    original.pop("isLightOn",None)
    target=io.BytesIO()
    original.write(target)
    payload=zlib.compress(target.getvalue(),6)
    return struct.pack(">IB",len(payload)+1,2)+payload


def rebuild_region(original, replacements):
    if len(original)<8192 or len(original)%4096:
        raise ValueError("invalid source region")
    header=bytearray(original[:8192])
    parts=[]
    new_offset=2
    for slot in range(1024):
        loc,=struct.unpack_from(">I",original,slot*4)
        if not loc:
            if slot in replacements:raise ValueError("missing original region slot")
            continue
        old_start,old_count=loc>>8,loc&255
        if old_start<2 or old_count<1 or (old_start+old_count)*4096>len(original):
            raise ValueError("invalid source region pointer")
        record=replacements.get(slot,original[old_start*4096:(old_start+old_count)*4096])
        length=(len(record)+4095)//4096
        if length>255: raise ValueError("external chunk storage needed")
        struct.pack_into(">I",header,slot*4,(new_offset<<8)|length)
        parts.append(record+b"\0"*(length*4096-len(record)))
        new_offset+=length
    return bytes(header)+b"".join(parts)


def apply(world, geometry, out):
    reader=Anvil(world/"region")
    changes,signs=read_plan(geometry,reader)
    grouped=defaultdict(dict)
    for (cx,cz),rows in sorted(changes.items()):
        grouped[cx//32,cz//32][cx%32+32*(cz%32)]=replacement_chunk(
            reader,(cx,cz),rows,signs[cx,cz])
    out.mkdir(exist_ok=False,parents=True)
    report={"cells":sum(map(len,changes.values())),"chunks":len(changes),"regions":[]}
    for (rx,rz),replacements in sorted(grouped.items()):
        name=f"r.{rx}.{rz}.mca"
        old=reader.file(rx,rz)
        new=rebuild_region(old,replacements)
        (out/name).write_bytes(new)
        report["regions"].append({"name":name,
                                  "beforeSha256":hashlib.sha256(old).hexdigest(),
                                  "sha256":hashlib.sha256(new).hexdigest()})
    (out/"world-patch.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({**report,"regions":len(report["regions"])}))


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for option in ("world","geometry","out"):
        p.add_argument("--"+option,type=Path,required=True)
    a=p.parse_args()
    apply(a.world,a.geometry,a.out)
