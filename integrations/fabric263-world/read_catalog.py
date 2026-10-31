import json
import java
from graalweave import client

Minecraft = java.type("net.minecraft.client.Minecraft")
Registries = java.type("net.minecraft.core.registries.BuiltInRegistries")
ClientQuestData = java.type("com.erikedits.justquests.network.ClientQuestData")
Quest = java.type("com.erikedits.justquests.data.Quest")
JsonOps = java.type("com.mojang.serialization.JsonOps")
Identifier = java.type("net.minecraft.resources.Identifier")


def read():
    result = {"quests": {}, "items": {}, "npcs": []}
    for id in ("justquests:first_steps", "justquests:lumberjack", "justquests:craftsman"):
        quest = ClientQuestData.get(Identifier.parse(id))
        if quest is not None:
            encoded = Quest.CODEC.encodeStart(JsonOps.INSTANCE, quest).result()
            result["quests"][id] = json.loads(str(encoded.get())) if encoded.isPresent() else {"status": "unknown"}
    for namespace in ("farmersdelight", "wizards", "paladins"):
        keys = [str(key) for key in Registries.ITEM.keySet() if str(key).startswith(namespace + ":")]
        result["items"][namespace] = {"count": len(keys), "sample": keys[:12]}
    result["npcs"] = [str(key) for key in Registries.ENTITY_TYPE.keySet() if str(key).startswith("easy_npc:")][:12]
    return result


print(json.dumps(client.call(read), ensure_ascii=False))
