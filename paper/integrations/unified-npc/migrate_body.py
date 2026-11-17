"""Cold, single-identity TLM -> Numen migration. Prepare is read-only; apply needs a stopped server.

Never use the preimage to roll back after the migrated character has played. Its
latest player data, role ledger and memories must then be retained/reconciled.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import time
import uuid
import zlib

import nbtlib as n


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(value):
    return str(uuid.UUID(hex="".join(f"{int(i)&0xffffffff:08x}" for i in value)))


def encoded(tag):
    stream = io.BytesIO()
    n.File(tag).write(stream)
    return stream.getvalue()


def chunks(blob):
    if not blob:
        return  # Youer may create an empty region handle without any saved chunks.
    if len(blob) < 8192 or len(blob) % 4096:
        raise ValueError("invalid_region_length")
    for slot in range(1024):
        sector = int.from_bytes(blob[4*slot:4*slot+3], "big")
        if not sector:
            continue
        size = blob[4*slot+3]
        pos = sector*4096
        length = int.from_bytes(blob[pos:pos+4], "big")
        if sector < 2 or pos+size*4096 > len(blob) or length < 1 or length+4 > size*4096 or blob[pos+4] != 2:
            raise ValueError("unsupported_or_corrupt_entity_region")
        yield slot, n.File.parse(io.BytesIO(zlib.decompress(blob[pos+5:pos+4+length])))


def remove_entity(blob, wanted):
    found = []
    for slot, root in chunks(blob):
        entities = root.get("Entities", [])
        for i, entity in enumerate(entities):
            if "UUID" in entity and identity(entity["UUID"]) == wanted:
                found.append((slot, root, i))
            # Do not detach a mounted entity by accidentally deleting its carrier.
            def nested(node):
                for passenger in node.get("Passengers", []):
                    if identity(passenger["UUID"]) == wanted:
                        raise ValueError("dismount_required_before_migration")
                    nested(passenger)
            nested(entity)
    if len(found) != 1:
        raise ValueError("original_entity_not_unique")
    slot, root, index = found[0]
    original = deepcopy(root["Entities"][index])
    if str(original.get("id")) != "touhou_little_maid:maid" or original.get("Passengers"):
        raise ValueError("only_unmounted_native_maid_supported")
    del root["Entities"][index]
    data = zlib.compress(encoded(root))
    record = (len(data)+1).to_bytes(4, "big") + b"\x02" + data
    sectors = (len(record)+4095)//4096
    if sectors > 255 or len(blob)//4096 > 0xffffff:
        raise ValueError("region_capacity")
    result = bytearray(blob)
    result[4*slot:4*slot+4] = (len(blob)//4096).to_bytes(3, "big") + bytes([sectors])
    result[4096+4*slot:4100+4*slot] = int(time.time()).to_bytes(4, "big")
    result += record + bytes(sectors*4096-len(record))
    return bytes(result), original


def item_key(item):
    value = deepcopy(item)
    value.pop("Slot", None)
    value.pop("count", None)
    def canonical(tag):
        if isinstance(tag, n.Compound):
            return n.Compound({key: canonical(tag[key]) for key in sorted(tag)})
        if isinstance(tag, n.List):
            return type(tag)([canonical(entry) for entry in tag])
        return tag
    return canonical(value).snbt()


def items_in_maid(entity):
    result = []
    for key in ("HandItems", "ArmorItems"):
        result += [deepcopy(i) for i in entity.get(key, []) if i.get("id") and int(i.get("count", 0)) > 0]
    for key in ("MaidInventory", "MaidTaskInventory", "MaidHideInventory", "MaidBaubleInventory"):
        result += [deepcopy(i) for i in entity.get(key, {}).get("Items", []) if i.get("id") and int(i.get("count", 0)) > 0]
    if entity.get("MaidBackpackData"):
        raise ValueError("opaque_backpack_data_requires_explicit_conversion")
    return result


def counts(items):
    result = Counter()
    for item in items:
        result[item_key(item)] += int(item["count"])
    return result


def player_data(entity, owner, dimension, data_version):
    if identity(entity["Owner"]) != owner or float(entity["Health"]) <= 0:
        raise ValueError("original_owner_or_life_mismatch")
    source = items_in_maid(entity)
    inventory, ender, remaining = [], [], []
    occupied = set()
    def add(item, slot):
        if not item.get("id") or int(item.get("count", 0)) <= 0:
            return
        value = deepcopy(item)
        value["Slot"] = n.Byte(slot)
        inventory.append(value)
        occupied.add(slot)
    for i, item in enumerate(entity.get("HandItems", [])):
        add(item, (0, -106)[i])
    for i, item in enumerate(entity.get("ArmorItems", [])):
        add(item, 100+i)
    for key in ("MaidInventory", "MaidTaskInventory", "MaidHideInventory", "MaidBaubleInventory"):
        remaining += list(entity.get(key, {}).get("Items", []))
    for item in remaining:
        if not item.get("id") or int(item.get("count", 0)) <= 0:
            continue
        slot = next((i for i in range(36) if i not in occupied), None)
        if slot is not None:
            add(item, slot)
        elif len(ender) < 27:
            value = deepcopy(item); value["Slot"] = n.Byte(len(ender)); ender.append(value)
        else:
            raise ValueError("inventory_overflow_no_items_destroyed")
    if counts(source) != counts(inventory+ender):
        raise ValueError("item_conservation_failed")
    maximum = next((float(a["base"]) for a in entity.get("attributes", []) if str(a["id"]) == "minecraft:generic.max_health"), 20)
    result = n.Compound({
        "UUID": deepcopy(entity["UUID"]), "DataVersion": n.Int(data_version), "Dimension": n.String(dimension),
        "Pos": deepcopy(entity["Pos"]), "Rotation": deepcopy(entity["Rotation"]),
        "Motion": n.List[n.Double]([0, 0, 0]), "Health": n.Float(min(float(entity["Health"]), maximum)),
        "attributes": n.List[n.Compound]([n.Compound({"id": n.String("minecraft:generic.max_health"), "base": n.Double(maximum)})]),
        "Inventory": n.List[n.Compound](inventory), "EnderItems": n.List[n.Compound](ender),
        "SelectedItemSlot": n.Int(0), "playerGameType": n.Int(0), "foodLevel": n.Int(20), "foodSaturationLevel": n.Float(5),
        "Air": n.Short(300), "OnGround": n.Byte(1), "Fire": n.Short(-1), "FallDistance": n.Float(0),
        "NeoForgeData": n.Compound({"qd_hosted_migration": n.Compound({"phase": n.String("prepared"),
            "body": n.String(identity(entity["UUID"])), "health": n.Float(float(entity["Health"])),
            "sourceSha256": n.String(digest(encoded(entity)))})}),
        "abilities": n.Compound({"invulnerable": n.Byte(0), "flying": n.Byte(0), "mayfly": n.Byte(0), "instabuild": n.Byte(0),
                                  "mayBuild": n.Byte(1), "flySpeed": n.Float(.05), "walkSpeed": n.Float(.1)}),
    })
    # Do not copy maid capabilities or NumenOwner into a new player: admission
    # owns those fields. Original native history and model remain in the archive.
    return gzip.compress(encoded(result), mtime=0), {"stacks": len(source), "items": sum(counts(source).values()), "enderStacks": len(ender),
        "health": float(result["Health"]), "nativeModel": str(entity.get("YsmModelId", ""))}


def cold(port):
    with socket.socket() as sock:
        sock.settimeout(.25)
        if sock.connect_ex(("127.0.0.1", port)) == 0:
            raise ValueError("server_must_be_stopped")


def save_plan(out, plan):
    target=out/"migration.json";temp=out/"migration.json.tmp"
    with temp.open("w",encoding="utf8") as stream:
        json.dump(plan,stream,ensure_ascii=False,indent=2);stream.flush();os.fsync(stream.fileno())
    os.replace(temp,target)


def inside(root, relative):
    value = (root / relative).resolve()
    if not value.is_relative_to(root.resolve()):
        raise ValueError("path_outside_server")
    return value


def original_copies(server, entity_dir, wanted):
    """Check installed worlds, including custom dimensions and passengers."""
    roots = [p for p in server.iterdir() if p.is_dir() and (p / 'level.dat').is_file()]
    directories = {entity_dir.resolve()}
    for root in roots:
        directories.update(p.resolve() for p in root.rglob('entities') if p.is_dir())
    def occurrences(node):
        return int('UUID' in node and identity(node['UUID']) == wanted) + sum(
            occurrences(child) for child in node.get('Passengers', []))
    matches = []
    for directory in sorted(directories):
        for path in sorted(directory.glob('r.*.*.mca')):
            for _, root in chunks(path.read_bytes()):
                matches.extend([str(path.resolve())] * sum(occurrences(e) for e in root.get('Entities', [])))
    return matches


def prepare(server: Path, entities: str, world: str, wanted: str, owner: str, dimension: str, out: Path, port: int):
    cold(port); wanted = str(uuid.UUID(wanted)); owner = str(uuid.UUID(owner))
    entity_dir = inside(server, entities)
    copies = original_copies(server, entity_dir, wanted)
    if len(copies) != 1 or Path(copies[0]).parent != entity_dir.resolve():
        raise ValueError("original_entity_not_unique_across_worlds")
    target = inside(server, world + "/playerdata/" + wanted + ".dat")
    if target.exists() or target.with_suffix(".dat_old").exists():
        raise ValueError("player_identity_already_exists_no_overwrite")
    matches = []
    for path in entity_dir.glob("r.*.*.mca"):
        blob = path.read_bytes()
        for _, root in chunks(blob):
            if any("UUID" in e and identity(e["UUID"]) == wanted for e in root.get("Entities", [])):
                matches.append((path, blob, int(root.get("DataVersion", 3955))))
    if len(matches) != 1:
        raise ValueError("original_entity_not_unique")
    path, blob, version = matches[0]
    updated, entity = remove_entity(blob, wanted)
    player, inventory = player_data(entity, owner, dimension, version)
    out.mkdir(parents=True, exist_ok=False)
    for name, data in {"region.before": blob, "region.after": updated, "player.after": player, "maid.before.nbt": encoded(entity)}.items():
        (out/name).write_bytes(data)
    plan = {"schema": 1, "state": "prepared", "server": str(server.resolve()), "gamePort": port,
            "uuid": wanted, "ownerUuid": owner, "inventory": inventory,
            "region": str(path.resolve()), "player": str(target.resolve()), "identityCopies": copies,
            "hashes": {name: digest((out/name).read_bytes()) for name in ("region.before", "region.after", "player.after", "maid.before.nbt")}}
    save_plan(out,plan)
    return plan


def apply(out: Path):
    plan = json.loads((out/"migration.json").read_bytes()); cold(plan["gamePort"])
    if plan["state"] != "prepared":
        raise ValueError("migration_already_started_query_original_state")
    for name, expected in plan["hashes"].items():
        if digest((out/name).read_bytes()) != expected:
            raise ValueError("migration_artifact_changed")
    root = Path(plan["server"]).resolve(); region = Path(plan["region"]).resolve(); player = Path(plan["player"]).resolve()
    if not region.is_relative_to(root) or not player.is_relative_to(root) or player.exists() or digest(region.read_bytes()) != plan["hashes"]["region.before"]:
        raise ValueError("migration_preimage_changed")
    if original_copies(root, region.parent, plan['uuid']) != [str(region)]:
        raise ValueError("migration_identity_changed")
    plan["state"] = "applying_do_not_start_server"
    save_plan(out,plan)
    # Keep both preimages until after real admission. On interruption, maintenance
    # must reconcile this original plan; never mint another character UUID.
    for target, name in ((player, "player.after"), (region, "region.after")):
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(target.name+".npc-migration.tmp")
        with temp.open("xb") as stream:
            stream.write((out/name).read_bytes()); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, target)
        if digest(target.read_bytes()) != plan["hashes"][name]:
            raise ValueError("migration_write_unverified_do_not_start")
    plan["state"] = "cold_applied_pending_original_identity_admission"
    save_plan(out,plan)
    return plan


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "apply"]); parser.add_argument("--out", type=Path, required=True)
    for field in ("server", "entities", "world", "uuid", "owner", "dimension"):
        parser.add_argument("--"+field)
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    result = apply(args.out) if args.action == "apply" else prepare(Path(args.server), args.entities, args.world, args.uuid, args.owner, args.dimension, args.out, args.port)
    print(json.dumps({key: result[key] for key in ("uuid", "state", "inventory")}, ensure_ascii=False))
