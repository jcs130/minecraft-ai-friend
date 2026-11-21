"""Prepare merged Aincrad residence settings in a new directory; never install or start them."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from uuid import UUID

import yaml


class StrictYaml(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        self.flatten_mapping(node)
        pairs = self.construct_pairs(node, deep=deep)
        result = dict(pairs)
        if len(result) != len(pairs):
            raise ValueError("Duplicate YAML key in source")
        return result


def yaml_of(path):
    return yaml.load(path.read_text(encoding="utf-8-sig"), Loader=StrictYaml)


def json_of(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def overlay(base, key, entry):
    prior = base.get(key)
    if prior is not None and prior != entry:
        raise ValueError(f"Existing entry conflicts with {key}")
    base[key] = entry


def append_profile(entries, key, entry):
    matches = [current for current in entries if current[key] == entry[key]]
    if matches and matches != [entry]:
        raise ValueError(f"Existing profile conflicts with {entry[key]}")
    if not matches:
        entries.append(entry)


def intersect(a, b):
    return all(left <= right and other <= end for left, end, other, right in
               zip(a["min"], a["max"], b["min"], b["max"], strict=True))


def point(values):
    return dict(zip(("x", "y", "z"), values, strict=True))


def furnishing(row):
    bed = row["bed"]
    x, y, z = bed["head"]
    dx, dz = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}[bed["facing"]]

    def block(at, after):
        return {"at": at, "before": "minecraft:air", "after": f"minecraft:{after}"}

    sections = [(x - dx, y, z - dz, "foot"), (x, y, z, "head")]
    return [
        block([bx, by, bz], f'{bed["material"]}[facing={bed["facing"]},part={part},occupied=false]')
        for bx, by, bz, part in sections
    ] + [block(row["work"]["at"], row["work"]["material"])]


def stage(game, harness, voice_catalog, output):
    game, harness, output = (path.resolve() for path in (game, harness, output))
    if output.is_relative_to(game) or output.is_relative_to(harness.parent):
        raise ValueError("Use a separate candidate output directory")
    plan = json_of(Path(__file__).with_name("native-households.json"))
    if plan["schema"] != 1 or plan["world"] != "aincrad":
        raise ValueError("Unexpected Aincrad household plan")
    sources = {
        "villager-quests.yml": game / "plugins/qiandeng-villager-quests/config.yml",
        "lands.yml": game / "plugins/AgentFriend/lands.yml",
        "npc-voices.json": game / "plugins/QiandengVoice/npc-voices.json",
        "harness-config.json": harness,
    }
    inputs = {**sources, "voice-catalog.json": voice_catalog}
    before = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in inputs.items()}
    quests, lands, voices, worker = [
        (yaml_of if name.endswith(".yml") else json_of)(path) for name, path in sources.items()
    ]
    catalog = json_of(voice_catalog)
    voice_references = {row["id"]: row.get("reference_sha256") for row in catalog["catalog"]}
    if len(voice_references) != len(catalog["catalog"]):
        raise ValueError("Duplicate ID in voice catalog")
    new_characters = {row["characterId"] for row in plan["residents"]}
    used_voices = {row["voice"] for row in voices["roles"] if row["id"] not in new_characters}
    used_voices.add(catalog["default_voice"])
    used_references = {voice_references.get(voice) for voice in used_voices}
    permitted_gather = quests["policy"]["targets"]["gather"]
    if "minecraft:bread" not in permitted_gather:
        raise ValueError("Existing quest policy has no approved provision")
    seen = set()
    for resident in plan["residents"]:
        id, character = (resident[key] for key in ("id", "characterId"))
        if str(UUID(character)) != character or character in seen or id in seen:
            raise ValueError(f"Invalid identity for {id}")
        voice = resident["voice"]
        reference = voice_references.get(voice)
        if (not isinstance(reference, str) or not re.fullmatch(r"[a-f0-9]{64}", reference)
                or voice in used_voices or reference in used_references):
            raise ValueError(f"Voice for {id} must have a distinct registered reference")
        used_voices.add(voice)
        used_references.add(reference)
        seen.update((character, id))
        address = f'{plan["streetName"]} {resident["number"]} 号'
        for old_id, row in quests["villagers"].items():
            if old_id != id and row.get("entityUuid") == character:
                raise ValueError(f"Existing native body conflicts with {id}")
        overlay(quests["villagers"], id, {
            "name": resident["name"], "entityUuid": character, "types": ["gather"], "maxOpen": 1,
            "dailyQuota": 1, "areaRadius": 24, "persona": resident["persona"],
        })
        overlay(quests.setdefault("households", {}), id, {
            "characterId": character, "address": address, "profession": resident["profession"],
            "home": {"world": plan["world"], **point(resident["home"])},
            "bed": point(resident["bed"]["head"]), "door": point(resident["door"]),
            "work": point(resident["work"]["at"]),
        })
        land_id = "aincrad_home_" + id.replace("-", "_")
        land = {
            "title": f'{resident["name"]}的家', "world": plan["world"], "source": "bounds",
            "min": resident["bounds"][0], "max": resident["bounds"][1], "owner-uuid": character,
            "members": [], "visitor-use": True, "landmark-enabled": False, "public-containers": [],
            "home": {"address-id": land_id.replace("_", "-"), "character-id": character, "body-uuid": character,
                     "street-id": plan["streetId"], "street-name": plan["streetName"], "number": resident["number"],
                     "resident": resident["name"], "profession": resident["occupation"],
                     "entrance": resident["door"], "respawn": resident["home"]},
        }
        for existing_id, existing in lands["lands"].items():
            if existing_id == land_id or existing.get("enabled") is False or existing.get("world") != plan["world"]:
                continue
            existing_home = existing.get("home", {})
            if (intersect(existing, land) or existing_home.get("character-id") == character or
                    (existing_home.get("street-id"), existing_home.get("number")) ==
                    (plan["streetId"], resident["number"])):
                raise ValueError(f"Existing house or land conflicts with {id}")
        overlay(lands["lands"], land_id, land)
        append_profile(voices["roles"], "id", {
            "id": character, "kind": "villager", "residentId": id, "name": resident["name"],
            "voice": voice, "range": 10, "aliases": [resident["shortName"]],
        })
        append_profile(worker["profiles"], "residentId", {
            "residentId": id, "bodyUuid": character, "characterId": character,
        })
    if before != {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in inputs.items()}:
        raise RuntimeError("Input settings changed during staging")
    output.mkdir(parents=True, exist_ok=False)
    for name, content in zip(sources, (quests, lands, voices, worker), strict=True):
        formatted = (yaml.safe_dump(content, allow_unicode=True, sort_keys=False, width=120)
                     if name.endswith(".yml") else json.dumps(content, ensure_ascii=False, indent=2) + "\n")
        (output / name).write_text(formatted, encoding="utf-8")
    (output / "furnishing.json").write_text(json.dumps({
        "schema": 1, "world": plan["world"], "houses": [
            {"residentId": resident["id"], "blocks": furnishing(resident)} for resident in plan["residents"]
        ],
    }, indent=2) + "\n", encoding="utf-8")
    (output / "staging.json").write_text(json.dumps({
        "worldChanged": False,
        "residentCount": len(plan["residents"]),
        "sourceSha256": before,
        "candidateSha256": {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
                            for name in (*sources, "furnishing.json")},
    }, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", type=Path, required=True)
    parser.add_argument("--harness", type=Path, required=True)
    parser.add_argument("--voice-catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    stage(args.game, args.harness, args.voice_catalog, args.output)
