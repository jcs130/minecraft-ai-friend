"""One bounded movement, no block breaking/placing or operator commands."""
import json
import math
import time
import java
from graalweave import client, ticks

Minecraft = java.type("net.minecraft.client.Minecraft")
BaritoneAPI = java.type("baritone.api.BaritoneAPI")
GoalXZ = java.type("baritone.api.pathing.goals.GoalXZ")
mc = Minecraft.getInstance()


def position():
    p = mc.player
    return {"x": p.getX(), "y": p.getY(), "z": p.getZ(), "health": p.getHealth(), "dimensionKey": str(p.level().dimension())}


before = client.call(position)
target = {"x": math.floor(before["x"]) + 7, "z": math.floor(before["z"])}


def start():
    settings = BaritoneAPI.getSettings()
    settings.allowBreak.value = False
    settings.allowPlace.value = False
    settings.allowParkour.value = False
    baritone = BaritoneAPI.getProvider().getPrimaryBaritone()
    baritone.getCustomGoalProcess().setGoalAndPath(GoalXZ(target["x"], target["z"]))


client.call(start)
reached = False
try:
    for _ in range(80):
        ticks.wait(5)
        after = client.call(position)
        if after["dimensionKey"] != before["dimensionKey"]:
            raise RuntimeError("Unexpected dimension change")
        if math.hypot(after["x"] - (target["x"] + 0.5), after["z"] - (target["z"] + 0.5)) < 1.5:
            reached = True
            break
finally:
    client.call(lambda: BaritoneAPI.getProvider().getPrimaryBaritone().getPathingBehavior().cancelEverything())
print(json.dumps({"kind": "walk", "coordinateSystem": "absolute-world-blocks", "anchor": before,
                  "target": target, "after": client.call(position), "goalVerified": reached, "observedAt": time.time()}))
if not reached:
    raise RuntimeError("Goal not reached within 400 game ticks; cancelled without editing blocks")
