"""Read-only geometry and sign move plan for the Trial Tower's north entrance."""

import argparse
import json
from pathlib import Path

from stage_homes import terrain

WORLD = "world"
BRICKS = "minecraft:stone_bricks"
AIR = "minecraft:air"
GATE = "minecraft:oak_fence_gate[facing=south,in_wall=false,open=false,powered=false]"


def verify(reader, at, expected):
    actual = reader.get(WORLD, *at)
    if actual != expected:
        raise ValueError(f"Unexpected entrance block {at}: expected {expected}, got {actual}")
    return {"at": at, "state": expected}


def plan(reader):
    changes, checks = [], []
    for x in (-591, -590, -589):
        checks.extend(verify(reader, (x, y, -317), BRICKS) for y in (90, 94))
        for y in (91, 92, 93):
            if x != -590 or y == 91:
                cell = verify(reader, (x, y, -317), GATE if x == -590 else BRICKS)
                changes.append({"at": cell["at"], "before": cell["state"], "after": AIR})
            else:
                checks.append(verify(reader, (x, y, -317), AIR))

    landing = (-590, 91, -314)
    checks.append(verify(reader, (landing[0], 90, landing[2]), BRICKS))
    checks.extend(verify(reader, (landing[0], y, landing[2]), AIR) for y in (91, 92))
    signs = []
    for x, target_x, z, direction, line in (
        (-591, -592, -318, "north", "入门左转（东）"),
        (-589, -588, -316, "south", "沿平台向东"),
    ):
        state = f"minecraft:oak_wall_sign[facing={direction},waterlogged=false]"
        source, destination = (x, 92, z), (target_x, 92, z)
        verify(reader, source, state)
        checks.append(verify(reader, (target_x, 92, -317), BRICKS))
        verify(reader, destination, AIR)
        signs.append({"source": source, "destination": destination, "state": state, "waxed": True,
                      "front": ["试炼塔共享补给", line, "武器护甲箭粮", "使用键查库存"]})
    return {"schema": 1, "world": WORLD, "changes": changes, "checks": checks, "signMoves": signs,
            "landing": {"x": -589.5, "y": 91, "z": -313.5, "yaw": 90, "pitch": 0}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    game, output = args.game.resolve(), args.output.resolve()
    if output.is_relative_to(game):
        raise ValueError("Stage outside the source server")
    with output.open("x", encoding="utf-8") as stream:
        json.dump(plan(terrain.Reader(game)), stream, ensure_ascii=False, indent=2)
