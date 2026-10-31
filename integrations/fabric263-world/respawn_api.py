import json
from graalweave import api
print(json.dumps(api.inspect("net.minecraft.client.player.LocalPlayer", query="respawn", limit=12)))
