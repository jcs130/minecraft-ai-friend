"""Survey the tower and stage exact block edits and resident settings in a fresh directory."""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
PAPER = HERE.parent.parent
sys.path.insert(0, str(HERE.parent / "aincrad"))
from stage_native_households import overlay, point, yaml_of

terrain_spec = importlib.util.spec_from_file_location("terrain", PAPER / "ops/plan-travel-markers.py")
terrain = importlib.util.module_from_spec(terrain_spec)
terrain_spec.loader.exec_module(terrain)

AIR = {"minecraft:air", "minecraft:cave_air"}
SOLID_GROUND = terrain.NATURAL | {"minecraft:coarse_dirt", "minecraft:cobblestone", "minecraft:stone_bricks"}


def plan(reader, spec):
    world = spec["world"]
    changes = {}
    checks = {}

    def read(at):
        return reader.get(world, *at)

    def check(at, accepted, reason):
        block = read(at)
        if block not in accepted:
            raise ValueError(f"{reason} at {at}: {block}")
        checks[at] = block
        return block

    def put(at, block, accepted=AIR):
        x, y, z = at
        if not (-578 <= x <= -570 and 75 <= y <= 101 and -309 <= z <= -302):
            raise ValueError(f"Placement outside the protected footprint: {at}")
        if at in changes:
            raise ValueError(f"Two changes at {at}")
        before = check(at, accepted, "Unexpected preimage")
        changes[at] = {"at": at, "before": before, "after": f"minecraft:{block}"}

    def pier(x, z):
        for y in range(89, 74, -1):
            at = (x, y, z)
            support = read(at)
            if terrain.kind(support) in SOLID_GROUND:
                check(at, {support}, "Missing foundation")
                return
            put(at, "stone_bricks")
        raise ValueError(f"No safe foundation at {x}, {z}")

    for z in (-304, -303):
        for x in (-579, -578):
            check((x, 90, z), {"minecraft:stone_bricks"}, "Unexpected entrance floor")
        check((-578, 93, z), {"minecraft:stone_bricks"}, "Unexpected entrance lintel")
        check((-578, 94, z), {"minecraft:stone_bricks"}, "Unexpected entrance upper wall")
        for y in (91, 92):
            check((-579, y, z), AIR, "Blocked entrance approach")
            put((-578, y, z), "air", {"minecraft:stone_bricks"})

    north, south = -309, -302
    for z in range(north, south + 1):
        for x in (-577, -576):
            put((x, 90, z), "spruce_planks")
    rails = {(-577, z) for z in range(north, -304)} | {(-576, north), (-576, south), (-577, south)}
    for x, z in sorted(rails):
        faces = {"north": (x, z - 1) in rails, "south": (x, z + 1) in rails,
                 "west": x == -577, "east": (x + 1, z) in rails or (x == -576 and z == north)}
        state = ",".join(f"{face}={str(connected).lower()}" for face, connected in sorted(faces.items()))
        put((x, 91, z), f"spruce_fence[{state},waterlogged=false]")
    for z in range(north, south + 1):
        for x in (-577, -576):
            if (x, z) not in rails:
                for y in (91, 92):
                    check((x, y, z), AIR, "Blocked gallery")
    for x, z in ((-577, -306), (-577, -304)):
        pier(x, z)

    houses = {}
    for resident in spec["residents"]:
        z0 = resident["frontZ"]
        for x in range(-575, -569):
            for z in range(z0, z0 + 7):
                put((x, 90, z), "polished_andesite")
                edge_x = x in (-575, -570)
                edge_z = z in (z0, z0 + 6)
                if edge_x or edge_z:
                    for y in (91, 92, 93):
                        if (x, z) == (-575, z0 + 3) and y in (91, 92):
                            half = "lower" if y == 91 else "upper"
                            put((x, y, z), f"spruce_door[facing=west,half={half},hinge=left,open=false,powered=false]")
                        elif edge_x and edge_z:
                            put((x, y, z), "spruce_log[axis=y]")
                        elif y == 92 and ((edge_x and z in (z0 + 1, z0 + 5)) or
                                          (edge_z and x in (-573, -572))):
                            put((x, y, z), "glass")
                        else:
                            put((x, y, z), "spruce_planks")
                if x in (-575, -570):
                    outside = "west" if x == -575 else "east"
                    put((x, 94, z), f"spruce_stairs[facing={outside}]")
                    continue
                put((x, 94, z), "spruce_planks")
                if x in (-574, -571):
                    outside = "west" if x == -574 else "east"
                    put((x, 95, z), f"spruce_stairs[facing={outside}]")
                else:
                    put((x, 95, z), "spruce_planks")
                    put((x, 96, z), "spruce_slab[type=bottom]")
        for x, z in ((-574, z0 + 2), (-571, z0),
                     (-574, z0 + 6), (-571, z0 + 6)):
            pier(x, z)
        for x, part in ((-572, "foot"), (-571, "head")):
            put((x, 91, z0 + 1), f'{resident["bed"]}[facing=east,part={part},occupied=false]')
        put((-571, 91, z0 + 5), resident["workstation"])
        put((-573, 93, z0 + 2), "lantern[hanging=true]")
        for x in (-574, -573):
            for y in (91, 92):
                check((x, y, z0 + 3), AIR, "Blocked dwelling landing")
        houses[resident["id"]] = {
            "characterId": resident["entityUuid"],
            "address": resident["address"],
            "profession": resident["profession"],
            "home": {"world": world, **point((-573, 91, z0 + 3))},
            "bed": point((-571, 91, z0 + 1)),
            "door": point((-575, 91, z0 + 3)),
            "work": point((-571, 91, z0 + 5)),
        }

    return {
        "schema": 1,
        "world": world,
        "checks": [{"at": at, "state": block} for at, block in checks.items() if at not in changes],
        "changes": list(changes.values()),
        "households": houses,
    }


def write_stage(game, output):
    game, output = game.resolve(), output.resolve()
    if output.is_relative_to(game):
        raise ValueError("Stage outside the source server")
    spec = json.loads((HERE / "residents.json").read_text(encoding="utf-8"))
    edits = plan(terrain.Reader(game), spec)
    quests = yaml_of(game / "plugins/qiandeng-villager-quests/config.yml")
    agent = yaml_of(game / "plugins/AgentFriend/config.yml")
    guide = yaml_of(game / "plugins/AgentFriend/agent-guide.yml")
    guide_template = yaml_of(PAPER / "plugins/AgentFriend/resources/agent-guide.yml")
    rule = next(rule for rule in guide_template["rules"] if rule.startswith("试炼塔集合平台 world("))
    indexes = [index for index, known in enumerate(guide["rules"])
               if known.startswith(("试炼塔入口 world(", "试炼塔集合平台 world("))]
    if len(indexes) != 1:
        raise ValueError("Expected one existing Trial Tower entry in the agent guide")
    guide["rules"][indexes[0]] = rule
    profiles, speakers = [], []
    for resident in spec["residents"]:
        resident_id = resident["id"]
        entity = resident["entityUuid"]
        for known_id, record in quests["villagers"].items():
            if known_id != resident_id and record.get("entityUuid") == entity:
                raise ValueError(f"Existing resident conflicts with {resident_id}")
        overlay(quests["villagers"], resident_id, {
            "name": resident["name"], "entityUuid": entity, "types": [], "maxOpen": 0,
            "dailyQuota": 0, "areaRadius": 16, "persona": resident["persona"], "serviceCounter": resident_id,
        })
        overlay(quests.setdefault("households", {}), resident_id, edits["households"][resident_id])
        profiles.append({"residentId": resident_id, "bodyUuid": entity, "characterId": entity})
        speakers.append({"id": entity, "kind": "villager", "residentId": resident_id, "name": resident["name"],
                         "voice": resident["voice"], "range": 10, "aliases": [resident["alias"]]})
    for counter, entity in spec["existingMerchants"].items():
        overlay(agent.setdefault("trial-platform-residents", {}), counter, entity)

    output.mkdir(parents=True, exist_ok=False)
    (output / "blocks.json").write_text(json.dumps(edits, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for name, data in (("villager-quests.yml", quests), ("agent-friend.yml", agent), ("agent-guide.yml", guide)):
        (output / name).write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    registration = {"profiles": profiles, "roles": speakers}
    (output / "dialogue-registration.json").write_text(
        json.dumps(registration, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f'{len(edits["households"])} homes; {len(edits["changes"])} edits; {len(edits["checks"])} preserved cells')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    write_stage(args.game, args.output)
