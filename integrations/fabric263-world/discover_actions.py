import json
from graalweave import api

for name, query, limit in [
    ("baritone.api.process.IMineProcess", "mine", 12),
    ("net.minecraft.client.multiplayer.MultiPlayerGameMode", "inventory", 12),
    ("de.quest.client.network.ClientQuestNetworking", "", 24),
    ("com.erikedits.justquests.network.QuestNetwork", "", 18),
]:
    print(json.dumps(api.inspect(name, query=query, limit=limit), ensure_ascii=False))
