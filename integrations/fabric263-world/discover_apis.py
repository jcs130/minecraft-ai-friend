"""Small, on-demand API probes for the selected real client."""
import json
from graalweave import api

queries = [
    ("net.minecraft.client.Minecraft", "gui"),
    ("net.minecraft.client.Minecraft", "render"),
    ("com.erikedits.justquests.network.ClientQuestData", ""),
    ("net.minecraft.client.Screenshot", ""),
]
for name, query in queries:
    print(json.dumps(api.inspect(name, query=query, limit=16), ensure_ascii=False))
print(json.dumps(api.classes("ClientQuestData", mod="justquests", limit=8), ensure_ascii=False))
print(json.dumps(api.classes("Client", mod="village-quest", limit=8), ensure_ascii=False))
print(json.dumps(api.inspect("net.minecraft.client.Minecraft", kind="field", limit=40), ensure_ascii=False))
