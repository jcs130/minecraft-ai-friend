import json
import time
import java
from graalweave import client, ticks

mc = java.type("net.minecraft.client.Minecraft").getInstance()
before = client.call(lambda: {"dead": mc.player.isDeadOrDying(), "bodyId": str(mc.player.getUUID())})
if not before["dead"]:
    raise RuntimeError("Body is alive; no respawn request was sent")
client.call(lambda: mc.player.respawn())
for _ in range(40):
    ticks.wait(5)
    after = client.call(lambda: {"dead": mc.player.isDeadOrDying(), "bodyId": str(mc.player.getUUID()), "health": mc.player.getHealth(),
                                "position": {"x": mc.player.getX(), "y": mc.player.getY(), "z": mc.player.getZ()}, "observedAt": time.time()})
    if not after["dead"]:
        break
print(json.dumps({"kind": "ordinary-respawn", "before": before, "after": after, "goalVerified": not after["dead"] and before["bodyId"] == after["bodyId"]}))
if after["dead"]:
    raise RuntimeError("Respawn not confirmed; do not replay automatically")
