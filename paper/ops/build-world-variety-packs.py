"""Build pinned, vanilla-only 1.21.1 data packs without installing mod classes.

The input manifest is local operational data, not a download registry. Every
source must have a verified SHA-256. Unknown codecs fail closed. Conversion of
mod jigsaw terrain filters is explicit: vanilla retains the original building,
loot, entities and height provider, but does not implement a mod's slope tests.
Nether floor-search codecs are deliberately unsupported.
"""
from __future__ import annotations

import argparse
import hashlib
import gzip
import importlib.util
import json
import re
import struct
import zipfile
from pathlib import Path, PurePosixPath

spec = importlib.util.spec_from_file_location(
    "migration", Path(__file__).with_name("migrate-datapacks-1.21.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def loads(raw):
    """Accept Gson's comments/trailing commas, never alter quoted strings."""
    text = raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw
    clean, i, quoted, escaped = [], 0, False, False
    while i < len(text):
        c = text[i]
        if quoted:
            clean.append(c)
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                quoted = False
            i += 1
            continue
        if c == '"':
            quoted = True
        elif text[i:i+2] == "//":
            i = text.find("\n", i)
            if i < 0:
                break
            continue
        elif text[i:i+2] == "/*":
            end = text.find("*/", i+2)
            if end < 0:
                raise ValueError("Unterminated JSON comment")
            clean.append(" ")
            i = end+2
            continue
        elif c == ",":
            j = i+1
            while j < len(text) and text[j].isspace():
                j += 1
            if j < len(text) and text[j] in "]}":
                i += 1
                continue
        clean.append(c)
        i += 1
    return json.loads("".join(clean))


def dump(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"))+"\n").encode()


def versioned_location(locations):
    def triple(v):
        parts = tuple(map(int, v.split(".")))
        return parts+(0,)*(3-len(parts))
    target = (1, 21, 1)
    matches = []
    for interval, location in locations.items():
        parts = interval.split("-")
        if all(re.fullmatch(r"\d+\.\d+(?:\.\d+)?", p) for p in parts):
            if triple(parts[0]) <= target <= triple(parts[-1]):
                matches.append(location)
    if len(set(matches)) != 1:
        raise ValueError("No unambiguous exact 1.21.1 template: "+str(locations))
    return matches[0]


def rewrite_nbt_namespace(raw, old, new, strip_template_entities=False):
    """Rewrite string payloads, preserving numeric tags and list/compound shape."""
    compressed = raw[:2] == b"\x1f\x8b"
    data = memoryview(gzip.decompress(raw) if compressed else raw)
    pos, output, depth = 0, bytearray(), 0
    def take(length):
        nonlocal pos
        if length < 0 or pos+length > len(data):
            raise ValueError("Invalid structure NBT length")
        value = data[pos:pos+length].tobytes()
        pos += length
        return value
    def string():
        length = struct.unpack(">H", take(2))[0]
        value = take(length).replace(old.encode(), new.encode())
        output.extend(struct.pack(">H", len(value)))
        output.extend(value)
        return value
    def payload(tag):
        nonlocal depth
        sizes = {1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8}
        if tag in sizes:
            output.extend(take(sizes[tag]))
        elif tag == 8:
            string()
        elif tag in (7, 11, 12):
            raw_length = take(4)
            output.extend(raw_length)
            count = struct.unpack(">i", raw_length)[0]
            output.extend(take(count*{7: 1, 11: 4, 12: 8}[tag]))
        elif tag == 9:
            subtype = take(1)
            raw_length = take(4)
            output.extend(subtype+raw_length)
            count = struct.unpack(">i", raw_length)[0]
            if count < 0 or count > 10_000_000:
                raise ValueError("Invalid NBT list length")
            for _ in range(count):
                payload(subtype[0])
        elif tag == 10:
            depth += 1
            while True:
                child = take(1)
                output.extend(child)
                if child == b"\0":
                    break
                name = string()
                start = len(output)
                payload(child[0])
                if strip_template_entities and depth == 1 and name == b"entities" and child[0] == 9:
                    del output[start:]
                    output.extend(b"\x0a\x00\x00\x00\x00")
            depth -= 1
        else:
            raise ValueError("Unknown NBT tag: "+str(tag))
    tag = take(1)
    output.extend(tag)
    string()
    payload(tag[0])
    if pos != len(data):
        raise ValueError("Trailing structure NBT")
    return gzip.compress(bytes(output), mtime=0) if compressed else bytes(output)


def current_schema(value):
    if isinstance(value, list):
        return [current_schema(v) for v in value]
    if not isinstance(value, dict):
        return value
    out = {k: current_schema(v) for k, v in value.items()}
    if out.get("type") == "minecraft:loot_table" and "name" in out:
        out["value"] = out.pop("name")
    if out.get("type") == "minecraft:tag":
        out.setdefault("expand", False)
    if out.get("function") == "#minecraft:enchant_with_levels":
        out["function"] = "minecraft:enchant_with_levels"
    if "icon" in out and isinstance(out["icon"], dict) and "item" in out["icon"]:
        out["icon"]["id"] = out["icon"].pop("item")
    return migration.loot_schema(out)


def read_pack(source, palette_suffixes=()):
    with zipfile.ZipFile(source) as z:
        names = z.namelist()
        meta = next((n for n in names if n.endswith("pack.mcmeta")), None)
        prefix = meta.removesuffix("pack.mcmeta") if meta else ""
        entries = {}
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name:
                raise ValueError("Unsafe archive entry: "+name)
            if name.endswith("/"):
                continue
            if any(part.startswith(".") for part in path.parts):
                continue
            key = name.removeprefix(prefix)
            if palette_suffixes and "/worldgen/processor_list/" in migration.renamed(key):
                if not any(key.removesuffix(".json").endswith(s) for s in palette_suffixes):
                    continue
            if key.startswith(("data/", "overlays/")) or key == "pack.mcmeta":
                entries[key] = z.read(name)
    meta = loads(entries.get("pack.mcmeta", b'{"pack":{"pack_format":48}}'))
    active = {k: v for k, v in entries.items() if k.startswith("data/")}
    for overlay in meta.get("overlays", {}).get("entries", []):
        if migration.includes(overlay["formats"], 48):
            prefix = overlay["directory"].rstrip("/")+"/"
            active.update({k[len(prefix):]: v for k, v in entries.items()
                           if k.startswith(prefix+"data/")})
    out, aliases = {}, []
    for key, value in sorted(active.items(),
                             key=lambda item: migration.renamed(item[0]) == item[0]):
        if len(key.split("/")) < 4:
            continue
        new = migration.renamed(key)
        if new in out:
            aliases.append({"source": key, "target": new, "equal": out[new] == value})
        if new.endswith(".json"):
            try:
                data = loads(value)
            except ValueError:
                # Empty optional-mod resources in authors' JARs aren't packs.
                if not value.strip():
                    continue
                raise
            if meta["pack"]["pack_format"] < 48 and new.split("/")[2] in (
                    "loot_table", "predicate", "item_modifier", "advancement"):
                data = migration.loot_schema(data)
            value = dump(data)
        out[new] = value
    return out, aliases


def block_swap_rules(swaps, states):
    """Preserve valid stair/log/etc. properties in native rule processors."""
    rules = []
    for source, target in sorted(swaps.items()):
        if source not in states or target not in states:
            raise ValueError("Non-vanilla block swap: "+source+" -> "+target)
        valid = {key: {str(v[key]).lower() for v in states[target] if key in v}
                 for key in states[target][0]}
        for state in states[source]:
            props = {key: str(value).lower() for key, value in state.items()}
            retained = {key: value for key, value in props.items()
                        if value in valid.get(key, set())}
            output = {"Name": target}
            if retained:
                output["Properties"] = retained
            rules.append({"input_predicate": {"predicate_type": "minecraft:blockstate_match",
                          "block_state": {"Name": source, "Properties": props}},
                          "location_predicate": {"predicate_type": "minecraft:always_true"},
                          "output_state": output})
    return {"processor_type": "minecraft:rule", "rules": rules}


def rewrite_codec(value, profile, states, changes, path):
    if isinstance(value, list):
        return [rewrite_codec(v, profile, states, changes, path) for v in value]
    if not isinstance(value, dict):
        return value
    out = {k: rewrite_codec(v, profile, states, changes, path) for k, v in value.items()}
    for key in ("type", "processor_type", "element_type"):
        kind = out.get(key)
        if not isinstance(kind, str) or ":" not in kind or kind.startswith("minecraft:"):
            continue
        before = dict(out)
        if profile in ("ctov", "jigsaw") and key == "type" and (
                kind.endswith(":jigsaw") or kind.endswith("generic_jigsaw_structure")
                or kind.endswith(":end_jigsaw_structure")
                or kind.endswith(":overworld_jigsaw_structure")):
            if "nether" in kind:
                raise ValueError("Nether floor search cannot be represented as vanilla jigsaw: "+path)
            out["type"] = "minecraft:jigsaw"
            out.setdefault("max_distance_from_center", 80)
            out.setdefault("use_expansion_hack", False)
            if kind.endswith((":end_jigsaw_structure", ":overworld_jigsaw_structure")):
                out.setdefault("project_start_to_heightmap", "WORLD_SURFACE_WG")
            if kind.endswith(":end_jigsaw_structure"):
                # Vanilla heightmaps cannot run the mod's min-height search.
                # Restrict these surface buildings to actual outer island biomes.
                out["biomes"] = ["minecraft:end_highlands", "minecraft:end_midlands"]
            for field in ("cannot_spawn_in_liquid", "terrain_height_radius_check",
                          "allowed_terrain_height_range", "y_allowance",
                          "min_absolute_height", "max_absolute_height", "land_search_direction"):
                out.pop(field, None)
        elif profile in ("ctov", "jigsaw") and key == "type" and kind.endswith(":advanced_random_spread"):
            out["type"] = "minecraft:random_spread"
            for field in ("min_y", "max_y", "min_height", "max_height", "heightmap"):
                out.pop(field, None)
        elif profile == "jigsaw" and kind == "moogs_structures:versioned_single_pool_element":
            out["element_type"] = "minecraft:single_pool_element"
            locations = out.pop("locations", {})
            if locations:
                out["location"] = versioned_location(locations)
        elif profile == "ctov" and kind == "lithostitched:block_swap":
            out = block_swap_rules(out["blocks"], states)
        else:
            raise ValueError("Unsupported codec "+kind+" in "+path)
        changes.append({"path": path, "codec": kind, "native": out.get(key),
                        "removedFields": sorted(set(before)-set(out))})
    return out


def build_pack(row, states):
    source = Path(row["local"])
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != row["sha256"]:
        raise ValueError("Source hash mismatch: "+row["slug"])
    entries, aliases = read_pack(source, row.get("processorPaletteSuffixes", ()))
    changes, removed, village_entries = [], [], []
    profile = row.get("profile", "native")
    excluded = set(row.get("excludeStructures", []))
    cloned = {}
    for old, new in row.get("renameNamespaces", {}).items():
        updated = {}
        for key, raw in entries.items():
            target = key.replace("data/"+old+"/", "data/"+new+"/", 1)
            if key.endswith(".nbt"):
                raw = rewrite_nbt_namespace(raw, old, new)
            else:
                raw = raw.replace(old.encode(), new.encode())
            updated[target] = raw
        entries = updated
        changes.append({"namespace": old, "renamedAs": new, "includesStructureNbtStrings": True})
    for prefix in row.get("excludeDataPrefixes", []):
        for key in list(entries):
            if key.startswith(prefix):
                removed.append(key)
                entries.pop(key)
    for key, value in row.get("jsonReplacements", {}).items():
        if key not in entries:
            raise ValueError("Replacement preimage missing: "+key)
        entries[key] = dump(value)
        changes.append({"path": key, "declaredVanillaReplacement": True})
    for key, text in row.get("functionReplacements", {}).items():
        if key not in entries:
            raise ValueError("Function preimage missing: "+key)
        entries[key] = text.encode("utf-8")
        changes.append({"path": key, "declaredBoundedFunctionReplacement": True})
    if row.get("removeUnreferencedProcessors"):
        for key in list(entries):
            if "/lithostitched/" in key:
                # Mod-loaded compatibility modifiers are inactive on Paper;
                # their optional Croptopia assets must not become registries.
                removed.append(key)
                entries.pop(key)
        referenced = set()
        def references(value):
            if isinstance(value, str):
                referenced.add(value)
            elif isinstance(value, list):
                for v in value:
                    references(v)
            elif isinstance(value, dict):
                for v in value.values():
                    references(v)
        for key, raw in entries.items():
            if key.endswith(".json") and "/worldgen/processor_list/" not in key:
                references(loads(raw))
        for key in list(entries):
            m = re.match(r"data/([^/]+)/worldgen/processor_list/(.+)\.json$", key)
            if m and m[1]+":"+m[2] not in referenced:
                removed.append(key)
                entries.pop(key)
    if row.get("cloneVanillaStructures"):
        for key in list(entries):
            if key.startswith("data/minecraft/worldgen/structure/"):
                sid = "minecraft:"+key.removeprefix("data/minecraft/worldgen/structure/").removesuffix(".json")
                target = "qiandeng_capitals:"+sid.split(":")[1]
                cloned[sid] = target
                entries["data/qiandeng_capitals/worldgen/structure/"+target.split(":")[1]+".json"] = entries.pop(key)
                changes.append({"path": key, "clonedAs": target})
    for key in list(entries):
        m = re.match(r"data/([^/]+)/worldgen/structure/(.+)\.json$", key)
        if m and m[1]+":"+m[2] in excluded:
            removed.append(key)
            entries.pop(key)
            continue
        if not key.endswith(".json"):
            continue
        value = loads(entries[key])
        if key.startswith("data/minecraft/tags/") and value.get("replace"):
            value["replace"] = False
            changes.append({"path": key, "additiveVanillaTag": True})
        if key.split("/")[2] in ("loot_table", "predicate", "item_modifier", "advancement"):
            value = current_schema(value)
        if row.get("processorPaletteSuffixes") and "/worldgen/template_pool/" in key:
            value["elements"] = [e for e in value["elements"] if any(
                str(e["element"].get("processors", "")).endswith(s)
                for s in row["processorPaletteSuffixes"])]
            if not value["elements"]:
                raise ValueError("Empty curated castle palette: "+key)
        if re.match(r"data/[^/]+/worldgen/", key):
            value = rewrite_codec(value, profile, states, changes, key)
        if m and value.get("type") == "minecraft:jigsaw":
            limit = 128 if value.get("terrain_adaptation", "none") == "none" else 116
            if value.get("max_distance_from_center", 80) > limit:
                if value["max_distance_from_center"] <= 128:
                    changes.append({"path": key, "preservedMaxDistance": value["max_distance_from_center"],
                                    "oldTerrainAdaptation": value["terrain_adaptation"], "nativeTerrainAdaptation": "none"})
                    value["terrain_adaptation"] = "none"
                else:
                    raise ValueError("Structure exceeds native 128-block extent: "+key)
        if re.match(r"data/[^/]+/worldgen/structure_set/", key):
            value["structures"] = [s for s in value["structures"] if s["structure"] not in excluded]
            for element in value["structures"]:
                element["structure"] = cloned.get(element["structure"], element["structure"])
            if not value["structures"]:
                removed.append(key)
                entries.pop(key)
                continue
            if key == "data/minecraft/worldgen/structure_set/villages.json":
                village_entries.extend(value["structures"])
                entries.pop(key)
                removed.append(key)
                continue
        # Remove references to explicitly excluded structures, including tags.
        if "/tags/worldgen/structure/" in key:
            value["values"] = [v for v in value["values"]
                               if (v.get("id") if isinstance(v, dict) else v) not in excluded]
        entries[key] = dump(value)
    # No Java bytecode, mixins or client assets are copied into server packs.
    entries["pack.mcmeta"] = dump({"pack": {"pack_format": 48,
        "description": row.get("title", row["slug"])+" / Qiandengji pinned vanilla data",
        "supported_formats": [48, 48]}})
    structures = sorted(k.removeprefix("data/").replace("/worldgen/structure/", ":").removesuffix(".json")
                        for k in entries if re.match(r"data/[^/]+/worldgen/structure/.*\.json$", k))
    manual = set(row.get("manualOnlyStructures", []))
    if not manual.issubset(structures):
        raise ValueError("Unknown declared manual-only structure: "+row["slug"])
    if profile == "ctov":
        # This historical mod injects its placements in Java/Lithostitched.
        # Copying only its data makes every village unreachable naturally.
        # Use the existing shared vanilla village grid; retain the author's
        # disabled underground variants as explicitly manual-only content.
        village_entries.extend({"structure": sid, "weight": 1} for sid in structures
                               if sid.startswith("ctov:") and "/village_" in sid and sid not in manual)
        outposts = [sid for sid in structures if sid.startswith("ctov:pillager_outpost_")]
        entries["data/ctov/worldgen/structure_set/qiandengji_outposts.json"] = dump({
            "structures": [{"structure": sid, "weight": 1} for sid in outposts],
            "placement": {"type": "minecraft:random_spread", "spacing": 64,
                          "separation": 20, "salt": 746395128}})
        changes.append({"nativePlacementRestored": "ctov shared villages and outposts"})
    for original, clone in cloned.items():
        if original in ("minecraft:pillager_outpost", "minecraft:swamp_hut"):
            # Moving a vanilla definition to a private namespace also requires
            # a placement; otherwise these two capital-pack buildings vanish.
            entries["data/qiandeng_capitals/worldgen/structure_set/"+clone.split(":")[1]+".json"] = dump({
                "structures": [{"structure": clone, "weight": 1}],
                "placement": {"type": "minecraft:random_spread", "spacing": 64,
                              "separation": 20, "salt": 982173641 if original.endswith("outpost") else 982173642}})
    # Standalone author packs can contain achievements from a larger mod.
    # Keep achievements only when their exact referenced structure is present;
    # never silently redirect an achievement to an unrelated building.
    if row.get("pruneUnavailableAdvancements"):
        def missing_structure(value):
            if isinstance(value, dict):
                for field in ("structure", "structures"):
                    refs = value.get(field, [])
                    if isinstance(refs, str):
                        refs = [refs]
                    if isinstance(refs, list):
                        for sid in refs:
                            if isinstance(sid, str) and not sid.startswith(("#", "minecraft:", "terralith:")) and sid not in structures:
                                return True
                return any(missing_structure(v) for v in value.values())
            return isinstance(value, list) and any(missing_structure(v) for v in value)
        for key in list(entries):
            if "/advancement/" in key and key.endswith(".json") and missing_structure(loads(entries[key])):
                removed.append(key)
                entries.pop(key)
        discarded = {k.removeprefix("data/").replace("/advancement/", ":").removesuffix(".json")
                     for k in removed if "/advancement/" in k}
        while True:
            descendants = [k for k, raw in entries.items() if "/advancement/" in k
                           and k.endswith(".json") and loads(raw).get("parent") in discarded]
            if not descendants:
                break
            for key in descendants:
                removed.append(key)
                entries.pop(key)
                discarded.add(key.removeprefix("data/").replace("/advancement/", ":").removesuffix(".json"))
    if not structures:
        raise ValueError("No playable structure definitions: "+row["slug"])
    return entries, {"slug": row["slug"], "version": row["version"],
        "source": row["source"], "sourceSha256": digest, "profile": profile,
        "aliases": aliases, "changes": changes, "removed": removed,
        "curatedProcessorPalettes": row.get("processorPaletteSuffixes", []),
        "structures": structures, "villageEntries": village_entries}


def write_zip(path, entries):
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name, raw in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, raw)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--block-states", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    states = json.loads(args.block_states.read_text(encoding="utf-8"))
    args.output.mkdir(exist_ok=False, parents=True)
    packs, villages, all_entries, reports, merged_tags = [], {}, {}, [], {}
    for row in manifest["packs"]:
        print("Building "+row["slug"], flush=True)
        entries, report = build_pack(row, states)
        for entry in report["villageEntries"]:
            villages[entry["structure"]] = entry
        for name, raw in entries.items():
            if name == "pack.mcmeta":
                continue
            if name in all_entries and all_entries[name] != raw:
                if "/tags/" not in name:
                    raise ValueError("Conflicting resource across new packs: "+name)
                previous, current = loads(all_entries[name]), loads(raw)
                values = {json.dumps(v, sort_keys=True): v
                          for v in previous["values"]+current["values"]}
                raw = dump({"replace": False, "values": list(values.values())})
                merged_tags[name] = raw
            all_entries[name] = raw
        packs.append((row, entries, report))
    advancement_ids = {k.removeprefix("data/").replace("/advancement/", ":").removesuffix(".json")
                       for k in all_entries if "/advancement/" in k and k.endswith(".json")}
    for row, entries, report in packs:
        for key in list(entries):
            if "/advancement/" not in key or not key.endswith(".json"):
                continue
            value = loads(entries[key])
            parent = value.get("parent")
            if parent and not parent.startswith("minecraft:") and parent not in advancement_ids:
                value["parent"] = "minecraft:adventure/root"
                entries[key] = dump(value)
                report["changes"].append({"path": key, "unavailableParent": parent,
                                          "nativeParent": "minecraft:adventure/root"})
    # Keep existing vanilla/Better Villages IDs; don't let the last village
    # archive silently replace all previous styles. One shared placement grid.
    for biome in ("plains", "desert", "savanna", "snowy", "taiga"):
        sid = "minecraft:village_"+biome
        villages[sid] = {"structure": sid, "weight": 4}
    placement = {"type": "minecraft:random_spread", "spacing": 42,
                 "separation": 12, "salt": 10387312, "frequency": 0.75}
    overlay = {"pack.mcmeta": dump({"pack": {"pack_format": 48,
        "description": "Qiandengji shared village placements and density budget"}}),
        "data/minecraft/worldgen/structure_set/villages.json": dump({
            "structures": sorted(villages.values(), key=lambda v: v["structure"]),
            "placement": placement})}
    overlay.update(merged_tags)
    # Budget is an upper bound before biome/terrain rejection. Existing packs
    # are untouched. This prevents dozens of new sets saturating the landscape.
    expected = 0.0
    placements = []
    for row, entries, report in packs:
        for name, raw in entries.items():
            if not re.match(r"data/[^/]+/worldgen/structure_set/", name):
                continue
            value = loads(raw)
            p = value["placement"]
            if p.get("type") != "minecraft:random_spread":
                continue
            p["spacing"] = max(48, p["spacing"])
            p["separation"] = min(p["separation"], p["spacing"]-1)
            rate = 1_000_000 / (p["spacing"]*16)**2 * p.get("frequency", 1.0)
            expected += rate
            placements.append((name, value, rate))
    reachable = {entry["structure"] for _, entries, _ in packs
                 for name, raw in entries.items()
                 if re.match(r"data/[^/]+/worldgen/structure_set/.*\.json$", name)
                 for entry in loads(raw)["structures"]}
    reachable.update(villages)
    for row, _, report in packs:
        missing = set(report["structures"])-reachable
        declared = set(row.get("manualOnlyStructures", []))
        if missing != declared:
            raise ValueError("Unreachable natural placements in "+row["slug"]+": "+str(sorted(missing-declared)))
        report["manualOnlyStructures"] = sorted(declared)
    factor = min(1.0, manifest.get("newStartsPerSquareKilometre", 6.0)/max(expected, .001))
    for name, value, rate in placements:
        value["placement"]["frequency"] = round(value["placement"].get("frequency", 1.0)*factor, 6)
        overlay[name] = dump(value)
    for row, entries, report in packs:
        name = "world-expansion--"+row["slug"]+".zip"
        report["file"] = name
        report["outputSha256"] = write_zip(args.output/name, entries)
        reports.append(report)
    overlay_name = "zz-qiandengji-world-variety.zip"
    overlay_hash = write_zip(args.output/overlay_name, overlay)
    report = {"schemaVersion": 1, "minecraft": "1.21.1", "packFormat": 48,
        "packs": reports, "overlay": {"file": overlay_name, "sha256": overlay_hash,
            "sharedVillageTypes": sorted(villages), "newSetDensityUpperBound": expected*factor,
            "densityFrequencyMultiplier": factor}, "productionChanged": False}
    (args.output/"manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"packs": len(reports), "structures": sum(len(r["structures"]) for r in reports),
                      "overlay": overlay_name, "expectedNewStartsUpperBound": expected*factor}))


if __name__ == "__main__":
    main()
