"""Build the vanilla-only state translation required by the modded Web stream.

Reads current local registry and minecraft-data definitions. Never connects to MC
or modifies a renderer bundle, world, or service configuration.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import os
from pathlib import Path
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.21.1"
CANONICAL_BLOCKS = ROOT / "world/node_modules/minecraft-data/minecraft-data/data/pc/1.21.1/blocks.json"
OUTPUT = ROOT / "vendor/modern-viewer/mod-assets/vanilla-state-map.json"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def normalized_properties(properties):
    if not isinstance(properties, dict):
        raise ValueError("State properties must be an object")
    return tuple(sorted((str(k), str(v).lower()) for k, v in properties.items()))


def canonical_states(block):
    """Match prismarine-block's reversed-radix decode, including true-first bool."""
    definitions = block.get("states", [])
    names = [d["name"] for d in definitions]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate canonical property")
    values = []
    for definition in definitions:
        count = definition["num_values"]
        candidates = definition.get("values")
        if definition["type"] == "bool":
            candidates = ["true", "false"]
        if candidates is None and definition["type"] == "int":
            candidates = [str(i) for i in range(count)]
        if not isinstance(candidates, list) or len(candidates) != count:
            raise ValueError("Unsupported canonical property cardinality")
        values.append(candidates)
    combinations = list(itertools.product(*values))
    if len(combinations) != block["maxStateId"] - block["minStateId"] + 1:
        raise ValueError("Canonical range does not match its properties")
    return [(block["minStateId"] + offset, normalized_properties(dict(zip(names, combo))))
            for offset, combo in enumerate(combinations)]


def build_map(dump, vanilla, registry_sha, canonical_sha):
    if dump.get("minecraftVersion") != VERSION:
        raise ValueError("Wrong runtime registry version")
    canonical = {}
    targets = set()
    for block in vanilla:
        name = "minecraft:" + block["name"]
        rows = canonical_states(block)
        states = dict((props, sid) for sid, props in rows)
        if len(states) != len(rows) or name in canonical:
            raise ValueError("Ambiguous canonical states")
        if targets.intersection(sid for sid, _ in rows):
            raise ValueError("Overlapping canonical ranges")
        targets.update(sid for sid, _ in rows)
        canonical[name] = (block, states)
    mappings, fallbacks, seen, changed_names = [], [], set(), set()
    exact = 0
    for row in sorted(dump["blockStates"], key=lambda value: value["stateId"]):
        sid, name = row["stateId"], row["block"]
        if not isinstance(sid, int) or isinstance(sid, bool) or sid < 0 or sid in seen:
            raise ValueError("Invalid or duplicate runtime state ID")
        seen.add(sid)
        if not name.startswith("minecraft:"):
            continue
        if name not in canonical:
            raise ValueError("Unknown runtime vanilla block: " + name)
        block, states = canonical[name]
        props = normalized_properties(row.get("properties") or {})
        target = states.get(props)
        if target is None:
            target = block["defaultState"]
            fallbacks.append({"serverStateId": sid, "block": name, "canonicalStateId": target,
                              "reason": "Properties unavailable in vanilla renderer; use same block default",
                              "properties": dict(props)})
        else:
            exact += 1
        if target not in targets:
            raise ValueError("Translation target outside vanilla registry")
        mappings.append([sid, target])
        if sid != target:
            changed_names.add(name)
    mod_ranges = []
    for block in dump["blocks"]:
        if block["name"].startswith("minecraft:"):
            continue
        if block["minStateId"] <= max(targets):
            raise ValueError("Mod state range overlaps canonical vanilla IDs")
        mod_ranges.append({k: block[k] for k in ("name", "minStateId", "maxStateId", "defaultState")})
    mod_ranges.sort(key=lambda row: row["minStateId"])
    for before, after in zip(mod_ranges, mod_ranges[1:]):
        if before["maxStateId"] >= after["minStateId"]:
            raise ValueError("Mod state ranges overlap")
    return {"schema": 1, "minecraft": VERSION, "generatedAt": int(time.time() * 1000),
            "registryGeneratedAt": dump.get("generatedAt"), "registrySha256": registry_sha,
            "canonicalBlocksSha256": canonical_sha,
            "mappings": mappings, "serverModRanges": mod_ranges, "fallbacks": fallbacks,
            "stats": {"vanillaStates": len(mappings), "exactPropertyMatches": exact,
                      "fallbackStates": len(fallbacks), "changedStateIds": sum(a != b for a, b in mappings),
                      "changedVanillaBlocks": len(changed_names), "canonicalMaximumStateId": max(targets),
                      "modBlocksPreserveRuntimeIds": len(mod_ranges)},
            "limits": ["Apply translation once to raw server states, never again to canonical states",
                       "Modern clients keep mod runtime IDs and require the matching current mod pack",
                       "Compatibility clients must separately simplify mod blocks by the listed names",
                       "Extra mod-provided note-block instruments use the vanilla note-block default"]}


def build():
    registry = (ROOT / "server/mc/block-registry.json").read_bytes()
    canonical = CANONICAL_BLOCKS.read_bytes()
    result = build_map(json.loads(registry), json.loads(canonical), sha(registry), sha(canonical))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf8", dir=OUTPUT.parent,
                                         prefix=".vanilla-state-map-", suffix=".json", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        os.replace(temporary, OUTPUT)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return result


if __name__ == "__main__":
    result = build()
    print(json.dumps({"ok": True, "output": str(OUTPUT.relative_to(ROOT)),
                      "registrySha256": result["registrySha256"], **result["stats"]}, ensure_ascii=False))
