import json
from graalweave import api

print(json.dumps(api.inspect("net.minecraft.client.multiplayer.MultiPlayerGameMode", kind="method", inherited=False, limit=100), ensure_ascii=False))
print(json.dumps(api.inspect("net.minecraft.client.player.LocalPlayer", query="menu", limit=20), ensure_ascii=False))
