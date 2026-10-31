"""Accept an actual contract and collect natural wood with normal mining."""
import json
import time
import java
from graalweave import client, ticks

Minecraft = java.type("net.minecraft.client.Minecraft")
BaritoneAPI = java.type("baritone.api.BaritoneAPI")
ClientQuestData = java.type("com.erikedits.justquests.network.ClientQuestData")
Identifier = java.type("net.minecraft.resources.Identifier")
Registries = java.type("net.minecraft.core.registries.BuiltInRegistries")
mc = Minecraft.getInstance()
quest_id = Identifier.parse("maw:gather_logs")


def facts():
    p = mc.player
    inventory = p.getInventory()
    stacks = []
    for i in range(inventory.getContainerSize()):
        stack = inventory.getItem(i)
        if not stack.isEmpty():
            stacks.append({"slot": i, "id": str(Registries.ITEM.getKey(stack.getItem())), "count": stack.getCount()})
    data = ClientQuestData.getData()
    return {"bodyId": str(p.getUUID()), "observedAt": time.time(), "inventory": stacks,
            "active": data.isActive(quest_id), "completed": data.isCompleted(quest_id), "claimable": data.isClaimable(quest_id),
            "position": {"x": p.getX(), "y": p.getY(), "z": p.getZ()}}


before = client.call(facts)
client.call(lambda: mc.player.connection.sendCommand("quest accept maw:gather_logs"))
ticks.wait(20)
accepted = client.call(facts)
if not accepted["active"]:
    raise RuntimeError("Server did not accept the contract; no mining started")


def start():
    settings = BaritoneAPI.getSettings()
    settings.allowBreak.value = True
    settings.allowPlace.value = False
    BaritoneAPI.getProvider().getPrimaryBaritone().getMineProcess().mineByName(4, "minecraft:acacia_log")


client.call(start)
finished = False
try:
    for _ in range(360):
        ticks.wait(5)
        current = client.call(facts)
        if current["claimable"] or current["completed"]:
            finished = True
            break
finally:
    client.call(lambda: BaritoneAPI.getProvider().getPrimaryBaritone().getPathingBehavior().cancelEverything())
    client.call(lambda: setattr(BaritoneAPI.getSettings().allowBreak, "value", False))
after = client.call(facts)
print(json.dumps({"kind": "gather-contract", "before": before, "accepted": accepted, "after": after,
                  "goalVerified": finished, "operator": False}, ensure_ascii=False))
if not finished:
    raise RuntimeError("Contract did not become claimable within 1800 ticks; stopped without retry")
client.call(lambda: mc.player.connection.sendCommand("quest claim maw:gather_logs"))
ticks.wait(20)
print(json.dumps({"kind": "claim-result", "after": client.call(facts)}, ensure_ascii=False))
