"""Read the server-synchronized quest catalogue and this body's progress only."""
import json
import time
import java
from graalweave import api, client

ClientQuestData = java.type("com.erikedits.justquests.network.ClientQuestData")
Minecraft = java.type("net.minecraft.client.Minecraft")
mc = Minecraft.getInstance()


def read():
    quests = ClientQuestData.getQuests()
    data = ClientQuestData.getData()
    ids = [str(entry.getKey()) for entry in quests.entrySet()]
    return {"bodyId": str(mc.player.getUUID()), "observedAt": time.time(), "syncCount": ClientQuestData.syncCount(),
            "total": len(ids), "questIds": ids[:40], "complete": len(ids) <= 40,
            "active": [str(k) for k in data.active.keySet()], "completed": [str(k) for k in data.completed.keySet()],
            "pendingClaim": [str(k) for k in data.pendingClaim.keySet()]}


print(json.dumps(client.call(read), ensure_ascii=False))
print(json.dumps(api.inspect("com.erikedits.justquests.data.Quest", limit=30), ensure_ascii=False))
print(json.dumps(api.inspect("net.minecraft.world.inventory.Slot", query="", kind="method", limit=22), ensure_ascii=False))
