import json
from graalweave import api

for name in ("net.spell_engine.client.casting.ClientCastController", "net.spell_engine.internals.casting.SpellCast$Option", "net.bettercombat.api.MinecraftClient_BetterCombat"):
    print(json.dumps(api.inspect(name, inherited=False, limit=30), ensure_ascii=False))
