import json
from graalweave import api

for name, query, offset, limit in [
    ("com.erikedits.justquests.network.ClientQuestData", "", 16, 12),
    ("com.erikedits.justquests.data.PlayerQuestData", "", 0, 24),
    ("net.minecraft.client.Minecraft", "layer", 0, 16),
    ("net.minecraft.client.gui.Gui", "screen", 0, 12),
    ("de.quest.client.VillageQuestClient", "", 0, 18),
]:
    print(json.dumps(api.inspect(name, query=query, offset=offset, limit=limit), ensure_ascii=False))
